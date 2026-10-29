/**
 * Station Interior layout (Wave 2, settled design 2026-10-28) — the pure
 * function that places the interior of the Great Station. No three.js
 * here: this module is the testable contract, and the scene module
 * renders exactly what it returns.
 *
 * Settled ground (docs/worlds/station-interior-design.md, §§1–6):
 * - The interior is the Station's inside, not a new world: the same
 *   harbor, from within. It is a MODE of the Great Station stay — no
 *   chart entry, no route-board entry, no travel cost. You travel to
 *   the Station by the normal flow, then step inside — free, instant,
 *   reversible.
 * - Movement is JUMP from a list: you pick a room, you are there. No
 *   walking, no first-person movement, no free-roam corridors, no
 *   slow glide of any kind. (The dock-in is the arrival into the
 *   station, not movement inside it.)
 * - FOUR rooms, no others: the Hangar Bay (arrival room and ship
 *   room — your ship floats in the center, you pick and change ships
 *   here, the bay shows your fleet roster and the ships you have
 *   used), the Commission Board (take commissions: Link, Review,
 *   Journey step, Inbox item), the Fleet Deck (see your fleet, send
 *   fleets on automated missions, fleet defense), and the Observation
 *   Deck (look out at the galaxy — a quiet place to be, no task, no
 *   counter, nothing to earn).
 * - Built from the Kenney Station Kit already in the app: no new
 *   GLBs, no new licenses, no new uploads. The prior crew's D-I4
 *   ("the bay is a viewing space, NOT the hangar") is SUPERSEDED by
 *   the settled design — the bay IS the hangar now, and the visitor
 *   craft that used to berth there is gone.
 * - Palette grammar carried inside: warm amber working light vs cold
 *   indigo; cyan is navigation truth ONLY (wayfinding markers + the
 *   gate frame's nav lights).
 * - No fuel inside. Entry, movement, and leaving are all free. Fuel
 *   is spent only on the journey TO the Station, by the normal rules.
 * - No NPCs inside. The harbor controller meets you at arrival,
 *   outside. No dates, no scores, no hardcoded person name. Copy is
 *   plain words.
 *
 * The interior is one hall along X: the hangar bay at +64 (its bay
 * door opens on the stars and the passing traffic), the commission
 * board at 0 (the main hall, the Station's gate frame at its far
 * end), the fleet deck at −64, and the observation deck at −128
 * (the wheel rim out its viewport, at the Station's real 210-unit
 * radius). The camera holds a slow orbit per room — that orbit is
 * how you look around your docked ship — and jumps instantly when
 * the room list picks another room.
 *
 * Dates: the interior carries none, so the NO UTC rule has nothing
 * to bite on. Copy is plain words throughout.
 */

import { STATION_PALETTE } from "./stationLayout.js";

export const STATION_INTERIOR_SEED = "great-station / interior-1";

/** Recipe budget: the Station's own internal targets bind the interior too. */
export const STATION_INTERIOR_BUDGET = { maxDrawCalls: 64, maxTris: 500_000 } as const;

/** The camera's slow orbit rate inside a room — the same stately rate the exterior orbit uses. */
export const INTERIOR_ORBIT_RATE_RAD_PER_MS = 0.0000045;

export type InteriorRoomId = "hangar-bay" | "commission-board" | "fleet-deck" | "observation-deck";

/** A placed kit piece — one instance of a model from the interior manifest. */
export interface InteriorPiece {
  /** Model key (matches the manifest in stationInteriorAssets.ts). */
  model: string;
  position: readonly [number, number, number];
  rotationY: number;
  /** Uniform scale applied to the loaded geometry. */
  scale: number;
}

