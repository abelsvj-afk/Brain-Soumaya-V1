import { createDb, type DbHandle } from "../../db/client.js";
import { TravelRepo, TravelError } from "../../repositories/travel.repo.js";
import { StoryRepo, StoryError } from "../../story/story.js";
import { RoadsRepo } from "../../story/roads.js";
import { computeFlavor, playCounts } from "../../story/flavor.js";
import { setPreference } from "../../agent/notify/policy.js";
import { STORY_ENTRIES, STORY_ROADS, STORY_TRIGGERS, STORY_WORLD_GATES } from "@brain/shared";

/**
 * The Phase 1 parity fixtures (docs/specs/unified-discovery-architecture-2026-10-31.md §15, P1-PAR).
 *
 * This file is run TWICE: once by scripts/discovery-golden.mjs inside a git worktree of the pinned baseline commit (the OLD code, to produce the golden file), and once by the
 * parity test against the CURRENT code. It therefore uses only public APIs that exist at both commits (StoryRepo, TravelRepo, RoadsRepo, playCounts/computeFlavor), and it must
 * never import anything from `discovery/` — a test asserts that. Rows are inserted in the legacy shape (no trust columns), exactly as the existing tests do.
 *
 * Everything is deterministic: fixed clock, fixed space ids, no random ids in the output.
 */

const T0 = Date.parse("2026-10-30T07:00:00.000Z");
const DAY = 86_400_000;
const SPACE = "a";
const OTHER = "b";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isoAt = (ms: number) => new Date(ms).toISOString();

function mkDb(): DbHandle {
  const h = createDb(":memory:");
  for (const sp of [SPACE, OTHER]) {
    h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(sp);
    setPreference(h.sqlite, sp, "timezone", "UTC");
  }
  return h;
}

/** A legacy-shaped row: (space_id, entry_id, found_at, source) only. */
function legacyRow(h: DbHandle, space: string, entryId: string, source: string, foundAtMs: number = T0 - 10 * DAY): void {
  h.sqlite.prepare(`INSERT OR IGNORE INTO story_finds (space_id, entry_id, found_at, source) VALUES (?, ?, ?, ?)`).run(space, entryId, isoAt(foundAtMs), source);
}

