import { API, afetch } from "./http.js";
import type {
  Tour,
  TourCreateResult,
  TourMoveResult,
  TourSessionView,
  TourSuggestion,
  TravelKind,
} from "@brain/shared";

/**
 * Guided tours client (Wave 2, N7) — a thin binding over the server
 * contract. The server owns every outcome: which stops a tour walks,
 * which leg carries the traveler, and where the tour waits. This module
 * transports requests and returns the server's views verbatim; it
 * computes nothing about routes, legs, or timing. Errors arrive from
 * the server in plain language and are surfaced as-is, with their code
 * preserved for UI logic.
 */

export class ToursClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToursClientError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await afetch(`${API}/tours${path}`, {});
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok || !data) {
    throw new ToursClientError(
      data?.code ?? "TOURS_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  return data;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await afetch(`${API}/tours${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok || !data) {
    throw new ToursClientError(
      data?.code ?? "TOURS_REQUEST_FAILED",
      data?.error ?? "That didn't go through — please try again.",
    );
  }
  return data;
}

export const getTours = () => getJson<{ tours: Tour[] }>("/");
export const getTourSuggestions = () => getJson<{ suggestions: TourSuggestion[] }>("/suggestions");
export const getTourSession = () => getJson<{ session: TourSessionView | null }>("/session");

export const createTour = (journeyId: number, title?: string) =>
  send<TourCreateResult>("/", "POST", title ? { journeyId, title } : { journeyId });
export const renameTour = (id: string, title: string) => send<{ tour: Tour }>(`/${id}`, "PATCH", { title });
export const deleteTour = (id: string) => send<{ ok: boolean }>(`/${id}`, "DELETE");
export const restoreTour = (id: string) => send<{ tour: Tour }>(`/${id}/restore`, "POST");
export const startTour = (id: string, kind: TravelKind = "drift") =>
  send<TourMoveResult>(`/${id}/start`, "POST", { kind });
export const advanceTour = (id: string, kind: TravelKind = "drift") =>
  send<TourMoveResult>(`/${id}/advance`, "POST", { kind });
export const leaveTour = (id: string) => send<{ session: TourSessionView }>(`/${id}/leave`, "POST");
