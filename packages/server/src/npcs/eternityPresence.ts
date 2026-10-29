import type { AppContext } from "../context.js";
import { ETERNITY_AUTONOMOUS_GESTURES, ETERNITY_BROADCAST_LINES, type EternityPresence } from "@brain/shared";
import { dueForReview } from "../analysis/review.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { NpcRepo, localDateKey } from "./repo.js";

/**
 * His presence across the app (docs/specs/eternity-autonomy-2026-10-29.md §2d/§2e). Read-only, deterministic, no LLM.
 *
 * - The BROADCAST is his projection into every brain at once: one gesture + broadcast line per calendar day, the same
 *   for everyone (keyed on the UTC date — not shown to anyone as a time); no content ever crosses brains.
 * - The VEIL is a memory due for recall that he lights for you — an offer only: you recall it; he changes nothing.
 * - The CROWN marks a Journey you completed in the last week.
 * The kill switch silences all of it.
 */
export const CROWN_WINDOW_DAYS = 7;

/** Same gesture for every brain on the same UTC day. */
export function broadcastFor(utcDayKey: string): { gesture: (typeof ETERNITY_AUTONOMOUS_GESTURES)[number]; line: string } {
  let x = 0;
  for (let i = 0; i < utcDayKey.length; i++) x = (x * 31 + utcDayKey.charCodeAt(i)) >>> 0;
  const gesture = ETERNITY_AUTONOMOUS_GESTURES[x % ETERNITY_AUTONOMOUS_GESTURES.length]!;
  return { gesture, line: ETERNITY_BROADCAST_LINES[gesture] };
}

export function eternityPresence(ctx: AppContext, spaceId: string, nowMs: number = Date.now()): EternityPresence {
  const h = ctx.handle;
  const repo = new NpcRepo(h, spaceId);
  const utcDay = new Date(nowMs).toISOString().slice(0, 10);
  if (repo.state("eternity").stopped) {
    return { dayKey: utcDay, stopped: true, broadcast: null, actedToday: false, veil: null, crown: null };
  }
  const tz = spaceTimezone(h.sqlite, spaceId);
  const today = localDateKey(tz, nowMs);
  const actedToday = repo
    .recentLog("eternity")
    .some((e) => (e.kind === "gesture" || e.kind === "reorder-light") && localDateKey(tz, Date.parse(e.createdAt)) === today);
  const due = dueForReview(ctx, spaceId, nowMs, 1)[0];
  const since = new Date(nowMs - CROWN_WINDOW_DAYS * 86_400_000).toISOString();
  const crownRow = h.sqlite
    .prepare(
      `SELECT id, title FROM journeys WHERE space_id = ? AND status = 'done' AND replace(COALESCE(ended_at, updated_at), ' ', 'T') >= ?
       ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 1`,
    )
    .get(spaceId, since) as { id: number; title: string } | undefined;
  return {
    dayKey: utcDay,
    stopped: false,
    broadcast: broadcastFor(utcDay),
    actedToday,
    veil: due ? { nodeId: due.id, label: due.label } : null,
    crown: crownRow ? { journeyId: crownRow.id, title: crownRow.title } : null,
  };
}
