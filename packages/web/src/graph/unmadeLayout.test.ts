import { describe, expect, it } from "vitest";
import { UNMADE, UNMADE_HANDS_RADIUS, UNMADE_HAND_COUNT, UNMADE_HOLDERS, UNMADE_RING_RADIUS, unmadeHands, unmadeHollows } from "./unmadeLayout.js";

describe("the Unmade Hour layout", () => {
  it("lays the same hollows every time, none inside the ring, all on the floor", () => {
    const h = unmadeHollows();
    expect(h.length).toBeGreaterThan(200);
    expect(unmadeHollows()).toEqual(h);
    for (const x of h) {
      const r = Math.hypot(x.x, x.z);
      expect(r).toBeGreaterThan(UNMADE_RING_RADIUS + 10);
      expect(r).toBeLessThan(UNMADE.radius);
    }
  });
  it("sets seven hands round the standing place, six lit and one not, and names every holder once", () => {
    const hands = unmadeHands();
    expect(hands).toHaveLength(UNMADE_HAND_COUNT);
    expect(hands.filter((x) => x.lit)).toHaveLength(6);
    for (const x of hands) expect(Math.hypot(x.x, x.z)).toBeCloseTo(UNMADE_HANDS_RADIUS, 5);
    expect(new Set(UNMADE_HOLDERS).size).toBe(UNMADE_HOLDERS.length);
  });
});
