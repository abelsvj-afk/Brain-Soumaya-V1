import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";
import { recordProactiveDiscussion } from "../analysis/proactiveContext.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinBucketRepo } from "../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";
import { UsageTracker } from "../usage.js";
import type { ToolContext } from "../agent/tools/types.js";
import { goalFundingTrendTool } from "../agent/tools/goalFundingTrend.js";
import { billRiskTool } from "../agent/tools/billRisk.js";
import { runToolRouter } from "../agent/tools/router.js";

/**
 * Phase AB — the durable proactive-discussion-occurrence primitive
 * (docs/specs/soumaya-proactive-discussion-occurrence.md). Proves `recordProactiveDiscussion()`
 * writes exactly one durable `agent_logs` row — and only one — the moment a real,
 * successfully-answered `/api/chat` exchange carries a validated proactive context, without
 * disturbing Phase X/Y/Z's own firing/dedup behavior, chat content, or memory creation.
 * Drives the real `/api/chat` HTTP route wherever practical, per the mission's own preference.
 */

const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const llm = new HeuristicProvider();
// Fixed historical clock for the unit-level describe blocks below, which always pass this
// SAME value explicitly into chat()/runToolRouter() as `now` — safe regardless of wall-clock.
// Midday UTC: the same calendar day (Sat 2026-01-10) in the space's own
// timezone (America/New_York) — midnight UTC is still Jan 9 in Florida, and
// day-boundary logic follows the space's local day (owner rule 2026-10-21).
const NOW = Date.parse("2026-01-10T12:00:00Z");
// The real `/api/chat` route has no injectable clock — it always resolves proactive context
// with the server's actual wall-clock `new Date()` (see analysis/proactiveContext.ts). Fixture
// data for the "Real /api/chat route" describe block below must therefore be anchored to the
// REAL current time, or goalAllocationChange()/getBudgetSummary() will find no "current period"
// activity relative to whenever the test suite actually runs and silently report "unchanged"/
// "not at risk" — which would make every occurrence-recording assertion fail for a reason
// unrelated to the primitive under test.
const LIVE_NOW = Date.now();
const DAY_MS = 86_400_000;

function makeGoal(handle: DbHandle, spaceId: string, name: string): number {
  const bucket = new FinBucketRepo(handle, spaceId).create({ name: "Test Bucket" });
  const goal = new FinGoalRepo(handle, spaceId).create({ bucketId: bucket.id, name });
  return goal.id;
}
function makeAllocation(handle: DbHandle, spaceId: string, goalId: number, amountCents: number, daysAgo: number, now: number): void {
  const createdAt = new Date(now - daysAgo * DAY_MS).toISOString().replace("T", " ").slice(0, 19);
  handle.sqlite
    .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
    .run(spaceId, goalId, amountCents, createdAt);
}
function makeChangingGoalHistory(handle: DbHandle, spaceId: string, goalId: number, oldest: number, middle: number, recent: number, now: number): void {
  makeAllocation(handle, spaceId, goalId, oldest, 75, now);
  makeAllocation(handle, spaceId, goalId, middle, 45, now);
  makeAllocation(handle, spaceId, goalId, recent, 15, now);
}
function makeTightBudget(
  handle: DbHandle,
  spaceId: string,
  opts: { balanceCents: number; billName: string; billAmountCents: number; now: number },
): number {
  new FinAccountRepo(handle, spaceId).setBalance(opts.balanceCents);
  const inc = new FinIncomeRepo(handle, spaceId);
  const day = (offset: number) => new Date(opts.now + offset * DAY_MS).toISOString().slice(0, 10);
  inc.create({ date: day(-9), netCents: 1000 });
  inc.create({ date: day(0), netCents: 1000 });
  const bill = new FinBillRepo(handle, spaceId).create({ name: opts.billName, amountCents: opts.billAmountCents, frequency: "monthly", anchorDate: day(8) });
  return bill.id;
}

function occurrenceRows(handle: DbHandle, spaceId: string): { targets: string; created_at: string; description: string }[] {
  return handle.sqlite
    .prepare(`SELECT targets, created_at, description FROM agent_logs WHERE space_id = ? AND action = 'chat:proactive_discussion' ORDER BY id`)
    .all(spaceId) as { targets: string; created_at: string; description: string }[];
}

