/**
 * The Faded Ward (docs/specs/seam-faded-ward-2026-10-31.md): pure layout numbers for one long hall of cots. No three.js here, so it is unit-tested. The hall runs along +z from
 * a door near the origin; the far end is lost in fog on purpose — the cots go on, and nothing in the scene ever says how many there are.
 */
export const WARD_HALL = { halfWidth: 150, zStart: -160, zEnd: 2200, height: 150 } as const;

/** How far into the hall the world's origin (the host's orbit centre) stands: in the aisle, between the rows. */
export const WARD_VIEW_Z = 380;
/** The orbit must stay inside the walls even at the widest portrait back-off (worldCamera MAX_PORTRAIT_FIT = 2.2). */
export const WARD_ORBIT_RADIUS = 60;
export const WARD_ORBIT_HEIGHT = 18;

/** Distance between cots along the wall. */
export const WARD_COT_SPACING = 44;
/** Cots begin this far into the hall and run on past the fog. */
export const WARD_COT_START_Z = 90;
/** Where a cot's head meets the wall. */
export const WARD_COT_WALL_X = 138;
/** Roughly the span the fog hides; cots past the end are simply not built. */
export const WARD_COT_END_Z = 2100;

export interface WardCot {
  side: -1 | 1;
  /** Index along the wall (0 = nearest the door). */
  index: number;
  /** Head of the cot (at the wall). */
  x: number;
  z: number;
}

/** Every cot, both walls, nearest the door first. */
export function wardCots(): WardCot[] {
  const out: WardCot[] = [];
  for (let z = WARD_COT_START_Z, i = 0; z <= WARD_COT_END_Z; z += WARD_COT_SPACING, i++) {
    out.push({ side: -1, index: i, x: -WARD_COT_WALL_X, z });
    out.push({ side: 1, index: i, x: WARD_COT_WALL_X, z });
  }
  return out;
}

/** The few cots with a name of their own. Everything else is the ward. */
export const WARD_SPECIAL = {
  /** Ruel's cot: where a laugh is heard on the days Tamsin is away (left wall). */
  ruel: { side: -1 as const, index: 3 },
  /** A cot made up for whoever wore the coat on the hook (right wall). */
  linnet: { side: 1 as const, index: 6 },
  /** A small bed with a tin soldier beside it (right wall) — only the soldier is shown, never a name. */
  small: { side: 1 as const, index: 11 },
} as const;

export const specialCot = (k: keyof typeof WARD_SPECIAL): WardCot => {
  const s = WARD_SPECIAL[k];
  const z = WARD_COT_START_Z + s.index * WARD_COT_SPACING;
  return { side: s.side, index: s.index, x: s.side * WARD_COT_WALL_X, z };
};

/** Lanterns hang between every fourth cot, down the middle of each side. */
export function wardLanternPositions(): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let z = WARD_COT_START_Z + WARD_COT_SPACING * 2; z <= WARD_COT_END_Z; z += WARD_COT_SPACING * 4) {
    out.push({ x: -WARD_COT_WALL_X + 30, y: 70, z }, { x: WARD_COT_WALL_X - 30, y: 70, z });
  }
  return out;
}

/**
 * Which cots hold a faint sleeper. Seeded and fixed, so the ward is the same every visit; roughly two in three, and never counted anywhere. The special cots are decided by hand:
 * Ruel's holds a laugh (handled in the scene), Linnet's is made up and empty, the small bed holds only its soldier.
 */
export function wardOccupied(cots: readonly WardCot[]): boolean[] {
  let x = 2463534242;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const empty = new Set<string>([`${WARD_SPECIAL.linnet.side}:${WARD_SPECIAL.linnet.index}`, `${WARD_SPECIAL.small.side}:${WARD_SPECIAL.small.index}`, `${WARD_SPECIAL.ruel.side}:${WARD_SPECIAL.ruel.index}`]);
  return cots.map((c) => (empty.has(`${c.side}:${c.index}`) ? false : next() < 0.66));
}

/** The named holders the scene builds — the place rules, spots and passages anchor to these. */
export const WARD_HOLDERS = ["ward-door", "ward-cot-ruel", "ward-cot-linnet", "ward-small-bed", "ward-bowl", "ward-window", "ward-hook", "ward-far"] as const;
