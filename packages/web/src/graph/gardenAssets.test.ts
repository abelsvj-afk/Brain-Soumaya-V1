import { describe, it, expect } from "vitest";
import {
  GARDEN_ASSET_URLS,
  GARDEN_BACKDROP_DRAW_CALLS,
  GARDEN_BACKDROP_PLANETS,
  GARDEN_BACKDROP_TRIS_TOTAL,
  loadGardenAsset,
} from "./gardenAssets.js";
import { GARDEN_BUDGET } from "./gardenLayout.js";

describe("gardenAssets (population increment)", () => {
  it("the EVE-style backdrop planets are a planets-set, a Quaternius planet, and THE ice world, 4,000 out, as-is (5 calls, 63,334 tris)", () => {
    expect(GARDEN_BACKDROP_PLANETS.map((m) => m.key)).toEqual([
      "planets-set",
      "quaternius-planet-2",
      "ice-planet-procedural",
    ]);
    expect(GARDEN_BACKDROP_PLANETS.map((m) => m.url)).toEqual([
      "/pp-planets-set.glb",
      "/pp-planet-2.glb",
      "/sf-ice-planet-procedural.glb",
    ]);
    expect(GARDEN_BACKDROP_PLANETS.map((m) => m.tris)).toEqual([1164, 2010, 60160]);
    expect(GARDEN_BACKDROP_PLANETS.map((m) => m.materials)).toEqual([2, 1, 2]);
    expect(GARDEN_BACKDROP_TRIS_TOTAL).toBe(63_334);
    expect(GARDEN_BACKDROP_DRAW_CALLS).toBe(5);
    for (const m of GARDEN_BACKDROP_PLANETS) {
      expect(m.url.startsWith("/")).toBe(true);
      expect(m.url.endsWith(".glb")).toBe(true);
      expect(GARDEN_ASSET_URLS).toContain(m.url);
      // 4,000 out, ~7° up — the slow orbit (radius 1,150) never
      // brings the camera closer than ~2,850.
      expect(m.distance).toBe(4000);
      expect(m.y).toBe(500);
    }
    // Spread around the sky: the set and the Quaternius planet ~180°
    // apart, the ice world a quarter-turn from the set.
    expect(GARDEN_BACKDROP_PLANETS[1]!.angle).toBeCloseTo(
      GARDEN_BACKDROP_PLANETS[0]!.angle + Math.PI,
      10,
    );
    expect(GARDEN_BACKDROP_PLANETS[2]!.angle).toBeCloseTo(
      GARDEN_BACKDROP_PLANETS[0]!.angle + Math.PI / 2,
      10,
    );
    // The ice world is the imperioame planet, not the dropped trains
    // planet and not the dropped diorama — those two never appear here.
    expect(GARDEN_BACKDROP_PLANETS[2]!.key).toBe("ice-planet-procedural");
    expect(GARDEN_BACKDROP_PLANETS.every((m) => m.key !== "ice-planet")).toBe(true);
    expect(GARDEN_BACKDROP_PLANETS.every((m) => !m.url.includes("dannzjs"))).toBe(true);
  });

  it("every asset URL is a distinct GLB under public/", () => {
    expect(GARDEN_ASSET_URLS.every((u) => u.startsWith("/") && u.endsWith(".glb"))).toBe(true);
    expect(new Set(GARDEN_ASSET_URLS).size).toBe(GARDEN_ASSET_URLS.length);
  });

  it("the backdrop planets fit the recipe budget on their own", () => {
    expect(GARDEN_BACKDROP_DRAW_CALLS).toBeLessThanOrEqual(GARDEN_BUDGET.maxDrawCalls);
    expect(GARDEN_BACKDROP_TRIS_TOTAL).toBeLessThanOrEqual(GARDEN_BUDGET.maxTris);
  });

  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    await expect(loadGardenAsset(GARDEN_BACKDROP_PLANETS[0]!.url)).resolves.toBeNull();
  });
});
