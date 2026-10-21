import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDigest, runContradictions } from "./client.js";

/**
 * IM-61 falsifiable contract: the scan functions are ACTIONS, not fail-soft
 * reads. A failed scan (network error, HTTP error, malformed body) must
 * REJECT so the panel can toast an honest error — returning [] would make
 * DigestPanel announce "No contradictions found ✓" / "No new connections
 * yet" for a scan that never ran. A successful scan resolves its array,
 * including a genuine empty one (true-empty stays distinguishable).
 */

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const insight = { id: 1, text: "a ↔ b", score: 0.5, createdAt: "2026-10-20T00:00:00Z", nodes: [] };

describe("IM-61 — scan functions surface failures instead of returning []", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;

  it("runDigest rejects on a network failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(runDigest()).rejects.toThrow();
  });

  it("runDigest rejects on an HTTP error status", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
    await expect(runDigest()).rejects.toThrow(/500/);
  });

  it("runDigest rejects on a non-array success body", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ nope: true }));
    await expect(runDigest()).rejects.toThrow();
  });

  it("runDigest resolves the found insights on success", async () => {
    fetchMock().mockResolvedValue(jsonResponse([insight]));
    await expect(runDigest()).resolves.toEqual([insight]);
  });

  it("runDigest resolves [] for a successful scan that found nothing (true empty)", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(runDigest()).resolves.toEqual([]);
  });

  it("runContradictions rejects on a network failure", async () => {
    fetchMock().mockRejectedValue(new Error("network down"));
    await expect(runContradictions()).rejects.toThrow();
  });

  it("runContradictions rejects on an HTTP error status", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ error: "boom" }, false, 503));
    await expect(runContradictions()).rejects.toThrow(/503/);
  });

  it("runContradictions resolves [] for a successful scan that found nothing (true empty)", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    await expect(runContradictions()).resolves.toEqual([]);
  });

  it("runContradictions resolves the found insights on success", async () => {
    fetchMock().mockResolvedValue(jsonResponse([insight]));
    await expect(runContradictions()).resolves.toEqual([insight]);
  });
});
