import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { buildContext } from "../context.js";
import { createApp } from "../api/server.js";
import { dueForReview, gradeReview, snoozeReview } from "../analysis/review.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/**
 * Batch G (Recall + Declutter) regression tests.
 * REG-196 (RC-03): GET /review/due must return the TRUE due total, not a
 *   silently capped 20.
 * REG-198 (RC-05): tending a nudged memory clears the nudge snooze; tending
 *   must never disturb a grade-set SM-2 schedule.
 */
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

function mem(label: string, createdAt: string, importance = 0.5): number {
  const info = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES ('legacy', ?, 'daily', ?, ?, ?)`)
    .run(label, label, importance, createdAt);
  return Number(info.lastInsertRowid);
}

function reviewRow(id: number): { next_review_at: string | null; review_snoozed_at: string | null } {
  return handle.sqlite
    .prepare(`SELECT next_review_at, review_snoozed_at FROM nodes WHERE id = ?`)
    .get(id) as { next_review_at: string | null; review_snoozed_at: string | null };
}

describe("REG-198 — a nudge snooze is cleared by tending, never by accident", () => {
  it("snoozeReview marks the snooze and hides the memory; tending it clears the snooze and it is due again", () => {
    const now = Date.now();
    const id = mem("nudged one", iso(now - 5 * DAY));
    expect(dueForReview(ctx, "legacy", now).map((d) => d.id)).toContain(id);

    snoozeReview(ctx, "legacy", id, now);
    const snoozed = reviewRow(id);
    expect(snoozed.next_review_at).toBe(iso(now + 3 * DAY));
    expect(snoozed.review_snoozed_at).not.toBeNull();
    expect(dueForReview(ctx, "legacy", now).map((d) => d.id)).not.toContain(id);

    expect(new NodesRepo(handle, "legacy").tend(id)).toBe(true);
    const tended = reviewRow(id);
    expect(tended.review_snoozed_at).toBeNull();
    expect(Date.parse(tended.next_review_at ?? "")).toBeLessThanOrEqual(Date.now());
    expect(dueForReview(ctx, "legacy", Date.now()).map((d) => d.id)).toContain(id);
  });

  it("tending a memory with a grade-set schedule leaves that schedule exactly alone", () => {
    const now = Date.now();
    const id = mem("graded one", iso(now - 5 * DAY));
    gradeReview(ctx, "legacy", id, true, now); // next review in 1 day
    const before = reviewRow(id);
    expect(before.review_snoozed_at).toBeNull();
    expect(dueForReview(ctx, "legacy", now).map((d) => d.id)).not.toContain(id);

    expect(new NodesRepo(handle, "legacy").tend(id)).toBe(true);
    const after = reviewRow(id);
    expect(after.next_review_at).toBe(before.next_review_at);
    expect(after.review_snoozed_at).toBeNull();
    expect(dueForReview(ctx, "legacy", now).map((d) => d.id)).not.toContain(id);
  });

  it("grading clears a nudge snooze marker — the grade supersedes the snooze", () => {
    const now = Date.now();
    const id = mem("nudged then graded", iso(now - 5 * DAY));
    snoozeReview(ctx, "legacy", id, now);
    expect(reviewRow(id).review_snoozed_at).not.toBeNull();

    gradeReview(ctx, "legacy", id, true, now);
    const row = reviewRow(id);
    expect(row.review_snoozed_at).toBeNull();
    expect(row.next_review_at).toBe(iso(now + DAY)); // the grade's own schedule, not the snooze's
  });
});

describe("REG-196 / REG-198 — review routes", () => {
  let rctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    rctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(rctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "batchg", passcode: "secret123", name: "batchg" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });

  afterAll(() => {
    server?.close();
    rctx.handle.sqlite.close();
  });

  it("GET /review/due returns the true due total — 25 due memories, not a capped 20", async () => {
    const old = new Date(Date.now() - 5 * DAY).toISOString();
    for (let i = 0; i < 25; i++) {
      rctx.handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, ?, 'daily', ?, 0.5, ?)`)
        .run(spaceId, `due memory ${i}`, `due memory ${i}`, old);
    }
    const res = await fetch(`${base}/api/review/due`, { headers: { "x-space-id": spaceId } });
    expect(res.status).toBe(200);
    const due = (await res.json()) as Array<{ id: number }>;
    expect(due).toHaveLength(25);
  });

  it("POST /nodes/:id/tend clears a nudge snooze over HTTP, so the memory returns to the due list", async () => {
    const old = new Date(Date.now() - 5 * DAY).toISOString();
    const info = rctx.handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES (?, ?, 'daily', ?, 0.5, ?)`)
      .run(spaceId, "nudged over http", "nudged over http", old);
    const id = Number(info.lastInsertRowid);

    snoozeReview(rctx, spaceId, id, Date.now());
    const dueBefore = (await (await fetch(`${base}/api/review/due`, { headers: { "x-space-id": spaceId } })).json()) as Array<{ id: number }>;
    expect(dueBefore.map((d) => d.id)).not.toContain(id);

    const tend = await fetch(`${base}/api/nodes/${id}/tend`, { method: "POST", headers: { "x-space-id": spaceId } });
    expect(tend.status).toBe(200);
    expect(((await tend.json()) as { ok: boolean }).ok).toBe(true);

    const dueAfter = (await (await fetch(`${base}/api/review/due`, { headers: { "x-space-id": spaceId } })).json()) as Array<{ id: number }>;
    expect(dueAfter.map((d) => d.id)).toContain(id);
  });
});
