import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { LONG_HOLDERS } from "./longLayout.js";
import { createLongScene } from "./longScene.js";

describe("the Long Morning scene", () => {
  it("builds every named holder with a real box, inside the draw-call budget, and no figure", () => {
    const s = createLongScene();
    const byName = new Map<string, THREE.Object3D>();
    let drawn = 0;
    s.group.traverse((o) => {
      if (o.name) byName.set(o.name, o);
      if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.visible) drawn++;
    });
    s.group.updateMatrixWorld(true);
    for (const h of LONG_HOLDERS) {
      const o = byName.get(h);
      expect(o, h).toBeTruthy();
      expect(new THREE.Box3().setFromObject(o!).isEmpty(), `${h} has a box`).toBe(false);
    }
    expect(drawn).toBeLessThanOrEqual(50);
    s.dispose();
  });
  it("holds the people still under reduced motion", () => {
    const s = createLongScene();
    const cols = s.group.getObjectByName("long-people-columns")!.children[0] as THREE.InstancedMesh;
    s.update(0, { reducedMotion: true });
    const a = cols.instanceMatrix.array.slice(0, 16).join(",");
    s.update(5000, { reducedMotion: true });
    expect(cols.instanceMatrix.array.slice(0, 16).join(",")).toBe(a);
    s.update(0);
    const b = cols.instanceMatrix.array.slice(0, 16).join(",");
    s.update(3000);
    expect(cols.instanceMatrix.array.slice(0, 16).join(",")).not.toBe(b);
    s.dispose();
  });
});
