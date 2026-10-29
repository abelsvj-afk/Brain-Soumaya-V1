import { describe, it, expect } from "vitest";
import { NO_LOOK, LOOK_LIMITS, applyLook, dragLook, zoomLook, isLooked, pinchDistance } from "./worldLook.js";

const PIVOT = [0, 10, 0] as const;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("applyLook — the world's own pose is the baseline", () => {
  it("no look leaves the pose exactly where the world put it", () => {
    const pos = [30, 18, 40] as const;
    const out = applyLook(pos, PIVOT, NO_LOOK);
    expect(out[0]).toBeCloseTo(30, 9);
    expect(out[1]).toBeCloseTo(18, 9);
    expect(out[2]).toBeCloseTo(40, 9);
  });
  it("isLooked is false until the traveller moves the view", () => {
    expect(isLooked(NO_LOOK)).toBe(false);
    expect(isLooked(dragLook(NO_LOOK, 5, 0))).toBe(true);
  });
});

describe("applyLook — swinging around the pivot", () => {
  it("yaw keeps the distance to the pivot and the height — it only turns", () => {
    const pos = [30, 18, 40] as const;
    for (const yaw of [0.3, -1.1, Math.PI]) {
      const out = applyLook(pos, PIVOT, { ...NO_LOOK, yaw });
      expect(dist(out, PIVOT)).toBeCloseTo(dist(pos, PIVOT), 6);
      expect(out[1]).toBeCloseTo(18, 6);
    }
  });
  it("pitch keeps the distance to the pivot and raises the camera", () => {
    const pos = [0, 10, 50] as const; // level with the pivot, 50 away
    const out = applyLook(pos, PIVOT, { ...NO_LOOK, pitch: 0.5 });
    expect(dist(out, PIVOT)).toBeCloseTo(50, 6);
    expect(out[1]).toBeGreaterThan(10);
  });
  it("pitch can never flip the camera over the top or under the bottom", () => {
    const pos = [0, 10, 50] as const;
    const up = applyLook(pos, PIVOT, { ...NO_LOOK, pitch: 50 });
    const down = applyLook(pos, PIVOT, { ...NO_LOOK, pitch: -50 });
    const maxY = PIVOT[1] + Math.sin(LOOK_LIMITS.maxElevation) * 50;
    expect(up[1]).toBeCloseTo(maxY, 6);
    expect(down[1]).toBeCloseTo(PIVOT[1] - Math.sin(LOOK_LIMITS.maxElevation) * 50, 6);
    // still on the sphere, never degenerate
    expect(dist(up, PIVOT)).toBeCloseTo(50, 6);
  });
  it("is a pure function of the pose: the same offset applied to an orbiting camera tracks the orbit", () => {
    const look = { yaw: 0.8, pitch: 0.2, zoom: 1 };
    const a = applyLook([40, 12, 0], PIVOT, look);
    const b = applyLook([0, 12, 40], PIVOT, look); // the world's orbit moved a quarter turn
    // the user's view stays the same angle RELATIVE to the world's own orbit
    const angA = Math.atan2(a[0], a[2]) - Math.atan2(40, 0);
    const angB = Math.atan2(b[0], b[2]) - Math.atan2(0, 40);
    expect(angA).toBeCloseTo(angB, 6);
  });
});

describe("zoom", () => {
  it("scales the distance to the pivot", () => {
    const out = applyLook([0, 10, 100], PIVOT, { ...NO_LOOK, zoom: 0.5 });
    expect(dist(out, PIVOT)).toBeCloseTo(50, 6);
  });
  it("zoomLook: factor > 1 comes closer, < 1 pulls back", () => {
    expect(zoomLook(NO_LOOK, 2).zoom).toBeCloseTo(0.5, 9);
    expect(zoomLook(NO_LOOK, 0.5).zoom).toBeCloseTo(2, 9);
  });
  it("is clamped: you can't press into the pivot or drift off into nothing", () => {
    let s = NO_LOOK;
    for (let i = 0; i < 40; i++) s = zoomLook(s, 1.5);
    expect(s.zoom).toBe(LOOK_LIMITS.zoomMin);
    for (let i = 0; i < 80; i++) s = zoomLook(s, 0.5);
    expect(s.zoom).toBe(LOOK_LIMITS.zoomMax);
  });
  it("ignores a nonsense factor instead of poisoning the state with NaN", () => {
    for (const f of [0, -2, NaN, Infinity]) expect(zoomLook(NO_LOOK, f)).toEqual(NO_LOOK);
  });
  it("applyLook clamps a hostile zoom too", () => {
    const out = applyLook([0, 10, 100], PIVOT, { ...NO_LOOK, zoom: 1e9 });
    expect(dist(out, PIVOT)).toBeCloseTo(100 * LOOK_LIMITS.zoomMax, 6);
  });
});

describe("camera floor (the garden's)", () => {
  it("no look can sink the camera under the floor", () => {
    const out = applyLook([0, 20, 60], PIVOT, { ...NO_LOOK, pitch: -2 }, 15);
    expect(out[1]).toBeGreaterThanOrEqual(15);
  });
  it("a floor below the camera changes nothing", () => {
    const a = applyLook([0, 20, 60], PIVOT, NO_LOOK, -1000);
    const b = applyLook([0, 20, 60], PIVOT, NO_LOOK);
    expect(a).toEqual(b);
  });
});

describe("dragLook", () => {
  it("dragging right swings the camera left around the world (the world turns with the finger)", () => {
    const s = dragLook(NO_LOOK, 100, 0);
    expect(s.yaw).toBeLessThan(0);
    expect(s.pitch).toBe(0);
  });
  it("dragging down raises the camera (look down on it)", () => {
    expect(dragLook(NO_LOOK, 0, 100).pitch).toBeGreaterThan(0);
  });
  it("accumulates", () => {
    const s = dragLook(dragLook(NO_LOOK, 10, 0), 10, 0);
    expect(s.yaw).toBeCloseTo(-20 * 0.006, 9);
  });
});

describe("applyLook degenerate input", () => {
  it("a camera exactly on the pivot is returned unchanged, not NaN", () => {
    const out = applyLook([0, 10, 0], PIVOT, { yaw: 1, pitch: 1, zoom: 2 });
    expect(out.every(Number.isFinite)).toBe(true);
  });
  it("pinchDistance is the straight-line distance", () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
