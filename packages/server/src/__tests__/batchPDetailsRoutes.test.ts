import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Batch P (Details / Help / Settings) — REG-040, server half: a length
 * rejection says it is a length rejection and names the limit, instead of
 * blaming the body's shape.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "batchp", passcode: "secret123", name: "batchp" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const H = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });
const post = async (p: string, b: unknown) => {
  const res = await fetch(`${base}${p}`, { method: "POST", headers: H(), body: JSON.stringify(b) });
  return { status: res.status, body: (await res.json()) as { error?: string } };
};

describe("REG-040 — length rejections name the limit", () => {
  it("POST /api/ingest over 20,000 chars says so and names 20,000", async () => {
    const { status, body } = await post("/api/ingest", { text: "x".repeat(20_001) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/too long/i);
    expect(body.error).toContain("20,000");
    expect(body.error).not.toContain("Body must be");
  });

  it("POST /api/ingest with a wrongly-shaped body still gets the shape message", async () => {
    const { status, body } = await post("/api/ingest", {});
    expect(status).toBe(400);
    expect(body.error).toContain("Body must be");
  });

  it("POST /api/ingest at exactly 20,000 chars is accepted", async () => {
    const { status } = await post("/api/ingest", { text: "a short memory".padEnd(20_000, ".") });
    expect(status).toBe(200);
  });

  it("POST /api/working over 500 chars says so and names 500", async () => {
    const { status, body } = await post("/api/working", { text: "x".repeat(501) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/too long/i);
    expect(body.error).toContain("500");
    expect(body.error).not.toContain("Body must be");
  });

  it("POST /api/working with a short thought succeeds", async () => {
    const { status } = await post("/api/working", { text: "a small thought" });
    expect(status).toBe(200);
  });
});
