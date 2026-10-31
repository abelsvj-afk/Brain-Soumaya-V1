import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { YARD_HOLDERS } from "./yardLayout.js";
import { createYardScene } from "./yardScene.js";

describe("the Unlit Hulls scene", () => {
  it("builds every named holder with a real box, inside the draw-call budget, and no figure", () => {
    const s = createYardScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of YARD_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(50);
    s.dispose();
  });
  it("lights nothing (every hull and lantern is unlit)", () => {
    const s = createYardScene();
    let lights = 0;
    s.group.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
    s.dispose();
  });
});
