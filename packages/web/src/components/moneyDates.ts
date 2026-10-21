/**
 * Money-surface date rendering (IM-83): local-time, weekday-bearing, relativized —
 * never a bare ISO slice. All day math is done on LOCAL calendar days: a bill due
 * "2026-10-23" is due that day wherever the user is, so the date is parsed from its
 * Y/M/D parts instead of `new Date(iso)` (which would read a date-only string as UTC
 * midnight and shift the weekday for users behind UTC).
 */

/** Parse an ISO date ("2026-10-23") or timestamp into a local Date; null if unparseable. */
export function parseMoneyDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local-calendar days from `now`'s day to the target day (negative = past). */
export function daysFromToday(iso: string, now: Date = new Date()): number | null {
  const d = parseMoneyDate(iso);
  if (!d) return null;
  return Math.round((startOfLocalDay(d) - startOfLocalDay(now)) / 86_400_000);
}

/** "today" / "tomorrow" / "yesterday" / "in 3 days" / "3 days ago" — "" if unparseable. */
export function relDayLabel(iso: string, now: Date = new Date()): string {
  const days = daysFromToday(iso, now);
  if (days == null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "Fri, Oct 23" — weekday + local date. Falls back to the raw string if unparseable. */
export function fmtMoneyDate(iso: string): string {
  const d = parseMoneyDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Fri, Oct 23 · in 3 days" — the standard money-surface rendering. */
export function fmtMoneyDateRel(iso: string, now: Date = new Date()): string {
  const base = fmtMoneyDate(iso);
  const rel = relDayLabel(iso, now);
  return rel ? `${base} · ${rel}` : base;
}

/** For timestamps (createdAt/updatedAt): "Oct 20, 2026 · 2 days ago" style, date-only
 *  when older than a month (relative noise), "" when unparseable. */
export function fmtStampRel(iso: string, now: Date = new Date()): string {
  const d = parseMoneyDate(iso);
  if (!d) return "";
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const rel = relDayLabel(iso, now);
  const days = daysFromToday(iso, now);
  return rel && days != null && Math.abs(days) <= 31 ? `${date} · ${rel}` : date;
}
