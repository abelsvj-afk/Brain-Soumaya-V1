import { useEffect, useState } from "react";
import { getSpacePreferences } from "../api/preferences.js";

/**
 * The SPACE's configured timezone — the ONE shared accessor every web day
 * derivation goes through (audit-2 item 2; owner TIMEZONE RULE: every
 * user-perceivable day boundary follows the space's CONFIGURED timezone,
 * never the device zone once the configured zone is known).
 *
 * The configured zone lives server-side in space_meta and is read through
 * `getSpacePreferences()` — the same store Settings' picker writes and
 * Telegram preferences share. This module caches it process-wide:
 *
 * - `ensureSpaceTimeZoneLoaded()` fetches it at most once at a time
 *   (shared in-flight promise); a failed/empty load leaves the cache
 *   unset so a later call (e.g. after sign-in) may retry.
 * - `getSpaceTimeZone()` is the synchronous getter derivations use: the
 *   configured zone once loaded, and ONLY before that the device zone —
 *   the pre-load fallback, never a maintained source of truth.
 * - `useSpaceTimeZone()` is the React face: it kicks off the load and
 *   re-renders the component when the configured zone arrives or changes.
 * - `setSpaceTimeZone()` is the write-through: Settings calls it with the
 *   zone it loaded / just saved, so a Settings change refreshes every
 *   derivation without a reload.
 */

let cachedZone: string | null = null;
let inFlight: Promise<string> | null = null;
const listeners = new Set<() => void>();

/** This device's own IANA zone — the pre-load fallback ONLY. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isUsableZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** Subscribe to configured-zone changes; returns the unsubscribe fn. */
export function subscribeSpaceTimeZone(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The zone every derivation should use right now: the space's configured
 * zone once known, otherwise (pre-load only) the device zone.
 */
export function getSpaceTimeZone(): string {
  return cachedZone ?? deviceTimeZone();
}

/** The configured zone itself, or null while it has not loaded yet. */
export function getConfiguredSpaceTimeZone(): string | null {
  return cachedZone;
}

/**
 * Record the configured zone (Settings load/save write-through). Invalid
 * or empty values are ignored — a bad write must never poison every day
 * derivation in the app.
 */
export function setSpaceTimeZone(zone: string | null | undefined): void {
  const next = typeof zone === "string" ? zone.trim() : "";
  if (!next || !isUsableZone(next) || next === cachedZone) return;
  cachedZone = next;
  notify();
}

/**
 * Load the configured zone from the server store, sharing one in-flight
 * request across all callers. Resolves with the effective zone (the
 * device zone when the load fails or the store is unreachable — callers
 * keep working, and a later call may retry because a failed load does
 * not latch).
 */
export function ensureSpaceTimeZoneLoaded(): Promise<string> {
  if (cachedZone) return Promise.resolve(cachedZone);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const prefs = await getSpacePreferences();
      if (prefs?.timezone) setSpaceTimeZone(prefs.timezone);
    } catch {
      /* getSpacePreferences already fail-softs to null; belt and braces */
    } finally {
      inFlight = null;
    }
    return getSpaceTimeZone();
  })();
  return inFlight;
}

/**
 * React hook: the effective space timezone for this render. Triggers the
 * shared load on mount and re-renders when the configured zone arrives
 * or is changed in Settings, so day derivations drawn from it (quest
 * keys, Chronicle buckets, streak "today", …) correct themselves in
 * place instead of waiting for a remount.
 */
export function useSpaceTimeZone(): string {
  const [zone, setZone] = useState<string>(() => getSpaceTimeZone());
  useEffect(() => {
    const unsubscribe = subscribeSpaceTimeZone(() => setZone(getSpaceTimeZone()));
    void ensureSpaceTimeZoneLoaded();
    return unsubscribe;
  }, []);
  return zone;
}

/** Test-only: clear the cached zone + in-flight load back to pre-load. */
export function resetSpaceTimeZoneForTests(): void {
  cachedZone = null;
  inFlight = null;
  notify();
}
