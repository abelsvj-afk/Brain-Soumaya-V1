import { API, afetch, DEFAULT_TIMEOUT_MS } from "./http.js";
import type { Journey, JourneyLink, JourneyLinkKind, JourneyLinksDetail, JourneySuggestions } from "@brain/shared";

/**
 * Journeys client (Vision 2.0). Thin wrappers over /api/journeys; space-scoped server-side.
 * A Journey is a life chapter; we LINK objects to it (never copy). Offline-safe (guard on null).
 */

async function getJson<T>(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  try { const res = await afetch(`${API}/journeys${path}`, {}, timeoutMs); return res.ok ? ((await res.json()) as T) : null; } catch { return null; }
}
async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await afetch(`${API}/journeys${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) return null;
    const out = (await res.json()) as T;
    // A journey change (create/progress/status/link) → refresh the galaxy's Journey hubs.
    try { window.dispatchEvent(new Event("brain-journeys-changed")); } catch { /* no window */ }
    return out;
  } catch { return null; }
}

export const getJourneys = (timeoutMs: number = DEFAULT_TIMEOUT_MS) => getJson<Journey[]>("/", timeoutMs);
export const getJourney = (id: number) => getJson<Journey & { links: JourneyLink[] }>(`/${id}`);
export interface JourneyInput { title: string; description?: string; color?: string; icon?: string; startedAt?: string | null; endedAt?: string | null }
export const createJourney = (j: JourneyInput) => send<Journey>("/", "POST", j);
export const patchJourney = (id: number, patch: Partial<JourneyInput> & { status?: "active" | "paused" | "done"; progress?: number }) => send<Journey>(`/${id}`, "PATCH", patch);
export const deleteJourney = (id: number) => send<{ ok: boolean }>(`/${id}`, "DELETE");
export const linkToJourney = (id: number, kind: JourneyLinkKind, refId: number) => send<JourneyLink>(`/${id}/link`, "POST", { kind, refId });
export const unlinkFromJourney = (id: number, kind: JourneyLinkKind, refId: number) => send<{ ok: boolean }>(`/${id}/unlink`, "POST", { kind, refId });
export const journeysFor = (kind: JourneyLinkKind, refId: number) => getJson<Journey[]>(`/for/${kind}/${refId}`);
export const suggestJourneys = (kind: JourneyLinkKind, refId: number) => getJson<JourneySuggestions>(`/suggest/${kind}/${refId}`);
export const journeyLinks = (id: number) => getJson<JourneyLinksDetail>(`/${id}/links`);
