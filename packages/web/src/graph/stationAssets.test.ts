import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  DOCKED_MODELS,
  DOCKING_MODEL_INDEX,
  DRESSING_MODELS,
  DRYDOCK_PIECES,
  LOWPOLY_DOCKED_MODELS,
  LOWPOLY_DRESSING_MODELS,
  LOWPOLY_GANTRY,
  STATION_ASSET_URLS,
  STATION_BACKDROP_DRAW_CALLS,
  STATION_BACKDROP_PLANETS,
  STATION_BACKDROP_TRIS_TOTAL,
  STATION_CLUSTERS,
  TRAFFIC_MODELS,
  WITNESS_HAULER,
  mergeByMaterial,
  mergeClusterToSingleMaterial,
  mergeToSingleMaterial,
  recenterGeometry,
  scaleGeometryToSize,
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

  it("the low-poly population is four docked ships, five dressing pieces, and the gantry (2,096 tris)", () => {
    expect(LOWPOLY_DOCKED_MODELS.map((m) => m.key)).toEqual([
      "rocket_classic",
      "rocket_shuttle",
      "lander_pod",
      "space_capsule",
    ]);
    expect(LOWPOLY_DOCKED_MODELS.reduce((n, m) => n + m.tris * m.instances, 0)).toBe(880);
    expect(LOWPOLY_DRESSING_MODELS.map((m) => m.key)).toEqual([
      "space_station_core",
      "station_module",
      "satellite_dish",
      "solar_array",
      "fuel_tank",
    ]);
    expect(LOWPOLY_DRESSING_MODELS.reduce((n, m) => n + m.tris * m.instances, 0)).toBe(884);
    expect(LOWPOLY_GANTRY.key).toBe("launch_tower");
    expect(LOWPOLY_GANTRY.tris).toBe(332);
    expect(
      LOWPOLY_DOCKED_MODELS.reduce((n, m) => n + m.tris * m.instances, 0) +
        LOWPOLY_DRESSING_MODELS.reduce((n, m) => n + m.tris * m.instances, 0) +
        LOWPOLY_GANTRY.tris,
    ).toBe(2096);
    // All low-poly URLs are flat in public/ — the upload manifest grows by 10.
    for (const m of [...LOWPOLY_DOCKED_MODELS, ...LOWPOLY_DRESSING_MODELS, LOWPOLY_GANTRY]) {
      expect(m.url.startsWith("/lowpoly-")).toBe(true);
      expect(STATION_ASSET_URLS).toContain(m.url);
    }
  });

  it("the hunt-2 annex clusters are three whole packs, each merged to one call (85 models, 10,410 tris)", () => {
    expect(STATION_CLUSTERS.map((c) => c.key)).toEqual([
      "lunar-annex",
      "colony-ring",
      "station-stores",
    ]);
    expect(STATION_CLUSTERS.map((c) => c.models.length)).toEqual([27, 26, 32]);
    expect(STATION_CLUSTERS.map((c) => c.models.reduce((n, m) => n + m.tris, 0))).toEqual([
      3582, 3200, 3628,
    ]);
    const total = STATION_CLUSTERS.reduce(
      (n, c) => n + c.models.reduce((m, x) => m + x.tris, 0),
      0,
    );
    expect(total).toBe(10_410);
    // Every cluster URL is a distinct GLB, flat in public/, with its
    // measured SHA-256 and size — the upload check.
    const urls = STATION_CLUSTERS.flatMap((c) => c.models.map((m) => m.url));
    expect(new Set(urls).size).toBe(urls.length);
    for (const cluster of STATION_CLUSTERS) {
      for (const m of cluster.models) {
        expect(m.url.startsWith("/")).toBe(true);
        expect(m.url.endsWith(".glb")).toBe(true);
        expect(STATION_ASSET_URLS).toContain(m.url);
        expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(m.bytes).toBeGreaterThan(0);
        expect(m.size).toBeGreaterThan(0);
      }
    }
    // Keys are unique inside a cluster and prefixed so two packs can
    // never collide on the same public filename.
    for (const cluster of STATION_CLUSTERS) {
      expect(new Set(cluster.models.map((m) => m.key)).size).toBe(cluster.models.length);
    }
    expect(STATION_CLUSTERS[0]!.models.every((m) => m.key.startsWith("lunar-"))).toBe(true);
    expect(STATION_CLUSTERS[1]!.models.every((m) => m.key.startsWith("colony-"))).toBe(true);
    expect(
      STATION_CLUSTERS[2]!.models.every(
        (m) => m.key.startsWith("stationpack-") || m.key.startsWith("kenney-"),
      ),
    ).toBe(true);
    // Tall structures (bbox-y >= 6) are placed at size 9, the rest at 6.
    const lunar = STATION_CLUSTERS[0]!;
    expect(lunar.models.filter((m) => m.size === 9).length).toBeGreaterThan(0);
    expect(lunar.models.every((m) => m.size === 9 || m.size === 6)).toBe(true);
  });

  it("the EVE-style backdrop planets are the lava planet and a Quaternius planet, 4,000 out, as-is (3 calls, 10,522 tris)", () => {
    expect(STATION_BACKDROP_PLANETS.map((m) => m.key)).toEqual([
      "lava",
      "quaternius-planet-1",
    ]);
    expect(STATION_BACKDROP_PLANETS.map((m) => m.url)).toEqual([
      "/sf-lava-planet.glb",
      "/pp-planet-1.glb",
    ]);
    expect(STATION_BACKDROP_PLANETS.map((m) => m.tris)).toEqual([7936, 2586]);
    expect(STATION_BACKDROP_PLANETS.map((m) => m.materials)).toEqual([2, 1]);
    expect(STATION_BACKDROP_TRIS_TOTAL).toBe(10_522);
    expect(STATION_BACKDROP_DRAW_CALLS).toBe(3);
    for (const m of STATION_BACKDROP_PLANETS) {
      expect(STATION_ASSET_URLS).toContain(m.url);
      // 4,000 out, ~7° up, ~180° apart — the slow orbit (radius 600)
      // never brings the camera closer than ~3,400.
      expect(m.distance).toBe(4000);
      expect(m.y).toBe(500);
      expect(m.size).toBe(800);
    }
    expect(STATION_BACKDROP_PLANETS[1]!.angle).toBeCloseTo(
      STATION_BACKDROP_PLANETS[0]!.angle + Math.PI,
      10,
    );
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

describe("mergeClusterToSingleMaterial", () => {
  it("merges a whole settlement to one mesh, one material, sitting on the deck", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const other = new THREE.MeshStandardMaterial({ color: 0x000000 });
    // Model A: two boxes 10 apart (indexed, with UVs) — their relative
    // layout must survive the merge.
    const rootA = new THREE.Group();
    rootA.add(boxAt(0, mat), boxAt(10, mat));
    // Model B: a non-indexed box with no UVs — mixed geometry must
    // still merge, never half-ship.
    const rootB = new THREE.Group();
    const bare = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    bare.deleteAttribute("uv");
    rootB.add(new THREE.Mesh(bare, other));
    const merged = mergeClusterToSingleMaterial(
      [
        { root: rootA, offset: [0, 0], size: 6 },
        { root: rootB, offset: [20, 0], size: 6 },
      ],
      0x3d4149,
    );
    expect(merged).not.toBeNull();
    const mesh = merged as THREE.Mesh;
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x3d4149);
    // 12 tris per box x 3 boxes.
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect((geo.getAttribute("position")!.count / 3)).toBe(36);
    // Model A spans x -3..3 after its 11-wide layout is fitted to 6;
    // model B sits at offset 20, spanning 17..23. Both sit on the deck.
    const box = new THREE.Box3().setFromObject(merged as THREE.Object3D);
    expect(box.min.x).toBeCloseTo(-3, 5);
    expect(box.max.x).toBeCloseTo(23, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(6, 5);
  });

  it("returns null for an empty list and for a model with no meshes", () => {
    expect(mergeClusterToSingleMaterial([])).toBeNull();
    expect(
      mergeClusterToSingleMaterial([{ root: new THREE.Group(), offset: [0, 0], size: 6 }]),
    ).toBeNull();
  });
});

describe("recenterGeometry + scaleGeometryToSize", () => {
  it("recenters a geometry on its own bounding-box center", () => {
    const geo = new THREE.BoxGeometry(2, 4, 6);
    geo.translate(10, 20, 30);
    expect(recenterGeometry(geo)).toBe(geo);
    geo.computeBoundingBox();
    const center = geo.boundingBox!.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(2, 5);
    expect(size.y).toBeCloseTo(4, 5);
    expect(size.z).toBeCloseTo(6, 5);
  });

  it("scales a geometry so its longest side is the target size", () => {
    const geo = new THREE.BoxGeometry(2, 4, 6);
    expect(scaleGeometryToSize(geo, 12)).toBeCloseTo(2, 5);
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(4, 5);
    expect(size.y).toBeCloseTo(8, 5);
    expect(size.z).toBeCloseTo(12, 5);
  });

  it("scales the tiny FlexUnit UFO up: a 0.05-unit file fits to 3 units", () => {
    const geo = new THREE.BoxGeometry(0.05, 0.05, 0.02);
    expect(scaleGeometryToSize(geo, 3)).toBeCloseTo(60, 5);
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(3, 5);
  });

  it("returns 1 and leaves a degenerate geometry alone", () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    expect(scaleGeometryToSize(geo, 10)).toBe(1);
  });
});
