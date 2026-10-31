/**
 * Stale-shell recovery.
 *
 * Every deploy renames the app's hashed JS chunks. A phone still holding an
 * older build's shell (cached index / service worker) will ask for chunk
 * files that no longer exist, and the dynamic import rejects with
 * "Failed to fetch dynamically imported module" — previously a dead-end
 * error screen whose only exit was the manual Reload button. The server now
 * answers those missing files with a real 404 (see the SPA fallback in the
 * server's createApp), and this module is the client half: recognize a
 * chunk-load failure and force ONE full page reload, which fetches the
 * fresh shell and its current chunk names.
 *
 * Loop guard: the reload timestamp lives in sessionStorage; at most one
 * forced reload per CHUNK_RELOAD_GUARD_MS. If the chunk still fails after a
 * fresh shell (inside the window) the failure is NOT reloaded — the caller
 * lets the existing error screen show, exactly as before this module
 * existed. The guard is per-tab-session by design: a brand-new visit is a
 * fresh shell anyway, and a stuck session keeps its manual Reload button.
 */

export const CHUNK_RELOAD_KEY = "brain.chunkReloadAt";

/** One forced reload per 3 minutes at most. Long enough that a genuinely
 * broken deploy can't spin the page; short enough that a second deploy in
 * the same session still self-heals. */
export const CHUNK_RELOAD_GUARD_MS = 3 * 60_000;

/**
 * The ways browsers report a failed dynamic import / chunk load:
 * - Chrome/Edge: TypeError "Failed to fetch dynamically imported module: <url>"
 * - Firefox: "error loading dynamically imported module"
 * - Safari: "Importing a module script failed."
 * - Webpack-style bundlers (and Vite's error name in some paths): ChunkLoadError
 *   / "Loading chunk <id> failed."
 */
const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \S+ failed/i,
  /chunkloaderror/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (error == null) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((p) => p.test(name) || p.test(message));
}

export interface ChunkReloadDeps {
  now?: () => number;
  /** Defaults to window.sessionStorage; pass null to simulate it being unavailable. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  reload?: () => void;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * If `error` is a chunk-load failure and the guard allows it, records the
 * attempt and reloads the page; returns true when a reload was triggered.
 * Any other error — or a chunk error inside the guard window — returns
 * false and leaves the caller's normal error path in charge.
 *
 * If storage is unavailable (private-mode quirks), the guard cannot persist
 * across the reload, so we still reload: one unguarded reload beats a
 * guaranteed dead-end, and the post-reload chunk failure then surfaces
 * through the caller's error screen instead of looping in-page.
 */
export function maybeReloadForChunkError(error: unknown, deps: ChunkReloadDeps = {}): boolean {
  if (!isChunkLoadError(error)) return false;
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const reload = deps.reload ?? (() => window.location.reload());
  const t = now();
  if (storage) {
    try {
      const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
      if (Number.isFinite(last) && last > 0 && t - last < CHUNK_RELOAD_GUARD_MS) {
        return false;
      }
    } catch {
      // Unreadable storage: fall through and reload (see docstring).
    }
    try {
      storage.setItem(CHUNK_RELOAD_KEY, String(t));
    } catch {
      // Non-fatal: the reload matters more than the bookkeeping.
    }
  }
  reload();
  return true;
}
