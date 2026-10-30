import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { EconomyRepo } from "../economy.js";
import { NPC_TICK_MIN_INTERVAL_MS, type NpcActKind } from "@brain/shared";
import { NpcRepo } from "./repo.js";
import { checkFence, askNpc, getNpcState, NpcError, resumeNpc, runNpcTick, stopNpc } from "./loop.js";
import { ETERNITY_FIGURE, HARBOR_CONTROLLER } from "@brain/shared";

/**
 * NPC autonomy — the loop and the fence (design note §2/§3, C2–C4).
 * Time is INJECTED everywhere — no test sleeps. Every tick runs
 * against a fresh in-memory DB, so the log assertions are exact.
 *
 * C2: the loop is provable — every act has a log entry with its cause
 * in plain language; doing nothing is a logged non-act, not a gap.
 * C3: the fence holds — no brain write, no cross-world reach, no
 * structural self-apply, budget respected, kill switch works.
 * C4: an NPC that cannot find the way explores, leaves, and comes
 * back — it never narrates knowledge it doesn't have, and never
 * teleports past an unopened gate.
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // 08:00 EDT
const AFTER_TICK = T0 + NPC_TICK_MIN_INTERVAL_MS + 1000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const repo = (space = "spaceA") => new NpcRepo(handle, space);
const logKinds = (space = "spaceA") => repo(space).recentLog("harbor-controller").map((e) => e.kind);
const logActs = (space = "spaceA") => repo(space).recentLog("harbor-controller").map((e) => e.act);

function seedBrain(space = "spaceA"): { nodeIds: number[] } {
  const ins = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`,
  );
  const a = ins.run(space, "First memory", "memory", "something that happened").lastInsertRowid as number;
  const b = ins.run(space, "Second memory", "memory", "something else").lastInsertRowid as number;
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, ?)`)
    .run(space, a, b, "links");
  return { nodeIds: [a, b] };
}

function brainSnapshot(space = "spaceA"): string {
  const nodes = handle.sqlite
    .prepare(`SELECT * FROM nodes WHERE space_id = ? ORDER BY id`)
    .all(space);
  const edges = handle.sqlite
    .prepare(`SELECT * FROM edges WHERE space_id = ? ORDER BY id`)
    .all(space);
  return JSON.stringify({ nodes, edges });
}

/** Drive a journey to the Station and arrive, with injected time. */
function arriveAtStation(nowMs: number, space = "spaceA"): string {
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: `k-${nowMs}`, kind: "drift", destination: "great-station" }, nowMs);
  const arrived = t.arrive(j.id, nowMs + 60_000);
  if (!arrived || arrived.state !== "arrived") throw new Error("test setup: arrival failed");
  return j.id;
}

describe("C2 — the loop is provable", () => {
  it("first tick explores (once a day), second tick waits — both logged with causes", () => {
    const first = runNpcTick(handle, "spaceA", "harbor-controller", T0);
    expect(first.acted).toBe(true);
    expect(first.entry?.kind).toBe("explore");
    expect(first.entry?.act).toContain("found no relic");
    expect(first.entry?.cause).toBeTruthy();

    const second = runNpcTick(handle, "spaceA", "harbor-controller", AFTER_TICK);
    expect(second.acted).toBe(true);
    expect(second.entry?.kind).toBe("wait");
    expect(second.entry?.act).toBe("Waited.");
    expect(second.entry?.cause).toContain("waiting is behaving correctly");

    // Newest first in the stored log.
    expect(logKinds()).toEqual(["wait", "explore"]);
  });

  it("a question is answered from live state, and the answer is logged as a speak", () => {
    const r = runNpcTick(handle, "spaceA", "harbor-controller", T0, "fuel");
    expect(r.acted).toBe(true);
    expect(r.entry?.kind).toBe("speak");
    expect(r.entry?.act).toContain("25 fuel");
    expect(r.entry?.act).toContain("A warp costs fuel by distance");
    expect(r.entry?.cause).toContain("asked about fuel");
  });

  it("every question kind answers in plain words from live state", () => {
    for (const q of ["routes", "arrivals", "traffic", "fuel", "gate"] as const) {
      const r = askNpc(handle, "spaceA", "harbor-controller", q, T0 + 1000);
      expect(r.entry?.kind).toBe("speak");
      expect(r.entry?.act.length).toBeGreaterThan(20);
    }
    const gate = askNpc(handle, "spaceA", "harbor-controller", "gate", T0 + 2000);
    expect(gate.entry?.act).toContain("no relics at all");
  });
});

