/**
 * The Siege of the First Light (docs/specs/seam-the-siege-2026-10-31.md): pure layout numbers for a field made of pale edges. No three.js, so it is unit-tested.
 * Crescent edges stand in ranks round a small bead of light and lean toward it; one edge stands apart and smiles; a line of small cups; a table holding the whole field in miniature; far ranks that keep their
 * distance; a smear of pale light; a cord with its last knot untied. Three tellers disagree about the field's size and none is shown to be wrong. Never says what the Morning was defended from, and never
 * shows anyone. The world's origin (the host's orbit centre) is the middle of the cup line, so the orbit circles it.
 */
export const SIEGE = { radius: 1300 } as const;
export const SIEGE_ORBIT_RADIUS = 70;
export const SIEGE_ORBIT_HEIGHT = 40;
/** The bead of light, behind the orbit centre. */
export const SIEGE_PLINTH = { x: 0, z: -120 } as const;
export const SIEGE_SMILE_AT = { x: -270, z: 250 } as const;
export const SIEGE_TABLE_AT = { x: 250, z: -60 } as const;
export const SIEGE_CORD_AT = { x: -230, z: -190 } as const;
export const SIEGE_BLUR_AT = { x: 170, z: 300 } as const;
export const SIEGE_CUP_COUNT = 9;
export const SIEGE_EDGE_HEIGHT = 30;

export interface Edge {
  x: number;
  z: number;
  /** Radians about the vertical, facing the bead. */
  yaw: number;
  scale: number;
}

const rng = (seed: number) => {
  let s = seed;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
};

/** Edges in concentric arcs round the bead, none inside the ring the orbit passes through, none on top of the smile or the table. Seeded and fixed. */
export function siegeEdges(): Edge[] {
  const next = rng(13572468);
  const out: Edge[] = [];
  for (let r = 300; r <= 700; r += 46) {
    const arc = r * 1.2; // each rank spans about a hundred and fifty degrees, open behind the bead
    const n = Math.floor(arc / 38);
    for (let i = 0; i < n; i++) {
      const th = (i / (n - 1) - 0.5) * 2.6 + (next() - 0.5) * 0.04;
      const x = SIEGE_PLINTH.x + Math.sin(th) * r + (next() - 0.5) * 5;
      const z = SIEGE_PLINTH.z + Math.cos(th) * r + (next() - 0.5) * 5;
      if (Math.hypot(x - SIEGE_SMILE_AT.x, z - SIEGE_SMILE_AT.z) < 70) continue;
      if (Math.hypot(x - SIEGE_TABLE_AT.x, z - SIEGE_TABLE_AT.z) < 70) continue;
      if (Math.hypot(x - SIEGE_BLUR_AT.x, z - SIEGE_BLUR_AT.z) < 60) continue;
      out.push({ x, z, yaw: Math.atan2(SIEGE_PLINTH.x - x, SIEGE_PLINTH.z - z), scale: 0.92 + next() * 0.16 });
    }
  }
  return out;
}

/** The far, faint ranks beyond the haze. */
export function siegeGhostEdges(): Edge[] {
  const next = rng(24681357);
  const out: Edge[] = [];
  for (let r = 760; r <= 1200; r += 60) {
    const n = Math.floor((r * 1.6) / 46);
    for (let i = 0; i < n; i++) {
      const th = (i / (n - 1) - 0.5) * 2.4 + (next() - 0.5) * 0.03;
      const x = Math.sin(th) * r;
      const z = SIEGE_PLINTH.z + Math.cos(th) * r;
      out.push({ x, z, yaw: Math.atan2(-x, SIEGE_PLINTH.z - z), scale: 1.2 + next() * 0.2 });
    }
  }
  return out;
}

/** Cups in a line across the cup stones, each a different size. */
export function siegeCups(): { x: number; z: number; r: number }[] {
  const next = rng(97531);
  return Array.from({ length: SIEGE_CUP_COUNT }, (_, i) => ({ x: (i - (SIEGE_CUP_COUNT - 1) / 2) * 30, z: 105, r: 4 + next() * 3 }));
}

/** The miniature field on the small table, in the table's own units. */
export function siegeMiniature(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) out.push({ x: (i - 4) * 4.4, z: -8 + row * 4.2 });
  return out;
}

export const SIEGE_HOLDERS = ["siege-edges", "siege-smile", "siege-line", "siege-first-light", "siege-small", "siege-vast", "siege-blur", "siege-cord"] as const;
