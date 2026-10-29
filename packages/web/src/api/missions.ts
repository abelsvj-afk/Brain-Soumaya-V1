import type { Mission, MissionKind, MissionsOverview } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Fleet missions client — a thin binding over the server loop. The
 * server owns every outcome: the settle, the report, the stop switch.
 * This module transports requests and returns the server's state
 * verbatim; it computes nothing about missions. Errors arrive from
 * the server in plain language and are surfaced as-is, with their
 * code preserved for UI logic. Missions are free: there is no
 * insufficient-fuel path.
 */

export class MissionClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MissionClientError";
  }
}

interface MissionsResponse {
  mission?: Mission;
  overview?: MissionsOverview;
  error?: string;
  code?: string;
}

function errFrom(status: number, data: MissionsResponse | null): MissionClientError {
  if (status === 404) {
    return new MissionClientError("NOT_FOUND", "That mission couldn't be found.");
  }
  return new MissionClientError(
    data?.code ?? "MISSION_REQUEST_FAILED",
    data?.error ?? "That didn't go through — please try again.",
  );
}

function overviewFrom(data: MissionsResponse | null): MissionsOverview | null {
  return data?.overview ?? null;
}

/** The fleets overview — reading it settles missions lazily on the
 *  server, so what it returns is current. Null when the brain is
 *  unreachable. */
export async function getMissions(): Promise<MissionsOverview | null> {
  try {
    const res = await afetch(`${API}/missions`);
    if (!res.ok) return null;
    const d = (await res.json()) as MissionsOverview;
    return d && Array.isArray(d.missions) ? d : null;
  } catch {
    return null;
  }
}

export interface DispatchMissionInput {
  clientKey: string;
  kind: MissionKind;
  destination: string;
  durationMinutes: number;
  fleetSize: number;
}

/** Dispatch a mission — the approve step. Returns the mission and the
 *  fresh overview. */
export async function dispatchMission(input: DispatchMissionInput): Promise<{
  mission: Mission;
  overview: MissionsOverview;
}> {
  const res = await afetch(`${API}/missions/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => null)) as MissionsResponse | null;
  if (!res.ok || !data?.mission || !data?.overview) throw errFrom(res.status, data);
  return { mission: data.mission, overview: data.overview };
}

/** Recall a mission in flight. */
export async function recallMission(id: string): Promise<{
  mission: Mission;
  overview: MissionsOverview;
}> {
  const res = await afetch(`${API}/missions/${encodeURIComponent(id)}/recall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as MissionsResponse | null;
  if (!res.ok || !data?.mission || !data?.overview) throw errFrom(res.status, data);
  return { mission: data.mission, overview: data.overview };
}

/** Stop the fleet — it dispatches nothing while stopped. */
export async function stopFleet(): Promise<MissionsOverview | null> {
  const res = await afetch(`${API}/missions/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as MissionsResponse | null;
  if (!res.ok) throw errFrom(res.status, data);
  return overviewFrom(data);
}

/** Start the fleet again. */
export async function resumeFleet(): Promise<MissionsOverview | null> {
  const res = await afetch(`${API}/missions/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as MissionsResponse | null;
  if (!res.ok) throw errFrom(res.status, data);
  return overviewFrom(data);
}
