import { useCallback, useEffect, useState } from "react";
import { getRelicsState, getRelicPreview, holdRelic, unholdRelic, releaseRelic, type RelicPreview } from "../api/relics.js";
import type { RelicsStateView } from "@brain/shared";

/** Server-owned relic state for the blessings panel + worlds seams. */
export function useRelicBuffs(enabled: boolean = true) {
  const [state, setState] = useState<RelicsStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comet, setComet] = useState<{ relicId: string; name: string } | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const s = await getRelicsState();
    if (s) { setState(s); setError(null); } else setError("Can't reach your brain right now — blessings may be out of date.");
  }, [enabled]);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  const preview = useCallback(async (relicId: string): Promise<RelicPreview | null> => getRelicPreview(relicId), []);
  const hold = useCallback(async (relicId: string) => { const out = await holdRelic(relicId); if (out.state) setState(out.state); if (!out.ok) setError(out.error ?? "That didn't go through."); return out.ok; }, []);
  const unhold = useCallback(async (relicId: string) => { const out = await unholdRelic(relicId); if (out.state) setState(out.state); if (!out.ok) setError(out.error ?? "That didn't go through."); return out.ok; }, []);
  const release = useCallback(async (relicId: string) => {
    const out = await releaseRelic(relicId);
    if (out.state) setState(out.state);
    if (!out.ok) { setError(out.error ?? "That didn't go through."); return false; }
    if (out.comet) setComet(out.comet as { relicId: string; name: string });
    return true;
  }, []);
  return { state, error, refresh, preview, hold, unhold, release, comet, showComet: setComet, dismissComet: () => setComet(null) };
}
