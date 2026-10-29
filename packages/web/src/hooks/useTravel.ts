import { useCallback, useEffect, useRef, useState } from "react";
import type { TravelJourney, TravelKind } from "@brain/shared";
import {
  arriveJourney,
  cancelJourney,
  departJourney,
  getTravelState,
  TravelClientError,
  turnBackJourney,
  type TravelBonus,
  type TravelState,
} from "../api/travel.js";

/**
 * Travel state binding (Phase 2, P2-3). Owns the client side of the
 * P2-2 contract honestly:
 *
 * - The server is the only authority. This hook renders the server's
 *   state, refreshes it after every action, and adopts whatever the
 *   server returns — it never settles, charges, or arrives locally.
 * - The cancel countdown is derived from the server-issued deadline
 *   for DISPLAY only; whether a cancel is free is the server's answer.
 * - The departure key identifies one departure intent. It is generated
 *   once, persisted across retries (a double-tap, a lost response), and
 *   retired when the intent resolves — so a retry replays to the
 *   original journey and a new intent never collides with an old one.
 * - "Traversed routes" (for the skip-after-first-traversal rule) is
 *   client-side presentation memory only: it decides whether a Skip
 *   affordance appears, and nothing else.
 */

const KEY_STORAGE = "worlds.departureKey";
const KEY_JOURNEY_STORAGE = "worlds.departureJourneyId";
const TRAVERSED_STORAGE = "worlds.traversedRoutes";
const ARMING_POLL_MS = 2000;
/** Fired after any travel ACTION settles, so every mounted copy of this
 *  hook (the travel panel, the world scene layer, the world map) re-reads
 *  the server. Each copy keeps its own state; before this they never heard
 *  about each other, so a departure from the panel was invisible to the
 *  scene layer — no transit flight, no arrival — until a page reload. The
 *  server stays the only authority; this only says "go look again". */