/** Put the ship in a world through the ledger shape the real code writes (an arrived journey), without going through a gate. */
let journeySeq = 0;
function placeShip(h: DbHandle, world: string, space: string = SPACE, at: number = T0 - 2 * DAY): void {
  journeySeq += 1;
  h.sqlite
    .prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline, departed_at, arrived_at, ended_at)
       VALUES (?, ?, ?, 'drift', 'home', ?, 'arrived', 0, ?, ?, ?, ?, ?)`,
    )
    .run(`parity-j-${journeySeq}`, space, `parity-k-${journeySeq}`, world, isoAt(at), isoAt(at), isoAt(at), isoAt(at), isoAt(at));
}

function describeError(e: unknown): Json {
  if (e instanceof TravelError) return { err: "TravelError", code: e.code };
  if (e instanceof StoryError) return { err: "StoryError", status: e.status, message: e.message };
  return { err: "Error", message: e instanceof Error ? e.message : String(e) };
}

function attempt<T>(fn: () => T): Json {
  try {
    return { ok: (fn() ?? null) as unknown as Json };
  } catch (e) {
    return describeError(e);
  }
}

const dumpRows = (h: DbHandle): Json =>
  h.sqlite
    .prepare(`SELECT space_id, entry_id, found_at, source, last_recalled_at, recall_count FROM story_finds ORDER BY space_id, entry_id`)
    .all() as unknown as Json;

const bookOf = (h: DbHandle, space: string): Json =>
  new StoryRepo(h, space)
    .book()
    .finds.map((f) => ({ entryId: f.entryId, foundAt: f.foundAt, source: f.source, lastRecalledAt: f.lastRecalledAt, recallCount: f.recallCount })) as unknown as Json;

const GATED_DESTINATIONS = [...Object.keys(STORY_WORLD_GATES), "people", "eternity"];

/** Gate booleans plus a departure verdict for every gated destination (each departure is cancelled so the next one can be tried). */
function gatesOf(h: DbHandle, space: string): Json {
  const t = new TravelRepo(h, space);
  const state = t.getState(T0);
  const flags: Record<string, Json> = {
    peopleGateOpen: state.peopleGateOpen,
    wardGateOpen: state.wardGateOpen,
    roadGateOpen: state.roadGateOpen,
    villageGateOpen: state.villageGateOpen,
    unmadeGateOpen: state.unmadeGateOpen,
    siegeGateOpen: state.siegeGateOpen,
    yardGateOpen: state.yardGateOpen,
    longMorningGateOpen: state.longMorningGateOpen,
    foldedLetterGateOpen: state.foldedLetterGateOpen,
    eternityReachable: state.eternityReachable,
  };
  const verdicts: Record<string, Json> = {};
  let n = 0;
  for (const dest of GATED_DESTINATIONS) {
    n += 1;
    try {
      const j = t.depart({ clientKey: `verdict-${space}-${n}`, kind: "drift", destination: dest }, T0 + n * 1000);
      verdicts[dest] = { ok: j.destination };
      t.cancel(j.id, T0 + n * 1000 + 1);
    } catch (e) {
      verdicts[dest] = describeError(e);
    }
  }
  return { flags, verdicts };
}

function withOwner<T>(spaceId: string, fn: () => T): T {
  const prev = process.env.OWNER_SPACE_IDS;
  process.env.OWNER_SPACE_IDS = spaceId;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OWNER_SPACE_IDS;
    else process.env.OWNER_SPACE_IDS = prev;
  }
}

function snapshot(h: DbHandle): Json {
  return { rows: dumpRows(h), bookA: bookOf(h, SPACE), bookB: bookOf(h, OTHER), gatesA: gatesOf(h, SPACE), gatesB: gatesOf(h, OTHER) };
}

export function runParityFixtures(): Json {
  const out: Record<string, Json> = {};
  const withDb = (name: string, build: (h: DbHandle) => void | Json): void => {
    const h = mkDb();
    try {
      const extra = build(h);
      out[name] = extra === undefined ? snapshot(h) : { ...(snapshot(h) as { [k: string]: Json }), extra };
    } finally {
      h.sqlite.close();
    }
  };

  // 1. An empty brain.
  withDb("empty", () => undefined);

  // 2. Every story gate, every way in: each set satisfied, and each set one entry short. Rows belong to space A only (B must stay shut).
  for (const [world, sets] of Object.entries(STORY_WORLD_GATES)) {
    sets.forEach((set, i) => {
      withDb(`gate:${world}:set${i}:satisfied`, (h) => {
        for (const id of set) legacyRow(h, SPACE, id, "regard");
      });
      if (set.length > 1) {
        withDb(`gate:${world}:set${i}:one-short`, (h) => {
          for (const id of set.slice(0, -1)) legacyRow(h, SPACE, id, "regard");
        });
      }
    });
  }

  // 3. The owner exemption: no rows at all, and the owner flag set for space A only.
  withDb("owner-exempt", (h) => {
    return withOwner(SPACE, () => ({ gatesA: gatesOf(h, SPACE), gatesB: gatesOf(h, OTHER) }));
  });

  // 4. Every source value, unknown ids, and a retired id if the canon has one — the Book must ignore what it does not know.
  withDb("sources-and-unknown-ids", (h) => {
    const sources = ["regard", "listen", "relic", "companion", "npc:calend", "npc:dissenter"];
    STORY_ENTRIES.filter((e) => !e.retired)
      .slice(0, 12)
      .forEach((e, i) => legacyRow(h, SPACE, e.id, sources[i % sources.length]!, T0 - (i + 1) * DAY));
    legacyRow(h, SPACE, "obj.not-in-the-canon", "regard", T0 - 3 * DAY);
    const retired = STORY_ENTRIES.find((e) => e.retired);
    if (retired) legacyRow(h, SPACE, retired.id, "regard", T0 - 4 * DAY);
  });

  // 5. Finds, world by world: every trigger of the world is tried in table order, then again an hour later and a day later (pacing, replays, wrong-world refusals).
  const worlds = [...new Set(STORY_TRIGGERS.map((t) => t.world))];
  for (const world of worlds) {
    withDb(`finds:${world}`, (h) => {
      placeShip(h, world);
      const repo = new StoryRepo(h, SPACE);
      const log: Json[] = [];
      const triggers = STORY_TRIGGERS.filter((t) => t.world === world);
      for (const [label, at] of [["t0", T0], ["+1h", T0 + 3_600_000], ["+1d", T0 + DAY]] as const) {
        for (const t of triggers) {
          const source = t.how === "npc" ? `npc:${t.npc}` : t.how;
          log.push({ at: label, entry: t.entryId, source, result: attempt(() => repo.find(t.entryId, source, at)) });
        }
      }
      // A way the canon does not allow, an unknown source, an unknown id, and a world the ship is not in.
      log.push({ probe: "bad-source", result: attempt(() => repo.find(triggers[0]!.entryId, "telepathy", T0)) });
      log.push({ probe: "unknown-id", result: attempt(() => repo.find("obj.not-in-the-canon", "regard", T0)) });
      log.push({ probe: "wrong-how", result: attempt(() => repo.find(triggers[0]!.entryId, triggers[0]!.how === "regard" ? "listen" : "regard", T0)) });
      return log;
    });
  }
  withDb("finds:at-home", (h) => {
    const repo = new StoryRepo(h, SPACE);
    return STORY_TRIGGERS.slice(0, 6).map((t) => ({ entry: t.entryId, result: attempt(() => repo.find(t.entryId, t.how === "npc" ? `npc:${t.npc}` : t.how, T0)) }));
  });

  // 6. Recall, links and notes (they all depend on "has this brain found it").
  withDb("recall-links-notes", (h) => {
    const [a, b, c] = STORY_ENTRIES.filter((e) => !e.retired).map((e) => e.id);
    legacyRow(h, SPACE, a!, "regard");
    legacyRow(h, SPACE, b!, "regard");
    const repo = new StoryRepo(h, SPACE);
    const log: Json[] = [];
    log.push({ recallFound: attempt(() => repo.recall(a!, T0)) });
    log.push({ recallFoundAgain: attempt(() => repo.recall(a!, T0 + 1000)) });
    log.push({ recallNotFound: attempt(() => repo.recall(c!, T0)) });
    log.push({ link: attempt(() => repo.link(a!, b!, T0)) });
    log.push({ linkNotFound: attempt(() => repo.link(a!, c!, T0)) });
    log.push({ noteFound: attempt(() => repo.setNote(a!, "kept", T0)) });
    log.push({ noteNotFound: attempt(() => repo.setNote(c!, "kept", T0)) });
    log.push({ book: attempt(() => ({ finds: bookOf(h, SPACE), links: repo.book().links.map((l) => ({ a: l.a, b: l.b, lit: l.lit })), notes: repo.book().notes.map((n) => ({ entryId: n.entryId, note: n.note })) })) });
    return log;
  });

  // 7. Roads: with nothing found, then with every FIND the roads name already in the Book.
  withDb("roads:none-found", (h) => {
    const roads = new RoadsRepo(h, SPACE);
    const setTo = (id: string, state: "taken" | "done"): Json => attempt(() => {
      const row = roads.set(id, state); // updatedAt is a wall-clock stamp, so only the road and its state are compared
      return { roadId: row.roadId, state: row.state };
    });
    const log: Json[] = STORY_ROADS.map((r) => ({ road: r.id, done: setTo(r.id, "done"), taken: setTo(r.id, "taken") }));
    log.push({ list: roads.list().map((r) => ({ roadId: r.roadId, state: r.state })) });
    return log;
  });
  withDb("roads:all-finds", (h) => {
    for (const r of STORY_ROADS) for (const s of r.steps) if ("find" in s.signal) legacyRow(h, SPACE, s.signal.find, "regard");
    const roads = new RoadsRepo(h, SPACE);
    const log: Json[] = STORY_ROADS.map((r) => ({ road: r.id, done: attempt(() => { const row = roads.set(r.id, "done"); return { roadId: row.roadId, state: row.state }; }) }));
    log.push({ list: roads.list().map((r) => ({ roadId: r.roadId, state: r.state })) });
    return log;
  });

  // 8. Flavour counts: regard/listen finds inside and outside the 30-day window, and other sources that must not be counted.
  withDb("flavor-counts", (h) => {
    const ids = STORY_ENTRIES.filter((e) => !e.retired).map((e) => e.id);
    const plan: [number, string][] = [[1, "regard"], [2, "listen"], [5, "regard"], [20, "listen"], [29, "regard"], [31, "regard"], [60, "listen"], [3, "relic"], [4, "companion"], [6, "npc:calend"]];
    plan.forEach(([daysAgo, source], i) => legacyRow(h, SPACE, ids[i]!, source, T0 - daysAgo * DAY));
    h.sqlite.prepare(`INSERT OR IGNORE INTO story_links (space_id, a, b, linked_at) VALUES (?, ?, ?, ?)`).run(SPACE, ids[0]!, ids[1]!, isoAt(T0 - 2 * DAY));
    return { counts: playCounts(h, SPACE, T0) as unknown as Json, flavor: computeFlavor(h, SPACE, T0) as unknown as Json };
  });

  return out;
}
