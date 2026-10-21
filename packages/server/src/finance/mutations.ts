import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { BudgetSummary, ExpenseDirection } from "@brain/shared";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { getBudgetSummary } from "./summary.js";

/**
 * Balance-aware edit/delete for recorded income + expenses. Because adding a row already
 * adjusted the running balance (decision D3), editing or deleting must apply the SIGNED delta
 * so the balance stays correct. Pure-ish (repos only, no LLM); returns the fresh budget.
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
  const old = repo.get(id);
  if (!old) return null;
  const next = repo.update(id, patch);
  if (!next) return null;
  new FinAccountRepo(handle, spaceId).adjustBalance(next.netCents - old.netCents);
  return getBudgetSummary(handle, spaceId);
}

export function deleteIncome(handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number): BudgetSummary | null {
  const repo = new FinIncomeRepo(handle, spaceId);
  const old = repo.get(id);
  if (!old) return null;
  repo.remove(id);
  new FinAccountRepo(handle, spaceId).adjustBalance(-old.netCents); // undo the add
  return getBudgetSummary(handle, spaceId);
}

export function editExpense(
  handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number,
  patch: { date?: string; amountCents?: number; merchant?: string | null; category?: string; direction?: ExpenseDirection },
): BudgetSummary | null {
  const repo = new FinExpenseRepo(handle, spaceId);
  const old = repo.get(id);
  if (!old) return null;
  const next = repo.update(id, patch);
  if (!next) return null;
  const delta = expenseSign(next.amountCents, next.direction) - expenseSign(old.amountCents, old.direction);
  new FinAccountRepo(handle, spaceId).adjustBalance(delta);
  return getBudgetSummary(handle, spaceId);
}

export function deleteExpense(handle: DbHandle, spaceId: string = DEFAULT_SPACE, id: number): BudgetSummary | null {
  const repo = new FinExpenseRepo(handle, spaceId);
  const old = repo.get(id);
  if (!old) return null;
  repo.remove(id);
  new FinAccountRepo(handle, spaceId).adjustBalance(-expenseSign(old.amountCents, old.direction)); // undo the add
  return getBudgetSummary(handle, spaceId);
}
