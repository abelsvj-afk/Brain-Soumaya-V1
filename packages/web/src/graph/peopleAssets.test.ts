import { describe, it, expect } from "vitest";
import {
  PEOPLE_BACKDROP_DRAW_CALLS,
  PEOPLE_BACKDROP_PLANETS,
  PEOPLE_BACKDROP_TRIS_TOTAL,
  PEOPLE_EXTERNAL_ASSETS,
  PEOPLE_FORMS,
  PEOPLE_HEARTH,
  PEOPLE_PALETTE,
  loadPeopleAsset,
} from "./peopleAssets.js";
import { PEOPLE_BUDGET } from "./peopleLayout.js";

describe("peopleAssets (P3-3)", () => {
  it("the only external assets are the EVE-style backdrop planets — Earth and Moon plus a Quaternius planet, 4,000 out, as-is (4 calls, 3,702 tris)", () => {
    expect(PEOPLE_BACKDROP_PLANETS.map((m) => m.key)).toEqual([
      "earth-and-moon",
      "quaternius-planet-3",
    ]);
    expect(PEOPLE_BACKDROP_PLANETS.map((m) => m.url)).toEqual([
      "/pp-earth-and-moon.glb",
      "/pp-planet-3.glb",
    ]);
    expect(PEOPLE_BACKDROP_PLANETS.map((m) => m.tris)).toEqual([1524, 2178]);
    expect(PEOPLE_BACKDROP_PLANETS.map((m) => m.materials)).toEqual([3, 1]);
    expect(PEOPLE_BACKDROP_TRIS_TOTAL).toBe(3_702);
    expect(PEOPLE_BACKDROP_DRAW_CALLS).toBe(4);
    for (const m of PEOPLE_BACKDROP_PLANETS) {
      expect(m.distance).toBe(4000);
      expect(m.y).toBe(500);
    }
    expect(PEOPLE_BACKDROP_PLANETS[1]!.angle).toBeCloseTo(
      PEOPLE_BACKDROP_PLANETS[0]!.angle + Math.PI,
      10,
    );
    expect(PEOPLE_EXTERNAL_ASSETS).toEqual(
      PEOPLE_BACKDROP_PLANETS.map((m) => ({ key: m.key, url: m.url, license: m.license })),
    );
  });

  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    await expect(loadPeopleAsset(PEOPLE_BACKDROP_PLANETS[0]!.url)).resolves.toBeNull();
  });

  it("every light kind has a distinct form, and the heaviest stays inside the budget at scale", () => {
    const forms = Object.values(PEOPLE_FORMS);
    expect(new Set(forms.map((f) => f.geometry)).size).toBe(4);
    const heaviest = Math.max(...forms.map((f) => f.trisPerInstance));
    // 2,000 lights of the heaviest form + hearths must fit the 400k ceiling.
    expect(heaviest * 2000 + PEOPLE_HEARTH.trisPerInstance * 100).toBeLessThanOrEqual(PEOPLE_BUDGET.maxTris);
  });

  it("the palette is amber-warm on dark — one light for every person, no rank in color", () => {
    expect(PEOPLE_PALETTE.hearth).toBe(0xffc98a);
    expect(PEOPLE_PALETTE.memory).toBe(0xffd9a0);
    expect(PEOPLE_PALETTE.ground).toBe(0x1a120c);
    // The ground is dark and the lights are warm: the field reads as lights at dusk.
    expect(PEOPLE_PALETTE.ground).toBeLessThan(PEOPLE_PALETTE.memory);
  });
});
