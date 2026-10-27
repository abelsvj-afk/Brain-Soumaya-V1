import { ETERNITY_WORLD_KEY, WARP_COST, type TravelKind } from "@brain/shared";
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

/** Fuel the server charges for one leg of this kind to this destination —
 *  the server's own price (WARP_COST), displayed only; the server
 *  settles. Warp home and drift are always free. The world map reads the
 *  same price, so the board and the map can never disagree. */
export function routeLegCost(kind: TravelKind, destination: string): number {
  return destination === "home" || kind === "drift" ? 0 : WARP_COST;
}

function option(kind: TravelKind, world: string, balance: number): RouteOption {
  const cost = routeLegCost(kind, world);
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
      options: isCurrent ? [] : [option("warp", w.key, state.fuel.fuel), option("drift", w.key, state.fuel.fuel)],
    };
  });
}
