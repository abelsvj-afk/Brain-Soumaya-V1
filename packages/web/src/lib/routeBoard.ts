import { WARP_COST, type TravelKind } from "@brain/shared";
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
 */
export const WORLD_CHART: readonly { key: string; name: string; blurb: string }[] = [
  { key: "home", name: "Home", blurb: "Your galaxy — every memory, always here." },
  {
    key: "great-station",
    name: "The Great Station",
    blurb: "The home port: journeys and routes begin here.",
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

function option(kind: TravelKind, world: string, balance: number): RouteOption {
  const cost = world === "home" || kind === "drift" ? 0 : WARP_COST;
  return {
    kind,
    label: kind === "warp" ? "Warp" : "Drift",
    cost,
    affordable: balance >= cost,
  };
}

export function buildRouteBoard(state: TravelState): RouteEntry[] {
  return WORLD_CHART.map((w) => {
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
