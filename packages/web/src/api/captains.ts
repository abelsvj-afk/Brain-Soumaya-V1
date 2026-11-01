import type { CaptainQuestionKind, CaptainState, ChronicleLine } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Captain client (NPC-Player Layer L1) — a thin binding over the
 * server engine, in the harbor controller client's grammar
 * (api/npcs.ts). The server owns every outcome: the advance, the
 * answers, the budgets, the kill switch. This module transports
 * requests and returns the server's state verbatim; it computes
 * nothing about captain behavior. Errors arrive from the server in
 * plain language and are surfaced as-is, with their code preserved.
 */

export class CaptainClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CaptainClientError";
  }
}

export interface CaptainAskResult {
  captain: CaptainState;
  answer: string;
}

interface CaptainsListResponse {
  captains?: CaptainState[];
  error?: string;
  code?: string;
}

interface CaptainResponse {
  captain?: CaptainState;
  state?: CaptainState;
  answer?: string;
  error?: string;
  code?: string;
}

interface ChronicleResponse {
  lines?: ChronicleLine[];
  error?: string;
  code?: string;
}

function errFrom(status: number, data: CaptainResponse | null): CaptainClientError {
  if (status === 404) {
    return new CaptainClientError("NOT_FOUND", "That captain couldn't be found.");
  }
  return new CaptainClientError(
    data?.code ?? "CAPTAIN_REQUEST_FAILED",
    data?.error ?? "That didn't go through — please try again.",
  );
}

/** The roster with state, or null when the brain is unreachable.
 *  Reading the roster advances the active captains on the server
 *  (lazily — there is no timer there either). */
export async function getCaptains(): Promise<CaptainState[] | null> {
  try {
    const res = await afetch(`${API}/captains`);
    if (!res.ok) return null;
    const d = (await res.json()) as CaptainsListResponse;
    return Array.isArray(d?.captains) ? d.captains : null;
  } catch {
    return null;
  }
}

/** One captain's state (advances her first, server-side). */
export async function getCaptain(id: string): Promise<CaptainState | null> {
  try {
    const res = await afetch(`${API}/captains/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as CaptainResponse;
    return d?.captain ?? null;
  } catch {
    return null;
  }
}

/** The Chronicle feed — harbor + captain acts, newest first. Null
 *  when the brain is unreachable. */
export async function getChronicle(limit = 30): Promise<ChronicleLine[] | null> {
  try {
    const res = await afetch(`${API}/captains/chronicle?limit=${limit}`);
    if (!res.ok) return null;
    const d = (await res.json()) as ChronicleResponse;
    return Array.isArray(d?.lines) ? d.lines : null;
  } catch {
    return null;
  }
}

/** Ask a captain one of the L1 questions. Returns her answer. */
export async function askCaptain(id: string, question: CaptainQuestionKind): Promise<CaptainAskResult> {
  const res = await afetch(`${API}/captains/${encodeURIComponent(id)}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = (await res.json().catch(() => null)) as CaptainResponse | null;
  if (!res.ok || !data?.state || typeof data.answer !== "string") throw errFrom(res.status, data);
  return { captain: data.state, answer: data.answer };
}

async function captainAction(id: string, action: "stop" | "resume" | "wipe-meetings" | "reset"): Promise<CaptainState> {
  const res = await afetch(`${API}/captains/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as CaptainResponse | null;
  if (!res.ok || !data?.captain) throw errFrom(res.status, data);
  return data.captain;
}

/** Stop a captain (the kill switch). A stopped captain does nothing. */
export async function stopCaptain(id: string): Promise<CaptainState> {
  return captainAction(id, "stop");
}

/** Resume a stopped captain. */
export async function resumeCaptain(id: string): Promise<CaptainState> {
  return captainAction(id, "resume");
}

/** Wipe her memory of meeting you — the next meeting is a first. */
export async function wipeCaptainMeetings(id: string): Promise<CaptainState> {
  return captainAction(id, "wipe-meetings");
}

/** Reset a purpose captain entirely (P2 §6.2): her P2 stores,
 *  holdings, gate record, memory, and state are wiped; her next
 *  advance starts her fresh. */
export async function resetCaptain(id: string): Promise<CaptainState> {
  return captainAction(id, "reset");
}
