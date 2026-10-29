import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { ETERNITY_AUTONOMOUS_GESTURES, ETERNITY_FIGURE } from "@brain/shared";
import { NpcRepo } from "./repo.js";
import { askNpc, checkFence, getNpcState, NpcError, resumeNpc, runNpcTick, stopNpc } from "./loop.js";
import { ALIGNMENT_THRESHOLD, alignmentOf, decideEternity, perceiveEternity, type EternityPerception } from "./eternity.js";

/**
 * Eternity's autonomy, phase 1 (docs/specs/eternity-autonomy-2026-10-29.md). Time is injected; no test sleeps.
 * C1 every act/non-act is logged with a plain cause · C2 the fence holds (no speak, no sorrow/warning, own world,
 * budgets, kill switch) · C3 aggregates only — no node text is read · C4 deterministic.
 */
const T0 = Date.parse("2026-10-22T16:00:00.000Z");
const HOURS = 3_600_000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

const repo = (space = "spaceA") => new NpcRepo(handle, space);

function seedActiveGalaxy(space = "spaceA", n = 14, weight = 0.7): void {
  const ins = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content, emotional_weight, created_at) VALUES (?, ?, 'memory', ?, ?, ?)`,
  );
  for (let i = 0; i < n; i++) ins.run(space, `m${i}`, `SECRET CONTENT ${i}`, weight, new Date(T0 - i * 3_600_000).toISOString());
}

const perception = (over: Partial<EternityPerception> = {}): EternityPerception => ({
  nowMs: T0,
  memoriesInWindow: 14,
  meanWeight: 0.7,
  alignment: alignmentOf(14, 0.7),
  actsToday: 0,
  dayKey: "2026-10-22",
  spaceId: "spaceA",
  ...over,
});

describe("alignment (internal only)", () => {
  it("grows with volume and charge, bounded 0..1", () => {
    expect(alignmentOf(0, 0)).toBe(0);
    expect(alignmentOf(100, 5)).toBeCloseTo(1, 5);
    expect(alignmentOf(12, 0)).toBeCloseTo(0.6, 5);
  });
  it("a quiet galaxy waits, with a kind cause (no shame)", () => {
    const d = decideEternity(perception({ memoriesInWindow: 1, meanWeight: 0.1, alignment: alignmentOf(1, 0.1) }));
    expect(d.act).toBe("wait");
    expect(d.cause).toMatch(/no fault/i);
    expect(alignmentOf(1, 0.1)).toBeLessThan(ALIGNMENT_THRESHOLD);
  });
});

describe("decideEternity", () => {
  it("is deterministic", () => {
    expect(decideEternity(perception())).toEqual(decideEternity(perception()));
  });
  it("over thousands of seeds never speaks, never makes sorrow or warning, only allowed gestures", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const d = decideEternity(perception({ spaceId: `s${i}`, actsToday: i % 3, dayKey: `2026-10-${(i % 28) + 1}`, meanWeight: (i % 10) / 10 }));
      seen.add(d.act);
      if (d.act === "gesture") expect(ETERNITY_AUTONOMOUS_GESTURES).toContain(d.gesture);
    }
    expect(seen.has("speak" as never)).toBe(false);
    expect(seen.has("gesture")).toBe(true);
    expect(seen.has("reorder-light")).toBe(true);
  });
});

describe("the loop", () => {
  it("his fence: allow-listed kinds only (speak is for contact, phase 2c), own world only", () => {
    expect(() => checkFence(ETERNITY_FIGURE, "summon-ship", "eternity")).toThrow(NpcError);
    expect(() => checkFence(ETERNITY_FIGURE, "explore", "eternity")).toThrow(NpcError);
    expect(() => checkFence(ETERNITY_FIGURE, "gesture", "great-station")).toThrow(NpcError);
    expect(() => checkFence(ETERNITY_FIGURE, "gesture", "eternity")).not.toThrow();
  });

  it("an active galaxy: he acts, logged with a plain cause; reading is aggregates only", () => {
    seedActiveGalaxy();
    const before = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes ORDER BY id`).all());
    const r = runNpcTick(handle, "spaceA", "eternity", T0);
    expect(r.acted).toBe(true);
    expect(["gesture", "reorder-light"]).toContain(r.entry!.kind);
    expect(r.entry!.cause.length).toBeGreaterThan(10);
    expect(r.entry!.act + r.entry!.cause).not.toMatch(/SECRET/);
    expect(JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes ORDER BY id`).all())).toBe(before); // no brain write
  });

  it("a quiet galaxy is a logged wait, not a gap", () => {
    const r = runNpcTick(handle, "spaceA", "eternity", T0);
    expect(r.entry!.kind).toBe("wait");
    expect(repo().recentLog("eternity")).toHaveLength(1);
  });

  it("acts rarely: throttled for 6 hours, then free again", () => {
    seedActiveGalaxy();
    runNpcTick(handle, "spaceA", "eternity", T0);
    expect(runNpcTick(handle, "spaceA", "eternity", T0 + 5 * HOURS).reasonCode).toBe("throttled");
    expect(runNpcTick(handle, "spaceA", "eternity", T0 + 6 * HOURS + 1000).acted).toBe(true);
  });

  it("never more than 3 acts per space-local day", () => {
    seedActiveGalaxy();
    let acted = 0;
    for (let i = 0; i < 6; i++) if (runNpcTick(handle, "spaceA", "eternity", T0 + i * 6 * HOURS + i * 1000).acted) acted++;
    // Six ticks across ~30 hours span at most two local days; each day allows 3.
    expect(repo().actsToday("eternity", T0)).toBeLessThanOrEqual(3);
    expect(acted).toBeGreaterThan(0);
  });

  it("the kill switch silences him entirely, and resume brings him back", () => {
    seedActiveGalaxy();
    stopNpc(handle, "spaceA", "eternity", T0);
    const r = runNpcTick(handle, "spaceA", "eternity", T0 + 7 * HOURS);
    expect(r.reasonCode).toBe("stopped");
    expect(getNpcState(handle, "spaceA", "eternity", T0 + 7 * HOURS).stopped).toBe(true);
    resumeNpc(handle, "spaceA", "eternity", T0 + 8 * HOURS);
    expect(runNpcTick(handle, "spaceA", "eternity", T0 + 14 * HOURS).acted).toBe(true);
  });

  it("he is not asked", () => {
    expect(() => askNpc(handle, "spaceA", "eternity", "routes", T0)).toThrow(/not asked/);
  });

  it("brains are separate: one galaxy's activity does not move another's decision", () => {
    seedActiveGalaxy("spaceA");
    const a = perceiveEternity(handle, "spaceA", T0, 0);
    const b = perceiveEternity(handle, "spaceB", T0, 0);
    expect(a.memoriesInWindow).toBe(14);
    expect(b.memoriesInWindow).toBe(0);
  });
});
