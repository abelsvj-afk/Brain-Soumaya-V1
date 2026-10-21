import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";
import { proactiveContextSnapshotText } from "../analysis/proactiveContext.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinBucketRepo } from "../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";
import { UsageTracker } from "../usage.js";
import type { ToolContext } from "../agent/tools/types.js";
import { billRiskTool } from "../agent/tools/billRisk.js";
import { goalFundingTrendTool } from "../agent/tools/goalFundingTrend.js";
import { runToolRouter } from "../agent/tools/router.js";

/**
 * Phase Z — bill_risk as the second Proactive → Chat source
 * (docs/specs/soumaya-bill-risk-proactive-source.md). Proves `{source, targetId}`
 * (Phase Y) generalizes cleanly to a second, independent proactive signal by driving the
 * same real entry points Phase Y's own test suite used: the real `chat()` function, the
 * real `/api/chat` HTTP route, and the real `runToolRouter()`.
 */

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const llm = new HeuristicProvider();
const SPACE = "s1";
const OTHER_SPACE = "s2";
// Midday UTC: the same calendar day (Sat 2026-01-10) in the space's own
// timezone (America/New_York) — midnight UTC is still Jan 9 in Florida, and
// day-boundary logic follows the space's local day (owner rule 2026-10-21).
const NOW = Date.parse("2026-01-10T12:00:00Z");
const DAY_MS = 86_400_000;

beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); });

/** Mirrors billRisk.test.ts's own fixture exactly: a balance thin enough that the
 *  earliest non-autopay bill is "tight" (pace or short mode), with an income cadence
 *  that reaches the bill's due date. */
function makeTightBudget(
  spaceId: string,
  opts: { balanceCents: number; billName: string; billAmountCents: number; dueDate: string; autopay?: boolean },
): number {
  new FinAccountRepo(handle, spaceId).setBalance(opts.balanceCents);
  const inc = new FinIncomeRepo(handle, spaceId);
  inc.create({ date: "2026-01-01", netCents: 1000 });
  inc.create({ date: "2026-01-10", netCents: 1000 });
  const bill = new FinBillRepo(handle, spaceId).create({
    name: opts.billName, amountCents: opts.billAmountCents, frequency: "monthly", anchorDate: opts.dueDate, autopay: opts.autopay,
  });
  return bill.id;
}

function makeGoal(spaceId: string, name: string): number {
  const bucket = new FinBucketRepo(handle, spaceId).create({ name: "Test Bucket" });
  const goal = new FinGoalRepo(handle, spaceId).create({ bucketId: bucket.id, name });
  return goal.id;
}
function makeAllocation(spaceId: string, goalId: number, amountCents: number, daysAgo: number): void {
  const createdAt = new Date(NOW - daysAgo * DAY_MS).toISOString().replace("T", " ").slice(0, 19);
  handle.sqlite
    .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
    .run(spaceId, goalId, amountCents, createdAt);
}
function makeChangingGoalHistory(spaceId: string, goalId: number, oldest: number, middle: number, recent: number): void {
  makeAllocation(spaceId, goalId, oldest, 75);
  makeAllocation(spaceId, goalId, middle, 45);
  makeAllocation(spaceId, goalId, recent, 15);
}

const ctxOf = (): AppContext => ({ handle, embeddings, llm, usage: new UsageTracker(handle) } as AppContext);
const tc = (spaceId = SPACE, now = NOW): ToolContext => ({ ctx: ctxOf(), spaceId, now, notify: async () => {} });

describe("1. Bill-risk detection behaves exactly as before", () => {
  it("still fires (pace mode) for the same fixture shape billRisk.test.ts already covers", () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 35000, billName: "Insurance", billAmountCents: 25000, dueDate: "2026-01-18" });
    const inv = billRiskTool.detect(tc());
    expect(inv).toHaveLength(1);
    expect(inv[0]!.args.mode).toBe("pace");
    expect(inv[0]!.args.billId).toBe(billId);
  });
});

describe("2. Existing bill-risk communication still works", () => {
  it("run() still produces the same deterministic message shape (untouched by the new targets field)", async () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 35000, billName: "Insurance", billAmountCents: 25000, dueDate: "2026-01-18" });
    const res = await billRiskTool.run(tc(), { billId, mode: "pace", threshold: 4200 });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Insurance/);
    expect(res.message).toMatch(/Heads up/);
  });
});

describe("3. Eligible bill-risk result contains the correct bill target", () => {
  it("run()'s ToolResult.targets is exactly [billId] — Phase X's convention, generalized", async () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const res = await billRiskTool.run(tc(), { billId, mode: "short", threshold: 15000 });
    expect(res.targets).toEqual([billId]);
  });
});

describe("4. Dedup suppresses repeated alerts for the same bill (existing once-a-day gate, unaffected)", () => {
  it("a second detect() call the same day returns nothing after the real router logged the first", async () => {
    makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const ctx = ctxOf();
    expect(billRiskTool.detect(tc())).toHaveLength(1);
    await runToolRouter(ctx, SPACE, { now: NOW });
    expect(billRiskTool.detect(tc())).toHaveLength(0);
  });
});

