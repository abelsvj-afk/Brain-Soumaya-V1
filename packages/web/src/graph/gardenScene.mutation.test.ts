import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildGardenLayout, landmarkPositionFor } from "./gardenLayout.js";
import { createGardenScene, EMPTY_GARDEN_MUTATION } from "./gardenScene.js";
import { warmthColors } from "./mutationPresentation.js";
import type { GraphData, Journey } from "@brain/shared";

const NOW = new Date("2026-10-24T12:00:00");

const layout = buildGardenLayout(
  {
    nodes: [
      { id: 1, label: "a", type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: 2, label: "b", type: "memory", content: "", createdAt: "2025-05-01T00:00:00.000Z" },
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

const plotPos = (nodeId: number) => {
  const p = layout.plots.find((pl) => pl.nodeId === nodeId)!;
  return { x: p.x, y: p.y, z: p.z };
};

function keyLight(scene: ReturnType<typeof createGardenScene>): THREE.DirectionalLight {
  return scene.group.children.find((o) => o instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
}

describe("garden scene mutation presentation (Phase 4)", () => {
  it("A8: warmth lerps the key light from cool first-light toward warm gold, never a jump", () => {
    const scene = createGardenScene(layout, { ...EMPTY_GARDEN_MUTATION, warmth: 1 });
    scene.update(0);
    // A small step moves the light only a little — no jump.
    scene.update(100);
    expect(scene.getWarmth()).toBeGreaterThan(0);
    expect(scene.getWarmth()).toBeLessThan(0.2);
    scene.update(40000);
    expect(scene.getWarmth()).toBeCloseTo(1, 2);
    expect(keyLight(scene).color.getHex()).toBe(warmthColors(1).keyLight);
    expect(scene.getWarmthFogColor()).toBe(warmthColors(1).fog);
    scene.dispose();
  });

  it("A8: the warmth lerp still runs under reduced motion (color info is never removed)", () => {
    const scene = createGardenScene(layout, { ...EMPTY_GARDEN_MUTATION, warmth: 1 });
    scene.update(0, { reducedMotion: true });
    scene.update(40000, { reducedMotion: true });
    expect(scene.getWarmth()).toBeCloseTo(1, 2);
    expect(keyLight(scene).color.getHex()).toBe(warmthColors(1).keyLight);
    scene.dispose();
  });

  it("A8: before any mutation input there is no fog color to apply", () => {
    const scene = createGardenScene(layout);
    expect(scene.getWarmth()).toBe(0);
    expect(scene.getWarmthFogColor()).toBeNull();
    scene.dispose();
  });

  it("A23: a pending landmark preview renders as a ghost, never a finished landmark", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      previews: [{ proposalId: "p-1", kind: "landmark", title: "A new landmark", ...pos }],
    });
    const preview = scene.group.getObjectByName("preview-p-1");
    expect(preview).toBeTruthy();
    expect(scene.group.getObjectByName("landmark-9")).toBeFalsy();
    // Ghost materials: transparent, half opacity.
    let transparent = true;
    preview!.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) transparent = transparent && mat.transparent && (mat as THREE.MeshBasicMaterial).opacity < 1;
    });
    expect(transparent).toBe(true);
    scene.dispose();
  });

  it("A23: a pending path preview renders as a dashed line between the two plots", () => {
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      previews: [
        {
          proposalId: "p-2",
          kind: "path",
          title: "A new link",
          from: plotPos(1),
          to: plotPos(2),
          fromNodeId: 1,
          toNodeId: 2,
        },
      ],
    });
    const preview = scene.group.getObjectByName("preview-p-2") as THREE.Line;
    expect(preview).toBeTruthy();
    expect(preview.material).toBeInstanceOf(THREE.LineDashedMaterial);
    scene.dispose();
  });

  it("A23: a preview with no resolvable position is never invented", () => {
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      previews: [{ proposalId: "p-3", kind: "landmark", title: "Nowhere" }],
    });
    expect(scene.group.getObjectByName("preview-p-3")).toBeFalsy();
    scene.dispose();
  });

  it("A23: a withdrawn preview fades out plainly, then leaves", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      previews: [{ proposalId: "p-4", kind: "landmark", title: "Waiting", ...pos }],
    });
    expect(scene.group.getObjectByName("preview-p-4")).toBeTruthy();
    scene.setMutation({ ...EMPTY_GARDEN_MUTATION, previews: [] });
    scene.update(100);
    expect(scene.group.getObjectByName("preview-p-4")).toBeTruthy(); // still fading
    scene.update(1000);
    expect(scene.group.getObjectByName("preview-p-4")).toBeFalsy();
    scene.dispose();
  });

  it("A6: an approved landmark rises over ~8s and locks in at full height", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [{ proposalId: "p-5", kind: "landmark", title: "Milestone", journeyId: 9, ...pos }],
    });
    const arch = scene.group.getObjectByName("landing-p-5")!;
    expect(arch.scale.y).toBeCloseTo(0.05, 2);
    scene.update(4000);
    expect(arch.scale.y).toBeGreaterThan(0.05);
    expect(arch.scale.y).toBeLessThan(1);
    scene.update(9000);
    expect(arch.scale.y).toBe(1);
    scene.dispose();
  });

  it("A6: a landmark already rendering presence-only is never re-risen", () => {
    const pos = landmarkPositionFor(7);
    const scene = createGardenScene(layout);
    scene.update(0);
    expect(scene.group.getObjectByName("landmark-7")).toBeTruthy();
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [{ proposalId: "p-6", kind: "landmark", title: "Already there", journeyId: 7, ...pos }],
    });
    expect(scene.group.getObjectByName("landing-p-6")).toBeFalsy();
    scene.dispose();
  });

  it("A6: skip jumps a rising landmark straight to its final state", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [{ proposalId: "p-7", kind: "landmark", title: "Milestone", journeyId: 9, ...pos }],
    });
    scene.update(1000);
    scene.skipAnimations();
    expect(scene.group.getObjectByName("landing-p-7")!.scale.y).toBe(1);
    scene.dispose();
  });

  it("A6 under reduced motion: the landmark fades in over ~2s, no rising", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0, { reducedMotion: true });
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [{ proposalId: "p-8", kind: "landmark", title: "Milestone", journeyId: 9, ...pos }],
    });
    scene.update(1000, { reducedMotion: true });
    const arch = scene.group.getObjectByName("landing-p-8")!;
    expect(arch.scale.y).toBe(1); // never rises under reduced motion
    scene.update(3000, { reducedMotion: true });
    let opacity = 1;
    arch.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (mat && "opacity" in mat) opacity = Math.min(opacity, mat.opacity);
    });
    expect(opacity).toBeCloseTo(1, 2);
    scene.dispose();
  });

  it("A7: an approved path draws itself over ~4s, then settles into path material", () => {
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [
        {
          proposalId: "p-9",
          kind: "path",
          title: "A new link",
          from: plotPos(1),
          to: plotPos(2),
          fromNodeId: 1,
          toNodeId: 2,
        },
      ],
    });
    const line = scene.group.getObjectByName("landing-p-9") as THREE.Line;
    expect(line.geometry.drawRange.count).toBe(0);
    scene.update(2000);
    const mid = line.geometry.drawRange.count;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(33);
    scene.update(5000);
    expect(line.geometry.drawRange.count).toBe(33);
    scene.dispose();
  });

  it("A25: undoing a landed landmark lowers it by the compensating path, never a snap-delete", () => {
    const pos = landmarkPositionFor(9);
    const scene = createGardenScene(layout);
    scene.update(0);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      landings: [{ proposalId: "p-10", kind: "landmark", title: "Milestone", journeyId: 9, ...pos }],
    });
    scene.update(9000);
    expect(scene.group.getObjectByName("landing-p-10")!.scale.y).toBe(1);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      undos: [{ proposalId: "p-10", kind: "landmark", title: "Milestone", journeyId: 9, ...pos }],
    });
    scene.update(13000); // 4s into the 8s lowering
    const arch = scene.group.getObjectByName("landing-p-10")!;
    expect(arch.scale.y).toBeGreaterThan(0.05);
    expect(arch.scale.y).toBeLessThan(1);
    scene.update(18000);
    expect(scene.group.getObjectByName("landing-p-10")).toBeFalsy();
    scene.dispose();
  });

  it("A25: undoing a layout-native path un-draws it from the shared line", () => {
    const scene = createGardenScene(layout);
    scene.update(0);
    const before = scene.group.getObjectByName("paths") as THREE.LineSegments;
    expect((before.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(2);
    scene.setMutation({
      ...EMPTY_GARDEN_MUTATION,
      undos: [
        {
          proposalId: "p-11",
          kind: "path",
          title: "Unlinked",
          from: plotPos(1),
          to: plotPos(2),
          fromNodeId: 1,
          toNodeId: 2,
        },
      ],
    });
    // The shared line no longer carries the edge; the overlay un-draws it.
    expect((before.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(0);
    const overlay = scene.group.getObjectByName("undo-p-11") as THREE.Line;
    expect(overlay).toBeTruthy();
    scene.update(7000);
    expect(scene.group.getObjectByName("undo-p-11")).toBeFalsy();
    scene.dispose();
  });

  it("setMutation after dispose is a no-op", () => {
    const scene = createGardenScene(layout);
    scene.dispose();
    expect(() =>
      scene.setMutation({ ...EMPTY_GARDEN_MUTATION, warmth: 1 }),
    ).not.toThrow();
    expect(scene.getWarmth()).toBe(0);
  });
});
