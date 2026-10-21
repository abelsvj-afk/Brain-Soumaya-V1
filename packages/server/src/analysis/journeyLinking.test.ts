import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM, upsertEmbedding, upsertJourneyEmbedding } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { suggestJourneys, hydrateJourneyLinks } from "./journeyLinking.js";

/** Journeys connective-tissue (docs/specs/journeys-connective-tissue.md): capture-time
 *  auto-link/suggestion + detail-view link hydration. */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

/** A unit vector at a controlled angle from the e0 axis, so its cosine similarity to a
 *  pure e0 = [1,0,0,...] embedding is EXACTLY `cosTheta` — precise control over the
 *  bucketing thresholds without depending on the hash embedder's text-derived output. */
function unitVec(cosTheta: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[0] = cosTheta;
  v[1] = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  return v;
}

function makeNode(spaceId: string): number {
  return Number(
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'n', 'knowledge', 'c')`)
      .run(spaceId).lastInsertRowid,
  );
}
function makeIncome(spaceId: string, platform: string): number {
  return Number(
    handle.sqlite
      .prepare(`INSERT INTO fin_income (space_id, date, net_cents, platform) VALUES (?, '2026-01-01', 5000, ?)`)
      .run(spaceId, platform).lastInsertRowid,
  );
}
function makeExpense(spaceId: string, merchant: string): number {
  return Number(
    handle.sqlite
      .prepare(`INSERT INTO fin_expense (space_id, date, amount_cents, merchant) VALUES (?, '2026-01-01', 500, ?)`)
      .run(spaceId, merchant).lastInsertRowid,
  );
}
function makeBill(spaceId: string, name: string): number {
  return Number(
    handle.sqlite
      .prepare(`INSERT INTO fin_bill (space_id, name, amount_cents, anchor_date) VALUES (?, ?, 12000, '2026-01-01')`)
      .run(spaceId, name).lastInsertRowid,
  );
}

describe("suggestJourneys — node kind (embedding-based)", () => {
  it("buckets a >=0.72 similarity match into autoLink", () => {
    const j = new JourneysRepo(handle, "s1").create({ title: "Become an RN" });
    upsertJourneyEmbedding(handle.sqlite, j.id, unitVec(1));
    const nodeId = makeNode("s1");
    upsertEmbedding(handle.sqlite, nodeId, unitVec(0.9));

    const result = suggestJourneys(ctx, "s1", "node", nodeId);
    expect(result.autoLink.map((s) => s.journey.id)).toEqual([j.id]);
    expect(result.suggested).toHaveLength(0);
  });

  it("buckets a 0.40-0.72 similarity match into suggested", () => {
    const j = new JourneysRepo(handle, "s1").create({ title: "Get Healthy" });
    upsertJourneyEmbedding(handle.sqlite, j.id, unitVec(1));
    const nodeId = makeNode("s1");
    upsertEmbedding(handle.sqlite, nodeId, unitVec(0.55));

    const result = suggestJourneys(ctx, "s1", "node", nodeId);
    expect(result.autoLink).toHaveLength(0);
    expect(result.suggested.map((s) => s.journey.id)).toEqual([j.id]);
  });

  it("shows nothing below the suggest floor", () => {
    const j = new JourneysRepo(handle, "s1").create({ title: "Weak Match" });
    upsertJourneyEmbedding(handle.sqlite, j.id, unitVec(1));
    const nodeId = makeNode("s1");
    upsertEmbedding(handle.sqlite, nodeId, unitVec(0.1));

    const result = suggestJourneys(ctx, "s1", "node", nodeId);
    expect(result.autoLink).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
  });

  it("returns nothing when the node has no stored embedding", () => {
    const nodeId = makeNode("s1");
    expect(suggestJourneys(ctx, "s1", "node", nodeId)).toEqual({ autoLink: [], suggested: [] });
  });

  it("never crosses spaces", () => {
    const j = new JourneysRepo(handle, "alice").create({ title: "Alice's Journey" });
    upsertJourneyEmbedding(handle.sqlite, j.id, unitVec(1));
    const nodeId = makeNode("bob");
    upsertEmbedding(handle.sqlite, nodeId, unitVec(0.9));

    const result = suggestJourneys(ctx, "bob", "node", nodeId);
    expect(result.autoLink).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
  });
});

describe("suggestJourneys — finance kinds (keyword heuristic, never autoLink)", () => {
  it("suggests a Journey whose title/description shares a keyword with the expense", () => {
    const j = new JourneysRepo(handle, "s1").create({ title: "Buy My First Home", description: "Saving for a down payment" });
    new JourneysRepo(handle, "s1").create({ title: "Learn Guitar" });
    const expenseId = makeExpense("s1", "Home Depot");

    const result = suggestJourneys(ctx, "s1", "expense", expenseId);
    expect(result.autoLink).toHaveLength(0); // finance NEVER auto-links, however strong the overlap
    expect(result.suggested.map((s) => s.journey.id)).toEqual([j.id]);
  });

  it("suggests nothing when no keywords overlap", () => {
    new JourneysRepo(handle, "s1").create({ title: "Learn Guitar" });
    const expenseId = makeExpense("s1", "Grocery Store");
    expect(suggestJourneys(ctx, "s1", "expense", expenseId).suggested).toHaveLength(0);
  });

  it("applies the same heuristic to income and bill kinds", () => {
    const j = new JourneysRepo(handle, "s1").create({ title: "Freelance Career" });
    const incomeId = makeIncome("s1", "Freelance client");
    const billId = makeBill("s1", "Freelance software subscription");
    expect(suggestJourneys(ctx, "s1", "income", incomeId).suggested.map((s) => s.journey.id)).toEqual([j.id]);
    expect(suggestJourneys(ctx, "s1", "bill", billId).suggested.map((s) => s.journey.id)).toEqual([j.id]);
  });
});

describe("hydrateJourneyLinks", () => {
  it("hydrates a node link with its label", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    const nodeId = makeNode("s1"); // label = 'n'
    repo.link(j.id, "node", nodeId);

    const out = hydrateJourneyLinks(ctx, "s1", repo.links(j.id));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "node", refId: nodeId, label: "n" });
    expect(out[0]?.linkedAt).toBe(repo.links(j.id)[0]!.createdAt); // CL-10: link date rides along
  });

  it("hydrates income/expense with label+amount+occurredAt, and bill with no occurredAt", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    const incomeId = makeIncome("s1", "Uber");
    const expenseId = makeExpense("s1", "Costco");
    const billId = makeBill("s1", "Netflix");
    repo.link(j.id, "income", incomeId);
    repo.link(j.id, "expense", expenseId);
    repo.link(j.id, "bill", billId);

    const byKind = Object.fromEntries(hydrateJourneyLinks(ctx, "s1", repo.links(j.id)).map((r) => [r.kind, r]));
    expect(byKind.income).toMatchObject({ label: "Uber", amount: 5000, occurredAt: "2026-01-01" });
    expect(byKind.expense).toMatchObject({ label: "Costco", amount: 500, occurredAt: "2026-01-01" });
    expect(byKind.bill).toMatchObject({ label: "Netflix", amount: 12000 });
    expect(byKind.bill?.occurredAt).toBeUndefined();
  });

  it("silently skips a dangling ref (the linked row was deleted after linking)", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    const nodeId = makeNode("s1");
    repo.link(j.id, "node", nodeId);
    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(nodeId);

    expect(hydrateJourneyLinks(ctx, "s1", repo.links(j.id))).toHaveLength(0);
  });

  it("never crosses spaces", () => {
    const repo = new JourneysRepo(handle, "alice");
    const j = repo.create({ title: "J" });
    const nodeId = makeNode("alice");
    repo.link(j.id, "node", nodeId);

    expect(hydrateJourneyLinks(ctx, "bob", repo.links(j.id))).toHaveLength(0);
  });
});

describe("hydrateJourneyLinks — IM-86 remainder (task/chat/achievement)", () => {
  it("hydrates a task link from its action node: real label, node date, fly-to id, link date", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    const nodeId = makeNode("s1"); // label = 'n'
    repo.link(j.id, "task", nodeId);

    const [summary] = hydrateJourneyLinks(ctx, "s1", repo.links(j.id));
    expect(summary).toMatchObject({ kind: "task", refId: nodeId, label: "n", nodeRefId: nodeId });
    expect(summary?.occurredAt).toBeTruthy(); // the node's created_at (makeNode sets no occurred_at)
    expect(summary?.linkedAt).toBe(repo.links(j.id)[0]!.createdAt);
  });

  it("an unresolvable task link still renders as a per-link row — generic label, link date, no fabricated title", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    repo.link(j.id, "task", 4242); // no such node

    const [summary] = hydrateJourneyLinks(ctx, "s1", repo.links(j.id));
    expect(summary).toMatchObject({ kind: "task", refId: 4242, label: "Linked task" });
    expect(summary?.nodeRefId).toBeUndefined();
    expect(summary?.linkedAt).toBeTruthy();
  });

  it("chat and achievement links render as per-link rows with the link's own date", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    repo.link(j.id, "chat", 11);
    repo.link(j.id, "achievement", 12);

    const byKind = Object.fromEntries(hydrateJourneyLinks(ctx, "s1", repo.links(j.id)).map((r) => [r.kind, r]));
    expect(byKind.chat).toMatchObject({ label: "Linked chat", refId: 11 });
    expect(byKind.achievement).toMatchObject({ label: "Linked achievement", refId: 12 });
    expect(byKind.chat?.linkedAt).toBeTruthy();
    expect(byKind.achievement?.linkedAt).toBeTruthy();
  });

  it("every hydrated summary carries the link's own created_at as linkedAt", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "J" });
    const nodeId = makeNode("s1");
    repo.link(j.id, "node", nodeId);

    const [summary] = hydrateJourneyLinks(ctx, "s1", repo.links(j.id));
    expect(summary?.linkedAt).toBe(repo.links(j.id)[0]!.createdAt);
  });
});
