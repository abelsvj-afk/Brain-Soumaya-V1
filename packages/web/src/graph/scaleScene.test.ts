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
  it("renders the whole space synchronously: truss, stars, belt positions, frame, capsule, probe/planet/moon/encounter holders", () => {
    const scene = createScaleScene(buildScaleLayout());
    const n = names(scene.group);
    expect(n.has("scale")).toBe(true);
    expect(n.has("iss-holder")).toBe(true);
    // The ISS GLB has not landed in tests (or in the repo yet): the
    // wireframe truss stands in its place, honestly, until the real
    // model loads — the Profondo pattern.
    expect(n.has("iss-fallback")).toBe(true);
    expect(n.has("iss-fallback-truss")).toBe(true);
    // The points layer is gone: the named asteroids are real instanced
    // bodies now (belts load async), not points.
    expect(n.has("named-asteroids")).toBe(false);
    expect(n.has("gate-scale-survey-frame")).toBe(true);
    expect(n.has("docked-capsule")).toBe(true);
    for (const slug of ["kepler", "pioneer-10", "dawn", "voyager"]) {
      expect(n.has(`probe-${slug}`)).toBe(true);
    }
    // Planets, moon + outpost, encounters, and the debris satellite all
    // get holders synchronously; the GLBs land into them async.
    for (const key of [
      "planet_earth",
      "planet_mars",
      "planet_jupiter",
      "planet_saturn",
      "quaternius-planet-1",
      "quaternius-planet-2",
      "quaternius-planet-3",
      "planets-set",
      "earth-and-moon",
      "pixel-brown-dwarf",
      "sun",
      "stars",
    ]) {
      expect(n.has(`planet-${key}`)).toBe(true);
    }
    expect(n.has("moon")).toBe(true);
    expect(n.has("moon-outpost-dome")).toBe(true);
    expect(n.has("moon-outpost-rover")).toBe(true);
    expect(n.has("moon-outpost-flag")).toBe(true);
    for (const key of ["alien", "astronaut", "flexunit-ufo", "ufo", "hubble", "pulsar"]) {
      expect(n.has(`encounter-${key}`)).toBe(true);
    }
    expect(n.has("satellite-a")).toBe(true);
    // Hunt #2: belt pieces and centerpieces all get holders
    // synchronously too (the nebula planes' meshes arrive with their
    // textures, async, and never block the scene).
    for (const key of [
      "belt-strip",
      "bennu",
      "asteroid-large",
      "debris-pile",
      "asteroid-toastie",
      "rubble-rocks",
    ]) {
      expect(n.has(`belt-piece-${key}`)).toBe(true);
    }
    for (const key of ["black-hole", "pillars-1b", "g292", "gas-cloud", "planetary-nebula", "sf-black-hole"]) {
      expect(n.has(`centerpiece-${key}`)).toBe(true);
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

  it("the moon drifts and its outpost rides with it; reduced motion holds both still", () => {
    const scene = createScaleScene(buildScaleLayout());
    const moon = scene.group.getObjectByName("moon")!;
    const dome = scene.group.getObjectByName("moon-outpost-dome")!;
    // The outpost is a child of the moon holder, at its layout offset —
    // so it rides with the moon by construction, not by a second drift.
    expect(dome.parent).toBe(moon);
    const at0 = moon.position.clone();
    scene.update(100_000);
    expect(moon.position.equals(at0)).toBe(false);
    const before = moon.position.clone();
    scene.update(200_000, { reducedMotion: true });
    expect(moon.position.equals(before)).toBe(true);
    scene.dispose();
  });

  it("encounters and the debris satellite drift on their own vectors", () => {
    const scene = createScaleScene(buildScaleLayout());
    const alien = scene.group.getObjectByName("encounter-alien")!;
    const at0 = alien.position.clone();
    scene.update(100_000);
    expect(alien.position.equals(at0)).toBe(false);
    const satellite = scene.group.getObjectByName("satellite-a")!;
    const sat0 = satellite.position.clone();
    scene.update(150_000);
    expect(satellite.position.equals(sat0)).toBe(false);
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
