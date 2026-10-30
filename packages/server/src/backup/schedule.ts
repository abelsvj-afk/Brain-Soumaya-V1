/**
 * G0 backup — the daily schedule, as pure functions (increment B3;
 * plan §1 K1: one automatic attempt daily at 03:30 America/New_York,
 * RPO ≤ 24h).
 *
 * Everything here is a pure function of an injected `now` — no timers,
 * no I/O — so the DST behaviour is directly testable. The two facts
 * that make 03:30 America/New_York well-behaved:
 * - spring forward skips 02:00–03:00 and fall back repeats 01:00–02:00,
 *   so 03:30 exists exactly once on every New York day, transition
 *   days included — one scheduled run per local day, never zero, never
 *   two;
 * - the Sunday slot is tagged tier "weekly" for the retention engine
 *   (plan §1), every other day "daily".
 *
 * Missed runs: the decision looks at the attempt RECORD, not at
 * process memory, so a restart cannot lose or duplicate a slot. If no
 * attempt exists at or after the current slot's instant, the run is
 * due — as "schedule" when the process is merely on time (within
 * SLOT_GRACE_MS of the slot), as "catch_up" when it is late (the app
 * was down at 03:30). This one rule is also the stale-latest-good
 * catch-up: a latest-good older than 24h at boot/check time can only
 * mean a slot passed without an attempt (or none ever ran), which is
 * exactly what the rule fires on.
 *
 * Missed slots COALESCE — they never queue: however long the outage,
 * exactly one run fires, for the current slot. But its TIER follows
 * the OLDEST slot it covers: if the app was down across a Sunday and
 * the next evaluation lands after Monday's slot, that single run is
 * still the weekly keeper, not a daily — the week's keeper must not
 * be silently downgraded just because the outage spanned a slot
 * boundary. (With no attempt history at all there is nothing to
 * coalesce: the tier is the current slot's.)
 *
 * There is deliberately NO second, purely age-based trigger. On the
 * fall-back day the slot interval is 25 hours, so an "age > 24h"
 * trigger would fire a second run inside the same local day, an hour
 * before the slot it duplicates. Latest-good AGE is a status signal
 * (spec §7: prominent when stale), not a trigger; the slot cadence —
 * which the owner approved as 03:30 New York wall-clock — governs
 * firing, and its worst-case interval is the 25-hour fall-back day.
 */
import type { BackupTier } from "./index.js";

export const BACKUP_TIMEZONE = "America/New_York";
export const BACKUP_DAILY_HOUR = 3;
export const BACKUP_DAILY_MINUTE = 30;
/** A run first evaluated within this long after its slot counts as on-time. */
export const SLOT_GRACE_MS = 15 * 60_000;
/** Latest-good older than this is STALE (plan §1 RPO); status shows it prominently. */
export const STALE_AFTER_MS = 24 * 60 * 60_000;

const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BACKUP_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface NyParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** The New York wall-clock reading of an instant. */
export function nyParts(instant: Date): NyParts {
  const parts = nyFormat.formatToParts(instant);
  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    return v === undefined ? 0 : Number(v);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** How far the New York wall clock is ahead of UTC at `instant`, in ms (EST: -5h, EDT: -4h). */
function nyOffsetMs(instant: Date): number {
  const p = nyParts(instant);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const floored = Math.floor(instant.getTime() / 1000) * 1000;
  return wallAsUtc - floored;
}

/**
 * The UTC instant at which the New York wall clock reads
 * `year-month-day hour:minute:00`. Resolved by offset iteration (two
 * passes settle every real case). Exact for 03:30, which never falls
 * inside a DST gap or overlap.
 */
export function nyLocalToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let t = guess - nyOffsetMs(new Date(guess));
  const refined = guess - nyOffsetMs(new Date(t));
  if (refined !== t) t = refined;
  return new Date(t);
}

