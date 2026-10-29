import type { AppContext } from "../context.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDateOfStored, localDayInZone } from "../lib/time.js";

/**
 * Future events (Cognitive Layer Phase 7, docs/COGNITIVE_LAYER.md). A `future_event`
 * is something ahead — an appointment, deadline, or prediction — carrying a real date
 * in `remind_at`. This powers a "what's ahead" timeline, and once an event's date
 * passes it ROLLS INTO THE PAST: it becomes an ordinary memory (it happened), settling
 * into your galaxy's history. Deterministic + offline.
 */

export interface UpcomingEvent {
  id: number;
  label: string;
  date: string; // ISO
  inDays: number; // negative = overdue
}

/** Ordinal of a YYYY-MM-DD calendar date (days since the epoch). The date
 *  itself is the unit, so no zone arithmetic is involved. */
function dayOrdinal(day: string): number {
  return (
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) /
    86_400_000
  );
}

/** Future events sorted by date (soonest first), with days-until (neg = overdue). */
export function upcomingEvents(ctx: AppContext, spaceId: string): UpcomingEvent[] {
  // inDays is the SPACE-LOCAL calendar-day difference (CHR-02, REG-035):
  // tomorrow morning viewed tonight is 1, yesterday evening is -1 — never
  // the elapsed-whole-24h truncation the old CAST(julianday(remind_at) -
  // julianday('now') AS INTEGER) gave (tomorrow 09:00 viewed today 15:00
  // read 0, "<24h past" never read overdue, +3d 10h read 3 instead of 4).
  // A bare YYYY-MM-DD stored date IS that space-local date (localDateOfStored
  // returns it verbatim, never re-zoned); a timestamp is the local day of
  // that instant in the space zone. Mind consumes inDays verbatim and
  // inherits the fix — no consumer change needed.
  const tz = spaceTimezone(ctx.handle.sqlite, spaceId);
  const todayOrdinal = dayOrdinal(localDayInZone(Date.now(), tz));
  // The julianday() IS NOT NULL term deliberately EXCLUDES an event whose stored
  // remind_at can't be parsed as a date at all: such an event can't be placed on a
  // timeline, and without the filter it surfaced with inDays = NULL (julianday of
  // garbage), which the Mind panel rendered as the literal text "in nulld". With
  // the filter, every returned row's inDays is a real integer, as typed.
  const rows = ctx.handle.sqlite
    .prepare(
      `SELECT id, label, remind_at AS date
       FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind = 'future_event' AND remind_at IS NOT NULL
         AND julianday(remind_at) IS NOT NULL
       ORDER BY remind_at ASC LIMIT 50`,
    )
    .all(spaceId) as { id: number; label: string; date: string }[];
  const out: UpcomingEvent[] = [];
  for (const r of rows) {
    const day = localDateOfStored(r.date, tz);
    if (day === null) continue; // Defensive: the SQL filter already excludes these.
    out.push({ id: r.id, label: r.label, date: r.date, inDays: dayOrdinal(day) - todayOrdinal });
  }
  return out;
}

/**
 * Roll any future event whose date has passed into the past: it becomes an ordinary
 * memory (it happened). Returns how many rolled over. Free/offline; runs in autonomy.
 */
export function rollPastEvents(ctx: AppContext, spaceId: string): number {
  const s = ctx.handle.sqlite;
  const due = s
    .prepare(
      `SELECT id, label FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind = 'future_event'
         AND remind_at IS NOT NULL AND julianday(remind_at) <= julianday('now')`,
    )
    .all(spaceId) as { id: number; label: string }[];
  for (const e of due) {
    // It's now history: a plain memory, dated to when it occurred, no longer pending.
    s.prepare(
      `UPDATE nodes SET kind = 'memory', type = 'daily', occurred_at = remind_at, remind_at = NULL,
         last_tended_at = CURRENT_TIMESTAMP WHERE id = ? AND space_id = ?`,
    ).run(e.id, spaceId);
    try {
      s.prepare(
        `INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'event_passed', ?, ?)`,
      ).run(spaceId, `A future event arrived and settled into memory: "${e.label}"`, JSON.stringify([e.id]));
    } catch {
      /* best-effort */
    }
  }
  return due.length;
}
