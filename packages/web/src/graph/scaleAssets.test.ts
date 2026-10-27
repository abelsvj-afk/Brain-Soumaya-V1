import { describe, it, expect } from "vitest";
import {
  SCALE_EXTERNAL_ASSETS,
  SCALE_ISS_ASSET,
  SCALE_PALETTE,
  SCALE_PROBE_ASSETS,
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
});
