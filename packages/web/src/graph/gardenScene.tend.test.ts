import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildGardenLayout } from "./gardenLayout.js";
import { createGardenScene } from "./gardenScene.js";
import type { GraphData, Journey } from "@brain/shared";

/**
 * Verb 1 — Tend a plot: the garden's warm glow, lit paths, and
 * tap-to-tend raycasting.
 *
 * Fail-before: on the base tree createGardenScene takes no glow and
 * carries no pickPlot, so these tests fail — the behavior is entirely new.
 */
const NOW = new Date("2026-10-24T12:00:00");

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
  // v2: the older memory (id 2) rests in the done Journey's grove; the
  // recent ones grow wild in the meadow.
  { links: new Map([[7, [{ kind: "node" as const, refId: 2, label: "b" }]]]) },
);

/** The garden's resting orbit camera, as WorldsSurface poses it. */
function orbitCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 9000);
  const angle = 0.6;
  camera.position.set(Math.sin(angle) * 1150, 300, Math.cos(angle) * 1150);
  camera.lookAt(0, 60, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** NDC for the centre of a plot's mesh (form lift included). */
function plotNdc(nodeId: number, camera: THREE.PerspectiveCamera): { x: number; y: number } {
  const plot = layout.plots.find((p) => p.nodeId === nodeId)!;
  const lift = plot.role === "wild" ? 5 : plot.kind === "action" ? 7 : 3;
  const v = new THREE.Vector3(plot.x, plot.y + lift, plot.z).project(camera);
  return { x: v.x, y: v.y };
}

describe("garden scene glow + tap-to-tend (Verb 1)", () => {
  it("draws gold halos over warm plots and brighter lines over lit paths — and nothing without glow", () => {
    const glowing = createGardenScene(layout, {
      warmNodeIds: new Set([1]),
      litEdgeIds: new Set([10]),
    });
    const halos = glowing.group.getObjectByName("warm-halos") as THREE.InstancedMesh;
    expect(halos).toBeTruthy();
    expect(halos.count).toBe(1);
    const lit = glowing.group.getObjectByName("lit-paths") as THREE.LineSegments;
    expect(lit).toBeTruthy();
    // The base paths are still there — the lit path is an addition, not a replacement.
    expect(glowing.group.getObjectByName("paths")).toBeTruthy();
    glowing.dispose();

    const plain = createGardenScene(layout);
    expect(plain.group.getObjectByName("warm-halos")).toBeFalsy();
    expect(plain.group.getObjectByName("lit-paths")).toBeFalsy();
    plain.dispose();
  });

  it("ignores glow for plots and edges that aren't in the layout", () => {
    const scene = createGardenScene(layout, {
      warmNodeIds: new Set([999]),
      litEdgeIds: new Set([999]),
    });
    expect(scene.group.getObjectByName("warm-halos")).toBeFalsy();
    expect(scene.group.getObjectByName("lit-paths")).toBeFalsy();
    scene.dispose();
  });

  it("a tap on a stone plot returns its node id; a tap on a sprout plot returns its node id", () => {
    const scene = createGardenScene(layout);
    const camera = orbitCamera();
    expect(scene.pickPlot(plotNdc(1, camera), camera)).toBe(1);
    expect(scene.pickPlot(plotNdc(3, camera), camera)).toBe(3);
    scene.dispose();
  });

  it("a tap that lands on no plot returns null — the garden stays a place to look", () => {
    const scene = createGardenScene(layout);
    const camera = orbitCamera();
    // A camera looking away from the garden: the ray leaves the garden behind.
    const away = new THREE.PerspectiveCamera(55, 1, 1, 9000);
    away.position.set(Math.sin(0.6) * 1150, 300, Math.cos(0.6) * 1150);
    away.lookAt(0, 60, 5000);
    away.updateMatrixWorld();
    expect(scene.pickPlot({ x: 0, y: 0 }, away)).toBeNull();
    scene.dispose();
  });
});
