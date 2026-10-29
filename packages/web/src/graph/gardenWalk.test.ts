import { describe, it, expect } from "vitest";
import { GARDEN_TERRACE_HEIGHT, GARDEN_TERRACE_RADIUS } from "./gardenLayout.js";
import {
  approachPoint,
  clampToWalkable,
  easeAngle,
  followPose,
  groundHeightAt,
  initialWalk,
  stepWalk,
  walkRoute,
  EDGE_MARGIN,
  FOLLOW,
  TRUNK_CLEARANCE,
  WALK_SPEED,
  type WalkPoint,
} from "./gardenWalk.js";

/** Closest distance from the origin (the trunk) to segment a→b. */
function segmentToOrigin(a: WalkPoint, b: WalkPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-9 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.z * dz) / len2));
  return Math.hypot(a.x + dx * t, a.z + dz * t);
}

describe("garden walk — ground", () => {
  it("the ground under a point is the terrace that radius falls on", () => {
    expect(groundHeightAt(850, 0)).toBe(GARDEN_TERRACE_HEIGHT[0]);
    expect(groundHeightAt(0, 700)).toBe(GARDEN_TERRACE_HEIGHT[1]);
    expect(groundHeightAt(300, 0)).toBe(GARDEN_TERRACE_HEIGHT[4]);
    expect(groundHeightAt(30, 30)).toBe(GARDEN_TERRACE_HEIGHT[5]);
  });

  it("a tap off the edge or on the trunk is pulled onto walkable ground", () => {
    const off = clampToWalkable({ x: 5000, z: 0 });
    expect(Math.hypot(off.x, off.z)).toBeCloseTo(GARDEN_TERRACE_RADIUS[0]! - EDGE_MARGIN, 6);
    const trunk = clampToWalkable({ x: 3, z: 4 });
    expect(Math.hypot(trunk.x, trunk.z)).toBeCloseTo(TRUNK_CLEARANCE, 6);
    expect(clampToWalkable({ x: 0, z: 0 })).toEqual({ x: TRUNK_CLEARANCE, z: 0 });
    expect(clampToWalkable({ x: 400, z: 300 })).toEqual({ x: 400, z: 300 });
  });
});

describe("garden walk — routes", () => {
  it("a clear line is one straight leg", () => {
    expect(walkRoute({ x: 800, z: 0 }, { x: 600, z: 300 })).toEqual([{ x: 600, z: 300 }]);
  });

  it("never passes through the witness tree: every leg of every route keeps clear of the trunk", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      const p = () => ({ x: (rand() * 2 - 1) * 900, z: (rand() * 2 - 1) * 900 });
      const from = clampToWalkable(p());
      const route = walkRoute(from, p());
      let prev = from;
      for (const leg of route) {
        expect(segmentToOrigin(prev, leg)).toBeGreaterThan(TRUNK_CLEARANCE * 0.85);
        prev = leg;
      }
    }
  });

  it("straight across the tree goes around it, and still ends where it was asked to", () => {
    const route = walkRoute({ x: 800, z: 0 }, { x: -800, z: 0 });
    expect(route.length).toBeGreaterThan(2);
    expect(route[route.length - 1]).toEqual({ x: -800, z: 0 });
  });

  it("every route ends on walkable ground", () => {
    const end = walkRoute({ x: 800, z: 0 }, { x: 0, z: 99999 }).at(-1)!;
    expect(Math.hypot(end.x, end.z)).toBeLessThanOrEqual(GARDEN_TERRACE_RADIUS[0]!);
  });

  it("approachPoint stops beside the target, not on it", () => {
    const p = approachPoint({ x: 800, z: 0 }, { x: 500, z: 0 }, 30);
    expect(p).toEqual({ x: 530, z: 0 });
  });
});

describe("garden walk — stepping", () => {
  it("moves at walking speed along the route and arrives exactly at its end", () => {
    const s0 = { ...initialWalk(), pos: { x: 800, z: 0 }, route: [{ x: 500, z: 0 }] };
    const half = stepWalk(s0, 1000);
    expect(half.arrived).toBe(false);
    expect(half.state.pos.x).toBeCloseTo(800 - WALK_SPEED, 6);
    expect(half.state.heading).toBeCloseTo(-Math.PI / 2, 6); // facing −x
    const done = stepWalk(half.state, 5000);
    expect(done.arrived).toBe(true);
    expect(done.state.pos).toEqual({ x: 500, z: 0 });
    expect(done.state.route).toEqual([]);
  });

  it("reduced motion jumps straight to the end — no glide", () => {
    const s0 = { ...initialWalk(), route: walkRoute(initialWalk().pos, { x: -600, z: -200 }) };
    const r = stepWalk(s0, 16, { reducedMotion: true });
    expect(r.arrived).toBe(true);
    expect(r.state.pos).toEqual({ x: -600, z: -200 });
  });

  it("standing still is not an arrival", () => {
    expect(stepWalk(initialWalk(), 1000).arrived).toBe(false);
  });

  it("she starts on the meadow, facing the tree", () => {
    const s = initialWalk();
    const r = Math.hypot(s.pos.x, s.pos.z);
    expect(r).toBeGreaterThan(GARDEN_TERRACE_RADIUS[1]!);
    expect(r).toBeLessThan(GARDEN_TERRACE_RADIUS[0]!);
    // Heading points at the origin.
    expect(Math.sin(s.heading) * r + s.pos.x).toBeCloseTo(0, 6);
  });
});

describe("garden walk — follow camera", () => {
  it("sits behind her heading and above, looking just ahead of her", () => {
    const pose = followPose({ x: 100, z: 0 }, 18, Math.PI / 2); // facing +x
    expect(pose.position[0]).toBeCloseTo(100 - FOLLOW.distance, 6);
    expect(pose.position[1]).toBe(18 + FOLLOW.height);
    expect(pose.position[2]).toBeCloseTo(0, 6);
    expect(pose.target[0]).toBeCloseTo(100 + FOLLOW.ahead, 6); // a little ahead of her
    expect(pose.target[1]).toBe(18 + FOLLOW.lookUp);
    expect(pose.target[2]).toBeCloseTo(0, 6);
  });

  it("eases an angle the short way round", () => {
    expect(easeAngle(3, -3, 1)).toBeCloseTo(-3 + Math.PI * 2, 6);
    expect(easeAngle(0.1, -0.1, 0.5)).toBeCloseTo(0, 6);
  });
});
