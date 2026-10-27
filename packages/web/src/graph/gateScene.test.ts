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

  it("dresses per world — Station steel/amber, garden dawn-gold, Deep Past violet/lantern, People warm amber, Quiet/Archive dim slate/pale cyan", () => {
    const station = buildGate("great-station");
    const garden = buildGate("growing-place");
    const past = buildGate("deep-past");
    const people = buildGate("people");
    const archive = buildGate("quiet-archive");
    const stationRing = find(station.group, "gate-ring") as THREE.Mesh;
    const gardenRing = find(garden.group, "gate-ring") as THREE.Mesh;
    const pastRing = find(past.group, "gate-ring") as THREE.Mesh;
    const peopleRing = find(people.group, "gate-ring") as THREE.Mesh;
    const archiveRing = find(archive.group, "gate-ring") as THREE.Mesh;
    const stationColor = (stationRing.material as THREE.MeshStandardMaterial).color.getHex();
    const gardenColor = (gardenRing.material as THREE.MeshStandardMaterial).color.getHex();
    const pastColor = (pastRing.material as THREE.MeshStandardMaterial).color.getHex();
    const peopleColor = (peopleRing.material as THREE.MeshStandardMaterial).color.getHex();
    const archiveColor = (archiveRing.material as THREE.MeshStandardMaterial).color.getHex();
    expect(stationColor).toBe(GATE_DRESSINGS["great-station"]!.ring);
    expect(gardenColor).toBe(GATE_DRESSINGS["growing-place"]!.ring);
    expect(pastColor).toBe(GATE_DRESSINGS["deep-past"]!.ring);
    expect(peopleColor).toBe(GATE_DRESSINGS["people"]!.ring);
    expect(archiveColor).toBe(GATE_DRESSINGS["quiet-archive"]!.ring);
    expect(new Set([stationColor, gardenColor, pastColor, peopleColor, archiveColor]).size).toBe(5);
    station.dispose();
    garden.dispose();
    past.dispose();
    people.dispose();
    archive.dispose();
  });

  it("unknown worlds fall back to the home dressing, never a missing gate", () => {
    const gate = buildGate("scale");
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
