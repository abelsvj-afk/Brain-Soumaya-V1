import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinIncome } from "@brain/shared";

/** Owns all SQL for `fin_income`. Space-scoped; money in INTEGER cents. */
export class FinIncomeRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  private map(r: any): FinIncome {
    return {
      id: r.id, sourceId: r.source_id ?? null, date: r.date,
      grossCents: r.gross_cents ?? null, netCents: r.net_cents,
      taxCents: r.tax_cents ?? null, hours: r.hours ?? null,
      platform: r.platform ?? null, confidence: r.confidence ?? null, createdAt: r.created_at,
      balanceAppliedAt: r.balance_applied_at ?? null,
    };
  }

  create(input: {
    date: string; netCents: number; grossCents?: number | null; taxCents?: number | null;
    hours?: number | null; platform?: string | null; sourceId?: number | null; confidence?: number | null;
    // ADR-019 marker (I9). Explicit string = applied at that timestamp;
    // explicit null = scheduled (not applied). Omitted = applied now —
    // the pre-ADR-019 semantics every direct repo caller already paired
    // with its own balance adjustment; finance/settlement.ts passes the
    // marker explicitly on every production path.
    balanceAppliedAt?: string | null;
  }): FinIncome {
    const marker = input.balanceAppliedAt === undefined ? new Date().toISOString() : input.balanceAppliedAt;
    const info = this.handle.sqlite
      .prepare(`INSERT INTO fin_income (space_id, source_id, date, gross_cents, net_cents, tax_cents, hours, platform, confidence, balance_applied_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        this.spaceId, input.sourceId ?? null, input.date.slice(0, 10),
        input.grossCents ?? null, Math.round(input.netCents), input.taxCents ?? null,
        input.hours ?? null, input.platform ?? null, input.confidence ?? null, marker,
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): FinIncome | null {
    const r = this.handle.sqlite
      .prepare(`SELECT * FROM fin_income WHERE id = ? AND space_id = ?`)
      .get(id, this.spaceId);
    return r ? this.map(r) : null;
  }

  update(
    id: number,
    patch: {
      date?: string; netCents?: number; platform?: string | null;
      grossCents?: number | null; taxCents?: number | null; hours?: number | null;
      // ADR-019: edits key every balance effect to the marker — the patch
      // can set it (settle inside the edit) or clear it (un-settle).
      // Omitted = leave the marker exactly as it is.
      balanceAppliedAt?: string | null;
    },
  ): FinIncome | null {
    const cur = this.get(id);
    if (!cur) return null;
    const date = (patch.date ?? cur.date).slice(0, 10);
    const net = patch.netCents != null ? Math.round(patch.netCents) : cur.netCents;
    const platform = patch.platform !== undefined ? patch.platform : cur.platform;
    // IM-82: gross/tax/hours were capturable at creation (IncomeBody) and via pay stubs,
    // but the edit path silently dropped them — a recorded row could never be corrected.
    const gross = patch.grossCents !== undefined ? (patch.grossCents != null ? Math.round(patch.grossCents) : null) : cur.grossCents;
    const tax = patch.taxCents !== undefined ? (patch.taxCents != null ? Math.round(patch.taxCents) : null) : cur.taxCents;
    const hours = patch.hours !== undefined ? patch.hours : cur.hours;
    const marker = patch.balanceAppliedAt !== undefined ? patch.balanceAppliedAt : (cur.balanceAppliedAt ?? null);
    this.handle.sqlite
      .prepare(`UPDATE fin_income SET date = ?, net_cents = ?, platform = ?, gross_cents = ?, tax_cents = ?, hours = ?, balance_applied_at = ? WHERE id = ? AND space_id = ?`)
      .run(date, net, platform ?? null, gross, tax, hours ?? null, marker, id, this.spaceId);
    return this.get(id);
  }

  remove(id: number): boolean {
    return this.handle.sqlite.prepare(`DELETE FROM fin_income WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0;
  }

  list(limit = 200): FinIncome[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT * FROM fin_income WHERE space_id = ? ORDER BY date DESC, id DESC LIMIT ?`)
      .all(this.spaceId, limit) as any[];
    return rows.map((r) => this.map(r));
  }

  /** Every income row in [start, end] inclusive (ISO dates), ascending — for the income
   *  trend's monthly bucketing (finance/incomeTrend.ts). */
  listBetween(start: string, end: string): FinIncome[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT * FROM fin_income WHERE space_id = ? AND date >= ? AND date <= ? ORDER BY date ASC`)
      .all(this.spaceId, start.slice(0, 10), end.slice(0, 10)) as any[];
    return rows.map((r) => this.map(r));
  }

  /** The single most recent income date, or null if none has ever been recorded — the
   *  freshness nudge's "have you logged anything lately" check. */
  mostRecentDate(): string | null {
    const r = this.handle.sqlite
      .prepare(`SELECT date FROM fin_income WHERE space_id = ? ORDER BY date DESC LIMIT 1`)
      .get(this.spaceId) as { date: string } | undefined;
    return r?.date ?? null;
  }

  /** Distinct income dates (ascending) for the cadence estimate. */
  dates(): string[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT DISTINCT date FROM fin_income WHERE space_id = ? ORDER BY date ASC`)
      .all(this.spaceId) as { date: string }[];
    return rows.map((r) => r.date);
  }

  /** Sum of net income in [start, end] inclusive (ISO dates), in cents. */
  sumNetBetween(start: string, end: string): number {
    const r = this.handle.sqlite
      .prepare(`SELECT COALESCE(SUM(net_cents), 0) AS s FROM fin_income WHERE space_id = ? AND date >= ? AND date <= ?`)
      .get(this.spaceId, start.slice(0, 10), end.slice(0, 10)) as { s: number };
    return r.s;
  }

  /** Likely-duplicate guard: same net + date already present. */
  findDuplicate(date: string, netCents: number): FinIncome | null {
    const r = this.handle.sqlite
      .prepare(`SELECT * FROM fin_income WHERE space_id = ? AND date = ? AND net_cents = ? LIMIT 1`)
      .get(this.spaceId, date.slice(0, 10), Math.round(netCents));
    return r ? this.map(r) : null;
  }
}
