import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  createTransitScene,
  TRANSIT_BUDGET,
  TRANSIT_STREAK_COUNT,
} from "./transitScene.js";

function find(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

function countMeshes(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.InstancedMesh).isInstancedMesh) n++;
  });
  return n;
}

describe("createTransitScene", () => {
  it("warp renders ship + two gates + HYG sky + streaks, inside budget", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    expect(find(scene.group, "transit-ship")).toBeTruthy();
    expect(find(scene.group, "gate-home")).toBeTruthy();
    expect(find(scene.group, "gate-great-station")).toBeTruthy();
    expect(find(scene.group, "transit-streaks")).toBeTruthy();
    expect((find(scene.group, "transit-streaks") as THREE.InstancedMesh).count).toBe(
      TRANSIT_STREAK_COUNT,
    );
    // Sky 1 · ship 10 (her GLB) · gates 6 · streaks 1 = 18 draw
    // calls, ceiling 40. The procedural fallback is 4 meshes, so
    // the synchronous count is 12 — the sketch budgets the hero.
    expect(countMeshes(scene.group)).toBeLessThanOrEqual(TRANSIT_BUDGET.maxDrawCalls);
    scene.dispose();
  });

  it("the transit-ship holder carries the procedural fallback until her ship lands", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const holder = find(scene.group, "transit-ship") as THREE.Group;
    expect(holder).toBeTruthy();
    expect(find(holder, "transit-ship-procedural")).toBeTruthy();
    scene.dispose();
  });

  it("drift has no visible streaks and a steady ship", () => {
    const scene = createTransitScene({
      kind: "drift",
      totalMs: 45_000,
      origin: "great-station",
      destination: "growing-place",
    });
    const streaks = find(scene.group, "transit-streaks") as THREE.InstancedMesh;
    expect(streaks.visible).toBe(false);
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    scene.update(20_000);
    expect(ship.position.y).toBe(0);
    scene.dispose();
  });

  it("the arrival gate approaches and the departure gate recedes as the trip progresses", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    const departure = find(scene.group, "gate-home") as THREE.Group;
    scene.update(0);
    const arrivalStart = arrival.position.z;
    const departureStart = departure.position.z;
    scene.update(11_500);
    expect(arrival.position.z).toBeGreaterThan(arrivalStart);
    expect(departure.position.z).toBeGreaterThan(departureStart);
    // At the end the arrival gate is just ahead, not passed.
    expect(arrival.position.z).toBeLessThan(0);
    expect(arrival.position.z).toBeGreaterThan(-100);
    scene.dispose();
  });

  it("reduced motion: no streaks, no bobbing, but the gates still travel", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    scene.update(6_000, { reducedMotion: true });
    expect(ship.position.y).toBe(0);
    expect(ship.rotation.z).toBe(0);
    expect(arrival.position.z).toBeGreaterThan(-1100);
    scene.dispose();
  });

  it("progress clamps at arrival — the scene never overshoots the gate", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    scene.update(60_000);
    expect(arrival.position.z).toBeCloseTo(-20, 5);
    scene.dispose();
  });

  it("update after dispose is a no-op and dispose is safe twice", () => {
    const scene = createTransitScene({
      kind: "drift",
      totalMs: 45_000,
      origin: "home",
      destination: "growing-place",
    });
    expect(() => {
      scene.dispose();
      scene.dispose();
      scene.update(1_000);
    }).not.toThrow();
  });
});
