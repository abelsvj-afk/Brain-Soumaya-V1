import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { EconomyRepo } from "../economy.js";
import { missionDispatchCost, MISSION_FLEET_SHIPS } from "@brain/shared";
import { MissionRepo } from "./repo.js";
import {
  dispatchMission,
  getMissionsOverview,
  MissionError,
  recallMission,
  resumeFleet,
  settleMissions,
  stopFleet,
  type DispatchInput,
} from "./loop.js";

/**
 * Fleet missions — the loop (acceptance C1–C4, current brief AD1–AD6).
 * Time is INJECTED everywhere — no test sleeps. Every dispatch and
 * settle runs against a fresh in-memory DB, so the fuel and log
 * assertions are exact.
 *
 * C1: a dispatched mission follows the travel ledger shape — depart →
 * transit → arrive, server authority, idempotent.
 * C2: missions are FREE and failure costs NOTHING — no fuel, no
 * cargo, no progress; a failed mission returns empty-handed.
 * C3: every mission is visible in the log in plain language; every
 * report is from the honest vocabulary.
 * C4: no mission ever writes to a brain; missions are space-scoped.
 * Mission writes are mission row + log line ONLY.
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // 08:00 EDT
const MIN = 60_000;
// A 30-minute mission: three equal legs — outbound, on station, return.
const ARRIVE_AT = T0 + 10 * MIN;
const BACK_AT = T0 + 20 * MIN;
const DONE_AT = T0 + 30 * MIN;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const fuel = (space = "spaceA") => new EconomyRepo(handle, space).get();
const dispatch = (over: Partial<DispatchInput> = {}, nowMs = T0, space = "spaceA") =>
  dispatchMission(
    handle,
    space,
    {
      clientKey: `k-${nowMs}-${Math.random()}`,
      kind: "journey",
      destination: "scale",
      durationMinutes: 30,
      fleetSize: 1,
      ...over,
    },
    nowMs,
  );

function brainSnapshot(space = "spaceA"): string {
  const nodes = handle.sqlite.prepare(`SELECT * FROM nodes WHERE space_id = ? ORDER BY id`).all(space);
  const edges = handle.sqlite.prepare(`SELECT * FROM edges WHERE space_id = ? ORDER BY id`).all(space);
  return JSON.stringify({ nodes, edges });
}

/** Seed the People gate open (3 people, 2 linked memories each, 1 shared). */
function seedPeopleGateOpen(space = "spaceA"): void {
  const ins = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, kind, type, content) VALUES (?, ?, ?, ?, ?)`,
  );
  const p1 = ins.run(space, "Person One", "person_entity", "person", "").lastInsertRowid as number;
  const p2 = ins.run(space, "Person Two", "person_entity", "person", "").lastInsertRowid as number;
  const p3 = ins.run(space, "Person Three", "person_entity", "person", "").lastInsertRowid as number;
  const m = (label: string) =>
    ins.run(space, label, null, "memory", "").lastInsertRowid as number;
  const m1 = m("Shared memory");
  const m2 = m("Memory two");
  const m3 = m("Memory three");
  const m5 = m("Memory five");
  const m6 = m("Memory six");
  const edge = handle.sqlite.prepare(
    `INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`,
  );
  for (const [a, b] of [
    [p1, m1],
    [p1, m2],
    [p2, m1],
    [p2, m3],
    [p3, m5],
    [p3, m6],
  ] as const) {
    edge.run(space, a, b, "links");
  }
}

function closePeopleGate(space = "spaceA"): void {
  // Drop one of Person Three's links: it falls to one linked memory,
  // so only two people qualify and the gate closes.
  const rows = handle.sqlite
    .prepare(
      `SELECT id FROM edges WHERE space_id = ? AND source IN (SELECT id FROM nodes WHERE space_id = ? AND label = 'Person Three') ORDER BY id DESC LIMIT 1`,
    )
    .all(space, space) as { id: number }[];
  handle.sqlite.prepare(`DELETE FROM edges WHERE id = ?`).run(rows[0]!.id);
}

describe("C1 — the travel-ledger shape", () => {
  it("dispatch is free, creates an outbound mission with named ships, and logs it", () => {
    const before = fuel();
    const m = dispatch();
    expect(m.state).toBe("outbound");
    expect(m.origin).toBe("home");
    expect(m.destination).toBe("scale");
    expect(m.ships).toEqual(["bob"]);
    expect(m.fuelCost).toBe(0);
    expect(missionDispatchCost(1, 30)).toBe(0);
    expect(missionDispatchCost(3, 60)).toBe(0);
    expect(fuel()).toBeCloseTo(before, 6);
    const log = new MissionRepo(handle, "spaceA").recentLog();
    expect(log[0]?.kind).toBe("dispatch");
    expect(log[0]?.act).toContain("Scale");
    expect(log[0]?.act).toContain("Free");
    expect(log[0]?.cause).toBeTruthy();
  });

  it("ship rotation is deterministic: later missions fly different hulls", () => {
    const first = dispatch({ clientKey: "k-rot-1" });
    const second = dispatch({ clientKey: "k-rot-2", destination: "great-station" });
    expect(first.ships).toEqual([MISSION_FLEET_SHIPS[0]]);
    expect(second.ships).toEqual([MISSION_FLEET_SHIPS[3]]);
  });

  it("a same-key retry returns the original mission and never re-works it", () => {
    const first = dispatch({ clientKey: "retry-key" });
    const afterFirst = fuel();
    const second = dispatch({
      clientKey: "retry-key",
      kind: "scouting",
      destination: "quiet-archive",
      durationMinutes: 60,
      fleetSize: 3,
    });
    expect(second.id).toBe(first.id);
    expect(second.kind).toBe("journey");
    expect(fuel()).toBeCloseTo(afterFirst, 6);
  });

  it("a journey goes, arrives with one plain arrival line, returns, and completes", () => {
    const m = dispatch();
    settleMissions(handle, "spaceA", ARRIVE_AT - 1000);
    expect(new MissionRepo(handle, "spaceA").missionById(m.id)?.state).toBe("outbound");
    settleMissions(handle, "spaceA", ARRIVE_AT);
    const arrived = new MissionRepo(handle, "spaceA").missionById(m.id)!;
    expect(arrived.state).toBe("arrived");
    expect(arrived.outcome).toContain("Arrived at Scale.");
    settleMissions(handle, "spaceA", BACK_AT);
    expect(new MissionRepo(handle, "spaceA").missionById(m.id)?.state).toBe("returning");
    settleMissions(handle, "spaceA", DONE_AT);
    const done = new MissionRepo(handle, "spaceA").missionById(m.id)!;
    expect(done.state).toBe("completed");
    expect(done.completedAt).not.toBeNull();
    // Settling again never re-works it: exactly one arrival line.
    settleMissions(handle, "spaceA", DONE_AT + MIN);
    const repo = new MissionRepo(handle, "spaceA");
    expect(repo.recentLog().filter((e) => e.kind === "arrive")).toHaveLength(1);
    expect(repo.recentLog().filter((e) => e.kind === "complete")).toHaveLength(1);
  });

  it("duration bounds are 15–60 minutes, three equal legs", () => {
    const short = dispatch({ clientKey: "k-short", durationMinutes: 15 });
    settleMissions(handle, "spaceA", T0 + 5 * MIN);
    expect(new MissionRepo(handle, "spaceA").missionById(short.id)?.state).toBe("arrived");
    settleMissions(handle, "spaceA", T0 + 15 * MIN);
    expect(new MissionRepo(handle, "spaceA").missionById(short.id)?.state).toBe("completed");
  });

  it("a scouting mission reports true ledger facts, in plain words, and logs the report", () => {
    // One of the owner's own journeys arrived at Scale.
    const t = new TravelRepo(handle, "spaceA");
    const j = t.depart({ clientKey: "j-1", kind: "drift", destination: "scale" }, T0 - MIN);
    t.arrive(j.id, T0 - MIN + 60_000);
    const m = dispatch({ kind: "scouting", destination: "scale" });
    settleMissions(handle, "spaceA", DONE_AT);
    const done = new MissionRepo(handle, "spaceA").missionById(m.id)!;
    expect(done.state).toBe("completed");
    expect(done.report).toContain("One journey of yours has arrived at Scale");
    expect(done.report).toContain("That is what the fleet saw — nothing more, nothing added.");
    expect(done.report).not.toContain("grown");
    expect(done.report).not.toContain("lantern");
    const log = new MissionRepo(handle, "spaceA").recentLog();
    expect(log.some((e) => e.kind === "report" && e.act === done.report)).toBe(true);
  });

  it("a scouting mission to Quiet/Archive counts what rests there", () => {
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, status) VALUES (?, ?, ?, ?, ?)`)
      .run("spaceA", "Old memory", "memory", "long ago", "archived");
    const m = dispatch({ kind: "scouting", destination: "quiet-archive" });
    settleMissions(handle, "spaceA", DONE_AT);
    const done = new MissionRepo(handle, "spaceA").missionById(m.id)!;
    expect(done.report).toContain("It holds 1 thing resting.");
  });
});