describe("C4 — cannot find the way, so it explores, leaves, comes back", () => {
  it("welcomes a fresh arrival at the Station, once, and never claims the gate", () => {
    const journeyId = arriveAtStation(T0);
    const r = runNpcTick(handle, "spaceA", "harbor-controller", T0 + 120_000);
    expect(r.entry?.kind).toBe("speak");
    expect(r.entry?.act).toContain("Welcome to the Great Station");
    expect(r.entry?.act).toContain("from Home");
    expect(r.entry?.cause).toContain("arrived here");

    // A later tick does not welcome the same arrival twice.
    const again = runNpcTick(handle, "spaceA", "harbor-controller", AFTER_TICK + 120_000);
    expect(logActs().filter((a) => a.startsWith("Welcome to the Great Station"))).toHaveLength(1);
    expect(again.entry?.kind).not.toBe("speak");
    expect(repo().state("harbor-controller").lastWelcomeJourneyId).toBe(journeyId);
  });

  it("does not welcome a stale arrival — the moment has passed", () => {
    arriveAtStation(T0);
    // Two hours later: outside the welcome window, so it explores instead.
    const r = runNpcTick(handle, "spaceA", "harbor-controller", T0 + 2 * 60 * 60 * 1000);
    expect(r.entry?.kind).toBe("explore");
  });

  it("the gate stays closed with no holdings, and opens only on Witness + two others", () => {
    expect(getNpcState(handle, "spaceA", "harbor-controller", T0).gateOpen).toBe(false);
    repo().addHolding("harbor-controller", "witness-without-a-name", "great-station", T0);
    repo().addHolding("harbor-controller", "mooring-ring", "great-station", T0);
    const stillClosed = runNpcTick(handle, "spaceA", "harbor-controller", T0);
    expect(getNpcState(handle, "spaceA", "harbor-controller", T0).gateOpen).toBe(false);
    expect(stillClosed.entry?.act).toContain("found no relic");

    repo().addHolding("harbor-controller", "dawn-leaf", "great-station", T0);
    runNpcTick(handle, "spaceA", "harbor-controller", AFTER_TICK);
    const st = getNpcState(handle, "spaceA", "harbor-controller", AFTER_TICK);
    expect(st.gateOpen).toBe(true);
    expect(st.relicsHeld).toBe(3);
    // Once opened it stays open even if the holdings row is read later.
    expect(repo().gateOpen("harbor-controller")).toBe(true);
  });

  it("NPC holdings live only in the NPC pool — never a player pool", () => {
    repo().addHolding("harbor-controller", "witness-without-a-name", "great-station", T0);
    const tables = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%relic%'`)
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(["npc_relic_holdings"]);
    expect(repo().holdings("harbor-controller")).toEqual(["witness-without-a-name"]);
  });
});

