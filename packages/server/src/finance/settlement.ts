import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinIncome, FinExpense, ExpenseDirection } from "@brain/shared";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";

/**
 * ADR-019 §3.6 — scheduled vs settled entries, made durable.
 *
 * An entry's amount is reflected in the tracked balance iff its
 * `balance_applied_at` marker is set (invariant I9). The entry's date
 * governs only when it becomes ELIGIBLE to settle (the space-local start
 * of its date); the marker is the single authority on applied-ness.
 *
 * Every writer of an entry's balance effect lives here or keys off the
 * marker in the same transaction (finance/mutations.ts): create-with-
 * marker, the settlement claim below, edit settle/un-settle/delta, and
 * delete reversal. All helpers run inside `handle.sqlite.transaction(...)`
 * — better-sqlite3 nests those as savepoints, so every helper is safely
 * callable inside a caller's transaction (e.g. mark-paid, ingest).
 */

/** Signed balance effect of an income row: +net. */
export function signedIncomeCents(row: FinIncome): number {
  return row.netCents;
}

/** Signed balance effect of an expense row (mirrors mutations.ts expenseSign). */
export function signedExpenseCents(row: FinExpense): number {
  return row.direction === "out" ? -row.amountCents : row.amountCents;
}

/** The space-local calendar day of `now` (mirror of summary.ts). */
export function spaceToday(handle: DbHandle, spaceId: string, now: Date = new Date()): string {
  return localDay(now, spaceTimezone(handle.sqlite, spaceId));
}

export interface CreateIncomeInput {
  date: string; netCents: number; grossCents?: number | null; taxCents?: number | null;
  hours?: number | null; platform?: string | null; sourceId?: number | null; confidence?: number | null;
}

export interface CreateExpenseInput {
  date: string; amountCents: number; category: string; direction?: ExpenseDirection;
  merchant?: string | null; sourceId?: number | null; confidence?: number | null;
}

/**
 * Insert an income row and settle it at write iff it is dated today or
 * earlier (space-local): marker set to the evaluation timestamp (never
 * backdated to the entry's date) and the balance adjusted by the signed
 * amount — insert, marker, and adjustment in ONE transaction.
 * Future-dated: marker NULL, no balance effect (scheduled).
 */
export function createIncomeEntry(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: CreateIncomeInput,
  now: Date = new Date(),
): FinIncome {
  const date = input.date.slice(0, 10);
  const settled = date <= spaceToday(handle, spaceId, now);
  const tx = handle.sqlite.transaction((): FinIncome => {
    const row = new FinIncomeRepo(handle, spaceId).create({
      ...input,
      date,
      balanceAppliedAt: settled ? now.toISOString() : null,
    });
    if (settled) {
      new FinAccountRepo(handle, spaceId).adjustBalance(signedIncomeCents(row));
    }
    return row;
  });
  return tx();
}

/** Expense twin of createIncomeEntry — same settlement rule, signed by direction. */
export function createExpenseEntry(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: CreateExpenseInput,
  now: Date = new Date(),
): FinExpense {
  const date = input.date.slice(0, 10);
  const settled = date <= spaceToday(handle, spaceId, now);
  const tx = handle.sqlite.transaction((): FinExpense => {
    const row = new FinExpenseRepo(handle, spaceId).create({
      ...input,
      date,
      balanceAppliedAt: settled ? now.toISOString() : null,
    });
    if (settled) {
      new FinAccountRepo(handle, spaceId).adjustBalance(signedExpenseCents(row));
    }
    return row;
  });
  return tx();
}

interface DueIncomeRow { id: number; net_cents: number }
interface DueExpenseRow { id: number; amount_cents: number; direction: ExpenseDirection }

/**
 * The settlement sweep (§3.6): for every entry with marker NULL and
 * date <= space-local today, claim + adjust in one per-entry transaction.
 * The claim is guarded (`AND balance_applied_at IS NULL`) and asserted:
 * exactly 1 changed row means THIS call settles the entry; 0 rows means
 * another path settled it first — no adjustment, no error. If the balance
 * adjustment throws after the claim, the transaction rolls back (marker
 * still NULL, balance unchanged) and a retry settles exactly once.
 * Returns the number of entries settled by this call.
 */
export function settleDueEntries(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  now: Date = new Date(),
): number {
  const today = spaceToday(handle, spaceId, now);
  const marker = now.toISOString();
  const account = new FinAccountRepo(handle, spaceId);
  let settled = 0;

  const dueIncomes = handle.sqlite
    .prepare(`SELECT id, net_cents FROM fin_income WHERE space_id = ? AND balance_applied_at IS NULL AND date <= ? ORDER BY id`)
    .all(spaceId, today) as DueIncomeRow[];
  for (const row of dueIncomes) {
    const didSettle = handle.sqlite.transaction((): boolean => {
      const claim = handle.sqlite
        .prepare(`UPDATE fin_income SET balance_applied_at = ? WHERE id = ? AND space_id = ? AND balance_applied_at IS NULL`)
        .run(marker, row.id, spaceId);
      if (claim.changes !== 1) return false; // already settled elsewhere — silent no-op
      account.adjustBalance(row.net_cents);
      return true;
    })();
    if (didSettle) settled++;
  }

  const dueExpenses = handle.sqlite
    .prepare(`SELECT id, amount_cents, direction FROM fin_expense WHERE space_id = ? AND balance_applied_at IS NULL AND date <= ? ORDER BY id`)
    .all(spaceId, today) as DueExpenseRow[];
  for (const row of dueExpenses) {
    const didSettle = handle.sqlite.transaction((): boolean => {
      const claim = handle.sqlite
        .prepare(`UPDATE fin_expense SET balance_applied_at = ? WHERE id = ? AND space_id = ? AND balance_applied_at IS NULL`)
        .run(marker, row.id, spaceId);
      if (claim.changes !== 1) return false; // already settled elsewhere — silent no-op
      account.adjustBalance(row.direction === "out" ? -row.amount_cents : row.amount_cents);
      return true;
    })();
    if (didSettle) settled++;
  }

  return settled;
}
