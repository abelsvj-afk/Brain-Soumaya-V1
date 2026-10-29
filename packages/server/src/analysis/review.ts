import type { AppContext } from "../context.js";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Spaced repetition + active recall (NEURO_ALIGNMENT.md #1 — "memory is made by
 * retrieval, not storage"). A gentle SM-2-style schedule per memory: it decays over
 * time (drives a dimming star), a successful recall pushes the next review further
 * out, a lapse pulls it back in. This is the delivery engine behind the review-nudge
 * tool — Soumaya asks recall in her own voice; nothing here is an Anki deck.
 *
 * Deterministic + offline. All scheduling columns start NULL and are seeded lazily.
 */

const EASE_DEFAULT = 2.5;
const EASE_MIN = 1.3;
const EASE_MAX = 3.0;
const SEED_GRACE_DAYS = 2; // a new memory becomes review-eligible after settling this long
const DAY = 86_400_000;

function toMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

export interface ReviewRow {
  id: number;
  label: string;
  content: string;
  importance: number | null;
  created_at: string;
  review_ease: number | null;
  review_interval_days: number | null;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  review_count: number;
}

/**
 * Current 0..1 memory strength: full right after a review, decaying toward ~0.1 as it
 * approaches its next-review date. Never-reviewed memories decay from creation over the
 * seed grace. Drives the "dimming star = come review me" cue.
 */
export function memoryStrength(row: Pick<ReviewRow, "created_at" | "last_reviewed_at" | "review_interval_days">, now: number): number {
  const anchor = toMs(row.last_reviewed_at) || toMs(row.created_at);
  if (!anchor) return 1;
  const intervalDays = row.review_interval_days ?? SEED_GRACE_DAYS;
  const elapsedDays = Math.max(0, (now - anchor) / DAY);
  const frac = elapsedDays / Math.max(0.5, intervalDays);
  return clamp(1 - frac * 0.9, 0.05, 1);
}

/** Memories due for a recall nudge, most significant + weakest first. */
export function dueForReview(ctx: AppContext, spaceId: string = DEFAULT_SPACE, now: number = Date.now(), limit = 20): ReviewRow[] {
  const rows = ctx.handle.sqlite
    .prepare(
      `SELECT id, label, content, importance, created_at, review_ease, review_interval_days,
              next_review_at, last_reviewed_at, review_count
       FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')`,
    )
    .all(spaceId) as ReviewRow[];
  const seedCut = now - SEED_GRACE_DAYS * DAY;
  return rows
    .filter((r) => {
      if (r.next_review_at) return toMs(r.next_review_at) <= now; // scheduled + due
      return toMs(r.created_at) <= seedCut; // never scheduled but old enough to seed
    })
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || memoryStrength(a, now) - memoryStrength(b, now))
    .slice(0, limit);
}

/**
 * Grade a recall attempt (SM-2-ish) and reschedule. `remembered=true` pushes the
 * interval out and nudges ease up; a lapse resets to a 1-day interval and lowers ease.
 * Returns the new next-review ISO.
 */
export function gradeReview(ctx: AppContext, spaceId: string, id: number, remembered: boolean, now: number = Date.now()): string | null {
  const s = ctx.handle.sqlite;
  const row = s
    .prepare(`SELECT review_ease, review_interval_days, review_count FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(id, spaceId) as { review_ease: number | null; review_interval_days: number | null; review_count: number } | undefined;
  if (!row) return null;

  let ease = row.review_ease ?? EASE_DEFAULT;
  const count = row.review_count ?? 0;
  let interval: number;
  if (remembered) {
    ease = clamp(ease + 0.1, EASE_MIN, EASE_MAX);
    interval = count <= 0 ? 1 : count === 1 ? 6 : Math.round((row.review_interval_days ?? 1) * ease);
  } else {
    ease = clamp(ease - 0.2, EASE_MIN, EASE_MAX);
    interval = 1; // relearn from tomorrow
  }
  const nextIso = new Date(now + interval * DAY).toISOString();
  s.prepare(
    `UPDATE nodes SET review_ease = ?, review_interval_days = ?, next_review_at = ?, last_reviewed_at = ?,
       review_count = ?, review_snoozed_at = NULL WHERE id = ? AND space_id = ?`,
  ).run(ease, interval, nextIso, new Date(now).toISOString(), remembered ? count + 1 : 0, id, spaceId);
  return nextIso;
}

/**
 * A soft snooze when Soumaya nudges a memory but the user hasn't graded it yet — push
 * the next review out a few days so she doesn't re-ask tomorrow (without falsely marking
 * it "reviewed", which would restore strength it hasn't earned). The snooze is MARKED
 * (`review_snoozed_at`): only a nudge snooze may be cleared by tending the memory
 * (REG-198) — a grade-set schedule carries no marker and is never disturbed by a visit.
 */
export function snoozeReview(ctx: AppContext, spaceId: string, id: number, now: number = Date.now(), days = 3): void {
  const nextIso = new Date(now + days * DAY).toISOString();
  ctx.handle.sqlite
    .prepare(
      `UPDATE nodes SET next_review_at = ?, review_snoozed_at = ? WHERE id = ? AND space_id = ? AND deleted_at IS NULL`,
    )
    .run(nextIso, new Date(now).toISOString(), id, spaceId);
}

/**
 * Clear a nudge snooze (REG-198): the user opened/tended the memory the nudge asked
 * about, so the snooze no longer hides it — the memory is due again right now (it was
 * due when the nudge fired). Only a MARKED snooze is cleared; a grade-set schedule
 * (no marker) is left exactly alone. Takes the raw handle so the tend path
 * (NodesRepo) can call it without an AppContext. Returns true when a snooze was cleared.
 */
export function clearReviewSnooze(handle: DbHandle, spaceId: string, id: number, now: number = Date.now()): boolean {
  const info = handle.sqlite
    .prepare(
      `UPDATE nodes SET next_review_at = ?, review_snoozed_at = NULL
       WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND review_snoozed_at IS NOT NULL`,
    )
    .run(new Date(now).toISOString(), id, spaceId);
  return info.changes > 0;
}
