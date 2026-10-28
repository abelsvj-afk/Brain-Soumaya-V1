import { useCallback, useEffect, useState } from "react";
import type { MissionKind, MissionsOverview } from "@brain/shared";
import {
  dispatchMission,
  getMissions,
  MissionClientError,
  recallMission,
  resumeFleet,
  stopFleet,
  type DispatchMissionInput,
} from "../api/missions.js";

/**
 * Fleet missions state binding. Owns the client side of the missions
 * contract honestly:
 *
 * - The server is the only authority. This hook renders the server's
 *   state, refreshes it after every action, and adopts whatever the
 *   server returns — it never dispatches, settles, or prices locally.
 * - Reading the overview settles missions lazily on the server; the
 *   hook does not poll.
 * - A failed load is an offline state with a retry — never an empty
 *   panel, which would lie about whether the fleet is there.
 */

export interface UseFleetMissions {
  overview: MissionsOverview | null;
  loading: boolean;
  failed: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  dispatch: (input: Omit<DispatchMissionInput, "clientKey">) => Promise<void>;
  recall: (id: string) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
}

export function useFleetMissions(enabled: boolean): UseFleetMissions {
  const [overview, setOverview] = useState<MissionsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setFailed(false);
    try {
      const state = await getMissions();
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

  const adopt = useCallback((next: MissionsOverview | null) => {
    if (next) setOverview(next);
  }, []);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof MissionClientError ? e.message : "That didn't go through — please try again.");
  }, []);

  const dispatch = useCallback(
    async (input: Omit<DispatchMissionInput, "clientKey">) => {
      setError(null);
      try {
        const result = await dispatchMission({
          ...input,
          clientKey:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
        adopt(result.overview);
      } catch (e) {
        fail(e);
      }
    },
    [adopt, fail],
  );

  const recall = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const result = await recallMission(id);
        adopt(result.overview);
      } catch (e) {
        fail(e);
      }
    },
    [adopt, fail],
  );

  const stop = useCallback(async () => {
    setError(null);
    try {
      adopt(await stopFleet());
    } catch (e) {
      fail(e);
    }
  }, [adopt, fail]);

  const resume = useCallback(async () => {
    setError(null);
    try {
      adopt(await resumeFleet());
    } catch (e) {
      fail(e);
    }
  }, [adopt, fail]);

  return { overview, loading, failed, error, refresh, dispatch, recall, stop, resume };
}

export type { MissionKind };
