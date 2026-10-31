import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FOLD_HOLDERS } from "./foldLayout.js";
import { createFoldScene } from "./foldScene.js";

describe("the Folded Letter scene", () => {
  it("builds every named holder with a real box, inside the draw-call budget, and no figure", () => {
    const s = createFoldScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of FOLD_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(50);
    s.dispose();
  });
  it("writes nothing anywhere (no text sprite, no canvas texture) and holds the lamp still under reduced motion", () => {
    const s = createFoldScene();
    let textures = 0;
    s.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && (m as THREE.MeshBasicMaterial).map && !(o as THREE.Points).isPoints) textures++;
    });
    expect(textures).toBe(0);
    const mat = (s.group.getObjectByName("fold-lamp-glow") as THREE.Points).material as THREE.PointsMaterial;
    s.update(0, { reducedMotion: true });
    const a = mat.opacity;
    s.update(5000, { reducedMotion: true });
    expect(mat.opacity).toBe(a);
    s.dispose();
  });
});
