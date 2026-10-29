import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GARDEN_BACKDROP_DRAW_CALLS, GARDEN_BACKDROP_PLANETS, GARDEN_BACKDROP_TRIS_TOTAL } from "./gardenAssets.js";
import { buildGardenLayout, GARDEN_BUDGET } from "./gardenLayout.js";
import { createGardenScene } from "./gardenScene.js";
import type { GraphData, Journey } from "@brain/shared";

const NOW = new Date("2026-10-24T12:00:00");

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

const layout = buildGardenLayout(
  {
    nodes: [
      { id: 1, label: "a", type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: 2, label: "b", type: "memory", content: "", createdAt: "2025-05-01T00:00:00.000Z" },
      { id: 3, label: "c", type: "memory", content: "", createdAt: "2026-10-02T00:00:00.000Z", kind: "action" },
    ] as never[],
    links: [
      { id: 10, source: 1, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-10-01T00:00:00.000Z" },
    ],
  } as GraphData,
  [{ id: 7, title: "Done chapter", description: "", status: "done", progress: 1 } as Journey],
  NOW,
);

describe("garden scene (P3-1)", () => {
  it("mock-up look: every terrace is built even in an empty garden, the forest is 300 instanced trees, and the draw calls stay under the recipe's 95", () => {
    const scene = createGardenScene({ plots: [], paths: [], landmarks: [], eligibleCount: 0 } as never);
    const names = new Set<string>();
    let drawCalls = 0;
    scene.group.traverse((o) => {
      names.add(o.name);
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Points || o instanceof THREE.Line) drawCalls++;
    });
    for (let t = 0; t < 6; t++) expect(names.has(`terrace-${t}`)).toBe(true);
    for (let t = 1; t < 6; t++) expect(names.has(`terrace-riser-${t}`)).toBe(true);
    const veg = scene.group.getObjectByName("vegetation") as THREE.InstancedMesh;
    const trunks = scene.group.getObjectByName("vegetation-trunks") as THREE.InstancedMesh;
    expect(veg.count).toBe(300);
    expect(trunks.count).toBe(300);
    expect(drawCalls).toBeLessThan(95);
    scene.dispose();
  });

  it("builds the garden from the layout: terraces, tree, plots, paths, landmark, dimmed sky", () => {
    const scene = createGardenScene(layout);
    const names = new Set<string>();
    scene.group.traverse((o) => names.add(o.name));
    expect(names.has("witness-tree")).toBe(true);
    expect(names.has("vegetation")).toBe(true);
    expect(names.has("paths")).toBe(true);
    expect(names.has("landmark-7")).toBe(true);
    expect(names.has("terrace-0")).toBe(true);
    // The HYG sky is present but humbled by dawn.
    const stars = scene.group.children.find((o) => o instanceof THREE.Points);
    expect(stars).toBeTruthy();
    expect((stars!.material as THREE.PointsMaterial).opacity).toBe(0.35);
    // Plot counts reconcile with the layout by form.
    const stones = scene.group.getObjectByName("plots-stone") as THREE.InstancedMesh;
    expect(stones.count).toBe(2); // nodes 1, 2 are memory stones
    const sprouts = scene.group.getObjectByName("plots-sprout") as THREE.InstancedMesh;
    expect(sprouts.count).toBe(1); // node 3 is an action sprout
    scene.dispose();
  });

  it("an empty layout still renders honest ground: terraces, tree, sky — no plots", () => {
    const empty = createGardenScene(buildGardenLayout({ nodes: [], links: [] }, [], NOW));
    const names = new Set<string>();
    empty.group.traverse((o) => names.add(o.name));
    expect(names.has("witness-tree")).toBe(true);
    expect(names.has("terrace-0")).toBe(true);
    expect([...names].some((n) => n.startsWith("plots-"))).toBe(false);
    expect([...names].some((n) => n.startsWith("landmark-"))).toBe(false);
    empty.dispose();
  });

  it("the garden has a finished underside: skirt + solid bottom cap below the lowest terrace", () => {
    const scene = createGardenScene(layout);
    const skirt = scene.group.getObjectByName("garden-underside-skirt") as THREE.Mesh;
    const cap = scene.group.getObjectByName("garden-underside-cap") as THREE.Mesh;
    expect(skirt).toBeTruthy();
    expect(cap).toBeTruthy();
    // Skirt: full outer radius, drops 60 below the lowest terrace (y=0) to the floor.
    const skirtGeo = skirt.geometry as THREE.CylinderGeometry;
    expect(skirtGeo.parameters.height).toBe(60);
    expect(skirtGeo.parameters.radiusTop).toBe(900);
    expect(skirtGeo.parameters.radiusBottom).toBe(900);
    expect(skirt.position.y).toBe(-30);
    // Cap: a solid disc of the full outer radius, closing the bottom at y=-60.
    const capGeo = cap.geometry as THREE.CircleGeometry;
    expect(capGeo.parameters.radius).toBe(900);
    expect(cap.position.y).toBe(-60);
    scene.dispose();
  });

  it("a camera below the old void sees solid ground, not void — a ray from underneath hits the cap", () => {
    const scene = createGardenScene(layout);
    scene.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, -200, 0),
      new THREE.Vector3(0, 1, 0),
    );
    const hits = ray.intersectObjects(scene.group.children, true);
    expect(hits.length).toBeGreaterThan(0);
    // The first thing the ray meets is the solid bottom cap, at the floor.
    expect(hits[0]!.object.name).toBe("garden-underside-cap");
    expect(hits[0]!.point.y).toBeCloseTo(-60, 6);
    // And from the side below: a low ray meets the skirt wall, not empty space.
    const sideRay = new THREE.Raycaster(
      new THREE.Vector3(1200, -30, 0),
      new THREE.Vector3(-1, 0, 0),
    );
    const sideHits = sideRay.intersectObjects(scene.group.children, true);
    expect(sideHits.length).toBeGreaterThan(0);
    expect(sideHits[0]!.object.name).toBe("garden-underside-skirt");
    expect(sideHits[0]!.point.x).toBeCloseTo(900, 6);
    scene.dispose();
  });

  it("update animates gently, freezes under reduced motion, and dispose is safe twice", () => {
    const scene = createGardenScene(layout);
    expect(() => scene.update(1000)).not.toThrow();
    expect(() => scene.update(2000, { reducedMotion: true })).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(3000)).not.toThrow(); // no-op after dispose
  });

  it("the EVE-style backdrop planets hang 4,000 out — holders exist, empty until their GLBs land", () => {
    const scene = createGardenScene(layout);
    for (const planet of GARDEN_BACKDROP_PLANETS) {
      const holder = scene.group.getObjectByName(`backdrop-${planet.key}`) as THREE.Group;
      expect(holder).toBeTruthy();
      expect(holder.children.length).toBe(0);
      expect(Math.hypot(holder.position.x, holder.position.z)).toBeCloseTo(4000, 5);
      expect(holder.position.y).toBe(500);
    }
    scene.dispose();
  });

  it("the recipe budget holds with the backdrop planets in — calls and tris, not just constants", () => {
    const scene = createGardenScene(layout);
    // The GLBs load async, so the built group holds the procedural
    // scene only; the manifest's measured cost is added here, so the
    // budget assertion covers the scene as the user actually sees it
    // once the planets have landed (5 calls / 63,334 tris).
    expect(countDrawCalls(scene.group) + GARDEN_BACKDROP_DRAW_CALLS).toBeLessThanOrEqual(
      GARDEN_BUDGET.maxDrawCalls,
    );
    expect(estimateTris(scene.group) + GARDEN_BACKDROP_TRIS_TOTAL).toBeLessThanOrEqual(
      GARDEN_BUDGET.maxTris,
    );
    scene.dispose();
  });
});
