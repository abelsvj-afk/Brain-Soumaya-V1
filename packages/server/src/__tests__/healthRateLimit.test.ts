import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { DEFAULT_RATE_LIMIT_MAX } from "../api/middleware.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Reviewer r2 (merged main): a normal session hit the general /api limit and
 * the health check came back 429. /api/health is now registered before the
 * limiter, so it never spends or gets refused by the per-IP budget.
 */
describe("/api/health vs the general rate limiter", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  const prev = process.env.RATE_LIMIT_MAX;

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "5";
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
    if (prev === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = prev;
  });

  it("health keeps answering 200 after the general budget is exhausted", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${base}/api/health`);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-ratelimit-limit")).toBeNull();
    }
    // Other /api routes are still limited (health didn't spend the budget,
    // so the first 5 pass and the 6th is refused).
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await fetch(`${base}/api/graph`)).status);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes[5]).toBe(429);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("default general limit is 300/min", () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(300);
  });
});
