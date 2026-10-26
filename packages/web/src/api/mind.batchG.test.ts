import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pruneWeakLinksResult, pruneWeakLinks } from "./mind.js";

/**
 * Batch G, REG-204 (CN-05) + REG-203 (CN-04): the strict declutter variant
 * distinguishes failure ({ ok: false }) from a confirmed zero-prune, and
 * carries the wrong-link / cap-trim split so the panel can report each half
 * honestly. The legacy wrapper keeps fail-softing for its other callers.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("pruneWeakLinksResult — failure is distinct from a tidy galaxy", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("network failure, HTTP error, and malformed body are all { ok: false }", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(pruneWeakLinksResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(pruneWeakLinksResult()).resolves.toEqual({ ok: false });
    fetchMock().mockResolvedValue(jsonResponse([1, 2, 3])); // an array is not a prune report
    await expect(pruneWeakLinksResult()).resolves.toEqual({ ok: false });
  });

  it("a successful prune carries the wrong-link / cap-trim split", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ pruned: 5, anchorPruned: 3, wrongPruned: 1, capTrimmed: 2, weakPruned: 2 }),
    );
    await expect(pruneWeakLinksResult()).resolves.toEqual({
      ok: true,
      pruned: 5,
      anchorPruned: 3,
      wrongPruned: 1,
      capTrimmed: 2,
      weakPruned: 2,
    });
  });

  it("a confirmed zero-prune is { ok: true } with zeros — never confused with failure", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ pruned: 0, anchorPruned: 0, wrongPruned: 0, capTrimmed: 0, weakPruned: 0 }),
    );
    await expect(pruneWeakLinksResult()).resolves.toEqual({
      ok: true,
      pruned: 0,
      anchorPruned: 0,
      wrongPruned: 0,
      capTrimmed: 0,
      weakPruned: 0,
    });
    // …and the legacy wrapper still fail-softs on the same failure (same shape, zeros).
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(pruneWeakLinks()).resolves.toEqual({ pruned: 0, anchorPruned: 0, wrongPruned: 0, capTrimmed: 0, weakPruned: 0 });
  });
});
