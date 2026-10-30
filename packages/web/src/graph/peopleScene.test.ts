import { TOY_REPLACEMENTS } from "./proceduralPlanet.js";
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildPeopleLayout, PEOPLE_BUDGET, type PeopleLayout } from "./peopleLayout.js";
import {
  PEOPLE_BACKDROP_DRAW_CALLS,
  PEOPLE_BACKDROP_PLANETS,
  PEOPLE_BACKDROP_TRIS_TOTAL,
} from "./peopleAssets.js";
import { createPeopleScene, EMPTY_PEOPLE_LAYOUT } from "./peopleScene.js";
import type { GraphData } from "@brain/shared";

const NOW = new Date("2026-10-26T12:00:00");

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

const layout = buildPeopleLayout(
  {
    nodes: [
      { id: 1, label: "Shaqavia", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" },
      { id: 2, label: "Syncere", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" },
      { id: 3, label: "Kehlani", type: "person", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 10, label: "first day", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 11, label: "birthday walk", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", occurredAt: "2026-06-01T00:00:00.000Z" },
      { id: 12, label: "school run", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 13, label: "call her back", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "action" },
      { id: 14, label: "hub", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "moc" },
      { id: 15, label: "shared supper", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
    ] as never[],
    links: [
      { id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 101, source: 11, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 102, source: 13, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 103, source: 14, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 104, source: 12, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 105, source: 15, target: 2, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 106, source: 15, target: 3, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  } as GraphData,
  NOW,
);

describe("createPeopleScene", () => {
  it("renders the field: ground, hearths, one instanced mesh per light form, bridges", () => {
    const scene = createPeopleScene(layout);
    const n = names(scene.group);
    expect(n.has("field-ground")).toBe(true);
    expect(n.has("cluster-hearths")).toBe(true);
    expect(n.has("lights-memory")).toBe(true);
    expect(n.has("lights-date")).toBe(true);
    expect(n.has("lights-thread")).toBe(true);
    expect(n.has("lights-gathering")).toBe(true);
    expect(n.has("bridges")).toBe(true);
    expect(n.has("ember-motes")).toBe(true);
    expect(n.has("dressing-ships")).toBe(true);
    // Three hearths (one per person), same form — no cluster is larger or brighter.
    const hearths = scene.group.getObjectByName("cluster-hearths") as THREE.InstancedMesh;
    expect(hearths.count).toBe(3);
    scene.dispose();
  });

  it("an empty layout renders honest resting ground — field, sky, no invented people", () => {
    const scene = createPeopleScene(EMPTY_PEOPLE_LAYOUT);
    const n = names(scene.group);
    expect(n.has("field-ground")).toBe(true);
    expect(n.has("cluster-hearths")).toBe(false);
    expect(n.has("bridges")).toBe(false);
    scene.dispose();
  });

  it("a lone person with no bridges stands alone — no bridge is drawn for them", () => {
    const lone = buildPeopleLayout(
      {
        nodes: [
          { id: 1, label: "Only", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" },
          { id: 10, label: "m", type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z" },
        ] as never[],
        links: [{ id: 100, source: 10, target: 1, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" }],
      } as GraphData,
      NOW,
    );
    const scene = createPeopleScene(lone);
    expect(names(scene.group).has("bridges")).toBe(false);
    expect(names(scene.group).has("cluster-hearths")).toBe(true);
    scene.dispose();
  });

  it("the EVE-style backdrop planets hang 4,000 out — holders exist; a toy-model planet is a shader planet at once, the rest are empty until their GLBs land", () => {
    const scene = createPeopleScene(layout);
    for (const planet of PEOPLE_BACKDROP_PLANETS) {
      const holder = scene.group.getObjectByName(`backdrop-${planet.key}`) as THREE.Group;
      expect(holder).toBeTruthy();
      expect(holder.children.length).toBe(planet.key in TOY_REPLACEMENTS ? 1 : 0);
      expect(Math.hypot(holder.position.x, holder.position.z)).toBeCloseTo(4000, 5);
      expect(holder.position.y).toBe(500);
    }
    scene.dispose();
  });

  it("the recipe budget holds as built geometry — calls and tris, not just constants", () => {
    // A large fixture: 20 clusters × 100 gathering lights (the heaviest
    // form) = 2,000 lights, the worst credible field.
    const bigNodes: Record<string, unknown>[] = [];
    const bigLinks: Record<string, unknown>[] = [];
    let linkId = 1;
    for (let p = 1; p <= 20; p++) {
      bigNodes.push({ id: p, label: `Person ${p}`, type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity" });
      for (let m = 0; m < 100; m++) {
        const id = 1000 + p * 100 + m;
        bigNodes.push({ id, label: `hub ${m}`, type: "daily", content: "", createdAt: "2026-01-01T00:00:00.000Z", kind: "moc" });
        bigLinks.push({ id: linkId++, source: id, target: p, relationship: "relates_to", weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" });
      }
    }
    const big = buildPeopleLayout({ nodes: bigNodes, links: bigLinks } as unknown as GraphData, NOW);
    expect(big.clusters).toHaveLength(20);
    const scene = createPeopleScene(big);
    // The GLBs load async, so the built group holds the procedural
    // scene only; the manifest's measured cost is added here, so the
    // budget assertion covers the scene as the user actually sees it
    // once the planets have landed (4 calls / 3,702 tris).
    expect(countDrawCalls(scene.group) + PEOPLE_BACKDROP_DRAW_CALLS).toBeLessThanOrEqual(
      PEOPLE_BUDGET.maxDrawCalls,
    );
    expect(estimateTris(scene.group) + PEOPLE_BACKDROP_TRIS_TOTAL).toBeLessThanOrEqual(
      PEOPLE_BUDGET.maxTris,
    );
    scene.dispose();
  });

  it("update orbits the lights and holds everything under reduced motion", () => {
    const scene = createPeopleScene(layout);
    const memoryLights = scene.group.getObjectByName("lights-memory") as THREE.InstancedMesh;
    const before = new THREE.Matrix4();
    memoryLights.getMatrixAt(0, before);
    const beforePos = new THREE.Vector3().setFromMatrixPosition(before);
    scene.update(60_000);
    const after = new THREE.Matrix4();
    memoryLights.getMatrixAt(0, after);
    const afterPos = new THREE.Vector3().setFromMatrixPosition(after);
    // The light moved along its orbit (same radius, different angle).
    expect(afterPos.distanceTo(beforePos)).toBeGreaterThan(0.1);
    scene.update(61_000, { reducedMotion: true });
    const held = new THREE.Matrix4();
    memoryLights.getMatrixAt(0, held);
    const heldPos = new THREE.Vector3().setFromMatrixPosition(held);
    expect(heldPos.distanceTo(afterPos)).toBe(0);
    scene.dispose();
  });

  it("dispose is safe, including twice", () => {
    const scene = createPeopleScene(layout);
    expect(() => {
      scene.dispose();
      scene.dispose();
    }).not.toThrow();
  });
});