export interface InteriorRoom {
  id: InteriorRoomId;
  /** Plain-words name, as the world shows it. */
  title: string;
  /** Plain-words line, as the world shows it. */
  blurb: string;
  center: readonly [number, number, number];
  /** Floor plate size (the basalt floor under the kit pieces). */
  floor: { width: number; depth: number };
  /** Ceiling height — the hall is roofed; the sky is not the ceiling. */
  ceilingY: number;
  /** The slow orbit the surface holds in this room. */
  orbit: { radius: number; height: number; lookAtY: number };
  pieces: InteriorPiece[];
}

/** The Station's own gate, industrial and lit, at the main hall's far end. */
export const INTERIOR_GATE = {
  /** The gate frame stands across the commission board's far (−Z) end. */
  center: [0, 0, -14] as const,
  /** Half-width of the frame — the opening you step through. */
  halfWidth: 6,
  /** Lintel height. */
  height: 10,
} as const;

/** Wayfinding: cyan nav markers along the hall's centerline — navigation truth, never decoration. */
export const INTERIOR_NAV_MARKERS: readonly (readonly [number, number, number])[] = [
  [-128, 0.4, 0],
  [-96, 0.4, 0],
  [-64, 0.4, 0],
  [-32, 0.4, 0],
  [0, 0.4, 0],
  [32, 0.4, 0],
  [64, 0.4, 0],
];

/** Amber work lights: small lit points along the ceilings, two per room. */
export const INTERIOR_WORK_LIGHTS: readonly (readonly [number, number, number])[] = [
  [64, 13.4, -7],
  [64, 13.4, 7],
  [0, 13.4, -7],
  [0, 13.4, 7],
  [-64, 13.4, -7],
  [-64, 13.4, 7],
  [-128, 13.4, -6],
  [-128, 13.4, 6],
];

/** Amber light strips on the ceilings — thin lit bars, the hall's working light. */
export const INTERIOR_LIGHT_STRIPS: readonly {
  position: readonly [number, number, number];
  rotationY: number;
}[] = [
  { position: [64, 13.6, 0], rotationY: 0 },
  { position: [0, 13.6, 0], rotationY: 0 },
  { position: [-64, 13.6, 0], rotationY: 0 },
  { position: [-128, 13.6, 0], rotationY: 0 },
];

/**
 * The wheel rim, seen from inside: the Station's own wheel at its real
 * 210-unit radius, a vertical half-arc across the deck's viewport. The
 * arc's top reaches 30 units above the deck floor, 260 out — the scale
 * you know from outside, felt from within. Architecture, not a fake
 * asset: it is the Station's own structure, placed where the deck looks.
 */
export const INTERIOR_RIM_ARC = {
  center: [-128, -180, -260] as const,
  /** STATION_WHEEL_RADIUS — the same 210 the exterior is built on. */
  radius: 210,
  tube: 8,
} as const;

/** The bay door: the framed opening in the hangar bay's +Z colonnade, through which the stars and the passing ship are seen. */
export const INTERIOR_BAY_DOOR = {
  center: [64, 0, 15] as const,
  halfWidth: 8,
  height: 11,
} as const;

/** The deck viewport: the framed opening in the observation deck's −Z colonnade, through which the rim arc is seen. */
export const INTERIOR_DECK_VIEWPORT = {
  center: [-128, 0, -13] as const,
  halfWidth: 7,
  height: 9,
} as const;

/** The passing ship outside the bay door: the dispatcher, on a slow straight lane past the opening. */
export const INTERIOR_BAY_LANE = {
  /** The lane runs along X, outside the door (z = 60), at the door's height. */
  z: 60,
  y: 6,
  fromX: 30,
  toX: 110,
  /** One slow pass each way, then back — presentation only, a loop. */
  cycleMs: 120_000,
} as const;

export interface StationInteriorLayout {
  spaces: InteriorRoom[];
  /** The relic wiring point is deliberately absent: relics rest in worlds, and the interior is a mode of the Station, not a world. */
}

/**
 * Build the interior layout. No graph input — the interior surfaces no
 * memories of its own (like the Station, it is not a memory-bearing
 * world), so the rooms are the same for every traveler, every visit.
 * Deterministic: the same hall, every device.
 */