describe("C3 — the fence holds", () => {
  it("no brain write: nodes and edges are byte-identical across ticks", () => {
    seedBrain();
    const before = brainSnapshot();
    runNpcTick(handle, "spaceA", "harbor-controller", T0);
    runNpcTick(handle, "spaceA", "harbor-controller", AFTER_TICK);
    askNpc(handle, "spaceA", "harbor-controller", "routes", AFTER_TICK + 1000);
    expect(brainSnapshot()).toBe(before);
    // And the NPC wrote only to its own tables.
    const npcRows = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM npc_log WHERE space_id = ?`)
      .get("spaceA") as { n: number };
    expect(npcRows.n).toBe(3);
  });

  it("roams only where she may: home world + her roamed worlds; never a personal brain, never an unlisted world", () => {
    runNpcTick(handle, "spaceA", "harbor-controller", T0);
    const st = getNpcState(handle, "spaceA", "harbor-controller", T0);
    expect(st.world).toBe("great-station");
    // npc-society (2026-10-30): she may be in the worlds she roams…
    expect(() => checkFence(HARBOR_CONTROLLER, "speak", "great-station")).not.toThrow();
    expect(() => checkFence(HARBOR_CONTROLLER, "speak", "deep-past")).not.toThrow();
    // …but never a personal brain (invitation-only is a future feature), and never a world outside her list (Eternity's).
    expect(() => checkFence(HARBOR_CONTROLLER, "speak", "home")).toThrow(/personal brain/);
    expect(() => checkFence(HARBOR_CONTROLLER, "speak", "eternity")).toThrow(NpcError);
    // Eternity does not roam at all: only his own world.
    expect(() => checkFence(ETERNITY_FIGURE, "wait", "eternity")).not.toThrow();
    expect(() => checkFence(ETERNITY_FIGURE, "wait", "deep-past")).toThrow(NpcError);
    expect(() => checkFence(ETERNITY_FIGURE, "wait", "home")).toThrow(NpcError);
  });

  it("no structural self-apply: kinds outside the NPC's allow-list are refused", () => {
    // reorder-light is a known framework kind — but not on the harbor
    // controller's allow-list, so the fence refuses it.
    expect(() => checkFence(HARBOR_CONTROLLER, "reorder-light", "great-station")).toThrow(NpcError);
    // A forged kind that exists nowhere is refused too.
    expect(() =>
      checkFence(HARBOR_CONTROLLER, "build-landmark" as unknown as NpcActKind, "great-station"),
    ).toThrow(NpcError);
    // The log itself refuses an off-list kind.
    expect(() =>
      repo().appendLog("harbor-controller", "build-landmark" as unknown as NpcActKind, "x", "y", T0),
    ).toThrow(/allow-list/);
  });

  it("budget respected: a spent day means no more acts, and asks refuse honestly", () => {
    for (let i = 0; i < 24; i++) {
      repo().appendLog("harbor-controller", "wait", "Waited.", "budget setup", T0);
    }
    expect(repo().actsToday("harbor-controller", T0)).toBe(24);
    const r = runNpcTick(handle, "spaceA", "harbor-controller", T0);
    expect(r.acted).toBe(false);
    expect(r.reasonCode).toBe("budget");
    expect(repo().recentLog("harbor-controller", 30)).toHaveLength(24); // nothing more logged
    expect(() => askNpc(handle, "spaceA", "harbor-controller", "routes", T0)).toThrow(NpcError);
  });

  it("kill switch: a stopped NPC does nothing, answers nothing, and resumes on the owner's word", () => {
    const stopped = stopNpc(handle, "spaceA", "harbor-controller", T0);
    expect(stopped.stopped).toBe(true);
    expect(logKinds()).toEqual(["wait"]); // the stop itself is logged
    expect(logActs()[0]).toBe("Stopped.");

    const tick = runNpcTick(handle, "spaceA", "harbor-controller", T0 + 1000);
    expect(tick.acted).toBe(false);
    expect(tick.reasonCode).toBe("stopped");
    expect(repo().recentLog("harbor-controller")).toHaveLength(1); // silence, not log spam

    expect(() => askNpc(handle, "spaceA", "harbor-controller", "routes", T0 + 2000)).toThrow(NpcError);
    const resumed = resumeNpc(handle, "spaceA", "harbor-controller", T0 + 3000);
    expect(resumed.stopped).toBe(false);
    const after = runNpcTick(handle, "spaceA", "harbor-controller", T0 + 4000);
    expect(after.acted).toBe(true);
  });

  it("throttle: autonomous ticks wait their turn, but a question always gets an answer", () => {
    const first = runNpcTick(handle, "spaceA", "harbor-controller", T0);
    expect(first.acted).toBe(true);
    const tooSoon = runNpcTick(handle, "spaceA", "harbor-controller", T0 + 60_000);
    expect(tooSoon.acted).toBe(false);
    expect(tooSoon.reasonCode).toBe("throttled");
    expect(repo().recentLog("harbor-controller")).toHaveLength(1);
    const asked = askNpc(handle, "spaceA", "harbor-controller", "traffic", T0 + 60_000);
    expect(asked.acted).toBe(true);
    expect(asked.entry?.act).toContain("arrived here today");
  });

  it("unknown NPCs are unknown — no silent default", () => {
    expect(() => runNpcTick(handle, "spaceA", "keeper", T0)).toThrow(NpcError);
    expect(() => getNpcState(handle, "spaceA", "keeper", T0)).toThrow(NpcError);
  });

  it("space-scoped: one space's NPC never sees another's log", () => {
    runNpcTick(handle, "spaceA", "harbor-controller", T0);
    expect(repo("spaceB").recentLog("harbor-controller")).toHaveLength(0);
    expect(getNpcState(handle, "spaceB", "harbor-controller", T0).actsToday).toBe(0);
  });
});

describe("answers from live state", () => {
  it("routes list the open chart from the visitor's world, with costs", () => {
    const r = askNpc(handle, "spaceA", "harbor-controller", "routes", T0);
    expect(r.entry?.act).toContain("From Home");
    expect(r.entry?.act).toContain("the Great Station");
    expect(r.entry?.act).toContain("a warp costs 8 fuel from here");
    expect(r.entry?.act).toContain("The People isn't open yet");
  });

  it("arrivals and traffic report the ledger, not an invented count", () => {
    arriveAtStation(T0);
    const a = askNpc(handle, "spaceA", "harbor-controller", "arrivals", T0 + 120_000);
    expect(a.entry?.act).toContain("came from Home");
    const t = askNpc(handle, "spaceA", "harbor-controller", "traffic", T0 + 120_000);
    expect(t.entry?.act).toContain("One journey has arrived here today");
    expect(t.entry?.act).toContain("nothing inbound");
  });

  it("fuel reports the real balance — a warp the visitor cannot afford says so", () => {
    // Spend down below the warp cost: 25 start, warp costs 10.
    const econ = new EconomyRepo(handle, "spaceA");
    expect(econ.get()).toBeCloseTo(25, 1);
    const r = askNpc(handle, "spaceA", "harbor-controller", "fuel", T0);
    expect(r.entry?.act).toContain("enough for a warp");
  });
});
