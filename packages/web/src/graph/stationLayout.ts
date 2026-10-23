/**
 * Great Station — pure layout math (Phase 2, P2-3). Everything the
 * scene needs that can be decided without a renderer: the recipe's
 * palette grammar, the accessory layout (beacons, docking lights,
 * traffic), the three-stage approach, and the budget accounting.
 * Deterministic from the recipe seed — the same station every visit.
 * The hull itself is Profondo (Gate 0); until it lands, the scene
 * renders a proxy form built from these same proportions.
 *
 * Palette grammar (Great Station recipe): basalt graphite + gunmetal
 * hull tones; warm sodium-amber = working / inhabited light; pale cyan
 * = navigation truth ONLY (cardinal markers, the route line); cold
 * indigo space. Cyan never decorates.
 */

export const STATION_SEED = "great-station / harbor-1";

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
export function beaconRing(seed: string, count = 48, radius = 210): Beacon[] {
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

/** Ambient traffic on fixed lanes — atmosphere, never information
 *  (A17). Slow, sparse, and always subordinate to the station. */
export function trafficLanes(seed: string, count = 5): TrafficLane[] {
  const rnd = rngFromSeed(`${seed}:traffic`);
  return Array.from({ length: count }, (_, i) => ({
    radius: 260 + i * 55 + rnd() * 30,
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
 *  can crossfade layers here) → near arrival arc. */
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

/** Budget accounting (§11/§20 recipe): the scene's planned draw calls
 *  and visible triangles, asserted against the hard boundaries in
 *  tests so a growing accessory layer can't silently blow the budget. */
export const STATION_BUDGET = { drawCalls: 88, visibleTris: 750_000 } as const;

export const STATION_DRAW_CALL_PLAN: readonly { part: string; calls: number }[] = [
  { part: "hull", calls: 4 },
  { part: "beacon ring (instanced)", calls: 1 },
  { part: "docking + spindle lights (instanced)", calls: 2 },
  { part: "traffic (instanced)", calls: 1 },
  { part: "starfield (HYG subset)", calls: 1 },
  { part: "backdrop", calls: 1 },
  { part: "route line + markers", calls: 3 },
  { part: "accessory dressing (batched)", calls: 6 },
];

export function plannedDrawCalls(): number {
  return STATION_DRAW_CALL_PLAN.reduce((n, p) => n + p.calls, 0);
}
