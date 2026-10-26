import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { UsageTracker } from "../usage.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { createExpenseEntry } from "../finance/settlement.js";
import { getBudgetSummary } from "../finance/summary.js";
import { moneySky } from "../finance/sky.js";
import {
  markOccurrencePaidCreate,
  markOccurrencePaidMatch,
  removeBill,
  editBill,
  skipOccurrence,
} from "../finance/billLifecycle.js";
import { billRiskTool } from "../agent/tools/billRisk.js";
import type { ToolContext } from "../agent/tools/types.js";
import { createPolicyNotify } from "../agent/notify/boundary.js";
import { setPreference, type NotifyMeta } from "../agent/notify/policy.js";

/**
 * ADR-019 §5 acceptance tests owned by the bill lifecycle: T1–T10, T14
 * (server assertions), T15–T17, T19, T20. Written against public entry
 * points (repos, lifecycle ops, getBudgetSummary, moneySky, billRisk
 * detect/run, the finance routes) so they compile against the pristine
 * base and fail there on behavior. Midday-UTC January dates keep the
 * space-local day (America/New_York, the default) equal to the UTC day
 * except where a test's point is the divergence (T10).
 */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const JAN10 = new Date("2026-01-10T12:00:00Z");
const JAN10_MS = JAN10.getTime();
const TODAY = "2026-01-10";

