/**
 * Great Station — pure layout math (Phase 2, P2-3; scaled up P2-6).
 * Everything the scene needs that can be decided without a renderer:
 * the recipe's palette grammar, the accessory layout (beacons, docking
 * lights, traffic), the three-stage approach, and the budget accounting.
 * Deterministic from the recipe seed — the same station every visit.
 * The hull itself is Profondo (Gate 0); until it lands, the scene
 * renders a proxy form built from these same proportions.
 *
 * Palette grammar (Great Station recipe): basalt graphite + gunmetal
 * hull tones; warm sodium-amber = working / inhabited light; pale cyan
 * = navigation truth ONLY (cardinal markers, the route line); cold
 * indigo space. Cyan never decorates.
 *
 * P2-6 (settled, owner's delegation 2026-10-25): the Station is
 * gigantic by camera, not by model — the hull was already 420 units
 * across (35 ship-lengths). The build wires the approach (A13, dead
 * code until now), pulls the resting orbit in 1250 → 600, and replaces
 * the placeholder traffic with real ships (Quaternius fleet, WATO,
 * Kenney craft). Internal targets ≤500k tris / ≤64 calls; the hard
 * boundaries (≤88 calls / ≤750k tris) stay rejection lines.
 */

export const STATION_SEED = "great-station / harbor-1";

/** The wheel/rim radius every Station layout element is sized against. */
export const STATION_WHEEL_RADIUS = 210;

/** Wheel diameter — the scale yardstick (420 units). */
export const STATION_WHEEL_DIAMETER = STATION_WHEEL_RADIUS * 2;

/**
 * Scale ratio (Q1, settled): wheel diameter : ship forward length =
 * 35:1. The hero ship is scaled to a 12-unit forward length so the
 * ratio holds exactly (420 / 12 = 35). A 12-unit shuttle beside a
 * 420-unit wheel is a boat beside a harbor wall.
 */
export const STATION_SCALE_RATIO = 35;
export const HERO_SHIP_FORWARD_LENGTH = 12;

/**
 * Resting orbit (Q1, settled): the camera sits at radius 600, height
 * 120 — the Station covers ~51% of the frame at rest instead of ~25%.
 * The previous orbit (1250/240) is why it never felt gigantic.
 */
export const STATION_ORBIT_RADIUS = 600;
export const STATION_ORBIT_HEIGHT = 120;

/** A13 arrival glide: the approach runs over 12 s on a Station stay,
 *  then settles into the resting orbit. Any pointer press skips it;
 *  reduced motion never plays it (same destination, same information). */
export const STATION_ARRIVAL_MS = 12_000;

/**
 * Outermost traffic lane (recon §4): the resting orbit clears it by
 * 110 units. The builder verifies the clearance at build; the test
 *  asserts it from these constants.
 */
export const STATION_MAX_TRAFFIC_RADIUS = 490;
export const STATION_ORBIT_CLEARANCE = STATION_ORBIT_RADIUS - STATION_MAX_TRAFFIC_RADIUS;

export const STATION_PALETTE = {
  hullBasalt: 0x2b2e35,
  hullGunmetal: 0x3d4149,
  amber: 0xffb454,
  amberDim: 0xb57a2e,
  cyan: 0x9fd8e8,
  indigo: 0x0b1026,
  starWarm: 0xffe6c0,
  starCold: 0xcfe0ff,
} as const;

