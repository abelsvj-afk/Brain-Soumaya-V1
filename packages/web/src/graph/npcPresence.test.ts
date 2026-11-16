import { beforeEach, describe, expect, it } from "vitest";
import { castMember } from "@brain/shared";
import {
  ENCOUNTER_COOLDOWN_MS,
  NEAR_ENTER,
  NEAR_EXIT,
  PATROL_PERIOD_MS,
  encounterLine,
  encounterSituation,
  encounterStep,
  npcActivity,
  npcsIn,
  patrolAt,
  readMet,
  recordMeeting,
  roamAt,
} from "./npcPresence.js";

const BERTH = { radius: 222, angle: (Math.PI * 3) / 4, y: 0 };
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("patrol", () => {
  it("is continuous across the whole cycle (no teleports, including phase boundaries)", () => {
    let prev = patrolAt(0, BERTH).pos;
    let maxStep = 0;
    for (let t = 500; t <= PATROL_PERIOD_MS; t += 500) {
      const p = patrolAt(t, BERTH).pos;
      maxStep = Math.max(maxStep, dist(p, prev));
      prev = p;
    }
    // A lap of ~2000 units over ~192 s is ~5 units/s; per 0.5 s step well under 20.
    expect(maxStep).toBeLessThan(20);
  });
  it("starts and ends docked at the berth, and actually leaves it", () => {
    const home = patrolAt(0, BERTH);
    expect(home.phase).toBe("docked");
    expect(dist(patrolAt(PATROL_PERIOD_MS - 1, BERTH).pos, home.pos)).toBeLessThan(2);
    let farthest = 0;
    let sawPatrolling = false;
    for (let t = 0; t < PATROL_PERIOD_MS; t += 1000) {
      const p = patrolAt(t, BERTH);
      if (p.phase === "patrolling") {
        sawPatrolling = true;
        farthest = Math.max(farthest, dist(p.pos, home.pos));
      }
    }
    expect(sawPatrolling).toBe(true);
    expect(farthest).toBeGreaterThan(100);
  });
  it("wanders her patrol rather than circling it: her distance from the centre varies", () => {
    let minR = Infinity;
    let maxR = 0;
    for (let t = 0; t < PATROL_PERIOD_MS; t += 1000) {
      const p = patrolAt(t, BERTH);
      if (p.phase !== "patrolling") continue;
      const r = Math.hypot(p.pos[0], p.pos[2]);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    expect(maxR - minR).toBeGreaterThan(50);
  });
  it("holds at her berth while stopped (the kill switch)", () => {
    expect(patrolAt(PATROL_PERIOD_MS * 0.6, BERTH, { stopped: true })).toEqual(patrolAt(0, BERTH));
  });
  it("is deterministic and periodic", () => {
    expect(patrolAt(123_456, BERTH)).toEqual(patrolAt(123_456 + PATROL_PERIOD_MS, BERTH));
  });
  it("stays docked under reduced motion", () => {
    expect(patrolAt(PATROL_PERIOD_MS * 0.6, BERTH, { reducedMotion: true }).phase).toBe("docked");
  });
});

describe("encounters", () => {
  it("has hysteresis: entering at the near radius, leaving only past the far one", () => {
    expect(encounterStep(false, NEAR_ENTER + 1)).toEqual({ near: false, entered: false });
    expect(encounterStep(false, NEAR_ENTER - 1)).toEqual({ near: true, entered: true });
    expect(encounterStep(true, NEAR_EXIT - 1)).toEqual({ near: true, entered: false });
    expect(encounterStep(true, NEAR_EXIT + 1)).toEqual({ near: false, entered: false });
  });
});

describe("meetings", () => {
  beforeEach(() => localStorage.clear());
  it("counts meetings per brain, flags only the first, and honours the cooldown", () => {
    const t0 = 1_000_000;
    expect(recordMeeting("a", "harbor-controller", t0)).toEqual({ recorded: true, first: true, count: 1 });
    expect(recordMeeting("a", "harbor-controller", t0 + 1000)).toEqual({ recorded: false, first: false, count: 1 });
    expect(recordMeeting("a", "harbor-controller", t0 + ENCOUNTER_COOLDOWN_MS + 1)).toEqual({ recorded: true, first: false, count: 2 });
    expect(readMet("b")).toEqual({});
  });
  it("survives garbage storage", () => {
    localStorage.setItem("npc.met.a", "{nope");
    expect(readMet("a")).toEqual({});
  });
});

describe("the cast in a world", () => {
  const T = Date.parse("2026-10-30T00:00:00.000Z");
  it("npcsIn follows the clock, is never populated at home, and only places people where they may be", () => {
    expect(npcsIn("home", T)).toEqual([]);
    expect(npcsIn(null, T)).toEqual([]);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const w of ["great-station", "growing-place", "deep-past", "quiet-archive", "scale", "people", "eternity"]) for (const m of npcsIn(w, T + i * 7_200_000)) seen.add(m.id);
    expect(seen.has("wayfarer")).toBe(true);
    expect(seen.has("keeper")).toBe(true);
  });
  it("describes what they are doing in words", () => {
    const hc = castMember("harbor-controller")!;
    expect(npcActivity(hc, "great-station", "patrolling")).toMatch(/patrolling/);
    expect(npcActivity(hc, "scale", "roaming")).toMatch(/visiting/);
    expect(npcActivity(castMember("keeper")!, "growing-place", "roaming")).toMatch(/work/);
  });
});

