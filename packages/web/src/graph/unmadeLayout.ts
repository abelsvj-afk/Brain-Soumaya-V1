/**
 * The Unmade Hour (docs/specs/seam-the-unmade-hour-2026-10-31.md): pure layout numbers for the first Sixth Hour, before the second — a wide pale floor that remembers nothing. No three.js, so it is unit-tested.
 * Shallow hollows come up to a ring from every side and stop; at the ring's centre one place is worn smooth by standing; seven stone hands, a frame with no glass, a wall of finger-wide marks, a step one hand thick.
 * Nothing is shown of the made who were not kept, and nothing says why the hour was made twice.
 * The world's origin (the host's orbit centre) is the standing place, so the orbit circles it.
 */
export const UNMADE = { radius: 620 } as const;
export const UNMADE_ORBIT_RADIUS = 70;
export const UNMADE_ORBIT_HEIGHT = 40;
export const UNMADE_RING_RADIUS = 150;
export const UNMADE_HANDS_RADIUS = 95;
export const UNMADE_HAND_COUNT = 7;
/** Which hand holds no light (the seventh). */
export const UNMADE_UNLIT_HAND = 6;
/** The step's z, and how thick it is: one hand's breadth. */
export const UNMADE_SEAM_Z = 250;
export const UNMADE_STEP_HEIGHT = 3;
export const UNMADE_FRAME_Z = 430;
export const UNMADE_NOTE_AT = { x: 260, z: -80 } as const;
export const UNMADE_TALLY = { radius: 300, centre: -Math.PI / 2, span: 0.9 } as const;

export interface Hollow {
  x: number;
  z: number;
  /** Radians about the vertical, pointing toward the ring. */
  yaw: number;
}

/** Hollows in streams that converge on the ring from every side, seeded and fixed. None lies inside the ring or on its line, and none past the floor's edge. */
export function unmadeHollows(): Hollow[] {
  let s = 246813579;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const out: Hollow[] = [];
  const streams = 36;
  for (let i = 0; i < streams; i++) {
    const a = (i / streams) * Math.PI * 2 + (next() - 0.5) * 0.12;
    for (let r = UNMADE_RING_RADIUS + 22; r < UNMADE.radius - 80; r += 30 + next() * 14) {
      if (next() < 0.2) continue; // gaps: a stream is never a clean line
      const x = Math.sin(a) * r + (next() - 0.5) * 8;
      const z = Math.cos(a) * r + (next() - 0.5) * 8;
      out.push({ x, z, yaw: Math.atan2(-x, -z) });
    }
  }
  return out;
}

/** The seven hands' positions round the standing place. */
export function unmadeHands(): { x: number; z: number; lit: boolean }[] {
  return Array.from({ length: UNMADE_HAND_COUNT }, (_, i) => {
    const a = (i / UNMADE_HAND_COUNT) * Math.PI * 2;
    return { x: Math.sin(a) * UNMADE_HANDS_RADIUS, z: Math.cos(a) * UNMADE_HANDS_RADIUS, lit: i !== UNMADE_UNLIT_HAND };
  });
}

export const UNMADE_HOLDERS = ["unmade-hollows", "unmade-ring", "unmade-standing", "unmade-hands", "unmade-frame", "unmade-tally", "unmade-seam", "unmade-note"] as const;