export function buildStationInteriorLayout(): StationInteriorLayout {
  return {
    spaces: [
      {
        id: "hangar-bay",
        title: "The Hangar Bay",
        blurb:
          "Your ship, just docked, floats in the center of the bay. Pick a ship here, see your fleet, and look around.",
        center: [64, 0, 0],
        floor: { width: 44, depth: 32 },
        ceilingY: 14,
        orbit: { radius: 14, height: 6, lookAtY: 4 },
        pieces: [
          // The bay shell itself — the big hangar piece, the room's bones.
          { model: "hangar_largeA", position: [64, 0, -6], rotationY: 0, scale: 1.5 },
          { model: "hangar_smallA", position: [80, 0, -8], rotationY: 0.6, scale: 1 },
          // No berthed visitor: the center of this bay belongs to YOUR
          // ship (the scene floats it there, skin-aware). The settled
          // design superseded the prior build's visitor craft.
          { model: "structure", position: [48, 0, 10], rotationY: 0.2, scale: 1 },
          { model: "structure", position: [80, 0, 10], rotationY: 1.3, scale: 1 },
          // Bay-door frame: two columns marking the opening in the +Z colonnade.
          { model: "structure_detailed", position: [56, 0, 15], rotationY: 0, scale: 1 },
          { model: "structure_detailed", position: [72, 0, 15], rotationY: 0, scale: 1 },
          { model: "container", position: [50, 0, -8], rotationY: 0.7, scale: 1 },
          { model: "container", position: [78, 0, 6], rotationY: 1.9, scale: 1 },
          { model: "pipe", position: [64, 0, -12], rotationY: 0, scale: 1 },
        ],
      },
      {
        id: "commission-board",
        title: "The Commission Board",
        blurb:
          "Work waiting at the Station: link something, review, take a journey step, or clear an inbox item.",
        center: [0, 0, 0],
        floor: { width: 48, depth: 34 },
        ceilingY: 14,
        orbit: { radius: 16, height: 6, lookAtY: 4 },
        pieces: [
          // Raised floor plates — the hall's dais.
          { model: "platform_large", position: [0, 0, 0], rotationY: 0, scale: 2 },
          // Colonnade: the hall's columns.
          { model: "structure", position: [-16, 0, -10], rotationY: 0.3, scale: 1 },
          { model: "structure", position: [16, 0, -10], rotationY: 0.9, scale: 1 },
          { model: "structure", position: [-16, 0, 10], rotationY: 1.7, scale: 1 },
          { model: "structure", position: [16, 0, 10], rotationY: 2.4, scale: 1 },
          // The gate frame: two detailed columns + lintel (the lintel is scene geometry, the columns are kit).
          { model: "structure_detailed", position: [-6, 0, -14], rotationY: 0, scale: 1 },
          { model: "structure_detailed", position: [6, 0, -14], rotationY: 0, scale: 1 },
          { model: "structure_detailed", position: [-20, 0, 0], rotationY: 0.5, scale: 1 },
          // Crates and pipe runs — the hall is worked in, not empty.
          { model: "container", position: [18, 0, 8], rotationY: 0.4, scale: 1 },
          { model: "container", position: [19, 0, 5], rotationY: 1.1, scale: 1 },
          { model: "container", position: [-18, 0, 6], rotationY: 2.0, scale: 1 },
          { model: "pipe", position: [-10, 0, -12], rotationY: 0, scale: 1 },
          { model: "pipe", position: [10, 0, -12], rotationY: 0, scale: 1 },
        ],
      },
      {
        id: "fleet-deck",
        title: "The Fleet Deck",
        blurb: "Your fleet, its missions, and its defenses — all in one place.",
        center: [-64, 0, 0],
        floor: { width: 44, depth: 32 },
        ceilingY: 14,
        orbit: { radius: 14, height: 6, lookAtY: 4 },
        pieces: [
          { model: "platform_large", position: [-64, 0, 0], rotationY: 0, scale: 2 },
          { model: "structure", position: [-80, 0, -10], rotationY: 0.3, scale: 1 },
          { model: "structure", position: [-48, 0, -10], rotationY: 0.9, scale: 1 },
          { model: "structure", position: [-80, 0, 10], rotationY: 1.7, scale: 1 },
          { model: "structure", position: [-48, 0, 10], rotationY: 2.4, scale: 1 },
          { model: "structure_detailed", position: [-70, 0, -12], rotationY: 0, scale: 1 },
          { model: "structure_detailed", position: [-58, 0, -12], rotationY: 0, scale: 1 },
          { model: "container", position: [-78, 0, 8], rotationY: 0.4, scale: 1 },
          { model: "container", position: [-50, 0, 6], rotationY: 1.9, scale: 1 },
          { model: "pipe", position: [-64, 0, 10], rotationY: 0, scale: 1 },
        ],
      },
      {
        id: "observation-deck",
        title: "The Observation Deck",
        blurb: "A quiet place to be. The galaxy, the wheel rim, nothing to do.",
        center: [-128, 0, 0],
        floor: { width: 40, depth: 30 },
        ceilingY: 14,
        orbit: { radius: 13, height: 6, lookAtY: 4 },
        pieces: [
          { model: "platform_large", position: [-128, 0, 0], rotationY: 0, scale: 2 },
          // Viewport frame: two detailed columns marking the opening in the −Z colonnade.
          { model: "structure_detailed", position: [-135, 0, -13], rotationY: 0, scale: 1 },
          { model: "structure_detailed", position: [-121, 0, -13], rotationY: 0, scale: 1 },
          // The dish, pointing out the viewport — the deck listens outward.
          { model: "satelliteDish_large", position: [-128, 4, -8], rotationY: Math.PI, scale: 1 },
          { model: "structure", position: [-144, 0, 8], rotationY: 0.8, scale: 1 },
          { model: "structure", position: [-112, 0, 8], rotationY: 2.1, scale: 1 },
          { model: "container", position: [-142, 0, -6], rotationY: 1.4, scale: 1 },
          { model: "pipe", position: [-128, 0, 10], rotationY: 0, scale: 1 },
        ],
      },
    ],
  };
}

