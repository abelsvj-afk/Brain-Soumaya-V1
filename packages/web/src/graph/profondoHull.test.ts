import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyProfondoRecipe, normalizeProfondoScale } from "./profondoHull.js";
import { STATION_WHEEL_RADIUS } from "./stationLayout.js";

function meshWith(name: string): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  mat.name = name;
  // Simulate the raw export's unfaithful state: black base + emissive wash.
  mat.emissive.set(0x777777);
  mat.emissiveIntensity = 1;
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
}
const std = (mesh: THREE.Mesh) => mesh.material as THREE.MeshStandardMaterial;

describe("applyProfondoRecipe", () => {
  it("makes luci the warm working light — emissive amber, dark base", () => {
    const g = new THREE.Group();
    const m = meshWith("luci");
    g.add(m);
    applyProfondoRecipe(g);
    expect(std(m).emissive.getHex()).toBe(0xff9d2e);
    expect(std(m).emissiveIntensity).toBeCloseTo(0.8);
    expect(std(m).color.getHex()).toBe(0x201408);
  });

  it("maps the plastics to the recipe's hull tones and kills stray emissive", () => {
    const g = new THREE.Group();
    const nera = meshWith("plastica nera");
    const grigia = meshWith("plastica grigia");
    g.add(nera, grigia);
    applyProfondoRecipe(g);
    expect(std(nera).color.getHex()).toBe(0x22242a);
    expect(std(nera).emissive.getHex()).toBe(0x000000);
    expect(std(grigia).metalness).toBeCloseTo(0.5);
  });

  it("handles material arrays (multi-primitive meshes) and unknown names", () => {
    const a = new THREE.MeshStandardMaterial();
    a.name = "arancione";
    const b = new THREE.MeshStandardMaterial();
    b.name = "something-else";
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [a, b]);
    const g = new THREE.Group();
    g.add(mesh);
    applyProfondoRecipe(g);
    expect(a.color.getHex()).toBe(0xb56a28);
    expect(b.color.getHex()).toBe(0x35383f); // fallback recipe tone
  });

  it("reserves cyan: no hull material takes the navigation color", () => {
    const g = new THREE.Group();
    for (const n of ["luci", "arancione", "plastica grigia", "plastica nera", "Material"]) {
      g.add(meshWith(n));
    }
    applyProfondoRecipe(g);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        expect(std(o as THREE.Mesh).color.getHex()).not.toBe(0x9fd8e8);
        expect(std(o as THREE.Mesh).emissive.getHex()).not.toBe(0x9fd8e8);
      }
    });
  });
});

describe("normalizeProfondoScale", () => {
  it("scales the rim to the layout radius and recenters on the origin", () => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(11.14, 5.33, 11.14));
    mesh.position.set(0, -0.23, 0); // roughly the model's own offset
    g.add(mesh);
    normalizeProfondoScale(g);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    expect(Math.max(size.x, size.z) / 2).toBeCloseTo(STATION_WHEEL_RADIUS, 0);
    expect(Math.abs(center.x)).toBeLessThan(0.6);
    expect(Math.abs(center.y)).toBeLessThan(0.6);
    expect(Math.abs(center.z)).toBeLessThan(0.6);
  });
});