const balanceOf = (spaceId: string): number => new FinAccountRepo(handle, spaceId).getOrCreate().balanceCents;
const expenseCount = (spaceId: string): number =>
  (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM fin_expense WHERE space_id = ?`).get(spaceId) as { c: number }).c;

/** Income cadence: 2026-01-01 + 2026-01-10 → median gap 9d → next income 2026-01-19. */
function seedCadence(spaceId: string): void {
  const inc = new FinIncomeRepo(handle, spaceId);
  inc.create({ date: "2026-01-01", netCents: 1000 });
  inc.create({ date: "2026-01-10", netCents: 1000 });
}

interface OccRow { id: number; bill_id: number; due_date: string; amount_cents: number; status: string; paid_expense_id: number | null }
const occRows = (spaceId: string, billId: number): OccRow[] =>
  handle.sqlite
    .prepare(`SELECT * FROM fin_bill_occurrence WHERE space_id = ? AND bill_id = ? ORDER BY due_date`)
    .all(spaceId, billId) as OccRow[];
const occRow = (spaceId: string, billId: number, dueDate: string): OccRow =>
  handle.sqlite
    .prepare(`SELECT * FROM fin_bill_occurrence WHERE space_id = ? AND bill_id = ? AND due_date = ?`)
    .get(spaceId, billId, dueDate) as OccRow;

describe("T1: mark paid (create) records a real payment (D1, I2a)", () => {
  it("T1: expense exists and is linked; balance reduced; Safe to Spend unchanged when the occurrence was reserving and never rises", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    bills.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18", category: "housing", payee: "Landlord LLC" });

    const pre = getBudgetSummary(handle, S, JAN10);
    expect(pre.reservedCents).toBe(25000);
    expect(pre.safeToSpendCents).toBe(75000);

    const occ = bills.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;
    const out = markOccurrencePaidCreate(handle, S, occ.id, JAN10);
    expect(out.kind).toBe("paid");
    if (out.kind !== "paid") throw new Error("unreachable");
    expect(out.expense.amountCents).toBe(25000); // the occurrence's snapshot amount
    expect(out.expense.date).toBe(TODAY); // dated the space-local payment day
    expect(out.expense.category).toBe("housing"); // the bill's category
    expect(out.expense.merchant).toBe("Landlord LLC"); // payee ?? name
    expect(out.expense.balanceAppliedAt).not.toBeNull(); // settled at write

    const row = bills.getOccurrence(occ.id)!;
    expect(row.status).toBe("paid");
    expect(row.paidExpenseId).toBe(out.expense.id);
    expect(balanceOf(S)).toBe(75000);

    const post = getBudgetSummary(handle, S, JAN10);
    expect(post.reservedCents).toBe(0);
    expect(post.safeToSpendCents).toBe(pre.safeToSpendCents); // deduction and release cancel
    expect(post.safeToSpendCents).toBeLessThanOrEqual(pre.safeToSpendCents);
  });
});

describe("T2: mark paid (match) counts the obligation once (D1, I3, I2b)", () => {
  it("T2: no second expense, no second deduction; Safe to Spend rises by exactly the released reservation; the expense's settlement state is unchanged", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Insurance", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18", category: "insurance" });

    // The payment already exists as an expense (logged first).
    const exp = createExpenseEntry(handle, S, { date: TODAY, amountCents: 25000, category: "insurance", merchant: "InsCo" }, JAN10);
    expect(balanceOf(S)).toBe(75000);
    const markerBefore = exp.balanceAppliedAt;
    expect(markerBefore).not.toBeNull();

    const pre = getBudgetSummary(handle, S, JAN10);
    expect(pre.reservedCents).toBe(25000);
    expect(pre.safeToSpendCents).toBe(50000); // obligation counted twice pre-match (deduction + reservation)

    const occ = bills.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;
    const out = markOccurrencePaidMatch(handle, S, occ.id, exp.id, JAN10);
    expect(out.kind).toBe("paid");
    expect(expenseCount(S)).toBe(1); // no second expense
    expect(balanceOf(S)).toBe(75000); // no second deduction

    const row = bills.getOccurrence(occ.id)!;
    expect(row.status).toBe("paid");
    expect(row.paidExpenseId).toBe(exp.id);
    // The match changed neither the expense's marker nor its balance effect (I2b).
    expect(new FinExpenseRepo(handle, S).get(exp.id)!.balanceAppliedAt).toBe(markerBefore);

    const post = getBudgetSummary(handle, S, JAN10);
    expect(post.safeToSpendCents - pre.safeToSpendCents).toBe(25000); // exactly the released reservation, no more
    expect(post.safeToSpendCents).toBe(75000);

    // I3: the same expense cannot be matched to a second occurrence.
    const bill2 = bills.create({ name: "Insurance2", amountCents: 9000, frequency: "monthly", anchorDate: "2026-01-19", category: "insurance" });
    getBudgetSummary(handle, S, JAN10);
    const occ2 = bills.upcoming(10, TODAY).find((o) => o.billId === bill2.id)!;
    const linked = markOccurrencePaidMatch(handle, S, occ2.id, exp.id, JAN10);
    expect(linked.kind).toBe("expense-linked");
    expect(bills.getOccurrence(occ2.id)!.status).toBe("upcoming"); // claim rolled back
    expect(balanceOf(S)).toBe(75000);
    expect(bill.id).not.toBe(bill2.id);
  });
});

describe("T3: mid-mark-paid failure rolls everything back (D1, P1 failure rule)", () => {
  it("T3: fault after expense insert → occurrence upcoming, no expense, balance unchanged; retry succeeds cleanly", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    bills.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    getBudgetSummary(handle, S, JAN10);
    const occ = bills.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;

    const spy = vi.spyOn(FinAccountRepo.prototype, "adjustBalance").mockImplementation(() => {
      throw new Error("injected fault after expense insert");
    });
    expect(() => markOccurrencePaidCreate(handle, S, occ.id, JAN10)).toThrow("injected fault");
    spy.mockRestore();

    expect(bills.getOccurrence(occ.id)!.status).toBe("upcoming"); // the claim rolled back too
    expect(bills.getOccurrence(occ.id)!.paidExpenseId).toBeNull();
    expect(expenseCount(S)).toBe(0);
    expect(balanceOf(S)).toBe(100000);

    const retry = markOccurrencePaidCreate(handle, S, occ.id, JAN10);
    expect(retry.kind).toBe("paid");
    expect(expenseCount(S)).toBe(1);
    expect(balanceOf(S)).toBe(75000);
  });
});

describe("T4: Remove cancels the future, preserves history and past-due (D2, P2, I5)", () => {
  it("T4: future occurrences gone from Reserved/Upcoming/Sky; paid history intact; past-due still listed and reserving until resolved", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Storage", amountCents: 20000, frequency: "monthly", anchorDate: "2025-11-15" });
    bills.materialize(bill.id, "2025-11-01", "2026-02-24"); // Nov (history) + Dec (past-due) + Jan/Feb (future)
    const nov = occRow(S, bill.id, "2025-11-15");
    expect(markOccurrencePaidCreate(handle, S, nov.id, JAN10).kind).toBe("paid");
    getBudgetSummary(handle, S, JAN10);
    expect(occRows(S, bill.id).map((o) => o.due_date)).toEqual(["2025-11-15", "2025-12-15", "2026-01-15", "2026-02-15"]);

    expect(removeBill(handle, S, bill.id, JAN10)).toBe(true);
    expect(bills.get(bill.id)!.active).toBe(false);

    const after = occRows(S, bill.id);
    expect(after.map((o) => o.due_date)).toEqual(["2025-11-15", "2025-12-15"]); // futures deleted
    expect(after.find((o) => o.due_date === "2025-11-15")!.status).toBe("paid"); // history intact
    expect(after.find((o) => o.due_date === "2025-12-15")!.status).toBe("upcoming"); // past-due preserved

    const sum = getBudgetSummary(handle, S, JAN10);
    expect(sum.reserved.map((r) => r.dueDate)).toEqual(["2025-12-15"]); // past-due still reserving
    expect(sum.reservedCents).toBe(20000);
    expect(bills.upcoming(20, TODAY).map((o) => o.dueDate)).toEqual(["2025-12-15"]); // still listed

    const stars = moneySky(handle, S, JAN10).filter((s) => s.kind === "bill" && s.id === bill.id);
    expect(stars).toHaveLength(1); // rendered from the past-due occurrence — no future ghost
    expect(stars[0]!.state).toBe("overdue");

    // Past-due remains resolvable after Remove (here via Skip).
    const dec = occRow(S, bill.id, "2025-12-15");
    expect(skipOccurrence(handle, S, dec.id).kind).toBe("skipped");
    expect(getBudgetSummary(handle, S, JAN10).reservedCents).toBe(0);
    expect(bills.upcoming(20, TODAY)).toHaveLength(0);
  });
});

describe("T5: Edit amount rewrites eligible future only (D3, P3)", () => {
  it("T5: eligible future occurrences carry the new amount; past-due and paid keep historical amounts", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(200000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Gym", amountCents: 20000, frequency: "monthly", anchorDate: "2025-11-15" });
    bills.materialize(bill.id, "2025-11-01", "2026-02-24");
    expect(markOccurrencePaidCreate(handle, S, occRow(S, bill.id, "2025-11-15").id, JAN10).kind).toBe("paid");

    const edited = editBill(handle, S, bill.id, { amountCents: 30000 }, JAN10);
    expect(edited!.amountCents).toBe(30000);

    expect(occRow(S, bill.id, "2026-01-15").amount_cents).toBe(30000); // eligible future
    expect(occRow(S, bill.id, "2026-02-15").amount_cents).toBe(30000); // eligible future
    expect(occRow(S, bill.id, "2025-12-15").amount_cents).toBe(20000); // past-due unpaid unchanged
    expect(occRow(S, bill.id, "2025-11-15").amount_cents).toBe(20000); // paid history unchanged

    const sum = getBudgetSummary(handle, S, JAN10);
    expect(sum.reserved.map((r) => [r.dueDate, r.amountCents])).toEqual([
      ["2025-12-15", 20000],
      ["2026-01-15", 30000],
    ]);
    expect(sum.reservedCents).toBe(50000);
  });
});

describe("T6: Edit schedule replaces occurrences without duplicates (D3, I6)", () => {
  it("T6: exactly one occurrence per due date on the new schedule; total reserved equals the new schedule only", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Weekly", amountCents: 10000, frequency: "weekly", anchorDate: "2026-01-05" });
    getBudgetSummary(handle, S, JAN10);
    expect(bills.upcoming(50, TODAY).map((o) => o.dueDate)).toContain("2026-01-12"); // old schedule present

    const edited = editBill(handle, S, bill.id, { frequency: "biweekly" }, JAN10);
    expect(edited!.frequency).toBe("biweekly");

    const dates = bills.upcoming(50, TODAY).map((o) => o.dueDate);
    expect(dates).toEqual(["2026-01-05", "2026-01-19", "2026-02-02", "2026-02-16"]); // past-due (untouched) + new schedule only
    expect(new Set(dates).size).toBe(dates.length); // no old+new pair per due date

    const sum = getBudgetSummary(handle, S, JAN10);
    expect(sum.reserved.map((r) => r.dueDate)).toEqual(["2026-01-05", "2026-01-19"]);
    expect(sum.reservedCents).toBe(20000); // new schedule only (old weekly would reserve 01-12 too → 30000)
  });
});

describe("T7: Skip is per-occurrence (D11, P4)", () => {
  it("T7: skipped occurrence stops reserving and leaves Upcoming, stays in history as skipped; next occurrence materializes normally; bill unaffected", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Water", amountCents: 15000, frequency: "monthly", anchorDate: "2026-01-12" });

    const pre = getBudgetSummary(handle, S, JAN10);
    expect(pre.reservedCents).toBe(15000);
    const occ = bills.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-12")!;

    expect(skipOccurrence(handle, S, occ.id).kind).toBe("skipped");
    expect(bills.getOccurrence(occ.id)!.status).toBe("skipped"); // remains in history as skipped

    const post = getBudgetSummary(handle, S, JAN10);
    expect(post.reservedCents).toBe(0); // stops reserving
    const upcomingDates = bills.upcoming(10, TODAY).map((o) => o.dueDate);
    expect(upcomingDates).not.toContain("2026-01-12"); // leaves Upcoming
    expect(upcomingDates).toContain("2026-02-12"); // next occurrence materializes normally
    expect(bills.get(bill.id)!.active).toBe(true); // the bill itself is not disabled

    expect(skipOccurrence(handle, S, occ.id).kind).toBe("already-resolved");
    expect(skipOccurrence(handle, S, 999999).kind).toBe("not-found");
  });
});

describe("T8: bill-risk due date is threaded through (D4)", () => {
  it("T8: detect() carries the occurrence due date and run() enqueues an outbox row whose bill_due_at EQUALS it (non-NULL)", async () => {
    const S = "s1";
    const appCtx = { handle, embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
    new FinAccountRepo(handle, S).setBalance(10000);
    seedCadence(S);
    const bill = new FinBillRepo(handle, S).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });

    const inv = billRiskTool.detect({ ctx: appCtx, spaceId: S, now: JAN10_MS, notify: async () => {} });
    expect(inv).toHaveLength(1);
    expect(inv[0]!.args.mode).toBe("short");
    expect(inv[0]!.args.dueDate).toBe("2026-01-18"); // the at-risk occurrence's due date, threaded

    // run() through the REAL notify boundary → the persisted outbox row.
    const policyNotify = createPolicyNotify({ sqlite: handle.sqlite, handle, send: async () => ({ attempted: [{ chatId: 1, outcome: "sent" as const }] }), audit: () => {}, workerId: "t8-test" });
    const tcRun: ToolContext = { ctx: appCtx, spaceId: S, now: JAN10_MS, notify: (text, meta) => policyNotify(S, text, meta) };
    const res = await billRiskTool.run(tcRun, inv[0]!.args);
    expect(res.ok).toBe(true);
    const row = handle.sqlite
      .prepare(`SELECT bill_due_at FROM notification_outbox WHERE space_id = ? AND tool = 'billRisk'`)
      .get(S) as { bill_due_at: string | null };
    expect(row.bill_due_at).not.toBeNull();
    expect(row.bill_due_at).toBe("2026-01-18"); // EQUALS the occurrence's due date

    // Fallback: a router-path call WITHOUT the arg resolves the bill's
    // earliest live upcoming occurrence due date via the repo.
    let captured: NotifyMeta | undefined;
    const tcFallback: ToolContext = { ctx: appCtx, spaceId: S, now: JAN10_MS, notify: async (_t, meta) => void (captured = meta) };
    await billRiskTool.run(tcFallback, { billId: bill.id, mode: "short", threshold: 15000 });
    expect(captured?.billDueAt).toBe("2026-01-18");
  });
});

describe("T9: backfill is navigation-independent and idempotent (D5, I7)", () => {
  it("T9: with no UI/screen reads, a bill falling due during non-use exists, reserves, lists, and is warnable via the summary path; running backfill twice changes nothing", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(5000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const bill = bills.create({ name: "Phone", amountCents: 12000, frequency: "monthly", anchorDate: "2026-01-20" });
    // No summary/sky reads at all — time advances past the due date during "non-use".
    const JAN25 = new Date("2026-01-25T12:00:00Z");

    // The periodic path's entry point: bill-risk detect() calls
    // getBudgetSummary on the tool-router tick (verified in index.ts).
    const sum = getBudgetSummary(handle, S, JAN25);
    expect(bills.upcoming(20, "2026-01-25").map((o) => o.dueDate)).toContain("2026-01-20"); // exists + lists
    expect(sum.reserved.map((r) => r.dueDate)).toContain("2026-01-20"); // reserves
    expect(sum.reservedCents).toBe(12000);

    // Warnable: bill-risk detect() fires for it on the same tick path.
    const appCtx = { handle, embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
    const inv = billRiskTool.detect({ ctx: appCtx, spaceId: S, now: JAN25.getTime(), notify: async () => {} });
    expect(inv).toHaveLength(1);
    expect(inv[0]!.args.billId).toBe(bill.id);

    // Running backfill twice changes nothing the second time.
    const snapshot1 = JSON.stringify(occRows(S, bill.id));
    getBudgetSummary(handle, S, JAN25);
    bills.materializeAll("2025-12-21", "2026-03-11");
    expect(JSON.stringify(occRows(S, bill.id))).toBe(snapshot1);
  });
});

describe("T10: Money Sky day is the space's day (D6, I8)", () => {
  it("T10: at 21:30 space-local (UTC day ≠ space day), a bill due space-tomorrow is not overdue and one due space-today is due today — sky and tab agree", () => {
    const S = "s1";
    setPreference(handle.sqlite, S, "timezone", "America/New_York");
    new FinAccountRepo(handle, S).setBalance(1000000);
    const bills = new FinBillRepo(handle, S);
    const dueToday = bills.create({ name: "DueToday", amountCents: 10000, frequency: "monthly", anchorDate: "2026-10-21" });
    const dueTomorrow = bills.create({ name: "DueTomorrow", amountCents: 10000, frequency: "monthly", anchorDate: "2026-10-22" });
    // 2026-10-22T01:30Z = Oct 21, 21:30 in America/New_York.
    const NOW = new Date("2026-10-22T01:30:00Z");

    const stars = moneySky(handle, S, NOW).filter((s) => s.kind === "bill");
    const todayStar = stars.find((s) => s.id === dueToday.id)!;
    const tomorrowStar = stars.find((s) => s.id === dueTomorrow.id)!;
    expect(todayStar.dueInDays).toBe(0); // due TODAY in the space's day (UTC slice would say -1/overdue)
    expect(todayStar.state).not.toBe("overdue");
    expect(todayStar.state).toBe("approaching");
    expect(tomorrowStar.dueInDays).toBe(1); // space-tomorrow, not overdue
    expect(tomorrowStar.state).not.toBe("overdue");

    // The tab (summary) at the same instant agrees on the same two days.
    const sum = getBudgetSummary(handle, S, NOW);
    expect(sum.reserved.map((r) => r.dueDate).sort()).toEqual(["2026-10-21", "2026-10-22"]);
  });
});

describe("T14: Upcoming truncation is visible and scope is stable (D8, I7) — server assertions", () => {
  it("T14: live total exceeds the 20-row page when >20 live occurrences exist; upcoming contents + total are identical whether or not moneySky() ran first", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(1000000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    bills.create({ name: "Daily", amountCents: 100, frequency: "custom", everyDays: 1, anchorDate: "2026-01-08" });

    // Summary/backfill path ONLY — the galaxy has not been opened.
    getBudgetSummary(handle, S, JAN10);
    const upA = bills.upcoming(20, TODAY);
    const totalA = bills.upcomingCount(TODAY);
    expect(totalA).toBe(48); // daily, 2026-01-08 → 2026-02-24 (§3.3 window)
    expect(totalA).toBeGreaterThan(20);
    expect(upA).toHaveLength(20); // the display page
    expect(upA[0]!.dueDate).toBe("2026-01-08"); // past-due present from summary backfill alone

    const stars = moneySky(handle, S, JAN10);
    expect(stars.some((s) => s.kind === "bill")).toBe(true);

    const upB = bills.upcoming(20, TODAY);
    const totalB = bills.upcomingCount(TODAY);
    expect(upB).toEqual(upA); // identical contents regardless of navigation history
    expect(totalB).toBe(totalA);
  });
});

describe("T15/T20: concurrent mark-paid — exactly one winner (I3, §4 concurrency)", () => {
  function setup(spaceId: string): { bills: FinBillRepo; occId: number } {
    new FinAccountRepo(handle, spaceId).setBalance(100000);
    seedCadence(spaceId);
    const bills = new FinBillRepo(handle, spaceId);
    bills.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    getBudgetSummary(handle, spaceId, JAN10);
    const occ = bills.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;
    return { bills, occId: occ.id };
  }

  it("T15: two mark-paid (create) callers → exactly one expense, one deduction, one paid occurrence; the loser gets already-paid", () => {
    const S = "s1";
    const { bills, occId } = setup(S);
    // better-sqlite3 is synchronous: interleave sequentially — winner completes, loser attempts its claim.
    const winner = markOccurrencePaidCreate(handle, S, occId, JAN10);
    expect(winner.kind).toBe("paid");
    const loser = markOccurrencePaidCreate(handle, S, occId, JAN10);
    expect(loser.kind).toBe("already-paid");
    expect(expenseCount(S)).toBe(1);
    expect(balanceOf(S)).toBe(75000); // exactly one deduction
    const row = bills.getOccurrence(occId)!;
    expect(row.status).toBe("paid");
    if (winner.kind === "paid") expect(row.paidExpenseId).toBe(winner.expense.id);
  });

  it("T20: the losing claim leaves nothing behind — expense count and balance equal the winner-only values exactly", () => {
    const S = "s1";
    const { bills, occId } = setup(S);
    const winner = markOccurrencePaidCreate(handle, S, occId, JAN10);
    expect(winner.kind).toBe("paid");
    const winnerOnlyExpenses = expenseCount(S);
    const winnerOnlyBalance = balanceOf(S);
    const loser = markOccurrencePaidCreate(handle, S, occId, JAN10);
    expect(loser.kind).toBe("already-paid"); // clean "already paid", having written nothing
    expect(expenseCount(S)).toBe(winnerOnlyExpenses); // no orphan expense
    expect(balanceOf(S)).toBe(winnerOnlyBalance); // no second deduction
    expect(bills.getOccurrence(occId)!.status).toBe("paid");
  });

  it("T20: fault-injecting the winner after its claim rolls the claim back with everything else; a clean retry succeeds exactly once", () => {
    const S = "s20b";
    const { bills, occId } = setup(S);
    const spy = vi.spyOn(FinAccountRepo.prototype, "adjustBalance").mockImplementation(() => {
      throw new Error("injected fault after claim");
    });
    expect(() => markOccurrencePaidCreate(handle, S, occId, JAN10)).toThrow("injected fault");
    spy.mockRestore();
    expect(bills.getOccurrence(occId)!.status).toBe("upcoming"); // claim rolled back
    expect(expenseCount(S)).toBe(0);
    expect(balanceOf(S)).toBe(100000); // untouched
    const retry = markOccurrencePaidCreate(handle, S, occId, JAN10);
    expect(retry.kind).toBe("paid");
    expect(expenseCount(S)).toBe(1);
    expect(balanceOf(S)).toBe(75000);
  });
});

describe("T16: concurrent edit + mark-paid ( §4 concurrency)", () => {
  it("T16: final state equals one of the two serial orders, complete in both dimensions (no lost occurrence, no orphan expense)", () => {
    // Order A (space s1): edit first, then pay — the payment snapshots the NEW amount.
    const A = "s1";
    new FinAccountRepo(handle, A).setBalance(100000);
    seedCadence(A);
    const billsA = new FinBillRepo(handle, A);
    const billA = billsA.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    getBudgetSummary(handle, A, JAN10);
    const occA = billsA.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;
    editBill(handle, A, billA.id, { amountCents: 30000 }, JAN10);
    const payA = markOccurrencePaidCreate(handle, A, occA.id, JAN10);
    expect(payA.kind).toBe("paid");
    if (payA.kind === "paid") expect(payA.expense.amountCents).toBe(30000);
    expect(balanceOf(A)).toBe(70000);
    expect(expenseCount(A)).toBe(1);
    const rowA = billsA.getOccurrence(occA.id)!;
    expect(rowA.status).toBe("paid");
    expect(rowA.amountCents).toBe(30000);

    // Order B (space s2): pay first, then edit — the paid occurrence keeps its historical amount.
    const B = "s2";
    new FinAccountRepo(handle, B).setBalance(100000);
    seedCadence(B);
    const billsB = new FinBillRepo(handle, B);
    const billB = billsB.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    getBudgetSummary(handle, B, JAN10);
    const occB = billsB.upcoming(10, TODAY).find((o) => o.dueDate === "2026-01-18")!;
    const payB = markOccurrencePaidCreate(handle, B, occB.id, JAN10);
    expect(payB.kind).toBe("paid");
    editBill(handle, B, billB.id, { amountCents: 30000 }, JAN10);
    expect(balanceOf(B)).toBe(75000); // the edit moved no money
    expect(expenseCount(B)).toBe(1);
    const rowB = billsB.getOccurrence(occB.id)!;
    expect(rowB.status).toBe("paid");
    expect(rowB.amountCents).toBe(25000); // history preserved exactly
    if (payB.kind === "paid") {
      expect(rowB.paidExpenseId).toBe(payB.expense.id); // still linked — no orphan
      expect(payB.expense.amountCents).toBe(25000);
    }
    expect(billsB.get(billB.id)!.amountCents).toBe(30000); // the edit itself landed completely
  });
});

describe("T17: double-submit / client retry is idempotent (§4)", () => {
  it("T17: retrying mark-paid (create + match), skip, and remove converges to the single-submission end state", () => {
    const S = "s1";
    new FinAccountRepo(handle, S).setBalance(100000);
    seedCadence(S);
    const bills = new FinBillRepo(handle, S);
    const rent = bills.create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    const phone = bills.create({ name: "Phone", amountCents: 7000, frequency: "monthly", anchorDate: "2026-01-16" });
    const third = bills.create({ name: "Third", amountCents: 5000, frequency: "monthly", anchorDate: "2026-01-19" });
    getBudgetSummary(handle, S, JAN10);
    const occRent = bills.upcoming(20, TODAY).find((o) => o.billId === rent.id)!;
    const occPhone = bills.upcoming(20, TODAY).find((o) => o.billId === phone.id)!;
    const occThird = bills.upcoming(20, TODAY).find((o) => o.billId === third.id)!;

    // Create, submitted twice.
    expect(markOccurrencePaidCreate(handle, S, occRent.id, JAN10).kind).toBe("paid");
    expect(markOccurrencePaidCreate(handle, S, occRent.id, JAN10).kind).toBe("already-paid");
    // Match, submitted twice (the retry reports already-paid, never expense-linked).
    const logged = createExpenseEntry(handle, S, { date: TODAY, amountCents: 7000, category: "bills", merchant: "PhoneCo" }, JAN10);
    expect(markOccurrencePaidMatch(handle, S, occPhone.id, logged.id, JAN10).kind).toBe("paid");
    expect(markOccurrencePaidMatch(handle, S, occPhone.id, logged.id, JAN10).kind).toBe("already-paid");
    // Skip, submitted twice.
    expect(skipOccurrence(handle, S, occThird.id).kind).toBe("skipped");
    expect(skipOccurrence(handle, S, occThird.id).kind).toBe("already-resolved");
    // Remove, submitted twice.
    expect(removeBill(handle, S, third.id, JAN10)).toBe(true);
    expect(removeBill(handle, S, third.id, JAN10)).toBe(true);

    // End state == single submission in each case.
    expect(expenseCount(S)).toBe(2); // rent's created expense + phone's logged expense
    expect(balanceOf(S)).toBe(100000 - 25000 - 7000); // each deduction exactly once
    expect(bills.getOccurrence(occRent.id)!.status).toBe("paid");
    expect(bills.getOccurrence(occPhone.id)!.status).toBe("paid");
    expect(bills.getOccurrence(occPhone.id)!.paidExpenseId).toBe(logged.id);
    expect(bills.getOccurrence(occThird.id)!.status).toBe("skipped"); // skip survived the removes untouched
    expect(bills.get(third.id)!.active).toBe(false);
  });
});

describe("T19: reservation eligibility is one rule across consumers (D2, I1, I5)", () => {
  function shape(spaceId: string): { bills: FinBillRepo; billId: number; pastDueId: number } {
    new FinAccountRepo(handle, spaceId).setBalance(100000);
    seedCadence(spaceId);
    const bills = new FinBillRepo(handle, spaceId);
    const bill = bills.create({ name: "Storage", amountCents: 20000, frequency: "monthly", anchorDate: "2025-12-15" });
    getBudgetSummary(handle, spaceId, JAN10); // materializes past-due 2025-12-15 + future 2026-01-15
    const pastDue = occRow(spaceId, bill.id, "2025-12-15");
    return { bills, billId: bill.id, pastDueId: pastDue.id };
  }
  function expectAgreement(spaceId: string, bills: FinBillRepo, billId: number): void {
    const sum = getBudgetSummary(handle, spaceId, JAN10);
    expect(sum.reserved.map((r) => r.dueDate)).toEqual(["2025-12-15"]); // Reserved: past-due live, future not
    expect(bills.upcoming(20, TODAY).map((o) => o.dueDate)).toEqual(["2025-12-15"]); // Upcoming agrees
    const stars = moneySky(handle, spaceId, JAN10).filter((s) => s.kind === "bill" && s.id === billId);
    expect(stars).toHaveLength(1); // Sky agrees: rendered from the past-due occurrence
    expect(stars[0]!.state).toBe("overdue");
    expect(stars[0]!.dueInDays).toBe(-26);
  }
  function expectGoneAfterSkip(spaceId: string, bills: FinBillRepo, billId: number, pastDueId: number): void {
    expect(skipOccurrence(handle, spaceId, pastDueId).kind).toBe("skipped");
    expect(getBudgetSummary(handle, spaceId, JAN10).reserved).toHaveLength(0);
    expect(bills.upcoming(20, TODAY)).toHaveLength(0);
    expect(moneySky(handle, spaceId, JAN10).filter((s) => s.kind === "bill" && s.id === billId)).toHaveLength(0);
  }

  it("T19: after Remove — Reserved, Upcoming, and Money Sky agree (past-due live, future not); skipping the past-due removes it from all three", () => {
    const { bills, billId, pastDueId } = shape("s1");
    expect(removeBill(handle, "s1", billId, JAN10)).toBe(true);
    expectAgreement("s1", bills, billId);
    expectGoneAfterSkip("s1", bills, billId, pastDueId);
  });

  it("T19: after deactivation WITHOUT Remove — identical agreement (future rows still exist but are not live)", () => {
    const { bills, billId, pastDueId } = shape("s2");
    expect(bills.deactivate(billId)).toBe(true); // the other deactivation path: no occurrence deletion
    expect(occRows("s2", billId).some((o) => o.due_date === "2026-01-15" && o.status === "upcoming")).toBe(true); // row exists…
    expectAgreement("s2", bills, billId); // …but is not live anywhere
    expectGoneAfterSkip("s2", bills, billId, pastDueId);
  });
});

describe("ADR-019 routes: lifecycle endpoints + summary truncation fields (§3.7, §4)", () => {
  let rctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    rctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(rctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "adr019routes", passcode: "secret123", name: "adr019routes" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });
  afterAll(() => { server?.close(); rctx.handle.sqlite.close(); });

  const H = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });
  const req = async (method: string, p: string, b?: unknown) => {
    const res = await fetch(`${base}${p}`, { method, headers: H(), body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: res.status, body: await res.json() };
  };
  const soon = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

  it("paid create → 200 {ok,budget}; repeat → 200 alreadyPaid; match-linked → 409; skip → ok then alreadyResolved; paid-on-skipped → 409; 404s; summary carries upcomingTotal", async () => {
    expect((await req("PUT", "/api/finance/account/balance", { cents: 100000 })).status).toBe(200);
    const bill = (await req("POST", "/api/finance/bills", { name: "RouteRent", amountCents: 25000, frequency: "monthly", anchorDate: soon(3) })).body as { id: number };
    const bill2 = (await req("POST", "/api/finance/bills", { name: "RoutePhone", amountCents: 7000, frequency: "monthly", anchorDate: soon(4) })).body as { id: number };

    const sum1 = (await req("GET", "/api/finance/summary")).body as { upcoming: Array<{ id: number; billId: number }>; upcomingTotal: number };
    expect(typeof sum1.upcomingTotal).toBe("number");
    expect(sum1.upcomingTotal).toBeGreaterThanOrEqual(2);
    expect(sum1.upcomingTotal).toBeGreaterThanOrEqual(sum1.upcoming.length);
    const occ1 = sum1.upcoming.find((o) => o.billId === bill.id)!;
    const occ2 = sum1.upcoming.find((o) => o.billId === bill2.id)!;

    const paid = await req("POST", `/api/finance/bills/occurrence/${occ1.id}/paid`, {});
    expect(paid.status).toBe(200);
    expect((paid.body as { ok: boolean }).ok).toBe(true);
    expect((paid.body as { budget: { balanceCents: number } }).budget.balanceCents).toBe(75000);

    // The loser of a race is not an error (T20 at the route surface).
    const again = await req("POST", `/api/finance/bills/occurrence/${occ1.id}/paid`, {});
    expect(again.status).toBe(200);
    expect((again.body as { alreadyPaid?: boolean }).alreadyPaid).toBe(true);

    // The created expense is already linked → matching it elsewhere is a 409.
    const expenses = (await req("GET", "/api/finance/expense")).body as Array<{ id: number; merchant?: string | null }>;
    const created = expenses.find((e) => e.merchant === "RouteRent")!;
    const linked = await req("POST", `/api/finance/bills/occurrence/${occ2.id}/paid`, { expenseId: created.id });
    expect(linked.status).toBe(409);

    // Match success path: log an expense, then match it.
    const logged = (await req("POST", "/api/finance/expense", { date: soon(0), amountCents: 7000, category: "bills", merchant: "PhoneCo" })).body as { expense: { id: number } };
    const matched = await req("POST", `/api/finance/bills/occurrence/${occ2.id}/paid`, { expenseId: logged.expense.id });
    expect(matched.status).toBe(200);
    expect((matched.body as { ok: boolean }).ok).toBe(true);

    // Skip: third bill; success then alreadyResolved; paying a skipped occurrence is a 409.
    const bill3 = (await req("POST", "/api/finance/bills", { name: "RouteThird", amountCents: 5000, frequency: "monthly", anchorDate: soon(5) })).body as { id: number };
    const sum2 = (await req("GET", "/api/finance/summary")).body as { upcoming: Array<{ id: number; billId: number }> };
    const occ3 = sum2.upcoming.find((o) => o.billId === bill3.id)!;
    const skipped = await req("POST", `/api/finance/bills/occurrence/${occ3.id}/skip`);
    expect(skipped.status).toBe(200);
    expect((skipped.body as { ok: boolean }).ok).toBe(true);
    const skippedAgain = await req("POST", `/api/finance/bills/occurrence/${occ3.id}/skip`);
    expect(skippedAgain.status).toBe(200);
    expect((skippedAgain.body as { alreadyResolved?: boolean }).alreadyResolved).toBe(true);
    expect((await req("POST", `/api/finance/bills/occurrence/${occ3.id}/paid`, {})).status).toBe(409);

    // Not-found shapes.
    expect((await req("POST", "/api/finance/bills/occurrence/999999/paid", {})).status).toBe(404);
    expect((await req("POST", "/api/finance/bills/occurrence/999999/skip")).status).toBe(404);
    expect((await req("DELETE", "/api/finance/bills/999999")).status).toBe(404);

    // PATCH goes through Edit; DELETE goes through Remove (idempotent).
    const patched = await req("PATCH", `/api/finance/bills/${bill2.id}`, { amountCents: 9000 });
    expect(patched.status).toBe(200);
    expect((patched.body as { amountCents: number }).amountCents).toBe(9000);
    expect((await req("DELETE", `/api/finance/bills/${bill.id}`)).status).toBe(200);
    expect((await req("DELETE", `/api/finance/bills/${bill.id}`)).status).toBe(200);
  });

  it("DELETE (Remove) preserves a past-due unpaid occurrence in summary upcoming + reserved", async () => {
    const bill = (await req("POST", "/api/finance/bills", { name: "RoutePastDue", amountCents: 11000, frequency: "monthly", anchorDate: soon(-10) })).body as { id: number };
    const before = (await req("GET", "/api/finance/summary")).body as { upcoming: Array<{ billId: number; dueDate: string }>; budget: { reserved: Array<{ billId: number }> } };
    expect(before.upcoming.some((o) => o.billId === bill.id)).toBe(true); // backfilled without any sky visit
    expect((await req("DELETE", `/api/finance/bills/${bill.id}`)).status).toBe(200);
    const after = (await req("GET", "/api/finance/summary")).body as { upcoming: Array<{ billId: number }>; budget: { reserved: Array<{ billId: number }> } };
    expect(after.upcoming.some((o) => o.billId === bill.id)).toBe(true); // past-due stays listed (P2/I1)
    expect(after.budget.reserved.some((r) => r.billId === bill.id)).toBe(true); // and reserving
  });
});
