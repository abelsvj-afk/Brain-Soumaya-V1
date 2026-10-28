import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDailyDigest,
  getDailyDigestResult,
  getEmotionalTrajectory,
  getEmotionalTrajectoryResult,
  getDormant,
  getDormantResult,
  getEvolutionLinks,
  getEvolutionLinksResult,
  getLifeAreas,
  getLifeAreasResult,
  getSelfReview,
  getSelfReviewResult,
  getBeliefs,
  getBeliefsResult,
  getDailyLog,
  getDailyLogResult,
} from "./client.js";

/**
 * Batch N — REG-149 / INS-02: the DigestPanel adopts the strict-Result
 * variants the Observatory uses (IM-124). The two array variants already
 * existed (getDigestResult, getConstellationsResult — pinned in
 * client.im124residual.test.ts); this file pins the eight remaining sources
 * the panel loads, plus the Captain's Log (which lives in ops.ts and is
 * re-exported through client.ts).
 *
 * Contract (mirrors getDigestResult exactly):
 *  - Result variants return `{ ok: false }` for network failure, non-OK
 *    status, and malformed bodies — and `{ ok: true, … }` (possibly empty)
 *    ONLY for a real successful response.
 *  - The legacy fail-soft functions keep their EXACT old contract, so no
 *    other consumer changes behaviour.
 *  - getDailyLogResult treats a 404 as `{ ok: true, log: null }`: "no log
 *    written yet" is a legitimate empty state, not a failed load — only a
 *    network failure, a non-404 error status, or a malformed body is a
 *    failure.
 *
 * Falsification: against the pre-change client the Result variants don't
 * exist (import failure); against a variant that fail-softs, the
 * `{ ok: false }` assertions fail.
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("Batch N — Result variants distinguish failure from empty", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("array variants: network failure, HTTP error, and malformed body are all { ok: false }", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDormantResult()).resolves.toEqual({ ok: false });
    await expect(getEvolutionLinksResult()).resolves.toEqual({ ok: false });
    await expect(getLifeAreasResult()).resolves.toEqual({ ok: false });
    await expect(getSelfReviewResult()).resolves.toEqual({ ok: false });
    await expect(getBeliefsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDormantResult()).resolves.toEqual({ ok: false });
    await expect(getBeliefsResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(getDormantResult()).resolves.toEqual({ ok: false });
    await expect(getEvolutionLinksResult()).resolves.toEqual({ ok: false });
    await expect(getLifeAreasResult()).resolves.toEqual({ ok: false });
    await expect(getSelfReviewResult()).resolves.toEqual({ ok: false });
    await expect(getBeliefsResult()).resolves.toEqual({ ok: false });
  });

  it("array variants: success (incl. genuinely empty) is { ok: true }", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(getDormantResult()).resolves.toEqual({ ok: true, dormant: [] });
    await expect(getEvolutionLinksResult()).resolves.toEqual({ ok: true, evolution: [] });
    await expect(getLifeAreasResult()).resolves.toEqual({ ok: true, lifeAreas: [] });
    await expect(getSelfReviewResult()).resolves.toEqual({ ok: true, selfReview: [] });
    await expect(getBeliefsResult()).resolves.toEqual({ ok: true, beliefs: [] });
    const item = [{ nodeId: 1 }];
    fetchMock().mockResolvedValue(jsonResponse(item));
    await expect(getDormantResult()).resolves.toEqual({ ok: true, dormant: item });
  });

  it("getDailyDigestResult: failure is { ok: false }; success returns the normalized digest", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDailyDigestResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDailyDigestResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse(["not", "an", "object"]));
    await expect(getDailyDigestResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({}));
    const empty = await getDailyDigestResult();
    expect(empty).toEqual({
      ok: true,
      digest: expect.objectContaining({ fresh: [], connections: [], expiredActions: [], cooling: [], reminders: [] }),
    });
    const digest = {
      date: "2026-10-25",
      greeting: "Morning.",
      fresh: [],
      connections: [],
      expiredActions: [],
      cooling: [],
      reminders: [],
      closing: "",
    };
    fetchMock().mockResolvedValue(jsonResponse(digest));
    await expect(getDailyDigestResult()).resolves.toEqual({ ok: true, digest });
  });

  it("getEmotionalTrajectoryResult: failure is { ok: false }; success returns the normalized trajectory", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getEmotionalTrajectoryResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse(null, false, 503));
    await expect(getEmotionalTrajectoryResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse("nope"));
    await expect(getEmotionalTrajectoryResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({}));
    const empty = await getEmotionalTrajectoryResult();
    expect(empty).toEqual({
      ok: true,
      trajectory: expect.objectContaining({ points: [], patterns: [], sampleSize: 0 }),
    });
  });

  it("getDailyLogResult: a 404 is an empty log ({ ok: true, log: null }), not a failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDailyLogResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDailyLogResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "No daily log found" }, false, 404));
    await expect(getDailyLogResult()).resolves.toEqual({ ok: true, log: null });
    const log = { id: 1, content: "A quiet day.", date: "2026-10-25" };
    fetchMock().mockResolvedValue(jsonResponse(log));
    await expect(getDailyLogResult()).resolves.toEqual({ ok: true, log });
    fetchMock().mockResolvedValue(jsonResponse({ id: 1, date: "2026-10-25" }));
    await expect(getDailyLogResult()).resolves.toEqual({ ok: false });
  });
});

describe("Batch N — legacy fail-soft contract is UNCHANGED for other consumers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("array getters still resolve [] on ANY failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(getDormant()).resolves.toEqual([]);
    await expect(getEvolutionLinks()).resolves.toEqual([]);
    await expect(getLifeAreas()).resolves.toEqual([]);
    await expect(getSelfReview()).resolves.toEqual([]);
    await expect(getBeliefs()).resolves.toEqual([]);
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(getDormant()).resolves.toEqual([]);
    await expect(getBeliefs()).resolves.toEqual([]);
  });

  it("getDailyDigest / getEmotionalTrajectory / getDailyLog still return their empty shapes on failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    const digest = await getDailyDigest();
    expect(digest.fresh).toEqual([]);
    expect(digest.connections).toEqual([]);
    const trajectory = await getEmotionalTrajectory();
    expect(trajectory.points).toEqual([]);
    expect(trajectory.sampleSize).toBe(0);
    await expect(getDailyLog()).resolves.toBeNull();
  });
});
