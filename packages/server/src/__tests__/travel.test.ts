import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { EconomyRepo, FUEL_START, WARP_COST } from "../economy.js";
import { TravelRepo, TravelError } from "../repositories/travel.repo.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { TravelKind } from "@brain/shared";

/**
 * P2-2 (Worlds Phase 2): the server journey ledger. Acceptance criteria are
 * review 19's four journey-integrity requirements (C1–C4) plus machine
 * legality and current-world derivation. Time is INJECTED everywhere at
 * repo level — no test sleeps, and no client timing is ever trusted.
 * Balances use a small tolerance: EconomyRepo regen accrues on real
 * elapsed time (a few thousandths of a unit during a fast test).
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const past = (deadlineIso: string) => Date.parse(deadlineIso) + 1000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const travel = (space = "spaceA") => new TravelRepo(handle, space);
const econ = (space = "spaceA") => new EconomyRepo(handle, space);
const eventTypes = (t: TravelRepo, id: string) => t.eventsFor(id).map((e) => e.type);
function journeyCount(space = "spaceA"): number {
  return (
    handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = ?`).get(space) as {
      n: number;
    }
  ).n;
}

describe("C1 — the server owns the cancel window", () => {
  it("cancel before the deadline is free and final", () => {
    const t = travel();
    const before = econ().get();
    const j = t.depart({ clientKey: "k1", kind: "warp", destination: "great-station" }, T0);
    expect(j.state).toBe("arming");
    expect(j.cancellable).toBe(true);
    const cancelled = t.cancel(j.id, T0 + 5000);
    expect(cancelled?.state).toBe("cancelled");
    expect(cancelled?.fuelCharged).toBe(0);
    expect(econ().get()).toBeCloseTo(before, 1); // untouched
    expect(eventTypes(t, j.id)).toEqual(["departure_armed", "cancelled"]); // never a departed event
  });

  it("cancel after the deadline reports a departed journey, charged exactly once", () => {
    const t = travel();
    const j = t.depart({ clientKey: "k2", kind: "warp", destination: "great-station" }, T0);
    const before = econ().get();
    const after = t.cancel(j.id, past(j.cancelDeadline));
    expect(after?.state).toBe("in_transit");
    expect(after?.cancellable).toBe(false);
    expect(after?.fuelCharged).toBe(WARP_COST);
    expect(econ().get()).toBeCloseTo(before - WARP_COST, 1);
    expect(eventTypes(t, j.id)).toEqual(["departure_armed", "departed"]);
  });
});

describe("C2 — charge and ledger commit together, or not at all", () => {
  it("a warp that became unpayable collapses to a no-charge cancellation at window close", () => {
    const t = travel();
    const j = t.depart({ clientKey: "k3", kind: "warp", destination: "great-station" }, T0);
    expect(econ().spend(FUEL_START - 5)).toBe(true); // drain to 5 < WARP_COST after arming
    const settled = t.getJourney(j.id, past(j.cancelDeadline));
    expect(settled?.state).toBe("cancelled");
    expect(settled?.fuelCharged).toBe(0);
    expect(econ().get()).toBeCloseTo(5, 1); // untouched by the collapse
    const events = t.eventsFor(j.id);
    expect(events.map((e) => e.type)).toEqual(["departure_armed", "cancelled"]);
    expect(events[1]?.detail?.reason).toBe("insufficient_at_window_close");
  });

  it("competing departures cannot both be admitted (different keys)", () => {
    const t = travel();
    t.depart({ clientKey: "race-1", kind: "warp", destination: "great-station" }, T0);
    expect(() =>
      t.depart({ clientKey: "race-2", kind: "drift", destination: "great-station" }, T0),
    ).toThrowError(TravelError);
    expect(journeyCount()).toBe(1);
  });

  it("the database itself refuses a second active journey (partial unique index)", () => {
    const t = travel();
    t.depart({ clientKey: "idx-1", kind: "warp", destination: "great-station" }, T0);
    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, cancel_deadline)
           VALUES ('raw-2', 'spaceA', 'idx-2', 'drift', 'home', 'great-station', 'arming', '2026-10-22T12:00:10.000Z')`,
        )
        .run(),
    ).toThrow();
    expect(journeyCount()).toBe(1);
  });
});

describe("C3 — every act is idempotent under retries", () => {
  it("a retried departure returns the original journey — even with different parameters", () => {
    const t = travel();
    const first = t.depart({ clientKey: "dup", kind: "warp", destination: "great-station" }, T0);
    const retry = t.depart({ clientKey: "dup", kind: "drift", destination: "home" }, T0 + 1000);
    expect(retry.id).toBe(first.id);
    expect(retry.kind).toBe("warp"); // original intent stands
    expect(retry.destination).toBe("great-station");
    expect(journeyCount()).toBe(1);
    expect(eventTypes(t, first.id)).toEqual(["departure_armed"]);
  });

  it("retried arrivals and cancellations change nothing twice", () => {
    const t = travel();
    const j = t.depart({ clientKey: "dup2", kind: "warp", destination: "great-station" }, T0);
    const arrived = t.arrive(j.id, past(j.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    const again = t.arrive(j.id, past(j.cancelDeadline) + 60_000);
    expect(again?.state).toBe("arrived");
    expect(eventTypes(t, j.id)).toEqual(["departure_armed", "departed", "arrived"]);

    const j2 = t.depart({ clientKey: "dup3", kind: "drift", destination: "home" }, T0);
    t.cancel(j2.id, T0 + 1000);
    const recancel = t.cancel(j2.id, T0 + 2000);
    expect(recancel?.state).toBe("cancelled");
    expect(eventTypes(t, j2.id)).toEqual(["departure_armed", "cancelled"]);
  });

  it("F-01: a same-key retry with INVALID changed parameters returns the original journey", () => {
    const t = travel();
    const first = t.depart({ clientKey: "f01", kind: "warp", destination: "great-station" }, T0);
    const before = econ().get();
    // Invalid kind on the retry — the replay contract wins over validation.
    const badKind = t.depart(
      { clientKey: "f01", kind: "teleport" as TravelKind, destination: "great-station" },
      T0 + 1000,
    );
    expect(badKind.id).toBe(first.id);
    expect(badKind.kind).toBe("warp");
    // Unknown destination on the retry — same rule.
    const badDest = t.depart({ clientKey: "f01", kind: "warp", destination: "nowhere" }, T0 + 2000);
    expect(badDest.id).toBe(first.id);
    expect(badDest.destination).toBe("great-station");
    // No new rows, no new events, no charges.
    expect(journeyCount()).toBe(1);
    expect(eventTypes(t, first.id)).toEqual(["departure_armed"]);
    expect(econ().get()).toBeCloseTo(before, 1);
  });

  it("F-01: fresh requests with invalid parameters are still rejected, without mutation", () => {
    const t = travel();
    expect(() =>
      t.depart({ clientKey: "fresh-bad-kind", kind: "teleport" as TravelKind, destination: "great-station" }, T0),
    ).toThrowError(expect.objectContaining({ code: "INVALID_KIND" }));
    expect(() => t.depart({ clientKey: "fresh-bad-dest", kind: "warp", destination: "nowhere" }, T0)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_DESTINATION" }),
    );
    expect(journeyCount()).toBe(0);
    expect(t.getState(T0).activeJourney).toBeNull();
  });
});

describe("C4 — failure safety", () => {
  it("unknown journeys are invisible; other spaces' journeys are too", () => {
    const a = travel("spaceA");
    const b = travel("spaceB");
    const j = a.depart({ clientKey: "iso", kind: "warp", destination: "great-station" }, T0);
    expect(a.cancel("no-such-id", T0)).toBeNull();
    expect(a.arrive("no-such-id", T0)).toBeNull();
    expect(b.cancel(j.id, T0)).toBeNull();
    expect(b.arrive(j.id, past(j.cancelDeadline))).toBeNull();
    expect(a.getJourney(j.id, T0)?.state).toBe("arming"); // untouched by all of it
  });

  it("arrival before the deadline is rejected — no mutation, no event, no charge", () => {
    const t = travel();
    const before = econ().get();
    const j = t.depart({ clientKey: "early", kind: "warp", destination: "great-station" }, T0);
    expect(() => t.arrive(j.id, T0 + 5000)).toThrowError(TravelError);
    const still = t.getJourney(j.id, T0 + 5000);
    expect(still?.state).toBe("arming");
    expect(econ().get()).toBeCloseTo(before, 1);
    expect(eventTypes(t, j.id)).toEqual(["departure_armed"]);
    // …and the same arrival succeeds once the journey has actually departed.
    expect(t.arrive(j.id, past(j.cancelDeadline))?.state).toBe("arrived");
  });
});

describe("machine legality, drift, and current-world derivation", () => {
  it("derives the world across a full cycle, a cancellation, and a turn-back", () => {
    const t = travel();
    expect(t.currentWorld(T0)).toBe("home");
    const j1 = t.depart({ clientKey: "w1", kind: "warp", destination: "great-station" }, T0);
    t.arrive(j1.id, past(j1.cancelDeadline));
    expect(t.currentWorld(T0)).toBe("great-station");

    const j2 = t.depart({ clientKey: "w2", kind: "warp", destination: "home" }, T0);
    expect(j2.origin).toBe("great-station"); // origin is derived, never client-supplied
    t.cancel(j2.id, T0 + 1000);
    expect(t.currentWorld(T0)).toBe("great-station"); // a cancellation changes nothing

    const j3 = t.depart({ clientKey: "w3", kind: "warp", destination: "home" }, T0);
    const turned = t.turnBack(j3.id, past(j3.cancelDeadline));
    expect(turned?.state).toBe("returning");
    expect(turned?.fuelCharged).toBe(WARP_COST); // no refund
    expect(t.currentWorld(T0)).toBe("great-station"); // still out — home is the origin on return
    const back = t.arrive(j3.id, past(j3.cancelDeadline) + 30_000);
    expect(back?.state).toBe("returned");
    expect(t.currentWorld(T0)).toBe("great-station");
    expect(eventTypes(t, j3.id)).toEqual(["departure_armed", "departed", "turned_back", "returned"]);
  });

  it("drift runs the whole lifecycle at zero charge", () => {
    const t = travel();
    const before = econ().get();
    const j = t.depart({ clientKey: "d1", kind: "drift", destination: "great-station" }, T0);
    const arrived = t.arrive(j.id, past(j.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    expect(arrived?.fuelCharged).toBe(0);
    expect(econ().get()).toBeCloseTo(before, 1);
    const departed = t.eventsFor(j.id).find((e) => e.type === "departed");
    expect(departed?.detail?.fuelCharged).toBe(0);
  });

  it("admits the Growing Place (P3-1): warp there and back, same ledger", () => {
    const t = travel();
    const out = t.depart({ clientKey: "gp-1", kind: "warp", destination: "growing-place" }, T0);
    expect(out.destination).toBe("growing-place");
    const arrived = t.arrive(out.id, past(out.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("growing-place");
    const home = t.depart({ clientKey: "gp-2", kind: "drift", destination: "home" }, T0);
    const back = t.arrive(home.id, past(home.cancelDeadline));
    expect(back?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("home");
  });

  it("admits the Deep Past (P3-2): warp there and back, same ledger", () => {
    const t = travel();
    const out = t.depart({ clientKey: "dp-1", kind: "warp", destination: "deep-past" }, T0);
    expect(out.destination).toBe("deep-past");
    const arrived = t.arrive(out.id, past(out.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("deep-past");
    const home = t.depart({ clientKey: "dp-2", kind: "drift", destination: "home" }, T0);
    const back = t.arrive(home.id, past(home.cancelDeadline));
    expect(back?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("home");
  });

  it("rejects off-chart destinations and bad kinds before anything is written", () => {
    const t = travel();
    expect(() => t.depart({ clientKey: "x1", kind: "warp", destination: "narnia" }, T0)).toThrowError(
      TravelError,
    );
    expect(journeyCount()).toBe(0);
  });

  it("admits People (P3-3) once the gate is open: warp there and back, same ledger", () => {
    const t = travel();
    seedPeopleGate(handle, "spaceA");
    expect(t.peopleGateOpen()).toBe(true);
    const out = t.depart({ clientKey: "pp-1", kind: "warp", destination: "people" }, T0);
    expect(out.destination).toBe("people");
    const arrived = t.arrive(out.id, past(out.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("people");
    const home = t.depart({ clientKey: "pp-2", kind: "drift", destination: "home" }, T0);
    const back = t.arrive(home.id, past(home.cancelDeadline));
    expect(back?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("home");
  });
});

describe("two connections, one file (the concurrency proof)", () => {
  let dir: string;
  let h1: DbHandle;
  let h2: DbHandle;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "travel-race-"));
    const path = join(dir, "brain.db");
    h1 = createDb(path);
    h2 = createDb(path);
  });
  afterAll(() => {
    h1.sqlite.close();
    h2.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a second connection's admission sees the first's committed journey and refuses", () => {
    const a = new TravelRepo(h1, "spaceA");
    const b = new TravelRepo(h2, "spaceA");
    a.depart({ clientKey: "conn-1", kind: "warp", destination: "great-station" }, T0);
    expect(() => b.depart({ clientKey: "conn-2", kind: "warp", destination: "great-station" }, T0)).toThrowError(
      TravelError,
    );
    const rows = h2.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = 'spaceA'`)
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe("concurrent transitions across two processes (review 22)", () => {
  let dir: string;
  let dbPath: string;
  let h: DbHandle;

  interface ChildResult {
    ok: boolean;
    state?: string | null;
    error?: string;
  }
  function runChild(
    journeyId: string,
    action: string,
    goFile: string,
    readyFile: string,
    nowMs: number,
  ): Promise<ChildResult> {
    return new Promise((resolve, reject) => {
      const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
      const child = fileURLToPath(new URL("./travelRaceChild.mts", import.meta.url));
      execFile(
        process.execPath,
        [cli, child, dbPath, "spaceR", journeyId, action, goFile, readyFile, String(nowMs)],
        (err, stdout) => {
          if (err) return reject(err);
          const last = stdout.trim().split("\n").pop() ?? "";
          try {
            resolve(JSON.parse(last) as ChildResult);
          } catch {
            reject(new Error(`unparseable child output: ${stdout}`));
          }
        },
      );
    });
  }
  async function race(
    journeyId: string,
    actions: [string, string],
    nowMs: number,
  ): Promise<[ChildResult, ChildResult]> {
    const tag = Math.random().toString(36).slice(2);
    const goFile = join(dir, `go-${tag}`);
    const ready1 = join(dir, `ready-${tag}-1`);
    const ready2 = join(dir, `ready-${tag}-2`);
    const p1 = runChild(journeyId, actions[0], goFile, ready1, nowMs);
    const p2 = runChild(journeyId, actions[1], goFile, ready2, nowMs);
    // Deterministic barrier (review 23): release only once BOTH children
    // have signalled they are waiting — no fixed sleep.
    const deadline = Date.now() + 20_000;
    while (!(existsSync(ready1) && existsSync(ready2))) {
      if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
      await new Promise((r) => setTimeout(r, 25));
    }
    writeFileSync(goFile, "go");
    return Promise.all([p1, p2]);
  }
  function inTransitJourney(key: string): { repo: TravelRepo; id: string; deadline: string } {
    const repo = new TravelRepo(h, "spaceR");
    const j = repo.depart({ clientKey: key, kind: "warp", destination: "great-station" }, T0);
    const settled = repo.getJourney(j.id, past(j.cancelDeadline));
    expect(settled?.state).toBe("in_transit");
    return { repo, id: j.id, deadline: j.cancelDeadline };
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "travel-race2-"));
    dbPath = join(dir, "brain.db");
    h = createDb(dbPath);
  });
  afterAll(() => {
    h.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("duplicate arrivals: exactly one arrived event, both callers see the committed state", async () => {
    const { repo, id, deadline } = inTransitJourney("race-arrive");
    const [r1, r2] = await race(id, ["arrive", "arrive"], past(deadline) + 60_000);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.state).toBe("arrived");
    expect(r2.state).toBe("arrived"); // the loser returns the actual committed state
    expect(eventTypes(repo, id)).toEqual(["departure_armed", "departed", "arrived"]);
    expect(repo.getJourney(id, past(deadline) + 120_000)?.state).toBe("arrived");
  }, 60_000);

  it("arrival vs turn-back: exactly one legal chain, never both transitions", async () => {
    const { repo, id, deadline } = inTransitJourney("race-mixed");
    const [r1, r2] = await race(id, ["arrive", "turnBack"], past(deadline) + 60_000);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const types = eventTypes(repo, id);
    const chains = [
      ["departure_armed", "departed", "arrived"], // arrival won outright
      ["departure_armed", "departed", "turned_back", "returned"], // turn-back won; arrival completed the return
    ];
    expect(chains).toContainEqual(types);
    const final = repo.getJourney(id, past(deadline) + 120_000);
    expect(final?.state).toBe(types[types.length - 1] === "arrived" ? "arrived" : "returned");
  }, 60_000);

  it("cross-connection sequential retry still yields one arrival", () => {
    // Own space (own fuel tank): the race tests above already spent spaceR's.
    const a = new TravelRepo(h, "spaceX");
    const j = a.depart({ clientKey: "xconn", kind: "warp", destination: "great-station" }, T0);
    const b = new TravelRepo(h, "spaceX");
    expect(b.arrive(j.id, past(j.cancelDeadline))?.state).toBe("arrived");
    expect(a.arrive(j.id, past(j.cancelDeadline) + 1000)?.state).toBe("arrived");
    expect(eventTypes(a, j.id)).toEqual(["departure_armed", "departed", "arrived"]);
  });
});

describe("legacy upgrade path (audit evidence)", () => {
  it("an existing database WITHOUT the travel tables gains them on open — data intact, travel works", () => {
    const dir = mkdtempSync(join(tmpdir(), "travel-legacy-"));
    const dbPath = join(dir, "brain.db");
    try {
      // 1. A pre-P2-2 volume: full app schema, some real data, then the
      //    travel tables dropped to simulate a database from before P2-2.
      const h1 = createDb(dbPath);
      const fuelBefore = new EconomyRepo(h1, "legacySpace").get();
      h1.sqlite.exec(`DROP TABLE travel_journey_events; DROP TABLE travel_journeys;`);
      const gone = h1.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'travel_journeys'`)
        .get();
      expect(gone).toBeUndefined();
      h1.sqlite.close();

      // 2. Reopen through the normal entry point: the upgrade path
      //    (bootstrap + migrateSchema, both IF NOT EXISTS) must restore
      //    the tables AND the partial unique index, without touching the
      //    data that was already there.
      const h2 = createDb(dbPath);
      const table = h2.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'travel_journeys'`)
        .get() as { name: string } | undefined;
      expect(table?.name).toBe("travel_journeys");
      const index = h2.sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'travel_journeys_one_active'`)
        .get() as { name: string } | undefined;
      expect(index?.name).toBe("travel_journeys_one_active");
      expect(new EconomyRepo(h2, "legacySpace").get()).toBeCloseTo(fuelBefore, 1);

      // 3. And the restored schema actually works end to end.
      const repo = new TravelRepo(h2, "legacySpace");
      const j = repo.depart({ clientKey: "legacy-1", kind: "drift", destination: "great-station" }, T0);
      expect(repo.arrive(j.id, past(j.cancelDeadline))?.state).toBe("arrived");
      h2.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("HTTP contract", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  let space2: string;

  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }),
    });
    return ((await res.json()) as { id: string }).id;
  }
  async function post(path: string, space: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": space },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  beforeAll(async () => {
    ctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    spaceId = await auth("travel-tester");
    space2 = await auth("travel-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("depart → state → early arrive rejected (forged timing ignored) → cancel", async () => {
    const dep = await post("/api/travel/depart", spaceId, {
      clientKey: "http-1",
      kind: "warp",
      destination: "great-station",
    });
    expect(dep.status).toBe(200);
    expect(dep.body.journey.state).toBe("arming");
    const journeyId = dep.body.journey.id as string;

    const stateRes = await fetch(`${base}/api/travel/state`, { headers: { "x-space-id": spaceId } });
    const state = (await stateRes.json()) as any;
    expect(state.currentWorld).toBe("home");
    expect(state.activeJourney.id).toBe(journeyId);
    expect(state.fuel.warpCost).toBe(WARP_COST);

    // Forged client timing must not move the server's window: still arming.
    const early = await post("/api/travel/arrive", spaceId, { journeyId, at: "2999-01-01T00:00:00.000Z" });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("JOURNEY_NOT_DEPARTED");

    const other = await post("/api/travel/cancel", space2, { journeyId });
    expect(other.status).toBe(404); // another space's journey is invisible

    const cancel = await post("/api/travel/cancel", spaceId, { journeyId });
    expect(cancel.status).toBe(200);
    expect(cancel.body.journey.state).toBe("cancelled");
  });

  it("off-chart destinations are a 400, and a second active departure is a 409", async () => {
    const bad = await post("/api/travel/depart", spaceId, {
      clientKey: "http-2",
      kind: "warp",
      destination: "narnia",
    });
    expect(bad.status).toBe(400);
    const ok = await post("/api/travel/depart", spaceId, {
      clientKey: "http-3",
      kind: "drift",
      destination: "great-station",
    });
    expect(ok.status).toBe(200);
    const clash = await post("/api/travel/depart", spaceId, {
      clientKey: "http-4",
      kind: "drift",
      destination: "home",
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("ACTIVE_JOURNEY_EXISTS");
  });
});

/**
 * The People gate (P3-3, Q1): the server — never the client — decides
 * whether People is open. The threshold: ≥3 people with ≥2 linked
 * memories each, plus ≥1 memory shared between two people.
 */
