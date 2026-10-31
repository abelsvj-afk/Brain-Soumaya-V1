import { describe, expect, it } from "vitest";
import { FOLD, FOLD_DOOR_AJAR, FOLD_HOLDERS, FOLD_SHELF, foldShelfLetters } from "./foldLayout.js";

describe("the Folded Letter layout", () => {
  it("sets the same kept letters every time, each a hair different, all inside the room", () => {
    const l = foldShelfLetters();
    expect(l).toHaveLength(FOLD_SHELF.count);
    expect(foldShelfLetters()).toEqual(l);
    expect(new Set(l.map((x) => x.h.toFixed(2))).size).toBeGreaterThan(20);
    for (const x of l) expect(Math.abs(x.x)).toBeLessThan(FOLD.half);
  });
  it("leaves the door ajar by a hand's breadth (never shut), and names every holder once", () => {
    expect(FOLD_DOOR_AJAR).toBeGreaterThan(2);
    expect(FOLD_DOOR_AJAR).toBeLessThan(6);
    expect(new Set(FOLD_HOLDERS).size).toBe(FOLD_HOLDERS.length);
  });
});
