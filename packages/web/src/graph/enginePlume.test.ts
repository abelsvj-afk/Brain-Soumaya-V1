import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PLUME_POOL, PLUME_STEP, TRAIL_TINTS, createEngineFlame, createEnginePlume, plumePuffs, trailTint } from "./enginePlume.js";

describe("plumePuffs", () => {
  it("drops nothing on the first sighting and for a parked exhaust", () => {
    expect(plumePuffs(null, [0, 0, 0]).points).toEqual([]);
    expect(plumePuffs([0, 0, 0], [0.5, 0, 0]).points).toEqual([]);
  });
  it("spaces puffs evenly along the segment so a fast streak is continuous", () => {
    const r = plumePuffs([0, 0, 0], [PLUME_STEP * 5.5, 0, 0]);
    expect(r.points).toHaveLength(5);
    r.points.forEach((p, i) => expect(p[0]).toBeCloseTo(PLUME_STEP * (i + 1), 5));
    expect(r.last[0]).toBeCloseTo(PLUME_STEP * 5, 5);
  });
  it("restarts the trail across a teleport instead of streaking across the void", () => {
    const r = plumePuffs([0, 0, 0], [PLUME_STEP * 100, 0, 0]);
    expect(r.points).toEqual([]);
    expect(r.last).toEqual([PLUME_STEP * 100, 0, 0]);
  });
  it("never exceeds the pool in one frame", () => {
    expect(plumePuffs([0, 0, 0], [PLUME_STEP * 23, 0, 0], PLUME_STEP, 5).points).toHaveLength(5);
    expect(PLUME_POOL).toBeGreaterThan(0);
  });
});

describe("trail tints", () => {
  it("knows her four trails and falls back to blue", () => {
    expect(trailTint("gold").getHex()).toBe(TRAIL_TINTS.gold);
    expect(trailTint("nope").getHex()).toBe(TRAIL_TINTS.blue);
    expect(trailTint(undefined).getHex()).toBe(TRAIL_TINTS.blue);
  });
});

describe("EnginePlume", () => {
  it("puffs appear behind a moving exhaust, fade, and clear when it stops", () => {
    const plume = createEnginePlume("neon");
    const live = () => plume.group.children.filter((c) => c.visible).length;
    plume.update(16, new THREE.Vector3(0, 0, 0));
    for (let i = 1; i <= 10; i++) plume.update(16, new THREE.Vector3(i * 4, 0, 0));
    expect(live()).toBeGreaterThan(5);
    for (let i = 0; i < 60; i++) plume.update(16, null); // ~1 s with the ship hidden/parked
    expect(live()).toBe(0);
    plume.dispose();
  });
  it("recolours every puff when the trail changes", () => {
    const plume = createEnginePlume("blue");
    plume.setTrail("purple");
    const mat = (plume.group.children[0] as THREE.Sprite).material as THREE.SpriteMaterial;
    expect(mat.color.getHex()).toBe(TRAIL_TINTS.purple);
    plume.dispose();
  });
});

describe("EngineFlame", () => {
  it("lengthens and brightens with thrust", () => {
    const flame = createEngineFlame("gold");
    const tip = () => flame.group.children[flame.group.children.length - 1] as THREE.Sprite;
    flame.setThrust(0);
    const idleZ = tip().position.z;
    const idleOp = (tip().material as THREE.SpriteMaterial).opacity;
    flame.setThrust(1);
    expect(tip().position.z).toBeGreaterThan(idleZ);
    expect((tip().material as THREE.SpriteMaterial).opacity).toBeGreaterThan(idleOp);
    flame.dispose();
  });
});
