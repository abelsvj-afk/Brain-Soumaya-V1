import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildGate,
  buildSurveyFrame,
  GATE_DRESSINGS,
  GATE_RADIUS,
  GATE_BEAD_COUNT,
  SURVEY_FRAME_BEACON_COUNT,
} from "./gateScene.js";

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
    const gate = buildGate("not-a-world");
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

describe("buildSurveyFrame (Scale's gate silhouette)", () => {
  it("builds a rectangular frame of thin light — four bars, four corner beacons (5 draw calls)", () => {
    const frame = buildSurveyFrame(130, 50);
    expect(find(frame.group, "survey-frame-top")).toBeTruthy();
    expect(find(frame.group, "survey-frame-bottom")).toBeTruthy();
    expect(find(frame.group, "survey-frame-left")).toBeTruthy();
    expect(find(frame.group, "survey-frame-right")).toBeTruthy();
    const beacons = find(frame.group, "survey-frame-beacons") as THREE.InstancedMesh;
    expect(beacons).toBeTruthy();
    expect(beacons.count).toBe(SURVEY_FRAME_BEACON_COUNT);
    // Four bars + one instanced beacon mesh = 5.
    let meshes = 0;
    frame.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.InstancedMesh).isInstancedMesh) meshes++;
    });
    expect(meshes).toBe(5);
    frame.dispose();
  });

  it("the frame is a rectangle, not a ring — wider than tall, corners at the beacons", () => {
    const frame = buildSurveyFrame(130, 50);
    const top = find(frame.group, "survey-frame-top")!;
    const left = find(frame.group, "survey-frame-left")!;
    expect(top.position.y).toBe(25);
    expect(left.position.x).toBe(-65);
    const beacons = find(frame.group, "survey-frame-beacons") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    beacons.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect([Math.abs(p.x), Math.abs(p.y)]).toEqual([65, 25]);
    frame.dispose();
  });

  it("Scale's transit gate dresses solar gold — the station's own light, cyan reserved for the frame", () => {
    expect(GATE_DRESSINGS["scale"]).toBeTruthy();
    expect(GATE_DRESSINGS["scale"]!.accent).toBe(0xffc95e);
  });

  it("dispose is safe, including twice", () => {
    const frame = buildSurveyFrame();
    expect(() => {
      frame.dispose();
      frame.dispose();
    }).not.toThrow();
  });
});
