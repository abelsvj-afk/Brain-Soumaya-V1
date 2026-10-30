import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WORLD_PROPS, attachWorldProps, buildProp, placeProp, type PropKind } from "./worldProps.js";

describe("story props", () => {
  it("stand in the holder's own box coordinates and are sized to it", () => {
    const p = placeProp({ min: [-10, 0, -20], max: [10, 4, 20] }, { at: [1, 1, 0], size: 0.1 })!;
    expect(p.pos).toEqual([10, 4, 0]);
    expect(p.scale).toBeCloseTo(Math.hypot(10, 2, 20) * 0.1);
  });
  it("wait for a holder that has not loaded (an empty box) and accept a flat ground plane", () => {
    expect(placeProp({ min: [0, 0, 0], max: [0, 0, 0] }, { at: [0, 0, 0], size: 1 })).toBeNull();
    expect(placeProp({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, { at: [0, 0, 0], size: 1 })).toBeNull();
    expect(placeProp({ min: [-100, 0, -100], max: [100, 0, 100] }, { at: [0, 1, 0], size: 0.05 })).not.toBeNull();
  });
  it("every kind builds a small, wordless thing with only a few meshes", () => {
    const kinds = new Set<PropKind>(Object.values(WORLD_PROPS).flatMap((l) => l.map((s) => s.kind)));
    for (const k of kinds) {
      const g = buildProp(k);
      let meshes = 0;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes, k).toBeGreaterThan(0);
      expect(meshes, k).toBeLessThanOrEqual(10);
    }
  });
  it("attaches beside a named holder once it has a box, and never twice", () => {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    holder.name = "still-threshold";
    root.add(holder);
    const h = attachWorldProps("quiet-archive", root);
    expect(h.place()).toBe(false); // the holder has no geometry yet
    holder.add(new THREE.Mesh(new THREE.BoxGeometry(40, 10, 40)));
    expect(h.place()).toBe(true);
    expect(h.place()).toBe(true);
    const props = root.getObjectByName("world-props")!;
    expect(props.children.length).toBe(WORLD_PROPS["quiet-archive"]!.length);
    h.dispose();
    expect(root.getObjectByName("world-props")).toBeUndefined();
  });
});
