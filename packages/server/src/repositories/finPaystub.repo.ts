import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { FinPaystub, PaystubLineItem } from "@brain/shared";

/**
 * Owns all SQL for `fin_paystub` (docs/specs/paystub-ingestion.md). No SQL foreign key
 * (matches this table family's bucket_id/goal_id convention) — income_id is validated at
 * the application layer only. The original document (`source_data`, base64) is never
 * included in list()/get() — those return `hasSource` only; use `getSourceBlob()` for the
 * "View original" download, so a list of many stubs never drags every blob along with it.
 */
export class FinPaystubRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  private parseItems(json: string | null): PaystubLineItem[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private map(r: any): FinPaystub {
    return {
      id: r.id,
      incomeId: r.income_id ?? null,
      employer: r.employer ?? null,
      payDate: r.pay_date ?? null,
      periodStart: r.period_start ?? null,
      periodEnd: r.period_end ?? null,
      grossCents: r.gross_cents ?? null,
      netCents: r.net_cents,
      hours: r.hours ?? null,
      hourlyRateCents: r.hourly_rate_cents ?? null,
      earnings: this.parseItems(r.earnings_json),
      deductions: this.parseItems(r.deductions_json),
      ytdGrossCents: r.ytd_gross_cents ?? null,
      ytdNetCents: r.ytd_net_cents ?? null,
      sourceFilename: r.source_filename ?? null,
      sourceMime: r.source_mime ?? null,
      hasSource: r.has_source === 1,
      createdAt: r.created_at,
    };
  }

  private static readonly SELECT_COLS = `
    id, income_id, employer, pay_date, period_start, period_end, gross_cents, net_cents,
    hours, hourly_rate_cents, earnings_json, deductions_json, ytd_gross_cents, ytd_net_cents,
    source_filename, source_mime, created_at,
    (CASE WHEN source_data IS NOT NULL THEN 1 ELSE 0 END) AS has_source
  `;

  create(input: {
    incomeId?: number | null;
    employer?: string | null;
    payDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    grossCents?: number | null;
    netCents: number;
    hours?: number | null;
    hourlyRateCents?: number | null;
    earnings: PaystubLineItem[];
    deductions: PaystubLineItem[];
    ytdGrossCents?: number | null;
    ytdNetCents?: number | null;
    sourceFilename?: string | null;
    sourceMime?: string | null;
    sourceData?: string | null; // base64
  }): FinPaystub {
    const info = this.handle.sqlite
      .prepare(
        `INSERT INTO fin_paystub (
          space_id, income_id, employer, pay_date, period_start, period_end, gross_cents,
          net_cents, hours, hourly_rate_cents, earnings_json, deductions_json,
          ytd_gross_cents, ytd_net_cents, source_filename, source_mime, source_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.spaceId,
        input.incomeId ?? null,
        input.employer ?? null,
        input.payDate ?? null,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.grossCents ?? null,
        Math.round(input.netCents),
        input.hours ?? null,
        input.hourlyRateCents ?? null,
        JSON.stringify(input.earnings ?? []),
        JSON.stringify(input.deductions ?? []),
        input.ytdGrossCents ?? null,
        input.ytdNetCents ?? null,
        input.sourceFilename ?? null,
        input.sourceMime ?? null,
        input.sourceData ?? null,
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): FinPaystub | null {
    const r = this.handle.sqlite
      .prepare(`SELECT ${FinPaystubRepo.SELECT_COLS} FROM fin_paystub WHERE id = ? AND space_id = ?`)
      .get(id, this.spaceId);
    return r ? this.map(r) : null;
  }

  list(limit = 200): FinPaystub[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT ${FinPaystubRepo.SELECT_COLS} FROM fin_paystub WHERE space_id = ? ORDER BY COALESCE(pay_date, created_at) DESC, id DESC LIMIT ?`)
      .all(this.spaceId, limit) as any[];
    return rows.map((r) => this.map(r));
  }

  /** REG-009: EVERY stub whose effective date (pay_date, else its linked
   *  income's date) + net match — a direct keyed query, never a capped
   *  list() page: a re-uploaded stub older than the 200 most recent stubs
   *  must still be found. (SELECT_COLS re-qualified with the p. alias: the
   *  fin_income join carries an id column of its own.) */
  findAllByDateAndNet(date: string, netCents: number): FinPaystub[] {
    const cols = FinPaystubRepo.SELECT_COLS.split(",")
      .map((c) => c.trim())
      .map((c) => (c.startsWith("(") ? c : `p.${c}`))
      .join(", ");
    const rows = this.handle.sqlite
      .prepare(
        `SELECT ${cols} FROM fin_paystub p
         LEFT JOIN fin_income i ON i.id = p.income_id AND i.space_id = p.space_id
         WHERE p.space_id = ? AND p.net_cents = ? AND COALESCE(p.pay_date, i.date) = ?
         ORDER BY p.id ASC`,
      )
      .all(this.spaceId, Math.round(netCents), date.slice(0, 10)) as any[];
    return rows.map((r) => this.map(r));
  }

  /** REG-009: stubs linked to any of these incomes — the duplicate
   *  set-scan's stub-ownership check, keyed by income id (an income's date
   *  can be edited after its stub was saved, so ownership must not be
   *  inferred from a (date, net) match). */
  findAllByIncomeIds(ids: number[]): FinPaystub[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.handle.sqlite
      .prepare(
        `SELECT ${FinPaystubRepo.SELECT_COLS} FROM fin_paystub WHERE space_id = ? AND income_id IN (${placeholders}) ORDER BY id ASC`,
      )
      .all(this.spaceId, ...ids) as any[];
    return rows.map((r) => this.map(r));
  }

  /** The original document's bytes, for the "View original" download only. */
  getSourceBlob(id: number): { data: string; mime: string | null; filename: string | null } | null {
    const r = this.handle.sqlite
      .prepare(`SELECT source_data AS data, source_mime AS mime, source_filename AS filename FROM fin_paystub WHERE id = ? AND space_id = ? AND source_data IS NOT NULL`)
      .get(id, this.spaceId) as { data: string; mime: string | null; filename: string | null } | undefined;
    return r ?? null;
  }

  remove(id: number): boolean {
    return this.handle.sqlite.prepare(`DELETE FROM fin_paystub WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0;
  }
}