/** Deterministic PRNG (mulberry32) over a string seed. */
export function rngFromSeed(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Beacon {
  angle: number;
  x: number;
  y: number;
  z: number;
  /** "nav" beacons are the pale-cyan cardinal markers — navigation
   *  truth. Everything else is amber working light. */
  role: "nav" | "work";
  phase: number;
}

/** Beacons around the wheel rim. Every 8th is a cardinal nav marker. */
export function beaconRing(seed: string, count = 48, radius = STATION_WHEEL_RADIUS): Beacon[] {
  const rnd = rngFromSeed(`${seed}:beacons`);
  const out: Beacon[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    out.push({
      angle,
      x: Math.cos(angle) * radius,
      y: (rnd() - 0.5) * 6,
      z: Math.sin(angle) * radius,
      role: i % 8 === 0 ? "nav" : "work",
      phase: rnd() * Math.PI * 2,
    });
  }
  return out;
}

export interface TrafficLane {
  radius: number;
  speed: number;
  phase: number;
  y: number;
  retrograde: boolean;
}

/**
 * Ambient traffic on fixed lanes — atmosphere, never information
 * (A17). Slow, sparse, and always subordinate to the station.
 * P2-6: twelve lanes, one per traffic model (eleven Quaternius hulls
 * plus the WATO regular — see stationAssets.ts, same order). Radii run
 * 255–490 so the outermost lane keeps the settled 110-unit clearance
 * to the resting orbit; the scene pairs lane i with model i.
 */
export function trafficLanes(seed: string, count = 12): TrafficLane[] {
  const rnd = rngFromSeed(`${seed}:traffic`);
  return Array.from({ length: count }, (_, i) => ({
    radius: 255 + i * 20 + rnd() * 15,
    speed: (0.008 + rnd() * 0.01) * (i % 2 === 0 ? 1 : -1),
    phase: rnd() * Math.PI * 2,
    y: (rnd() - 0.5) * 90,
    retrograde: i % 2 === 1,
  }));
}

export interface ApproachStage {
  name: "far" | "handoff" | "arrival";
  distance: number;
  /** Where the camera sits relative to the station center. */
  azimuth: number;
  elevation: number;
}

/** The recipe's three-stage approach: far silhouette → dual-layer
 *  handoff (the named V3 risk — kept as an explicit stage so the scene
 *  can crossfade layers here) → near arrival arc. P2-6 re-measured
 *  them against the hull and left them UNCHANGED: far 34.3% of the
 *  frame, handoff 78.9%, arrival 164.9% — overfills (C1 met). */
export const APPROACH_STAGES: readonly ApproachStage[] = [
  { name: "far", distance: 900, azimuth: 0.6, elevation: 0.18 },
  { name: "handoff", distance: 380, azimuth: 0.35, elevation: 0.1 },
  { name: "arrival", distance: 150, azimuth: 0.12, elevation: 0.04 },
];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/** Camera pose along the approach, t in [0,1] across all three stages.
 *  Distance decreases monotonically — an approach never backs away. */
export function approachPose(t: number): { distance: number; azimuth: number; elevation: number } {
  const x = clamp01(t) * (APPROACH_STAGES.length - 1);
  const i = Math.min(APPROACH_STAGES.length - 2, Math.floor(x));
  const f = easeInOut(x - i);
  const a = APPROACH_STAGES[i]!;
  const b = APPROACH_STAGES[i + 1]!;
  const lerp = (u: number, v: number) => u + (v - u) * f;
  return {
    distance: lerp(a.distance, b.distance),
    azimuth: lerp(a.azimuth, b.azimuth),
    elevation: lerp(a.elevation, b.elevation),
  };
}

/**
 * The hero's mooring (Q2): Soumaya's own ship, docked at the primary
 * arm (arm 0, angle 0), just outside the rim — her ship beside the
 * Station is the 35:1 ratio made visible. The mooring radius clears
 * the arm tip (207) and sits inside the innermost traffic lane (255).
 */
export const HERO_MOORING = { radius: 228, angle: 0, y: 0 } as const;

/** World position + facing for a ship moored at an arm: the nose
 *  points outward, away from the Station. rotationY turns the ship's
 *  −Z forward onto the outward direction. */
export function mooringPose(radius: number, angle: number, y = 0): { position: [number, number, number]; rotationY: number } {
  return {
    position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
    rotationY: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
  };
}

/** The hero's mooring pose (arm 0). */
export function heroMooringPose(): { position: [number, number, number]; rotationY: number } {
  return mooringPose(HERO_MOORING.radius, HERO_MOORING.angle, HERO_MOORING.y);
}

/**
 * The harbor controller's berth (Wave 2, NPC autonomy): the controller
 * flies the dispatcher (TRAFFIC_MODELS[2] — the same hull as the docking
 * shuttle, one load, no second fetch) and moors it at a berth between
 * arms 1 and 2. Radius 222 is the docked-ship radius; angle 3π/4 sits
 * π/4 from either neighboring arm (~174 units at this radius, clear of
 * the docked ships at lateral ±8) and inside the dressing band's inner
 * edge (radius 232+), so no dressing piece can sit on the berth. The
 * berth is attached to the Station, so the ship turns with the Station
 * like the hero and the docked ships.
 */
export const HARBOR_CONTROLLER_BERTH = { radius: 222, angle: (Math.PI * 3) / 4, y: 0 } as const;

/** The harbor controller's berth pose. */
export function harborControllerBerthPose(): { position: [number, number, number]; rotationY: number } {
  return mooringPose(HARBOR_CONTROLLER_BERTH.radius, HARBOR_CONTROLLER_BERTH.angle, HARBOR_CONTROLLER_BERTH.y);
}

/**
 * The docking arm (Q3): arm 2 (angle π/2) is where the docking shuttle
 * eases in. The mooring radius matches the hero's — the arm tip is the
 * same 207, the ship the same 12 long.
 */
export const DOCKING_ARM = { index: 2, angle: Math.PI / 2, radius: 228 } as const;

export function dockingMooringPose(): { position: [number, number, number]; rotationY: number } {
  return mooringPose(DOCKING_ARM.radius, DOCKING_ARM.angle, 0);
}

/**
 * Scale witnesses (C1, B-3): the drydock frame and the hauler sit just
 * off the approach corridor, placed so both are in the handoff frame
 * beside the Station (verified by the frame arithmetic in the build
 * record; the device check is the visual proof). Both sit inside the
 * innermost traffic lane and clear of the camera path — the camera
 * never comes closer than ~70 units to either.
 */
export const WITNESS_DRYDOCK_POSITION: readonly [number, number, number] = [105, 20, 177];
export const WITNESS_HAULER_POSITION: readonly [number, number, number] = [30, 10, 220];

/** R-S4 ring rotation: one full turn in ten minutes — stately enough
 *  never to compete with route information. Reduced motion holds it
 *  at zero (same scene, same information). */
export const STATION_ROTATION_RATE_RAD_PER_MS = (Math.PI * 2) / 600_000;

/** Budget accounting (§11/§20 recipe + P2-6 internal targets, review
 *  29 B-1): the scene's planned draw calls and visible triangles,
 *  asserted against the internal targets in tests so a growing
 *  accessory layer can't silently blow the budget. The hard boundaries
 *  (≤88 calls / ≤750k tris) stay rejection lines. Plan lines are
 *  per-part ceilings from MEASURED counts (see the P2-6 build record);
 *  merges can only reduce a line, never raise it. */
export const STATION_BUDGET = { drawCalls: 88, visibleTris: 750_000 } as const;
export const STATION_INTERNAL_TARGETS = { drawCalls: 64, visibleTris: 500_000 } as const;

export const STATION_DRAW_CALL_PLAN: readonly { part: string; calls: number }[] = [
  { part: "hull", calls: 5 },
  { part: "beacon ring (instanced, nav + work)", calls: 2 },
  { part: "work lights (instanced)", calls: 1 },
  { part: "hero ship (docked)", calls: 10 },
  { part: "harbor controller's ship (dispatcher, single mesh)", calls: 1 },
  { part: "traffic — Quaternius lanes (instanced, 1/model)", calls: 11 },
  { part: "traffic — WATO regular (merged by material)", calls: 7 },
  { part: "docking shuttle (single mesh)", calls: 1 },
  { part: "docked ships (Kenney, merged, 4 models)", calls: 4 },
  { part: "dressing (instanced, 6 models)", calls: 6 },
  { part: "witnesses — hauler (merged) + drydock frame (batched)", calls: 5 },
  { part: "starfield (HYG)", calls: 1 },
  { part: "route line + markers", calls: 0 },
  { part: "backdrop", calls: 0 },
];

/**
 * Measured visible triangles per part (worst case: every instance
 * visible). Hull 132,432 (measured §1); beacons 48 × 80; work lights
 * 32 × 48; hero 37,026 (measured from the deployed file); Quaternius
 * traffic 32,064 × 2 instances; WATO 730; docking shuttle 748;
 * docked 2,072 (cargoB ×2 + miner ×2 + cargoA + racer); dressing
 * 882 × 2; witnesses 264 + 1,516 (drydock composition); harbor
 * controller's ship 748 (the dispatcher, moored at its berth). Total
 * 246,804 — 49% of the internal target. Route and backdrop cost no
 * triangles: the route lives in the TravelPanel, the backdrop is a
 * clear color + fog, not a mesh.
 */
export const STATION_TRI_PLAN: readonly { part: string; tris: number }[] = [
  { part: "hull", tris: 132_432 },
  { part: "beacon ring (instanced, nav + work)", tris: 3_840 },
  { part: "work lights (instanced)", tris: 1_536 },
  { part: "hero ship (docked)", tris: 37_026 },
  { part: "harbor controller's ship (dispatcher, single mesh)", tris: 748 },
  { part: "traffic — Quaternius lanes (instanced, 1/model)", tris: 64_128 },
  { part: "traffic — WATO regular (merged by material)", tris: 730 },
  { part: "docking shuttle (single mesh)", tris: 748 },
  { part: "docked ships (Kenney, merged, 4 models)", tris: 2_072 },
  { part: "dressing (instanced, 6 models)", tris: 1_764 },
  { part: "witnesses — hauler (merged) + drydock frame (batched)", tris: 1_780 },
  { part: "starfield (HYG)", tris: 0 },
  { part: "route line + markers", tris: 0 },
  { part: "backdrop", tris: 0 },
];

export function plannedDrawCalls(): number {
  return STATION_DRAW_CALL_PLAN.reduce((n, p) => n + p.calls, 0);
}

export function plannedVisibleTris(): number {
  return STATION_TRI_PLAN.reduce((n, p) => n + p.tris, 0);
}

export interface CameraPose {
  kind: "approach" | "orbit";
  /** Approach: distance from the Station center. Orbit: orbit radius. */
  distance: number;
  azimuth: number;
  elevation: number;
}

/**
 * The C7 coverage sweep (review 29, B-5): every camera position the
 * WorldsSurface controls allow, enumerated. The approach glide runs
 * t ∈ {0, .25, .5, .75, 1} across the three stages; the resting orbit
 * is a fixed radius/height at four quarter-turns (the orbit is a full
 * circle — the quarters cover it). There is no user zoom, pan, or free
 * orbit: the camera is scripted, so this list IS the reachable set.
 * The device check is the visual proof per view; this enumeration is
 * what makes the sweep repeatable.
 */
export function stationCameraSweep(): CameraPose[] {
  const poses: CameraPose[] = [];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const p = approachPose(t);
    poses.push({ kind: "approach", distance: p.distance, azimuth: p.azimuth, elevation: p.elevation });
  }
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    poses.push({ kind: "orbit", distance: STATION_ORBIT_RADIUS, azimuth: angle, elevation: Math.atan2(STATION_ORBIT_HEIGHT, STATION_ORBIT_RADIUS) });
  }
  return poses;
}
