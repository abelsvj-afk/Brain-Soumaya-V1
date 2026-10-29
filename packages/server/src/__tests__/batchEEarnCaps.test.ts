import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { EconomyRepo, EARN_THOUGHT, EARN_MIND } from "../economy.js";
import { EARN_THOUGHT_DAILY_CAP, EARN_MIND_DAILY_CAP } from "@brain/shared";

/**
 * REG-051 (PG-08): thought add/dismiss cycles and Mind create/delete cycles
 * pay per call with client-side-only caps. Each earn path now carries a
 * stated, server-enforced per-day cap (10/day each — generous for honest
 * use: a real session captures a handful of thoughts / builds a few Mind
 * entries; the cap only binds the add→dismiss→add loop).
 *
 * Fail-before: on the old code every call pays, so the 11th thought still
 * earns +2 and the 11th Mind entry still earns +6.
 *
 * Out of scope here by design: the review-grading cap stays client-side
 * (REG-197 covers only the retry-ambiguity case, not the cap).
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

const headers = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });

describe("REG-051 — server-enforced per-day earn caps", () => {
  it("manual thought earns stop at the daily cap (add/dismiss/add loop pays no more)", async () => {
    const fuelBefore = new EconomyRepo(ctx.handle, spaceId).get();
    let paid = 0;
    for (let i = 0; i < EARN_THOUGHT_DAILY_CAP + 1; i++) {
      const res = await fetch(`${base}/api/working`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text: `loop thought ${i}`, source: "manual" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: number; fuelEarned: number };
      paid += body.fuelEarned;
      // The loop's dismiss half: the thought is gone, so a re-add is a fresh
      // row — only the server-side count can see the cycle.
      const del = await fetch(`${base}/api/working/${body.id}`, { method: "DELETE", headers: headers() });
      expect(del.status).toBe(200);
      if (i < EARN_THOUGHT_DAILY_CAP) expect(body.fuelEarned).toBe(EARN_THOUGHT);
      else expect(body.fuelEarned).toBe(0);
    }
    expect(paid).toBe(EARN_THOUGHT * EARN_THOUGHT_DAILY_CAP);
    expect(new EconomyRepo(ctx.handle, spaceId).get()).toBeCloseTo(
      Math.min(fuelBefore + EARN_THOUGHT * EARN_THOUGHT_DAILY_CAP, 200),
      5,
    );
  });

  it("Mind creation earns stop at the daily cap (create/delete/create loop pays no more)", async () => {
    const fuelBefore = new EconomyRepo(ctx.handle, spaceId).get();
    let paid = 0;
    for (let i = 0; i < EARN_MIND_DAILY_CAP + 1; i++) {
      const res = await fetch(`${base}/api/cognitive`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ kind: "goal", label: `loop goal ${i}` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: number; fuelEarned: number };
      paid += body.fuelEarned;
      const del = await fetch(`${base}/api/nodes/${body.id}`, { method: "DELETE", headers: headers() });
      expect(del.status).toBe(200);
      if (i < EARN_MIND_DAILY_CAP) expect(body.fuelEarned).toBe(EARN_MIND);
      else expect(body.fuelEarned).toBe(0);
    }
    expect(paid).toBe(EARN_MIND * EARN_MIND_DAILY_CAP);
    expect(new EconomyRepo(ctx.handle, spaceId).get()).toBeCloseTo(
      Math.min(fuelBefore + EARN_MIND * EARN_MIND_DAILY_CAP, 200),
      5,
    );
  });

  it("system-seeded thoughts still earn nothing (the anti-farm intent is unchanged)", async () => {
    const res = await fetch(`${base}/api/working`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: "seeded by chat", source: "chat" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { fuelEarned: number }).fuelEarned).toBe(0);
  });
});
