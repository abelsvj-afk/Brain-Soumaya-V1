import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createEternityScene } from "./eternityScene.js";
import { VISITOR_MODELS } from "./eternityAssets.js";

function find(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

function findAll(group: THREE.Group, prefix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
}

describe("createEternityScene", () => {
  it("constructs the white void: figure group, far colour, tablet, shield, comet (no network in tests)", () => {
    const scene = createEternityScene();
    expect(find(scene.group, "eternity-figure")).toBeTruthy();
    expect(find(scene.group, "eternity-far")).toBeTruthy();
    expect(find(scene.group, "eternity-speech-tablet")).toBeTruthy();
    expect(find(scene.group, "eternity-shield")).toBeTruthy();
    expect(find(scene.group, "eternity-comet")).toBeTruthy();
    expect(find(scene.group, "eternity-motes")).toBeTruthy();
    expect(find(scene.group, "eternity-player-ship")).toBeTruthy();
    // Twelve visitor slots, one per fleet model — empty until the GLBs land.
    const visitors = findAll(scene.group, "eternity-visitor-");
    expect(visitors).toHaveLength(VISITOR_MODELS.length);
    for (const v of visitors) expect(v.children.length).toBe(0);
    // No figure meshes until the owner's GLB lands — no faked figure.
    const figure = find(scene.group, "eternity-figure")!;
    let meshes = 0;
    figure.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(0);
    scene.dispose();
  });

  it("update moves the visitors along their orbits; reduced motion freezes them", () => {
    const scene = createEternityScene();
    scene.update(0);
    const first = find(scene.group, "eternity-visitor-craft_cargoA")!;
    const before = first.position.clone();
    scene.update(30_000);
    const after = first.position.clone();
    expect(after.equals(before)).toBe(false);
    scene.update(30_000, { reducedMotion: true });
    const frozen = first.position.clone();
    scene.update(60_000, { reducedMotion: true });
    expect(first.position.equals(frozen)).toBe(true);
    scene.dispose();
  });

  it("a gesture speaks in the world: the tablet fades in and the heavens shake, then settle", () => {
    const scene = createEternityScene();
    scene.update(0);
    expect(scene.currentGesture()).toBe("stillness");
    scene.setGesture("blessing");
    expect(scene.currentGesture()).toBe("blessing");
    scene.update(200);
    const tablet = find(scene.group, "eternity-speech-tablet") as THREE.Sprite;
    expect((tablet.material as THREE.SpriteMaterial).opacity).toBeGreaterThan(0);
    expect(scene.shakeAt(200)).toBeGreaterThan(0);
    // The shake is 1.4 s; the words hold 7 s, then fade over 1 s.
    scene.update(2000);
    expect(scene.shakeAt(2000)).toBe(0);
    expect((tablet.material as THREE.SpriteMaterial).opacity).toBeGreaterThan(0);
    scene.update(9000);
    expect((tablet.material as THREE.SpriteMaterial).opacity).toBe(0);
    scene.dispose();
  });

  it("an unknown gesture is ignored — he keeps holding what he held", () => {
    const scene = createEternityScene();
    scene.setGesture("smite");
    expect(scene.currentGesture()).toBe("stillness");
    scene.dispose();
  });

  it("reduced motion never shakes the heavens, even mid-speech", () => {
    const scene = createEternityScene();
    scene.update(0);
    scene.setGesture("joy");
    scene.update(200, { reducedMotion: true });
    expect(scene.shakeAt(200)).toBe(0);
    scene.dispose();
  });

  it("the shield tool raises the shield; an unknown tool is ignored", () => {
    const scene = createEternityScene();
    scene.update(0);
    const shield = find(scene.group, "eternity-shield") as THREE.Mesh;
    expect((shield.material as THREE.MeshBasicMaterial).opacity).toBe(0);
    scene.useTool("shield");
    scene.update(1000);
    expect((shield.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    scene.useTool("smite");
    scene.update(2000);
    expect((shield.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    // After 12 s the shield falls again — stepped frame by frame, as
    // the host calls update (one big jump is one clamped frame).
    for (let ms = 2100; ms <= 14_000; ms += 100) scene.update(ms);
    expect((shield.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0, 1);
    scene.dispose();
  });
});
