import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { EconomyRepo } from "../economy.js";

/**
 * REG-197 (RC-04): a grade the server committed but the client never heard
 * is re-graded (+3 fuel twice, SM-2 run twice). The grade POST carries an
 * idempotency key per attempt (see
 * ~/workspace/ui-audit/reg197-grade-idempotency-design-note.md); a retry
 * replays the committed outcome without re-paying or re-running SM-2.
 *
 * Fail-before: on the old code the route ignores `attemptKey`, so the second
 * POST grades and pays again (review_count +2, fuel +6 for one attempt).
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

function fuel(): number {
  return new EconomyRepo(ctx.handle, spaceId).get();
}

function reviewState(id: number): { count: number; interval: number | null } {
  const row = ctx.handle.sqlite
    .prepare(`SELECT review_count AS count, review_interval_days AS interval FROM nodes WHERE id = ?`)
    .get(id) as { count: number; interval: number | null };
  return row;
}

async function grade(id: number, remembered: boolean, attemptKey?: string) {
  const res = await fetch(`${base}/api/review/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify(attemptKey ? { remembered, attemptKey } : { remembered }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe("REG-197 — grade POST idempotency", () => {
  it("a retried grade applies once: same outcome replayed, no second pay, no second SM-2 run", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const id = Number(
      ctx.handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, ?, 'daily', ?, 0.5, ?)`)
        .run(spaceId, "the studio lease", "lease", old).lastInsertRowid,
    );
    const fuelBefore = fuel();
    const first = await grade(id, true, "attempt-1");
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    const afterFirst = reviewState(id);
    expect(afterFirst.count).toBe(1);
    const fuelAfterFirst = fuel();
    expect(fuelAfterFirst).toBeGreaterThan(fuelBefore);

    // The retry: same key, same grade — the committed outcome, replayed.
    const retry = await grade(id, true, "attempt-1");
    expect(retry.status).toBe(200);
    expect(retry.body.ok).toBe(true);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.nextReviewAt).toBe(first.body.nextReviewAt);
    expect(retry.body.fuelEarned).toBe(first.body.fuelEarned);
    expect(reviewState(id).count).toBe(afterFirst.count);
    expect(reviewState(id).interval).toBe(afterFirst.interval);
    expect(fuel()).toBeCloseTo(fuelAfterFirst, 5);

    // Same key, flipped grade: a protocol violation — refused, nothing moves.
    const conflict = await grade(id, false, "attempt-1");
    expect(conflict.status).toBe(409);
    expect(reviewState(id).count).toBe(afterFirst.count);
    expect(fuel()).toBeCloseTo(fuelAfterFirst, 5);

    // A fresh key is a genuinely new grade and applies normally.
    const second = await grade(id, true, "attempt-2");
    expect(second.status).toBe(200);
    expect(second.body.duplicate).not.toBe(true);
    expect(reviewState(id).count).toBe(2);
    expect(fuel()).toBeGreaterThan(fuelAfterFirst);
  });

  it("a grade with no key behaves exactly as before", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const id = Number(
      ctx.handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, ?, 'daily', ?, 0.5, ?)`)
        .run(spaceId, "second lease", "lease2", old).lastInsertRowid,
    );
    const res = await grade(id, true);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(reviewState(id).count).toBe(1);
  });
});
