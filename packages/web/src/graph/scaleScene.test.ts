import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { buildScaleLayout, SCALE_BUDGET } from "./scaleLayout.js";
import { createScaleScene, EMPTY_SCALE_LAYOUT } from "./scaleScene.js";

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

describe("createScaleScene", () => {
  it("renders the whole space synchronously: truss, stars, asteroids, frame, capsule, probe holders", () => {
    const scene = createScaleScene(buildScaleLayout());
    const n = names(scene.group);
    expect(n.has("scale")).toBe(true);
    expect(n.has("iss-holder")).toBe(true);
    // The ISS GLB has not landed in tests (or in the repo yet): the
    // wireframe truss stands in its place, honestly, until the real
    // model loads — the Profondo pattern.
    expect(n.has("iss-fallback")).toBe(true);
    expect(n.has("iss-fallback-truss")).toBe(true);
    expect(n.has("named-asteroids")).toBe(true);
    expect(n.has("gate-scale-survey-frame")).toBe(true);
    expect(n.has("docked-capsule")).toBe(true);
    for (const slug of ["kepler", "pioneer-10", "dawn", "voyager"]) {
      expect(n.has(`probe-${slug}`)).toBe(true);
    }
    // The true sky: the HYG starfield, at full strength.
    expect([...n].some((name) => name.startsWith("hyg-starfield-"))).toBe(true);
    scene.dispose();
  });

  it("holds the recipe budget with wide margin (static half — before any GLB lands)", () => {
    const scene = createScaleScene(buildScaleLayout());
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(SCALE_BUDGET.maxDrawCalls);
    expect(estimateTris(scene.group)).toBeLessThanOrEqual(SCALE_BUDGET.maxTris);
    // The static half is small on purpose: the real models (ISS 6,642 +
    // probes 79,238 tris) still leave ~400k of headroom.
    expect(estimateTris(scene.group)).toBeLessThan(10_000);
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(20);
    scene.dispose();
  });

  it("the empty layout still renders sky, frame, and capsule — never a blank sky", () => {
    const scene = createScaleScene(EMPTY_SCALE_LAYOUT);
    const n = names(scene.group);
    expect(n.has("iss-fallback")).toBe(true);
    expect(n.has("gate-scale-survey-frame")).toBe(true);
    expect(n.has("docked-capsule")).toBe(true);
    expect([...n].some((name) => name.startsWith("hyg-starfield-"))).toBe(true);
    scene.dispose();
  });

  it("probe drift moves the probes; reduced motion holds them still", () => {
    const scene = createScaleScene(buildScaleLayout());
    const holder = scene.group.getObjectByName("probe-kepler")!;
    const at0 = holder.position.clone();
    scene.update(100_000);
    const moved = holder.position.clone();
    expect(moved.equals(at0)).toBe(false);
    // Reduced motion: the same call holds the space — same information, no motion.
    const before = holder.position.clone();
    scene.update(200_000, { reducedMotion: true });
    expect(holder.position.equals(before)).toBe(true);
    scene.dispose();
  });

  it("accepts the relics increment's onRelicVisible hook without throwing (wiring point, registry not on this tip)", () => {
    const onRelicVisible = vi.fn();
    const scene = createScaleScene(buildScaleLayout(), { onRelicVisible });
    expect(scene.group.name).toBe("scale");
    // Nothing fires on this tip: the registry does not exist here yet,
    // and a relic with no codex behind it would glimmer unexplained.
    expect(onRelicVisible).not.toHaveBeenCalled();
    scene.dispose();
  });

  it("dispose is safe, including twice", () => {
    const scene = createScaleScene(buildScaleLayout());
    scene.dispose();
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(1000)).not.toThrow();
  });
});
