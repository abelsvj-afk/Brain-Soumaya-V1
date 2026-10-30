import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildDeepPastLayout,
  buildDeepPastStairSteps,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_BUDGET,
  DEEP_PAST_SHIP_BERTH,
  DEEP_PAST_STAIR,
  DEEP_PAST_STRATA_COUNT,
  DEEP_PAST_STRATUM_ARC_LENGTH,
  DEEP_PAST_STRATUM_ARC_START,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
  deepPastFloorY,
  type DeepPastLayout,
} from "./deepPastLayout.js";
import {
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_GLB_DRAW_CALLS,
  DEEP_PAST_ORB,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SUPERNOVA,
} from "./deepPastAssets.js";
import { createDeepPastScene, EMPTY_DEEP_PAST_LAYOUT } from "./deepPastScene.js";
import type { GraphData, Journey, JourneyLinkSummary } from "@brain/shared";

const NOW = new Date("2026-10-25T12:00:00");

/**
 * A stress layout from the real layout builder: 30 members spread
 * across all nine strata, two of them risen (tended within the warm
 * window), a 12-stop Chronicle thread, and one anchor to a
 * non-member.
 */
function stressLayout(): DeepPastLayout {
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    label: `node ${i + 1}`,
    type: "memory",
    content: "",
    createdAt: `${2025 - (i % 9)}-05-01T00:00:00.000Z`,
    kind: i % 7 === 3 ? "action" : i % 11 === 5 ? "moc" : "memory",
    ...(i < 2 ? { lastTendedAt: "2026-10-20T00:00:00.000Z" } : {}),
  }));
  nodes.push({
    id: 100,
    label: "young",
    type: "memory",
    content: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    kind: "memory",
  } as (typeof nodes)[number]);
  const graph = {
    nodes,
    links: [
      { id: 500, source: 1, target: 100, relationship: "relates_to", weight: 0.5, createdAt: "2020-01-01T00:00:00.000Z" },
    ],
  } as unknown as GraphData;
  const journeys = [{ id: 7, title: "Stress route", description: "", status: "done", progress: 1 } as Journey];
  const links = new Map<number, JourneyLinkSummary[]>([
    [7, Array.from({ length: 12 }, (_, i) => ({ kind: "node", refId: i + 1, label: `n${i + 1}` }) as JourneyLinkSummary)],
  ]);
  return buildDeepPastLayout(graph, journeys, links, NOW);
}

interface Counted {
  calls: number;
  tris: number;
}

/** Count visible renderables OUTSIDE the glb-* holders (the GLB layer's calls are the manifest's, asserted in the assets test). */
function countGenerated(group: THREE.Group): Counted {
  let calls = 0;
  let tris = 0;
  const visit = (obj: THREE.Object3D, inGlb: boolean, visible: boolean): void => {
    const glb = inGlb || obj.name.startsWith("glb-");
    const vis = visible && obj.visible;
    const anyO = obj as THREE.Mesh & THREE.InstancedMesh & THREE.Points & THREE.Line & THREE.Sprite;
    if (vis && !glb && (anyO.isMesh || anyO.isInstancedMesh || anyO.isPoints || anyO.isLine || anyO.isSprite)) {
      calls++;
      if (!anyO.isSprite && !anyO.isLine && !anyO.isPoints) {
        const mesh = obj as THREE.InstancedMesh;
        const per = mesh.geometry.getAttribute("position").count / 3;
        tris += per * (mesh.isInstancedMesh ? mesh.count : 1);
      } else if (anyO.isPoints) {
        tris += 0; // points are not triangles; they have their own budget line
      } else if (anyO.isSprite) {
        tris += 2;
      }
    }
    obj.children.forEach((c) => visit(c, glb, vis));
  };
  visit(group, false, true);
  return { calls, tris: Math.round(tris) };
}