const TRAVEL_CHANGED_EVENT = "worlds:travel-changed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — retries still work in-session via the ref */
  }
}
function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}
function traversedRoutes(): string[] {
  try {
    const raw = localStorage.getItem(TRAVERSED_STORAGE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const routeKey = (origin: string, destination: string) => `${origin}>${destination}`;

/** Traversed routes as origin/destination pairs — the client's discovery
 *  record (the same record the skip rule reads). The world map draws
 *  discovered worlds and routes from this; it fetches nothing new. */
export function readTraversedRoutes(): { origin: string; destination: string }[] {
  return traversedRoutes()
    .map((r) => r.split(">"))
    .filter(
      (p): p is [string, string] =>
        p.length === 2 && p[0] !== undefined && p[0] !== "" && p[1] !== undefined && p[1] !== "",
    )
    .map(([origin, destination]) => ({ origin, destination }));
}

const TERMINAL: ReadonlySet<string> = new Set(["arrived", "returned", "cancelled"]);

export interface UseTravel {
  state: TravelState | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Seconds left in the cancel window — display only, server decides. */
  cancelSecondsLeft: number | null;
  /** The bonus outcome of the most recent arrival, exactly as the
   *  server recorded it (P2-4) — null until an arrival happens, and
   *  cleared when a new journey departs. Display only. */
  lastBonus: TravelBonus | null;
  refresh: () => Promise<void>;
  depart: (kind: TravelKind, destination: string) => Promise<TravelJourney | null>;
  cancel: () => Promise<TravelJourney | null>;
  turnBack: () => Promise<TravelJourney | null>;
  arrive: () => Promise<TravelJourney | null>;
  hasTraversed: (origin: string, destination: string) => boolean;
}

export function useTravel(enabled: boolean = true): UseTravel {
  const [state, setState] = useState<TravelState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBonus, setLastBonus] = useState<TravelBonus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const keyRef = useRef<string | null>(read(KEY_STORAGE));
  const stateRef = useRef<TravelState | null>(null);
  stateRef.current = state;

  const clearKey = useCallback(() => {
    keyRef.current = null;
    write(KEY_STORAGE, null);
    write(KEY_JOURNEY_STORAGE, null);
  }, []);

  /** Retire the departure key once its intent has resolved: its journey
   *  is gone, was superseded by another, or reached a terminal state. */
  const reconcile = useCallback(
    (s: TravelState) => {
      const keyJourneyId = read(KEY_JOURNEY_STORAGE);
      if (!keyJourneyId) return;
      const active = s.activeJourney;
      if (!active || active.id !== keyJourneyId || TERMINAL.has(active.state)) clearKey();
    },
    [clearKey],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const s = await getTravelState();
    if (s) {
      setState(s);
      reconcile(s);
      setError(null);
    } else {
      setError("Can't reach the brain right now — travel state may be out of date.");
    }
    setLoading(false);
  }, [enabled, reconcile]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // Another copy of this hook acted: re-read. The acting copy already
  // refreshed itself (its event carries its own tag), so it skips its echo.
  const selfTag = useRef(Math.random().toString(36).slice(2));
  useEffect(() => {
    if (!enabled) return;
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<{ from?: string }>).detail?.from === selfTag.current) return;
      void refresh();
    };
    window.addEventListener(TRAVEL_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(TRAVEL_CHANGED_EVENT, onChanged);
  }, [enabled, refresh]);

  // While a journey is arming, poll so the window's close (settlement)
  // shows up promptly, and tick the display countdown. Presentation
  // only — the server settles regardless of this hook.
  const arming = state?.activeJourney?.state === "arming";
  useEffect(() => {
    if (!enabled || !arming) return;
    // The countdown reads nowMs, which is only kept fresh while arming — so
    // it must be refreshed the instant arming begins, or the first frames
    // show a countdown computed from a stale clock (seen as "49s left").
    setNowMs(Date.now());
    const poll = window.setInterval(() => void refresh(), ARMING_POLL_MS);
    const tick = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [enabled, arming, refresh]);

  const act = useCallback(
    async (fn: () => Promise<TravelJourney>): Promise<TravelJourney | null> => {
      setBusy(true);
      setError(null);
      try {
        const journey = await fn();
        // Arrivals are observed here, in the action's own return — a
        // finished journey no longer appears as the active journey in
        // state. Record the route as traversed (presentation memory).
        if (journey.state === "arrived") {
          const rk = routeKey(journey.origin, journey.destination);
          const routes = traversedRoutes();
          if (!routes.includes(rk)) write(TRAVERSED_STORAGE, JSON.stringify([...routes, rk]));
        }
        await refresh();
        window.dispatchEvent(new CustomEvent(TRAVEL_CHANGED_EVENT, { detail: { from: selfTag.current } }));
        return journey;
      } catch (e) {
        if (e instanceof TravelClientError) {
          if (e.code === "ACTIVE_JOURNEY_EXISTS") {
            // A different journey is active — our intent never began,
            // so its key must not shadow the next intent. Adopt the
            // server's state first (a successful refresh clears errors),
            // then surface this message last so it survives.
            clearKey();
            await refresh();
          }
          setError(e.message);
        } else {
          setError("That didn't go through — please try again.");
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, clearKey],
  );

  const depart = useCallback(
    (kind: TravelKind, destination: string) => {
      setLastBonus(null); // a new journey retires the last arrival's outcome
      if (!keyRef.current) {
        keyRef.current = newKey();
        write(KEY_STORAGE, keyRef.current);
        write(KEY_JOURNEY_STORAGE, null);
      }
      const clientKey = keyRef.current;
      return act(async () => {
        const journey = await departJourney({ clientKey, kind, destination });
        write(KEY_JOURNEY_STORAGE, journey.id);
        return journey;
      });
    },
    [act],
  );

  const withActive = useCallback(
    (fn: (id: string) => Promise<TravelJourney>) => {
      const id = stateRef.current?.activeJourney?.id;
      if (!id) return Promise.resolve(null);
      return act(() => fn(id));
    },
    [act],
  );

  const cancel = useCallback(async () => {
    const j = await withActive(cancelJourney);
    if (j) clearKey();
    return j;
  }, [withActive, clearKey]);
  const turnBack = useCallback(() => withActive(turnBackJourney), [withActive]);
  // Arrival additionally captures the server's bonus outcome from the
  // response sibling (P2-4) — the panel renders it verbatim.
  const arrive = useCallback(async () => {
    const id = stateRef.current?.activeJourney?.id;
    if (!id) return null;
    return act(async () => {
      const r = await arriveJourney(id);
      setLastBonus(r.bonus);
      return r.journey;
    });
  }, [act]);

  const hasTraversed = useCallback(
    (origin: string, destination: string) => traversedRoutes().includes(routeKey(origin, destination)),
    [],
  );

  const deadline = state?.activeJourney?.cancellable
    ? Date.parse(state.activeJourney.cancelDeadline)
    : NaN;
  const cancelSecondsLeft =
    arming && Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - nowMs) / 1000)) : null;

  return {
    state,
    loading,
    busy,
    error,
    cancelSecondsLeft,
    lastBonus,
    refresh,
    depart,
    cancel,
    turnBack,
    arrive,
    hasTraversed,
  };
}
