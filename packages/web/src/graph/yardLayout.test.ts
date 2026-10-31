import { describe, expect, it } from "vitest";
import { YARD, YARD_HOLDERS, YARD_HULL_PARTS, YARD_RIB_COUNT, yardHulls, yardLamps, yardPlateStrokes, yardRibs } from "./yardLayout.js";

describe("the Unlit Hulls layout", () => {
  it("lays six hulls in the order of the doors, all inside the yard", () => {
    const h = yardHulls();
    expect(h).toHaveLength(6);
    expect(h.map((x) => x.part)).toEqual([...YARD_HULL_PARTS]);
    for (const x of h) expect(Math.hypot(x.x, x.z)).toBeLessThan(YARD.radius);
  });
  it("cuts six plates at one slow pace, ribs the seventh slip, hangs the lanterns, and names every holder once", () => {
    const plates = yardPlateStrokes();
    expect(plates).toHaveLength(6);
    for (const p of plates) expect(p).toEqual(plates[0]);
    expect(yardRibs()).toHaveLength(YARD_RIB_COUNT);
    expect(yardLamps().length).toBeGreaterThanOrEqual(6);
    expect(new Set(YARD_HOLDERS).size).toBe(YARD_HOLDERS.length);
  });
});