describe("roaming", () => {
  const anchor = { center: [10, 20, 30] as [number, number, number], radius: 400 };
  it("flies between chosen places inside the anchor, never tracing one circle", () => {
    let prev = roamAt(0, "keeper", anchor).pos;
    let maxStep = 0;
    let minR = Infinity;
    let maxR = 0;
    for (let t = 1000; t <= 300_000; t += 1000) {
      const p = roamAt(t, "keeper", anchor).pos;
      maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      const r = Math.hypot(p[0] - anchor.center[0], p[2] - anchor.center[2]);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      expect(r).toBeLessThan(anchor.radius); // every destination, and every chord between two, stays inside the fence
      expect(Math.abs(p[1] - anchor.center[1])).toBeLessThan(anchor.radius * 0.03); // near the anchor's height, never far above or below
      prev = p;
    }
    expect(maxStep).toBeLessThan(60); // continuous: no teleports between legs
    expect(maxR - minR).toBeGreaterThan(anchor.radius * 0.3); // the radius varies — this is not one circle
  });
  it("gives each NPC their own start, so a crowd does not move in step", () => {
    const a = roamAt(5000, "keeper", anchor).pos;
    const b = roamAt(5000, "archivist", anchor).pos;
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(5);
  });
  it("holds still under reduced motion", () => {
    expect(roamAt(0, "keeper", anchor, { reducedMotion: true })).toEqual(roamAt(99_000, "keeper", anchor, { reducedMotion: true }));
  });
  it("holds at its start point while stopped (the kill switch)", () => {
    const parked = roamAt(0, "keeper", anchor);
    expect(roamAt(99_000, "keeper", anchor, { stopped: true })).toEqual(parked);
    expect(roamAt(250_000, "keeper", anchor, { stopped: true })).toEqual(parked);
  });
});

describe("encounters — they speak", () => {
  const hc = castMember("harbor-controller")!;
  const keeper = castMember("keeper")!;
  const script = {
    dayKey: "d",
    source: "model" as const,
    generatedAt: "x",
    lines: { "harbor-controller": { encounter_patrolling: ["A.", "B."], encounter_first: ["First."] }, keeper: { encounter_visiting: ["Far from my trees."] } },
  };
  it("picks the situation from who they are and where they are", () => {
    expect(encounterSituation(hc, "great-station", "patrolling", false)).toBe("encounter_patrolling");
    expect(encounterSituation(hc, "great-station", "docked", false)).toBe("encounter_docked");
    expect(encounterSituation(hc, "scale", "roaming", false)).toBe("encounter_near");
    expect(encounterSituation(keeper, "growing-place", "roaming", false)).toBe("encounter_near");
    expect(encounterSituation(keeper, "great-station", "roaming", false)).toBe("encounter_visiting");
    expect(encounterSituation(keeper, "growing-place", "roaming", true)).toBe("encounter_first");
    expect(encounterSituation(castMember("eternity")!, "eternity", null, false)).toBe("encounter_arrival");
  });
  it("says a quoted line, naming the speaker; the model's variants rotate with the meeting count", () => {
    expect(encounterLine(hc, "great-station", "patrolling", false, script, 1)).toBe("Harbor controller: “A.”");
    expect(encounterLine(hc, "great-station", "patrolling", false, script, 2)).toBe("Harbor controller: “B.”");
    expect(encounterLine(hc, "great-station", "patrolling", true, script, 1)).toBe("Harbor controller: “First.”");
    expect(encounterLine(keeper, "great-station", "roaming", false, script, 1)).toBe("The Keeper: “Far from my trees.”");
  });
  it("never goes silent without a model: their own greetings, and a first meeting names who they are", () => {
    const line = encounterLine(keeper, "growing-place", "roaming", false, null, 1);
    expect(line.startsWith("The Keeper: “")).toBe(true);
    expect(keeper.greetings.some((g) => line.includes(g))).toBe(true);
    expect(encounterLine(keeper, "growing-place", "roaming", true, null, 1)).toContain(keeper.intro);
    expect(encounterLine(hc, "great-station", "patrolling", false, { ...script, source: "fallback" }, 1)).toContain("Harbor controller: “");
  });
});
