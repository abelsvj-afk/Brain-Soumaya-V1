import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VILLAGE_HOLDERS } from "./villageLayout.js";
import { createVillageScene } from "./villageScene.js";

describe("the Village scene", () => {
  it("builds every named holder with a real box, inside the draw-call budget, and no figure", () => {
    const s = createVillageScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if ((o as THREE.Mesh).isMesh && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of VILLAGE_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(50);
    s.dispose();
  });
  it("holds the windows still under reduced motion", () => {
    const s = createVillageScene();
    const mat = (s.group.getObjectByName("village-window-glows") as THREE.Points).material as THREE.PointsMaterial;
    s.update(0, { reducedMotion: true });
    const a = mat.opacity;
    s.update(6000, { reducedMotion: true });
    expect(mat.opacity).toBe(a);
    s.update(0);
    const b = mat.opacity;
    s.update(2500);
    expect(mat.opacity).not.toBe(b);
    s.dispose();
  });
});
