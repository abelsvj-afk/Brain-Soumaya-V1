import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinBill, FinExpense } from "@brain/shared";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { createExpenseEntry, spaceToday } from "./settlement.js";
import { estimateNextIncomeDate } from "./budget.js";
import { parseDay, toDay } from "./bills.js";

/**
 * ADR-019 §4 — bill lifecycle operations: Mark paid (create / match),
 * Remove, Edit, Skip. Each operation is ONE SQLite transaction
 * (`handle.sqlite.transaction(...)`); a failure anywhere rolls back the
 * whole operation, so no operation leaves a half-applied state.
 *
 * Mark paid is CLAIM-FIRST (§4 guard rule): the guarded flip
 * `status → 'paid' WHERE status = 'upcoming'` runs before anything else
 * is written, and its exactly-one-row outcome is asserted — a zero-row
 * guard aborts before any expense or balance change exists, so a losing
 * concurrent claim writes nothing (T15/T20). Better-sqlite3 nests
 * transactions as savepoints, so the settlement helpers used here
 * (createExpenseEntry) compose safely inside these transactions.
 */

export type MarkPaidCreateResult =
  | { kind: "paid"; expense: FinExpense }
  | { kind: "already-paid" }
  | { kind: "already-resolved" } // status is 'skipped' — terminal, never payable
  | { kind: "not-found" };

export type MarkPaidMatchResult =
  | { kind: "paid"; expenseId: number }
  | { kind: "already-paid" }
  | { kind: "already-resolved" }
  | { kind: "not-found" }
  | { kind: "expense-not-found" }
  | { kind: "expense-linked" };

export type SkipResult =
  | { kind: "skipped" }
  | { kind: "already-resolved" }
  | { kind: "not-found" };

type ClaimOutcome = "claimed" | "already-paid" | "already-resolved" | "not-found";

/**
 * The claim (§4): guarded flip to 'paid', asserted. Returns "claimed" iff
 * exactly one row flipped. A miss distinguishes the three no-write cases
 * by re-reading the row (still inside the caller's transaction — nothing
 * else has been written yet, so returning a miss commits nothing).
 */
function claimOccurrence(handle: DbHandle, spaceId: string, occurrenceId: number, now: Date): ClaimOutcome {
  const res = handle.sqlite
    .prepare(`UPDATE fin_bill_occurrence SET status = 'paid', paid_at = ? WHERE id = ? AND space_id = ? AND status = 'upcoming'`)
    .run(now.toISOString(), occurrenceId, spaceId);
  if (res.changes === 1) return "claimed";
  if (res.changes !== 0) throw new Error(`claim guard changed ${res.changes} rows for occurrence ${occurrenceId}`);
  const occ = new FinBillRepo(handle, spaceId).getOccurrence(occurrenceId);
  if (!occ) return "not-found";
  return occ.status === "paid" ? "already-paid" : "already-resolved";
}

/** Link the claimed occurrence to its expense; asserted exactly one row. */
function linkExpense(handle: DbHandle, spaceId: string, occurrenceId: number, expenseId: number): void {
  const res = handle.sqlite
    .prepare(`UPDATE fin_bill_occurrence SET paid_expense_id = ? WHERE id = ? AND space_id = ?`)
    .run(expenseId, occurrenceId, spaceId);
  if (res.changes !== 1) throw new Error(`failed to link expense ${expenseId} to occurrence ${occurrenceId}`);
}

/**
 * Mark paid (create) — P1: claim first, then record the payment as a real
 * expense dated the space-local payment day (settled at write per §3.6,
 * so the deduction and the reservation release land together, I2a), then
 * link it via `paid_expense_id` — all in one transaction. Any failure
 * after the claim rolls the claim back too (T3/T20).
 */
export function markOccurrencePaidCreate(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  occurrenceId: number,
  now: Date = new Date(),
): MarkPaidCreateResult {
  const bills = new FinBillRepo(handle, spaceId);
  const tx = handle.sqlite.transaction((): MarkPaidCreateResult => {
    const claim = claimOccurrence(handle, spaceId, occurrenceId, now);
    if (claim !== "claimed") return { kind: claim };
    const occ = bills.getOccurrence(occurrenceId)!;
    const bill = bills.get(occ.billId);
    if (!bill) throw new Error(`occurrence ${occurrenceId} references missing bill ${occ.billId}`);
    const expense = createExpenseEntry(
      handle,
      spaceId,
      {
        date: spaceToday(handle, spaceId, now),
        amountCents: occ.amountCents,
        category: bill.category,
        merchant: bill.payee ?? bill.name,
      },
      now,
    );
    linkExpense(handle, spaceId, occurrenceId, expense.id);
    return { kind: "paid", expense };
  });
  return tx();
}

/** Sentinel for aborting a match AFTER the claim: throwing rolls the claim
 *  back (the occurrence stays 'upcoming'), and the kind is recovered
 *  outside the transaction. */
class MatchAbort extends Error {
  constructor(readonly kind: "expense-not-found" | "expense-linked") {
    super(`mark-paid match aborted: ${kind}`);
  }
}

/**
 * Mark paid (match) — claim first (same guard, same abort), then verify
 * the candidate expense exists in this space and is unlinked (I3). On
 * success only `paid_expense_id` is set: NO balance adjustment and NO
 * marker change on the expense — its own settlement state governs (I2b).
 */
