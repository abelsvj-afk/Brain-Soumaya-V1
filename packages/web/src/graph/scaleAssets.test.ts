import { describe, it, expect } from "vitest";
import {
  SCALE_BELT_ASSETS,
  SCALE_ENCOUNTER_ASSETS,
  SCALE_EXTERNAL_ASSETS,
  SCALE_ISS_ASSET,
  SCALE_LOW_POLY_URLS,
  SCALE_MOON_ASSET,
  SCALE_MOON_OUTPOST_ASSETS,
  SCALE_PALETTE,
  SCALE_PLANET_ASSETS,
  SCALE_PROBE_ASSETS,
  SCALE_SATELLITE_ASSET,
} from "./scaleAssets.js";

describe("scaleAssets", () => {
  it("the palette is true black, solar gold, the station's own white — cyan only for navigation truth", () => {
    expect(SCALE_PALETTE.backdrop).toBe(0x000000);
    expect(SCALE_PALETTE.solarGold).toBe(0xffc95e);
    expect(SCALE_PALETTE.stationWhite).toBe(0xf2f0ea);
    expect(SCALE_PALETTE.guidanceCyan).toBe(0x7af9ff);
  });

  it("the ISS asset is the (A) model — 6,642 tris, public domain, the measured file", () => {
    expect(SCALE_ISS_ASSET.url).toBe("/ISS-A.glb");
    expect(SCALE_ISS_ASSET.tris).toBe(6642);
    expect(SCALE_ISS_ASSET.bytes).toBe(39708);
    expect(SCALE_ISS_ASSET.sha256).toBe(
      "70d0619a69312a45cbf740ba9a491fad854e10226dc5936c213fb1f93f063678",
    );
    expect(SCALE_ISS_ASSET.license).toMatch(/Public domain/);
  });

  it("the four probes are the measured NASA files — no invented asset, no heavy variant", () => {
    expect(SCALE_PROBE_ASSETS.map((p) => p.slug)).toEqual(["kepler", "pioneer-10", "dawn", "voyager"]);
    expect(SCALE_PROBE_ASSETS.map((p) => p.tris)).toEqual([9042, 8189, 32096, 29911]);
    for (const probe of SCALE_PROBE_ASSETS) {
      expect(probe.url.startsWith("/nasa-probes/")).toBe(true);
      expect(probe.license).toMatch(/Public domain/);
    }
    // Probes fit the recipe's ≤100k-tris allocation with room to spare.
    const total = SCALE_PROBE_ASSETS.reduce((s, p) => s + p.tris, 0);
    expect(total).toBeLessThan(100_000);
  });

  it("the manifest lists every external asset once — the upload list, nothing else", () => {
    expect(SCALE_EXTERNAL_ASSETS.map((a) => a.key)).toEqual([
      "iss-a",
      "kepler",
      "pioneer-10",
      "dawn",
      "voyager",
    ]);
    expect(new Set(SCALE_EXTERNAL_ASSETS.map((a) => a.url)).size).toBe(5);
  });

  it("the low-poly population is the measured pack — 15 models, 8,536 tris drawn, every file flat in public/", () => {
    expect(SCALE_PLANET_ASSETS.map((p) => p.key)).toEqual([
      "planet_earth",
      "planet_mars",
      "planet_jupiter",
      "planet_saturn",
    ]);
    expect(SCALE_PLANET_ASSETS.map((p) => p.tris)).toEqual([140, 140, 464, 400]);
    expect(SCALE_PLANET_ASSETS.map((p) => p.materials)).toEqual([3, 3, 3, 2]);
    expect(SCALE_MOON_ASSET.key).toBe("moon_cratered");
    expect(SCALE_MOON_ASSET.tris).toBe(192);
    expect(SCALE_MOON_OUTPOST_ASSETS.map((m) => m.key)).toEqual([
      "moon_base_dome",
      "moon_rover",
      "flag_pole",
    ]);
    expect(SCALE_MOON_OUTPOST_ASSETS.map((m) => m.tris)).toEqual([148, 232, 72]);
    expect(SCALE_BELT_ASSETS.map((m) => m.key)).toEqual(["asteroid_big", "asteroid_small"]);
    expect(SCALE_BELT_ASSETS.map((m) => m.materials)).toEqual([2, 1]);
    expect(SCALE_ENCOUNTER_ASSETS.map((m) => m.key)).toEqual([
      "alien",
      "astronaut",
      "flexunit-ufo",
      "ufo",
    ]);
    expect(SCALE_ENCOUNTER_ASSETS.find((m) => m.key === "flexunit-ufo")!.tris).toBe(4220);
    expect(SCALE_SATELLITE_ASSET.key).toBe("satellite_a");
    expect(SCALE_SATELLITE_ASSET.tris).toBe(152);
    // Measured totals: planets 1,144 + moon 192 + outpost 452 + belts 60
    // + encounters 4,796 + satellite 152 = 6,796 file tris; the belts
    // instance 30× each (1,800 drawn) and the rest draw once, so the
    // drawn total is 8,536 (see the scene sketch).
    const fileTotal = [
      ...SCALE_PLANET_ASSETS,
      SCALE_MOON_ASSET,
      ...SCALE_MOON_OUTPOST_ASSETS,
      ...SCALE_BELT_ASSETS,
      ...SCALE_ENCOUNTER_ASSETS,
      SCALE_SATELLITE_ASSET,
    ].reduce((n, m) => n + m.tris, 0);
    expect(fileTotal).toBe(6796);
    expect(SCALE_LOW_POLY_URLS).toHaveLength(15);
    expect(new Set(SCALE_LOW_POLY_URLS).size).toBe(15);
    expect(SCALE_LOW_POLY_URLS.every((u) => u.startsWith("/") && u.endsWith(".glb"))).toBe(true);
    // Every low-poly URL carries its measured SHA-256 (the upload check).
    for (const m of [
      ...SCALE_PLANET_ASSETS,
      SCALE_MOON_ASSET,
      ...SCALE_MOON_OUTPOST_ASSETS,
      ...SCALE_BELT_ASSETS,
      ...SCALE_ENCOUNTER_ASSETS,
      SCALE_SATELLITE_ASSET,
    ]) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.bytes).toBeGreaterThan(0);
    }
  });
});
