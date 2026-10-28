/**
 * Fleets on automated missions — the shared contract.
 *
 * Fleets fly from home to the worlds on automated missions — bounded,
 * free, and short (15–60 minutes). A mission is a journey flown by a
 * fleet ship: the travel ledger's shape (depart → transit → arrive,
 * server authority, idempotent) with a fleet pilot. The server owns
 * every decision and every outcome; the client renders what the server
 * returns.
 *
 * This module is only the vocabulary both sides agree on: the mission
 * kinds, the states, the destinations, the fleet, and the client
 * shapes.
 *
 * What is deliberately NOT here (current brief, crew choices AD1–AD6,
 * reversible, never the owner's settlement):
 * - Pricing: missions are FREE. `futureFuelCost` below is the hook
 *   where an expedition price lands later, without rework — it is not
 *   charged today, and fuel never gates access.
 * - Charting and keeping kinds: cut. Charting's reward (faster warps)
 *   would change travel times beyond missions, and keeping places
 *   keepsakes — writes beyond mission row + log line, which the
 *   current brief forbids. Both can follow as a later increment.
 * - Computed suggestions: deferred. The dispatch form + send tap IS
 *   propose-for-yes — nothing dispatches without the tap.
 * - The Growing Place and Deep Past as destinations: both are private
 *   worlds, off-limits to defense-style play. Destinations are the
 *   Great Station, Scale, the People, and Quiet/Archive.
 */

/**
 * Mission kinds. Two ship in this increment:
 * - journey: go, arrive, log a plain-words arrival line, return,
 *   complete.
 * - scouting: go, observe verified facts only, log the report as a
 *   log line, return, complete.
 */
export type MissionKind = "journey" | "scouting";

export const MISSION_KINDS: readonly MissionKind[] = ["journey", "scouting"] as const;

/**
 * Mission states — the travel ledger's shape, with a fleet pilot:
 * outbound (in transit out) → arrived (working at the destination) →
 * returning (in transit home) → completed | failed | recalled.
 * A mission is terminal once completed, failed, or recalled.
 * Plain-words labels live in the panel: out, at the world, returning
 * home, home, returned empty-handed, returned without its outcome.
 */
export type MissionState = "outbound" | "arrived" | "returning" | "completed" | "failed" | "recalled";

export const MISSION_ACTIVE_STATES: readonly MissionState[] = ["outbound", "arrived", "returning"] as const;

export const MISSION_TERMINAL_STATES: readonly MissionState[] = ["completed", "failed", "recalled"] as const;

/** The fleet is moored at home; every mission flies home → world → home. */
export const MISSION_ORIGIN = "home";

/**
 * Mission destinations (AD4): the Great Station, Scale, the People,
 * and Quiet/Archive. Home is the origin, never a destination. The
 * Growing Place and Deep Past are excluded — both private, off-limits
 * to defense-style play.
 */
export const MISSION_DESTINATIONS: readonly string[] = [
  "great-station",
  "scale",
  "people",
  "quiet-archive",
] as const;

/**
 * The mission fleet: the 11 Quaternius traffic hulls already flying
 * as ambient traffic. The WATO is NOT in the dispatch pool — it is the
 * recognizable regular, one singular ship, and dispatching it as a
 * generic fleet hull would dilute it. No new GLB: every hull here is
 * already in the app.
 */
export const MISSION_FLEET_SHIPS: readonly string[] = [
  "bob",
  "challenger",
  "dispatcher",
  "executioner",
  "imperial",
  "insurgent",
  "omen",
  "pancake",
  "spitfire",
  "striker",
  "zenith",
] as const;

/** Bounds. Owner-set at dispatch. Durations are short and
 *  session-scale (AD3): 15–60 minutes, three equal legs. No multi-day
 *  timers, nothing expires or decays. */
export const MISSION_MIN_FLEET_SIZE = 1;
export const MISSION_MAX_FLEET_SIZE = 3;
export const MISSION_MIN_DURATION_MINUTES = 15;
export const MISSION_MAX_DURATION_MINUTES = 60;
/** At most this many missions out at once. */
export const MISSION_MAX_ACTIVE = 3;
/** At most one active mission per destination. */
export const MISSION_MAX_ACTIVE_PER_DESTINATION = 1;

/**
 * Pricing hook (AD1): missions are FREE today. When expedition
 * pricing lands, the formula goes here — this is the single place a
 * price is computed, so the dispatch path, the price preview, and the
 * stored cost all change together. Until then it returns 0, and
 * `missionDispatchCost` returns 0 with it. Fuel never gates access.
 */
export function futureFuelCost(_fleetSize: number, _durationMinutes: number): number {
  return 0;
}

/** Dispatch price: free. See `futureFuelCost` for the pricing hook. */
export function missionDispatchCost(fleetSize: number, durationMinutes: number): number {
  return futureFuelCost(fleetSize, durationMinutes);
}

/** One mission, as the client sees it. Times are ISO strings (server
 *  storage); the client renders them in the viewer's own local time. */
export interface Mission {
  id: string;
  clientKey: string;
  kind: MissionKind;
  destination: string;
  origin: string;
  fleetSize: number;
  /** The hull keys flying this mission, in dispatch order. */
  ships: string[];
  durationMinutes: number;
  /** Always 0 today — missions are free (AD1). */
  fuelCost: number;
  state: MissionState;
  createdAt: string;
  departedAt: string | null;
  arriveAt: string | null;
  returnAt: string | null;
  completedAt: string | null;
  /** Plain-words outcome — what happened, or null while underway. */
  outcome: string | null;
  /** The scouting report, when this mission is a completed scout. */
  report: string | null;
}

/** One append-only mission-log entry: every dispatch, arrival, work
 *  step, return, failure, and recall, with its cause in plain language
 *  — so anyone can ask "why did it do that?" and get an answer. */
export interface MissionLogEntry {
  id: number;
  missionId: string | null;
  kind: string;
  /** What happened, in plain words. */
  act: string;
  /** Why, in plain words. */
  cause: string;
  createdAt: string;
}

/** Everything the Fleets panel needs, in one read. */
export interface MissionsOverview {
  missions: Mission[];
  fleetStopped: boolean;
  fuel: { fuel: number; capacity: number };
  log: MissionLogEntry[];
}
