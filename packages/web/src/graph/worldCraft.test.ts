import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dustMotes, groundMist, lightPools, rockWall, rolledGround, surfaceMaterial, surfaceTextures, tileFbm, type SurfaceKind } from "./worldCraft.js";

const KINDS: SurfaceKind[] = ["rock", "flagstone", "plaster", "wood", "metal", "soil", "pale", "brass", "grass"];

describe("world craft kit", () => {
  it("every surface has real variation (never one flat colour) and is built once", () => {
    for (const k of KINDS) {
      const t = surfaceTextures(k);
      const d = t.map.image.data as Uint8Array;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        lo = Math.min(lo, d[i]!);
        hi = Math.max(hi, d[i]!);
      }
      expect(hi - lo, k).toBeGreaterThan(20);
      expect(surfaceTextures(k)).toBe(t);
      expect(t.map.wrapS).toBe(THREE.RepeatWrapping);
    }
  });
  it("the noise tiles: the left edge meets the right edge", () => {
    for (const v of [0.1, 0.37, 0.8]) expect(tileFbm(0, v, 4, 4, 5)).toBeCloseTo(tileFbm(1, v, 4, 4, 5), 6);
  });
  it("a material carries its own repeat without changing another's", () => {
    const a = surfaceMaterial("rock", { repeat: [3, 2] });
    const b = surfaceMaterial("rock");
    expect(a.map!.repeat.x).toBe(3);
    expect(b.map!.repeat.x).toBe(1);
  });
  it("a rock wall is not a flat sheet and carries a contact shadow", () => {
    const g = rockWall(600, 180, { seed: 3 });
    const pos = g.getAttribute("position");
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      zMin = Math.min(zMin, pos.getZ(i));
      zMax = Math.max(zMax, pos.getZ(i));
    }
    expect(zMax - zMin).toBeGreaterThan(10);
    const col = g.getAttribute("color");
    expect(col).toBeTruthy();
    // the foot is darker than the middle
    let foot = 0;
    let mid = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 1) foot = Math.max(foot, col.getX(i));
      if (Math.abs(pos.getY(i) - 90) < 12) mid = Math.max(mid, col.getX(i));
    }
    expect(foot).toBeLessThan(mid);
  });
  it("rolled ground stays dead flat where it is told to", () => {
    const g = rolledGround(400, 400, { amp: 8, flat: (x) => (Math.abs(x) < 100 ? 0 : 1) });
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < 100) expect(Math.abs(pos.getY(i))).toBe(0);
  });
  it("dust and mist hold still under reduced motion and move otherwise", () => {
    const d = dustMotes({ min: [0, 0, 0], max: [10, 10, 10] }, 12, 0xffffff, 1, 0.5, "d");
    const m = groundMist([{ x: 0, y: 0, z: 0 }], 0xffffff, 100, 0.1, "m");
    for (const it of [d, m]) {
      const pos = (it.object as THREE.Points).geometry.getAttribute("position");
      const before = Array.from(pos.array as Float32Array);
      it.update(9000, true);
      expect(Array.from(pos.array as Float32Array)).toEqual(before);
      it.update(9000, false);
      expect(Array.from(pos.array as Float32Array)).not.toEqual(before);
    }
  });
  it("light pools are one draw call for any number of lamps", () => {
    const p = lightPools([{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: 9, z: 1 }], 0xffaa66, 50, 0.4, "pools");
    expect(p.isInstancedMesh).toBe(true);
    expect(p.count).toBe(3);
  });
});
