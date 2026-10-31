/**
 * The Road to the Seam (docs/specs/seam-road-to-the-seam-2026-10-31.md): pure layout numbers for one long road under the Station. No three.js, so it is unit-tested. The road runs
 * along +z from a mouth near the origin and goes on into fog — nothing in the scene ever shows where it ends.
 */
export const ROAD = { halfWidth: 110, wallHalfWidth: 114, zStart: -120, zEnd: 2400, wallHeight: 190 } as const;
/** How far along the road the world's origin (the host's orbit centre) stands. */
export const ROAD_VIEW_Z = 320;
/** The orbit must stay inside the walls even at the widest portrait back-off (MAX_PORTRAIT_FIT 2.2). */
export const ROAD_ORBIT_RADIUS = 16;
export const ROAD_ORBIT_HEIGHT = 16;

export const ROAD_LAMP_SPACING = 120;
export const ROAD_NAIL_SPACING = 26;
export const ROAD_NAIL_HEIGHT = 50;
/** Chalk strokes are set at a child's height. */
export const ROAD_CHALK_HEIGHT = 16;
export const ROAD_CHALK_FROM_Z = 140;
/** Where the chalk stops. */
export const ROAD_CHALK_END_Z = 1300;

/** Lamps hang on both walls at even spacing; every one the same height. */
export function roadLamps(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let z = 60; z <= ROAD.zEnd - 100; z += ROAD_LAMP_SPACING) out.push({ x: -ROAD.halfWidth + 4, y: 64, z }, { x: ROAD.halfWidth - 4, y: 64, z });
  return out;
}

/** One nail set in the wall every stride (right wall), each faintly warm. */
export function roadNails(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let z = 40; z <= ROAD.zEnd - 60; z += ROAD_NAIL_SPACING) out.push({ x: ROAD.halfWidth - 1, y: ROAD_NAIL_HEIGHT, z });
  return out;
}

/** Chalk strokes on the left wall in small groups, low; they stop at ROAD_CHALK_END_Z. Seeded and fixed. */
export function roadChalk(): { z: number; y: number; tilt: number }[] {
  let x = 123456789;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const out: { z: number; y: number; tilt: number }[] = [];
  for (let z = ROAD_CHALK_FROM_Z; z < ROAD_CHALK_END_Z; z += 9) out.push({ z: z + next() * 3, y: ROAD_CHALK_HEIGHT + next() * 4, tilt: (next() - 0.5) * 0.25 });
  return out;
}

/** The named holders the scene builds — place rules, spots and passages anchor to these. */
export const ROAD_HOLDERS = ["road-mouth", "road-lamps", "road-nails", "road-chalk", "road-doorframe", "road-post", "road-chalk-end", "road-far"] as const;
export const ROAD_DOORFRAME_Z = 560;
export const ROAD_POST_Z = 940;
