import { createDb } from "../../db/client.js";
import { TravelRepo } from "../../repositories/travel.repo.js";
import { StoryRepo } from "../../story/story.js";
import { RoadsRepo } from "../../story/roads.js";
import { playCounts } from "../../story/flavor.js";
import { setPreference } from "../../agent/notify/policy.js";

/**
 * Rollback evidence for Phase 1 (docs/specs/unified-discovery-architecture-2026-10-31.md §15, A6). `prepareMigratedDb` is run by the CURRENT code to make a database that carries the
 * new trust columns with every kind of row; `runOps` is then run by the PRE-Phase-1 code (a git worktree of the pinned baseline) and by the current code on a copy, and the
 * outputs must match — i.e. a previous release can still open and use the migrated volume. Public APIs only; nothing here imports from discovery/.
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const T0 = Date.parse("2026-10-30T07:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

export function prepareMigratedDb(file: string): void {
  const h = createDb(file);
  h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('a')`).run();
  setPreference(h.sqlite, "a", "timezone", "UTC");
  h.sqlite
    .prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline, departed_at, arrived_at, ended_at)
       VALUES ('rb-j1','a','rb-k1','drift','home','great-station','arrived',0,?,?,?,?,?)`,
    )
    .run(iso(T0 - 2 * 86_400_000), iso(T0 - 2 * 86_400_000), iso(T0 - 2 * 86_400_000), iso(T0 - 2 * 86_400_000), iso(T0 - 2 * 86_400_000));
  // Written by the new code: accepted / live:v1.
  new StoryRepo(h, "a").find("relic.harbor-nail", "relic", T0);
  // A legacy row (NULL trust) and an imported row, as the later phases will leave them.
  h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('a','sight.second-seam','2026-10-01T00:00:00.000Z','regard')`).run();
  h.sqlite
    .prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source, trust, trust_at, trust_basis) VALUES ('a','relic.mooring-ring','2026-10-02T00:00:00.000Z','import','imported','2026-10-02T00:00:00.000Z','client-report')`)
    .run();
  h.sqlite.close();
}

const attempt = (fn: () => unknown): Json => {
  try {
    return { ok: (fn() ?? null) as Json };
  } catch (e) {
    return { err: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
  }
};

/** Opens the volume with whichever code is running and uses it the way the app does: reads, gates, a replay, a new find, a recall, a road. */
export function runOps(file: string): Json {
  const h = createDb(file);
  const story = new StoryRepo(h, "a");
  const out: Record<string, Json> = {};
  out.bookBefore = story.book().finds.map((f) => ({ entryId: f.entryId, foundAt: f.foundAt, source: f.source, recallCount: f.recallCount })) as Json;
  const t = new TravelRepo(h, "a");
  const state = t.getState(T0);
  out.gates = { ward: state.wardGateOpen, road: state.roadGateOpen, village: state.villageGateOpen, folded: state.foldedLetterGateOpen, eternity: state.eternityReachable };
  out.replay = attempt(() => story.find("relic.harbor-nail", "relic", T0 + 1000));
  out.replayLegacy = attempt(() => story.find("sight.second-seam", "regard", T0 + 1000));
  out.newFind = attempt(() => story.find("companion.dock-1", "companion", T0 + 2000));
  out.recall = attempt(() => story.recall("relic.harbor-nail", T0 + 3000));
  out.road = attempt(() => {
    const r = new RoadsRepo(h, "a").set("road.door-closed", "taken");
    return { roadId: r.roadId, state: r.state };
  });
  out.counts = playCounts(h, "a", T0) as unknown as Json;
  out.bookAfter = story.book().finds.map((f) => ({ entryId: f.entryId, foundAt: f.foundAt, source: f.source, lastRecalledAt: f.lastRecalledAt, recallCount: f.recallCount })) as Json;
  h.sqlite.close();
  return out;
}
