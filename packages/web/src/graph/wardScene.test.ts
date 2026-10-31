import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createWardScene } from "./wardScene.js";
import { WARD_HOLDERS } from "./wardLayout.js";

describe("the Faded Ward scene", () => {
  it("builds every named holder the lore anchors to, inside the draw-call budget", () => {
    const s = createWardScene();
    const names = new Set<string>();
    let drawCalls = 0;
    s.group.traverse((o) => {
      if (o.name) names.add(o.name);
      if ((o as THREE.Mesh).isMesh) drawCalls++;
    });
    for (const h of WARD_HOLDERS) expect(names.has(h), h).toBe(true);
    expect(drawCalls).toBeLessThanOrEqual(40); // the host's ceiling is 95 shared with the sky and the ship
    s.dispose();
  });

  it("holds every lantern and breath still under reduced motion, and moves them otherwise", () => {
    const s = createWardScene();
    const glow = s.group.getObjectByName("ward-lantern-glows") as THREE.Points;
    const mat = glow.material as THREE.PointsMaterial;
    s.update(0, { reducedMotion: true });
    const still = mat.opacity;
    s.update(7000, { reducedMotion: true });
    expect(mat.opacity).toBe(still);
    s.update(0);
    const a = mat.opacity;
    s.update(2000);
    expect(mat.opacity).not.toBe(a);
    s.dispose();
  });

  it("shows no face and no body: sleepers are only faint translucent shapes", () => {
    const s = createWardScene();
    const sl = s.group.getObjectByName("ward-sleepers") as THREE.InstancedMesh;
    expect((sl.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect((sl.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.5);
    s.dispose();
  });
});
