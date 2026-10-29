import type { NpcQuestionKind, NpcState } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * NPC autonomy client (Wave 2) — a thin binding over the server loop.
 * The server owns every outcome: the tick, the answer, the budgets,
 * the kill switch. This module transports requests and returns the
 * server's state verbatim; it computes nothing about NPC behavior.
 * Errors arrive from the server in plain language and are surfaced
 * as-is, with their code preserved for UI logic.
 */

export class NpcClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NpcClientError";
  }
}

export interface NpcAskResult {
  npc: NpcState;
  /** The controller's spoken answer, or null when it said nothing. */
  answer: string | null;
}

interface NpcsListResponse {
  npcs?: NpcState[];
  error?: string;
  code?: string;
}

interface NpcResponse {
  npc?: NpcState;
  answer?: string | null;
  error?: string;
  code?: string;
}

function errFrom(status: number, data: NpcResponse | null): NpcClientError {
  if (status === 404) {
    return new NpcClientError("NOT_FOUND", "That NPC couldn't be found.");
  }
  return new NpcClientError(
    data?.code ?? "NPC_REQUEST_FAILED",
    data?.error ?? "That didn't go through — please try again.",
  );
}

/** The roster with state, or null when the brain is unreachable. */
export async function getNpcs(): Promise<NpcState[] | null> {
  try {
    const res = await afetch(`${API}/npcs`);
    if (!res.ok) return null;
    const d = (await res.json()) as NpcsListResponse;
    return Array.isArray(d?.npcs) ? d.npcs : null;
  } catch {
    return null;
  }
}

/**
 * One NPC's state — reading it runs one lazy autonomous tick on the
 * server (throttled there), so a refresh storm never becomes a tick
 * storm. Null when the brain is unreachable.
 */
export async function getNpc(id: string): Promise<NpcState | null> {
  try {
    const res = await afetch(`${API}/npcs/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as NpcResponse;
    return d?.npc ?? null;
  } catch {
    return null;
  }
}

/** Ask the controller a question. Returns its spoken answer. */
export async function askNpc(id: string, question: NpcQuestionKind): Promise<NpcAskResult> {
  const res = await afetch(`${API}/npcs/${encodeURIComponent(id)}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = (await res.json().catch(() => null)) as NpcResponse | null;
  if (!res.ok || !data?.npc) throw errFrom(res.status, data);
  return { npc: data.npc, answer: data.answer ?? null };
}

/** Stop an NPC (the kill switch). A stopped NPC does nothing. */
export async function stopNpc(id: string): Promise<NpcState> {
  const res = await afetch(`${API}/npcs/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as NpcResponse | null;
  if (!res.ok || !data?.npc) throw errFrom(res.status, data);
  return data.npc;
}

/** Resume a stopped NPC. */
export async function resumeNpc(id: string): Promise<NpcState> {
  const res = await afetch(`${API}/npcs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => null)) as NpcResponse | null;
  if (!res.ok || !data?.npc) throw errFrom(res.status, data);
  return data.npc;
}

/** Eternity phase 2c: turn his messages (app inbox + Telegram) off or on. */
export async function setNpcContactMuted(id: string, muted: boolean): Promise<NpcState> {
  const res = await afetch(`${API}/npcs/${encodeURIComponent(id)}/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ muted }),
  });
  const data = (await res.json().catch(() => null)) as NpcResponse | null;
  if (!res.ok || !data?.npc) throw errFrom(res.status, data);
  return data.npc;
}