/** The angular span a set of XZ angles covers: [start, length] via the largest-gap method. */
function arcCoverage(angles: number[]): { start: number; length: number } {
  const sorted = [...angles].sort((a, b) => a - b);
  let largestGap = 0;
  let gapEnd = sorted[0]!;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + Math.PI * 2;
    const gap = next - sorted[i]!;
    if (gap > largestGap) {
      largestGap = gap;
      gapEnd = next;
    }
  }
  return { start: gapEnd % (Math.PI * 2), length: Math.PI * 2 - largestGap };
}

function anglesOfVertices(geo: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): number[] {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const angles: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!keep(x, y, z)) continue;
    const a = Math.atan2(z, x);
    angles.push(a < 0 ? a + Math.PI * 2 : a);
  }
  return angles;
}

describe("deep past scene (rework)", () => {
  it("(a) the merged strata discs and gold trims align to the layout's angle convention", () => {
    const scene = createDeepPastScene(EMPTY_DEEP_PAST_LAYOUT);
    const strata = scene.group.getObjectByName("strata") as THREE.Mesh;
    expect(strata).toBeTruthy();
    const strataGeo = strata.geometry as THREE.BufferGeometry;
    for (const i of [0, 8]) {
      const radius = DEEP_PAST_STRATUM_RADIUS[i]!;
      const angles = anglesOfVertices(
        strataGeo,
        (x, y, z) => Math.abs(Math.hypot(x, z) - radius) < 0.06 && Math.abs(y - DEEP_PAST_STRATUM_Y[i]!) < 1.31,
      );
      expect(angles.length).toBeGreaterThan(40);
      const cover = arcCoverage(angles);
      // Vertices are discrete (48 segments over 4.4 rad), so the
      // covered span falls one step short of the full arc.
      expect(cover.length).toBeGreaterThan(4.2);
      expect(cover.length).toBeLessThanOrEqual(DEEP_PAST_STRATUM_ARC_LENGTH + 0.01);
      const expectedStart = (i * DEEP_PAST_STRATUM_ARC_START) % (Math.PI * 2);
      const diff = Math.abs(((cover.start - expectedStart + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      expect(diff).toBeLessThan(0.12);
    }
    const trims = scene.group.getObjectByName("gold-trims") as THREE.Mesh;
    expect(trims).toBeTruthy();
    const trimAngles = anglesOfVertices(
      trims.geometry as THREE.BufferGeometry,
      (x, y, z) => {
        const r = Math.hypot(x, z);
        return Math.abs(y - deepPastFloorY(0)) < 0.51 && r > DEEP_PAST_STRATUM_RADIUS[0]! - 0.85 && r < DEEP_PAST_STRATUM_RADIUS[0]! + 0.25;
      },
    );
    expect(trimAngles.length).toBeGreaterThan(100);
    const trimCover = arcCoverage(trimAngles);
    expect(trimCover.length).toBeGreaterThan(4.25);
    expect(trimCover.length).toBeLessThanOrEqual(DEEP_PAST_STRATUM_ARC_LENGTH + 0.01);
    // Start ≈ 0 (mod 2π — the coverage helper may report it as ~2π).
    expect(Math.min(trimCover.start, Math.PI * 2 - trimCover.start)).toBeLessThan(0.1);
    scene.dispose();
  });

  it("(f) the merged stair carries a step box exactly where buildDeepPastStairSteps puts it", () => {
    const scene = createDeepPastScene(EMPTY_DEEP_PAST_LAYOUT);
    const stair = scene.group.getObjectByName("stair") as THREE.Mesh;
    expect(stair).toBeTruthy();
    const steps = buildDeepPastStairSteps();
    expect(steps.length).toBe(112);
    const step = steps[40]!;
    const arcLen = (DEEP_PAST_STAIR.windRad / DEEP_PAST_STAIR.stepsPerFlight) * step.radius;
    // The box's top-outer-tangent corner, from the step's own numbers:
    // centre + radial×7 + tangent×(arcLen/2), at topY.
    const corner = new THREE.Vector3(
      step.x + Math.cos(step.angle) * 7 - Math.sin(step.angle) * (arcLen / 2),
      step.topY,
      step.z + Math.sin(step.angle) * 7 + Math.cos(step.angle) * (arcLen / 2),
    );
    const pos = stair.geometry.getAttribute("position") as THREE.BufferAttribute;
    let best = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      best = Math.min(best, v.distanceTo(corner));
    }
    expect(best).toBeLessThan(0.01);
    scene.dispose();
  });

  it("(b)(c) budgets: generated draw calls + the manifest's GLB calls ≤ 48, generated tris ≤ 45k, on a stress layout", () => {
    const layout = stressLayout();
    expect(layout.members.length).toBe(30);
    expect(layout.thread?.stops.length).toBe(12);
    expect(layout.members.filter((m) => m.risen).length).toBe(2);
    const scene = createDeepPastScene(layout);
    const { calls, tris } = countGenerated(scene.group);
    expect(calls + DEEP_PAST_GLB_DRAW_CALLS).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxDrawCalls);
    expect(calls + DEEP_PAST_GLB_DRAW_CALLS).toBeLessThanOrEqual(48);
    expect(tris).toBeLessThanOrEqual(DEEP_PAST_BUDGET.maxGeneratedTris);
    expect(tris).toBeLessThanOrEqual(45_000);
    scene.dispose();
  });

  it("(d) kindle: the bright thread's drawRange follows frame-state kindle", () => {
    const scene = createDeepPastScene(stressLayout());
    const bright = scene.group.getObjectByName("thread-bright") as THREE.Line;
    expect(bright).toBeTruthy();
    scene.update(0);
    expect(bright.geometry.getAttribute("position").count).toBe(400);
    expect(bright.geometry.drawRange.count).toBe(0);
    scene.setFrameState({ kindle: 0.5 });
    scene.update(16);
    expect(bright.geometry.drawRange.count).toBeGreaterThanOrEqual(198);
    expect(bright.geometry.drawRange.count).toBeLessThanOrEqual(202);
    scene.setFrameState({ kindle: 1 });
    scene.update(32);
    expect(bright.geometry.drawRange.count).toBe(400);
    // The thread handle serves the host's ship: points ride the curve, stops map to fractions.
    expect(scene.stopFractions().length).toBe(12);
    expect(scene.stopFractions()[0]).toBeCloseTo(0, 1);
    const mid = scene.threadPointAt(0.5);
    expect(mid).toBeTruthy();
    expect(Math.hypot(...mid!.tangent)).toBeCloseTo(1, 3);
    scene.dispose();
  });

  it("(e) bead interiors: exactly 26 interior points per thread stop", () => {
    const scene = createDeepPastScene(stressLayout());
    const interiors = scene.group.getObjectByName("bead-interiors") as THREE.Points;
    expect(interiors).toBeTruthy();
    expect(interiors.geometry.getAttribute("position").count).toBe(12 * 26);
    const shells = scene.group.getObjectByName("bead-shells") as THREE.InstancedMesh;
    expect(shells.count).toBe(12);
    const rims = scene.group.getObjectByName("bead-rims") as THREE.InstancedMesh;
    expect(rims.count).toBe(12);
    // Frame-state emphasis + camera dimming run without throwing.
    scene.setFrameState({ currentStop: 3, cameraPosition: [0, 0, 200] });
    expect(() => scene.update(1000)).not.toThrow();
    expect(() => scene.update(2000, { reducedMotion: true })).not.toThrow();
    scene.dispose();
  });

  it("the GLB holders sit at the manifest's placements and start empty", () => {
    const scene = createDeepPastScene(stressLayout());
    const basin = scene.group.getObjectByName("glb-basin") as THREE.Group;
    expect(basin.position.y).toBe(DEEP_PAST_BASIN_GLB_Y);
    expect(basin.children.length).toBe(0);
    const orb = scene.group.getObjectByName("glb-orb") as THREE.Group;
    expect(orb.position.y).toBe(DEEP_PAST_ORB.y);
    const spire = scene.group.getObjectByName("glb-spire") as THREE.Group;
    expect(spire.position.x).toBeCloseTo(Math.cos(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius, 5);
    expect(spire.position.y).toBe(DEEP_PAST_SPIRE.y);
    expect(spire.position.z).toBeCloseTo(Math.sin(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius, 5);
    const supernova = scene.group.getObjectByName("glb-supernova") as THREE.Group;
    expect(supernova.position.x).toBeCloseTo(Math.cos(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius, 5);
    expect(supernova.position.y).toBe(DEEP_PAST_SUPERNOVA.y);
    // Exactly two real point lights in the whole scene.
    let pointLights = 0;
    scene.group.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) pointLights++;
    });
    expect(pointLights).toBe(2);
    scene.dispose();
  });

  it("an empty layout still renders honest ground — helix, stair, basin, shaft — and no thread or beads", () => {
    const scene = createDeepPastScene(EMPTY_DEEP_PAST_LAYOUT);
    const names = new Set<string>();
    scene.group.traverse((o) => names.add(o.name));
    for (const name of [
      "strata",
      "stair",
      "gold-trims",
      "basin-floor",
      "basin-rock",
      "pool-glow",
      "orb-halo",
      "light-shaft-outer",
      "light-shaft-core",
      "rise-shelf",
      "motes",
      "marine-snow",
      "place-rim",
      "place-shelf",
      "deep-past-ship",
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    expect([...names].some((n) => n.startsWith("thread-"))).toBe(false);
    expect(names.has("bead-interiors")).toBe(false);
    expect(scene.stopFractions()).toEqual([]);
    expect(scene.threadPointAt(0.5)).toBeNull();
    scene.dispose();
  });

  it("the ship berths at the layout's berth, and frame-state pose applies even in reduced motion", () => {
    const scene = createDeepPastScene(stressLayout());
    const ship = scene.group.getObjectByName("deep-past-ship") as THREE.Group;
    expect(ship.position.x).toBeCloseTo(Math.cos(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius, 5);
    expect(ship.position.y).toBeCloseTo(DEEP_PAST_SHIP_BERTH.y, 5);
    expect(ship.position.z).toBeCloseTo(Math.sin(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius, 5);
    scene.setFrameState({ shipPose: { position: [10, -50, 20], target: [0, -60, 0] } });
    scene.update(100, { reducedMotion: true });
    expect(ship.position.x).toBeCloseTo(10, 5);
    expect(ship.position.y).toBeCloseTo(-50, 5);
    expect(ship.position.z).toBeCloseTo(20, 5);
    scene.setFrameState({ shipPose: null });
    scene.update(200, { reducedMotion: true });
    expect(ship.position.y).toBeCloseTo(DEEP_PAST_SHIP_BERTH.y, 5);
    scene.dispose();
  });

  it("pickMember raycasts the forms and returns the member's nodeId", () => {
    const layout = stressLayout();
    const scene = createDeepPastScene(layout);
    scene.group.updateMatrixWorld(true);
    // A stone member: its form is solid at its centre (a gathering
    // ring's centre is hollow by design — a ray through it picks air).
    const m = layout.members.find((mm) => !mm.gathering && mm.kind !== "action" && !mm.risen)!;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(m.x + 26, m.y + 16, m.z + 26);
    camera.lookAt(m.x, m.y + 1.2, m.z);
    camera.updateMatrixWorld(true);
    const ndc3 = new THREE.Vector3(m.x, m.y + 1.5, m.z).project(camera);
    expect(scene.pickMember({ x: ndc3.x, y: ndc3.y }, camera)).toBe(m.nodeId);
    expect(scene.pickMember({ x: 0.99, y: 0.99 }, camera)).toBeNull();
    scene.dispose();
  });

  it("a rise glide carries the member from its alcove to the shelf over ~5.2 s (AN10)", () => {
    const layout = stressLayout();
    const risen = layout.members.find((mm) => mm.risen)!;
    const scene = createDeepPastScene(layout, { riseGlides: [risen.nodeId] });
    const form = scene.group.getObjectByName(`glide-form-${risen.nodeId}`) as THREE.Mesh;
    expect(form).toBeTruthy();
    scene.update(0);
    expect(form.position.x).toBeCloseTo(risen.homeX, 3);
    expect(form.position.z).toBeCloseTo(risen.homeZ, 3);
    scene.update(2600);
    const midX = form.position.x;
    expect(midX).not.toBeCloseTo(risen.homeX, 1);
    scene.update(5300);
    expect(form.position.x).toBeCloseTo(risen.x, 3);
    expect(form.position.y).toBeCloseTo(risen.y + 1.5, 3);
    expect(form.position.z).toBeCloseTo(risen.z, 3);
    scene.dispose();
  });

  it("the ship carries a newly resting member in and returns to berth (AN11)", () => {
    const layout = stressLayout();
    const target = layout.members.find((mm) => !mm.risen && mm.stratum >= 3) ?? layout.members[10]!;
    const scene = createDeepPastScene(layout, { carryIn: [target.nodeId] });
    const ship = scene.group.getObjectByName("deep-past-ship") as THREE.Group;
    const cargo = scene.group.getObjectByName("carry-cargo") as THREE.Group;
    let sawCargo = false;
    let t = 0;
    scene.update(0);
    for (let i = 0; i < 160 && t < 80000; i++) {
      t += 500;
      scene.update(t);
      if (cargo.visible) sawCargo = true;
      const backAtBerth =
        Math.abs(ship.position.y - DEEP_PAST_SHIP_BERTH.y) < 0.01 &&
        Math.hypot(
          ship.position.x - Math.cos(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
          ship.position.z - Math.sin(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
        ) < 0.01;
      if (sawCargo && !cargo.visible && backAtBerth && t > 4000) break;
    }
    expect(sawCargo).toBe(true);
    expect(cargo.visible).toBe(false);
    expect(ship.position.y).toBeCloseTo(DEEP_PAST_SHIP_BERTH.y, 2);
    scene.dispose();
  });

  it("pulseAlcove blooms a ring at the member, and update/dispose are safe", () => {
    const layout = stressLayout();
    const scene = createDeepPastScene(layout);
    const m = layout.members[0]!;
    scene.update(1000);
    scene.pulseAlcove(m.nodeId);
    const ring = [0, 1, 2, 3]
      .map((i) => scene.group.getObjectByName(`alcove-ring-${i}`) as THREE.Mesh)
      .find((r) => r.visible);
    expect(ring).toBeTruthy();
    expect(ring!.position.x).toBeCloseTo(m.x, 3);
    expect(ring!.position.z).toBeCloseTo(m.z, 3);
    scene.update(1300);
    expect((ring!.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    scene.update(2300);
    expect(ring!.visible).toBe(false);
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(3000)).not.toThrow();
  });

  it("completeness: the basin floor closes the bottom at the basin line, rock below it", () => {
    const scene = createDeepPastScene(EMPTY_DEEP_PAST_LAYOUT);
    const floor = scene.group.getObjectByName("basin-floor") as THREE.Mesh;
    expect(floor.position.y).toBe(DEEP_PAST_BASIN_Y);
    const rock = scene.group.getObjectByName("basin-rock") as THREE.Mesh;
    expect(rock.position.y).toBeLessThan(DEEP_PAST_BASIN_Y);
    scene.dispose();
  });

  it("landing markers exist for the deepest stratum with members, mid, and last", () => {
    const scene = createDeepPastScene(stressLayout());
    const names = new Set<string>();
    scene.group.traverse((o) => names.add(o.name));
    expect(names.has("place-landing-deepest")).toBe(true);
    expect(names.has("place-landing-mid")).toBe(true);
    // Deepest stratum with members is 8, so there is no separate "last".
    expect(names.has("place-landing-last")).toBe(false);
    const rim = scene.group.getObjectByName("place-rim") as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(rim);
    expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(170, 3);
    scene.dispose();
  });
});
