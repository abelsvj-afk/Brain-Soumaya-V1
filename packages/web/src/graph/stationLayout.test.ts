import { describe, it, expect } from "vitest";
import {
  APPROACH_STAGES,
  STATION_BUDGET,
  approachPose,
  beaconRing,
  plannedDrawCalls,
  rngFromSeed,
  trafficLanes,
} from "./stationLayout.js";

describe("stationLayout", () => {
  it("is deterministic from the recipe seed", () => {
    const a = beaconRing("great-station / harbor-1");
    const b = beaconRing("great-station / harbor-1");
    expect(a).toEqual(b);
    const r1 = rngFromSeed("x");
    const r2 = rngFromSeed("x");
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it("reserves cyan for cardinal nav markers only (palette grammar)", () => {
    const ring = beaconRing("s", 48, 210);
    const nav = ring.filter((b) => b.role === "nav");
    expect(nav.length).toBe(6); // every 8th of 48
    expect(ring.every((b) => Math.abs(Math.hypot(b.x, b.z) - 210) < 0.001)).toBe(true);
  });

  it("keeps traffic sparse, slow, and mixed-direction (atmosphere, A17)", () => {
    const lanes = trafficLanes("s");
    expect(lanes.length).toBeLessThanOrEqual(6);
    expect(lanes.every((l) => Math.abs(l.speed) < 0.02)).toBe(true);
    expect(lanes.some((l) => l.retrograde)).toBe(true);
  });

  it("approach: three stages, distance strictly decreasing end to end", () => {
    expect(APPROACH_STAGES.map((s) => s.name)).toEqual(["far", "handoff", "arrival"]);
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const d = approachPose(Math.min(1, t)).distance;
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
    expect(approachPose(0).distance).toBe(900);
    expect(approachPose(1).distance).toBe(150);
  });

  it("the draw-call plan fits the recipe budget with headroom", () => {
    expect(plannedDrawCalls()).toBeLessThanOrEqual(STATION_BUDGET.drawCalls);
    expect(STATION_BUDGET.visibleTris).toBe(750_000); // §11 hard boundary, not a target
  });
});
