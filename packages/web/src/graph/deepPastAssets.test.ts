import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildDeepPastLayout, DEEP_PAST_BUDGET } from "./deepPastLayout.js";
import { createDeepPastScene } from "./deepPastScene.js";
import {
  DEEP_PAST_ASSET_URLS,
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_GLB_DRAW_CALLS,
  DEEP_PAST_GLB_TRIS_TOTAL,
  DEEP_PAST_LANTERN,
  DEEP_PAST_MODELS,
  DEEP_PAST_RIM,
  DEEP_PAST_STAIR,
  DEEP_PAST_TERRACE,
  fitDeepPastAsset,
  fitDeepPastAssetToSpan,
  loadDeepPastAsset,
} from "./deepPastAssets.js";
import type { GraphData } from "@brain/shared";

const NOW = new Date("2026-10-25T12:00:00");

/** Draw calls: every object that draws (meshes, instanced meshes, points, lines, sprites). */
function countDrawCalls(group: THREE.Group): number {
  let calls = 0;
  group.traverse((o) => {
    const anyO = o as THREE.Mesh & THREE.InstancedMesh & THREE.Points & THREE.Line & THREE.Sprite;
    if (anyO.isMesh || anyO.isInstancedMesh || anyO.isPoints || anyO.isLine || anyO.isSprite) calls++;
  });
  return calls;
}

/** Triangle estimate: indexed geometry counts × instance count; sprites count 2 each. */
function estimateTris(group: THREE.Group): number {
  let tris = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
      const geo = mesh.geometry as THREE.BufferGeometry;
      const per = (geo.index ? geo.index.count : geo.getAttribute("position")!.count) / 3;
      const instances = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as unknown as THREE.InstancedMesh).count
        : 1;
      tris += per * instances;
    } else if ((o as THREE.Sprite).isSprite) {
      tris += 2;
    }
  });
  return Math.round(tris);
}

describe("deepPastAssets manifest", () => {
  it("is the five shipped v6 pieces, basin first, all GLBs under public/", () => {
    expect(DEEP_PAST_MODELS.map((m) => m.key)).toEqual([
      "basin",
      "terrace",
      "rim",
      "stair",
      "lantern",
    ]);
    expect(new Set(DEEP_PAST_MODELS.map((m) => m.key)).size).toBe(5);
    expect(DEEP_PAST_MODELS.every((m) => m.url.startsWith("/") && m.url.endsWith(".glb"))).toBe(true);
    expect(new Set(DEEP_PAST_ASSET_URLS).size).toBe(5);
    expect(DEEP_PAST_ASSET_URLS).toEqual(DEEP_PAST_MODELS.map((m) => m.url));
  });

  it("carries the measured v6 triangle counts (88,168 total)", () => {
    expect(DEEP_PAST_MODELS.map((m) => m.tris)).toEqual([22500, 22500, 14200, 14626, 14342]);
    expect(DEEP_PAST_GLB_TRIS_TOTAL).toBe(88168);
    expect(DEEP_PAST_GLB_DRAW_CALLS).toBe(6); // five meshes + the lantern's glow sprite
  });

  it("places the pieces at the mockup's verified placements, ×5", () => {
    // Basin: spans the basin's full width, group 75 below the basin line.
    expect(DEEP_PAST_BASIN_SPAN).toBe(640);
    expect(DEEP_PAST_BASIN_GLB_Y).toBe(-905);
    // Terrace: stratum 1, angle 0.85 + 0.35, radius 360, y −38.5, scale 250.
    expect(DEEP_PAST_TERRACE.angle).toBeCloseTo(1.2, 10);
    expect(DEEP_PAST_TERRACE.radius).toBe(360);
    expect(DEEP_PAST_TERRACE.y).toBe(-38.5);
    expect(DEEP_PAST_TERRACE.scale).toBe(250);
    // Rim: scale 880 (outer radius 440), y −45.
    expect(DEEP_PAST_RIM.scale).toBe(880);
    expect(DEEP_PAST_RIM.y).toBe(-45);
    // Stair: (310, −29.5, 125), scale 250.
    expect(DEEP_PAST_STAIR.position).toEqual({ x: 310, y: -29.5, z: 125 });
    expect(DEEP_PAST_STAIR.scale).toBe(250);
    // Lantern: stratum 3, angle 3·0.85 + 0.62·4.4, radius 322.5, y −213.5, scale 100.
    expect(DEEP_PAST_LANTERN.angle).toBeCloseTo(5.278, 10);
    expect(DEEP_PAST_LANTERN.radius).toBe(322.5);
    expect(DEEP_PAST_LANTERN.y).toBe(-213.5);
    expect(DEEP_PAST_LANTERN.scale).toBe(100);
  });
});

describe("loadDeepPastAsset", () => {
  it("a load that cannot even start resolves null and notes the fallback — never throws", async () => {
    // In tests there is no page to resolve the URL against, so three's
    // loader throws synchronously; the loader must degrade, not crash.
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
    // The basin file measures 1.17 wide in-scene; the app's basin spans 640.
    // (Precision 2: the 1.17 is a float32 measurement, not an exact decimal.)
    const scale = fitDeepPastAssetToSpan(root, 640);
    expect(scale).toBeCloseTo(640 / 1.17, 2);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(640, 2);
  });
});

describe("deep past budget with the GLB layer loaded", () => {
  it("the recipe budget still holds for a large graph with all five GLBs in", () => {
    const bigNodes = Array.from({ length: 2000 }, (_, i) => ({
      id: i + 1,
      label: `node ${i + 1}`,
      type: "memory",
      content: "",
      createdAt: "2020-01-01T00:00:00.000Z",
      kind: i < 1800 ? "memory" : i < 1950 ? "action" : "moc",
    }));
    const big = createDeepPastScene(
      buildDeepPastLayout({ nodes: bigNodes, links: [] } as never as GraphData, [], new Map(), NOW),
    );
    // The GLBs load async, so the built group holds the procedural
    // scene only; the manifest's measured cost is added here, so the
    // budget assertion covers the scene as the user actually sees it
    // once the pieces have landed.
    expect(countDrawCalls(big.group) + DEEP_PAST_GLB_DRAW_CALLS).toBeLessThanOrEqual(
      DEEP_PAST_BUDGET.maxDrawCalls,
    );
    expect(estimateTris(big.group) + DEEP_PAST_GLB_TRIS_TOTAL).toBeLessThanOrEqual(
      DEEP_PAST_BUDGET.maxTris,
    );
    big.dispose();
  });
});
