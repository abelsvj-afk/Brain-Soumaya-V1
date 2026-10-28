import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Batch R — REG-232, server half (REG-040's shape, mirrored): the finance
 * paste route's length rejection says it is a length rejection and names
 * the 20,000 limit, instead of blaming the body's shape while the `issues`
 * array says `too_big`.
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
    body: JSON.stringify({ gamerTag: "batchr", passcode: "secret123", name: "batchr" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const H = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });
const post = async (p: string, b: unknown) => {
  const res = await fetch(`${base}${p}`, { method: "POST", headers: H(), body: JSON.stringify(b) });
  return { status: res.status, body: (await res.json()) as { error?: string } };
};

describe("REG-232 — the finance paste length rejection names the limit", () => {
  it("POST /api/finance/ingest/paste over 20,000 chars says so and names 20,000", async () => {
    const { status, body } = await post("/api/finance/ingest/paste", { text: "x".repeat(20_001) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/too long/i);
    expect(body.error).toContain("20,000");
    expect(body.error).not.toContain("Body must be");
  });

  it("POST /api/finance/ingest/paste with a wrongly-shaped body still gets the shape message", async () => {
    const { status, body } = await post("/api/finance/ingest/paste", {});
    expect(status).toBe(400);
    expect(body.error).toContain("Body must be");
  });

  it("POST /api/finance/ingest/paste at exactly 20,000 chars is accepted", async () => {
    const { status } = await post("/api/finance/ingest/paste", { text: "got 44.30 from DoorDash".padEnd(20_000, ".") });
    expect(status).toBe(200);
  });

  it("POST /api/finance/ingest/paste with a short paste succeeds", async () => {
    const { status } = await post("/api/finance/ingest/paste", { text: "got 44.30 from DoorDash today" });
    expect(status).toBe(200);
  });
});
