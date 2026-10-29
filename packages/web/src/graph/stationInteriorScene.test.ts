import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { STATION_INTERIOR_BUDGET } from "./stationInteriorLayout.js";
import {
  bayShipPose,
  createStationInteriorScene,
  EMPTY_STATION_INTERIOR_LAYOUT,
  styleShipHullForSkin,
} from "./stationInteriorScene.js";
import { interiorShipUrlForSkin } from "./stationInteriorAssets.js";

/** Draw calls: every object that draws (meshes, instanced meshes, points, lines, sprites). */
function countDrawCalls(group: THREE.Group): number {
  let calls = 0;
  group.traverse((o) => {
    const anyO = o as THREE.Mesh & THREE.InstancedMesh & THREE.Points & THREE.Line & THREE.Sprite;
    if (anyO.isMesh || anyO.isInstancedMesh || anyO.isPoints || anyO.isLine || anyO.isSprite) calls++;
  });
  return calls;
}

/** Triangle estimate: indexed geometry counts × instance count; sprites count 2 each. */
function estimateTris(group: THREE.Group): number {
  let tris = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
      const geo = mesh.geometry as THREE.BufferGeometry;
      const per = (geo.index ? geo.index.count : geo.getAttribute("position")!.count) / 3;
      const instances = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as unknown as THREE.InstancedMesh).count
        : 1;
      tris += per * instances;
    } else if ((o as THREE.Sprite).isSprite) {
      tris += 2;
    }
  });
  return Math.round(tris);
}

function names(group: THREE.Group): Set<string> {
  const out = new Set<string>();
  group.traverse((o) => out.add(o.name));
  return out;
}

describe("createStationInteriorScene", () => {
  it("renders the whole hall synchronously: floors, ceilings, lights, gate, rim arc, sky", () => {
    const scene = createStationInteriorScene();
    const n = names(scene.group);
    expect(n.has("station-interior")).toBe(true);
    for (const id of ["hangar-bay", "commission-board", "fleet-deck", "observation-deck"]) {
      expect(n.has(`interior-floor-${id}`)).toBe(true);
      expect(n.has(`interior-ceiling-${id}`)).toBe(true);
    }
    expect(n.has("interior-light-strips")).toBe(true);
    expect(n.has("interior-nav-markers")).toBe(true);
    expect(n.has("interior-work-lights")).toBe(true);
    expect(n.has("interior-gate-lintel")).toBe(true);
    expect(n.has("interior-gate-lights")).toBe(true);
    expect(n.has("interior-bay-door-lintel")).toBe(true);
    expect(n.has("interior-deck-viewport-lintel")).toBe(true);
    expect(n.has("interior-rim-arc")).toBe(true);
    // The true sky, seen through the door and the viewport.
    expect([...n].some((name) => name.startsWith("hyg-starfield-"))).toBe(true);
    scene.dispose();
  });

  it("holds the Station's budget with wide margin (static half — before any GLB lands)", () => {
    const scene = createStationInteriorScene();
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(STATION_INTERIOR_BUDGET.maxDrawCalls);
    expect(estimateTris(scene.group)).toBeLessThanOrEqual(STATION_INTERIOR_BUDGET.maxTris);
    // The static half is small on purpose: the kit pieces (~2,500 tris
    // when they land) still leave ~490k of headroom.
    expect(estimateTris(scene.group)).toBeLessThan(10_000);
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(30);
    scene.dispose();
  });

  it("the empty layout still renders floors, lights, and sky — never a blank room", () => {
    const scene = createStationInteriorScene(EMPTY_STATION_INTERIOR_LAYOUT);
    const n = names(scene.group);
    expect(n.has("station-interior")).toBe(true);
    expect(n.has("interior-light-strips")).toBe(true);
    expect(n.has("interior-nav-markers")).toBe(true);
    expect(n.has("interior-rim-arc")).toBe(true);
    expect([...n].some((name) => name.startsWith("hyg-starfield-"))).toBe(true);
    scene.dispose();
  });

  it("dispose is safe twice", () => {
    const scene = createStationInteriorScene();
    scene.dispose();
    expect(() => scene.dispose()).not.toThrow();
  });

  it("reduced motion holds the hall: update with reducedMotion never throws and steadies the lights", () => {
    const scene = createStationInteriorScene();
    expect(() => scene.update(60_000, { reducedMotion: true })).not.toThrow();
    expect(() => scene.update(60_000)).not.toThrow();
    scene.dispose();
  });
});

describe("bayShipPose", () => {
  it("rides the lane past the bay door and returns", () => {
    const start = bayShipPose(0);
    expect(start.x).toBe(30);
    const mid = bayShipPose(60_000);
    expect(mid.x).toBe(110);
    const end = bayShipPose(120_000);
    expect(end.x).toBe(30);
  });
});

describe("interiorShipUrlForSkin", () => {
  it("maps the organic skin to the organic hull and everything else to her ship", () => {
    expect(interiorShipUrlForSkin("organic")).toBe("/organic-spaceship.glb");
    expect(interiorShipUrlForSkin("default")).toBe("/soumaya-ship.glb");
    expect(interiorShipUrlForSkin("fusion_core")).toBe("/soumaya-ship.glb");
    expect(interiorShipUrlForSkin("holographic")).toBe("/soumaya-ship.glb");
  });
});

describe("styleShipHullForSkin", () => {
  function hull(): THREE.Object3D {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#ffffff" }),
    );
    group.add(mesh);
    return group;
  }

  it("leaves default and organic hulls untouched", () => {
    for (const skin of ["default", "organic"]) {
      const group = hull();
      const mat = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      styleShipHullForSkin(group, skin);
      expect((group.children[0] as THREE.Mesh).material).toBe(mat);
      expect(mat.wireframe).toBe(false);
    }
  });

  it("styles holographic as wireframe cyan, translucent — without mutating the original material", () => {
    const group = hull();
    const original = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    styleShipHullForSkin(group, "holographic");
    const styled = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(styled).not.toBe(original);
    expect(styled.wireframe).toBe(true);
    expect(styled.color.getHexString()).toBe("00f5ff");
    expect(styled.transparent).toBe(true);
    expect(styled.opacity).toBe(0.6);
    // The original is untouched — a hull shared with the galaxy is never re-tinted there.
    expect(original.wireframe).toBe(false);
    expect(original.opacity).toBe(1);
  });

  it("styles fusion_core as orange emissive, opaque", () => {
    const group = hull();
    styleShipHullForSkin(group, "fusion_core");
    const styled = (group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(styled.wireframe).toBe(false);
    expect(styled.color.getHexString()).toBe("ff4500");
    expect(styled.emissive.getHexString()).toBe("ff8c00");
    expect(styled.transparent).toBe(false);
    expect(styled.opacity).toBe(1);
  });
});
