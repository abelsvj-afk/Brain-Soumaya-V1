import { ETERNITY_WORLD_KEY, FADED_WARD_WORLD_KEY, ROAD_WORLD_KEY, FOLDED_LETTER_WORLD_KEY, LONG_MORNING_WORLD_KEY, SIEGE_WORLD_KEY, UNMADE_WORLD_KEY, YARD_WORLD_KEY, VILLAGE_WORLD_KEY, warpCost, type TravelKind } from "@brain/shared";
import type { TravelState } from "../api/travel.js";

/**
 * The route board (Phase 2, P2-3): what the Station offers, derived
 * purely from the server's travel state. Journeys and routes only —
 * never memories (D-5).
 *
 * The chart below mirrors the server's travel allow-list
 * (TravelRepo.TRAVEL_WORLD_KEYS). The server remains the authority —
 * it rejects anything off-list; this chart only decides what the board
 * offers. When discovery lands in Phase 3, the chart moves into the
 * state response and this mirror goes away.
 *
 * Eternity's world is on the chart as a GATED world (B-01): the board
 * offers it only when the server's state says the gate stands open
 * for this traveller (`eternityReachable`). Until then the world is
 * not offered at all — the board never shows a journey the server
 * would refuse, and the gate's key stays a discovery, not a menu item.
 */
export const WORLD_CHART: readonly {
  key: string;
  name: string;
  blurb: string;
  gated?: boolean;
}[] = [
  { key: "home", name: "Home", blurb: "Your galaxy — every memory, always here." },
  {
    key: "great-station",
    name: "The Great Station",
    blurb: "The home port: journeys and routes begin here.",
  },
  {
    key: "growing-place",
    name: "The Growing Place",
    blurb: "The garden where your becoming is kept — memories resting as evidence, paths between them.",
  },
  {
    key: "deep-past",
    name: "The Deep Past",
    blurb: "Where your earlier life is kept — descend gently to what has waited longest.",
  },
  {
    key: "people",
    name: "The People",
    blurb: "The people of your life, gathered warm — who is with you, and what do you owe each other.",
  },
  {
    key: FADED_WARD_WORLD_KEY,
    name: "The Faded Ward",
    blurb: "A long hall of narrow cots, ember lanterns down its length, and the far end lost in fog. It opens for those who have found the ward in the People.",
  },
  {
    key: VILLAGE_WORLD_KEY,
    name: "The Village",
    blurb: "A hillside village at night with every window lit, and a path of small gold hooks climbing to a tall doorway. It opens for those who have found the thread that was passed hand to hand.",
  },
  {
    key: FOLDED_LETTER_WORLD_KEY,
    name: "The Folded Letter",
    blurb: "A small bare room with a letter on the floor, still folded. There is no reason to go. You may go, and you may leave when you like.",
  },
  {
    key: LONG_MORNING_WORLD_KEY,
    name: "The Long Morning",
    blurb: "A world of warm light with no horizon, a ring of ruled leaves with no gap in it, and tall soft columns that lean toward a visitor. It opens for those who have held a fragment of a record from before.",
  },
  {
    key: YARD_WORLD_KEY,
    name: "The Unlit Hulls",
    blurb: "A vast, dim shipyard where six long hulls lie unlit on their slips and a seventh stands as ribs. It opens for those who have seen a plate that carries no name.",
  },
  {
    key: SIEGE_WORLD_KEY,
    name: "The Siege of the First Light",
    blurb: "A broad pale field of crescent edges that lean toward a small bead of light, and a table that holds the whole of it. It opens for those who have been given a bead of the first morning.",
  },
  {
    key: UNMADE_WORLD_KEY,
    name: "The Unmade Hour",
    blurb: "A wide pale floor that remembers nothing, where shallow hollows lead to a ring and stop. It opens for those who have found the hollow along a certain hull.",
  },
  {
    key: ROAD_WORLD_KEY,
    name: "The Road to the Seam",
    blurb: "A long road under the Station, lamps at even spacing and a nail in the wall at every stride. It opens for those who have found the nail a traveller set in the harbor door.",
  },
  {
    key: "quiet-archive",
    name: "Quiet/Archive",
    blurb: "The resting place — where what you put away rests, whole, for a deliberate visit.",
  },
  {
    key: "scale",
    name: "Scale",
    blurb: "The actual station, actual size — the real ISS beside your ship, so the size is felt, not stated.",
  },
  {
    key: ETERNITY_WORLD_KEY,
    name: "Eternity's World",
    blurb: "The furthest world — a white void where Eternity himself stands. The way there runs through two other worlds, and the gate opens only for those carrying the Witness and two other relics.",
    gated: true,
  },
];

