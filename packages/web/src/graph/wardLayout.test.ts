import { describe, expect, it } from "vitest";
import { WARD_COT_END_Z, WARD_HALL, WARD_HOLDERS, WARD_SPECIAL, specialCot, wardCots, wardLanternPositions, wardOccupied } from "./wardLayout.js";

describe("the Faded Ward layout", () => {
  it("has cots on both walls inside the hall, nearest the door first", () => {
    const cots = wardCots();
    expect(cots.length).toBeGreaterThan(80);
    for (const c of cots) {
      expect(Math.abs(c.x)).toBeLessThan(WARD_HALL.halfWidth);
      expect(c.z).toBeGreaterThan(WARD_HALL.zStart);
      expect(c.z).toBeLessThanOrEqual(WARD_COT_END_Z);
    }
    expect(cots.filter((c) => c.side === -1).length).toBe(cots.filter((c) => c.side === 1).length);
  });

  it("is the same every visit, and its special cots are decided by hand", () => {
    const cots = wardCots();
    expect(wardOccupied(cots)).toEqual(wardOccupied(cots));
    const occ = wardOccupied(cots);
    for (const k of Object.keys(WARD_SPECIAL) as (keyof typeof WARD_SPECIAL)[]) {
      const sp = specialCot(k);
      const i = cots.findIndex((c) => c.side === sp.side && c.index === sp.index);
      expect(i, k).toBeGreaterThanOrEqual(0);
      expect(occ[i], k).toBe(false);
    }
  });

  it("hangs lanterns inside the hall and names every holder the lore anchors to", () => {
    for (const l of wardLanternPositions()) expect(Math.abs(l.x)).toBeLessThan(WARD_HALL.halfWidth);
    expect(new Set(WARD_HOLDERS).size).toBe(WARD_HOLDERS.length);
  });
});
