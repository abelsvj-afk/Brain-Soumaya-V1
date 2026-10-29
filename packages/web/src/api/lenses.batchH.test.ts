import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLenses, createLens, updateLens, lensNodes, previewLens, recordLensCreated } from "./lenses.js";
import { confirmInquiry } from "./mind.js";

/** API-level pins (REG-205/206/208/209): fetch is stubbed; no network is touched. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const calls: { url: string; init?: RequestInit }[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem("brain.spaceId", "test-space");
  vi.stubGlobal(
    "fetch",
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const counter = () => parseInt(localStorage.getItem("stat.lenses_made.test-space") || "0", 10) || 0;

describe("REG-205 — getLenses throws on failure instead of returning [] (CN-06)", () => {
  it("rejects when the server is unreachable", async () => {
    fetchImpl = async () => {
      throw new Error("network down");
    };
    await expect(getLenses()).rejects.toThrow();
  });

  it("rejects on a non-OK status", async () => {
    fetchImpl = async () => jsonResponse({ error: "boom" }, false, 500);
    await expect(getLenses()).rejects.toThrow();
  });

  it("still resolves the list on success", async () => {
    fetchImpl = async (url) =>
      url.includes("/api/lenses")
        ? jsonResponse([{ id: 1, name: "Heavy", query: {}, pinned: false, count: 2 }])
        : jsonResponse({}, false, 404);
    expect(await getLenses()).toHaveLength(1);
  });
});

describe("REG-206 — lensNodes throws on failure instead of returning [] (CN-07)", () => {
  it("rejects on a non-OK status", async () => {
    fetchImpl = async () => jsonResponse({ error: "boom" }, false, 500);
    await expect(lensNodes(1)).rejects.toThrow();
  });

  it("returns the full evaluation (ids + total + cap flags) on success", async () => {
    fetchImpl = async () => jsonResponse({ ids: [11, 22], total: 2400, capped: true, totalIsLowerBound: false, shown: 2000 });
    expect(await lensNodes(1)).toEqual({ ids: [11, 22], total: 2400, capped: true, totalIsLowerBound: false, shown: 2000 });
  });
});

describe("REG-208 — previewLens returns the capped evaluation (CN-09)", () => {
  it("returns count + capped + shown, not a bare number", async () => {
    fetchImpl = async () => jsonResponse({ count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 });
    expect(await previewLens({})).toEqual({ count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 });
  });

  it("returns null on failure so the UI can say 'couldn't count'", async () => {
    fetchImpl = async () => {
      throw new Error("network down");
    };
    expect(await previewLens({})).toBeNull();
  });
});

describe("REG-209 — the Lenscrafter counter increments only on creation, on every door (CN-10)", () => {
  it("createLens increments once per created lens", async () => {
    fetchImpl = async () => jsonResponse({ id: 1, name: "A", query: {}, pinned: false, count: 0 });
    await createLens("A", {});
    expect(counter()).toBe(1);
    await createLens("B", {});
    expect(counter()).toBe(2);
  });

  it("createLens does not increment when the server refuses", async () => {
    fetchImpl = async () => jsonResponse({ error: "bad" }, false, 400);
    expect(await createLens("A", {})).toBeNull();
    expect(counter()).toBe(0);
  });

  it("updateLens (edit) never increments", async () => {
    fetchImpl = async () => jsonResponse({ id: 1, name: "A", query: {}, pinned: false, count: 0 });
    await updateLens(1, { name: "A2" });
    await updateLens(1, { name: "A3" });
    expect(counter()).toBe(0);
  });

  it("recordLensCreated is the single shared increment", () => {
    recordLensCreated();
    expect(counter()).toBe(1);
  });

  it("confirming a lens suggestion (NoticingCard door) increments; other confirms do not", async () => {
    fetchImpl = async () => jsonResponse({ ok: true, lens: { id: 7, name: "Orphans", query: { state: "orphan" }, pinned: true } });
    const r = await confirmInquiry(42);
    expect(r.ok).toBe(true);
    expect(counter()).toBe(1);
    fetchImpl = async () => jsonResponse({ ok: true });
    await confirmInquiry(43);
    expect(counter()).toBe(1);
  });
});
