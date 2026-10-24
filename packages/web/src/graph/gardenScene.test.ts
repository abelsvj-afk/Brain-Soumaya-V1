import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildGardenLayout } from "./gardenLayout.js";
import { createGardenScene } from "./gardenScene.js";
import type { GraphData, Journey } from "@brain/shared";

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
);

describe("garden scene (P3-1)", () => {
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

  it("update animates gently, freezes under reduced motion, and dispose is safe twice", () => {
    const scene = createGardenScene(layout);
    expect(() => scene.update(1000)).not.toThrow();
    expect(() => scene.update(2000, { reducedMotion: true })).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(3000)).not.toThrow(); // no-op after dispose
  });
});
