import { describe, it, expect, vi, afterEach } from "vitest";
import { getHealth, HealthUnavailableError, isHealth, type Health } from "../api/client.js";
import { loadHealthWithBackoff } from "./healthRetry.js";

const HEALTHY: Health = {
  ok: true,
  embeddings: { model: "e", dim: 3 },
  llm: { model: "gemini-x", available: true },
  nodes: 1,
};

function res(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("getHealth — non-OK / malformed responses", () => {
  it("throws HealthUnavailableError on 429 instead of returning the error body", async () => {
    vi.stubGlobal("fetch", async () => res({ error: "Too many requests" }, 429, { "Retry-After": "5" }));
    const err = await getHealth().catch((e) => e);
    expect(err).toBeInstanceOf(HealthUnavailableError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
  });

  it("throws on a 200 whose body lacks llm", async () => {
    vi.stubGlobal("fetch", async () => res({ ok: true }));
    await expect(getHealth()).rejects.toBeInstanceOf(HealthUnavailableError);
  });

  it("throws on a non-JSON body", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError("bad"); } }) as unknown as Response);
    await expect(getHealth()).rejects.toBeInstanceOf(HealthUnavailableError);
  });

  it("returns a valid health body", async () => {
    vi.stubGlobal("fetch", async () => res(HEALTHY));
    await expect(getHealth()).resolves.toEqual(HEALTHY);
  });

  it("isHealth rejects partial shapes", () => {
    expect(isHealth(null)).toBe(false);
    expect(isHealth({ error: "x" })).toBe(false);
    expect(isHealth({ llm: { model: "m" } })).toBe(false);
    expect(isHealth(HEALTHY)).toBe(true);
  });
});

describe("loadHealthWithBackoff", () => {
  it("retries a 429 then succeeds, honoring Retry-After", async () => {
    const sleeps: number[] = [];
    const fn = vi
      .fn<() => Promise<Health>>()
      .mockRejectedValueOnce(new HealthUnavailableError(429, 1500))
      .mockResolvedValueOnce(HEALTHY);
    const out = await loadHealthWithBackoff(fn, { sleep: async (ms) => void sleeps.push(ms) });
    expect(out).toEqual(HEALTHY);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1500]);
  });

  it("backs off exponentially and resolves null (status unknown) when attempts run out", async () => {
    const sleeps: number[] = [];
    const fn = vi.fn<() => Promise<Health>>().mockRejectedValue(new HealthUnavailableError(503));
    const out = await loadHealthWithBackoff(fn, { attempts: 3, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms) });
    expect(out).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry a non-429 4xx", async () => {
    const fn = vi.fn<() => Promise<Health>>().mockRejectedValue(new HealthUnavailableError(401));
    expect(await loadHealthWithBackoff(fn, { sleep: async () => {} })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops when cancelled", async () => {
    let cancelled = false;
    const fn = vi.fn<() => Promise<Health>>().mockImplementation(async () => {
      cancelled = true;
      throw new Error("network");
    });
    expect(await loadHealthWithBackoff(fn, { sleep: async () => {}, isCancelled: () => cancelled })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
