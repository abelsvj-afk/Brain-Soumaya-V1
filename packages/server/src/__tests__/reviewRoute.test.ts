import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * IM-111: GET /api/review/due must carry each memory's `content`, not just its
 * label — the Recall panel's Reveal renders this payload field, so without it
 * "Reveal & rate my recall" reveals nothing.
 */
let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

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
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "reviewer", passcode: "secret123", name: "reviewer" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

describe("GET /api/review/due (IM-111)", () => {
  it("carries the memory's content in the payload, distinct from its label", async () => {
    const content = "Signed a 12-month lease on the King Street studio, $900 a month, keys collected on the 3rd.";
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const info = ctx.handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, ?, 'daily', ?, 0.5, ?)`)
      .run(spaceId, "the studio lease", content, old);
    const id = Number(info.lastInsertRowid);

    const res = await fetch(`${base}/api/review/due`, { headers: { "x-space-id": spaceId } });
    expect(res.status).toBe(200);
    const due = (await res.json()) as Array<{ id: number; label: string; content?: string }>;
    const mine = due.find((d) => d.id === id);
    expect(mine).toBeTruthy();
    expect(mine!.content).toBe(content);
  });
});
