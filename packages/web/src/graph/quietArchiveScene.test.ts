import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildQuietArchiveLayout, QUIET_ARCHIVE_BUDGET, quietArchiveSputnikPosition, type QuietArchiveLayout } from "./quietArchiveLayout.js";
import { createQuietArchiveScene, EMPTY_QUIET_ARCHIVE_LAYOUT } from "./quietArchiveScene.js";
import type { GraphData } from "@brain/shared";

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

function names(group: THREE.Group): Set<string> {
  const out = new Set<string>();
  group.traverse((o) => out.add(o.name));
  return out;
}

const layout = buildQuietArchiveLayout(
  {
    nodes: [
      { id: 1, label: "Shaqavia", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived" },
      { id: 2, label: "Syncere", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived" },
      { id: 10, label: "first day", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
      { id: 11, label: "birthday walk", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", occurredAt: "2026-06-01T00:00:00.000Z", status: "archived" },
      { id: 12, label: "school run", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
      { id: 13, label: "call her back", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "action", status: "archived" },
      { id: 14, label: "hub", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "moc", status: "archived" },
      { id: 15, label: "shared supper", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
      { id: 16, label: "a note with no one", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
    ] as never[],
    links: [
      { id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 101, source: 11, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 102, source: 13, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 103, source: 14, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 104, source: 12, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 105, source: 15, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 106, source: 15, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  } as GraphData,
);

describe("createQuietArchiveScene", () => {
  it("renders the field: ground, threshold, lamps, one instanced mesh per light form, bridges", () => {
    const scene = createQuietArchiveScene(layout);
    const n = names(scene.group);
    expect(n.has("field-ground")).toBe(true);
    expect(n.has("still-threshold")).toBe(true);
    expect(n.has("threshold-lintel")).toBe(true);
    expect(n.has("cluster-lamps")).toBe(true);
    expect(n.has("lights-memory")).toBe(true);
    expect(n.has("lights-date")).toBe(true);
    expect(n.has("lights-thread")).toBe(true);
    expect(n.has("lights-gathering")).toBe(true);
    expect(n.has("bridges")).toBe(true);
    expect(n.has("still-motes")).toBe(true);
    // No dressing ships: a resting place keeps its own counsel.
    expect(n.has("dressing-ships")).toBe(false);
    // Two lamps (one per archived person), same form — no cluster is larger or brighter.
    const lamps = scene.group.getObjectByName("cluster-lamps") as THREE.InstancedMesh;
    expect(lamps.count).toBe(2);
    // The lone light rests in the same memory mesh as the cluster lights.
    const memoryLights = scene.group.getObjectByName("lights-memory") as THREE.InstancedMesh;
    expect(memoryLights.count).toBe(5); // first day, school run, shared supper (in both clusters), lone note
    scene.dispose();
  });

  it("an empty layout renders honest resting ground — field, threshold, sky, no invented people", () => {
    const scene = createQuietArchiveScene(EMPTY_QUIET_ARCHIVE_LAYOUT);
    const n = names(scene.group);
    expect(n.has("field-ground")).toBe(true);
    expect(n.has("still-threshold")).toBe(true);
    expect(n.has("cluster-lamps")).toBe(false);
    expect(n.has("bridges")).toBe(false);
    scene.dispose();
  });

  it("the first artifact has its alcove by the arrival edge — empty until its GLB lands", () => {
    const scene = createQuietArchiveScene(layout);
    const holder = scene.group.getObjectByName("artifact-sputnik") as THREE.Group;
    expect(holder).toBeTruthy();
    expect(holder.children.length).toBe(0); // the GLB lands async; no stand-in
    const spot = quietArchiveSputnikPosition(layout.fieldRadius);
    expect(holder.position.x).toBeCloseTo(spot.x, 5);
    expect(holder.position.y).toBe(spot.y);
    expect(holder.position.z).toBeCloseTo(spot.z, 5);
    scene.dispose();
  });

  it("a lone person with no bridges rests alone — no bridge is drawn for them", () => {
    const lone = buildQuietArchiveLayout(
      {
        nodes: [
          { id: 1, label: "Only", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived" },
          { id: 10, label: "m", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", status: "archived" },
        ] as never[],
        links: [{ id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" }],
      } as GraphData,
    );
    const scene = createQuietArchiveScene(lone);
    expect(names(scene.group).has("bridges")).toBe(false);
    expect(names(scene.group).has("cluster-lamps")).toBe(true);
    scene.dispose();
  });

  it("the recipe budget holds as built geometry — calls and tris, not just constants", () => {
    // A large fixture: 20 clusters × 100 gathering lights (the heaviest
    // form) = 2,000 lights, the worst credible field.
    const bigNodes: Record<string, unknown>[] = [];
    const bigLinks: Record<string, unknown>[] = [];
    let linkId = 1;
    for (let p = 1; p <= 20; p++) {
      bigNodes.push({ id: p, label: `Person ${p}`, type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived" });
      for (let m = 0; m < 100; m++) {
        const id = 1000 + p * 100 + m;
        bigNodes.push({ id, label: `hub ${m}`, type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "moc", status: "archived" });
        bigLinks.push({ id: linkId++, source: id, target: p, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" });
      }
    }
    const big = buildQuietArchiveLayout({ nodes: bigNodes, links: bigLinks } as unknown as GraphData);
    expect(big.clusters).toHaveLength(20);
    const scene = createQuietArchiveScene(big);
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(QUIET_ARCHIVE_BUDGET.maxDrawCalls);
    expect(estimateTris(scene.group)).toBeLessThanOrEqual(QUIET_ARCHIVE_BUDGET.maxTris);
    scene.dispose();
  });

  it("update breathes the lamps barely and holds everything under reduced motion", () => {
    const scene = createQuietArchiveScene(layout);
    const glows = scene.group.getObjectByName("cluster-glows") as THREE.Points;
    const mat = glows.material as THREE.PointsMaterial;
    const motes = scene.group.getObjectByName("still-motes") as THREE.Points;
    const pos = motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const moteY0 = pos.getY(0);
    scene.update(60_000);
    expect(mat.opacity).not.toBe(0.85);
    expect(pos.getY(0)).not.toBe(moteY0);
    const opacityAfter = mat.opacity;
    const moteYAfter = pos.getY(0);
    scene.update(61_000, { reducedMotion: true });
    // Reduced motion = the field held: nothing moves.
    expect(mat.opacity).toBe(opacityAfter);
    expect(pos.getY(0)).toBe(moteYAfter);
    scene.dispose();
  });

  it("dispose is safe, including twice", () => {
    const scene = createQuietArchiveScene(layout);
    expect(() => {
      scene.dispose();
      scene.dispose();
    }).not.toThrow();
  });
});

describe("EMPTY_QUIET_ARCHIVE_LAYOUT", () => {
  it("carries the two relic spots even with nothing resting", () => {
    expect(EMPTY_QUIET_ARCHIVE_LAYOUT.relicSpots.map((s) => s.id)).toEqual([
      "stillness-seal",
      "unopened-fold",
    ]);
  });
});
