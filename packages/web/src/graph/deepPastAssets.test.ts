import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_BUDGET,
  deepPastFloorY,
} from "./deepPastLayout.js";
import * as deepPastAssets from "./deepPastAssets.js";
import {
  DEEP_PAST_ASSET_URLS,
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_GLB_BYTES_TOTAL,
  DEEP_PAST_GLB_DRAW_CALLS,
  DEEP_PAST_GLB_POINTS_TOTAL,
  DEEP_PAST_GLB_TRIS_TOTAL,
  DEEP_PAST_MODELS,
  DEEP_PAST_ORB,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SUPERNOVA,
  fitDeepPastAsset,
  fitDeepPastAssetToHeight,
  fitDeepPastAssetToSize,
  fitDeepPastAssetToSpan,
  loadDeepPastAsset,
} from "./deepPastAssets.js";

/** The public/ folder the suite runs against (package root = packages/web). */
const PUBLIC_DIR = [resolve(process.cwd(), "public"), resolve(process.cwd(), "packages/web/public")].find((p) =>
  existsSync(p),
)!;

interface GlbSummary {
  bytes: number;
  meshes: number;
  primitives: number;
  tris: number;
  points: number;
}

/** Parse a GLB's JSON chunk and measure it the way the manifest does. */
function summarizeGlb(url: string): GlbSummary {
  const buf = readFileSync(resolve(PUBLIC_DIR, `.${url}`));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)) as {
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number; mode?: number }[] }[];
    accessors: { count: number }[];
  };
  let primitives = 0;
  let tris = 0;
  let points = 0;
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      primitives++;
      const posCount = json.accessors[prim.attributes.POSITION]!.count;
      if ((prim.mode ?? 4) === 0) points += posCount;
      else if (prim.indices !== undefined) tris += json.accessors[prim.indices]!.count / 3;
    }
  }
  return { bytes: buf.length, meshes: json.meshes.length, primitives, tris: Math.round(tris), points };
}

