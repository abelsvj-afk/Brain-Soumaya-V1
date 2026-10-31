import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SIEGE_HOLDERS } from "./siegeLayout.js";
import { createSiegeScene } from "./siegeScene.js";

describe("the Siege scene", () => {
  it("builds every named holder with a real box, inside the draw-call budget, and no figure", () => {
    const s = createSiegeScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of SIEGE_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(50);
    s.dispose();
  });
  it("holds the bead still under reduced motion", () => {
    const s = createSiegeScene();
    const mat = (s.group.getObjectByName("siege-bead-glow") as THREE.Points).material as THREE.PointsMaterial;
    s.update(0, { reducedMotion: true });
    const a = mat.opacity;
    s.update(4000, { reducedMotion: true });
    expect(mat.opacity).toBe(a);
    s.update(0);
    const b = mat.opacity;
    s.update(1000);
    expect(mat.opacity).not.toBe(b);
    s.dispose();
  });
});
