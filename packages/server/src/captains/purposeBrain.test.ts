import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, type CaptainId, type CaptainWorld, type NpcActKind } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import {
  PurposeStore,
  executeDeedAct,
  resetCaptainPurpose,
  retrieveCaptainMemories,
  type PurposeExec,
} from "./purpose.js";

/**
 * P2-B1.2 / B1.3 — the simulated brain, deed acts, NPC stirrings,
 * and the completed memory stream (spec §6, outlines §5 D-1/M-1..M-3).
 *
 * The C4 wall is the point: deeds execute ONLY on sim-brain tables;
 * a full real-brain snapshot stays byte-identical; her stirrings
 * live on the NPC record (C13), never in the player's stirring table.
 */
const SPACE = "spaceA";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const H = 3_600_000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const store = () => new PurposeStore(handle, SPACE);
const captains = () => new CaptainRepo(handle, SPACE);

function seedVeyra(nowMs = T0): void {
  const def = captainDefinition("veyra")!;
  captains().ensureState(def, nowMs);
  captains().update("veyra", { currentWorld: "great-station" });
}

/** A test executor over the real repos — the engine supplies its
 *  own in production; this one exercises the same stores. */
function testExec(draw = 0.1): PurposeExec {
  const log = new NpcRepo(handle, SPACE);
  return {
    logAct: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    logBookkeeping: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    openLeg: () => false,
    state: () => captains().state("veyra")!,
    searchDraw: (_id: CaptainId, _stirring: number) => draw,
  };
}

function fixtureBrain(): void {
  store().seedSimBrainFixture("veyra", [
    { id: "n-due", theme: "the search", title: "A half-checked bearing", pointsTo: "great-station", ageDays: 40, due: 1 },
    { id: "n-old", theme: "voyages", title: "The long way round, remembered", pointsTo: "scale", ageDays: 800, due: 0 },
    { id: "n-a", theme: "people", title: "A face at the dock", pointsTo: "great-station", ageDays: 90, due: 0 },
    { id: "n-b", theme: "work", title: "Berth fees and patience", pointsTo: "great-station", ageDays: 120, due: 0 },
  ]);
}

function realBrainSnapshot(): string {
  const nodes = handle.sqlite.prepare(`SELECT * FROM nodes WHERE space_id = ? ORDER BY id`).all(SPACE);
  const edges = handle.sqlite.prepare(`SELECT * FROM edges WHERE space_id = ? ORDER BY id`).all(SPACE);
  const stirrings = handle.sqlite.prepare(`SELECT * FROM relic_stirrings WHERE space_id = ? ORDER BY rowid`).all(SPACE);
  const inbox = handle.sqlite.prepare(`SELECT * FROM inbox_notifications WHERE space_id = ? ORDER BY rowid`).all(SPACE);
  return JSON.stringify({ nodes, edges, stirrings, inbox });
}

describe("P2 sim brain + deeds (B1.2)", () => {
  it("D-1: a Review deed changes sim-brain state and raises a stirring on the NPC record — real brain byte-identical", () => {
    seedVeyra();
    fixtureBrain();
    const before = realBrainSnapshot();
    const out = executeDeedAct(handle, SPACE, "veyra", "review", T0 + H, testExec());
    expect("logId" in out).toBe(true);
    if (!("logId" in out)) return;
    expect(out.nodeId).toBe("n-due");
    const node = store().simNodes("veyra").find((n) => n.id === "n-due");
    expect(node?.due).toBe(0);
    expect(node?.reviews).toBe(1);
    // The stirring is HERS (C13): active, at Great Station, sourced
    // from the deed's log event — and the player's stirring table
    // gained no row (snapshot covers it).
    expect(out.stirring?.world).toBe("great-station");
    expect(out.stirring?.state).toBe("active");
    expect(out.stirring?.sourceLogId).toBe(out.logId);
    expect(realBrainSnapshot()).toBe(before);
  });

  it("D-1: every deed verb executes only on sim-brain tables", () => {
    seedVeyra();
    fixtureBrain();
    const before = realBrainSnapshot();
    const resurface = executeDeedAct(handle, SPACE, "veyra", "resurface", T0 + H, testExec());
    expect("logId" in resurface).toBe(true);
    if ("logId" in resurface) {
      expect(resurface.nodeId).toBe("n-old");
      expect(store().simNodes("veyra").find((n) => n.id === "n-old")?.resurfaces).toBe(1);
      expect(resurface.stirring?.world).toBe("scale");
    }
    const link = executeDeedAct(handle, SPACE, "veyra", "link", T0 + 2 * H, testExec());
    expect("logId" in link).toBe(true);
    expect(store().simEdges("veyra")).toHaveLength(1);
    const tend = executeDeedAct(handle, SPACE, "veyra", "tend", T0 + 3 * H, testExec());
    expect("logId" in tend).toBe(true);
    expect(realBrainSnapshot()).toBe(before);
  });

  it("a deed whose precondition is absent is refused honestly — no log, no state change", () => {
    seedVeyra();
    store().seedSimBrainFixture("veyra", [
      { id: "n-young", theme: "work", title: "New paint", pointsTo: "scale", ageDays: 12, due: 0 },
    ]);
    const out = executeDeedAct(handle, SPACE, "veyra", "resurface", T0 + H, testExec());
    expect("blocked" in out).toBe(true);
    expect(new NpcRepo(handle, SPACE).recentLog("veyra", 10)).toHaveLength(0);
  });

  it("the production seed builds ~24 nodes with an age spread incl. ≥1-year-old nodes and a due card", () => {
    seedVeyra();
    store().ensureSimBrain("veyra");
    const nodes = store().simNodes("veyra");
    expect(nodes.length).toBeGreaterThanOrEqual(20);
    expect(nodes.length).toBeLessThanOrEqual(28);
    expect(nodes.some((n) => n.ageDays >= 365)).toBe(true);
    expect(nodes.some((n) => n.due > 0)).toBe(true);
    // Seeding is idempotent (a second ensure changes nothing).
    store().ensureSimBrain("veyra");
    expect(store().simNodes("veyra")).toEqual(nodes);
  });
});