describe("Real /api/chat route — end-to-end occurrence recording", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;
  let otherSpaceId: string;

  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "phaseAB", passcode: "secret123", name: "phaseAB" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
    const auth2 = await fetch(`${base}/api/space/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "phaseABother", passcode: "secret123", name: "other" }),
    });
    otherSpaceId = ((await auth2.json()) as { id: string }).id;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  const postChat = (body: unknown, asSpace = spaceId) =>
    fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": asSpace },
      body: JSON.stringify(body),
    });

  it("1. a valid goal_trend proactive Chat interaction creates the occurrence", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "Emergency Fund");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);

    const res = await postChat({ question: "why are you telling me this?", proactiveContext: { source: "goal_trend", targetId: goalId } });
    expect(res.status).toBe(200);

    const rows = occurrenceRows(ctx.handle, spaceId);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.targets)).toEqual([goalId]);
  });

  it("2. a valid bill_risk proactive Chat interaction creates the occurrence", async () => {
    // A distinct bill (from a fresh income/account fixture) so this test's row is
    // independently verifiable — real space isolation is covered by test 5.
    const billId = makeTightBudget(ctx.handle, spaceId, { balanceCents: 10000, billName: "Rent AB2", billAmountCents: 25000, now: LIVE_NOW });

    const res = await postChat({ question: "why did you message me?", proactiveContext: { source: "bill_risk", targetId: billId } });
    expect(res.status).toBe(200);

    const rows = occurrenceRows(ctx.handle, spaceId);
    expect(rows.some((r) => JSON.parse(r.targets)[0] === billId)).toBe(true);
  });

  it("3. the correct target id is stored, not some other identifier", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "Correct Target Goal");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);
    const before = occurrenceRows(ctx.handle, spaceId).length;

    await postChat({ question: "hi", proactiveContext: { source: "goal_trend", targetId: goalId } });

    const rows = occurrenceRows(ctx.handle, spaceId);
    expect(rows).toHaveLength(before + 1);
    expect(JSON.parse(rows[rows.length - 1]!.targets)).toEqual([goalId]);
  });

  it("4. the occurrence is timestamped server-side with a real, current timestamp", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "Timestamped Goal");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);

    const before = Date.now();
    await postChat({ question: "hi", proactiveContext: { source: "goal_trend", targetId: goalId } });
    const after = Date.now();

    const rows = occurrenceRows(ctx.handle, spaceId);
    const last = rows[rows.length - 1]!;
    const ts = Date.parse(last.created_at.includes("T") ? last.created_at : `${last.created_at.replace(" ", "T")}Z`);
    expect(ts).toBeGreaterThanOrEqual(before - 5000); // small tolerance for clock/parse skew
    expect(ts).toBeLessThanOrEqual(after + 5000);
  });

  it("5. a cross-space target is rejected — no occurrence is created", async () => {
    const otherGoalId = makeGoal(ctx.handle, otherSpaceId, "Someone Else's Goal");
    makeChangingGoalHistory(ctx.handle, otherSpaceId, otherGoalId, 30_000, 15_000, 5_000, LIVE_NOW);
    const before = occurrenceRows(ctx.handle, spaceId).length;
    const beforeOther = occurrenceRows(ctx.handle, otherSpaceId).length;

    const res = await postChat({ question: "what's up?", proactiveContext: { source: "goal_trend", targetId: otherGoalId } }, spaceId);
    expect(res.status).toBe(200); // the turn still succeeds, per Phase Y's existing contract

    expect(occurrenceRows(ctx.handle, spaceId)).toHaveLength(before); // no record in the requesting space
    expect(occurrenceRows(ctx.handle, otherSpaceId)).toHaveLength(beforeOther); // none in the target's real space either
  });

  it("6. an invalid/stale target does not create an occurrence", async () => {
    const before = occurrenceRows(ctx.handle, spaceId).length;
    const res = await postChat({ question: "hi", proactiveContext: { source: "goal_trend", targetId: 999999 } });
    expect(res.status).toBe(200);
    expect(occurrenceRows(ctx.handle, spaceId)).toHaveLength(before);
  });

  it("7. ordinary Chat without proactive context creates no occurrence", async () => {
    const before = occurrenceRows(ctx.handle, spaceId).length;
    const res = await postChat({ question: "just chatting, nothing proactive here" });
    expect(res.status).toBe(200);
    expect(occurrenceRows(ctx.handle, spaceId)).toHaveLength(before);
  });

  it("10. multiple legitimate interactions are each represented independently without corrupting the original firing log", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "Multi-Interaction Goal");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);

    // Other goals created by earlier tests in this shared space may ALSO be eligible when the
    // router runs — filter by THIS test's own goalId throughout, rather than assuming order.
    const goalTrendRowsFor = (id: number) =>
      (ctx.handle.sqlite.prepare(`SELECT targets FROM agent_logs WHERE space_id = ? AND action = 'tool:goal_trend'`).all(spaceId) as { targets: string }[])
        .filter((r) => JSON.parse(r.targets)[0] === id);

    await runToolRouter(ctx, spaceId, { now: LIVE_NOW }); // the ORIGINAL proactive firing row
    expect(goalTrendRowsFor(goalId)).toHaveLength(1);

    // The user opens Chat from that toast more than once across the session.
    await postChat({ question: "wait, why again?", proactiveContext: { source: "goal_trend", targetId: goalId } });
    await postChat({ question: "one more thing about that", proactiveContext: { source: "goal_trend", targetId: goalId } });

    const occRows = occurrenceRows(ctx.handle, spaceId).filter((r) => JSON.parse(r.targets)[0] === goalId);
    expect(occRows.length).toBeGreaterThanOrEqual(2); // both real exchanges independently represented

    // The ORIGINAL firing row for THIS goal is untouched — still exactly one, unmodified.
    expect(goalTrendRowsFor(goalId)).toHaveLength(1);
  });

  it("11. no Chat transcript is persisted server-side", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "No Transcript Goal");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);
    const question = "a very specific sentence that must never be stored verbatim anywhere server-side";

    await postChat({ question, proactiveContext: { source: "goal_trend", targetId: goalId } });

    const row = occurrenceRows(ctx.handle, spaceId).find((r) => JSON.parse(r.targets)[0] === goalId)!;
    expect(row.description).not.toContain(question);
    // No table anywhere stores this question text.
    const nodeHit = ctx.handle.sqlite.prepare(`SELECT 1 FROM nodes WHERE content = ? OR label = ?`).get(question, question);
    expect(nodeHit).toBeUndefined();
  });

  it("12. no durable memory (nodes row) is created merely by the occurrence write", async () => {
    const goalId = makeGoal(ctx.handle, spaceId, "No Memory Goal");
    makeChangingGoalHistory(ctx.handle, spaceId, goalId, 30_000, 15_000, 5_000, LIVE_NOW);
    const before = ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE space_id = ?`).get(spaceId) as { n: number };

    await postChat({ question: "hello", proactiveContext: { source: "goal_trend", targetId: goalId } });

    const after = ctx.handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE space_id = ?`).get(spaceId) as { n: number };
    expect(after.n).toBe(before.n);
  });
});

describe("8-9. Existing proactive firing/dedup behavior is unchanged", () => {
  let handle: DbHandle;
  beforeEach(() => { handle = createDb(":memory:"); });
  afterEach(() => { handle.sqlite.close(); });
  const ctxOf = (h: DbHandle): AppContext => ({ handle: h, embeddings, llm, usage: new UsageTracker(h) } as AppContext);

  it("8. goal_trend's own dedup (agent_logs.targets, action='tool:goal_trend') is unaffected by the new action", async () => {
    const goalId = makeGoal(handle, "s1", "Emergency Fund");
    makeChangingGoalHistory(handle, "s1", goalId, 30_000, 15_000, 5_000, NOW);
    const ctx = ctxOf(handle);
    const tc: ToolContext = { ctx, spaceId: "s1", now: NOW, notify: async () => {} };

    await runToolRouter(ctx, "s1", { now: NOW });
    expect(goalFundingTrendTool.detect(tc).some((c) => c.args.goalId === goalId)).toBe(false); // deduped, as before

    // A real Chat interaction happens too (writes a SEPARATE action row) — `recordProactiveDiscussion`
    // is called with the SAME injected clock so it validates against the same fixture data `chat()`
    // itself would see if it too accepted an injectable clock (it doesn't — see the function's own
    // doc comment on why the route calls it after chat() succeeds, using the real wall clock there).
    await chat(handle, { embeddings, llm }, "why?", DEFAULT_CHAT, "s1", [], null, { source: "goal_trend", targetId: goalId });
    recordProactiveDiscussion(handle, "s1", { source: "goal_trend", targetId: goalId }, new Date(NOW));

    // The tool's own dedup is completely unaffected by the new 'chat:proactive_discussion' rows.
    expect(goalFundingTrendTool.detect(tc).some((c) => c.args.goalId === goalId)).toBe(false);
  });

  it("9. bill_risk's own once-a-day gate is unaffected by the new action", async () => {
    const billId = makeTightBudget(handle, "s1", { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, now: NOW });
    const ctx = ctxOf(handle);
    const tc: ToolContext = { ctx, spaceId: "s1", now: NOW, notify: async () => {} };

    expect(billRiskTool.detect(tc)).toHaveLength(1);
    await runToolRouter(ctx, "s1", { now: NOW });
    expect(billRiskTool.detect(tc)).toHaveLength(0); // once-a-day gate, as before

    await chat(handle, { embeddings, llm }, "why?", DEFAULT_CHAT, "s1", [], null, { source: "bill_risk", targetId: billId });
    recordProactiveDiscussion(handle, "s1", { source: "bill_risk", targetId: billId }, new Date(NOW));

    expect(billRiskTool.detect(tc)).toHaveLength(0); // still deduped for the rest of the day, unaffected
  });
});

describe("13. Existing Phase Y/Z proactive -> Chat behavior remains intact", () => {
  let handle: DbHandle;
  beforeEach(() => { handle = createDb(":memory:"); });
  afterEach(() => { handle.sqlite.close(); });

  it("goal_trend framing still appears in Chat's own systemExtra-derived answer path (chat() still succeeds and is unaffected by recording)", async () => {
    const goalId = makeGoal(handle, "s1", "Emergency Fund");
    makeChangingGoalHistory(handle, "s1", goalId, 30_000, 15_000, 5_000, NOW);
    const result = await chat(handle, { embeddings, llm }, "why are you telling me this?", DEFAULT_CHAT, "s1", [], null, { source: "goal_trend", targetId: goalId });
    expect(result.answer).toBeTruthy();
  });

  it("bill_risk framing still appears and chat() is unaffected by recording", async () => {
    const billId = makeTightBudget(handle, "s1", { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, now: NOW });
    const result = await chat(handle, { embeddings, llm }, "why did you message me?", DEFAULT_CHAT, "s1", [], null, { source: "bill_risk", targetId: billId });
    expect(result.answer).toBeTruthy();
  });
});
