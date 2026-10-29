import { useCallback, useEffect, useState } from "react";
import type { NpcQuestionKind, NpcState } from "@brain/shared";
import { askNpc, getNpc, NpcClientError, resumeNpc, stopNpc } from "../api/npcs.js";

/**
 * Harbor controller state binding (Wave 2, NPC autonomy). Owns the
 * client side of the NPC contract honestly:
 *
 * - The server is the only authority. This hook renders the server's
 *   state, refreshes it after every action, and adopts whatever the
 *   server returns — it never ticks, answers, or stops locally.
 * - Reading the controller runs one lazy autonomous tick on the server
 *   (throttled there); the hook does not poll.
 * - A failed load is an offline state with a retry — never an empty
 *   panel, which would lie about whether the controller is there.
 */

export const HARBOR_CONTROLLER_ID = "harbor-controller";

export interface UseHarborController {
  npc: NpcState | null;
  /** The last spoken answer (an ask, or the welcome on arrival). */
  answer: string | null;
  loading: boolean;
  failed: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  ask: (question: NpcQuestionKind) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => Promise<void>;
}

export function useHarborController(enabled: boolean): UseHarborController {
  const [npc, setNpc] = useState<NpcState | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setFailed(false);
    try {
      const state = await getNpc(HARBOR_CONTROLLER_ID);
      if (!state) {
        setFailed(true);
      } else {
        setNpc(state);
        // The welcome is the newest speak in the log — surface it as
        // the answer so an arrival greets the visitor on entry. Only
        // a FRESH speak counts: an answer from an earlier visit is
        // history, not a greeting.
        const latestSpeak = state.recentLog.find((e) => e.kind === "speak");
        if (latestSpeak && Date.now() - Date.parse(latestSpeak.createdAt) <= 10 * 60 * 1000) {
          setAnswer(latestSpeak.act);
        }
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

  const ask = useCallback(async (question: NpcQuestionKind) => {
    setError(null);
    try {
      const result = await askNpc(HARBOR_CONTROLLER_ID, question);
      setNpc(result.npc);
      if (result.answer) setAnswer(result.answer);
    } catch (e) {
      setError(e instanceof NpcClientError ? e.message : "That didn't go through — please try again.");
    }
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    try {
      setNpc(await stopNpc(HARBOR_CONTROLLER_ID));
    } catch (e) {
      setError(e instanceof NpcClientError ? e.message : "That didn't go through — please try again.");
    }
  }, []);

  const resume = useCallback(async () => {
    setError(null);
    try {
      setNpc(await resumeNpc(HARBOR_CONTROLLER_ID));
    } catch (e) {
      setError(e instanceof NpcClientError ? e.message : "That didn't go through — please try again.");
    }
  }, []);

  return { npc, answer, loading, failed, error, refresh, ask, stop, resume };
}
