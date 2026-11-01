import { useCallback, useEffect, useState } from "react";
import { getRelicsState, getRelicPreview, holdRelic, unholdRelic, releaseRelic, storeRelic, carryRelic, exchangeRelic, type RelicPreview, type RelicExchangeOption } from "../api/relics.js";
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
  // Relics I-7: store/carry + the exchange, on the same state discipline —
  // the server's answer (state included) is the only truth the panel shows.
  const store = useCallback(async (relicId: string) => { const out = await storeRelic(relicId); if (out.state) setState(out.state); if (!out.ok) setError(out.error ?? "That didn't go through."); return out.ok; }, []);
  const carry = useCallback(async (relicId: string) => { const out = await carryRelic(relicId); if (out.state) setState(out.state); if (!out.ok) setError(out.error ?? "That didn't go through."); return out.ok; }, []);
  const exchange = useCallback(async (relicId: string, option: RelicExchangeOption, chartTargetRelicId: string | null = null) => {
    const attemptKey = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `exchange-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const out = await exchangeRelic(relicId, option, chartTargetRelicId, attemptKey);
    if (out.state) setState(out.state);
    if (!out.ok) { setError(out.error ?? "That didn't go through."); return out; }
    return out;
  }, []);
  return { state, error, refresh, preview, hold, unhold, release, store, carry, exchange, comet, showComet: setComet, dismissComet: () => setComet(null) };
}
