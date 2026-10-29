import {
  GARDEN_TERRACE_COUNT,
  GARDEN_TERRACE_HEIGHT,
  GARDEN_TERRACE_RADIUS,
} from "./gardenLayout.js";

/**
 * Garden v2 movement (docs/specs/growing-place-v2-2026-10-29.md, step 2):
 * tap the ground and Soumaya's ship skims there along the terraces; the
 * camera follows behind her. Pure (no three.js, no DOM) so the route math
 * is unit-tested; WorldsSurface owns the input and gardenScene the ship.
 *
 * Walkable ground is the terrace tops — an analytic "navmesh" of rings.
 * Between terraces she simply rises or falls with the ground (she hovers,
 * so a riser is a ramp to her). Nothing can route her off the world or
 * through the witness tree's trunk.
 */

export interface WalkPoint {
  x: number;
  z: number;
}

/** How high her ship skims above the ground. */
export const WALK_HOVER = 9;
/** Ground speed, world units per second (the garden is ~1,800 across: ~12 s edge to edge). */
export const WALK_SPEED = 150;
/** Keep clear of the witness tree's trunk (radius ~28) with room to spare. */
export const TRUNK_CLEARANCE = 70;
/** Keep a little inside the outer edge, so she never hangs over the drop. */
export const EDGE_MARGIN = 14;
/** Where she starts: on the meadow (the arrival terrace), facing the tree. */
export const WALK_START_ANGLE = 0.6;

const OUTER = GARDEN_TERRACE_RADIUS[0]! - EDGE_MARGIN;

/** The ground height under (x, z): the terrace that radius falls on. Off the world is the meadow's height. */
export function groundHeightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  for (let t = GARDEN_TERRACE_COUNT - 1; t >= 0; t--) {
    if (r <= GARDEN_TERRACE_RADIUS[t]!) return GARDEN_TERRACE_HEIGHT[t]!;
  }
  return GARDEN_TERRACE_HEIGHT[0]!;
}

/** Pull a point onto walkable ground: inside the outer edge, outside the trunk. */
export function clampToWalkable(p: WalkPoint): WalkPoint {
  const r = Math.hypot(p.x, p.z);
  if (r < 1e-6) return { x: TRUNK_CLEARANCE, z: 0 };
  const k = Math.min(OUTER, Math.max(TRUNK_CLEARANCE, r)) / r;
  return { x: p.x * k, z: p.z * k };
}

export function walkStart(): WalkPoint {
  const r = (GARDEN_TERRACE_RADIUS[0]! + GARDEN_TERRACE_RADIUS[1]!) / 2;
  return { x: Math.sin(WALK_START_ANGLE) * r, z: Math.cos(WALK_START_ANGLE) * r };
}

/**
 * The route from `from` to `to`: a straight line, unless it would pass
 * through the trunk — then it bends around the tree through one or two
 * waypoints on a clearance circle, on the shorter side.
 */
export function walkRoute(from: WalkPoint, to: WalkPoint): WalkPoint[] {
  const a = clampToWalkable(from);
  const b = clampToWalkable(to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return [b];
  // Closest approach of the segment to the trunk at the origin.
  const t = Math.min(1, Math.max(0, -(a.x * dx + a.z * dz) / len2));
  const cx = a.x + dx * t;
  const cz = a.z + dz * t;
  if (Math.hypot(cx, cz) >= TRUNK_CLEARANCE) return [b];
  // Go around: arc from a's bearing to b's bearing the short way, in steps.
  const r = TRUNK_CLEARANCE * 1.25;
  const angA = Math.atan2(a.z, a.x);
  let delta = Math.atan2(b.z, b.x) - angA;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) > Math.PI - 1e-3) delta = Math.PI; // dead opposite: pick a side, deterministically
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / 0.6));
  const arc: WalkPoint[] = [];
  for (let i = 1; i < steps; i++) {
    const ang = angA + (delta * i) / steps;
    arc.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
  }
  return [...arc, b];
}

export interface WalkState {
  pos: WalkPoint;
  /** Facing, radians: atan2(dx, dz) of travel — 0 faces +z. */
  heading: number;
  route: WalkPoint[];
}

export function initialWalk(): WalkState {
  const pos = walkStart();
  return { pos, heading: Math.atan2(-pos.x, -pos.z), route: [] };
}

/**
 * Advance along the route by dtMs. Reduced motion jumps straight to the
 * end (the spec: "she jumps there instantly"). Returns the new state and
 * whether this step arrived at the route's end.
 */
export function stepWalk(
  s: WalkState,
  dtMs: number,
  opts: { reducedMotion?: boolean; speed?: number } = {},
): { state: WalkState; arrived: boolean } {
  if (s.route.length === 0) return { state: s, arrived: false };
  if (opts.reducedMotion) {
    const end = s.route[s.route.length - 1]!;
    const prev = s.route.length > 1 ? s.route[s.route.length - 2]! : s.pos;
    const heading = Math.hypot(end.x - prev.x, end.z - prev.z) > 1e-6 ? Math.atan2(end.x - prev.x, end.z - prev.z) : s.heading;
    return { state: { pos: end, heading, route: [] }, arrived: true };
  }
  let budget = ((opts.speed ?? WALK_SPEED) * Math.max(0, dtMs)) / 1000;
  let pos = s.pos;
  let heading = s.heading;
  const route = [...s.route];
  while (route.length > 0 && budget > 0) {
    const next = route[0]!;
    const dx = next.x - pos.x;
    const dz = next.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) heading = Math.atan2(dx, dz);
    if (d <= budget) {
      pos = next;
      budget -= d;
      route.shift();
    } else {
      pos = { x: pos.x + (dx / d) * budget, z: pos.z + (dz / d) * budget };
      budget = 0;
    }
  }
  return { state: { pos, heading, route }, arrived: route.length === 0 };
}

/** The spot just short of a target, so she stops beside a thing, not inside it. */
export function approachPoint(from: WalkPoint, target: WalkPoint, standOff: number): WalkPoint {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= standOff) return clampToWalkable(from);
  return clampToWalkable({ x: target.x - (dx / d) * standOff, z: target.z - (dz / d) * standOff });
}

/**
 * Follow-camera framing: behind her heading and high enough to see over
 * the forest canopy (trees stand ~40–70), looking at a point a little
 * ahead of her so the view opens onto where she's going.
 */
export const FOLLOW = { distance: 150, height: 105, lookUp: 6, ahead: 70 } as const;

/** The follow camera's base pose (before the traveller's own look offset). */
export function followPose(
  pos: WalkPoint,
  y: number,
  followYaw: number,
): { position: [number, number, number]; target: [number, number, number] } {
  return {
    position: [pos.x - Math.sin(followYaw) * FOLLOW.distance, y + FOLLOW.height, pos.z - Math.cos(followYaw) * FOLLOW.distance],
    target: [pos.x + Math.sin(followYaw) * FOLLOW.ahead, y + FOLLOW.lookUp, pos.z + Math.cos(followYaw) * FOLLOW.ahead],
  };
}

/** Ease an angle toward a target the short way round. */
export function easeAngle(from: number, to: number, k: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, Math.max(0, k));
}
