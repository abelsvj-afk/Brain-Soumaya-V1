import { describe, expect, it } from "vitest";
import { VILLAGE, VILLAGE_HOLDERS, VILLAGE_SQUARE_Z, villageHooks, villageHouses } from "./villageLayout.js";

describe("the Village layout", () => {
  it("builds the same houses every time, none in the square, all inside the hillside", () => {
    const h = villageHouses();
    expect(h.length).toBeGreaterThanOrEqual(30);
    expect(villageHouses()).toEqual(h);
    for (const x of h) {
      expect(Math.abs(x.x)).toBeLessThan(VILLAGE.halfWidth);
      expect(Math.abs(x.z - VILLAGE_SQUARE_Z) >= 100).toBe(true);
    }
  });
  it("climbs a path of hooks and names every holder", () => {
    const hooks = villageHooks();
    expect(hooks.length).toBeGreaterThan(15);
    expect(hooks[hooks.length - 1]!.y).toBeGreaterThan(hooks[0]!.y);
    expect(new Set(VILLAGE_HOLDERS).size).toBe(VILLAGE_HOLDERS.length);
  });
});
