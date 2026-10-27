import { describe, it, expect } from "vitest";
import {
  APPROACH_STAGES,
  DOCKING_ARM,
  HARBOR_CONTROLLER_BERTH,
  HERO_MOORING,
  HERO_SHIP_FORWARD_LENGTH,
  STATION_BUDGET,
  STATION_INTERNAL_TARGETS,
  STATION_MAX_TRAFFIC_RADIUS,
  STATION_ORBIT_CLEARANCE,
  STATION_ORBIT_HEIGHT,
  STATION_ORBIT_RADIUS,
  STATION_SCALE_RATIO,
  STATION_WHEEL_DIAMETER,
  STATION_WHEEL_RADIUS,
  approachPose,
  beaconRing,
  dockingMooringPose,
  harborControllerBerthPose,
  heroMooringPose,
  plannedDrawCalls,
  plannedVisibleTris,
  rngFromSeed,
  stationCameraSweep,
  trafficLanes,
} from "./stationLayout.js";

describe("stationLayout", () => {
  it("is deterministic from the recipe seed", () => {
    const a = beaconRing("great-station / harbor-1");
    const b = beaconRing("great-station / harbor-1");
    expect(a).toEqual(b);
    const r1 = rngFromSeed("x");
    const r2 = rngFromSeed("x");
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it("reserves cyan for cardinal nav markers only (palette grammar)", () => {
    const ring = beaconRing("s", 48, 210);
    const nav = ring.filter((b) => b.role === "nav");
    expect(nav.length).toBe(6); // every 8th of 48
    expect(ring.every((b) => Math.abs(Math.hypot(b.x, b.z) - 210) < 0.001)).toBe(true);
  });

  it("keeps traffic sparse, slow, and mixed-direction (atmosphere, A17)", () => {
    const lanes = trafficLanes("s");
    expect(lanes.length).toBe(12); // one per traffic model (11 Quaternius + WATO)
    expect(lanes.every((l) => Math.abs(l.speed) < 0.02)).toBe(true);
    expect(lanes.some((l) => l.retrograde)).toBe(true);
  });

  it("keeps every traffic lane inside the orbit clearance (Q1)", () => {
    const lanes = trafficLanes("great-station / harbor-1");
    expect(Math.max(...lanes.map((l) => l.radius))).toBeLessThanOrEqual(
      STATION_MAX_TRAFFIC_RADIUS,
    );
    expect(STATION_ORBIT_CLEARANCE).toBe(110);
    expect(STATION_ORBIT_RADIUS - STATION_MAX_TRAFFIC_RADIUS).toBe(
      STATION_ORBIT_CLEARANCE,
    );
  });

  it("approach: three stages, distance strictly decreasing end to end", () => {
    expect(APPROACH_STAGES.map((s) => s.name)).toEqual(["far", "handoff", "arrival"]);
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const d = approachPose(Math.min(1, t)).distance;
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
    expect(approachPose(0).distance).toBe(900);
    expect(approachPose(1).distance).toBe(150);
  });

  it("the scale ratio holds: wheel diameter is 35 hero-ship lengths (Q1)", () => {
    expect(STATION_WHEEL_DIAMETER).toBe(420);
    expect(HERO_SHIP_FORWARD_LENGTH).toBe(12);
    expect(STATION_WHEEL_DIAMETER / HERO_SHIP_FORWARD_LENGTH).toBe(STATION_SCALE_RATIO);
    expect(STATION_SCALE_RATIO).toBe(35);
    expect(STATION_ORBIT_RADIUS).toBe(600);
    expect(STATION_ORBIT_HEIGHT).toBe(120);
  });

  it("the hero moors at the primary arm, nose outward", () => {
    expect(HERO_MOORING.radius).toBe(228);
    expect(HERO_MOORING.angle).toBe(0);
    const pose = heroMooringPose();
    expect(pose.position[0]).toBeCloseTo(228, 5);
    expect(pose.position[1]).toBe(0);
    expect(pose.position[2]).toBeCloseTo(0, 5);
    expect(pose.rotationY).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("the docking shuttle moors at arm 2, nose outward", () => {
    expect(DOCKING_ARM.index).toBe(2);
    const pose = dockingMooringPose();
    expect(pose.position[0]).toBeCloseTo(0, 5);
    expect(pose.position[2]).toBeCloseTo(228, 5);
    // −π and π are the same facing; atan2 returns −π here.
    expect(Math.atan2(Math.sin(pose.rotationY - Math.PI), Math.cos(pose.rotationY - Math.PI))).toBeCloseTo(0, 5);
  });

  it("the draw-call and tri plans fit the internal targets with headroom", () => {
    expect(plannedDrawCalls()).toBeLessThanOrEqual(STATION_INTERNAL_TARGETS.drawCalls);
    expect(plannedDrawCalls()).toBeLessThanOrEqual(STATION_BUDGET.drawCalls);
    expect(plannedVisibleTris()).toBeLessThanOrEqual(STATION_INTERNAL_TARGETS.visibleTris);
    expect(plannedVisibleTris()).toBeLessThanOrEqual(STATION_BUDGET.visibleTris);
    expect(STATION_BUDGET.visibleTris).toBe(750_000); // §11 hard boundary, not a target
    expect(STATION_INTERNAL_TARGETS.drawCalls).toBe(64);
    expect(STATION_INTERNAL_TARGETS.visibleTris).toBe(500_000);
    // Pinned measured totals (P2-6 build record): the WATO regular is
    // 7 materials after the merge, not the hunt's 6-family count.
    // NPC autonomy adds the controller's ship: +1 call, +748 tris.
    expect(plannedDrawCalls()).toBe(54);
    expect(plannedVisibleTris()).toBe(246_804);
  });

  it("the harbor controller's berth sits between arms 1 and 2, clear of docked ships and dressing", () => {
    expect(HARBOR_CONTROLLER_BERTH.radius).toBe(222);
    expect(HARBOR_CONTROLLER_BERTH.angle).toBeCloseTo((Math.PI * 3) / 4, 10);
    const pose = harborControllerBerthPose();
    // Radius 222, angle 3π/4: x and z are both negative, equal magnitude.
    expect(pose.position[0]).toBeCloseTo(-222 * Math.SQRT1_2, 5);
    expect(pose.position[2]).toBeCloseTo(222 * Math.SQRT1_2, 5);
    // Nose outward, away from the Station: rotating the ship's −Z
    // forward by rotationY must give the outward radial direction.
    const rot = pose.rotationY;
    expect(-Math.sin(rot)).toBeCloseTo(Math.cos(HARBOR_CONTROLLER_BERTH.angle), 5);
    expect(-Math.cos(rot)).toBeCloseTo(Math.sin(HARBOR_CONTROLLER_BERTH.angle), 5);
    // Clearance to the nearest docked arm (arm 1 at π/2, arm 2 at π):
    // π/4 of arc at radius 222 is ~174 units; the docked ships sit at
    // lateral ±8. The berth is far outside any docked ship.
    const armGap = (Math.PI / 4) * HARBOR_CONTROLLER_BERTH.radius;
    expect(armGap).toBeGreaterThan(150);
    // Inside the dressing band's inner edge (radius 232): no dressing
    // piece can sit on the berth.
    expect(HARBOR_CONTROLLER_BERTH.radius).toBeLessThan(232);
    // Inside the innermost traffic lane (255) and outside the rim (210).
    expect(HARBOR_CONTROLLER_BERTH.radius).toBeGreaterThan(STATION_WHEEL_RADIUS);
    expect(HARBOR_CONTROLLER_BERTH.radius).toBeLessThan(255);
  });

  it("the C7 coverage sweep enumerates only reachable, bounded poses", () => {
    const sweep = stationCameraSweep();
    expect(sweep.length).toBe(9); // 5 approach samples + 4 orbit quarters
    for (const pose of sweep) {
      if (pose.kind === "approach") {
        expect(pose.distance).toBeGreaterThanOrEqual(150);
        expect(pose.distance).toBeLessThanOrEqual(900);
        expect(pose.azimuth).toBeGreaterThanOrEqual(0.12);
        expect(pose.azimuth).toBeLessThanOrEqual(0.6);
      } else {
        expect(pose.distance).toBe(STATION_ORBIT_RADIUS);
      }
    }
  });
});
