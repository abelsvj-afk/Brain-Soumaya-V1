import { describe, it, expect } from "vitest";
import {
  APPROACH_STAGES,
  BEX_BERTH,
  DOCKING_ARM,
  HARBOR_CONTROLLER_BERTH,
  HERO_MOORING,
  HERO_SHIP_FORWARD_LENGTH,
  LOWPOLY_DOCKED_SPOTS,
  LOWPOLY_GANTRY_POSITION,
  STATION_BUDGET,
  STATION_CLUSTER_POSITIONS,
  STATION_INTERNAL_TARGETS,
  STATION_MAX_TRAFFIC_RADIUS,
  STATION_ORBIT_CLEARANCE,
  STATION_ORBIT_HEIGHT,
  STATION_ORBIT_RADIUS,
  STATION_SCALE_RATIO,
  STATION_WHEEL_DIAMETER,
  STATION_WHEEL_RADIUS,
  WITNESS_DRYDOCK_POSITION,
  WITNESS_HAULER_POSITION,
  approachPose,
  beaconRing,
  clusterModelOffset,
  dockedPoseAt,
  bexBerthPose,
  dockingMooringPose,
  harborControllerBerthPose,
  heroMooringPose,
  lowPolyDressingSpots,
  plannedDrawCalls,
  plannedVisibleTris,
  stationClusterPosition,
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
    expect(STATION_INTERNAL_TARGETS.drawCalls).toBe(72);
    expect(STATION_INTERNAL_TARGETS.visibleTris).toBe(500_000);
    // Pinned measured totals (P2-6 build record): the WATO regular is
    // 7 materials after the merge, not the hunt's 6-family count.
    // NPC autonomy adds the controller's ship: +1 call, +748 tris.
    // Population increment: +10 calls, +2,096 tris — the plan lands
    // EXACTLY at the 64-call internal target (the harbor controller
    // left one spare call; this increment spends it). Recorded plainly.
    // Hunt #2 annexes: +3 calls, +10,410 tris — three whole packs
    // merged to one call each; 67 planned leaves 5 of headroom
    // before the 72-call internal target. EVE-style backdrop planets:
    // +3 calls, +10,522 tris — the lava planet (2) and a Quaternius
    // planet (1), as-is; 70 planned leaves 2 of headroom.
    // NPC-Player L1: Bex's ship (the bob, an existing traffic hull
    // riding its own lane's load): +1 call, +938 tris — 71 planned
    // leaves 1 of headroom before the 72-call internal target.
    expect(plannedDrawCalls()).toBe(71);
    expect(plannedVisibleTris()).toBe(270_770);
  });

  it("the three annex clusters sit outside the dressing band, far apart, and clear of the drydock", () => {
    expect(STATION_CLUSTER_POSITIONS.map((p) => p.key)).toEqual([
      "lunar-annex",
      "colony-ring",
      "station-stores",
    ]);
    const positions = STATION_CLUSTER_POSITIONS.map((p) => stationClusterPosition(p));
    for (const [x, y, z] of positions) {
      // Outside the 234–244 dressing band, 25+ clear of it.
      expect(Math.hypot(x, z)).toBeGreaterThan(269);
      expect(Math.abs(y)).toBeLessThanOrEqual(30);
    }
    // 500+ apart from each other.
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(500);
      }
    }
    // Clear of the drydock gantry (88, 20, 195) and the hauler (30, 10, 220).
    for (const [x, y, z] of positions) {
      expect(Math.hypot(x - 88, y - 20, z - 195)).toBeGreaterThan(100);
      expect(Math.hypot(x - 30, y - 10, z - 220)).toBeGreaterThan(100);
    }
  });

  it("clusterModelOffset spreads a settlement on two golden-spiral rings, deterministic", () => {
    const a = Array.from({ length: 27 }, (_, i) => clusterModelOffset(i, 27));
    const b = Array.from({ length: 27 }, (_, i) => clusterModelOffset(i, 27));
    expect(a).toEqual(b);
    // Inner 40% (11) at radius 9, the rest at radius 18.
    for (let i = 0; i < 27; i++) {
      const [x, z] = a[i]!;
      const r = Math.hypot(x, z);
      expect(r).toBeCloseTo(i < 11 ? 9 : 18, 5);
    }
    // No two models share a spot.
    expect(new Set(a.map(([x, z]) => `${x.toFixed(5)},${z.toFixed(5)}`)).size).toBe(27);
  });

  it("Bex's berth mirrors the harbor controller's — same radius, opposite side (NPC-Player L1)", () => {
    expect(BEX_BERTH.radius).toBe(222);
    expect(BEX_BERTH.angle).toBeCloseTo((Math.PI * 5) / 4, 10);
    const pose = bexBerthPose();
    // Radius 222, angle 5π/4: x and z are both negative, equal magnitude.
    expect(pose.position[0]).toBeCloseTo(-222 * Math.SQRT1_2, 5);
    expect(pose.position[2]).toBeCloseTo(-222 * Math.SQRT1_2, 5);
    // Nose outward, away from the Station.
    const rot = pose.rotationY;
    expect(-Math.sin(rot)).toBeCloseTo(Math.cos(BEX_BERTH.angle), 5);
    expect(-Math.cos(rot)).toBeCloseTo(Math.sin(BEX_BERTH.angle), 5);
    // π/2 of arc from the harbor controller's berth at this radius
    // (~349 units) — the two named ships never share water.
    const gap = (Math.PI / 2) * BEX_BERTH.radius;
    expect(gap).toBeGreaterThan(300);
    // Inside the dressing band's inner edge and the innermost lane.
    expect(BEX_BERTH.radius).toBeLessThan(232);
    expect(BEX_BERTH.radius).toBeLessThan(255);
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

  it("the low-poly docked spots are clear of the hero, the shuttle, the controller berth, and the dressing band", () => {
    expect(LOWPOLY_DOCKED_SPOTS).toHaveLength(4);
    const hero = heroMooringPose().position;
    const shuttle = dockingMooringPose().position;
    const berth = harborControllerBerthPose().position;
    const dist = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const spot of LOWPOLY_DOCKED_SPOTS) {
      const angle = (spot.arm / 4) * Math.PI * 2;
      const pose = dockedPoseAt(222, angle, spot.lateral);
      // Nose outward, like every moored ship.
      expect(-Math.sin(pose.rotationY)).toBeCloseTo(Math.cos(angle), 5);
      expect(-Math.cos(pose.rotationY)).toBeCloseTo(Math.sin(angle), 5);
      // Inside the dressing band's inner edge (232) and the innermost
      // traffic lane (255), outside the rim (210).
      expect(Math.hypot(pose.position[0], pose.position[2])).toBeLessThan(232);
      expect(Math.hypot(pose.position[0], pose.position[2])).toBeGreaterThan(210);
      // Clear of the hero (arm 0), the docking shuttle (arm 2), and the
      // controller berth (3π/4) — the nearest of these is far outside a
      // ship's length.
      expect(dist(pose.position, hero)).toBeGreaterThan(100);
      expect(dist(pose.position, shuttle)).toBeGreaterThan(100);
      expect(dist(pose.position, berth)).toBeGreaterThan(100);
    }
    // The four spots are distinct and pairwise clear (the tightest pair
    // is the two laterals on one arm: 40 apart, parallel-moored).
    const poses = LOWPOLY_DOCKED_SPOTS.map((s) => dockedPoseAt(222, (s.arm / 4) * Math.PI * 2, s.lateral));
    for (let i = 0; i < poses.length; i++) {
      for (let j = i + 1; j < poses.length; j++) {
        expect(dist(poses[i]!.position, poses[j]!.position)).toBeGreaterThan(30);
      }
    }
    // 12 units from the existing ±8 docked ships on the same arms
    // (parallel-moored: the gap is lateral, ship width, not length).
    const existing = [8, -8].flatMap((lateral) =>
      [1, 2, 3].map((arm) => dockedPoseAt(222, (arm / 4) * Math.PI * 2, lateral).position),
    );
    for (const pose of poses) {
      const nearest = Math.min(...existing.map((e) => dist(pose.position, e)));
      expect(nearest).toBeCloseTo(12, 5);
    }
  });

  it("the low-poly dressing spots are deterministic, in the band, and off the existing diagonals", () => {
    const a = lowPolyDressingSpots(5);
    const b = lowPolyDressingSpots(5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    for (const spot of a) {
      expect(spot.radius).toBeGreaterThanOrEqual(234);
      expect(spot.radius).toBeLessThanOrEqual(244);
      expect(Math.abs(spot.y)).toBeLessThanOrEqual(20);
      // Off-diagonal: the existing dressing sits on the diagonals
      // (±0.25 rad); these sit ~0.45 rad off, so no two dressing pieces
      // share a neighborhood.
      const fromDiagonal =
        (((spot.angle - Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      const offDiagonal = Math.min(fromDiagonal, Math.PI / 2 - fromDiagonal);
      expect(offDiagonal).toBeGreaterThan(0.25);
    }
  });

  it("the drydock gantry stands beside the drydock frame, clear of the hauler and the approach", () => {
    const gantry = LOWPOLY_GANTRY_POSITION;
    const frame = WITNESS_DRYDOCK_POSITION;
    const hauler = WITNESS_HAULER_POSITION;
    const dist = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Beside the frame (~25 off its center — the frame's pieces span
    // ±14), not on it.
    expect(dist(gantry, frame)).toBeGreaterThan(20);
    expect(dist(gantry, frame)).toBeLessThan(30);
    // Clear of the hauler.
    expect(dist(gantry, hauler)).toBeGreaterThan(50);
    // Clear of the closest approach-camera pose (arrival: 150 at azimuth
    // 0.12 → (149, 18) in xz).
    expect(dist(gantry, [149, 20, 18])).toBeGreaterThan(150);
    // Inside the innermost traffic lane.
    expect(Math.hypot(gantry[0], gantry[2])).toBeLessThan(255);
  });
});