describe("5. Bill A's past firing does not permanently suppress Bill B", () => {
  it("once Bill A is resolved and a new day begins, Bill B's own genuinely new tight signal fires", async () => {
    const ctx = ctxOf();
    // Day 1: Bill A ("Rent", due soonest) is tight and fires; the once-a-day gate blocks
    // anything else bill_risk-related for the rest of that same day.
    const billA = makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    await runToolRouter(ctx, SPACE, { now: NOW });
    expect(billRiskTool.detect(tc())).toHaveLength(0); // same-day gate active

    // Resolve Bill A the realistic way (mark its occurrence paid — the same path a real
    // paid bill takes) and introduce Bill B, due within the same income horizon, which
    // is now the earliest non-autopay reserved bill and is independently tight.
    const occA = handle.sqlite.prepare(`SELECT id FROM fin_bill_occurrence WHERE bill_id = ? AND due_date = '2026-01-18'`).get(billA) as { id: number };
    new FinBillRepo(handle, SPACE).markPaid(occA.id);
    const billB = new FinBillRepo(handle, SPACE).create({ name: "Water", amountCents: 9000, frequency: "monthly", anchorDate: "2026-01-16" });

    // Day 2: the once-a-day gate has reset; Bill B's own signal is not suppressed by
    // Bill A's firing yesterday.
    const nextDay = NOW + DAY_MS;
    const inv = billRiskTool.detect(tc(SPACE, nextDay));
    expect(inv.some((c) => c.args.billId === billB.id)).toBe(true);
  });
});

describe("6. Goal-trend cooldown does not interfere with bill-risk, and vice versa", () => {
  it("both a real goal_trend candidate and a real bill_risk candidate fire in the same tick", async () => {
    const ctx = ctxOf();
    const goalId = makeGoal(SPACE, "Emergency Fund");
    makeChangingGoalHistory(SPACE, goalId, 30_000, 15_000, 5_000);
    makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });

    const results = await runToolRouter(ctx, SPACE, { now: NOW });
    expect(results.some((r) => r.summary.includes("goal funding trend"))).toBe(true);
    expect(results.some((r) => r.summary.includes("bill-risk"))).toBe(true);

    const goalLog = handle.sqlite.prepare(`SELECT targets FROM agent_logs WHERE action = 'tool:goal_trend'`).get() as { targets: string };
    const billLog = handle.sqlite.prepare(`SELECT targets FROM agent_logs WHERE action = 'tool:bill_risk'`).get() as { targets: string };
    expect(JSON.parse(goalLog.targets)).toEqual([goalId]);
    expect(JSON.parse(billLog.targets)[0]).toBeTypeOf("number");
  });
});

describe("7. Proactive context resolves the correct bill", () => {
  it("names the right bill and the right (pace) numbers", () => {
    makeTightBudget(SPACE, { balanceCents: 35000, billName: "Insurance", billAmountCents: 25000, dueDate: "2026-01-18" });
    const billId = billRiskTool.detect(tc())[0]!.args.billId as number;
    const text = proactiveContextSnapshotText(handle, SPACE, { source: "bill_risk", targetId: billId }, new Date(NOW));
    expect(text).toBeTruthy();
    expect(text).toContain("Insurance");
    expect(text).toContain("PROACTIVE CONTEXT");
  });

  it("names the right bill and the right (short) numbers when already over", () => {
    makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const billId = billRiskTool.detect(tc())[0]!.args.billId as number;
    const text = proactiveContextSnapshotText(handle, SPACE, { source: "bill_risk", targetId: billId }, new Date(NOW));
    expect(text).toContain("Rent");
    expect(text).toContain("short");
  });
});

describe("8. Cross-space bill access is rejected", () => {
  it("another space's bill id contributes zero framing and never leaks that space's bill name", async () => {
    const otherBillId = makeTightBudget(OTHER_SPACE, { balanceCents: 10000, billName: "Someone Else's Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const text = proactiveContextSnapshotText(handle, SPACE, { source: "bill_risk", targetId: otherBillId }, new Date(NOW));
    expect(text).toBeNull();

    const result = await chat(handle, { embeddings, llm }, "What's going on?", DEFAULT_CHAT, SPACE, [], null, { source: "bill_risk", targetId: otherBillId });
    expect(result.answer).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("Someone Else's Rent");
  });
});

describe("9. Deleted/stale bill fails safely", () => {
  it("a bill deleted after firing degrades to no framing, not an error", async () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 10000, billName: "Temp Bill", billAmountCents: 25000, dueDate: "2026-01-18" });
    handle.sqlite.prepare(`DELETE FROM fin_bill WHERE id = ?`).run(billId);
    expect(proactiveContextSnapshotText(handle, SPACE, { source: "bill_risk", targetId: billId }, new Date(NOW))).toBeNull();

    const result = await chat(handle, { embeddings, llm }, "What's up?", DEFAULT_CHAT, SPACE, [], null, { source: "bill_risk", targetId: billId });
    expect(result.answer).toBeTruthy();
  });

  it("a nonexistent bill id contributes nothing and the turn still succeeds", async () => {
    const result = await chat(handle, { embeddings, llm }, "What's up?", DEFAULT_CHAT, SPACE, [], null, { source: "bill_risk", targetId: 999999 });
    expect(result.answer).toBeTruthy();
  });
});

