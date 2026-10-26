import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  DOCKED_MODELS,
  DOCKING_MODEL_INDEX,
  DRESSING_MODELS,
  DRYDOCK_PIECES,
  STATION_ASSET_URLS,
  TRAFFIC_MODELS,
  WITNESS_HAULER,
  mergeByMaterial,
  mergeToSingleMaterial,
} from "./stationAssets.js";
import { trafficLanes } from "./stationLayout.js";

describe("stationAssets manifest", () => {
  it("traffic is twelve models, one per lane, all GLBs", () => {
    expect(TRAFFIC_MODELS.length).toBe(12);
    expect(TRAFFIC_MODELS.length).toBe(trafficLanes("s").length);
    expect(new Set(TRAFFIC_MODELS.map((m) => m.key)).size).toBe(12);
    expect(TRAFFIC_MODELS.every((m) => m.url.endsWith(".glb"))).toBe(true);
    expect(TRAFFIC_MODELS[11]?.key).toBe("wato");
    expect(TRAFFIC_MODELS[DOCKING_MODEL_INDEX]?.key).toBe("dispatcher");
  });

  it("docked ships are four models, six instances — the scale ladder", () => {
    expect(DOCKED_MODELS.length).toBe(4);
    expect(DOCKED_MODELS.reduce((n, m) => n + m.instances, 0)).toBe(6);
    expect(DOCKED_MODELS.reduce((n, m) => n + m.tris * m.instances, 0)).toBe(2072);
  });

  it("dressing is six models, two instances each", () => {
    expect(DRESSING_MODELS.length).toBe(6);
    expect(DRESSING_MODELS.reduce((n, m) => n + m.instances, 0)).toBe(12);
    expect(DRESSING_MODELS.reduce((n, m) => n + m.tris * m.instances, 0)).toBe(1764);
  });

  it("the drydock frame is the recon composition (1,516 tris)", () => {
    expect(DRYDOCK_PIECES.reduce((n, m) => n + m.tris * m.instances, 0)).toBe(1516);
    expect(WITNESS_HAULER.tris).toBe(264);
  });

  it("every asset URL is a distinct GLB under public/", () => {
    expect(STATION_ASSET_URLS.every((u) => u.startsWith("/") && u.endsWith(".glb"))).toBe(
      true,
    );
    expect(new Set(STATION_ASSET_URLS).size).toBe(STATION_ASSET_URLS.length);
  });
});

function boxAt(x: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(x, 0, 0);
  return mesh;
}

describe("mergeByMaterial", () => {
  it("merges meshes sharing a material into one mesh, transforms baked", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const other = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const g = new THREE.Group();
    g.add(boxAt(0, mat), boxAt(10, mat), boxAt(20, other));
    const merged = mergeByMaterial(g);
    const meshes: THREE.Mesh[] = [];
    merged.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes.length).toBe(2);
    const box = new THREE.Box3().setFromObject(merged);
    expect(box.min.x).toBeCloseTo(-0.5, 5);
    expect(box.max.x).toBeCloseTo(20.5, 5);
  });

  it("returns the original root when attributes cannot merge", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const g = new THREE.Group();
      g.add(boxAt(0, mat));
      const bare = new THREE.BufferGeometry();
      bare.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
      g.add(new THREE.Mesh(bare, mat));
      expect(mergeByMaterial(g)).toBe(g);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the root untouched when there is nothing to merge", () => {
    const g = new THREE.Group();
    expect(mergeByMaterial(g)).toBe(g);
  });
});

describe("mergeToSingleMaterial", () => {
  it("merges several meshes into one mesh with one material", () => {
    const g = new THREE.Group();
    g.add(boxAt(0, new THREE.MeshStandardMaterial({ color: 0xff0000 })));
    g.add(boxAt(10, new THREE.MeshStandardMaterial({ color: 0x00ff00 })));
    const merged = mergeToSingleMaterial(g, 0x3d4149);
    expect(merged).not.toBeNull();
    expect((merged as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(((merged as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x3d4149);
    const box = new THREE.Box3().setFromObject(merged as THREE.Object3D);
    expect(box.min.x).toBeCloseTo(-0.5, 5);
    expect(box.max.x).toBeCloseTo(10.5, 5);
  });

  it("returns null for an empty group", () => {
    expect(mergeToSingleMaterial(new THREE.Group())).toBeNull();
  });
});
