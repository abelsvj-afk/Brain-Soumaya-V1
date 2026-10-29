import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildEternityHalo } from "./eternityHalo.js";
import { installHomeSky } from "./homeSky.js";

describe("Eternity's halo (spec §2d)", () => {
  it("one additive arc, far out, brighter on a day he acted, still under reduced motion", () => {
    const h = buildEternityHalo(2200, 7000);
    const arc = h.group.getObjectByName("eternity-halo-arc") as THREE.Mesh;
    const mat = arc.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(h.group.position.length()).toBeGreaterThan(6000);
    h.setIntensity(0.35);
    const faint = mat.opacity;
    h.setIntensity(1);
    expect(mat.opacity).toBeGreaterThan(faint);
    const before = mat.opacity;
    h.update(12.3, true);
    expect(mat.opacity).toBe(before); // reduced motion: no breathing
    h.dispose();
  });
  it("every world's shared sky carries his presence", () => {
    const scene = new THREE.Scene();
    const sky = installHomeSky({} as THREE.WebGLRenderer, scene, "low"); // the bake fails without GL; the sky still installs
    expect(sky.group.getObjectByName("eternity-halo")).toBeTruthy();
    sky.dispose();
  });
});
