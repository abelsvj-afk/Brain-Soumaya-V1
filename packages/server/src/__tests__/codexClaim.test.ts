import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { CodexDiscoveriesRepo } from "../repositories/codexDiscoveries.repo.js";
import { CODEX_STATIC_KEYS } from "@brain/shared";

/**
 * IM-93: the codex-claim allow-list must cover the REAL client Codex catalog.
 * Before the fix, every mind-* entry, five phenomena (supernova, crown,
 * goldenhour, theweight, aurora) and every fieldnote-* entry were rejected
 * with 400 — and the client marked them seen anyway, so the fuel was lost.
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
    body: JSON.stringify({ gamerTag: "codex-tester", passcode: "secret123", name: "codex-tester" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function claim(key: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/maintenance/codex-claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify({ key }),
  });
  return { status: res.status, body: await res.json() };
}

describe("codex-claim covers the real Codex catalog (IM-93)", () => {
  it("awards a mind-* entry (400 before the fix)", async () => {
    const first = await claim("mind-goal");
    expect(first.status).toBe(200);
    expect(first.body.awarded).toBe(true);
    // Still one-time: a second claim is a no-op, not a farm.
    const again = await claim("mind-goal");
    expect(again.status).toBe(200);
    expect(again.body.awarded).toBe(false);
  });

  it("awards the remaining mind-* entries", async () => {
    for (const key of ["mind-skill", "mind-person_entity", "mind-identity", "mind-idea", "mind-intention", "mind-motivation"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(200);
      expect(r.body.awarded, key).toBe(true);
    }
  });

  it("awards the five phenomena the old allow-list missed", async () => {
    for (const key of ["phenom-supernova", "phenom-crown", "phenom-goldenhour", "phenom-theweight", "phenom-aurora"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(200);
      expect(r.body.awarded, key).toBe(true);
    }
  });

  it("awards a fieldnote-* entry Soumaya actually charted for this space", async () => {
    new CodexDiscoveriesRepo(ctx.handle, spaceId).add({
      key: "sector:daily:25",
      title: "A Sector Comes of Age",
      lore: "The Drift reached 25 memories.",
      icon: "✦",
    });
    const r = await claim("fieldnote-sector:daily:25");
    expect(r.status).toBe(200);
    expect(r.body.awarded).toBe(true);
  });

  it("accepts every key in the shared static catalog (the set the client generates)", async () => {
    expect(CODEX_STATIC_KEYS.size).toBeGreaterThan(0);
    for (const key of CODEX_STATIC_KEYS) {
      const r = await claim(key);
      expect(r.status, key).toBe(200);
    }
  });

  it("still rejects invented keys and uncharted field notes (no fuel farming)", async () => {
    for (const key of ["mind-invented", "phenom-invented", "sector-invented-42", "fieldnote-never-charted", "constellation-999999"]) {
      const r = await claim(key);
      expect(r.status, key).toBe(400);
    }
  });
});
