import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FleetDefenseOverview,
  FleetDefenseTickMode,
} from "@brain/shared";
import {
  FleetDefenseClientError,
  getFleetDefenseOverview,
  offerFleetDefenseRelease,
  startFleetDefense,
  tickFleetDefense,
  type OfferReleaseInput,
} from "../api/fleetDefense.js";

/**
 * Fleet defense state binding (Wave 2). Owns the client side of the
 * defense contract honestly:
 *
 * - The server is the only authority. This hook renders the server's
 *   state, refreshes it after every action, and adopts whatever the
 *   server returns — it never offers, summons, or ticks locally.
 * - A failed load is an offline state with a retry — never an empty
 *   panel, which would lie about whether the defense is there.
 * - Auto-play ("she plays on her own") is a client-side interval
 *   calling the same tick endpoint Soumaya's button calls; the
 *   server stays lazy and tick-less. It never starts under reduced
 *   motion — there, every round is a tap, and the board is the same.
 */

const AUTOPLAY_MS = 2500;

export interface UseFleetDefense {
  overview: FleetDefenseOverview | null;
  loading: boolean;
  failed: boolean;
  error: string | null;
  /** Soumaya plays a round on her own every few seconds while on. */
  autoPlay: boolean;
  setAutoPlay: (on: boolean) => void;
  refresh: () => Promise<void>;
  offer: (input: OfferReleaseInput) => Promise<void>;
  start: (releaseId: number) => Promise<void>;
  tick: (mode: FleetDefenseTickMode, lane?: number) => Promise<void>;
}

export function useFleetDefense(enabled: boolean): UseFleetDefense {
  const [overview, setOverview] = useState<FleetDefenseOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const activeDefenseId = overview?.activeDefense?.id ?? null;
  const activeStatus = overview?.activeDefense?.status ?? null;
  const tickingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setFailed(false);
    try {
      const state = await getFleetDefenseOverview();
      if (!state) {
        setFailed(true);
      } else {
        setOverview(state);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const offer = useCallback(async (input: OfferReleaseInput) => {
    setError(null);
    try {
      await offerFleetDefenseRelease(input);
      await refresh();
    } catch (e) {
      setError(e instanceof FleetDefenseClientError ? e.message : "That didn't go through — please try again.");
    }
  }, [refresh]);

  const start = useCallback(async (releaseId: number) => {
    setError(null);
    try {
      await startFleetDefense(releaseId);
      await refresh();
    } catch (e) {
      setError(e instanceof FleetDefenseClientError ? e.message : "That didn't go through — please try again.");
    }
  }, [refresh]);

  const tick = useCallback(async (mode: FleetDefenseTickMode, lane?: number) => {
    setError(null);
    const id = activeDefenseId;
    if (id === null) return;
    try {
      await tickFleetDefense(id, mode, lane);
      // The server's refreshed overview is the truth — the tick
      // returns the board, but the refresh re-reads releases,
      // history, and the log in the same shape the panel renders.
      await refresh();
    } catch (e) {
      setError(e instanceof FleetDefenseClientError ? e.message : "That didn't go through — please try again.");
    }
  }, [activeDefenseId, refresh]);

  // Auto-play: Soumaya takes a round on her own while it is on and a
  // defense is active. One tick at a time — a tick in flight blocks
  // the next, so a slow network never stacks rounds. Reduced motion
  // never auto-plays: every round is a tap there, same board.
  useEffect(() => {
    if (!autoPlay || activeDefenseId === null || activeStatus !== "active") return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const iv = window.setInterval(() => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      void tick("autonomous").finally(() => {
        tickingRef.current = false;
      });
    }, AUTOPLAY_MS);
    return () => window.clearInterval(iv);
  }, [autoPlay, activeDefenseId, activeStatus, tick]);

  // A resolved defense ends auto-play — she stops when the fleet disperses.
  useEffect(() => {
    if (activeStatus !== null && activeStatus !== "active") setAutoPlay(false);
  }, [activeStatus]);

  return { overview, loading, failed, error, autoPlay, setAutoPlay, refresh, offer, start, tick };
}
