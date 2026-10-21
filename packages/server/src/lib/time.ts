/**
 * Canonical deterministic time helpers (docs/specs/temporal-contextual-reasoning.md).
 *
 * This repo's own audit found the exact same "naive SQLite timestamp vs. already-zoned ISO
 * string" tolerant-parse idiom (`str.includes("Z") ? str : str.replace(" ", "T") + "Z"`)
 * copy-pasted independently in 15+ server files (foresight.ts, review.ts, timeline.ts,
 * persona/behavior.ts, persona/derive.ts, lore/engine.ts, llm/prompts.ts, and most of
 * agent/tools/*.ts) with no shared utility — mirroring the web's own
 * `packages/web/src/utils/dueReminders.ts`, which was created for exactly this reason after
 * the same drift happened client-side. This file is the server-side equivalent: ONE canonical
 * parser for new code to use, so a temporal-reasoning layer spanning every domain in this app
 * doesn't add a 16th copy. It deliberately does NOT retroactively migrate the existing 15 call
 * sites — that's a larger, unrelated refactor out of scope for this feature.
 *
 * SQLite's own `CURRENT_TIMESTAMP` default renders as `"YYYY-MM-DD HH:MM:SS"` (space-separated,
 * UTC, no zone marker) for every `created_at`/`updated_at` column in this schema. App-written
 * business dates (`date`, `due_date`, `anchor_date`, `as_of`, `target_date`, `occurred_at`,
 * `remind_at`) are usually a bare `YYYY-MM-DD` or a full `Date.toISOString()` string. All three
 * shapes must parse to the same correct UTC instant.
 */

/** Parse any of this app's stored timestamp/date shapes to a UTC epoch ms. Returns `NaN` for
 *  empty/unparseable input — callers must check with `Number.isFinite` before using it, never
 *  silently coerce `NaN` into "now" or "epoch zero". */
export function parseTolerantMs(raw: string | null | undefined): number {
  if (!raw) return NaN;
  const trimmed = raw.trim();
  if (!trimmed) return NaN;
  const isZoned = trimmed.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(trimmed);
  const iso = isZoned ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

/** The plain `YYYY-MM-DD` UTC calendar date for a timestamp — for grouping/comparison against
 *  the app's bare-date business fields, never for display (no locale/timezone formatting). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole UTC calendar days between two instants (positive when `laterMs` is after `earlierMs`).
 *  Truncates toward zero on a partial day — "2 days ago" means at least 48h have elapsed, not
 *  "sometime after midnight two calendar dates back". */
export function daysBetween(earlierMs: number, laterMs: number): number {
  return Math.floor((laterMs - earlierMs) / 86_400_000);
}

/* ------------------------------------------------------------------ *
 * Space-local calendar helpers (owner rule, restated 2026-10-21: NO UTC
 * in anything user-facing — every calendar boundary, bucket, label,
 * "today", streak, season, and digest is computed in the SPACE's own
 * timezone, read from space_meta.timezone). Stored instants stay
 * instants; only the day/month a user PERCEIVES is derived here.
 * ------------------------------------------------------------------ */

/** Fallback zone when a stored zone string is unusable — the schema default
 *  (space_meta.timezone DEFAULT 'America/New_York'), mirroring the defensive
 *  read in agent/episodic.ts. Zone strings are validated on write
 *  (notify/policy.ts validateTimezone), so this is a last resort only. */
const FALLBACK_ZONE = "America/New_York";

function dayParts(instantMs: number, tz: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** The calendar date (YYYY-MM-DD) of an instant in zone `tz` — the day a user
 *  in that zone would say the instant falls on. Same algorithm as the notify
 *  layer's `localDay()` (agent/notify/policy.ts); this is the low-level home
 *  for code that cannot import the notify layer. */
export function localDayInZone(instantMs: number, tz: string): string {
  try {
    const p = dayParts(instantMs, tz);
    return `${p.y}-${p.m}-${p.d}`;
  } catch {
    const p = dayParts(instantMs, FALLBACK_ZONE);
    return `${p.y}-${p.m}-${p.d}`;
  }
}

/** The YYYY-MM month key of an instant in zone `tz`. */
export function localMonthInZone(instantMs: number, tz: string): string {
  return localDayInZone(instantMs, tz).slice(0, 7);
}

/** Offset of zone `tz` at `instantMs`, in ms (wall-clock-minus-UTC). */
function tzOffsetMs(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Epoch ms of local midnight (00:00 in zone `tz`) on calendar date y-m-d.
 *  Two-pass offset correction so a DST transition adjacent to midnight can
 *  never shift the result onto the wrong day. */
function zonedMidnightMs(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d);
  try {
    const first = guess - tzOffsetMs(guess, tz);
    return guess - tzOffsetMs(first, tz);
  } catch {
    const first = guess - tzOffsetMs(guess, FALLBACK_ZONE);
    return guess - tzOffsetMs(first, FALLBACK_ZONE);
  }
}

/** [start, end) epoch-ms bounds of the zone-local calendar day containing
 *  `instantMs`. Use for instant-range membership tests (e.g. SQL julianday
 *  ranges over stored timestamps) that must follow the user's local day
 *  rather than the UTC day. DST days are 23/25 hours — the bounds reflect
 *  the real local midnights, never startMs + 86_400_000. */
export function localDayBoundsMs(instantMs: number, tz: string): { startMs: number; endMs: number } {
  const day = localDayInZone(instantMs, tz);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const startMs = zonedMidnightMs(y, m, d, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endMs = zonedMidnightMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { startMs, endMs };
}

/** The space-local calendar date for a STORED value, or null when unparseable.
 *  A bare `YYYY-MM-DD` already IS a calendar date and is returned verbatim —
 *  it must never be re-zoned (a stored "2026-10-21" means Oct 21, full stop).
 *  A timestamp (naive SQLite UTC, or zoned ISO) is an instant: its perceived
 *  date is the local day of that instant in zone `tz`. */
export function localDateOfStored(raw: string | null | undefined, tz: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const ms = parseTolerantMs(t);
  return Number.isFinite(ms) ? localDayInZone(ms, tz) : null;
}

/** `daysBetween` from a stored date/timestamp string to `now` — the single most common shape
 *  every classifier in analysis/temporal.ts needs. Returns `null` (not `NaN`) when `raw` doesn't
 *  parse, so callers can treat "no date at all" as a distinct, explicit case rather than a
 *  silently-wrong number. */
export function daysSince(raw: string | null | undefined, nowMs: number): number | null {
  const ms = parseTolerantMs(raw);
  return Number.isFinite(ms) ? daysBetween(ms, nowMs) : null;
}

/** `daysBetween` from `now` to a future stored date/timestamp — negative when it's already
 *  past. Returns `null` when `raw` doesn't parse. */
export function daysUntil(raw: string | null | undefined, nowMs: number): number | null {
  const ms = parseTolerantMs(raw);
  return Number.isFinite(ms) ? daysBetween(nowMs, ms) : null;
}
