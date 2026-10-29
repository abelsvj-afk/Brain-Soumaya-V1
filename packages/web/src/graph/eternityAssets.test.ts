import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  ETERNITY_ASSET_URLS,
  FIGURE_MODEL,
  VISITOR_MODELS,
  fitShip,
  splitFigure,
} from "./eternityAssets.js";

describe("eternityAssets manifest", () => {
  it("names 13 GLBs, all flat in public/ — the figure plus 12 visitors", () => {
    expect(ETERNITY_ASSET_URLS).toHaveLength(13);
    expect(FIGURE_MODEL.url).toBe("/man-god-halo.glb");
    expect(FIGURE_MODEL.tris).toBe(222_118);
    for (const url of ETERNITY_ASSET_URLS) {
      expect(url.startsWith("/")).toBe(true);
      expect(url.slice(1)).not.toContain("/");
    }
    expect(new Set(ETERNITY_ASSET_URLS).size).toBe(13);
  });

  it("the four speeders are in the manifest — they are new to the app", () => {
    const keys = VISITOR_MODELS.map((m) => m.key);
    expect(keys).toContain("craft_speederA");
    expect(keys).toContain("craft_speederB");
    expect(keys).toContain("craft_speederC");
    expect(keys).toContain("craft_speederD");
    expect(VISITOR_MODELS).toHaveLength(12);
  });

  it("every visitor hull is a −Z nose (turn PI about Y); the figure is not flipped", () => {
    expect(VISITOR_MODELS.every((m) => m.flip)).toBe(true);
    expect(FIGURE_MODEL.flip).toBe(false);
  });
});

describe("fitShip", () => {
  function boxHull(w: number, h: number, d: number): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()));
    return g;
  }

  it("scales the longest side to the target length and centres the hull", () => {
    const hull = boxHull(2, 4, 6);
    fitShip(hull, 11, false);
    const box = new THREE.Box3().setFromObject(hull);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(11, 6);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.y).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });

  it("a −Z nose turns PI about Y", () => {
    const hull = boxHull(2, 2, 6);
    fitShip(hull, 6, true);
    expect(hull.rotation.y).toBeCloseTo(Math.PI, 6);
  });
});

describe("splitFigure", () => {
  it("separates the halo mesh (named 'halo') from the body meshes", () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    body.name = "body";
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 8, 32), new THREE.MeshBasicMaterial());
    halo.name = "halo";
    root.add(body, halo);
    const split = splitFigure(root);
    expect(split.body).toHaveLength(1);
    expect(split.halo).toBe(halo);
  });

  it("an unsplit figure yields no halo — the caller treats it all as body", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    const split = splitFigure(root);
    expect(split.body).toHaveLength(1);
    expect(split.halo).toBeNull();
  });
});
