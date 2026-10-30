import { beforeEach, describe, expect, it } from "vitest";
import {
  ENCOUNTER_COOLDOWN_MS,
  NEAR_ENTER,
  NEAR_EXIT,
  NPC_PRESENCES,
  PATROL_PERIOD_MS,
  encounterLine,
  encounterStep,
  npcsIn,
  patrolAt,
  readMet,
  recordMeeting,
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
    const mid = patrolAt(PATROL_PERIOD_MS * 0.6, BERTH);
    expect(mid.phase).toBe("patrolling");
    expect(dist(mid.pos, home.pos)).toBeGreaterThan(100);
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

describe("roster + lines", () => {
  it("every NPC lives in exactly one world, and npcsIn finds them", () => {
    expect(npcsIn("great-station").map((n) => n.id)).toEqual(["harbor-controller"]);
    expect(npcsIn("eternity").map((n) => n.id)).toEqual(["eternity"]);
    expect(npcsIn("home")).toEqual([]);
    expect(new Set(NPC_PRESENCES.map((n) => n.id)).size).toBe(NPC_PRESENCES.length);
  });
  it("describes, and never speaks for, the controller", () => {
    const hc = NPC_PRESENCES[0]!;
    expect(encounterLine(hc, "patrolling", false)).toMatch(/sweeps past/);
    expect(encounterLine(hc, "docked", false)).toMatch(/moored/);
    expect(encounterLine(hc, null, true)).toMatch(/You've met the Harbor controller/);
    expect(encounterLine(hc, "patrolling", false)).not.toMatch(/[“"]/);
  });
  it("uses the day's model script when it has variants, rotating with the meeting count; offline otherwise", () => {
    const hc = NPC_PRESENCES[0]!;
    const script = {
      dayKey: "d",
      source: "model" as const,
      generatedAt: "x",
      lines: { "harbor-controller": { encounter_patrolling: ["A.", "B."], encounter_first: ["First."] } },
    };
    expect(encounterLine(hc, "patrolling", false, script, 1)).toBe("A.");
    expect(encounterLine(hc, "patrolling", false, script, 2)).toBe("B.");
    expect(encounterLine(hc, "patrolling", false, script, 3)).toBe("A.");
    expect(encounterLine(hc, null, true, script, 1)).toBe("First.");
    // docked has no scripted variants → the offline line; a fallback script is never used.
    expect(encounterLine(hc, "docked", false, script, 1)).toMatch(/moored/);
    expect(encounterLine(hc, "patrolling", false, { ...script, source: "fallback" }, 1)).toMatch(/sweeps past/);
  });
});
