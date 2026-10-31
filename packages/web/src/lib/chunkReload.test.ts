import { describe, it, expect, vi } from "vitest";
import {
  CHUNK_RELOAD_GUARD_MS,
  CHUNK_RELOAD_KEY,
  isChunkLoadError,
  maybeReloadForChunkError,
  type ChunkReloadDeps,
} from "./chunkReload.js";

const CHUNK_MSG = "Failed to fetch dynamically imported module: https://example.test/assets/SettingsPanel-V_KOHzCJ.js";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

function makeDeps(start = 1_000_000) {
  const storage = makeStorage();
  const reload = vi.fn();
  let now = start;
  const deps: ChunkReloadDeps = { now: () => now, storage, reload };
  return { deps, storage, reload, advance: (ms: number) => (now += ms) };
}

describe("isChunkLoadError", () => {
  it("recognizes the browser chunk-load failure messages", () => {
    expect(isChunkLoadError(new TypeError(CHUNK_MSG))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 123 failed."))).toBe(true);
    const named = new Error("whatever");
    named.name = "ChunkLoadError";
    expect(isChunkLoadError(named)).toBe(true);
  });

  it("does not flag ordinary errors", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(new TypeError("network request failed"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError("some string failure")).toBe(false);
  });
});

describe("maybeReloadForChunkError", () => {
  it("reloads once on a chunk error and records the attempt", () => {
    const { deps, storage, reload } = makeDeps();
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), deps)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.map.get(CHUNK_RELOAD_KEY)).toBe("1000000");
  });

  it("is suppressed inside the guard window (no reload loop)", () => {
    const { deps, reload, advance } = makeDeps();
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), deps)).toBe(true);
    advance(CHUNK_RELOAD_GUARD_MS - 1);
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), deps)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is allowed again after the guard window passes", () => {
    const { deps, reload, advance } = makeDeps();
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), deps)).toBe(true);
    advance(CHUNK_RELOAD_GUARD_MS + 1);
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), deps)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads for non-chunk errors and writes no guard timestamp", () => {
    const { deps, storage, reload } = makeDeps();
    expect(maybeReloadForChunkError(new Error("a normal render bug"), deps)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.map.has(CHUNK_RELOAD_KEY)).toBe(false);
  });

  it("still reloads when storage is unavailable (guard cannot persist)", () => {
    const reload = vi.fn();
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), { storage: null, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads when storage throws on read/write", () => {
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(maybeReloadForChunkError(new TypeError(CHUNK_MSG), { storage: broken, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
