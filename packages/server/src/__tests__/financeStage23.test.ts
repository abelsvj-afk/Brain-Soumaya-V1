import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";
import { FinBucketRepo } from "../repositories/finBucket.repo.js";
import { FinAllocationRepo } from "../repositories/finAllocation.repo.js";
import { editIncome, deleteIncome, editExpense, deleteExpense } from "../finance/mutations.js";
import { financialSnapshotText } from "../finance/snapshot.js";
import { getBudgetSummary } from "../finance/summary.js";
import { billWeeklyCents, weeklyBillLoadCents, weeklySurplusCents, weeksToAfford } from "../finance/forecast.js";

/** Stage 2/3 — balance-aware edit/delete, the chat snapshot, and the forecast helpers. */

let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); });

describe("balance-aware edit / delete (D3)", () => {
  it("editing income applies the signed delta to the balance", () => {
    new FinAccountRepo(handle, "s").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s").create({ date: "2026-01-10", netCents: 5000 });
    new FinAccountRepo(handle, "s").adjustBalance(5000); // simulate the add-time adjust (11500... 15000)
    const budget = editIncome(handle, "s", inc.id, { netCents: 8000 })!; // +3000 delta
    expect(budget.balanceCents).toBe(18000);
  });

  it("deleting income undoes its balance effect", () => {
    new FinAccountRepo(handle, "s").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s").create({ date: "2026-01-10", netCents: 5000 });
    new FinAccountRepo(handle, "s").adjustBalance(5000); // balance now 15000
    const budget = deleteIncome(handle, "s", inc.id)!;
    expect(budget.balanceCents).toBe(10000);
    expect(new FinIncomeRepo(handle, "s").list()).toHaveLength(0);
  });

  it("editing/deleting expenses adjusts the balance the other way", () => {
    new FinAccountRepo(handle, "s").setBalance(10000);
    const exp = new FinExpenseRepo(handle, "s").create({ date: "2026-01-10", amountCents: 2000, category: "food" });
    new FinAccountRepo(handle, "s").adjustBalance(-2000); // balance now 8000
    const afterEdit = editExpense(handle, "s", exp.id, { amountCents: 3000 })!; // −1000 more
    expect(afterEdit.balanceCents).toBe(7000);
    const afterDelete = deleteExpense(handle, "s", exp.id)!;
    expect(afterDelete.balanceCents).toBe(10000);
  });

  it("returns null for a missing row", () => {
    expect(deleteIncome(handle, "s", 999)).toBeNull();
    expect(editExpense(handle, "s", 999, { amountCents: 1 })).toBeNull();
  });

  it("IM-82: editing income can set and clear gross/tax/hours, not just net", () => {
    new FinAccountRepo(handle, "s").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "s").create({ date: "2026-01-10", netCents: 5000 });
    editIncome(handle, "s", inc.id, { grossCents: 6500, taxCents: 900, hours: 40 });
    const after = new FinIncomeRepo(handle, "s").get(inc.id)!;
    expect(after.grossCents).toBe(6500);
    expect(after.taxCents).toBe(900);
    expect(after.hours).toBe(40);
    expect(after.netCents).toBe(5000); // untouched fields survive the patch
    editIncome(handle, "s", inc.id, { grossCents: null, hours: null });
    const cleared = new FinIncomeRepo(handle, "s").get(inc.id)!;
    expect(cleared.grossCents).toBeNull();
    expect(cleared.hours).toBeNull();
    expect(cleared.taxCents).toBe(900);
  });
});

