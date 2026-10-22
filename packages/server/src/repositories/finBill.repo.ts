import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinBill, FinBillOccurrence, BillFrequency } from "@brain/shared";
import { occurrenceDates, toDay } from "../finance/bills.js";

/**
 * Owns all SQL for `fin_bill` + `fin_bill_occurrence`. Space-scoped; money in INTEGER cents.
 * Occurrence materialization delegates to the pure date engine (finance/bills.ts) and is
 * idempotent (a UNIQUE(space,bill,due_date) index makes re-materializing a no-op).
 */
export class FinBillRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  private mapBill(r: any): FinBill {
    return {
      id: r.id, name: r.name, amountCents: r.amount_cents, frequency: r.frequency as BillFrequency,
      anchorDate: r.anchor_date, everyDays: r.every_days ?? undefined, autopay: r.autopay === 1,
      category: r.category, graceDays: r.grace_days ?? undefined, lateFeeCents: r.late_fee_cents ?? undefined,
      payee: r.payee ?? undefined, accountLast4: r.account_last4 ?? undefined, active: r.active === 1,
    };
  }

  private mapOcc(r: any): FinBillOccurrence {
    return {
      id: r.id, billId: r.bill_id, dueDate: r.due_date, amountCents: r.amount_cents,
      status: r.status, paidExpenseId: r.paid_expense_id ?? null, paidAt: r.paid_at ?? null,
    };
  }

  create(input: {
    name: string; amountCents: number; frequency: BillFrequency; anchorDate: string;
    everyDays?: number; autopay?: boolean; category?: string; graceDays?: number;
    lateFeeCents?: number; payee?: string; accountLast4?: string;
  }): FinBill {
    const info = this.handle.sqlite
      .prepare(`INSERT INTO fin_bill (space_id, name, amount_cents, frequency, anchor_date, every_days, autopay, category, grace_days, late_fee_cents, payee, account_last4, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(
        this.spaceId, input.name, Math.round(input.amountCents), input.frequency, input.anchorDate.slice(0, 10),
        input.everyDays ?? null, input.autopay ? 1 : 0, input.category ?? "bills", input.graceDays ?? null,
        input.lateFeeCents ?? null, input.payee ?? null, input.accountLast4 ?? null,
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): FinBill | null {
    const r = this.handle.sqlite.prepare(`SELECT * FROM fin_bill WHERE id = ? AND space_id = ?`).get(id, this.spaceId);
    return r ? this.mapBill(r) : null;
  }

  list(includeInactive = false): FinBill[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT * FROM fin_bill WHERE space_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY name`)
      .all(this.spaceId) as any[];
    return rows.map((r) => this.mapBill(r));
  }

  update(id: number, patch: Partial<Omit<FinBill, "id">>): FinBill | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.handle.sqlite
      .prepare(`UPDATE fin_bill SET name=?, amount_cents=?, frequency=?, anchor_date=?, every_days=?, autopay=?, category=?, grace_days=?, late_fee_cents=?, payee=?, account_last4=?, active=? WHERE id=? AND space_id=?`)
      .run(
        n.name, Math.round(n.amountCents), n.frequency, n.anchorDate.slice(0, 10), n.everyDays ?? null,
        n.autopay ? 1 : 0, n.category, n.graceDays ?? null, n.lateFeeCents ?? null, n.payee ?? null,
        n.accountLast4 ?? null, n.active ? 1 : 0, id, this.spaceId,
      );
    return this.get(id);
  }

  deactivate(id: number): boolean {
    return this.handle.sqlite.prepare(`UPDATE fin_bill SET active = 0 WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0;
  }

  /**
   * Materialize a bill's occurrences from `from` through `horizon` (idempotent). Existing
   * `paid`/`skipped` occurrences are preserved; only missing dates are inserted as `upcoming`.
   */
  materialize(billId: number, from: string, horizon: string): void {
    const bill = this.get(billId);
    if (!bill || !bill.active) return;
    const dates = occurrenceDates(
      { frequency: bill.frequency, anchorDate: bill.anchorDate, everyDays: bill.everyDays },
      from,
      horizon,
    );
    const insert = this.handle.sqlite.prepare(
      `INSERT OR IGNORE INTO fin_bill_occurrence (space_id, bill_id, due_date, amount_cents, status) VALUES (?, ?, ?, ?, 'upcoming')`,
    );
    const tx = this.handle.sqlite.transaction((ds: string[]) => {
      for (const d of ds) insert.run(this.spaceId, billId, d, Math.round(bill.amountCents));
    });
    tx(dates);
  }

  /** Materialize ALL active bills through the horizon (e.g. before computing the budget). */
  materializeAll(from: string, horizon: string): void {
    for (const b of this.list()) this.materialize(b.id, from, horizon);
  }

  /**
   * ADR-019 I1 — THE single live predicate, shared by every consumer
   * (Reserved via unpaidThrough, Upcoming via upcoming/upcomingCount, and
   * the Money Sky via upcoming). An occurrence is live iff
   * `status = 'upcoming'` AND (its bill is active OR it is past-due unpaid:
   * `due_date < today`, space-local). No consumer may apply a different
   * eligibility rule. `today` is the caller's space-local day; the default
   * (UTC day) exists only for legacy callers that have no space context —
   * every production path passes its space-local today explicitly.
   */
  private static liveCondition = `(b.active = 1 OR o.due_date < ?)`;

  /** Unpaid occurrences that are LIVE (I1) and due on/before `through` (ISO),
   *  with the bill name joined. A past-due unpaid occurrence always satisfies
   *  the horizon test (I1): the production horizon (the next-income date,
   *  estimateNextIncomeDate) is never before `today`, so every past-due live
   *  occurrence (due_date < today <= through) is included by the
   *  `due_date <= through` test alone. */
  unpaidThrough(through: string, today: string = toDay(new Date())): Array<FinBillOccurrence & { name: string }> {
    const rows = this.handle.sqlite
      .prepare(`SELECT o.*, b.name AS name FROM fin_bill_occurrence o JOIN fin_bill b ON b.id = o.bill_id
                WHERE o.space_id = ? AND o.status = 'upcoming' AND ${FinBillRepo.liveCondition}
                  AND o.due_date <= ? ORDER BY o.due_date`)
      .all(this.spaceId, today.slice(0, 10), through.slice(0, 10)) as any[];
    return rows.map((r) => ({ ...this.mapOcc(r), name: r.name }));
  }

  /** All LIVE (I1) upcoming occurrences, name-joined, ordered by due date. */
  upcoming(limit = 100, today: string = toDay(new Date())): Array<FinBillOccurrence & { name: string }> {
    const rows = this.handle.sqlite
      .prepare(`SELECT o.*, b.name AS name FROM fin_bill_occurrence o JOIN fin_bill b ON b.id = o.bill_id
                WHERE o.space_id = ? AND o.status = 'upcoming' AND ${FinBillRepo.liveCondition}
                ORDER BY o.due_date LIMIT ?`)
      .all(this.spaceId, today.slice(0, 10), limit) as any[];
    return rows.map((r) => ({ ...this.mapOcc(r), name: r.name }));
  }

  /** Total number of LIVE (I1) upcoming occurrences (ADR-019 §3.7: the true
   *  count behind the Upcoming list's display limit). */
  upcomingCount(today: string = toDay(new Date())): number {
    const r = this.handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM fin_bill_occurrence o JOIN fin_bill b ON b.id = o.bill_id
                WHERE o.space_id = ? AND o.status = 'upcoming' AND ${FinBillRepo.liveCondition}`)
      .get(this.spaceId, today.slice(0, 10)) as { c: number };
    return r.c;
  }

  /** One occurrence by id (any status), or null. */
  getOccurrence(id: number): FinBillOccurrence | null {
    const r = this.handle.sqlite.prepare(`SELECT * FROM fin_bill_occurrence WHERE id = ? AND space_id = ?`).get(id, this.spaceId);
    return r ? this.mapOcc(r) : null;
  }

  /** True when some occurrence in this space already links `expenseId`
   *  via `paid_expense_id` (ADR-019 I3: one payment, one expense). */
  isExpenseLinked(expenseId: number): boolean {
    const r = this.handle.sqlite
      .prepare(`SELECT 1 AS x FROM fin_bill_occurrence WHERE space_id = ? AND paid_expense_id = ? LIMIT 1`)
      .get(this.spaceId, expenseId) as { x: number } | undefined;
    return r != null;
  }

  /** The bill's earliest LIVE (I1) upcoming occurrence, or null. */
  earliestLiveForBill(billId: number, today: string): (FinBillOccurrence & { name: string }) | null {
    const rows = this.handle.sqlite
      .prepare(`SELECT o.*, b.name AS name FROM fin_bill_occurrence o JOIN fin_bill b ON b.id = o.bill_id
                WHERE o.space_id = ? AND o.bill_id = ? AND o.status = 'upcoming' AND ${FinBillRepo.liveCondition}
                ORDER BY o.due_date LIMIT 1`)
      .all(this.spaceId, billId, today.slice(0, 10)) as any[];
    return rows.length > 0 ? { ...this.mapOcc(rows[0]), name: rows[0].name } : null;
  }

  markPaid(occurrenceId: number, paidExpenseId?: number): boolean {
    return this.handle.sqlite
      .prepare(`UPDATE fin_bill_occurrence SET status = 'paid', paid_expense_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ? AND space_id = ?`)
      .run(paidExpenseId ?? null, occurrenceId, this.spaceId).changes > 0;
  }

  /** Convenience for tests/materialize callers: today as YYYY-MM-DD (UTC). */
  static today(now: Date = new Date()): string {
    return toDay(now);
  }
}
