import { describe, expect, it } from "vitest";
import { LONG_HOLDERS, LONG_LEAF_COUNT, LONG_RING_RADIUS, longLeaves, longPeople } from "./longLayout.js";

describe("the Long Morning layout", () => {
  it("closes the ring of leaves: evenly spaced, every leaf the same distance from the middle, no gap", () => {
    const l = longLeaves();
    expect(l).toHaveLength(LONG_LEAF_COUNT);
    for (const x of l) expect(Math.hypot(x.x, x.z)).toBeCloseTo(LONG_RING_RADIUS, 5);
    const gaps = l.map((x, i) => Math.hypot(x.x - l[(i + 1) % l.length]!.x, x.z - l[(i + 1) % l.length]!.z));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-6);
  });
  it("stands the same people every time, of different heights, and names every holder once", () => {
    const p = longPeople();
    expect(longPeople()).toEqual(p);
    expect(new Set(p.map((x) => x.h.toFixed(1))).size).toBeGreaterThan(6);
    expect(new Set(LONG_HOLDERS).size).toBe(LONG_HOLDERS.length);
  });
});