describe("10. Bill-risk context reaches the real /api/chat path (full chain)", () => {
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "phaseZ", passcode: "secret123", name: "phaseZ" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  it("real runToolRouter() -> agent_logs.targets -> real /api/chat with {source:'bill_risk', targetId}", async () => {
    new FinAccountRepo(ctx.handle, spaceId).setBalance(10000);
    const inc = new FinIncomeRepo(ctx.handle, spaceId);
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    const bill = new FinBillRepo(ctx.handle, spaceId).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });

    await runToolRouter(ctx, spaceId, { now: NOW });
    const log = ctx.handle.sqlite
      .prepare(`SELECT targets FROM agent_logs WHERE space_id = ? AND action = 'tool:bill_risk' ORDER BY id DESC LIMIT 1`)
      .get(spaceId) as { targets: string } | undefined;
    expect(log).toBeTruthy();
    expect(JSON.parse(log!.targets)).toEqual([bill.id]);

    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify({ question: "why are you bringing this up?", proactiveContext: { source: "bill_risk", targetId: bill.id } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string };
    expect(body.answer).toBeTruthy();
  });
});

describe("11. Chat re-derives authoritative info instead of trusting stale payload state", () => {
  it("once the shortfall is resolved (balance topped up), the SAME targetId asserts no risk", async () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const ctx = ctxOf();
    await runToolRouter(ctx, SPACE, { now: NOW }); // fires while genuinely tight

    // The user (or another income event) resolves the shortfall before opening Chat.
    new FinAccountRepo(handle, SPACE).setBalance(500000);

    const text = proactiveContextSnapshotText(handle, SPACE, { source: "bill_risk", targetId: billId }, new Date(NOW));
    expect(text).toBeNull(); // re-derived fresh — no longer tight, so no framing asserted

    const result = await chat(handle, { embeddings, llm }, "Why did you message me?", DEFAULT_CHAT, SPACE, [], null, { source: "bill_risk", targetId: billId });
    expect(result.answer).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("PROACTIVE CONTEXT");
  });
});

describe("12. Ordinary Chat without proactive context remains unchanged", () => {
  it("omitting proactiveContext behaves identically to passing null, even with bill data present", async () => {
    makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const omitted = await chat(handle, { embeddings, llm }, "What's up?", DEFAULT_CHAT, SPACE, []);
    const explicitNull = await chat(handle, { embeddings, llm }, "What's up?", DEFAULT_CHAT, SPACE, [], null, null);
    expect(omitted.contextIds.sort()).toEqual(explicitNull.contextIds.sort());
  });
});

describe("13. No permanent memory/transcript pollution", () => {
  it("a chat() call carrying bill_risk proactiveContext writes zero new nodes/agent_logs rows", async () => {
    const billId = makeTightBudget(SPACE, { balanceCents: 10000, billName: "Rent", billAmountCents: 25000, dueDate: "2026-01-18" });
    const nodesBefore = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes`).get() as { n: number };
    const logsBefore = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_logs`).get() as { n: number };
    await chat(handle, { embeddings, llm }, "What's up?", DEFAULT_CHAT, SPACE, [], null, { source: "bill_risk", targetId: billId });
    const nodesAfter = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes`).get() as { n: number };
    const logsAfter = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_logs`).get() as { n: number };
    expect(nodesAfter.n).toBe(nodesBefore.n);
    expect(logsAfter.n).toBe(logsBefore.n);
  });
});

describe("14. Existing Phase X goal-trend behavior remains intact", () => {
  it("goalFundingTrendTool.detect() still finds a real two-period decrease", () => {
    const goalId = makeGoal(SPACE, "Emergency Fund");
    makeChangingGoalHistory(SPACE, goalId, 30_000, 15_000, 5_000);
    const inv = goalFundingTrendTool.detect(tc());
    expect(inv).toHaveLength(1);
    expect(inv[0]!.args.goalId).toBe(goalId);
  });
});

describe("15. Existing Phase Y goal_trend -> Chat behavior remains intact", () => {
  it("chat() still accepts a goal_trend proactiveContext and answers normally", async () => {
    const goalId = makeGoal(SPACE, "Emergency Fund");
    makeChangingGoalHistory(SPACE, goalId, 30_000, 15_000, 5_000);
    const result = await chat(handle, { embeddings, llm }, "Why are you telling me this?", DEFAULT_CHAT, SPACE, [], null, { source: "goal_trend", targetId: goalId });
    expect(result.answer).toBeTruthy();
  });
});