describe("financial snapshot (Stage 2)", () => {
  it("is null when the module is empty", () => {
    expect(financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"))).toBeNull();
  });
  it("summarizes balance, reserved, safe-to-spend, and weekly surplus", () => {
    new FinAccountRepo(handle, "s").setBalance(114000);
    const inc = new FinIncomeRepo(handle, "s");
    inc.create({ date: "2026-01-03", netCents: 30000 });
    inc.create({ date: "2026-01-10", netCents: 44300 });
    new FinBillRepo(handle, "s").create({ name: "Rent", amountCents: 60000, frequency: "monthly", anchorDate: "2026-01-20" });
    const text = financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"))!;
    expect(text).toContain("Balance: $1140.00");
    expect(text).toContain("Weekly bill load");
    expect(text).toMatch(/Safe to spend/);
  });

  // The Money tab is more than the near-term "reserved" bills and a safe-to-spend
  // number — the FULL recurring-bill roster and where spending actually goes both
  // live there too, and weren't reaching chat before.
  it("includes the full recurring-bill roster (not just near-term reserved) and top spending categories", () => {
    new FinAccountRepo(handle, "s").setBalance(100000);
    new FinIncomeRepo(handle, "s").create({ date: "2026-01-03", netCents: 30000 });
    // Far out — past the reserved horizon, so it wouldn't appear in the "reserved" line.
    new FinBillRepo(handle, "s").create({ name: "Car Insurance", amountCents: 45000, frequency: "monthly", anchorDate: "2026-06-15" });
    new FinExpenseRepo(handle, "s").create({ date: "2026-01-05", amountCents: 8000, category: "groceries" });
    new FinExpenseRepo(handle, "s").create({ date: "2026-01-06", amountCents: 3000, category: "groceries" });
    new FinExpenseRepo(handle, "s").create({ date: "2026-01-07", amountCents: 2500, category: "transport" });

    const text = financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"))!;
    expect(text).toContain("All recurring bills");
    expect(text).toContain("Car Insurance $450.00/monthly");
    expect(text).toContain("Top spending categories");
    expect(text).toContain("groceries $110.00");
    expect(text).toContain("transport $25.00");
  });

  // Maya Reality Test (Phase J, docs/specs/maya-reality-test.md) finding: a Financial Goal
  // created before any income/bill was ever logged had ZERO finance context in chat at all —
  // the snapshot's own closing line told the LLM to "reason from... the user's goals" without a
  // goal ever appearing anywhere above it. Fixed by counting goals toward "has data" and
  // rendering their name/target/progress.
  it("a Goal with no income/bills logged yet is no longer invisible to chat", () => {
    const bucket = new FinBucketRepo(handle, "s").create({ name: "Truck Fund" });
    new FinGoalRepo(handle, "s").create({ bucketId: bucket.id, name: "First truck", targetCents: 500000 });
    const text = financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"));
    expect(text).not.toBeNull();
    expect(text).toContain("Financial Goals");
    expect(text).toContain("First truck: $0.00 of $5000.00 saved");
  });

  it("reports real savings progress toward a goal's target, and an open-ended goal's saved amount without fabricating a target", () => {
    const bucket = new FinBucketRepo(handle, "s").create({ name: "Fleet" });
    const goalRepo = new FinGoalRepo(handle, "s");
    const funded = goalRepo.create({ bucketId: bucket.id, name: "Truck 1", targetCents: 500000 });
    const openEnded = goalRepo.create({ bucketId: bucket.id, name: "Truck 2", targetCents: null });
    new FinAllocationRepo(handle, "s").create({ goalId: funded.id, amountCents: 100000 });
    const text = financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"))!;
    expect(text).toContain("Truck 1: $1000.00 of $5000.00 saved");
    expect(text).toContain("Truck 2: $0.00 saved (no target amount set)");
    void openEnded;
  });

  it("an archived goal still counts toward 'has data' but only real, active goals need to be reasoned about (archived goals are excluded upstream at the Goal-hierarchy layer, not here)", () => {
    const bucket = new FinBucketRepo(handle, "s").create({ name: "Old plans" });
    const goalRepo = new FinGoalRepo(handle, "s");
    const goal = goalRepo.create({ bucketId: bucket.id, name: "Abandoned plan", targetCents: 100 });
    goalRepo.archive(goal.id);
    // financialSnapshotText's own `list()` call already excludes archived goals by default —
    // an all-archived space with zero income/bills goes back to null, same as a truly empty one.
    expect(financialSnapshotText(handle, "s", new Date("2026-01-10T00:00:00Z"))).toBeNull();
  });
});

describe("getBudgetSummary — avgWeeklyIncomeCents (computed once, shared by snapshot + /afford)", () => {
  it("matches a hand-computed 4-week trailing average", () => {
    const now = new Date("2026-01-29T00:00:00Z"); // so all 4 income rows sit inside the window
    new FinAccountRepo(handle, "s").setBalance(0);
    const inc = new FinIncomeRepo(handle, "s");
    inc.create({ date: "2026-01-05", netCents: 10000 });
    inc.create({ date: "2026-01-12", netCents: 20000 });
    inc.create({ date: "2026-01-19", netCents: 30000 });
    inc.create({ date: "2026-01-26", netCents: 40000 });
    const budget = getBudgetSummary(handle, "s", now);
    expect(budget.avgWeeklyIncomeCents).toBe(Math.round((10000 + 20000 + 30000 + 40000) / 4));
  });

  it("is 0 (not NaN/undefined) with no income", () => {
    const budget = getBudgetSummary(handle, "s2", new Date("2026-01-29T00:00:00Z"));
    expect(budget.avgWeeklyIncomeCents).toBe(0);
  });

  it("does NOT understate a brand-new account's real weekly income by dividing by a hardcoded 4", () => {
    // Regression: this used to divide by 4 unconditionally, so a single $800 paycheck two
    // days into using the app read as $200/wk — a 4x understatement that fed Safe-to-Spend,
    // the /afford calculator, and Soumaya's chat answers.
    const now = new Date("2026-02-01T00:00:00Z");
    new FinAccountRepo(handle, "s3").setBalance(0);
    new FinIncomeRepo(handle, "s3").create({ date: "2026-01-30", netCents: 80000 });
    const budget = getBudgetSummary(handle, "s3", now);
    expect(budget.avgWeeklyIncomeCents).toBe(80000);
  });
});

describe("forecast helpers (Stage 3)", () => {
  it("normalizes bill frequencies to a weekly load", () => {
    expect(billWeeklyCents({ amountCents: 700, frequency: "weekly" })).toBe(700);
    expect(billWeeklyCents({ amountCents: 700, frequency: "biweekly" })).toBe(350);
    expect(Math.round(billWeeklyCents({ amountCents: 5200, frequency: "monthly" }))).toBe(1200); // 5200*12/52
    expect(weeklyBillLoadCents([
      { amountCents: 700, frequency: "weekly", active: true },
      { amountCents: 700, frequency: "weekly", active: false }, // inactive excluded
    ])).toBe(700);
  });
  it("computes surplus + weeks-to-afford, incl. extra shifts", () => {
    expect(weeklySurplusCents(50000, 30000)).toBe(20000);
    expect(weeksToAfford(60000, 20000)).toBe(3); // 60000 / 20000
    expect(weeksToAfford(60000, 0)).toBe(Infinity); // no surplus → unreachable
    expect(weeksToAfford(60000, 10000, 10000)).toBe(3); // extra shifts double the rate
  });
});
