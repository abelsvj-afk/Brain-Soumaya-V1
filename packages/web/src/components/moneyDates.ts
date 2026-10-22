import { spaceLocalDay } from "../utils/localDay.js";

/**
 * Money-surface date rendering (IM-83; ADR-019 §3.4): local-time, weekday-bearing,
 * relativized — never a bare ISO slice. Relative-day math is done on YYYY-MM-DD
 * day strings in the SPACE's configured timezone (the same `spaceLocalDay` source
 * FinancePanel's `today()` uses), never on device-local midnights: Money surfaces
 * must not mix two calendars on one screen (ADR-019 I8). A date-only string IS a
 * calendar day and is never re-zoned; a timestamp is an instant, and its day is
 * that instant's day in the given zone. When `timeZone` is omitted, `spaceLocalDay`'s
 * own fallback applies (the device zone, pre-load only), preserving the previous
 * behavior for callers that have not been threaded a zone yet.
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The YYYY-MM-DD day a money value falls on, in `timeZone` (space zone by
 *  fallback): the string itself for a date-only input, `spaceLocalDay` of the
 *  instant for a timestamp. Null if unparseable. */
function dayStringOf(iso: string, timeZone?: string): string | null {
  if (!iso) return null;
  if (DATE_ONLY.test(iso)) return parseMoneyDate(iso) ? iso : null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : spaceLocalDay(d, timeZone);
}

/** Serial day number for a YYYY-MM-DD string — pure calendar arithmetic on the
 *  string (no local-midnight instants), so differences never involve device
 *  midnights or DST. Callers only pass validated day strings. */
function dayNumber(ymd: string): number {
  const parts = ymd.split("-").map(Number);
  return Math.round(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!) / 86_400_000);
}

/** Whole calendar days from the SPACE-local day of `now` to the target day
 *  (negative = past), both taken in `timeZone`. */
export function daysFromToday(iso: string, now: Date = new Date(), timeZone?: string): number | null {
  const target = dayStringOf(iso, timeZone);
  if (!target) return null;
  return dayNumber(target) - dayNumber(spaceLocalDay(now, timeZone));
}

/** "today" / "tomorrow" / "yesterday" / "in 3 days" / "3 days ago" — "" if unparseable. */
export function relDayLabel(iso: string, now: Date = new Date(), timeZone?: string): string {
  const days = daysFromToday(iso, now, timeZone);
  if (days == null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "Fri, Oct 23" — weekday + local date. Falls back to the raw string if unparseable.
 *  Zone-free for date-only inputs (a date-only string is parsed from its Y/M/D parts,
 *  so its weekday is that calendar day's wherever it is rendered). */
export function fmtMoneyDate(iso: string): string {
  const d = parseMoneyDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "Fri, Oct 23 · in 3 days" — the standard money-surface rendering. */
export function fmtMoneyDateRel(iso: string, now: Date = new Date(), timeZone?: string): string {
  const base = fmtMoneyDate(iso);
  const rel = relDayLabel(iso, now, timeZone);
  return rel ? `${base} · ${rel}` : base;
}

/** For timestamps (createdAt/updatedAt): "Oct 20, 2026 · 2 days ago" style, date-only
 *  when older than a month (relative noise), "" when unparseable. The displayed date
 *  is the timestamp's day in `timeZone` (space zone), matching the relative label. */
export function fmtStampRel(iso: string, now: Date = new Date(), timeZone?: string): string {
  const target = dayStringOf(iso, timeZone);
  if (!target) return "";
  let date: string;
  if (DATE_ONLY.test(iso)) {
    // A date-only value is a calendar day, not an instant — render it from its
    // Y/M/D parts (like fmtMoneyDate) so no zone conversion can shift it.
    const d = parseMoneyDate(iso);
    if (!d) return "";
    date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } else {
    const d = new Date(iso);
    date = d.toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      ...(timeZone ? { timeZone } : {}),
    });
  }
  const rel = relDayLabel(iso, now, timeZone);
  const days = daysFromToday(iso, now, timeZone);
  return rel && days != null && Math.abs(days) <= 31 ? `${date} · ${rel}` : date;
}
