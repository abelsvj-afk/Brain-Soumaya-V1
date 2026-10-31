/**
 * The Folded Letter (docs/specs/seam-the-folded-letter-2026-10-31.md): pure layout numbers for the last room — an empty room with a letter on the floor, still folded. No three.js, so it is unit-tested. A small
 * square room open to the night; in its middle one letter folded in thirds; a place set for the reader facing it; a lamp left lit; a chair drawn back; a long shelf of kept letters; a window; a door ajar one hand's
 * breadth; a seat by the door worn by long sitting. Nothing shows the sentence's words, nothing says whether it is kind, and nothing records whether the letter is opened: it is reached only by choice and left by
 * choice. The world's origin (the host's orbit centre) is the letter, so the orbit circles it; the shelf lies toward −z, where the host camera opens.
 */
export const FOLD = { half: 270, wallHeight: 130 } as const;
export const FOLD_ORBIT_RADIUS = 70;
export const FOLD_ORBIT_HEIGHT = 40;
export const FOLD_READER_AT = { x: 0, z: 58 } as const;
export const FOLD_LAMP_AT = { x: -38, z: -22 } as const;
export const FOLD_CHAIR_AT = { x: -130, z: -150 } as const;
export const FOLD_SHELF = { z: -258, x0: -150, x1: 150, count: 34 } as const;
export const FOLD_DOOR_AT = { x: 270, z: 70 } as const;
export const FOLD_DOOR_WIDTH = 46;
export const FOLD_SEAT_AT = { x: 232, z: 20 } as const;
export const FOLD_WINDOW_AT = { x: -270, z: -40 } as const;
/** The door stands ajar one hand's breadth (a few units), never shut. */
export const FOLD_DOOR_AJAR = 3.4;

/** The kept letters on the shelf: evenly set, each a hair different in height and lean, each with one thumb's press (here, a small mark's x offset). */
export function foldShelfLetters(): { x: number; h: number; lean: number; thumb: number }[] {
  let s = 31415926;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const { x0, x1, count } = FOLD_SHELF;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + (i / (count - 1)) * (x1 - x0), h: 14 + next() * 4, lean: (next() - 0.5) * 0.1, thumb: (next() - 0.5) * 3 }));
}

export const FOLD_HOLDERS = ["fold-letter", "fold-reader", "fold-chair", "fold-shelf", "fold-lamp", "fold-door", "fold-seat", "fold-window"] as const;
