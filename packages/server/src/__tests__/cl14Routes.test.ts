import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/** IM-114 (grade response carries nextIntervalDays) + IM-118 (lens preview). */
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
    body: JSON.stringify({ gamerTag: "cl14routes", passcode: "secret123", name: "cl14" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const H = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });

describe("IM-118 — POST /api/lenses/preview counts an unsaved query", () => {
  it("returns a live count without creating a lens", async () => {
    const before = await (await fetch(`${base}/api/lenses`, { headers: H() })).json() as unknown[];
    const res = await fetch(`${base}/api/lenses/preview`, { method: "POST", headers: H(), body: JSON.stringify({ query: {} }) });
    expect(res.ok).toBe(true);
    const d = (await res.json()) as { count: number };
    expect(typeof d.count).toBe("number");
    const after = await (await fetch(`${base}/api/lenses`, { headers: H() })).json() as unknown[];
    expect(after.length).toBe(before.length);
  });
  it("rejects an unknown query key (strict schema)", async () => {
    const res = await fetch(`${base}/api/lenses/preview`, { method: "POST", headers: H(), body: JSON.stringify({ query: { bogus: 1 } }) });
    expect(res.status).toBe(400);
  });
});

describe("IM-114 — grade response carries the next-review interval", () => {
  it("POST /api/review/:id returns nextIntervalDays alongside nextReviewAt", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const info = ctx.handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, 'recall me', 'daily', 'body', 0.5, ?)`)
      .run(spaceId, old);
    const id = Number(info.lastInsertRowid);
    const res = await fetch(`${base}/api/review/${id}`, { method: "POST", headers: H(), body: JSON.stringify({ remembered: true }) });
    expect(res.ok).toBe(true);
    const d = (await res.json()) as { nextReviewAt: string; nextIntervalDays: number };
    expect(d.nextReviewAt).toBeTruthy();
    expect(d.nextIntervalDays).toBe(1); // first successful recall → 1-day interval
  });
});
