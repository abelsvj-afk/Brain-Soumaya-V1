/**
 * The Unlit Hulls (docs/specs/seam-the-unlit-hulls-2026-10-31.md): pure layout numbers for the yard where the seventh hull was laid. No three.js, so it is unit-tested. Six long hulls lie on their slips, each
 * finished in one part only and none lit; a seventh slip stands apart with only a frame on it. Six nameplates hang on a rail, a seventh plate lies smooth on a bench, a ledger desk keeps no ledger, tools are laid
 * down square, lanterns hang trimmed and unlit, a crane holds its place over the seventh slip. Nothing says the name that goes on the seventh plate and no one is shown. The origin (the host's orbit centre) is the
 * middle of the yard, so the orbit circles it; the hulls lie toward −z, where the host camera opens.
 */
export const YARD = { radius: 950 } as const;
export const YARD_ORBIT_RADIUS = 70;
export const YARD_ORBIT_HEIGHT = 40;
export const YARD_HULL_Z = -340;
export const YARD_HULL_SPACING = 108;
export const YARD_HULL_LENGTH = 170;
export const YARD_SEVENTH_AT = { x: 340, z: -140 } as const;
export const YARD_PLATES_AT = { x: -250, z: -150 } as const;
export const YARD_BLANK_AT = { x: 70, z: -85 } as const;
export const YARD_DESK_AT = { x: -80, z: -80 } as const;
export const YARD_TOOLS_AT = { x: 0, z: 95 } as const;
export const YARD_LAMPS = { z: -215, x0: -230, x1: 150, count: 8 } as const;
export const YARD_CRANE_AT = { x: 340, z: -140 } as const;
export const YARD_RIB_COUNT = 9;

/** The six hulls: the part each is finished in, in the order of the doors. */
export const YARD_HULL_PARTS = ["dawn-prow", "plumb-keel", "latch-fin", "bloom-wing", "ember-engine", "lullaby-flank"] as const;

export function yardHulls(): { x: number; z: number; part: (typeof YARD_HULL_PARTS)[number] }[] {
  return YARD_HULL_PARTS.map((part, i) => ({ x: (i - (YARD_HULL_PARTS.length - 1) / 2) * YARD_HULL_SPACING - 40, z: YARD_HULL_Z, part }));
}

/** Stroke lengths cut into each of the six plates: slow, even, the pace at which something is rocked (long short long short … ). */
export function yardPlateStrokes(): number[][] {
  const base = [3, 1, 3, 1, 3, 1];
  return Array.from({ length: 6 }, () => [...base]);
}

/** Ribs of the seventh slip, along its length. */
export function yardRibs(): { z: number; scale: number }[] {
  return Array.from({ length: YARD_RIB_COUNT }, (_, i) => {
    const t = i / (YARD_RIB_COUNT - 1);
    return { z: YARD_SEVENTH_AT.z - 70 + t * 140, scale: 0.55 + Math.sin(t * Math.PI) * 0.45 };
  });
}

export function yardLamps(): { x: number; z: number }[] {
  return Array.from({ length: YARD_LAMPS.count }, (_, i) => ({ x: YARD_LAMPS.x0 + (i / (YARD_LAMPS.count - 1)) * (YARD_LAMPS.x1 - YARD_LAMPS.x0), z: YARD_LAMPS.z }));
}

export const YARD_HOLDERS = ["yard-six", "yard-seventh", "yard-plates", "yard-blank", "yard-desk", "yard-tools", "yard-lamps", "yard-crane"] as const;
