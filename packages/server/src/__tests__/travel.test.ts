import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { EconomyRepo, FUEL_START, WARP_COST } from "../economy.js";
import { TravelRepo, TravelError } from "../repositories/travel.repo.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("rejects off-chart destinations and bad kinds before anything is written", () => {
    const t = travel();
    expect(() => t.depart({ clientKey: "x1", kind: "warp", destination: "narnia" }, T0)).toThrowError(
      TravelError,
    );
    expect(journeyCount()).toBe(0);
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
  function runChild(journeyId: string, action: string, goFile: string, nowMs: number): Promise<ChildResult> {
    return new Promise((resolve, reject) => {
      const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
      const child = fileURLToPath(new URL("./travelRaceChild.mts", import.meta.url));
      execFile(
        process.execPath,
        [cli, child, dbPath, "spaceR", journeyId, action, goFile, String(nowMs)],
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
    const goFile = join(dir, `go-${Math.random().toString(36).slice(2)}`);
    const p1 = runChild(journeyId, actions[0], goFile, nowMs);
    const p2 = runChild(journeyId, actions[1], goFile, nowMs);
    await new Promise((r) => setTimeout(r, 600)); // let both children reach the barrier
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
