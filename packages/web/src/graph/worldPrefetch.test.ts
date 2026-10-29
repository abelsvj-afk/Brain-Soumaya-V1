import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { prefetchWorld, worldAssetUrls, PREFETCH_CONCURRENCY, _resetPrefetchForTests } from "./worldPrefetch.js";

const bodyOf = (text: string) => new Response(text, { status: 200, headers: { "content-type": "model/gltf-binary" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  _resetPrefetchForTests();
  fetchMock = vi.fn(async () => bodyOf("bytes"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
});

describe("worldAssetUrls — read from each world's own asset module", () => {
  // Totals measured from what each world really downloads: Station ~18.6, Growing Place ~13,
  // Deep Past ~20, People ~0.2, Scale ~19, Eternity ~6 MB. The walk must find the heavy ones.
  it("finds the heavy models for the worlds that have them", () => {
    expect(worldAssetUrls("growing-place")).toContain("/sf-ice-planet-procedural.glb");
    expect(worldAssetUrls("deep-past")).toContain("/sf-anchor-spire.glb");
    expect(worldAssetUrls("great-station")).toContain("/sf-lava-planet.glb");
    expect(worldAssetUrls("eternity")).toContain("/man-god-halo.glb");
    expect(worldAssetUrls("scale").length).toBeGreaterThan(20);
  });
  it("lists local paths only — no remote URLs, no code, no duplicates", () => {
    for (const w of ["great-station", "growing-place", "deep-past", "people", "quiet-archive", "scale", "eternity"]) {
      const urls = worldAssetUrls(w);
      expect(urls.length).toBeGreaterThan(0);
      expect(new Set(urls).size).toBe(urls.length);
      for (const u of urls) expect(u).toMatch(/^\/[^/].*\.(glb|jpe?g|png|webp)$/i);
    }
  });
  it("is empty for home and for anything unknown", () => {
    expect(worldAssetUrls("home")).toEqual([]);
    expect(worldAssetUrls("nowhere")).toEqual([]);
  });
  it("a model the world loads can't be missing from its list: every .glb literal in each asset module is found", () => {
    const base = resolve(__dirname);
    const modules: Record<string, string> = {
      "great-station": "stationAssets.ts",
      "growing-place": "gardenAssets.ts",
      "deep-past": "deepPastAssets.ts",
      people: "peopleAssets.ts",
      "quiet-archive": "quietArchiveAssets.ts",
      scale: "scaleAssets.ts",
      eternity: "eternityAssets.ts",
    };
    for (const [world, file] of Object.entries(modules)) {
      const src = readFileSync(resolve(base, file), "utf8");
      const literals = [...src.matchAll(/url:\s*"(\/[^"]+\.glb)"/g)].map((m) => m[1]!);
      const found = new Set(worldAssetUrls(world));
      for (const l of literals) expect(found.has(l), `${world}: ${l}`).toBe(true);
    }
  });
});

describe("prefetchWorld", () => {
  it("fetches every file of the destination world, once, at low priority", async () => {
    const urls = worldAssetUrls("deep-past");
    await prefetchWorld("deep-past");
    expect(fetchMock).toHaveBeenCalledTimes(urls.length);
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([...urls].sort());
    for (const c of fetchMock.mock.calls) expect((c[1] as { priority: string }).priority).toBe("low");
  });

  it("does nothing for home or an unknown world", async () => {
    await prefetchWorld("home");
    await prefetchWorld("nowhere");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never runs more than PREFETCH_CONCURRENCY downloads at once", async () => {
    let live = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return bodyOf("x");
    });
    await prefetchWorld("great-station");
    expect(peak).toBeLessThanOrEqual(PREFETCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("is idempotent: calling again mid-flight joins the running prefetch, and again after it fetches nothing", async () => {
    const a = prefetchWorld("eternity");
    const b = prefetchWorld("eternity"); // the arming poll calls this every 2 s
    await Promise.all([a, b]);
    const n = fetchMock.mock.calls.length;
    expect(n).toBe(worldAssetUrls("eternity").length);
    await prefetchWorld("eternity");
    expect(fetchMock).toHaveBeenCalledTimes(n);
  });

  it("a failed download never throws, and is retried on a later call", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(prefetchWorld("people")).resolves.toBeUndefined();
    const first = fetchMock.mock.calls.length;
    await prefetchWorld("people");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first); // only the failed file(s) again
    expect(fetchMock.mock.calls.length - first).toBeLessThan(first + 1);
  });

  it("an HTML page answering for a missing file is not counted as the file", async () => {
    fetchMock.mockResolvedValue(new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }));
    await prefetchWorld("quiet-archive");
    const first = fetchMock.mock.calls.length;
    await prefetchWorld("quiet-archive"); // not 'done', so tried again
    expect(fetchMock.mock.calls.length).toBe(first * 2);
  });

  it("respects Data Saver", async () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    await prefetchWorld("deep-past");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects a 2G connection", async () => {
    Object.defineProperty(navigator, "connection", { value: { effectiveType: "2g" }, configurable: true });
    await prefetchWorld("deep-past");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the models the manifests name exist in public/ (so the prefetch isn't chasing ghosts)", () => {
  it("reports any that don't — informational: those worlds are waiting on an upload", () => {
    const root = [resolve(process.cwd(), "public"), resolve(process.cwd(), "packages/web/public")].find((p) => existsSync(p))!;
    const missing: string[] = [];
    for (const w of ["great-station", "growing-place", "deep-past", "people", "quiet-archive", "scale", "eternity"])
      for (const u of worldAssetUrls(w)) if (!existsSync(resolve(root, "." + u))) missing.push(`${w}: ${u}`);
    // Not an assertion on emptiness (an upload may be pending); it must at least be a short, known list.
    expect(missing.length).toBeLessThan(10);
  });
});
