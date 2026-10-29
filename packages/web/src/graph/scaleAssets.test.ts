import { describe, it, expect } from "vitest";
import {
  SCALE_BELT_ASSETS,
  SCALE_BELT_PIECE_ASSETS,
  SCALE_CENTERPIECE_ASSETS,
  SCALE_CLOUD_ASSET,
  SCALE_ENCOUNTER_ASSETS,
  SCALE_EXTERNAL_ASSETS,
  SCALE_HUNT2_HUBBLE_ASSET,
  SCALE_HUNT2_PLANET_ASSETS,
  SCALE_HUNT2_URLS,
  SCALE_ISS_ASSET,
  SCALE_LOW_POLY_URLS,
  SCALE_MOON_ASSET,
  SCALE_MOON_OUTPOST_ASSETS,
  SCALE_NEBULA_PLANE_ASSETS,
  SCALE_PALETTE,
  SCALE_PLANET_ASSETS,
  SCALE_PROBE_ASSETS,
  SCALE_SATELLITE_ASSET,
  SCALE_SKETCHFAB_CENTERPIECE_ASSETS,
  SCALE_SKETCHFAB_PULSAR_ASSET,
  SCALE_SKETCHFAB_URLS,
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

  it("the hunt-2 manifests are the measured files — planets, Hubble, belt pieces, centerpieces, cloud, nebula planes", () => {
    // Planets: 8 files, 10,106 tris, 12 materials (the Dilley system
    // and the single Star were measured and left out — see scaleAssets.ts).
    expect(SCALE_HUNT2_PLANET_ASSETS.map((m) => m.key)).toEqual([
      "quaternius-planet-1",
      "quaternius-planet-2",
      "quaternius-planet-3",
      "planets-set",
      "earth-and-moon",
      "pixel-brown-dwarf",
      "sun",
      "stars",
    ]);
    expect(SCALE_HUNT2_PLANET_ASSETS.reduce((n, m) => n + m.tris, 0)).toBe(10_106);
    expect(SCALE_HUNT2_PLANET_ASSETS.reduce((n, m) => n + m.materials, 0)).toBe(12);
    // Hubble, the one hunt-2 encounter.
    expect(SCALE_HUNT2_HUBBLE_ASSET.key).toBe("hubble");
    expect(SCALE_HUNT2_HUBBLE_ASSET.tris).toBe(684);
    // Belt pieces: 6 files, 27,638 tris — debris pile + rubble merge.
    expect(SCALE_BELT_PIECE_ASSETS.map((m) => m.key)).toEqual([
      "belt-strip",
      "bennu",
      "asteroid-large",
      "debris-pile",
      "asteroid-toastie",
      "rubble-rocks",
    ]);
    expect(SCALE_BELT_PIECE_ASSETS.reduce((n, m) => n + m.tris, 0)).toBe(27_638);
    // Centerpieces (hunt-2 only): black hole + Pillars + G292, 148,452
    // tris; the cloud is its own entry at 816, and the Sketchfab pair
    // lives in SCALE_SKETCHFAB_CENTERPIECE_ASSETS (asserted in the
    // Sketchfab block below) — together the five are 305,304 tris.
    expect(SCALE_CENTERPIECE_ASSETS.map((m) => m.key)).toEqual([
      "black-hole",
      "pillars-1b",
      "g292",
    ]);
    expect(SCALE_CENTERPIECE_ASSETS.reduce((n, m) => n + m.tris, 0)).toBe(148_452);
    expect(
      [...SCALE_CENTERPIECE_ASSETS, ...SCALE_SKETCHFAB_CENTERPIECE_ASSETS].reduce(
        (n, m) => n + m.tris,
        0,
      ),
    ).toBe(305_304);
    expect(SCALE_CLOUD_ASSET.key).toBe("gas-cloud");
    expect(SCALE_CLOUD_ASSET.tris).toBe(816);
    // Nebula planes: 3 JPGs, 2560x1600 each, CC-BY.
    expect(SCALE_NEBULA_PLANE_ASSETS.map((m) => m.key)).toEqual([
      "nebula-01",
      "nebula-02",
      "nebula-03",
    ]);
    for (const m of SCALE_NEBULA_PLANE_ASSETS) {
      expect(m.url.endsWith(".jpg")).toBe(true);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.license).toMatch(/CC-BY 3.0/);
    }
    // Every hunt-2 GLB carries its measured SHA-256 (the upload check).
    for (const m of [
      ...SCALE_HUNT2_PLANET_ASSETS,
      SCALE_HUNT2_HUBBLE_ASSET,
      ...SCALE_BELT_PIECE_ASSETS,
      ...SCALE_CENTERPIECE_ASSETS,
      SCALE_CLOUD_ASSET,
    ]) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.bytes).toBeGreaterThan(0);
      expect(m.tris).toBeGreaterThan(0);
    }
    // The hunt-2 URL manifest: 22 entries, distinct, flat in public/.
    expect(SCALE_HUNT2_URLS).toHaveLength(22);
    expect(new Set(SCALE_HUNT2_URLS).size).toBe(22);
    expect(SCALE_HUNT2_URLS.every((u) => u.startsWith("/") && (u.endsWith(".glb") || u.endsWith(".jpg")))).toBe(true);
    // The static call budget, from the manifests (the scene cannot
    // count unloaded models, so the manifests carry the budget):
    // planets 23 + moon 2 + belts 3 + belt pieces 6 + centerpieces 11
    // (the Sketchfab pair loads as-is at 4 materials each — merging
    // would kill the nebula's layers and the black hole's disk; the
    // nebula-material pieces are 1-material files, so the materials
    // sum IS the call count) + cloud 1 + planes 3 + encounters 7
    // (4 merged + Hubble merged + the pulsar as-is at 2) + satellite 1
    // + outpost 3, plus the ISS 6 + probes 27 + HYG 1 + frame 2 +
    // capsule 1 + fallback truss 3 = exactly 100, the recipe ceiling
    // (raised from 90 for the Sketchfab long game — see scaleLayout.ts).
    const manifestCalls =
      SCALE_PLANET_ASSETS.reduce((n, m) => n + m.materials, 0) +
      SCALE_HUNT2_PLANET_ASSETS.reduce((n, m) => n + m.materials, 0) +
      SCALE_MOON_ASSET.materials +
      SCALE_BELT_ASSETS.reduce((n, m) => n + m.materials, 0) +
      SCALE_BELT_PIECE_ASSETS.reduce((n, m) => n + (m.materials > 1 ? 1 : m.materials), 0) +
      SCALE_CENTERPIECE_ASSETS.reduce((n, m) => n + m.materials, 0) +
      SCALE_SKETCHFAB_CENTERPIECE_ASSETS.reduce((n, m) => n + m.materials, 0) +
      1 + // the cloud, nebula-merged to one material
      SCALE_NEBULA_PLANE_ASSETS.length +
      SCALE_ENCOUNTER_ASSETS.length +
      1 + // Hubble, merged
      2 + // the pulsar, as-is at 2 materials so its glow survives
      1 + // the debris satellite, merged
      SCALE_MOON_OUTPOST_ASSETS.length;
    expect(manifestCalls).toBe(60);
    expect(manifestCalls + 6 + 27 + 1 + 2 + 1 + 3).toBe(100);
    // The static tri budget, from the manifests (belts instance 30x
    // each; everything else draws once): 450,484 total.
    const manifestTris =
      6642 + // ISS
      SCALE_PROBE_ASSETS.reduce((n, m) => n + m.tris, 0) +
      6796 + // increment-1 low-poly file tris
      1800 - 60 + // belts draw 1,800 (30x each), not the 60 file tris
      SCALE_HUNT2_PLANET_ASSETS.reduce((n, m) => n + m.tris, 0) +
      SCALE_HUNT2_HUBBLE_ASSET.tris +
      SCALE_BELT_PIECE_ASSETS.reduce((n, m) => n + m.tris, 0) +
      SCALE_CENTERPIECE_ASSETS.reduce((n, m) => n + m.tris, 0) +
      SCALE_SKETCHFAB_CENTERPIECE_ASSETS.reduce((n, m) => n + m.tris, 0) +
      SCALE_CLOUD_ASSET.tris +
      SCALE_SKETCHFAB_PULSAR_ASSET.tris;
    expect(manifestTris).toBe(450_484);
    expect(manifestTris).toBeLessThan(500_000);
  });

  it("the Sketchfab manifests are the measured files — the owner downloaded them himself", () => {
    // Centerpieces: the Planetary Nebula (146,636 tris, 4 materials)
    // and the Sketchfab black hole (10,216 tris, 4 materials) — both
    // loaded as-is, both with their own animation clips.
    expect(SCALE_SKETCHFAB_CENTERPIECE_ASSETS.map((m) => m.key)).toEqual([
      "planetary-nebula",
      "sf-black-hole",
    ]);
    expect(SCALE_SKETCHFAB_CENTERPIECE_ASSETS.map((m) => m.tris)).toEqual([146636, 10216]);
    expect(SCALE_SKETCHFAB_CENTERPIECE_ASSETS.map((m) => m.materials)).toEqual([4, 4]);
    // The pulsar: 11,520 tris, 2 materials, unlit glow kept as-is.
    expect(SCALE_SKETCHFAB_PULSAR_ASSET.key).toBe("pulsar");
    expect(SCALE_SKETCHFAB_PULSAR_ASSET.tris).toBe(11520);
    expect(SCALE_SKETCHFAB_PULSAR_ASSET.materials).toBe(2);
    // Licenses verified from each file's own asset extras (CC-BY 4.0).
    for (const m of [...SCALE_SKETCHFAB_CENTERPIECE_ASSETS, SCALE_SKETCHFAB_PULSAR_ASSET]) {
      expect(m.license).toMatch(/CC-BY 4\.0/);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.bytes).toBeGreaterThan(0);
      expect(m.tris).toBeGreaterThan(0);
    }
    expect(SCALE_SKETCHFAB_CENTERPIECE_ASSETS[0]!.license).toMatch(/Tycho Magnetic Anomaly/);
    expect(SCALE_SKETCHFAB_CENTERPIECE_ASSETS[1]!.license).toMatch(/SebastianSosnowski/);
    expect(SCALE_SKETCHFAB_PULSAR_ASSET.license).toMatch(/AstroRiah/);
    // The Sketchfab URL manifest: 3 entries, distinct, flat in public/.
    expect(SCALE_SKETCHFAB_URLS).toHaveLength(3);
    expect(new Set(SCALE_SKETCHFAB_URLS).size).toBe(3);
    expect(SCALE_SKETCHFAB_URLS.every((u) => u.startsWith("/sf-") && u.endsWith(".glb"))).toBe(true);
  });
});
