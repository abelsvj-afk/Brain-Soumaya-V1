import { describe, expect, it } from "vitest";
import { WORLD_COORDS, WARP_COST_MIN, warpCost } from "./worlds.js";

const worlds = Object.keys(WORLD_COORDS);

describe("warpCost — fuel follows distance", () => {
  it("going home or staying put is free", () => {
    for (const w of worlds) {
      expect(warpCost(w, "home")).toBe(0);
      expect(warpCost(w, w)).toBe(0);
    }
  });
  it("is symmetric between two non-home worlds and never below the minimum", () => {
    for (const a of worlds) for (const b of worlds) {
      if (a === "home" || b === "home" || a === b) continue;
      expect(warpCost(a, b)).toBe(warpCost(b, a));
      expect(warpCost(a, b)).toBeGreaterThanOrEqual(WARP_COST_MIN);
    }
  });
  it("farther costs more: Home→Quiet beats Home→Growing Place; Station→Quiet beats Home→Station", () => {
    expect(warpCost("home", "quiet-archive")).toBeGreaterThan(warpCost("home", "growing-place"));
    expect(warpCost("great-station", "quiet-archive")).toBeGreaterThan(warpCost("home", "great-station"));
  });
  it("the published examples hold, and the worst leg is under a tenth of the tank", () => {
    expect(warpCost("home", "great-station")).toBe(8);
    expect(warpCost("home", "growing-place")).toBe(7);
    expect(warpCost("home", "quiet-archive")).toBe(11);
    expect(warpCost("great-station", "quiet-archive")).toBe(18);
    expect(warpCost("quiet-archive", "eternity")).toBe(19);
    const worst = Math.max(...worlds.flatMap((a) => worlds.map((b) => warpCost(a, b))));
    expect(worst).toBeLessThan(20);
  });
  it("an unknown world falls back to the old flat price rather than free", () => {
    expect(warpCost("nowhere", "home")).toBe(0); // home-bound stays free
    expect(warpCost("home", "nowhere")).toBe(10);
    expect(warpCost("nowhere", "scale")).toBe(10);
  });
});
