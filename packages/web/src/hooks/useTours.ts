import { useCallback, useEffect, useRef, useState } from "react";
import { announceTravelChanged } from "../lib/travelEvents.js";
import type { Tour, TourMoveResult, TourSessionView, TourSuggestion, TravelKind } from "@brain/shared";
import {
  advanceTour,
  createTour,
  deleteTour,
  getTourSession,
  getTourSuggestions,
  getTours,
  leaveTour,
  renameTour,
  restoreTour,
  startTour,
  ToursClientError,
} from "../api/tours.js";

/**
 * Tours state binding (Wave 2, N7). Owns the client side of the tours
 * contract honestly:
 *
 * - The server is the only authority. This hook renders the server's
 *   state, refreshes it after every action, and adopts whatever the
 *   server returns — it never walks, charges, or arrives locally.
 * - While a tour is playing, the session is re-read on a slow poll so
 *   an arrived leg advances the stop without the traveler having to
 *   ask. The poll reads only; the server settles the leg lazily.
 * - Errors arrive from the server in plain language and are kept as
 *   the hook's error line — the panel shows the server's words, never
 *   a paraphrase.
 */

const SESSION_POLL_MS = 3000;

export interface ToursState {
  tours: Tour[] | null;
  suggestions: TourSuggestion[] | null;
  session: TourSessionView | null;
  loading: boolean;
  /** The server's plain-language error from the last failed action, or null. */
  error: string | null;
}

export function useTours(enabled = true) {
  const [state, setState] = useState<ToursState>({
    tours: null,
    suggestions: null,
    session: null,
    loading: enabled,
    error: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const [tours, suggestions, session] = await Promise.all([
        getTours(),
        getTourSuggestions(),
        getTourSession(),
      ]);
      setState((s) => ({ ...s, tours: tours.tours, suggestions: suggestions.suggestions, session: session.session, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof ToursClientError ? e.message : "Tours couldn't load — your tours are unaffected.",
      }));
    }
  }, [enabled]);

  const refreshSession = useCallback(async () => {
    if (!enabled) return;
    try {
      const { session } = await getTourSession();
      setState((s) => ({ ...s, session }));
    } catch {
      /* a failed poll leaves the last good session on screen; the next poll retries */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // While a tour plays, re-read the session so an arrived leg advances
  // the stop. The poll is read-only; the server does the settling.
  useEffect(() => {
    if (!enabled || state.session?.session.state !== "playing") return;
    const id = window.setInterval(() => void refreshSession(), SESSION_POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refreshSession, state.session?.session.state]);

  const act = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        const out = await fn();
        setState((s) => ({ ...s, error: null }));
        return out;
      } catch (e) {
        setState((s) => ({
          ...s,
          error: e instanceof ToursClientError ? e.message : "That didn't go through — please try again.",
        }));
        return null;
      }
    },
    [],
  );

  const create = useCallback(
    async (journeyId: number, title?: string) => {
      const out = await act(() => createTour(journeyId, title));
      if (out) await refresh();
      return out;
    },
    [act, refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const out = await act(() => renameTour(id, title));
      if (out) await refresh();
      return out;
    },
    [act, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const out = await act(() => deleteTour(id));
      if (out) await refresh();
      return out;
    },
    [act, refresh],
  );

  const restore = useCallback(
    async (id: string) => {
      const out = await act(() => restoreTour(id));
      if (out) await refresh();
      return out;
    },
    [act, refresh],
  );

  const start = useCallback(
    async (id: string, kind: TravelKind = "drift"): Promise<TourMoveResult | null> => {
      const out = await act(() => startTour(id, kind));
      if (out) {
        setState((s) => ({ ...s, session: out.session }));
        announceTravelChanged("depart"); // a tour leg is a journey: the scene layer must hear it
      }
      return out;
    },
    [act],
  );

  const advance = useCallback(
    async (id: string, kind: TravelKind = "drift"): Promise<TourMoveResult | null> => {
      const out = await act(() => advanceTour(id, kind));
      if (out) {
        setState((s) => ({ ...s, session: out.session }));
        announceTravelChanged("depart");
      }
      return out;
    },
    [act],
  );

  const leave = useCallback(
    async (id: string) => {
      const out = await act(() => leaveTour(id));
      if (out) setState((s) => ({ ...s, session: out.session }));
      return out;
    },
    [act],
  );

  return { ...state, refresh, create, rename, remove, restore, start, advance, leave };
}

export type UseTours = ReturnType<typeof useTours>;
