import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ROAD_HOLDERS } from "./roadLayout.js";
import { createRoadScene } from "./roadScene.js";

describe("the Road to the Seam scene", () => {
  it("builds every named holder the lore anchors to, with a real box, inside the draw-call budget", () => {
    const s = createRoadScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if ((o as THREE.Mesh).isMesh && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of ROAD_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(30);
    s.dispose();
  });
  it("holds the lamps still under reduced motion and breathes otherwise", () => {
    const s = createRoadScene();
    const glow = s.group.getObjectByName("road-lamp-glows") as THREE.InstancedMesh;
    const mat = glow.material as THREE.MeshBasicMaterial;
    s.update(0, { reducedMotion: true });
    const a = mat.opacity;
    s.update(5000, { reducedMotion: true });
    expect(mat.opacity).toBe(a);
    s.update(0);
    const b = mat.opacity;
    s.update(2000);
    expect(mat.opacity).not.toBe(b);
    s.dispose();
  });
});
