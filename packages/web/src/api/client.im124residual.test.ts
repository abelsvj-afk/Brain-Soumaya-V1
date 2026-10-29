import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDigest,
  getDigestResult,
  getConstellations,
  getConstellationsResult,
  getDueReviews,
  getDueReviewsResult,
} from "./client.js";

/**
 * IM-124 RESIDUAL — the Observatory's three array fetchers used to swallow
 * every failure into `[]` inside the shared client, so a lone dead endpoint
 * collapsed to "genuinely empty" on the arrival screen even after IM-124's
 * per-source error model landed (the fail-soft helpers never reject, so the
 * error state was unreachable in production for those three sources).
 *
 * Contract pinned here:
 *  - The new Result variants (`getDigestResult`, `getConstellationsResult`,
 *    `getDueReviewsResult`) return `{ ok: false }` for network failure,
 *    non-OK status, and malformed bodies — and `{ ok: true, … }` (possibly
 *    empty) ONLY for a real successful response.
 *  - The legacy fail-soft functions keep their EXACT old contract — `[]` on
 *    any failure, the array on success — so no other consumer changes
 *    behaviour. EXCEPTION (Batch G, REG-196): `getDueReviews` THROWS on
 *    failure instead of resolving `[]` — it is the badge count's source
 *    (`getDueReviews().length` in App's poll), so a dead server used to read
 *    as "0 due". Its only remaining caller is that poll (ReviewPanel moved to
 *    the Result variant); the throw is what lets the poll report unknown.
 *
 * Falsification: against the pre-change client the Result variants don't
 * exist (import failure); against a variant that fail-softs, the
 * `{ ok: false }` assertions fail.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("IM-124 residual — Result variants distinguish failure from empty", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("getDigestResult: network failure, HTTP error, and malformed body are all { ok: false }", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDigestResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDigestResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getDigestResult()).resolves.toEqual({ ok: false });
  });

  it("getDigestResult: success (incl. genuinely empty) is { ok: true }", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(getDigestResult()).resolves.toEqual({ ok: true, insights: [] });
    const ins = [{ id: 1, text: "a connection", score: 0.5, createdAt: "2026-10-20", nodes: [] }];
    fetchMock().mockResolvedValue(jsonResponse(ins));
    await expect(getDigestResult()).resolves.toEqual({ ok: true, insights: ins });
  });

  it("getConstellationsResult / getDueReviewsResult follow the same contract", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getConstellationsResult()).resolves.toEqual({ ok: false });
    await expect(getDueReviewsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse([], false, 503));
    await expect(getConstellationsResult()).resolves.toEqual({ ok: false });
    await expect(getDueReviewsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(getConstellationsResult()).resolves.toEqual({ ok: true, constellations: [] });
    await expect(getDueReviewsResult()).resolves.toEqual({ ok: true, reviews: [] });
  });
});

describe("IM-124 residual — legacy fail-soft contract is UNCHANGED for other consumers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("getDigest / getConstellations still resolve [] on ANY failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDigest()).resolves.toEqual([]);
    await expect(getConstellations()).resolves.toEqual([]);
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDigest()).resolves.toEqual([]);
    await expect(getConstellations()).resolves.toEqual([]);
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getDigest()).resolves.toEqual([]);
    await expect(getConstellations()).resolves.toEqual([]);
  });

  it("getDueReviews THROWS on any failure (Batch G, REG-196) — never [] as '0 due'", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDueReviews()).rejects.toThrow();
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDueReviews()).rejects.toThrow();
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getDueReviews()).rejects.toThrow();
  });

  it("…and still resolve the real array on success", async () => {
    const arr = [{ id: 7 }];
    fetchMock().mockResolvedValue(jsonResponse(arr));
    await expect(getDigest()).resolves.toEqual(arr);
    await expect(getConstellations()).resolves.toEqual(arr);
    await expect(getDueReviews()).resolves.toEqual(arr);
  });
});