describe("deepPastAssets manifest (rework: four singular keeps)", () => {
  it("keeps ONLY the basin dish, the anchor spire, the First Light orb, and the re-slimmed supernova", () => {
    expect(DEEP_PAST_MODELS.map((m) => m.key)).toEqual(["basin", "spire", "orb", "supernova"]);
    expect(DEEP_PAST_MODELS.map((m) => m.url)).toEqual([
      "/first-light-basin-web-256.glb",
      "/sf-anchor-spire.glb",
      "/sf-first-light-orb-slim.glb",
      "/sf-supernova-remnant-rework.glb",
    ]);
    expect(new Set(DEEP_PAST_ASSET_URLS).size).toBe(4);
    expect(DEEP_PAST_ASSET_URLS).toEqual(DEEP_PAST_MODELS.map((m) => m.url));
    // The removed architecture/dressing pieces are gone from the
    // manifest AND from the module surface — no dormant placements.
    for (const gone of ["terrace", "rim", "stair", "lantern", "crystal", "bead"]) {
      expect(DEEP_PAST_MODELS.some((m) => m.key === gone)).toBe(false);
      expect(DEEP_PAST_ASSET_URLS.some((u) => u.includes(gone))).toBe(false);
    }
    for (const goneExport of [
      "deepPastTerraceSlices",
      "deepPastStairFlights",
      "deepPastDressingLanterns",
      "DEEP_PAST_TERRACE",
      "DEEP_PAST_RIM",
      "DEEP_PAST_LANTERN",
      "DEEP_PAST_CRYSTALS",
      "DEEP_PAST_BEAD",
      "instantiateDeepPastRoot",
    ]) {
      expect(goneExport in deepPastAssets).toBe(false);
    }
  });

  it("carries the measured counts: 127,286 GLB tris, 54,226 points, 4 draw calls, 3,385,300 bytes", () => {
    expect(DEEP_PAST_MODELS.map((m) => m.tris)).toEqual([22500, 80210, 24576, 0]);
    expect(DEEP_PAST_GLB_TRIS_TOTAL).toBe(127286);
    expect(DEEP_PAST_MODELS.map((m) => m.points ?? 0)).toEqual([0, 0, 0, 54226]);
    expect(DEEP_PAST_GLB_POINTS_TOTAL).toBe(54226);
    expect(DEEP_PAST_GLB_POINTS_TOTAL).toBeLessThanOrEqual(60_000);
    expect(DEEP_PAST_GLB_POINTS_TOTAL).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxPoints);
    expect(DEEP_PAST_MODELS.map((m) => m.drawCalls ?? m.materials)).toEqual([1, 1, 1, 1]);
    expect(DEEP_PAST_GLB_DRAW_CALLS).toBe(4);
    expect(DEEP_PAST_GLB_BYTES_TOTAL).toBe(3385300);
    expect(DEEP_PAST_GLB_BYTES_TOTAL).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxGlbBytes);
  });

  it("the manifest matches the real files in public/ — tris, points, primitives, and bytes read off disk", () => {
    let bytesTotal = 0;
    for (const model of DEEP_PAST_MODELS) {
      const summary = summarizeGlb(model.url);
      expect(summary.tris, model.key).toBe(model.tris);
      expect(summary.points, model.key).toBe(model.points ?? 0);
      expect(summary.bytes, model.key).toBe(model.bytes);
      bytesTotal += summary.bytes;
    }
    expect(bytesTotal).toBe(DEEP_PAST_GLB_BYTES_TOTAL);
    expect(bytesTotal).toBeLessThanOrEqual(3_700_000);
    // The supernova re-slim is exactly ONE points primitive (1 draw
    // call) at ≤60,000 points and ≤800,000 bytes.
    const supernova = summarizeGlb("/sf-supernova-remnant-rework.glb");
    expect(supernova.meshes).toBe(1);
    expect(supernova.primitives).toBe(1);
    expect(supernova.points).toBe(54226);
    expect(supernova.points).toBeLessThanOrEqual(60_000);
    expect(supernova.bytes).toBeLessThanOrEqual(800_000);
    // The dish and the orb are single-primitive pieces too; the spire
    // file's measured draw calls come from its single mesh/material.
    expect(summarizeGlb("/first-light-basin-web-256.glb").primitives).toBe(1);
    expect(summarizeGlb("/sf-first-light-orb-slim.glb").primitives).toBe(1);
    expect(summarizeGlb("/sf-anchor-spire.glb").primitives).toBe(1);
  });

  it("places the keeps at the rework's ×1 placements, derived from the layout constants", () => {
    // Basin: the dish spans the basin's full width; its holder seats
    // the dish's rim at the generated floor's top (-166.7): the file's
    // measured fitted half-height is ≈17.20, so the holder rides at
    // -166.7 - 17.20 ≈ -183.9.
    expect(DEEP_PAST_BASIN_SPAN).toBe(DEEP_PAST_BASIN_RADIUS * 2);
    expect(DEEP_PAST_BASIN_SPAN).toBe(132);
    expect(DEEP_PAST_BASIN_GLB_Y).toBeCloseTo(DEEP_PAST_BASIN_Y + 1.3 - 17.2, 1);
    expect(DEEP_PAST_BASIN_GLB_Y).toBeCloseTo(-183.9, 1);
    // Orb: basin center, basin + 11, spanning 17 (≈0.13 × basin span).
    expect(DEEP_PAST_ORB.y).toBe(DEEP_PAST_BASIN_Y + 11);
    expect(DEEP_PAST_ORB.size).toBe(17);
    // Spire: stratum 1 (angle 1×0.85 + 0.7, radius R1 − 14 = 70.5),
    // standing on stratum 1's floor, fitted by height to 24, tip
    // glow span ~6 — and NO point light constant exists for it.
    expect(DEEP_PAST_SPIRE.angle).toBeCloseTo(1 * 0.85 + 0.7, 10);
    expect(DEEP_PAST_SPIRE.radius).toBe(70.5);
    expect(DEEP_PAST_SPIRE.y).toBe(deepPastFloorY(1));
    expect(DEEP_PAST_SPIRE.height).toBe(24);
    expect(DEEP_PAST_SPIRE.glowSpan).toBe(6);
    expect("DEEP_PAST_SPIRE_LIGHT" in deepPastAssets).toBe(false);
    // Supernova: angle 7×0.85 + 2.2, radius 95, stratum 7's line + 16, span 58.
    expect(DEEP_PAST_SUPERNOVA.angle).toBeCloseTo(7 * 0.85 + 2.2, 10);
    expect(DEEP_PAST_SUPERNOVA.radius).toBe(95);
    expect(DEEP_PAST_SUPERNOVA.y).toBe(-126 + 16);
    expect(DEEP_PAST_SUPERNOVA.size).toBe(58);
  });
});

describe("loadDeepPastAsset", () => {
  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    await expect(loadDeepPastAsset(DEEP_PAST_MODELS[0]!.url)).resolves.toBeNull();
  });
});

describe("fitDeepPastAsset", () => {
  it("centres a root on the origin and scales it uniformly", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.position.set(10, 20, 30);
    const root = new THREE.Group();
    root.add(mesh);
    expect(fitDeepPastAsset(root, 5)).toBe(5);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(10, 5);
    expect(size.y).toBeCloseTo(20, 5);
    expect(size.z).toBeCloseTo(30, 5);
  });

  it("spans a root to a target width whatever it measures", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.17, 0.3, 1.17),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    const scale = fitDeepPastAssetToSpan(root, 132);
    expect(scale).toBeCloseTo(132 / 1.17, 2);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(132, 2);
  });

  it("fits a root to a target longest side whatever it measures", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 4, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    mesh.position.set(10, 20, 30);
    const root = new THREE.Group();
    root.add(mesh);
    expect(fitDeepPastAssetToSize(root, 30)).toBeCloseTo(5, 5);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(30, 5);
  });

  it("fits a root by height — the spire's fit: measured height becomes exactly the target", () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 2.0, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    const root = new THREE.Group();
    root.add(mesh);
    const scale = fitDeepPastAssetToHeight(root, 24);
    expect(scale).toBeCloseTo(12, 5);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(24, 5);
    // Uniform: the other axes scale by the same factor — never stretched.
    expect(size.x).toBeCloseTo(4.8, 5);
  });
});
