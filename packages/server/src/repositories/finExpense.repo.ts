import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinExpense, ExpenseDirection } from "@brain/shared";

/** Owns all SQL for `fin_expense`. Space-scoped; money in INTEGER cents. */
export class FinExpenseRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  private map(r: any): FinExpense {
    return {
      id: r.id, sourceId: r.source_id ?? null, date: r.date, amountCents: r.amount_cents,
      merchant: r.merchant ?? null, category: r.category, direction: r.direction as ExpenseDirection,
      confidence: r.confidence ?? null, createdAt: r.created_at,
      balanceAppliedAt: r.balance_applied_at ?? null,
    };
  }

  create(input: {
    date: string; amountCents: number; category: string; direction?: ExpenseDirection;
    merchant?: string | null; sourceId?: number | null; confidence?: number | null;
    // ADR-019 marker (I9) — same contract as FinIncomeRepo.create:
    // explicit string = applied then, explicit null = scheduled,
    // omitted = applied now (pre-ADR-019 direct-caller semantics).
    balanceAppliedAt?: string | null;
  }): FinExpense {
    const marker = input.balanceAppliedAt === undefined ? new Date().toISOString() : input.balanceAppliedAt;
    const info = this.handle.sqlite
      .prepare(`INSERT INTO fin_expense (space_id, source_id, date, amount_cents, merchant, category, direction, confidence, balance_applied_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        this.spaceId, input.sourceId ?? null, input.date.slice(0, 10), Math.round(input.amountCents),
        input.merchant ?? null, input.category, input.direction ?? "out", input.confidence ?? null, marker,
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): FinExpense | null {
    const r = this.handle.sqlite.prepare(`SELECT * FROM fin_expense WHERE id = ? AND space_id = ?`).get(id, this.spaceId);
    return r ? this.map(r) : null;
  }

  update(id: number, patch: { date?: string; amountCents?: number; merchant?: string | null; category?: string; direction?: ExpenseDirection; balanceAppliedAt?: string | null }): FinExpense | null {
    const cur = this.get(id);
    if (!cur) return null;
    const date = (patch.date ?? cur.date).slice(0, 10);
    const amount = patch.amountCents != null ? Math.round(patch.amountCents) : cur.amountCents;
    const merchant = patch.merchant !== undefined ? patch.merchant : cur.merchant;
    const category = patch.category ?? cur.category;
    const direction = patch.direction ?? cur.direction;
    // ADR-019: omitted = leave the settlement marker as-is; a string sets
    // it (settle inside the edit), null clears it (un-settle).
    const marker = patch.balanceAppliedAt !== undefined ? patch.balanceAppliedAt : (cur.balanceAppliedAt ?? null);
    this.handle.sqlite
      .prepare(`UPDATE fin_expense SET date = ?, amount_cents = ?, merchant = ?, category = ?, direction = ?, balance_applied_at = ? WHERE id = ? AND space_id = ?`)
      .run(date, amount, merchant ?? null, category, direction, marker, id, this.spaceId);
    return this.get(id);
  }

  remove(id: number): boolean {
    return this.handle.sqlite.prepare(`DELETE FROM fin_expense WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0;
  }

  list(limit = 200): FinExpense[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT * FROM fin_expense WHERE space_id = ? ORDER BY date DESC, id DESC LIMIT ?`)
      .all(this.spaceId, limit) as any[];
    return rows.map((r) => this.map(r));
  }

  /** Sum of outflow amounts in [start, end] inclusive, in cents. */
  sumOutBetween(start: string, end: string): number {
    const r = this.handle.sqlite
      .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM fin_expense WHERE space_id = ? AND direction = 'out' AND date >= ? AND date <= ?`)
      .get(this.spaceId, start.slice(0, 10), end.slice(0, 10)) as { s: number };
    return r.s;
  }

  /** Likely-duplicate guard: same amount + date + merchant already present. */
  findDuplicate(date: string, amountCents: number, merchant?: string | null): FinExpense | null {
    const r = this.handle.sqlite
      .prepare(`SELECT * FROM fin_expense WHERE space_id = ? AND date = ? AND amount_cents = ? AND IFNULL(merchant,'') = ? LIMIT 1`)
      .get(this.spaceId, date.slice(0, 10), Math.round(amountCents), merchant ?? "");
    return r ? this.map(r) : null;
  }
}
