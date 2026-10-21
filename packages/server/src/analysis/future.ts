import type { AppContext } from "../context.js";

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

/** Future events sorted by date (soonest first), with days-until (neg = overdue). */
export function upcomingEvents(ctx: AppContext, spaceId: string): UpcomingEvent[] {
  // The julianday() IS NOT NULL term deliberately EXCLUDES an event whose stored
  // remind_at can't be parsed as a date at all: such an event can't be placed on a
  // timeline, and without the filter it surfaced with inDays = NULL (julianday of
  // garbage), which the Mind panel rendered as the literal text "in nulld". With
  // the filter, every returned row's inDays is a real integer, as typed.
  const rows = ctx.handle.sqlite
    .prepare(
      `SELECT id, label, remind_at AS date,
         CAST(julianday(remind_at) - julianday('now') AS INTEGER) AS inDays
       FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind = 'future_event' AND remind_at IS NOT NULL
         AND julianday(remind_at) IS NOT NULL
       ORDER BY remind_at ASC LIMIT 50`,
    )
    .all(spaceId) as UpcomingEvent[];
  return rows;
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
