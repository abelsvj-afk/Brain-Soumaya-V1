import * as station from "./stationAssets.js";
import * as garden from "./gardenAssets.js";
import * as deepPast from "./deepPastAssets.js";
import * as people from "./peopleAssets.js";
import * as quietArchive from "./quietArchiveAssets.js";
import * as scale from "./scaleAssets.js";
import * as eternity from "./eternityAssets.js";

/**
 * Warm a world's models while the ship is still getting there.
 *
 * Arriving used to mean: the scene mounts, THEN 6-20 MB of models start downloading, and the
 * world appears bare-then-filling-in. A journey already has dead time — a 10 s free-cancel
 * window plus a 12 s warp (45 s drift) of flying — so the models are fetched during it, at low
 * priority, and the scene finds them already in the cache when it mounts.
 *
 * What to fetch is read from each world's own asset module, by walking its exports for local
 * model/texture paths — not from a hand-kept second list that could drift. (Checked against the
 * measured per-world downloads: the walk totals match to within ~0.5 MB for every world.) A model
 * added to a world's asset module is therefore prefetched with no further change.
 *
 * It only ever *warms the cache*: the scene's own loaders are untouched and still decide what to
 * show, so a failed or skipped prefetch costs nothing but the head start.
 */

const LOCAL_ASSET = /^\/[^/].*\.(glb|jpe?g|png|webp)$/i;

function collect(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    if (LOCAL_ASSET.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as object)) collect(v, out, depth + 1);
  }
}

function urlsOf(mod: Record<string, unknown>): readonly string[] {
  const out = new Set<string>();
  for (const v of Object.values(mod)) if (typeof v !== "function") collect(v, out);
  return [...out];
}

const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  "great-station": station,
  "growing-place": garden,
  "deep-past": deepPast,
  people,
  "quiet-archive": quietArchive,
  scale,
  eternity,
};

/** Every model/texture path this world loads (empty for home and anything unknown). */
export function worldAssetUrls(world: string): readonly string[] {
  const mod = MODULES[world];
  return mod ? urlsOf(mod) : [];
}

/** How many downloads run at once: enough to fill a phone's link, few enough not to starve the
 *  ship's own transit models or the API calls. */
export const PREFETCH_CONCURRENCY = 3;

const done = new Set<string>(); // fetched OK this session
const running = new Map<string, Promise<void>>(); // world -> its in-flight prefetch

/** Respect the user's data settings: no speculative downloads on Data Saver or a 2G link. */
function dataIsPrecious(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g");
}

async function drain(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { priority: "low", credentials: "same-origin" } as RequestInit);
    const type = res.headers.get("content-type") ?? "";
    // The server answers an unknown path with the app's HTML page and a 200; that is not the file.
    if (!res.ok || /text\/html/i.test(type)) {
      void res.body?.cancel().catch(() => {});
      return false;
    }
    // Read the body to the end and discard it: the service worker is storing its own copy as it
    // streams past, and cancelling early would cut that download short.
    const reader = res.body?.getReader();
    if (reader) for (;;) if ((await reader.read()).done) break;
    return true;
  } catch {
    return false;
  }
}

/**
 * Start warming `world`'s models. Safe to call as often as you like: a world already being
 * fetched joins the running prefetch, and files already fetched are skipped. Never throws.
 * Resolves when every file has been tried.
 */
export function prefetchWorld(world: string): Promise<void> {
  const urls = worldAssetUrls(world).filter((u) => !done.has(u));
  if (urls.length === 0 || dataIsPrecious()) return Promise.resolve();
  const existing = running.get(world);
  if (existing) return existing;

  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      if (await drain(url)) done.add(url);
    }
  };
  const p = Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker))
    .then(() => undefined)
    .finally(() => running.delete(world));
  running.set(world, p);
  return p;
}

/** Test seam: forget what this session has fetched. */
export function _resetPrefetchForTests(): void {
  done.clear();
  running.clear();
}
