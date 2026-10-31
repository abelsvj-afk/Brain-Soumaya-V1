import { describe, expect, it } from "vitest";
import { SIEGE, SIEGE_CUP_COUNT, SIEGE_HOLDERS, SIEGE_ORBIT_RADIUS, siegeCups, siegeEdges, siegeGhostEdges, siegeMiniature } from "./siegeLayout.js";

describe("the Siege layout", () => {
  it("stands the same ranks every time, clear of the orbit and inside the field", () => {
    const e = siegeEdges();
    expect(e.length).toBeGreaterThan(100);
    expect(siegeEdges()).toEqual(e);
    for (const x of e) {
      expect(Math.hypot(x.x, x.z)).toBeGreaterThan(SIEGE_ORBIT_RADIUS * 2.2);
      expect(Math.hypot(x.x, x.z)).toBeLessThan(SIEGE.radius);
    }
    expect(siegeGhostEdges().length).toBeGreaterThan(40);
  });
  it("sets cups of different sizes, a miniature field, and names every holder once", () => {
    const cups = siegeCups();
    expect(cups).toHaveLength(SIEGE_CUP_COUNT);
    expect(new Set(cups.map((c) => c.r.toFixed(3))).size).toBeGreaterThan(5);
    expect(siegeMiniature().length).toBeGreaterThan(20);
    expect(new Set(SIEGE_HOLDERS).size).toBe(SIEGE_HOLDERS.length);
  });
});