function seedPerson(h: DbHandle, space: string, id: number, over: Record<string, unknown> = {}): void {
  h.sqlite
    .prepare(
      `INSERT INTO nodes (id, space_id, label, type, content, importance, status, kind)
       VALUES (?, ?, ?, ?, ?, 0.5, ?, ?)`,
    )
    .run(
      id,
      space,
      over.label ?? `Person ${id}`,
      (over.type as string) ?? "daily",
      (over.label as string) ?? `Person ${id}`,
      (over.status as string) ?? "active",
      over.kind === undefined ? "person_entity" : (over.kind as string | null),
    );
}
function seedMemory(h: DbHandle, space: string, id: number): void {
  h.sqlite
    .prepare(`INSERT INTO nodes (id, space_id, label, type, content, importance, status) VALUES (?, ?, ?, 'daily', ?, 0.5, 'active')`)
    .run(id, space, `Memory ${id}`, `Memory ${id}`);
}
function seedLink(h: DbHandle, space: string, source: number, target: number, relationship = "relates_to"): void {
  h.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`)
    .run(space, source, target, relationship);
}
/** The minimal open gate: 3 people × 2 memories, one memory shared by two of them. */
function seedPeopleGate(h: DbHandle, space: string): void {
  seedPerson(h, space, 1);
  seedPerson(h, space, 2);
  seedPerson(h, space, 3);
  for (const id of [10, 11, 12, 13, 14, 15]) seedMemory(h, space, id);
  seedLink(h, space, 10, 1);
  seedLink(h, space, 11, 1);
  seedLink(h, space, 12, 2);
  seedLink(h, space, 13, 2);
  seedLink(h, space, 14, 3);
  seedLink(h, space, 15, 3);
  seedLink(h, space, 15, 1); // memory 15 is shared between persons 1 and 3
}

describe("C9 — the People gate (P3-3, Q1, server-enforced)", () => {
  it("closed on an empty brain — a departure to People is refused, nothing is written", () => {
    const t = travel();
    expect(t.peopleGateOpen()).toBe(false);
    expect(t.getState(T0).peopleGateOpen).toBe(false);
    let code: string | undefined;
    try {
      t.depart({ clientKey: "pg-1", kind: "warp", destination: "people" }, T0);
    } catch (e) {
      expect(e).toBeInstanceOf(TravelError);
      code = (e as TravelError).code;
    }
    expect(code).toBe("PEOPLE_GATE_CLOSED");
    expect(journeyCount()).toBe(0);
  });

  it("open at the threshold: 3 people × 2 memories + 1 shared memory", () => {
    const t = travel();
    seedPeopleGate(handle, "spaceA");
    expect(t.peopleGateOpen()).toBe(true);
    expect(t.getState(T0).peopleGateOpen).toBe(true);
  });

  it("closed with only two qualifying people, however many memories they hold", () => {
    const t = travel();
    seedPerson(handle, "spaceA", 1);
    seedPerson(handle, "spaceA", 2);
    for (const id of [10, 11, 12, 13, 14]) seedMemory(handle, "spaceA", id);
    seedLink(handle, "spaceA", 10, 1);
    seedLink(handle, "spaceA", 11, 1);
    seedLink(handle, "spaceA", 12, 1);
    seedLink(handle, "spaceA", 13, 2);
    seedLink(handle, "spaceA", 14, 2);
    seedLink(handle, "spaceA", 14, 1); // shared, but only two people qualify
    expect(t.peopleGateOpen()).toBe(false);
  });

  it("closed with three people but no memory shared between two of them", () => {
    const t = travel();
    seedPerson(handle, "spaceA", 1);
    seedPerson(handle, "spaceA", 2);
    seedPerson(handle, "spaceA", 3);
    for (const id of [10, 11, 12, 13, 14, 15]) seedMemory(handle, "spaceA", id);
    seedLink(handle, "spaceA", 10, 1);
    seedLink(handle, "spaceA", 11, 1);
    seedLink(handle, "spaceA", 12, 2);
    seedLink(handle, "spaceA", 13, 2);
    seedLink(handle, "spaceA", 14, 3);
    seedLink(handle, "spaceA", 15, 3);
    expect(t.peopleGateOpen()).toBe(false);
  });

  it("a person with only one linked memory does not qualify toward the three", () => {
    const t = travel();
    seedPeopleGate(handle, "spaceA");
    // Person 3 keeps only one memory: remove its link to 14.
    handle.sqlite.prepare(`DELETE FROM edges WHERE space_id = ? AND source = 14 AND target = 3`).run("spaceA");
    expect(t.peopleGateOpen()).toBe(false);
  });

  it("an archived person never counts — even with linked memories", () => {
    const t = travel();
    seedPeopleGate(handle, "spaceA");
    handle.sqlite.prepare(`UPDATE nodes SET status = 'archived' WHERE space_id = ? AND id = 3`).run("spaceA");
    expect(t.peopleGateOpen()).toBe(false);
  });

  it("a person linked only to another person has no linked memory", () => {
    const t = travel();
    seedPerson(handle, "spaceA", 1);
    seedPerson(handle, "spaceA", 2);
    seedPerson(handle, "spaceA", 3);
    seedLink(handle, "spaceA", 1, 2);
    seedLink(handle, "spaceA", 2, 3);
    expect(t.peopleGateOpen()).toBe(false);
  });

  it("an extraction-typed person node counts, and so does the legacy alias", () => {
    const t = travel();
    seedPerson(handle, "spaceA", 1, { kind: null, type: "person" });
    seedPerson(handle, "spaceA", 2, { kind: null, type: "relationship_reflection" });
    seedPerson(handle, "spaceA", 3);
    for (const id of [10, 11, 12, 13, 14, 15]) seedMemory(handle, "spaceA", id);
    seedLink(handle, "spaceA", 10, 1);
    seedLink(handle, "spaceA", 11, 1);
    seedLink(handle, "spaceA", 12, 2);
    seedLink(handle, "spaceA", 13, 2);
    seedLink(handle, "spaceA", 14, 3);
    seedLink(handle, "spaceA", 15, 3);
    seedLink(handle, "spaceA", 15, 1);
    expect(t.peopleGateOpen()).toBe(true);
  });

  it("the gate is space-scoped: another space's people do not open this space's gate", () => {
    seedPeopleGate(handle, "spaceB");
    expect(travel("spaceA").peopleGateOpen()).toBe(false);
    expect(travel("spaceB").peopleGateOpen()).toBe(true);
  });
});

describe("Eternity's gate (B-01): key + two relics, then a three-leg chain", () => {
  const HOLDINGS = () => ({ witnessWithoutName: true, otherRelicCount: 2 });
  const travelWithHoldings = (space = "spaceA") => new TravelRepo(handle, space, HOLDINGS);
  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return (e as TravelError).code;
    }
    return "NO_ERROR";
  };
  /** Warp to a destination and arrive — one leg of a chain. */
  function warpTo(t: TravelRepo, key: string, dest: string, at: number): void {
    const j = t.depart({ clientKey: key, kind: "warp", destination: dest }, at);
    const arrived = t.arrive(j.id, past(j.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
  }
  /** Drift to a destination and arrive — a free leg of a chain. */
  function driftTo(t: TravelRepo, key: string, dest: string, at: number): void {
    const j = t.depart({ clientKey: key, kind: "drift", destination: dest }, at);
    const arrived = t.arrive(j.id, past(j.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
  }

  it("no relics, no way in: the gate refuses and nothing is written", () => {
    const t = travel();
    expect(codeOf(() => t.depart({ clientKey: "e1", kind: "warp", destination: "eternity" }, T0))).toBe(
      "ETERNITY_GATE_CLOSED",
    );
    expect(journeyCount()).toBe(0);
    expect(t.getState(T0).eternityReachable).toBe(false);
  });

  it("the key and two relics open the gate — but not from home: the chain refuses", () => {
    const t = travelWithHoldings();
    expect(t.getState(T0).eternityReachable).toBe(true);
    expect(codeOf(() => t.depart({ clientKey: "e2", kind: "warp", destination: "eternity" }, T0))).toBe(
      "ETERNITY_CHAIN_REQUIRED",
    );
    expect(journeyCount()).toBe(0);
  });

  it("one intermediate is not a chain — and repeating the same world does not count twice", () => {
    const t = travelWithHoldings();
    warpTo(t, "e3a", "great-station", T0);
    expect(codeOf(() => t.depart({ clientKey: "e3b", kind: "warp", destination: "eternity" }, T0))).toBe(
      "ETERNITY_CHAIN_REQUIRED",
    );
    warpTo(t, "e3c", "great-station", T0 + 60_000);
    expect(codeOf(() => t.depart({ clientKey: "e3d", kind: "warp", destination: "eternity" }, T0))).toBe(
      "ETERNITY_CHAIN_REQUIRED",
    );
  });

  it("the full chain admits: home → station → garden → eternity", () => {
    const t = travelWithHoldings();
    warpTo(t, "e4a", "great-station", T0);
    warpTo(t, "e4b", "growing-place", T0 + 60_000);
    const j = t.depart({ clientKey: "e4c", kind: "warp", destination: "eternity" }, T0 + 120_000);
    expect(j.state).toBe("arming");
    expect(j.origin).toBe("growing-place");
    const arrived = t.arrive(j.id, past(j.cancelDeadline));
    expect(arrived?.state).toBe("arrived");
    expect(t.currentWorld(T0)).toBe("eternity");
  });

  it("a turn-back breaks the chain: only arrived legs count", () => {
    const t = travelWithHoldings();
    warpTo(t, "e5a", "great-station", T0);
    const out = t.depart({ clientKey: "e5b", kind: "warp", destination: "growing-place" }, T0);
    const turned = t.turnBack(out.id, past(out.cancelDeadline));
    expect(turned?.state).toBe("returning");
    const back = t.arrive(out.id, past(out.cancelDeadline) + 30_000);
    expect(back?.state).toBe("returned");
    expect(t.currentWorld(T0)).toBe("great-station");
    expect(codeOf(() => t.depart({ clientKey: "e5c", kind: "warp", destination: "eternity" }, T0))).toBe(
      "ETERNITY_CHAIN_REQUIRED",
    );
  });

  it("once opened, the gate stays open: a later chain admits with no holdings", () => {
    const t = travelWithHoldings();
    warpTo(t, "e6a", "great-station", T0);
    warpTo(t, "e6b", "growing-place", T0 + 60_000);
    warpTo(t, "e6c", "eternity", T0 + 120_000);
    expect(t.currentWorld(T0)).toBe("eternity");
    // Drift home (free), then walk the chain again — this time the
    // repo holds nothing, and the ledger itself remembers the opening.
    const home = t.depart({ clientKey: "e6d", kind: "drift", destination: "home" }, T0 + 180_000);
    expect(t.arrive(home.id, past(home.cancelDeadline))?.state).toBe("arrived");
    const plain = travel();
    expect(plain.getState(T0).eternityReachable).toBe(true);
    // The second chain drifts (free legs still count — fuel buys
    // speed, never access; five net −5 warps would drain the 25
    // starting fuel before the chain completes).
    driftTo(plain, "e6e", "great-station", T0 + 240_000);
    driftTo(plain, "e6f", "growing-place", T0 + 300_000);
    const again = plain.depart({ clientKey: "e6g", kind: "warp", destination: "eternity" }, T0 + 360_000);
    expect(again.state).toBe("arming");
  });

  it("the key alone, or two others without the key, does not open the gate", () => {
    const keyOnly = new TravelRepo(handle, "spaceA", () => ({ witnessWithoutName: true, otherRelicCount: 0 }));
    expect(keyOnly.getState(T0).eternityReachable).toBe(false);
    const othersOnly = new TravelRepo(handle, "spaceA", () => ({
      witnessWithoutName: false,
      otherRelicCount: 5,
    }));
    expect(othersOnly.getState(T0).eternityReachable).toBe(false);
  });
});
