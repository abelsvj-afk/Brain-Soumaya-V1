/**
 * Flight inside a world (docs/specs/worlds-flight-2026-10-29.md): the ship turns to a place, spools, burns
 * there, and stops at a stand-off. Pure maths — no three.js, no DOM — so it is unit-tested; the host applies
 * it to the avatar and the camera.
 */

export type V3 = readonly [number, number, number];

export const ALIGN_MS = 1400;
export const SPOOL_MS = 800;
export const BURN_MIN_MS = 2400;
export const BURN_MAX_MS = 6500;
/** Extra burn time per world unit of distance (ms). */
export const BURN_MS_PER_UNIT = 1.2;
export const IDLE_ENGINE = 0.12;
export const COOL_MS = 1200;
/** Stand-off from a place's centre = radius × this + the ship's own clearance. */
export const STANDOFF_FACTOR = 1.35;
export const STANDOFF_MIN = 60;

export type FlightPhase = "idle" | "align" | "spool" | "burn";

export interface FlightState {
  pos: V3;
  /** Heading about the vertical: atan2(dx, dz), 0 faces +z. */
  yaw: number;
  /** Elevation of the nose above the horizon. */
  pitch: number;
  phase: FlightPhase;
  /** ms into the current phase. */
  t: number;
  from: V3;
  to: V3;
  /** The yaw/pitch the ship is turning toward during ALIGN. */
  aimYaw: number;
  aimPitch: number;
  startYaw: number;
  startPitch: number;
  burnMs: number;
  /** 0..1 engine heat. */
  engine: number;
  /** 0..1 how hard the ship is moving (edge blur / streak feel). */
  speed: number;
  /** ms since the last burn finished (engines cool from here). */
  sinceArrival: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** Shortest signed turn from a to b, radians. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function initialFlight(pos: V3, yaw = 0, pitch = 0): FlightState {
  return {
    pos,
    yaw,
    pitch,
    phase: "idle",
    t: 0,
    from: pos,
    to: pos,
    aimYaw: yaw,
    aimPitch: pitch,
    startYaw: yaw,
    startPitch: pitch,
    burnMs: 0,
    engine: IDLE_ENGINE,
    speed: 0,
    sinceArrival: COOL_MS,
  };
}

export interface FlightTarget {
  center: V3;
  /** Rough radius of the place, world units. */
  radius: number;
}

/** Where the ship ends up: on the line to the place, a stand-off short of it. */
export function standoffPoint(from: V3, target: FlightTarget): V3 {
  const d = sub(target.center, from);
  const dist = len(d);
  const standoff = Math.max(STANDOFF_MIN, target.radius * STANDOFF_FACTOR);
  if (dist <= standoff + 1) return from; // already there
  const k = (dist - standoff) / dist;
  return [from[0] + d[0] * k, from[1] + d[1] * k, from[2] + d[2] * k];
}

export function startFlight(s: FlightState, target: FlightTarget): FlightState {
  const to = standoffPoint(s.pos, target);
  const aim = sub(target.center, s.pos);
  const horizontal = Math.hypot(aim[0], aim[2]);
  const dist = len(sub(to, s.pos));
  return {
    ...s,
    phase: dist < 1 ? "idle" : "align",
    t: 0,
    from: s.pos,
    to,
    aimYaw: horizontal > 1e-6 ? Math.atan2(aim[0], aim[2]) : s.yaw,
    aimPitch: Math.atan2(aim[1], Math.max(horizontal, 1e-6)),
    startYaw: s.yaw,
    startPitch: s.pitch,
    burnMs: Math.min(BURN_MAX_MS, Math.max(BURN_MIN_MS, BURN_MIN_MS + dist * BURN_MS_PER_UNIT)),
    sinceArrival: 0,
  };
}

/**
 * Advance the flight. `arrived` is true on the step the burn completes.
 * Reduced motion: no sweep and no glide — the ship faces the place at once and is placed at the stand-off.
 */
export function stepFlight(
  s: FlightState,
  dtMs: number,
  opts: { reducedMotion?: boolean } = {},
): { state: FlightState; arrived: boolean } {
  const dt = Math.max(0, dtMs);
  if (s.phase === "idle") {
    const since = s.sinceArrival + dt;
    const cool = clamp01(since / COOL_MS);
    return { state: { ...s, sinceArrival: since, engine: IDLE_ENGINE + (Math.max(s.engine, IDLE_ENGINE) - IDLE_ENGINE) * (1 - cool), speed: 0 }, arrived: false };
  }
  if (opts.reducedMotion) {
    return {
      state: { ...s, pos: s.to, yaw: s.aimYaw, pitch: s.aimPitch, phase: "idle", t: 0, engine: 1, speed: 0, sinceArrival: 0 },
      arrived: true,
    };
  }
  const t = s.t + dt;
  if (s.phase === "align") {
    const u = smooth(t / ALIGN_MS);
    const next: FlightState = {
      ...s,
      t,
      yaw: s.startYaw + angleDelta(s.startYaw, s.aimYaw) * u,
      pitch: s.startPitch + (s.aimPitch - s.startPitch) * u,
      engine: IDLE_ENGINE + 0.38 * u,
      speed: 0,
    };
    return t >= ALIGN_MS ? { state: { ...next, yaw: s.aimYaw, pitch: s.aimPitch, phase: "spool", t: t - ALIGN_MS }, arrived: false } : { state: next, arrived: false };
  }
  if (s.phase === "spool") {
    const u = clamp01(t / SPOOL_MS);
    const next: FlightState = { ...s, t, engine: 0.5 + 0.5 * u, speed: 0 };
    return t >= SPOOL_MS ? { state: { ...next, engine: 1, phase: "burn", t: t - SPOOL_MS }, arrived: false } : { state: next, arrived: false };
  }
  // burn
  const u = clamp01(t / s.burnMs);
  const pos = lerp3(s.from, s.to, easeInOutCubic(u));
  // Speed is the slope of the ease, normalised so the peak reads as 1 (the middle of the burn).
  const slope = u < 0.5 ? 12 * u * u : 12 * (1 - u) * (1 - u);
  const speed = clamp01(slope / 3);
  if (u >= 1) {
    return { state: { ...s, pos: s.to, phase: "idle", t: 0, engine: 1, speed: 0, sinceArrival: 0 }, arrived: true };
  }
  return { state: { ...s, pos, t, engine: 1, speed }, arrived: false };
}

/** The unit vector the nose points along. */
export function noseDirection(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

export const CHASE_DISTANCE = 46;
export const CHASE_HEIGHT = 14;
export const CHASE_LOOK_AHEAD = 40;

/** The follow camera behind and above the ship, looking a little ahead of her. */
export function chasePose(s: Pick<FlightState, "pos" | "yaw" | "pitch">): { position: V3; target: V3 } {
  const f = noseDirection(s.yaw, s.pitch);
  return {
    position: [s.pos[0] - f[0] * CHASE_DISTANCE, s.pos[1] - f[1] * CHASE_DISTANCE + CHASE_HEIGHT, s.pos[2] - f[2] * CHASE_DISTANCE],
    target: [s.pos[0] + f[0] * CHASE_LOOK_AHEAD, s.pos[1] + f[1] * CHASE_LOOK_AHEAD, s.pos[2] + f[2] * CHASE_LOOK_AHEAD],
  };
}

/** "420 across · 35× your ship" — the scale note shown on arrival. */
export function scaleNote(radius: number, shipLength = 12): string {
  const across = Math.round(radius * 2);
  const ratio = across / shipLength;
  const times = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  return `${across} across · ${times}× your ship`;
}