/** The camera pose for a room: the slow orbit the surface holds there. */
export function interiorSpaceCamera(space: InteriorRoom): {
  center: readonly [number, number, number];
  radius: number;
  height: number;
  lookAtY: number;
} {
  return {
    center: space.center,
    radius: space.orbit.radius,
    height: space.orbit.height,
    lookAtY: space.orbit.lookAtY,
  };
}

/**
 * The coverage sweep: every camera position the surface can hold
 * inside, enumerated — the four rooms at four quarter-turns each,
 * plus the two framed openings (bay door, deck viewport) from their
 * room centers. The device check is the visual proof per view; this
 * enumeration is what makes the sweep repeatable.
 */
export function interiorCameraSweep(): {
  space: InteriorRoomId;
  kind: "orbit" | "opening";
  azimuth: number;
}[] {
  const poses: { space: InteriorRoomId; kind: "orbit" | "opening"; azimuth: number }[] = [];
  for (const id of ["hangar-bay", "commission-board", "fleet-deck", "observation-deck"] as const) {
    for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      poses.push({ space: id, kind: "orbit", azimuth: angle });
    }
  }
  poses.push({ space: "hangar-bay", kind: "opening", azimuth: Math.PI / 2 });
  poses.push({ space: "observation-deck", kind: "opening", azimuth: -Math.PI / 2 });
  return poses;
}

/** Palette discipline, asserted in tests: cyan is navigation truth only — the nav markers and the gate's nav lights. */
export const INTERIOR_NAV_COLOR = STATION_PALETTE.cyan;
export const INTERIOR_WORK_COLOR = STATION_PALETTE.amber;
