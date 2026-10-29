import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyWorldLighting, DEFAULT_WORLD_RIG } from "./worldLighting.js";

// The environment map (PMREM) needs a real WebGL renderer, which jsdom doesn't have;
// the light half is checked here, the env half by the measured before/after shots.
const noRenderer = {} as THREE.WebGLRenderer;

describe("applyWorldLighting", () => {
  it("adds the hemisphere fill and the key light, and dispose removes exactly those", () => {
    const scene = new THREE.Scene();
    const own = new THREE.AmbientLight(0xffffff, 0.1);
    scene.add(own);
    const applied = applyWorldLighting(scene, noRenderer, {
      env: 0,
      hemi: { sky: 0x8899ff, ground: 0x221133, intensity: 0.9 },
      key: { color: 0xffeedd, intensity: 2.5, from: [100, 200, 300] },
    });
    const hemi = scene.getObjectByName("world-hemi") as THREE.HemisphereLight;
    const key = scene.getObjectByName("world-key") as THREE.DirectionalLight;
    expect(hemi.intensity).toBe(0.9);
    expect(key.intensity).toBe(2.5);
    expect(key.position.toArray()).toEqual([100, 200, 300]);
    expect(scene.environment).toBeNull();
    applied.dispose();
    expect(scene.getObjectByName("world-hemi")).toBeUndefined();
    expect(scene.getObjectByName("world-key")).toBeUndefined();
    expect(scene.children).toContain(own); // the world's own lights are never touched
  });

  it("an empty rig applies nothing", () => {
    const scene = new THREE.Scene();
    applyWorldLighting(scene, noRenderer, { env: 0 }).dispose();
    expect(scene.children).toHaveLength(0);
  });

  it("the default rig lights a space world without washing it out", () => {
    expect(DEFAULT_WORLD_RIG.env).toBeGreaterThan(0);
    expect(DEFAULT_WORLD_RIG.env).toBeLessThanOrEqual(1.2);
    expect(DEFAULT_WORLD_RIG.key!.intensity).toBeLessThan(4);
  });
});
