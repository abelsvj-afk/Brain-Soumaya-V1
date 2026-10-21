/**
 * History filtering + monthly totals (IM-82): the transaction History used to render
 * the full merged income+expense list at once — no search, no kind filter, no
 * date range, and no monthly summary, so finding or totalling anything meant
 * eyeballing every row. These are the pure helpers behind the filter bar and the
 * monthly totals strip; the component owns only the state.
 */

export interface HistoryRowLike {
  kind: "income" | "expense";
  date: string; // ISO date (YYYY-MM-DD…)
  cents: number;
  label: string;
  category?: string;
}

export interface HistoryFilters {
  query: string;
  kind: "all" | "income" | "expense";
  /** Inclusive ISO-date bounds; "" = unbounded. */
  from: string;
  to: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = { query: "", kind: "all", from: "", to: "" };

export function filterHistoryRows<T extends HistoryRowLike>(rows: T[], f: HistoryFilters): T[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.kind !== "all" && r.kind !== f.kind) return false;
    const day = r.date.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q) {
      const hay = `${r.label} ${r.category ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface MonthlyTotal {
  /** "2026-10" */
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

/** Per-month in/out/net over the (already filtered) rows, newest month first. */
export function monthlyTotals(rows: HistoryRowLike[]): MonthlyTotal[] {
  const byMonth = new Map<string, MonthlyTotal>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    let t = byMonth.get(month);
    if (!t) {
      t = { month, incomeCents: 0, expenseCents: 0, netCents: 0 };
      byMonth.set(month, t);
    }
    if (r.kind === "income") t.incomeCents += r.cents;
    else t.expenseCents += r.cents;
    t.netCents = t.incomeCents - t.expenseCents;
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** "2026-10" → "Oct 2026" (local, no day-shift risk: built from parts). */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
