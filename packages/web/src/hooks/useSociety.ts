import { useCallback, useEffect, useRef, useState } from "react";
import { societyDay, type SocietyDay } from "@brain/shared";
import { getSociety, setSocietyReflect } from "../api/society.js";

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Today's society for this brain (docs/specs/npc-hive-society-2026-10-30.md). Always returns something: until the read lands, or if it fails, a neutral society — the
 * world is alive either way. Re-reads hourly (the server caches for ten minutes). `setReflect` is the opt-out switch.
 */
export function useSociety(enabled: boolean = true): {
  society: SocietyDay;
  reflect: boolean;
  loaded: boolean;
  setReflect: (on: boolean) => Promise<void>;
} {
  const [state, setState] = useState<{ society: SocietyDay; reflect: boolean; loaded: boolean }>(() => ({ society: societyDay(null, localDay()), reflect: true, loaded: false }));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const r = await getSociety();
    if (!alive.current) return;
    if (r) setState({ society: r.society, reflect: r.reflect, loaded: true });
    else setState((s) => ({ ...s, loaded: true }));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const t = window.setInterval(() => void load(), 60 * 60_000);
    return () => window.clearInterval(t);
  }, [enabled, load]);
  const setReflect = useCallback(async (on: boolean) => {
    const r = await setSocietyReflect(on);
    if (r && alive.current) setState({ society: r.society, reflect: r.reflect, loaded: true });
  }, []);
  return { ...state, setReflect };
}