/** Weekday of a calendar date (0 = Sunday) — a calendar fact, timezone-free. */
function weekdayOfDate(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dateKeyOf(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export interface ScheduledSlot {
  /** The instant this slot fires (03:30 New York on `dateKey`). */
  instant: Date;
  /** The slot's New York calendar date, YYYY-MM-DD. */
  dateKey: string;
  /** Retention tier for this slot: Sunday slots are the weekly keeper. */
  tier: BackupTier;
}

function slotOn(year: number, month: number, day: number): ScheduledSlot {
  return {
    instant: nyLocalToInstant(year, month, day, BACKUP_DAILY_HOUR, BACKUP_DAILY_MINUTE),
    dateKey: dateKeyOf(year, month, day),
    tier: weekdayOfDate(year, month, day) === 0 ? "weekly" : "daily",
  };
}

function shiftDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day) + deltaDays * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The most recent scheduled slot at or before `now` (today's once 03:30 NY has passed, else yesterday's). */
export function scheduledSlotFor(now: Date): ScheduledSlot {
  const p = nyParts(now);
  const today = slotOn(p.year, p.month, p.day);
  if (today.instant.getTime() <= now.getTime()) return today;
  const prev = shiftDate(p.year, p.month, p.day, -1);
  return slotOn(prev.year, prev.month, prev.day);
}

/** The next scheduled slot strictly after `now`. */
export function nextScheduledRun(now: Date): Date {
  const p = nyParts(now);
  const today = slotOn(p.year, p.month, p.day);
  if (today.instant.getTime() > now.getTime()) return today.instant;
  const next = shiftDate(p.year, p.month, p.day, 1);
  return slotOn(next.year, next.month, next.day).instant;
}

export interface BackupRunFacts {
  /**
   * Creation instant (epoch ms) of the NEWEST recorded attempt, or
   * null when none exist. This is all the decision needs: slot
   * coverage is "newest attempt at/after the slot", and the
   * coalesced tier walks back from there — so the scheduler's
   * per-tick fact is one MAX(created_at) query, never a full-history
   * re-read (review P2-5).
   */
  latestAttemptMs: number | null;
}

export type BackupDecision =
  | {
      run: true;
      trigger: "schedule" | "catch_up";
      tier: BackupTier;
      slotDateKey: string;
      reason: string;
    }
  | { run: false; reason: string };

/**
 * Decide whether a backup attempt is due at `now`, from the attempt
 * record alone (via its newest instant). See the module header for
 * the rule, the coalescing/tier rule, and why latest-good age is a
 * status signal rather than a second trigger.
 */
export function decideBackupRun(now: Date, facts: BackupRunFacts): BackupDecision {
  const slot = scheduledSlotFor(now);
  const slotMs = slot.instant.getTime();
  if (facts.latestAttemptMs !== null && facts.latestAttemptMs >= slotMs) {
    return { run: false, reason: "current slot already has an attempt recorded" };
  }
  const lateBy = now.getTime() - slotMs;
  const onTime = lateBy <= SLOT_GRACE_MS;
  // The tier is the OLDEST uncovered slot's: walk back from the
  // current slot while the previous slot is also uncovered (its
  // instant is after the newest attempt). Bounded — a year of
  // downtime is beyond any plausible outage, and the walk only
  // decides the tier label, never whether to run.
  let tierSlot = slot;
  if (facts.latestAttemptMs !== null) {
    let cursor = slot;
    for (let i = 0; i < 370; i++) {
      const p = nyParts(cursor.instant);
      const prevDate = shiftDate(p.year, p.month, p.day, -1);
      const prev = slotOn(prevDate.year, prevDate.month, prevDate.day);
      if (prev.instant.getTime() > facts.latestAttemptMs) {
        tierSlot = prev;
        cursor = prev;
      } else {
        break;
      }
    }
  }
  return {
    run: true,
    trigger: onTime ? "schedule" : "catch_up",
    tier: tierSlot.tier,
    slotDateKey: slot.dateKey,
    reason: onTime
      ? `scheduled slot ${slot.dateKey} 03:30 ${BACKUP_TIMEZONE} is due`
      : tierSlot.dateKey !== slot.dateKey
        ? `slots ${tierSlot.dateKey}…${slot.dateKey} passed with no attempt recorded — missed runs coalesced into one; tier follows the oldest uncovered slot (${tierSlot.dateKey})`
        : `slot ${slot.dateKey} 03:30 ${BACKUP_TIMEZONE} passed with no attempt recorded — missed run`,
  };
}
