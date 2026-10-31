/**
 * The Village (docs/specs/seam-the-forty-second-2026-10-31.md): pure layout numbers for a small hillside village at night. No three.js, so it is unit-tested. Every house window is lit;
 * a gate stands where a count was kept; a path of small gold hooks climbs from the square to a tall luminous doorway. Nothing is shown beyond the doorway, and nothing says whether anyone was right.
 */
export const VILLAGE = { halfWidth: 520, zStart: -200, zEnd: 1500 } as const;
/** The world's origin (the host's orbit centre) stands in the square. */
export const VILLAGE_ORBIT_RADIUS = 70;
export const VILLAGE_ORBIT_HEIGHT = 40;
export const VILLAGE_SQUARE_Z = 360;

export interface House {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Radians about the vertical. */
  yaw: number;
}

/** Houses in two loose rows either side of the central way, seeded and fixed; none stands in the square or on the path. */
export function villageHouses(): House[] {
  let s = 987654321;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const out: House[] = [];
  for (let z = 60; z <= 1250; z += 70) {
    for (const side of [-1, 1]) {
      const x = side * (150 + next() * 200);
      if (Math.abs(z - VILLAGE_SQUARE_Z) < 120) continue; // the square is open
      out.push({ x, z: z + (next() - 0.5) * 24, w: 40 + next() * 22, d: 34 + next() * 20, h: 30 + next() * 20, yaw: side * 0.15 + (next() - 0.5) * 0.2 });
    }
  }
  return out;
}

/** Small gold hooks along the way, one every few strides, climbing from the square toward the doorway. */
export const HOOK_FROM_Z = 440;
export const HOOK_TO_Z = 1320;
export const HOOK_SPACING = 40;
export function villageHooks(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let z = HOOK_FROM_Z; z <= HOOK_TO_Z; z += HOOK_SPACING) {
    const t = (z - HOOK_FROM_Z) / (HOOK_TO_Z - HOOK_FROM_Z);
    out.push({ x: Math.sin(z / 150) * 14, y: 10 + t * 90, z });
  }
  return out;
}

export const VILLAGE_GATE_Z = -40;
export const VILLAGE_DOOR_Z = 1420;
export const VILLAGE_WELL_Z = 330;
export const VILLAGE_CHAIR_Z = 700;
/** Where the world's origin stands relative to the layout's own z (so the orbit is in the square). */
export const VILLAGE_VIEW_Z = VILLAGE_SQUARE_Z;

export const VILLAGE_HOLDERS = ["village-gate", "village-windows", "village-well", "village-chair", "village-hearth", "village-hooks", "village-door", "village-bread"] as const;