export function markOccurrencePaidMatch(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  occurrenceId: number,
  expenseId: number,
  now: Date = new Date(),
): MarkPaidMatchResult {
  const bills = new FinBillRepo(handle, spaceId);
  const expenses = new FinExpenseRepo(handle, spaceId);
  const tx = handle.sqlite.transaction((): MarkPaidMatchResult => {
    const claim = claimOccurrence(handle, spaceId, occurrenceId, now);
    if (claim !== "claimed") return { kind: claim };
    if (!expenses.get(expenseId)) throw new MatchAbort("expense-not-found");
    if (bills.isExpenseLinked(expenseId)) throw new MatchAbort("expense-linked");
    linkExpense(handle, spaceId, occurrenceId, expenseId);
    return { kind: "paid", expenseId };
  });
  try {
    return tx();
  } catch (e) {
    if (e instanceof MatchAbort) return { kind: e.kind };
    throw e;
  }
}

/**
 * Remove bill — P2/I5: one transaction deactivates the bill and deletes
 * its today-and-future `upcoming` occurrences (space-local). Past-due
 * unpaid, paid, and skipped rows are never touched — past-due unpaid
 * occurrences stay live under I1 until explicitly resolved. Returns
 * false only when the bill does not exist; re-removing is a no-op
 * success (idempotent, T17).
 */
export function removeBill(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  billId: number,
  now: Date = new Date(),
): boolean {
  const bills = new FinBillRepo(handle, spaceId);
  const tx = handle.sqlite.transaction((): boolean => {
    if (!bills.get(billId)) return false;
    const today = spaceToday(handle, spaceId, now);
    handle.sqlite.prepare(`UPDATE fin_bill SET active = 0 WHERE id = ? AND space_id = ?`).run(billId, spaceId);
    handle.sqlite
      .prepare(`DELETE FROM fin_bill_occurrence WHERE space_id = ? AND bill_id = ? AND status = 'upcoming' AND due_date >= ?`)
      .run(spaceId, billId, today);
    return true;
  });
  return tx();
}

/**
 * Edit bill — P3/I4/I6: one transaction updates `fin_bill`, then rewrites
 * ELIGIBLE-FUTURE occurrences only (`status = 'upcoming'` AND
 * `due_date >= today`, space-local). Amount-only change: those rows'
 * amounts update in place. Schedule change (frequency / anchorDate /
 * everyDays): the eligible-future rows are deleted and the new schedule
 * is re-materialized from `today` through the §3.3 horizon
 * (max(next-income date, today + 45 days)) at the new amount, through
 * `fin_occ_unique` (INSERT OR IGNORE). Past-due unpaid and paid/skipped
 * rows keep their historical amounts exactly.
 */
export function editBill(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  billId: number,
  patch: Partial<Omit<FinBill, "id">>,
  now: Date = new Date(),
): FinBill | null {
  const bills = new FinBillRepo(handle, spaceId);
  const tx = handle.sqlite.transaction((): FinBill | null => {
    const cur = bills.get(billId);
    if (!cur) return null;
    const updated = bills.update(billId, patch);
    if (!updated) return null;
    const today = spaceToday(handle, spaceId, now);
    const scheduleChanged =
      updated.frequency !== cur.frequency ||
      updated.anchorDate.slice(0, 10) !== cur.anchorDate.slice(0, 10) ||
      (updated.everyDays ?? null) !== (cur.everyDays ?? null);
    if (scheduleChanged) {
      handle.sqlite
        .prepare(`DELETE FROM fin_bill_occurrence WHERE space_id = ? AND bill_id = ? AND status = 'upcoming' AND due_date >= ?`)
        .run(spaceId, billId, today);
      if (updated.active) {
        const nextIncomeDate = estimateNextIncomeDate(new FinIncomeRepo(handle, spaceId).dates(), now, undefined, today);
        const plus45 = toDay(new Date(parseDay(today).getTime() + 45 * 86_400_000));
        bills.materialize(billId, today, nextIncomeDate > plus45 ? nextIncomeDate : plus45);
      }
    } else if (updated.amountCents !== cur.amountCents) {
      handle.sqlite
        .prepare(`UPDATE fin_bill_occurrence SET amount_cents = ? WHERE space_id = ? AND bill_id = ? AND status = 'upcoming' AND due_date >= ?`)
        .run(Math.round(updated.amountCents), spaceId, billId, today);
    }
    return updated;
  });
  return tx();
}

/**
 * Skip occurrence — P4: guarded flip `status → 'skipped'` WHERE
 * `status = 'upcoming'`, asserted. A skipped occurrence stops reserving
 * and leaves Upcoming (it is never live, I1) but remains in history; the
 * recurring bill itself is untouched. No other row changes.
 */
export function skipOccurrence(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  occurrenceId: number,
): SkipResult {
  const tx = handle.sqlite.transaction((): SkipResult => {
    const res = handle.sqlite
      .prepare(`UPDATE fin_bill_occurrence SET status = 'skipped' WHERE id = ? AND space_id = ? AND status = 'upcoming'`)
      .run(occurrenceId, spaceId);
    if (res.changes === 1) return { kind: "skipped" };
    if (res.changes !== 0) throw new Error(`skip guard changed ${res.changes} rows for occurrence ${occurrenceId}`);
    const occ = new FinBillRepo(handle, spaceId).getOccurrence(occurrenceId);
    return occ ? { kind: "already-resolved" } : { kind: "not-found" };
  });
  return tx();
}
