import { useEffect, useRef } from "react";
import type { CodexEntry } from "./codex.js";
import { claimCodexReward } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * REG-047 (PG-04): Codex discovery claiming, at App level — not panel level.
 *
 * The claim effect used to live only inside CodexPanel, which mounts only when
 * the user opens Progress → Codex: discoveries sat unannounced and unpaid
 * until a panel visit, then arrived days late in a burst (capped at 4 toasts).
 * This hook runs the same effect wherever it is mounted — App mounts it
 * globally, so a discovery is announced and its reward claimed at the moment
 * it first becomes true (or at next app open, attributed to what caused it),
 * on any surface. The Codex panel mounts the same hook with its full entry
 * list (graph + field notes); opening the panel afterwards shows no backlog
 * burst, because both instances share one seen-store (`codex.seen.<spaceId>`)
 * and one module-level in-flight set.
 *
 * IM-93 discipline (unchanged): an entry is marked seen ONLY once its claim
 * has settled successfully — a failed claim leaves it fresh so the fuel can
 * still be claimed on a later visit, and the failure surfaces as a toast.
 */
const claimingKeys = new Set<string>();

export function useCodexDiscoveryClaims(
  entries: CodexEntry[],
  spaceId: string | undefined | null,
  onReward?: () => void,
): { seenRef: React.RefObject<Set<string>> } {
  const seenRef = useRef<Set<string>>(new Set());
  const claimingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!spaceId) return;
    const key = `codex.seen.${spaceId}`;
    const atKey = `codex.seenAt.${spaceId}`;
    let seen: Set<string>;
    try {
      seen = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      seen = new Set();
    }
    seenRef.current = seen;
    const fresh = entries.filter(
      (e) => e.discovered && !seen.has(e.id) && !claimingRef.current.has(e.id) && !claimingKeys.has(`${spaceId}:${e.id}`),
    );
    if (fresh.length === 0) return;
    for (const e of fresh) {
      claimingRef.current.add(e.id);
      claimingKeys.add(`${spaceId}:${e.id}`);
    }
    for (const e of fresh.slice(0, 4)) {
      pushToast(`Codex: discovered “${e.title}”`, "📖", 6000, "high");
    }
    let cancelled = false;
    void (async () => {
      let failed = 0;
      const nowIso = new Date().toISOString();
      const newTimes: Record<string, string> = {};
      for (const e of fresh) {
        try {
          const r = await claimCodexReward(e.id);
          if (r?.failed) {
            failed++;
          } else {
            seen.add(e.id);
            newTimes[e.id] = nowIso;
            // `claimCodexReward` is async, so the chime has to fire from inside
            // this callback — checking a flag synchronously after the loop (as
            // before) always read it as false.
            if (r?.awarded) {
              onReward?.();
              playSfx("achievement");
            }
          }
        } catch {
          failed++;
        } finally {
          claimingRef.current.delete(e.id);
          claimingKeys.delete(`${spaceId}:${e.id}`);
        }
      }
      try {
        localStorage.setItem(key, JSON.stringify([...seen]));
        if (Object.keys(newTimes).length > 0) {
          let merged: Record<string, string> = {};
          try {
            merged = JSON.parse(localStorage.getItem(atKey) || "{}") as Record<string, string>;
          } catch {
            merged = {};
          }
          for (const [id, at] of Object.entries(newTimes)) if (!merged[id]) merged[id] = at;
          try {
            localStorage.setItem(atKey, JSON.stringify(merged));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      if (!cancelled && failed > 0) {
        pushToast(
          `Codex: ${failed} reward claim${failed === 1 ? "" : "s"} didn't go through — will retry on your next visit`,
          "⛽",
          6000,
          "high",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, spaceId]);

  return { seenRef };
}
