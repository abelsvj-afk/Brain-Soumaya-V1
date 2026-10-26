/**
 * Phase 2: Proactive notification policy.
 *
 * Centralizes the decision of WHEN a proactive notification may be sent.
 * All proactive sends flow through a single policy boundary (wired in
 * index.ts around the router tick's notify closure). Tools do not decide
 * timing; they provide their identity + occurrence data and the policy decides.
 *
 * Design doc: docs/SOUMAYA_TOOLS.md (Phase 2 section).
 * Signed-off defaults: quiet 21:00-04:30, cap 5/day, America/New_York.
 */

import { createHash } from "node:crypto";
import type { RawDb } from "../../db/vec.js";

/** Per-space notification preferences (stored in space_meta). */
export interface NotifyPreferences {
  timezone: string;
  quietStart: string; // "HH:MM"
  quietEnd: string; // "HH:MM"
  digestTime: string; // "HH:MM"
  dailyProactiveCap: number;
}

export const DEFAULT_PREFS: NotifyPreferences = {
  timezone: "America/New_York",
  quietStart: "21:00",
  quietEnd: "04:30",
  digestTime: "06:00",
  dailyProactiveCap: 5,
};

/** Urgency classification for a single notification. */
export interface Urgency {
  isUrgent: boolean;
  reason?: string;
}

/** What the policy decides for a notification request. */
export type PolicyDecision =
  | { action: "send" }
  | { action: "queue"; deliverAfter: string; reason: string }
  | { action: "drop"; reason: string };

/** Metadata a tool passes with a notification request.
 *  Tools pass their identity + stable hints; the policy layer builds the
 *  timezone-aware occurrenceId via occurrenceIdFor(). */
export interface NotifyMeta {
  tool: string;
  /** Pre-built occurrence ID (overrides hint-based construction). */
  occurrenceId?: string;
  /** fire_reminder: the node whose reminder fired. */
  nodeId?: number;
  /** ISO timestamp the reminder was due (fire_reminder). */
  remindAt?: string;
  /** create_task: the created action's node id. */
  actionId?: number;
  /** ISO timestamp the bill is due (billRisk). */
  billDueAt?: string;
  /** Stable bill identifier (billRisk). */
  billId?: number;
  /** chart_discovery: the stable Codex key of the newly charted entry. */
  discoveryKey?: string;
  /** goal_trend: the goal whose funding trend fired. */
  goalId?: number;
}

