import { TOY_REPLACEMENTS } from "./proceduralPlanet.js";
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  createStationScene,
  dockingPose,
  DOCKING_CYCLE_MS,
  DOCKING_EASE_MS,
  DOCKING_HOLD_MS,
  DOCKING_PAUSE_MS,
} from "./stationScene.js";
import {
  STATION_SEED,
  dockingMooringPose,
  heroMooringPose,
  trafficLanes,
} from "./stationLayout.js";
import { DOCKING_MODEL_INDEX, STATION_BACKDROP_PLANETS } from "./stationAssets.js";

function find(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

function instanceTranslation(mesh: THREE.InstancedMesh, index: number): [number, number, number] {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  return [m.elements[12] ?? 0, m.elements[13] ?? 0, m.elements[14] ?? 0];
}

describe("createStationScene", () => {
  it("constructs with the fallback traffic boxes (no network in tests)", () => {
    const scene = createStationScene();
    const fallback = find(scene.group, "station-traffic-fallback") as THREE.InstancedMesh;
    expect(fallback).toBeTruthy();
    // 12 lanes × 2 ships per lane.
    expect(fallback.count).toBe(24);
    expect(find(scene.group, "station-work-lights")).toBeTruthy();
    // The hero mooring stays empty until her GLB lands — no faked hero.
    expect(find(scene.group, "hero-ship")).toBeUndefined();
    // The harbor controller's berth stays empty until the dispatcher
    // GLB lands — no faked controller.
    expect(find(scene.group, "harbor-controller-ship")).toBeUndefined();
    // Bex's berth likewise stays empty until the bob GLB lands —
    // no faked captain (NPC-Player L1). Her presence flag can be
    // pushed before the hull exists without error.
    expect(find(scene.group, "bex-ship")).toBeUndefined();
    expect(() => scene.setBexPresent(true)).not.toThrow();
    expect(() => scene.setBexPresent(false)).not.toThrow();
    scene.dispose();
  });

  it("update advances the traffic along its lanes", () => {
    const scene = createStationScene();
    const fallback = find(scene.group, "station-traffic-fallback") as THREE.InstancedMesh;
    scene.update(0);
    const before = instanceTranslation(fallback, 0);
    scene.update(30_000);
    const after = instanceTranslation(fallback, 0);
    expect(after).not.toEqual(before);
    scene.dispose();
  });

  it("reduced motion freezes the traffic and the station turn", () => {
    const scene = createStationScene();
    const fallback = find(scene.group, "station-traffic-fallback") as THREE.InstancedMesh;
    scene.update(5_000, { reducedMotion: true });
    const first = instanceTranslation(fallback, 0);
    scene.update(20_000, { reducedMotion: true });
    const second = instanceTranslation(fallback, 0);
    expect(second).toEqual(first);
    const rotating = find(scene.group, "station-rotating") as THREE.Group;
    expect(rotating.rotation.y).toBe(0);
    scene.dispose();
  });

  it("dispose is safe twice and update after dispose does not throw", () => {
    const scene = createStationScene();
    expect(() => {
      scene.dispose();
      scene.dispose();
      scene.update(1_000);
    }).not.toThrow();
  });

  it("the hero mooring is the layout's mooring (arm 0, just outside the rim)", () => {
    const pose = heroMooringPose();
    expect(pose.position[0]).toBeCloseTo(228, 5);
    expect(pose.position[1]).toBe(0);
    expect(pose.position[2]).toBeCloseTo(0, 5);
  });

  it("the low-poly moorings, dressing, and gantry stay empty until their GLBs land — no faked ships", () => {
    const scene = createStationScene();
    for (const key of ["rocket_classic", "rocket_shuttle", "lander_pod", "space_capsule"]) {
      expect(find(scene.group, `docked-lowpoly-${key}`)).toBeUndefined();
    }
    for (const key of [
      "space_station_core",
      "station_module",
      "satellite_dish",
      "solar_array",
      "fuel_tank",
    ]) {
      expect(find(scene.group, `dressing-lowpoly-${key}`)).toBeUndefined();
    }
    expect(find(scene.group, "witness-drydock-gantry")).toBeUndefined();
    scene.dispose();
  });

  it("the annex holders exist and stay empty until their GLBs land — no half settlements", () => {
    const scene = createStationScene();
    for (const key of ["lunar-annex", "colony-ring", "station-stores"]) {
      const holder = find(scene.group, `annex-${key}`);
      expect(holder).toBeTruthy();
      expect(holder!.children.length).toBe(0);
      expect(find(scene.group, `annex-model-${key}`)).toBeUndefined();
    }
    scene.dispose();
  });

  it("the EVE-style backdrop planets hang 4,000 out — holders exist; a toy-model planet is a shader planet at once, the rest are empty until their GLBs land", () => {
    const scene = createStationScene();
    for (const planet of STATION_BACKDROP_PLANETS) {
      const holder = find(scene.group, `backdrop-${planet.key}`);
      expect(holder).toBeTruthy();
      const replaced = planet.key in TOY_REPLACEMENTS;
      expect(holder!.children.length).toBe(replaced ? 1 : 0);
      if (!replaced) expect(find(scene.group, `backdrop-${planet.key}-model`)).toBeUndefined();
      expect(Math.hypot(holder!.position.x, holder!.position.z)).toBeCloseTo(4000, 5);
      expect(holder!.position.y).toBe(500);
    }
    scene.dispose();
  });
});

describe("dockingPose", () => {
  const lane = trafficLanes(STATION_SEED)[DOCKING_MODEL_INDEX];
  if (!lane) throw new Error("docking lane missing from layout");
  const mooring = dockingMooringPose();
  const lanePoint: [number, number, number] = [
    Math.cos(lane.phase) * lane.radius,
    lane.y,
    Math.sin(lane.phase) * lane.radius,
  ];

  it("starts on the lane, eases to the mooring, holds, returns, and waits", () => {
    const atStart = dockingPose(0, lane);
    expect(atStart.position).toEqual(lanePoint);
    expect(atStart.docked).toBe(false);

    const docked = dockingPose(DOCKING_EASE_MS + DOCKING_HOLD_MS / 2, lane);
    expect(docked.docked).toBe(true);
    expect(docked.position).toEqual(mooring.position);

    const returning = dockingPose(DOCKING_EASE_MS + DOCKING_HOLD_MS + DOCKING_EASE_MS / 2, lane);
    expect(returning.docked).toBe(false);
    expect(returning.position).not.toEqual(mooring.position);
    expect(returning.position).not.toEqual(lanePoint);

    const waiting = dockingPose(
      DOCKING_EASE_MS + DOCKING_HOLD_MS + DOCKING_EASE_MS + DOCKING_PAUSE_MS / 2,
      lane,
    );
    expect(waiting.position).toEqual(lanePoint);
    expect(waiting.docked).toBe(false);
  });

  it("wraps cleanly at the cycle boundary", () => {
    const end = dockingPose(DOCKING_CYCLE_MS, lane);
    const start = dockingPose(0, lane);
    expect(end.position).toEqual(start.position);
    expect(end.docked).toBe(start.docked);
  });

  it("reduced motion parks the shuttle docked at any time", () => {
    for (const t of [0, 5_000, 40_000, 80_000]) {
      const pose = dockingPose(t, lane, { reducedMotion: true });
      expect(pose.docked).toBe(true);
      expect(pose.position).toEqual(mooring.position);
    }
  });
});
