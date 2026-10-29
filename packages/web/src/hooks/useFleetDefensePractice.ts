import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTick,
  composeWave,
  validLane,
  type FleetDefenseInvader,
  type FleetDefenseReleaseSize,
  type FleetDefenseStatus,
  type FleetDefenseTickMode,
} from "@brain/shared";

/**
 * Scale practice (Fleet Defense, practice mode) — the SAME defense
 * loop, staged in Scale Space, as ephemeral client state.
 *
 * This hook imports NO api module and performs NO network call, by
 * construction: a practice round cannot offer, summon, clear, log,
 * or write anything, because it never talks to the server. The
 * board math is the shared engine (`advanceTick` over a composed
 * wave); the round lives only in this hook's state and is gone when
 * it ends or the panel closes. Losing a practice round costs
 * nothing, exactly like losing a real defense — and winning one
 * clears nothing, earns nothing, and saves nothing.
 *
 * Auto-play mirrors the real defense: Soumaya takes a round on her
 * own every few seconds while on, one tick at a time, never under
 * reduced motion, and it stops when the round resolves.
 */

const AUTOPLAY_MS = 2500;

export interface FleetDefensePracticeState {
  size: FleetDefenseReleaseSize;
  status: FleetDefenseStatus;
  invaders: FleetDefenseInvader[];
  tickCount: number;
  lastMode: FleetDefenseTickMode | null;
  lastLine: string | null;
}

/** The practice outcome in plain words — never the real-defense
 *  codex line, because a practice win clears nothing. */
export function practiceOutcomeLine(status: FleetDefenseStatus): string | null {
  if (status === "won") {
    return "Practice complete — the practice fleet dispersed. Nothing was released, nothing was cleared, nothing was saved. That was only practice.";
  }
  if (status === "lost") {
    return "Practice over — the practice fleet got through. Nothing was lost, nothing changed, nothing was saved. Try again any time — that was only practice.";
  }
  return null;
}

export interface UseFleetDefensePractice {
  practice: FleetDefensePracticeState | null;
  autoPlay: boolean;
  setAutoPlay: (on: boolean) => void;
  start: (size: FleetDefenseReleaseSize) => void;
  tick: (mode: FleetDefenseTickMode, lane?: number) => void;
  end: () => void;
}

export function useFleetDefensePractice(): UseFleetDefensePractice {
  const [practice, setPractice] = useState<FleetDefensePracticeState | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const tickingRef = useRef(false);

  const start = useCallback((size: FleetDefenseReleaseSize) => {
    setAutoPlay(false);
    setPractice({
      size,
      status: "active",
      invaders: composeWave(size),
      tickCount: 0,
      lastMode: null,
      lastLine: null,
    });
  }, []);

  const tick = useCallback((mode: FleetDefenseTickMode, lane?: number) => {
    setPractice((prev) => {
      if (!prev || prev.status !== "active") return prev;
      if (mode === "helm" && !validLane(lane)) return prev;
      const result = advanceTick(prev.invaders, { mode, lane }, { practice: true });
      return {
        ...prev,
        status: result.status,
        invaders: result.invaders,
        tickCount: prev.tickCount + 1,
        lastMode: mode,
        lastLine: result.line,
      };
    });
  }, []);

  const end = useCallback(() => {
    setAutoPlay(false);
    setPractice(null);
  }, []);

  // Auto-play: same shape as the real defense's — one tick at a
  // time, never under reduced motion, stops when the round resolves.
  const status = practice?.status ?? null;
  useEffect(() => {
    if (!autoPlay || !practice || status !== "active") return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const iv = window.setInterval(() => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      tick("autonomous");
      tickingRef.current = false;
    }, AUTOPLAY_MS);
    return () => window.clearInterval(iv);
  }, [autoPlay, practice, status, tick]);

  // A resolved round ends auto-play — she stops when the fleet disperses.
  useEffect(() => {
    if (status !== null && status !== "active") setAutoPlay(false);
  }, [status]);

  return { practice, autoPlay, setAutoPlay, start, tick, end };
}