describe("P2 memory stream completion (B1.3)", () => {
  it("deed entries carry full provenance: origin log id, source, experienced flag", () => {
    seedVeyra();
    fixtureBrain();
    const out = executeDeedAct(handle, SPACE, "veyra", "review", T0 + H, testExec());
    if (!("logId" in out)) throw new Error("deed blocked");
    const entries = captains().memory("veyra");
    const deedEntry = entries.find((e) => e.originLogId === out.logId);
    expect(deedEntry).toBeDefined();
    expect(deedEntry?.source).toBe("firsthand");
    expect(deedEntry?.experienced).toBe(true);
    expect(deedEntry?.kind).toBe("outcome");
  });

  it("M-1: retrieval returns the player meeting, scored above routine entries, with a trace", () => {
    seedVeyra();
    fixtureBrain();
    captains().addMemory(
      "veyra",
      "meeting",
      "Met the steward for the first time at the Great Station.",
      8,
      ["great-station", "steward"],
      T0,
    );
    executeDeedAct(handle, SPACE, "veyra", "tend", T0 + H, testExec());
    const { entries, trace } = retrieveCaptainMemories(handle, SPACE, "veyra", {
      tags: ["great-station", "steward"],
      nowMs: T0 + 2 * H,
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.kind).toBe("meeting");
    expect(trace[0]?.entryId).toBe(entries[0]?.id);
    expect(trace[0]?.score).toBeGreaterThan(trace[trace.length - 1]?.score ?? 0);
    for (const t of trace) {
      expect(t.recency).toBeGreaterThan(0);
      expect(t.recency).toBeLessThanOrEqual(1);
    }
    // Namespace audit: every returned id is hers.
    const hers = new Set(captains().memory("veyra", undefined, 10000).map((e) => e.id));
    for (const e of entries) expect(hers.has(e.id)).toBe(true);
  });

  it("M-3: retention keeps the newest 500 plus every importance ≥8 entry, under a 10,000-entry soak", () => {
    seedVeyra();
    const repo = captains();
    for (let i = 0; i < 10_000; i++) {
      repo.addMemory("veyra", "observation", `soak ${i}`, i % 100 === 0 ? 8 : 2, ["soak"], T0 + i);
    }
    store().enforceRetention("veyra");
    const kept = repo.memory("veyra", undefined, 100_000);
    const important = kept.filter((e) => e.importance >= 8);
    expect(important).toHaveLength(100); // every ≥8 entry survives
    expect(kept.length).toBe(500 + important.filter((e) => !kept.slice(-500).includes(e)).length);
    expect(kept.length).toBeGreaterThanOrEqual(500);
    expect(kept.length).toBeLessThanOrEqual(600);
    // The newest routine entry survives; the oldest routine one is gone.
    expect(kept.some((e) => e.text === "soak 9999")).toBe(true);
    expect(kept.some((e) => e.text === "soak 1")).toBe(false);
  });

  it("owner reset surgery: a full captain reset wipes her P2 stores, holdings, gate, and stream — the log keeps the owner act", () => {
    seedVeyra();
    fixtureBrain();
    executeDeedAct(handle, SPACE, "veyra", "review", T0 + H, testExec());
    new NpcRepo(handle, SPACE).addHolding("veyra", "harbor-nail", "great-station", T0);
    expect(store().activeStirrings("veyra").length).toBeGreaterThan(0);
    resetCaptainPurpose(handle, SPACE, "veyra", T0 + 2 * H);
    expect(store().activeStirrings("veyra")).toHaveLength(0);
    expect(store().simNodes("veyra")).toHaveLength(0);
    expect(store().activePlan("veyra")).toBeNull();
    expect(new NpcRepo(handle, SPACE).holdings("veyra")).toEqual([]);
    expect(new NpcRepo(handle, SPACE).gateOpen("veyra")).toBe(false);
    expect(captains().memory("veyra")).toHaveLength(0);
    expect(captains().state("veyra")).toBeNull(); // recreated fresh on next advance
    const log = new NpcRepo(handle, SPACE).recentLog("veyra", 50);
    expect(log.some((e) => e.act.includes("Reset"))).toBe(true);
  });

  it("reflection-lite: at the importance trigger she summarizes her OWN acts only, in template words", () => {
    seedVeyra();
    fixtureBrain();
    // Drive the importance sum past the ~150 trigger with her own
    // logged acts (finds are importance 9 in the stream).
    for (let i = 0; i < 18; i++) {
      store().writePurposeMemory(
        "veyra",
        "outcome",
        `Found a relic in a search (${i}).`,
        9,
        ["scale", "search"],
        null,
        T0 + i * H,
      );
    }
    const summary = store().maybeReflect("veyra", T0 + 20 * H);
    expect(summary).not.toBeNull();
    expect(summary?.kind).toBe("summary");
    // Template shape: counts of her own acts, nothing about lore,
    // politics, beliefs, or anyone else's inner state.
    expect(summary?.text).toMatch(/search/i);
    expect(summary?.text).not.toMatch(/believe|faction| lore /i);
  });
});
