import { useCallback, useEffect, useState } from "react";
import type { CaptainQuestionKind, CaptainState, ChronicleLine } from "@brain/shared";
import {
  CaptainClientError,
  askCaptain,
  getCaptains,
  getChronicle,
  resetCaptain,
  resumeCaptain,
  stopCaptain,
  wipeCaptainMeetings,
} from "../api/captains.js";

/**
 * Captains state binding (NPC-Player Layer L1), in the harbor
 * controller hook's discipline:
 *
 * - The server is the only authority. This hook renders the
 *   server's state, refreshes it after every action, and adopts
 *   whatever the server returns — it never advances, answers, or
 *   stops a captain locally.
 * - Reading the roster advances captains on the server (lazily);
 *   the hook does not poll.
 * - A failed load is an offline state with a retry — never an
 *   empty panel, which would lie about whether they are there.
 */

export interface UseCaptains {
  captains: CaptainState[] | null;
  chronicle: ChronicleLine[] | null;
  /** The last spoken answer, keyed by captain id. */
  answers: ReadonlyMap<string, string>;
  loading: boolean;
  failed: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  ask: (id: string, question: CaptainQuestionKind) => Promise<void>;
  stop: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  wipeMeetings: (id: string) => Promise<void>;
  reset: (id: string) => Promise<void>;
}

export function useCaptains(enabled: boolean, withChronicle: boolean): UseCaptains {
  const [captains, setCaptains] = useState<CaptainState[] | null>(null);
  const [chronicle, setChronicle] = useState<ChronicleLine[] | null>(null);
  const [answers, setAnswers] = useState<ReadonlyMap<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setFailed(false);
    try {
      const [list, lines] = await Promise.all([
        getCaptains(),
        withChronicle ? getChronicle(30) : Promise.resolve(null),
      ]);
      if (!list) {
        setFailed(true);
      } else {
        setCaptains(list);
        if (withChronicle) setChronicle(lines);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [enabled, withChronicle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const adopt = useCallback((updated: CaptainState) => {
    setCaptains((prev) => (prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated]));
  }, []);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
        // Actions can age the feed; refresh it when it is shown.
        if (withChronicle) {
          const lines = await getChronicle(30);
          if (lines) setChronicle(lines);
        }
      } catch (e) {
        setError(e instanceof CaptainClientError ? e.message : "That didn't go through — please try again.");
      }
    },
    [withChronicle],
  );

  const ask = useCallback(
    async (id: string, question: CaptainQuestionKind) => {
      await run(async () => {
        const out = await askCaptain(id, question);
        adopt(out.captain);
        setAnswers((prev) => new Map(prev).set(id, out.answer));
      });
    },
    [run, adopt],
  );

  const stop = useCallback(
    async (id: string) => {
      await run(async () => adopt(await stopCaptain(id)));
    },
    [run, adopt],
  );

  const resume = useCallback(
    async (id: string) => {
      await run(async () => adopt(await resumeCaptain(id)));
    },
    [run, adopt],
  );

  const wipeMeetings = useCallback(
    async (id: string) => {
      await run(async () => adopt(await wipeCaptainMeetings(id)));
    },
    [run, adopt],
  );

  const reset = useCallback(
    async (id: string) => {
      await run(async () => adopt(await resetCaptain(id)));
    },
    [run, adopt],
  );

  return { captains, chronicle, answers, loading, failed, error, refresh, ask, stop, resume, wipeMeetings, reset };
}
