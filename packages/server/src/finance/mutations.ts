import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { BudgetSummary, ExpenseDirection } from "@brain/shared";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { getBudgetSummary } from "./summary.js";
import { spaceToday, signedIncomeCents, signedExpenseCents } from "./settlement.js";

/**
 * Balance-aware edit/delete for recorded income + expenses (ADR-019 §3.6).
 *
 * Every balance effect is keyed to the entry's settlement marker
 * (`balance_applied_at`, I9), never to a date re-derivation, and each
 * operation runs in ONE transaction:
 *  - amount/direction edit: marker NULL → no balance change; marker set
 *    → adjust by the signed delta.
 *  - date edit: NULL→still-future: nothing; NULL→today/past: settles
 *    inside the edit (marker claim + FULL signed adjustment of the NEW
 *    amount); set→still-settled: only the amount delta; set→future:
 *    un-settles (reverse the FULL OLD signed amount, clear the marker).
 *  - delete: marker set → reverse the full signed amount in the delete
 *    transaction; NULL → delete only.
 *
 * Each function then returns getBudgetSummary(...), which itself sweeps
 * first. That sweep cannot double-apply anything the edit just did: the
 * edit's marker transitions committed with the edit transaction, so the
 * sweep's guarded claim (marker IS NULL) no longer matches a settled
 * entry, and an un-settled entry's new date is future, so it is not due.
 */

const expenseSign = (amountCents: number, dir: ExpenseDirection): number =>
  dir === "out" ? -amountCents : amountCents;

export function editIncome(
  handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number,
  patch: {
    date?: string; netCents?: number; platform?: string | null;
    grossCents?: number | null; taxCents?: number | null; hours?: number | null;
  },
): BudgetSummary | null {
  const repo = new FinIncomeRepo(handle, spaceId);
  if (!repo.get(id)) return null;
  const now = new Date();
  const tx = handle.sqlite.transaction((): boolean => {
    const old = repo.get(id);
    if (!old) return false;
    const today = spaceToday(handle, spaceId, now);
    const newDate = (patch.date ?? old.date).slice(0, 10);
    const newNet = patch.netCents != null ? Math.round(patch.netCents) : old.netCents;
    const wasSettled = old.balanceAppliedAt != null;
    const account = new FinAccountRepo(handle, spaceId);
    let markerPatch: { balanceAppliedAt?: string | null } = {};
    let delta = 0;
    if (!wasSettled && newDate <= today) {
      // Settle inside the edit: claim the marker + FULL new amount.
      markerPatch = { balanceAppliedAt: now.toISOString() };
      delta = newNet;
    } else if (wasSettled && newDate > today) {
      // Un-settle: reverse the FULL OLD amount, clear the marker.
      markerPatch = { balanceAppliedAt: null };
      delta = -signedIncomeCents(old);
    } else if (wasSettled) {
      // Stays settled: only the amount delta moves money.
      delta = newNet - old.netCents;
    }
    // !wasSettled && still future: stays scheduled — no balance effect.
    const next = repo.update(id, { ...patch, ...markerPatch });
    if (!next) return false;
    if (delta !== 0) account.adjustBalance(delta);
    return true;
  });
  if (!tx()) return null;
  return getBudgetSummary(handle, spaceId);
}

export function deleteIncome(handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number): BudgetSummary | null {
  const repo = new FinIncomeRepo(handle, spaceId);
  if (!repo.get(id)) return null;
  const tx = handle.sqlite.transaction((): boolean => {
    const old = repo.get(id);
    if (!old) return false;
    if (old.balanceAppliedAt != null) {
      new FinAccountRepo(handle, spaceId).adjustBalance(-signedIncomeCents(old));
    }
    return repo.remove(id);
  });
  if (!tx()) return null;
  return getBudgetSummary(handle, spaceId);
}

export function editExpense(
  handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number,
  patch: { date?: string; amountCents?: number; merchant?: string | null; category?: string; direction?: ExpenseDirection },
): BudgetSummary | null {
  const repo = new FinExpenseRepo(handle, spaceId);
  if (!repo.get(id)) return null;
  const now = new Date();
  const tx = handle.sqlite.transaction((): boolean => {
    const old = repo.get(id);
    if (!old) return false;
    const today = spaceToday(handle, spaceId, now);
    const newDate = (patch.date ?? old.date).slice(0, 10);
    const newAmount = patch.amountCents != null ? Math.round(patch.amountCents) : old.amountCents;
    const newDirection = patch.direction ?? old.direction;
    const newSigned = expenseSign(newAmount, newDirection);
    const wasSettled = old.balanceAppliedAt != null;
    const account = new FinAccountRepo(handle, spaceId);
    let markerPatch: { balanceAppliedAt?: string | null } = {};
    let delta = 0;
    if (!wasSettled && newDate <= today) {
      markerPatch = { balanceAppliedAt: now.toISOString() };
      delta = newSigned;
    } else if (wasSettled && newDate > today) {
      markerPatch = { balanceAppliedAt: null };
      delta = -signedExpenseCents(old);
    } else if (wasSettled) {
      delta = newSigned - signedExpenseCents(old);
    }
    const next = repo.update(id, { ...patch, ...markerPatch });
    if (!next) return false;
    if (delta !== 0) account.adjustBalance(delta);
    return true;
  });
  if (!tx()) return null;
  return getBudgetSummary(handle, spaceId);
}

export function deleteExpense(handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number): BudgetSummary | null {
  const repo = new FinExpenseRepo(handle, spaceId);
  if (!repo.get(id)) return null;
  const tx = handle.sqlite.transaction((): boolean => {
    const old = repo.get(id);
    if (!old) return false;
    if (old.balanceAppliedAt != null) {
      new FinAccountRepo(handle, spaceId).adjustBalance(-signedExpenseCents(old));
    }
    return repo.remove(id);
  });
  if (!tx()) return null;
  return getBudgetSummary(handle, spaceId);
}
