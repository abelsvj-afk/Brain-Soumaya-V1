import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A restartable "quiet window" (UX review #3): `quiet` turns true when `start(ms)`
 * is called and false `ms` later; calling `start` again restarts the window.
 * Used for the Performance Mode offer (45 s after the Welcome card, 30 s after a
 * memory is added). Extracted from App so the timers are unit-testable.
 */
export function useQuietWindow(): [boolean, (ms: number) => void] {
  const [quiet, setQuiet] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useCallback((ms: number) => {
    setQuiet(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setQuiet(false);
    }, ms);
  }, []);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return [quiet, start];
}

/** Longest a brand-new user's routine toasts are held while they haven't added anything yet. */
export const FIRST_RUN_TOAST_HOLD_MAX_MS = 180_000;

/**
 * Reviewer r2 (#173): about a minute into a first run, Soumaya's routine toasts
 * (a Captain's Log decision, Eternity's daily word, "N more in your Inbox")
 * stacked above the first-star cue and, on phones, over the top of the Add
 * sheet. While `eligible` (first run: Welcome closed, the user has added nothing
 * yet) this returns true, so App holds normal-priority toasts (they still go to
 * the Inbox and are released afterwards). It turns false as soon as `eligible`
 * does (the first memory lands) or after `maxMs`, so a user who never adds
 * anything still gets them.
 */
export function useFirstRunToastHold(eligible: boolean, maxMs = FIRST_RUN_TOAST_HOLD_MAX_MS): boolean {
  const [expired, setExpired] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    // Armed once, the first time a first run starts; it keeps running even if
    // eligibility flickers, so the hold can never outlast the cap.
    if (!eligible || timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => setExpired(true), maxMs);
  }, [eligible, maxMs]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);
  return eligible && !expired;
}