export interface RouteOption {
  kind: TravelKind;
  label: string;
  /** Fuel the server will charge, by its own rules (travel home and
   *  drift are always free). Display only — the server settles. */
  cost: number;
  affordable: boolean;
}

export interface RouteEntry {
  world: string;
  name: string;
  blurb: string;
  isCurrent: boolean;
  options: RouteOption[];
}

/** Fuel the server charges for one leg of this kind from `origin` to `destination` — the shared `warpCost` (it follows
 *  distance), displayed only; the server settles with the same function. Warp home and drift are always free. The board, the
 *  world map and the tours all read this, so they can never disagree. */
export function routeLegCost(kind: TravelKind, origin: string, destination: string): number {
  return kind === "drift" ? 0 : warpCost(origin, destination);
}

function option(kind: TravelKind, origin: string, world: string, balance: number): RouteOption {
  const cost = routeLegCost(kind, origin, world);
  return {
    kind,
    label: kind === "warp" ? "Warp" : "Drift",
    cost,
    affordable: balance >= cost,
  };
}

export function buildRouteBoard(state: TravelState): RouteEntry[] {
  // The People gate (P3-3, Q1) is the server's verdict, read from its
  // travel state: the board offers People only when the server says the
  // gate is open — never on the client's own guess. A missing flag (an
  // older server) reads as closed. The one exception is being there:
  // if the traveller is already in People, the entry stays, so the
  // board never hides the world they are standing in.
  // Eternity's world is GATED (B-01): the board offers it only when the
  // server says the gate stands open (eternityReachable) — the board
  // never offers a journey the server would refuse.
  const chart = WORLD_CHART.filter((w) => {
    if (w.key === "people") return state.peopleGateOpen === true || state.currentWorld === "people";
    if (w.key === FOLDED_LETTER_WORLD_KEY) return state.foldedLetterGateOpen === true || state.currentWorld === FOLDED_LETTER_WORLD_KEY;
    if (w.key === LONG_MORNING_WORLD_KEY) return state.longMorningGateOpen === true || state.currentWorld === LONG_MORNING_WORLD_KEY;
    if (w.key === YARD_WORLD_KEY) return state.yardGateOpen === true || state.currentWorld === YARD_WORLD_KEY;
    if (w.key === SIEGE_WORLD_KEY) return state.siegeGateOpen === true || state.currentWorld === SIEGE_WORLD_KEY;
    if (w.key === UNMADE_WORLD_KEY) return state.unmadeGateOpen === true || state.currentWorld === UNMADE_WORLD_KEY;
    if (w.key === VILLAGE_WORLD_KEY) return state.villageGateOpen === true || state.currentWorld === VILLAGE_WORLD_KEY;
    if (w.key === ROAD_WORLD_KEY) return state.roadGateOpen === true || state.currentWorld === ROAD_WORLD_KEY;
    if (w.key === FADED_WARD_WORLD_KEY) return state.wardGateOpen === true || state.currentWorld === FADED_WARD_WORLD_KEY;
    if (w.gated) return state.eternityReachable === true;
    return true;
  });
  return chart.map((w) => {
    const isCurrent = state.currentWorld === w.key;
    return {
      world: w.key,
      name: w.name,
      blurb: w.blurb,
      isCurrent,
      options: isCurrent ? [] : [option("warp", state.currentWorld, w.key, state.fuel.fuel), option("drift", state.currentWorld, w.key, state.fuel.fuel)],
    };
  });
}
