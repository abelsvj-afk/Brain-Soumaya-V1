import { getSpaceTimeZone } from "./spaceTimezone.js";

/**
 * The user's own local calendar day (owner rule, restated 2026-10-21: NO UTC
 * in anything user-facing — every "today", day key, grouping, and label
 * follows the user's own timezone).
 *
 * The zone is the SPACE's configured timezone (audit-2 item 2): the server
 * store's `timezone`, loaded and cached by utils/spaceTimezone.ts from
 * `getSpacePreferences()`. The device zone is ONLY the pre-load fallback
 * inside that accessor — once the configured zone is known, no derivation
 * here ever follows the device again. Same algorithm as the server's
 * `localDay()` (agent/notify/policy.ts): en-CA formatToParts in the target
 * timezone. This module is the ONE canonical web home for it —
 * ReviewPanel's IM-113 fix originally defined it inline; it lives here now
 * so every panel shares a single definition instead of growing copies.
 */
export function spaceLocalDay(d: Date = new Date(), timeZone: string = getSpaceTimeZone()): string {
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
 * instant: its perceived date is the local day of that instant in the
 * SPACE's configured timezone (device zone only as the pre-load fallback —
 * see the module header). Mirrors the server's `localDateOfStored`
 * (lib/time.ts).
 */
export function localDateOfStored(
  raw: string | null | undefined,
  parseMs: (raw?: string) => number,
  timeZone: string = getSpaceTimeZone(),
): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const ms = parseMs(t);
  return Number.isFinite(ms) ? spaceLocalDay(new Date(ms), timeZone) : null;
}

/**
 * Batch L (MIN-01, REG-132) — a Life Vision target date as a `YYYY-MM-DD` key.
 *
 * A Life Vision's target date has NO time-of-day meaning (docs/specs/
 * life-vision.md §9), so the stored value is read as a DATE, never as an
 * instant: a bare date-only value is returned verbatim, and any timestamp
 * form contributes its WRITTEN calendar date (its first 10 chars). The
 * written-date rule also heals legacy rows: the only writers that ever
 * produced a timestamp for this kind emitted `new Date(picked).toISOString()`
 * — UTC midnight of the picked date — so the written date IS the picked
 * date, where the old tolerant-parser reading (instant → device-zone date)
 * named the day before in America/New_York. Returns null when the value
 * carries no readable calendar date at all.
 */
export function visionTargetDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject impossible calendar dates (e.g. 2030-02-31) by round-tripping.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Batch L (MIN-01) — format a `YYYY-MM-DD` key as a human date
 * ("Jun 1, 2030"), anchored to UTC so the rendered day never depends on
 * the viewer's zone. A date-only value has no zone to interpret; formatting
 * it through the device zone is exactly the one-day-early defect.
 */
export function formatCalendarDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