/** ISO week string (YYYY-Www) in the given timezone. */
export function isoWeek(d: Date, tz: string): string {
  const day = localDay(d, tz);
  const dt = new Date(day + "T12:00:00Z");
  const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = Math.ceil(((dt.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Build the occurrence ID from tool hints + preferences. Used by the policy
 * boundary when the tool didn't pre-build one.
 */
export function buildOccurrenceId(sqlite: RawDb, spaceId: string, meta: NotifyMeta, now: Date): string {
  if (meta.occurrenceId) return meta.occurrenceId;
  const prefs = getPreferences(sqlite, spaceId);
  const day = localDay(now, prefs.timezone);
  switch (meta.tool) {
    case "fire_reminder":
      return `node:${meta.nodeId}:at:${meta.remindAt}`;
    case "create_task":
      return `action:${meta.actionId}`;
    case "checkin":
    case "reviewNudge":
    case "finance_freshness":
      // Periodic nudges: one occurrence per space-local day.
      return `day:${day}`;
    case "weeklyReview":
      return `week:${isoWeek(now, prefs.timezone)}`;
    case "billRisk":
      return `bill:${meta.billId}:day:${day}`;
    case "chart_discovery":
      // One occurrence per charted entry — the Codex key is unique per
      // discovery and add() refuses duplicates, so this never re-fires.
      return meta.discoveryKey ? `discovery:${meta.discoveryKey}` : `event:${day}:${meta.tool}`;
    case "goal_trend":
      return meta.goalId !== undefined ? `goal:${meta.goalId}:day:${day}` : `event:${day}:${meta.tool}`;
    case "surface_orphan":
      return meta.nodeId !== undefined ? `node:${meta.nodeId}:day:${day}` : `event:${day}:${meta.tool}`;
    case "web_lookup":
      // One lookup notification per source memory — detect() already
      // refuses a second lookup of the same memory.
      return meta.nodeId !== undefined ? `node:${meta.nodeId}` : `event:${day}:${meta.tool}`;
    default:
      return `event:${day}:${meta.tool}`;
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const PREF_COLUMNS: Record<keyof NotifyPreferences, string> = {
  timezone: "timezone",
  quietStart: "quiet_start",
  quietEnd: "quiet_end",
  digestTime: "digest_time",
  dailyProactiveCap: "daily_proactive_cap",
};

export function getPreferences(sqlite: RawDb, spaceId: string): NotifyPreferences {
  const row = sqlite
    .prepare(`SELECT timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap FROM space_meta WHERE space_id = ?`)
    .get(spaceId) as Record<string, unknown> | undefined;
  return {
    timezone: (row?.timezone as string) || DEFAULT_PREFS.timezone,
    quietStart: (row?.quiet_start as string) || DEFAULT_PREFS.quietStart,
    quietEnd: (row?.quiet_end as string) || DEFAULT_PREFS.quietEnd,
    digestTime: (row?.digest_time as string) || DEFAULT_PREFS.digestTime,
    dailyProactiveCap:
      typeof row?.daily_proactive_cap === "number" ? row.daily_proactive_cap : DEFAULT_PREFS.dailyProactiveCap,
  };
}

/** The space's timezone, defensively read: the shared default applies when
 *  space_meta is unreachable (bare test DB) — the same defensive pattern as
 *  spaceLocalDate() in agent/episodic.ts and spaceDayStr() in streak.ts.
 *  THE one resolver every space-local calendar computation should use
 *  (owner rule 2026-10-21: user-facing days follow the space's own zone). */
export function spaceTimezone(sqlite: RawDb, spaceId: string): string {
  try {
    return getPreferences(sqlite, spaceId).timezone;
  } catch {
    return DEFAULT_PREFS.timezone;
  }
}

/**
 * Resolve the timezone that grounds a conversational turn's "now" (owner
 * rule: time grounding is ALWAYS the space's own zone; UTC is never a
 * silent fallback, and neither is an assumed zone when storage itself
 * failed). Built for the agent loop in Package E2 and shared with the web
 * chat path in Package E7 — both channels resolve through this one chain.
 *
 * Chain — precedence follows the shared resolver (stored zone first, then
 * the shared default):
 *  1. `getPreferences()` — the space's stored zone, or the shared default
 *     (DEFAULT_PREFS.timezone) when the space has none set and storage is
 *     reachable. This is exactly the value the shared resolver returns on
 *     the happy path.
 *  2. A direct single-column read of the stored `space_meta.timezone` —
 *     survives a failure of the wider preferences read (e.g. a lagging
 *     preferences column), so a preferences failure ALONE can no longer
 *     lose the stored zone (pre-fix both chat paths landed on the UTC
 *     rendering).
 *  3. The shared `spaceTimezone()` resolver — its signed-off default for a
 *     reachable-but-unset space whose reads above failed.
 * Returns null when no step yields a VALID zone — including when both
 * storage reads hard-failed (step 3's result is then the bare default, a
 * pure assumption rather than a resolution). Callers pass null to
 * composeSystem, which renders the time context as UNAVAILABLE for the
 * turn — never the UTC rendering.
 */
export function resolveAgentTimezone(sqlite: RawDb, spaceId: string): string | null {
  let prefsThrew = false;
  try {
    const tz = getPreferences(sqlite, spaceId).timezone;
    if (tz && validateTimezone(tz)) return tz;
  } catch {
    prefsThrew = true;
  }
  let storedThrew = false;
  try {
    const row = sqlite
      .prepare(`SELECT timezone FROM space_meta WHERE space_id = ?`)
      .get(spaceId) as { timezone?: unknown } | undefined;
    const tz = typeof row?.timezone === "string" ? row.timezone : undefined;
    if (tz && validateTimezone(tz)) return tz;
  } catch {
    storedThrew = true;
  }
  const resolved = spaceTimezone(sqlite, spaceId);
  if (resolved && validateTimezone(resolved)) {
    if (prefsThrew && storedThrew && resolved === DEFAULT_PREFS.timezone) return null;
    return resolved;
  }
  return null;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set one preference. Validates before writing; invalid values are rejected
 * WITHOUT corrupting the existing preference. Returns ok or an error message.
 */
export function setPreference(
  sqlite: RawDb,
  spaceId: string,
  key: keyof NotifyPreferences,
  value: string
): { ok: true } | { ok: false; error: string } {
  const col = PREF_COLUMNS[key];
  if (key === "timezone") {
    if (!validateTimezone(value)) return { ok: false, error: `Invalid IANA timezone: ${value}` };
  } else if (key === "quietStart" || key === "quietEnd" || key === "digestTime") {
    if (!HHMM_RE.test(value)) return { ok: false, error: `Invalid time (expected HH:MM): ${value}` };
  } else if (key === "dailyProactiveCap") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: `Invalid cap (expected 0-100): ${value}` };
    }
    sqlite.prepare(`INSERT INTO space_meta (space_id, ${col}) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET ${col} = excluded.${col}, updated_at = CURRENT_TIMESTAMP`).run(spaceId, n);
    return { ok: true };
  }
  sqlite.prepare(`INSERT INTO space_meta (space_id, ${col}) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET ${col} = excluded.${col}, updated_at = CURRENT_TIMESTAMP`).run(spaceId, value);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Timezone-aware time helpers
// ---------------------------------------------------------------------------

/** Local YYYY-MM-DD in the given IANA timezone. */
export function localDay(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local HH:MM (24h) in the given IANA timezone. */
export function localTime(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // en-GB can return "24:00" for midnight; normalize.
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${h}:${get("minute")}`;
}

/** True when `now` falls inside the quiet window (handles midnight crossing). */
export function isQuietHours(now: Date, prefs: NotifyPreferences): boolean {
  const t = localTime(now, prefs.timezone);
  if (prefs.quietStart <= prefs.quietEnd) {
    return t >= prefs.quietStart && t < prefs.quietEnd;
  }
  // Crosses midnight (e.g. 21:00-04:30).
  return t >= prefs.quietStart || t < prefs.quietEnd;
}

/**
 * Next UTC instant at which `hhmm` occurs in `tz`, strictly after `from`.
 * Used for deliver_after computation.
 */
export function nextLocalTime(from: Date, hhmm: string, tz: string): Date {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  // Start from `from`, then walk forward day by day until the local time matches.
  // Compute the candidate in UTC by offsetting.
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const base = new Date(from.getTime() + dayOffset * 86400000);
    const dayStr = localDay(base, tz);
    // Construct noon UTC on that local day, then find the UTC instant whose
    // local time is hhmm via iterative refinement.
    let guess = new Date(`${dayStr}T12:00:00Z`);
    for (let i = 0; i < 4; i++) {
      const lt = localTime(guess, tz);
      const [gh = 0, gm = 0] = lt.split(":").map(Number);
      const diffMin = (h * 60 + m) - (gh * 60 + gm);
      guess = new Date(guess.getTime() + diffMin * 60000);
    }
    if (guess.getTime() > from.getTime() && localTime(guess, tz) === hhmm) return guess;
  }
  // Fallback: 24h later (should not happen).
  return new Date(from.getTime() + 86400000);
}

// ---------------------------------------------------------------------------
// Urgency classification
// ---------------------------------------------------------------------------

/** Fresh-reminder window: a reminder due within the last 60 min is urgent. */
export const FRESH_REMINDER_MS = 60 * 60 * 1000;
/** Bill due within this window may qualify as urgent. */
export const URGENT_BILL_HOURS = 6;

/**
 * Classify urgency. Urgent bypasses quiet hours AND the daily cap.
 * Criteria (signed off):
 * - fire_reminder: remind_at within the last 60 minutes (you asked for that time).
 * - billRisk: bill due within 6h AND no urgent alert for this bill today.
 * - everything else: never urgent.
 */
export function classifyUrgency(sqlite: RawDb, spaceId: string, meta: NotifyMeta, now: Date): Urgency {
  if (meta.tool === "fire_reminder" && meta.remindAt) {
    const due = new Date(meta.remindAt).getTime();
    const age = now.getTime() - due;
    if (age >= 0 && age <= FRESH_REMINDER_MS) {
      return { isUrgent: true, reason: `fresh reminder (due ${Math.round(age / 60000)}m ago)` };
    }
    return { isUrgent: false };
  }
  if (meta.tool === "billRisk" && meta.billDueAt && meta.billId) {
    const dueIn = new Date(meta.billDueAt).getTime() - now.getTime();
    if (dueIn >= 0 && dueIn <= URGENT_BILL_HOURS * 3600 * 1000) {
      // Dedup: no urgent alert for this bill today.
      const prefs = getPreferences(sqlite, spaceId);
      const day = localDay(now, prefs.timezone);
      const existing = sqlite
        .prepare(
          `SELECT 1 FROM notification_outbox WHERE space_id = ? AND tool = 'billRisk'
           AND occurrence_id LIKE ? AND substr(occurrence_id, -10) = ?
           AND is_urgent = 1 AND status IN ('sending','sent','ambiguous','partial') LIMIT 1`
        )
        .get(spaceId, `bill:${meta.billId}:%`, day);
      if (!existing) {
        return { isUrgent: true, reason: `bill due in ${Math.round(dueIn / 3600000)}h` };
      }
    }
    return { isUrgent: false };
  }
  return { isUrgent: false };
}

// ---------------------------------------------------------------------------
// Occurrence identity (dedup contracts — implementation must preserve these)
// ---------------------------------------------------------------------------

/**
 * Build the stable occurrence ID for a tool event. Retries of the same
 * occurrence MUST produce the same ID; distinct occurrences MUST differ.
 */
export function occurrenceIdFor(tool: string, parts: Record<string, string>): string {
  switch (tool) {
    case "fire_reminder":
      return `node:${parts.nodeId}:at:${parts.remindAt}`;
    case "create_task":
      return `action:${parts.actionNodeId}`;
    case "checkin":
    case "reviewNudge":
    case "finance_freshness":
      return `day:${parts.localDay}`;
    case "weeklyReview":
      return `week:${parts.isoWeek}`;
    case "billRisk":
      return `bill:${parts.billId}:day:${parts.localDay}`;
    case "chart_discovery":
      return `discovery:${parts.discoveryKey}`;
    case "goal_trend":
      return `goal:${parts.goalId}:day:${parts.localDay}`;
    case "surface_orphan":
      return `node:${parts.nodeId}:day:${parts.localDay}`;
    case "web_lookup":
      return `node:${parts.nodeId}`;
    default:
      return `event:${parts.eventId ?? createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
  }
}

/** Dedup key: sha256(space_id|tool|occurrence_id). */
export function notifKey(spaceId: string, tool: string, occurrenceId: string): string {
  return createHash("sha256").update(`${spaceId}|${tool}|${occurrenceId}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Per-tool staleness (signed off)
// ---------------------------------------------------------------------------

/** Max age for a queued notification before it's dropped as stale. Null = never stale. */
export function stalenessLimitMs(tool: string): number | null {
  switch (tool) {
    case "fire_reminder":
      return 3 * 24 * 3600 * 1000; // GRACE_MS from reminder.ts (verified)
    case "checkin":
    case "reviewNudge":
      return 24 * 3600 * 1000;
    case "weeklyReview":
      return 7 * 24 * 3600 * 1000;
    case "billRisk":
      return 7 * 24 * 3600 * 1000;
    case "create_task":
      return null; // the task itself carries expiry
    default:
      return 24 * 3600 * 1000;
  }
}

// ---------------------------------------------------------------------------
// Policy decision
// ---------------------------------------------------------------------------

/**
 * Decide what to do with a notification request. Called at the single policy
 * boundary in index.ts. Never throws for policy reasons — worst case queues.
 */
export function decidePolicy(
  sqlite: RawDb,
  spaceId: string,
  meta: NotifyMeta,
  urgency: Urgency,
  now: Date
): PolicyDecision {
  const prefs = getPreferences(sqlite, spaceId);

  // Urgent bypasses everything. The bypass reason is logged by the caller.
  if (urgency.isUrgent) return { action: "send" };

  // Staleness: drop if the underlying event is too old to matter.
  const limit = stalenessLimitMs(meta.tool);
  if (limit !== null && meta.remindAt) {
    const age = now.getTime() - new Date(meta.remindAt).getTime();
    if (age > limit) return { action: "drop", reason: `stale (${Math.round(age / 3600000)}h old)` };
  }

  // Quiet hours: queue until they end.
  if (isQuietHours(now, prefs)) {
    const deliverAfter = nextLocalTime(now, prefs.quietEnd, prefs.timezone);
    return { action: "queue", deliverAfter: deliverAfter.toISOString(), reason: "quiet hours" };
  }

  // Cap is enforced atomically at claim time (see outbox.ts); here we only
  // decide queue-vs-send. If the claim fails, the caller queues for tomorrow.
  return { action: "send" };
}

/**
 * Compute deliver_after when the cap claim fails: tomorrow at digest_time,
 * pushed to quiet_end if that falls inside quiet hours.
 */
export function deliverAfterCapReached(now: Date, prefs: NotifyPreferences): string {
  let deliverAfter = nextLocalTime(now, prefs.digestTime, prefs.timezone);
  if (isQuietHours(deliverAfter, prefs)) {
    deliverAfter = nextLocalTime(deliverAfter, prefs.quietEnd, prefs.timezone);
  }
  return deliverAfter.toISOString();
}
