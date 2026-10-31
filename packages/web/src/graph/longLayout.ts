/**
 * The Long Morning (docs/specs/seam-the-long-morning-2026-10-31.md): pure layout numbers for a world of light with no horizon, from before the hole. No three.js, so it is unit-tested. A wide ring of ruled leaves with
 * no gap in it; at its middle one blank leaf as large as a table; a flake of the first light on a stand; a basin of still light; loose groups of tall columns of soft light (the people, without faces); a home of four
 * posts with a lamp trimmed for company; a single groove with no beginning; a curve of light that stops. Nothing says whether the Uncounted is Eternity and no one is shown. The origin (the host's orbit centre)
 * is the blank leaf, so the orbit circles it; things lie toward −z, where the host camera opens.
 */
export const LONG = { radius: 1400 } as const;
export const LONG_ORBIT_RADIUS = 70;
export const LONG_ORBIT_HEIGHT = 40;
export const LONG_RING_RADIUS = 280;
export const LONG_LEAF_COUNT = 14;
export const LONG_LEAF_HEIGHT = 96;
export const LONG_FLAKE_AT = { x: 70, z: -70 } as const;
export const LONG_POOL_AT = { x: -85, z: -45 } as const;
export const LONG_PEOPLE_AT = { x: -190, z: -250 } as const;
export const LONG_HOME_AT = { x: 240, z: -250 } as const;
export const LONG_STROKE_X = -150;
export const LONG_FRAY_AT = { x: 20, z: -200 } as const;

/** The ring's leaves: evenly spaced, each facing the middle, a whole circle (no gap). */
export function longLeaves(): { x: number; z: number; yaw: number }[] {
  return Array.from({ length: LONG_LEAF_COUNT }, (_, i) => {
    const a = (i / LONG_LEAF_COUNT) * Math.PI * 2;
    return { x: Math.sin(a) * LONG_RING_RADIUS, z: Math.cos(a) * LONG_RING_RADIUS, yaw: a + Math.PI };
  });
}

/** Columns of light, in loose groups of every height. Seeded and fixed. */
export function longPeople(): { x: number; z: number; h: number }[] {
  let s = 112233445;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return Array.from({ length: 11 }, () => ({ x: LONG_PEOPLE_AT.x + (next() - 0.5) * 120, z: LONG_PEOPLE_AT.z + (next() - 0.5) * 90, h: 50 + next() * 80 }));
}

export const LONG_HOLDERS = ["long-record", "long-flake", "long-people", "long-home", "long-stroke", "long-pool", "long-fray", "long-leaf"] as const;
