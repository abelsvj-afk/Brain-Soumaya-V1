import { describe, it, expect } from "vitest";
import {
  QUIET_ARCHIVE_ARTIFACT,
  QUIET_ARCHIVE_ASSET_URLS,
  QUIET_ARCHIVE_BACKDROP_DRAW_CALLS,
  QUIET_ARCHIVE_BACKDROP_PLANETS,
  QUIET_ARCHIVE_BACKDROP_TRIS_TOTAL,
  QUIET_ARCHIVE_FORMS,
  QUIET_ARCHIVE_PALETTE,
  loadQuietArchiveAsset,
} from "./quietArchiveAssets.js";
import { QUIET_ARCHIVE_BUDGET } from "./quietArchiveLayout.js";

describe("quietArchiveAssets (Wave 2)", () => {
  it("every light kind has a distinct form, and the heaviest stays inside the budget at scale", () => {
    const forms = Object.values(QUIET_ARCHIVE_FORMS);
    expect(new Set(forms.map((f) => f.geometry)).size).toBe(4);
    const heaviest = Math.max(...forms.map((f) => f.trisPerInstance));
    // 2,000 lights of the heaviest form + 20 lamp spheres (192 tris each)
    // must fit the 300k ceiling.
    expect(heaviest * 2000 + 192 * 20).toBeLessThanOrEqual(QUIET_ARCHIVE_BUDGET.maxTris);
  });

  it("the palette is dim cool stillness — one light for every person, no rank in color", () => {
    expect(QUIET_ARCHIVE_PALETTE.lamp).toBe(0xd8c9a3);
    expect(QUIET_ARCHIVE_PALETTE.memory).toBe(0xd8c9a3);
    expect(QUIET_ARCHIVE_PALETTE.ground).toBe(0x141a22);
    // The ground is dark and the lamps are low lamplight: the field reads as lamps at night.
    expect(QUIET_ARCHIVE_PALETTE.ground).toBeLessThan(QUIET_ARCHIVE_PALETTE.memory);
    // Guidance is cyan, and only cyan means navigation truth.
    expect(QUIET_ARCHIVE_PALETTE.guidance).toBe(0x7af9ff);
  });

  it("the first artifact is Sputnik, kept as-is at 2 calls, under public/", () => {
    expect(QUIET_ARCHIVE_ARTIFACT.key).toBe("sputnik");
    expect(QUIET_ARCHIVE_ARTIFACT.name).toBe("Sputnik 1");
    expect(QUIET_ARCHIVE_ARTIFACT.url).toBe("/lowpoly-sputnik.glb");
    expect(QUIET_ARCHIVE_ARTIFACT.tris).toBe(144);
    expect(QUIET_ARCHIVE_ARTIFACT.materials).toBe(2);
    expect(QUIET_ARCHIVE_ARTIFACT.size).toBe(14);
    expect(QUIET_ARCHIVE_ASSET_URLS).toEqual(["/lowpoly-sputnik.glb", "/pp-pixel-brown-dwarf.glb"]);
  });

  it("the EVE-style backdrop planet is a pixel brown dwarf, 4,000 out, as-is (1 call, 300 tris)", () => {
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS.map((m) => m.key)).toEqual(["pixel-brown-dwarf"]);
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.url).toBe("/pp-pixel-brown-dwarf.glb");
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.tris).toBe(300);
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.materials).toBe(1);
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.distance).toBe(4000);
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.y).toBe(500);
    expect(QUIET_ARCHIVE_BACKDROP_PLANETS[0]!.size).toBe(600);
    expect(QUIET_ARCHIVE_BACKDROP_DRAW_CALLS).toBe(1);
    expect(QUIET_ARCHIVE_BACKDROP_TRIS_TOTAL).toBe(300);
    expect(QUIET_ARCHIVE_ASSET_URLS).toContain("/pp-pixel-brown-dwarf.glb");
  });

  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    await expect(loadQuietArchiveAsset(QUIET_ARCHIVE_ARTIFACT.url)).resolves.toBeNull();
  });
});
