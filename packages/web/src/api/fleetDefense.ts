import type {
  FleetDefenseOverview,
  FleetDefenseRelease,
  FleetDefenseReleaseKind,
  FleetDefenseReleaseSize,
  FleetDefenseState,
  FleetDefenseTickMode,
} from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Fleet defense client (Wave 2) — a thin binding over the server
 * defense. The server owns every outcome: the offer, the summoning,
 * the board, the win and the loss. This module transports requests
 * and returns the server's state verbatim; it computes nothing about
 * the defense. Errors arrive from the server in plain language and
 * are surfaced as-is, with their code preserved for UI logic.
 */

export class FleetDefenseClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FleetDefenseClientError";
  }
}

export interface OfferReleaseInput {
  kind: FleetDefenseReleaseKind;
  size: FleetDefenseReleaseSize;
  label: string;
  nodeId?: number | null;
}

interface OverviewResponse {
  overview?: FleetDefenseOverview;
  error?: string;
  code?: string;
}

interface ReleaseResponse {
  release?: FleetDefenseRelease;
  error?: string;
  code?: string;
}

interface DefenseResponse {
  defense?: FleetDefenseState;
  error?: string;
  code?: string;
}

function errFrom(status: number, data: ReleaseResponse | DefenseResponse | null): FleetDefenseClientError {
  if (status === 404) {
    return new FleetDefenseClientError(
      data?.code ?? "NOT_FOUND",
      data?.error ?? "That isn't here.",
    );
  }
  return new FleetDefenseClientError(
    data?.code ?? "FLEET_DEFENSE_REQUEST_FAILED",
    data?.error ?? "That didn't go through — please try again.",
  );
}

/** The overview — releases, the active defense, history, recent log — or null when the brain is unreachable. */
export async function getFleetDefenseOverview(): Promise<FleetDefenseOverview | null> {
  try {
    const res = await afetch(`${API}/fleet-defense`);
    if (!res.ok) return null;
    const d = (await res.json()) as OverviewResponse;
    return d?.overview ?? null;
  } catch {
    return null;
  }
}

/** Offer a release — the explicit marking a defense starts from. */
export async function offerFleetDefenseRelease(input: OfferReleaseInput): Promise<FleetDefenseRelease> {
  const res = await afetch(`${API}/fleet-defense/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => null)) as ReleaseResponse | null;
  if (!res.ok || !data?.release) throw errFrom(res.status, data);
  return data.release;
}

/** Summon the fleet for an offered release. */
export async function startFleetDefense(releaseId: number): Promise<FleetDefenseState> {
  const res = await afetch(`${API}/fleet-defense/releases/${releaseId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as DefenseResponse | null;
  if (!res.ok || !data?.defense) throw errFrom(res.status, data);
  return data.defense;
}

/** Play one tick — Soumaya on her own, or you at the helm down a lane. */
export async function tickFleetDefense(
  defenseId: number,
  mode: FleetDefenseTickMode,
  lane?: number,
): Promise<FleetDefenseState> {
  const res = await afetch(`${API}/fleet-defense/defenses/${defenseId}/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, lane }),
  });
  const data = (await res.json().catch(() => null)) as DefenseResponse | null;
  if (!res.ok || !data?.defense) throw errFrom(res.status, data);
  return data.defense;
}
