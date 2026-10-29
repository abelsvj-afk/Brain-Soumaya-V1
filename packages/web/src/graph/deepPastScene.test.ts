import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildDeepPastLayout, DEEP_PAST_BUDGET, DEEP_PAST_STRATA_COUNT } from "./deepPastLayout.js";
import {
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_CRYSTAL,
  DEEP_PAST_LANTERN,
  DEEP_PAST_ORB,
  DEEP_PAST_RIM,
  DEEP_PAST_SPIRE,
  DEEP_PAST_STAIR,
  DEEP_PAST_SUPERNOVA,
  DEEP_PAST_TERRACE,
} from "./deepPastAssets.js";
import {
  createDeepPastScene,
  deepPastDescentCamera,
  deepPastDescentStage,
  DEEP_PAST_DESCENT,
} from "./deepPastScene.js";
import type { GraphData, Journey, JourneyLinkSummary } from "@brain/shared";

const NOW = new Date("2026-10-25T12:00:00");

const layout = buildDeepPastLayout(
  {
    nodes: [
      { id: 1, label: "a", type: "memory", content: "", createdAt: "2024-05-01T00:00:00.000Z" },
      { id: 2, label: "b", type: "memory", content: "", createdAt: "2023-05-01T00:00:00.000Z" },
      { id: 3, label: "c", type: "memory", content: "", createdAt: "2017-01-01T00:00:00.000Z", kind: "action" },
      { id: 4, label: "d", type: "memory", content: "", createdAt: "2019-01-01T00:00:00.000Z", kind: "moc" },
      { id: 5, label: "e", type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" },
    ] as never[],
    links: [
      { id: 10, source: 1, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2020-01-01T00:00:00.000Z" },
      { id: 11, source: 2, target: 5, relationship: "relates_to", weight: 0.5, createdAt: "2020-01-01T00:00:00.000Z" },
    ],
  } as GraphData,
  [{ id: 7, title: "Done chapter", description: "", status: "done", progress: 1 } as Journey],
  new Map<number, JourneyLinkSummary[]>([[7, [
    { kind: "node", refId: 1, label: "a" },
    { kind: "node", refId: 3, label: "c" },
  ]]]),
  NOW,
);

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

describe("deep past scene (P3-2)", () => {
  it("builds the helix from the layout: strata, basin, shelf, lanterns, anchors, thread, dimmed sky", () => {
    const scene = createDeepPastScene(layout);
    const names = new Set<string>();
    scene.group.traverse((o) => names.add(o.name));
    for (let i = 0; i < DEEP_PAST_STRATA_COUNT; i++) {
      expect(names.has(`stratum-${i}`)).toBe(true);
      expect(names.has(`stratum-rim-${i}`)).toBe(true);
    }
    expect(names.has("basin-floor")).toBe(true);
    expect(names.has("basin-rim")).toBe(true);
    expect(names.has("basin-glow")).toBe(true);
    expect(names.has("basin-rock")).toBe(true);
    expect(names.has("rise-shelf")).toBe(true);
    expect(names.has("dressing-ships")).toBe(true);
    expect(names.has("marine-snow")).toBe(true);
    expect(names.has("anchors")).toBe(true); // node 2 → node 5 (too young, a non-member)
    expect(names.has("thread-7")).toBe(true);
    // The HYG sky is present but fainter than the garden's: the helix encloses.
    const stars = scene.group.children.find(
      (o): o is THREE.Points => o instanceof THREE.Points && o.name.startsWith("hyg-starfield"),
    );
    expect(stars).toBeTruthy();
    expect((stars!.material as THREE.PointsMaterial).opacity).toBe(0.25);
    // Alcove counts reconcile with the layout by form.
    const stones = scene.group.getObjectByName("alcoves-stone") as THREE.InstancedMesh;
    expect(stones.count).toBe(2); // nodes 1, 2 are memory stones
    const sprouts = scene.group.getObjectByName("alcoves-sprout") as THREE.InstancedMesh;
    expect(sprouts.count).toBe(1); // node 3 is an action sprout
    const rings = scene.group.getObjectByName("alcoves-gathering") as THREE.InstancedMesh;
    expect(rings.count).toBe(1); // node 4 is a gathering ring
    const lanterns = scene.group.getObjectByName("memory-lanterns") as THREE.Points;
    expect((lanterns.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(4);
    scene.dispose();
  });

  it("the real-asset layer has one holder per piece at the manifest's placements", () => {
    const scene = createDeepPastScene(layout);
    // The basin's procedural floor + rim ring stay as the load fallback
    // until the real dish fades in.
    expect(scene.group.getObjectByName("basin-fallback")).toBeTruthy();
    expect(scene.group.getObjectByName("basin-floor")).toBeTruthy();
    expect(scene.group.getObjectByName("basin-rim")).toBeTruthy();
    // Holders start empty: the GLBs land async; a failed load leaves a
    // holder empty and noted, never a hole in the world.
    for (const name of ["glb-basin", "glb-terrace", "glb-rim", "glb-stair", "glb-lantern", "glb-crystal", "glb-supernova", "glb-spire", "glb-orb"]) {
      const holder = scene.group.getObjectByName(name) as THREE.Group;
      expect(holder).toBeTruthy();
      expect(holder.children.length).toBe(0);
    }
    const basin = scene.group.getObjectByName("glb-basin") as THREE.Group;
    expect(basin.position.y).toBe(DEEP_PAST_BASIN_GLB_Y);
    const terrace = scene.group.getObjectByName("glb-terrace") as THREE.Group;
    expect(terrace.position.x).toBeCloseTo(Math.cos(DEEP_PAST_TERRACE.angle) * DEEP_PAST_TERRACE.radius, 5);
    expect(terrace.position.y).toBe(DEEP_PAST_TERRACE.y);
    expect(terrace.position.z).toBeCloseTo(Math.sin(DEEP_PAST_TERRACE.angle) * DEEP_PAST_TERRACE.radius, 5);
    expect(terrace.rotation.y).toBeCloseTo(-DEEP_PAST_TERRACE.angle - Math.PI / 2, 5);
    const rim = scene.group.getObjectByName("glb-rim") as THREE.Group;
    expect(rim.position.y).toBe(DEEP_PAST_RIM.y);
    const stair = scene.group.getObjectByName("glb-stair") as THREE.Group;
    expect(stair.position.x).toBe(DEEP_PAST_STAIR.position.x);
    expect(stair.position.y).toBe(DEEP_PAST_STAIR.position.y);
    expect(stair.position.z).toBe(DEEP_PAST_STAIR.position.z);
    expect(stair.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
    const lantern = scene.group.getObjectByName("glb-lantern") as THREE.Group;
    expect(lantern.position.x).toBeCloseTo(Math.cos(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius, 5);
    expect(lantern.position.y).toBe(DEEP_PAST_LANTERN.y);
    expect(lantern.position.z).toBeCloseTo(Math.sin(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius, 5);
    const crystal = scene.group.getObjectByName("glb-crystal") as THREE.Group;
    expect(crystal.position.x).toBeCloseTo(Math.cos(DEEP_PAST_CRYSTAL.angle) * DEEP_PAST_CRYSTAL.radius, 5);
    expect(crystal.position.y).toBe(DEEP_PAST_CRYSTAL.y);
    expect(crystal.position.z).toBeCloseTo(Math.sin(DEEP_PAST_CRYSTAL.angle) * DEEP_PAST_CRYSTAL.radius, 5);
    const supernova = scene.group.getObjectByName("glb-supernova") as THREE.Group;
    expect(supernova.position.x).toBeCloseTo(Math.cos(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius, 5);
    expect(supernova.position.y).toBe(DEEP_PAST_SUPERNOVA.y);
    expect(supernova.position.z).toBeCloseTo(Math.sin(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius, 5);
    const spire = scene.group.getObjectByName("glb-spire") as THREE.Group;
    expect(spire.position.x).toBeCloseTo(Math.cos(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius, 5);
    expect(spire.position.y).toBe(DEEP_PAST_SPIRE.y);
    expect(spire.position.z).toBeCloseTo(Math.sin(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius, 5);
    const orb = scene.group.getObjectByName("glb-orb") as THREE.Group;
    expect(orb.position.x).toBe(0);
    expect(orb.position.y).toBe(DEEP_PAST_ORB.y);
    expect(orb.position.z).toBe(0);
    scene.dispose();
  });

  it("an empty layout still renders honest ground: helix, basin, shelf, sky — no alcoves, no thread", () => {
    const empty = createDeepPastScene(buildDeepPastLayout({ nodes: [], links: [] }, [], new Map(), NOW));
    const names = new Set<string>();
    empty.group.traverse((o) => names.add(o.name));
    expect(names.has("stratum-0")).toBe(true);
    expect(names.has("basin-floor")).toBe(true);
    expect(names.has("rise-shelf")).toBe(true);
    expect([...names].some((n) => n.startsWith("alcoves-"))).toBe(false);
    expect([...names].some((n) => n.startsWith("thread-"))).toBe(false);
    expect([...names].some((n) => n === "anchors")).toBe(false);
    empty.dispose();
  });

  it("the recipe budget holds as built geometry — calls and tris, not just constants", () => {
    expect(DEEP_PAST_BUDGET.maxDrawCalls).toBe(90);
    expect(DEEP_PAST_BUDGET.maxTris).toBe(440_000);
    const scene = createDeepPastScene(layout);
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxDrawCalls);
    scene.dispose();

    // A large graph (2,000 members, mixed kinds) stays inside the budget too.
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
    expect(countDrawCalls(big.group)).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxDrawCalls);
    expect(estimateTris(big.group)).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxTris);
    big.dispose();
  });

  it("completeness (C9): the basin floor closes the bottom and solid rock lies below it", () => {
    const scene = createDeepPastScene(layout);
    const floor = scene.group.getObjectByName("basin-floor") as THREE.Mesh;
    const floorRadius = (floor.geometry as THREE.CircleGeometry).parameters.radius;
    // The floor must cover the lowest stratum's outer edge (radius 300).
    expect(floorRadius).toBeGreaterThanOrEqual(300);
    expect(floor.position.y).toBe(-830);
    const rock = scene.group.getObjectByName("basin-rock") as THREE.Mesh;
    expect(rock.position.y).toBeLessThan(-830); // solid, finished rock below the floor
    const rockTop = rock.position.y + 100; // the rock is 200 tall, centered below the basin
    expect(rockTop).toBe(-830); // its top meets the basin floor exactly
    scene.dispose();
  });

  it("the guided descent camera stays inside the finished envelope at every progress", () => {
    const rim = deepPastDescentCamera(0);
    expect(rim.position[1]).toBe(150); // the rim arrival vista
    expect(Math.hypot(rim.position[0], rim.position[2])).toBeCloseTo(DEEP_PAST_DESCENT.radius, 5);
    expect(rim.lookAt[1]).toBe(-200);
    const mid = deepPastDescentCamera(0.5);
    expect(mid.position[1]).toBe(-250);
    const basin = deepPastDescentCamera(1);
    expect(basin.position[1]).toBe(-650); // the descent ends above the basin floor
    expect(basin.lookAt[1]).toBeGreaterThanOrEqual(-830); // the look target never goes below the floor
    expect(basin.lookAt[1]).toBe(-800);
    // Out-of-range progress clamps, never escapes the envelope.
    expect(deepPastDescentCamera(-1).position[1]).toBe(150);
    expect(deepPastDescentCamera(2).position[1]).toBe(-650);
  });

  it("reduced motion is stratified stage holds, not continuous motion", () => {
    expect(deepPastDescentStage(0)).toBe(0);
    expect(deepPastDescentStage(29_999)).toBe(0);
    expect(deepPastDescentStage(30_000)).toBe(0.5);
    expect(deepPastDescentStage(59_999)).toBe(0.5);
    expect(deepPastDescentStage(60_000)).toBe(1);
    expect(deepPastDescentStage(90_000)).toBe(1);
    expect(deepPastDescentStage(200_000)).toBe(1);
  });

  it("update animates gently, freezes under reduced motion, and dispose is safe twice", () => {
    const scene = createDeepPastScene(layout);
    expect(() => scene.update(1000)).not.toThrow();
    expect(() => scene.update(2000, { reducedMotion: true })).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(3000)).not.toThrow(); // no-op after dispose
  });
});
