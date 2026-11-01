import { useEffect, useState } from "react";
import { getRelicsState, syncLegacyRelics } from "../api/relics.js";

/**
 * Found relics — the per-space record of which relics the traveler has
 * found in their worlds. Same shape as the Codex seen-store
 * (`codex.seen.<spaceId>`): localStorage, keyed by space, with a
 * `brain-relic-found` window event so every mount (the worlds surface,
 * the Codex panel, App's global claim hook) refreshes from the same
 * write. The store holds Codex keys (`relic-<slug>`), so it plugs
 * straight into `buildCodex({ foundRelics })`.
 *
 * The find is the client-side half of discovery; the server-side half
 * is the inscription — the existing codex-claim flow records it in
 * `codex_claims` and grants the one-time fuel reward the moment the
 * entry becomes discovered.
 */

export function loadFoundRelics(spaceId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`relics.found.${spaceId}`) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function markRelicFound(spaceId: string, key: string): void {
  const found = loadFoundRelics(spaceId);
  if (found.has(key)) return;
  found.add(key);
  try {
    localStorage.setItem(`relics.found.${spaceId}`, JSON.stringify([...found]));
  } catch {
    /* a full or blocked store must not break the find */
  }
  try {
    window.dispatchEvent(new CustomEvent("brain-relic-found", { detail: { key } }));
  } catch {
    /* no window (tests) — the store itself still holds the find */
  }
}

/** Same contents, ignoring order — a reload that finds nothing new keeps the old Set. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of b) if (!a.has(k)) return false;
  return true;
}

/**
 * The found set for one space, live: reloads when a find lands (the
 * `brain-relic-found` event) or the space changes. A reload that finds
 * nothing new returns the SAME Set object — the identity is load-bearing:
 * CodexPanel and App memo their entry lists on this set, and the claim
 * hook re-runs (cancelling its in-flight loop, including its failure
 * toast) whenever the entries identity changes. A spurious new Set on
 * mount used to cancel the loop's toast — a real regression, caught by
 * CodexPanel.test.tsx — so the guard below is the fix, not an optimization.
 */
export function useFoundRelics(spaceId: string | undefined | null): Set<string> {
  const [found, setFound] = useState<Set<string>>(() =>
    spaceId ? loadFoundRelics(spaceId) : new Set(),
  );
  useEffect(() => {
    if (!spaceId) return;
    void refreshFoundRelicsFromServer(spaceId);
    // Reload after mount (another surface may have found one since this
    // hook's initializer ran), but keep the old reference when nothing
    // changed — no re-render, no claim-loop cancellation.
    setFound((prev) => {
      const next = loadFoundRelics(spaceId);
      return sameKeys(prev, next) ? prev : next;
    });
    const onFound = () =>
      setFound((prev) => {
        const next = loadFoundRelics(spaceId);
        return sameKeys(prev, next) ? prev : next;
      });
    window.addEventListener("brain-relic-found", onFound);
    return () => window.removeEventListener("brain-relic-found", onFound);
  }, [spaceId]);
  return found;
}

/** Replace the local cache with the server's found set (server is the record now). */
export function replaceFoundRelics(spaceId: string, keys: readonly string[]): void {
  try { localStorage.setItem(`relics.found.${spaceId}`, JSON.stringify([...keys])); } catch { /* cache only */ }
  try { window.dispatchEvent(new CustomEvent("brain-relic-found", { detail: { key: null } })); } catch { /* tests */ }
}

const serverSyncedSpaces = new Set<string>();
/**
 * One-time legacy sync + cache refresh (§8): offer local finds the server
 * lacks (the server accepts them once, as legacy), then cache the server's
 * found set. Any failure keeps the local cache untouched.
 */
export async function refreshFoundRelicsFromServer(spaceId: string): Promise<void> {
  if (serverSyncedSpaces.has(spaceId)) return;
  serverSyncedSpaces.add(spaceId);
  try {
    const before = await getRelicsState();
    if (!before) return;
    const local = loadFoundRelics(spaceId);
    const serverKeys = new Set(before.found.map((id) => `relic-${id}`));
    const missing = [...local].filter((k) => !serverKeys.has(k)).map((k) => k.replace(/^relic-/, ""));
    let state = before;
    if (missing.length > 0) {
      const out = await syncLegacyRelics(missing);
      if (out.state) state = out.state;
    }
    replaceFoundRelics(spaceId, state.found.map((id) => `relic-${id}`));
  } catch { /* cache stays as-is */ }
}
