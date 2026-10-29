import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  SOUMAYA_SHIP_URL,
  applySoumayaShipTreatment,
  normalizeSoumayaShipScale,
} from "./soumayaShip.js";
import { HERO_SHIP_FORWARD_LENGTH } from "./stationLayout.js";

function meshWith(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  mat.emissive.set(0x111111);
  mat.emissiveIntensity = 1;
  mat.metalness = 0.9;
  mat.roughness = 0.1;
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
}
const std = (mesh: THREE.Mesh) => mesh.material as THREE.MeshStandardMaterial;

describe("applySoumayaShipTreatment", () => {
  it("tints the hull blue-steel with a cyan sheen — the galaxy's default skin", () => {
    const g = new THREE.Group();
    const m = meshWith();
    g.add(m);
    applySoumayaShipTreatment(g);
    expect(std(m).color.getHex()).toBe(0xc2d4f5);
    expect(std(m).emissive.getHex()).toBe(0x2f7bff);
    expect(std(m).emissiveIntensity).toBeCloseTo(0.3);
    expect(std(m).metalness).toBeCloseTo(0.35);
    expect(std(m).roughness).toBeCloseTo(0.45);
  });

  it("handles material arrays", () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [a, b]);
    const g = new THREE.Group();
    g.add(mesh);
    applySoumayaShipTreatment(g);
    expect(a.color.getHex()).toBe(0xc2d4f5);
    expect(b.color.getHex()).toBe(0xc2d4f5);
  });

  it("names the deployed file", () => {
    expect(SOUMAYA_SHIP_URL).toBe("/soumaya-ship.glb");
  });
});

describe("normalizeSoumayaShipScale", () => {
  it("turns the nose to −Z, scales the forward length to 12, and recenters", () => {
    const g = new THREE.Group();
    // The deployed assembly's true size (Blender world-space): the
    // long axis is Z at 13.53, nose at +Z. A box standing in for it.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5.98, 3.1, 13.53));
    mesh.position.set(0, 0, 0);
    g.add(mesh);
    normalizeSoumayaShipScale(g);
    expect(g.rotation.y).toBeCloseTo(Math.PI, 5);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    expect(size.z).toBeCloseTo(HERO_SHIP_FORWARD_LENGTH, 5);
    expect(Math.abs(center.x)).toBeLessThan(0.01);
    expect(Math.abs(center.y)).toBeLessThan(0.01);
    expect(Math.abs(center.z)).toBeLessThan(0.01);
  });

  it("recenters an off-center model on the origin", () => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 10));
    mesh.position.set(3, -2, 5);
    g.add(mesh);
    normalizeSoumayaShipScale(g);
    const box = new THREE.Box3().setFromObject(g);
    const center = box.getCenter(new THREE.Vector3());
    expect(Math.abs(center.x)).toBeLessThan(0.01);
    expect(Math.abs(center.y)).toBeLessThan(0.01);
    expect(Math.abs(center.z)).toBeLessThan(0.01);
  });
});
