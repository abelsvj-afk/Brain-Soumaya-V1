/**
 * The user's own local calendar day (owner rule, restated 2026-10-21: NO UTC
 * in anything user-facing — every "today", day key, grouping, and label
 * follows the user's own timezone).
 *
 * The web has no space_meta access, so the zone defaults to the one this
 * device reports — the user's own local zone, which is what the space
 * timezone is set from (server default America/New_York). Same algorithm as
 * the server's `localDay()` (agent/notify/policy.ts): en-CA formatToParts in
 * the target timezone. This module is the ONE canonical web home for it —
 * ReviewPanel's IM-113 fix originally defined it inline; it lives here now
 * so every panel shares a single definition instead of growing copies.
 */
export function spaceLocalDay(d: Date = new Date(), timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // Unknown/invalid zone — fall back to the runtime's own local calendar day.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/**
 * The local calendar date for a STORED value, or null when unparseable.
 * A bare `YYYY-MM-DD` already IS a calendar date and is returned verbatim —
 * never re-zoned. A stored timestamp (naive SQLite UTC, or zoned ISO) is an
 * instant: its perceived date is the local day of that instant on this
 * device. Mirrors the server's `localDateOfStored` (lib/time.ts).
 */
export function localDateOfStored(raw: string | null | undefined, parseMs: (raw?: string) => number): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const ms = parseMs(t);
  return Number.isFinite(ms) ? spaceLocalDay(new Date(ms)) : null;
}
