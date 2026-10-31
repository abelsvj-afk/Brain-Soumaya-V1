import type { Fuel, TravelJourney, TravelKind } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Worlds travel client (Phase 2, P2-3) — a thin binding over the P2-2
 * server contract. The server owns every outcome: timing, charges, and
 * state transitions. This module transports requests and returns the
 * server's journey view verbatim; it computes nothing about money or
 * timing. Errors arrive from the server in plain language and are
 * surfaced as-is, with their code preserved for UI logic.
 */

export interface TravelState {
  currentWorld: string;
  activeJourney: TravelJourney | null;
  fuel: Fuel;
  /**
   * Whether the People gate is open (P3-3, Q1) — the server's verdict,
   * from its travel state. Absent on older servers: the board treats a
   * missing flag as closed (fail closed, never guess the gate open).
   */
  peopleGateOpen?: boolean;
  /** Whether the gate to Eternity's world stands open for this
   *  traveller (opened before, or the holdings satisfy B-01 now).
   *  Absent on an older server — the board then hides the gated
   *  world, never offers a journey the server would refuse. */
  eternityReachable?: boolean;
  /** Whether the way to the Faded Ward stands open (the ward found in the People world) — the server's verdict; absent on an older server (read as closed). */
  wardGateOpen?: boolean;
  /** Whether the way to the Road to the Seam stands open (Teru's Harbor Nail found) — the server's verdict; absent on an older server (read as closed). */
  roadGateOpen?: boolean;
  /** Whether the way to the Village stands open (the Thread of Many found) — the server's verdict; absent on an older server (read as closed). */
  villageGateOpen?: boolean;
}

/**
 * The server's recorded bonus outcome for one arrival (P2-4). The
 * client displays bonus state ONLY from this payload — never from its
 * own inference (GH-19). `reason` is the server's plain-language
 * explanation when nothing was paid (a gated drift), else null.
 */
export interface TravelBonus {
  credited: boolean;
  amount: number;
  balance: number;
  reason: string | null;
}

export interface ArriveResult {
  journey: TravelJourney;
  bonus: TravelBonus;
}

const NO_BONUS: TravelBonus = { credited: false, amount: 0, balance: 0, reason: null };

export class TravelClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TravelClientError";
  }
}

interface TravelResponse {
  journey?: TravelJourney;
  bonus?: TravelBonus;
  error?: string;
  code?: string;
}

async function postData(path: string, body: Record<string, unknown>): Promise<TravelResponse> {
  const res = await afetch(`${API}/travel/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as TravelResponse | null;
  if (!res.ok || !data?.journey) {
    if (res.status === 404) {
      throw new TravelClientError("NOT_FOUND", "That journey couldn't be found.");
    }
    throw new TravelClientError(
      data?.code ?? "TRAVEL_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  return data;
}

async function post(path: string, body: Record<string, unknown>): Promise<TravelJourney> {
  return (await postData(path, body)).journey!;
}

/** Current travel state, or null when the brain is unreachable (callers
 *  show a distinct offline state rather than guessing). */
export async function getTravelState(): Promise<TravelState | null> {
  try {
    const res = await afetch(`${API}/travel/state`);
    if (!res.ok) return null;
    const d = (await res.json()) as TravelState;
    return typeof d?.currentWorld === "string" && d?.fuel ? d : null;
  } catch {
    return null;
  }
}

/** The app opened at home but the server still has the traveller out in a world: ask it to
 *  write the free way home. Returns whether it changed anything; false on any failure. */
export async function recallHome(): Promise<boolean> {
  try {
    const res = await afetch(`${API}/travel/recall-home`, { method: "POST" });
    if (!res.ok) return false;
    const d = (await res.json()) as { recalled?: boolean };
    return d.recalled === true;
  } catch {
    return false;
  }
}

/**
 * Depart. `clientKey` identifies the departure INTENT: the caller
 * generates it once per intent and reuses it across retries, so a
 * retried request returns the original journey (the server's replay
 * contract, F-01-hardened) instead of departing twice.
 */
export function departJourney(input: {
  clientKey: string;
  kind: TravelKind;
  destination: string;
}): Promise<TravelJourney> {
  return post("depart", { ...input });
}

/** Cancel while the window is open (free) — after departure the server
 *  returns the journey's honest current state instead of an error. */
export function cancelJourney(journeyId: string): Promise<TravelJourney> {
  return post("cancel", { journeyId });
}

/** Turn back mid-transit: no refund, no second charge; the journey ends
 *  when it arrives back. */
export function turnBackJourney(journeyId: string): Promise<TravelJourney> {
  return post("turn-back", { journeyId });
}

/** Arrive. The server rejects arrival before actual departure and
 *  returns the committed state for a retried arrival — plus the bonus
 *  outcome it recorded for that arrival (P2-4), which is the only
 *  bonus state the UI may show. A response without the sibling (an
 *  older server) reads as no bonus, never as an invented one. */
export async function arriveJourney(journeyId: string): Promise<ArriveResult> {
  const data = await postData("arrive", { journeyId });
  return { journey: data.journey!, bonus: data.bonus ?? NO_BONUS };
}