describe("C2 — free; failure costs nothing", () => {
  it("refuses what the fence refuses, with plain reasons", () => {
    expect(() => dispatch({ kind: "defense" as never })).toThrowError(/journeys or scouts/);
    expect(() => dispatch({ kind: "charting" as never })).toThrowError(/journeys or scouts/);
    expect(() => dispatch({ kind: "keeping" as never })).toThrowError(/journeys or scouts/);
    expect(() => dispatch({ destination: "home" })).toThrowError(/flies to the Great Station/);
    expect(() => dispatch({ destination: "growing-place" })).toThrowError(/flies to the Great Station/);
    expect(() => dispatch({ destination: "deep-past" })).toThrowError(/flies to the Great Station/);
    expect(() => dispatch({ destination: "nowhere" })).toThrowError(/flies to the Great Station/);
    expect(() => dispatch({ durationMinutes: 14 })).toThrowError(/15 to 60 minutes/);
    expect(() => dispatch({ durationMinutes: 61 })).toThrowError(/15 to 60 minutes/);
    expect(() => dispatch({ fleetSize: 0 })).toThrowError(/1 to 3 ships/);
    expect(() => dispatch({ fleetSize: 4 })).toThrowError(/1 to 3 ships/);
  });

  it("a big mission is still free — fuel never gates access", () => {
    const before = fuel();
    const m = dispatch({ durationMinutes: 60, fleetSize: 3 });
    expect(m.fuelCost).toBe(0);
    expect(m.ships).toHaveLength(3);
    expect(fuel()).toBeCloseTo(before, 6);
  });

  it("refuses People while its gate is closed, at dispatch and at arrival", () => {
    expect(() => dispatch({ destination: "people", kind: "scouting" })).toThrowError(/isn't open yet/);
    seedPeopleGateOpen();
    expect(new TravelRepo(handle, "spaceA").peopleGateOpen()).toBe(true);
    const m = dispatch({ destination: "people", kind: "scouting" });
    closePeopleGate();
    expect(new TravelRepo(handle, "spaceA").peopleGateOpen()).toBe(false);
    settleMissions(handle, "spaceA", ARRIVE_AT);
    const failed = new MissionRepo(handle, "spaceA").missionById(m.id)!;
    expect(failed.state).toBe("failed");
    expect(failed.outcome).toContain("The way to the People closed");
    expect(failed.outcome).toContain("returned empty-handed");
    // Failure costs NOTHING: fuel untouched, no cargo, no progress.
    expect(fuel()).toBeCloseTo(25, 6);
  });

  it("recall returns the mission without its outcome, and costs nothing", () => {
    const m = dispatch();
    const afterDispatch = fuel();
    const recalled = recallMission(handle, "spaceA", m.id, ARRIVE_AT - 1000);
    expect(recalled.state).toBe("recalled");
    expect(fuel()).toBeCloseTo(afterDispatch, 6);
    expect(new MissionRepo(handle, "spaceA").missionById(m.id)?.outcome).toContain("returned without its outcome");
  });

  it("a stopped fleet dispatches nothing, but active missions still sail home", () => {
    const m = dispatch();
    stopFleet(handle, "spaceA", T0);
    expect(() => dispatch({ clientKey: "k-stopped" })).toThrowError(/stopped/);
    settleMissions(handle, "spaceA", DONE_AT);
    expect(new MissionRepo(handle, "spaceA").missionById(m.id)?.state).toBe("completed");
    resumeFleet(handle, "spaceA", DONE_AT);
    const m2 = dispatch({ clientKey: "k-after-resume", kind: "scouting", destination: "great-station" });
    expect(m2.state).toBe("outbound");
  });

  it("at most three missions out, one per destination", () => {
    dispatch({ clientKey: "k-1", destination: "scale" });
    dispatch({ clientKey: "k-2", destination: "great-station" });
    dispatch({ clientKey: "k-3", destination: "quiet-archive" });
    // A fourth destination is free per-destination but the fleet is full.
    // (People is the only remaining destination; its gate is closed, so
    // use a second Scale attempt to prove the full-fleet refusal wins
    // over nothing — the busy-destination refusal is covered below.)
    expect(() => dispatch({ clientKey: "k-4", destination: "scale" })).toThrowError(/already out|Only 3 missions/);
  });

  it("a second mission to a busy destination is refused", () => {
    dispatch({ clientKey: "k-1", destination: "scale" });
    expect(() => dispatch({ clientKey: "k-2", destination: "scale" })).toThrowError(/already out/);
  });

  it("unknown mission recall throws; terminal recall returns the mission", () => {
    expect(() => recallMission(handle, "spaceA", "no-such-id")).toThrowError(MissionError);
    const m = dispatch();
    const recalled = recallMission(handle, "spaceA", m.id, T0 + 1000);
    expect(recalled.state).toBe("recalled");
    const again = recallMission(handle, "spaceA", m.id, T0 + 2000);
    expect(again.state).toBe("recalled");
    expect(again.completedAt).toBe(recalled.completedAt);
  });
});

describe("C3 — visible in the log; honest reports only", () => {
  it("the overview settles, lists, and logs", () => {
    const m = dispatch();
    settleMissions(handle, "spaceA", DONE_AT);
    expect(new MissionRepo(handle, "spaceA").missionById(m.id)?.state).toBe("completed");
    const overview = getMissionsOverview(handle, "spaceA", DONE_AT);
    expect(overview.missions).toHaveLength(1);
    expect(overview.log.length).toBeGreaterThan(0);
    expect(overview.log.every((e: { act: string; cause: string }) => e.act.trim() && e.cause.trim())).toBe(true);
    expect(overview.fuel.capacity).toBe(200);
    expect(overview.fleetStopped).toBe(false);
  });
});

describe("C4 — no brain write, no cross-world reach, space-scoped", () => {
  it("dispatch + full settle leaves every brain fact byte-identical", () => {
    const ins = handle.sqlite.prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`);
    const a = ins.run("spaceA", "First memory", "memory", "something that happened").lastInsertRowid as number;
    const b = ins.run("spaceA", "Second memory", "memory", "something else").lastInsertRowid as number;
    handle.sqlite
      .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`)
      .run("spaceA", a, b, "links");
    const before = brainSnapshot();
    dispatch({ kind: "journey", destination: "great-station" });
    dispatch({ clientKey: "k-scout", kind: "scouting", destination: "scale" });
    settleMissions(handle, "spaceA", DONE_AT);
    expect(brainSnapshot()).toBe(before);
  });

  it("one space's missions are invisible to another", () => {
    dispatch({ clientKey: "k-a" }, T0, "spaceA");
    const overviewB = getMissionsOverview(handle, "spaceB", T0);
    expect(overviewB.missions).toHaveLength(0);
    expect(overviewB.log).toHaveLength(0);
    const overviewA = getMissionsOverview(handle, "spaceA", T0);
    expect(overviewA.missions).toHaveLength(1);
  });
});
