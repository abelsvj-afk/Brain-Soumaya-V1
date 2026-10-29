import { useEffect } from "react";
import { getEternityPresence } from "../api/npcs.js";
import { pushToast } from "../components/Toasts.js";
import { presenceIntensity, presenceToast } from "../graph/eternityPresenceToast.js";

/**
 * Eternity's presence in the home galaxy (spec §2d/§2e). Reads it once, a while after the app opens (so it never stacks on
 * the first-run screens — audit X1), lights his halo in the sky (Graph3D listens for `eternity:presence`), and posts at most
 * ONE toast per day. Silent on any failure.
 */
export const PRESENCE_DELAY_MS = 15_000;
const SHOWN_KEY = "eternity.presence.shown";

export function useEternityPresence(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      const p = await getEternityPresence();
      if (!alive || !p) return;
      window.dispatchEvent(
        new CustomEvent("eternity:presence", { detail: p.stopped ? { visible: false } : { intensity: presenceIntensity(p) } }),
      );
      const toast = presenceToast(p);
      if (!toast) return;
      let shown: string | null = null;
      try {
        shown = localStorage.getItem(SHOWN_KEY);
      } catch {
        /* storage blocked — show it; worst case it shows again on the next open today */
      }
      if (shown === p.dayKey) return;
      pushToast(toast.text, "✦", 12_000, "normal", toast.action);
      try {
        localStorage.setItem(SHOWN_KEY, p.dayKey);
      } catch {
        /* ignore */
      }
    }, PRESENCE_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled]);
}
