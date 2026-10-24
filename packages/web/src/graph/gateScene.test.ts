import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildGate, GATE_DRESSINGS, GATE_RADIUS, GATE_BEAD_COUNT } from "./gateScene.js";

function find(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

describe("buildGate", () => {
  it("builds a ring, instanced beads, and a portal disc (3 draw calls)", () => {
    const gate = buildGate("great-station");
    expect(find(gate.group, "gate-ring")).toBeTruthy();
    const beads = find(gate.group, "gate-beads") as THREE.InstancedMesh;
    expect(beads).toBeTruthy();
    expect(beads.count).toBe(GATE_BEAD_COUNT);
    expect(find(gate.group, "gate-disc")).toBeTruthy();
    // Ring + beads + disc = 3 meshes.
    let meshes = 0;
    gate.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.InstancedMesh).isInstancedMesh) meshes++;
    });
    expect(meshes).toBe(3);
    gate.dispose();
  });

  it("dresses per world — Station steel/amber, garden dawn-gold", () => {
    const station = buildGate("great-station");
    const garden = buildGate("growing-place");
    const stationRing = find(station.group, "gate-ring") as THREE.Mesh;
    const gardenRing = find(garden.group, "gate-ring") as THREE.Mesh;
    const stationColor = (stationRing.material as THREE.MeshStandardMaterial).color.getHex();
    const gardenColor = (gardenRing.material as THREE.MeshStandardMaterial).color.getHex();
    expect(stationColor).toBe(GATE_DRESSINGS["great-station"]!.ring);
    expect(gardenColor).toBe(GATE_DRESSINGS["growing-place"]!.ring);
    expect(stationColor).not.toBe(gardenColor);
    station.dispose();
    garden.dispose();
  });

  it("unknown worlds fall back to the home dressing, never a missing gate", () => {
    const gate = buildGate("deep-past");
    const ring = find(gate.group, "gate-ring") as THREE.Mesh;
    expect((ring.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      GATE_DRESSINGS["home"]!.ring,
    );
    gate.dispose();
  });

  it("beads sit on the ring circle", () => {
    const gate = buildGate("home");
    const beads = find(gate.group, "gate-beads") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    beads.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(GATE_RADIUS, 5);
    gate.dispose();
  });

  it("dispose is safe, including twice", () => {
    const gate = buildGate("home");
    expect(() => {
      gate.dispose();
      gate.dispose();
    }).not.toThrow();
  });
});
