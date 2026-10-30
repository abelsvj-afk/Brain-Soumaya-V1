import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * NPC autonomy — HTTP contract. The routes are thin: the loop owns
 * every outcome, the client renders what the server returns. Auth
 * and space scoping ride the same guard as every other per-brain
 * route (requireSpace); the NPC routes add no auth of their own.
 */
describe("Society routes", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  let space2: string;

  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }),
    });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-space-id": space },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    ctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    spaceId = await auth("npc-tester");
    space2 = await auth("npc-other");
  });
  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  it("GET /api/society returns numbers and words only, never memory text", async () => {
    ctx.handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, emotional_weight, created_at) VALUES (?, ?, 'memory', ?, 0.7, ?)`)
      .run(spaceId, "Secret-title-Q81", "Prayed to God about private-detail-ZX42", new Date().toISOString());
    const r = await call("GET", "/api/society", spaceId);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/Secret-title|private-detail/);
    const s = r.body.society as { reflects: boolean; currents: Record<string, number>; factions: unknown[]; belief: number };
    expect(s.reflects).toBe(true);
    expect(Object.keys(s.currents).sort()).toEqual(["ambition", "appetite", "friction", "giving", "peace", "reverence", "weight"]);
    expect(s.factions).toHaveLength(5);
    expect(r.body.reflect).toBe(true);
  });

  it("PUT /api/society/reflect validates, turns reflection off (neutral) and on again, per brain", async () => {
    expect((await call("PUT", "/api/society/reflect", spaceId, { reflect: "yes" })).status).toBe(400);
    const off = await call("PUT", "/api/society/reflect", spaceId, { reflect: false });
    expect(off.status).toBe(200);
    expect((off.body.society as { reflects: boolean }).reflects).toBe(false);
    expect(off.body.reflect).toBe(false);
    // another brain is unaffected
    expect((await call("GET", "/api/society", space2)).body.reflect).toBe(true);
    const on = await call("PUT", "/api/society/reflect", spaceId, { reflect: true });
    expect(on.body.reflect).toBe(true);
  });

  it("needs a brain", async () => {
    expect((await call("GET", "/api/society", "")).status).not.toBe(200);
  });
});
