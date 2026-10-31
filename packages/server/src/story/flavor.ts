import type { DbHandle } from "../db/client.js";
import { LEANS, NEUTRAL_COUNTS, flavorKey, neutralFlavor, hourBand, type FlavorKey, type Lean, type PlayCounts } from "@brain/shared";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDateKey } from "../npcs/repo.js";
import { computeSociety } from "../society/society.js";
import { DiscoveryReader } from "../discovery/reader.js";

/**
 * The Flavour key for a brain (docs/specs/story-flavor-engine-2026-10-30.md §4). It colours how the locked story is voiced and never changes what is there. Built from
 * numbers only: the society's currents (already private, opt-out) and COUNTS of how the brain is played — never memory text. One cached row per brain-day so flavour drifts
 * like weather. Off, or anything failing, yields the neutral key: plain wording, the whole canon.
 */

export const FLAVOR_WINDOW_DAYS = 30;

export function getFlavorOn(h: DbHandle, spaceId: string): boolean {
  const row = h.sqlite.prepare(`SELECT flavor_on FROM story_prefs WHERE space_id = ?`).get(spaceId) as { flavor_on: number } | undefined;
  return row ? row.flavor_on !== 0 : true; // default on; the Settings copy says so and offers the switch
}

export function setFlavorOn(h: DbHandle, spaceId: string, on: boolean): void {
  h.sqlite.prepare(`INSERT INTO story_prefs (space_id, flavor_on) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET flavor_on = excluded.flavor_on`).run(spaceId, on ? 1 : 0);
}

const n = (h: DbHandle, sql: string, ...args: unknown[]): number => (h.sqlite.prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0;

/** Counts over the recent window, from tables that already exist. No column read here holds user text. `chatTurns` and `sameHourReturns` are not fed yet (0). */
export function playCounts(h: DbHandle, spaceId: string, nowMs: number): PlayCounts {
  const since = new Date(nowMs - FLAVOR_WINDOW_DAYS * 86_400_000).toISOString();
  return {
    ...NEUTRAL_COUNTS,
    worldVisits: n(h, `SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = ? AND state IN ('arrived','returned') AND COALESCE(arrived_at, created_at) >= ?`, spaceId, since),
    distinctWorlds: n(h, `SELECT COUNT(DISTINCT destination) AS n FROM travel_journeys WHERE space_id = ? AND state IN ('arrived','returned') AND COALESCE(arrived_at, created_at) >= ?`, spaceId, since),
    recalls: n(h, `SELECT COUNT(*) AS n FROM review_grade_attempts WHERE space_id = ? AND created_at >= ?`, spaceId, since),
    captures: n(h, `SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND created_at >= ?`, spaceId, since),
    closures: n(h, `SELECT COUNT(*) AS n FROM journey_mission_completions WHERE space_id = ? AND completed_at >= ?`, spaceId, since),
    noticings:
      new DiscoveryReader(h, spaceId).countNoticedSince(since) +
      n(h, `SELECT COUNT(*) AS n FROM story_links WHERE space_id = ? AND linked_at >= ?`, spaceId, since),
  };
}

function previousLean(h: DbHandle, spaceId: string, dayKey: string): [Lean, Lean] | undefined {
  const row = h.sqlite.prepare(`SELECT lean FROM story_flavor_day WHERE space_id = ? AND day_key < ? ORDER BY day_key DESC LIMIT 1`).get(spaceId, dayKey) as { lean: string } | undefined;
  const parts = row?.lean.split(",") ?? [];
  const ok = parts.length === 2 && parts.every((p) => (LEANS as readonly string[]).includes(p));
  return ok ? [parts[0] as Lean, parts[1] as Lean] : undefined;
}

/** Today's key. `hour` is always the live band; the rest is fixed for the brain-day. Never throws. */
export function computeFlavor(h: DbHandle, spaceId: string, nowMs: number = Date.now()): { on: boolean; key: FlavorKey } {
  const now = new Date(nowMs);
  try {
    if (!getFlavorOn(h, spaceId)) return { on: false, key: neutralFlavor(now) };
    const tz = spaceTimezone(h.sqlite, spaceId);
    const dayKey = localDateKey(tz, nowMs);
    const { society } = computeSociety(h, spaceId, nowMs);
    const today = h.sqlite.prepare(`SELECT lean FROM story_flavor_day WHERE space_id = ? AND day_key = ?`).get(spaceId, dayKey) as { lean: string } | undefined;
    const prev = today ? (today.lean.split(",") as [Lean, Lean]) : previousLean(h, spaceId, dayKey);
    const key = flavorKey({ currents: society.currents, confidence: society.reflects ? society.confidence : 0, counts: playCounts(h, spaceId, nowMs), prevLean: prev, brainId: spaceId, dayKey, now });
    // The leaning is fixed for the day (first computation wins), so a busy afternoon cannot tilt the morning's voice.
    if (today && today.lean.split(",").length === 2) key.lean = today.lean.split(",") as [Lean, Lean];
    else h.sqlite.prepare(`INSERT OR IGNORE INTO story_flavor_day (space_id, day_key, lean, computed_at) VALUES (?, ?, ?, ?)`).run(spaceId, dayKey, key.lean.join(","), now.toISOString());
    key.hour = hourBand(now);
    return { on: true, key };
  } catch {
    return { on: false, key: neutralFlavor(now) };
  }
}
