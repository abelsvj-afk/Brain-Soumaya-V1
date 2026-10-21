import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinExpenseRepo } from "../repositories/finExpense.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { getBudgetSummary } from "../finance/summary.js";

/** Stage 1a — repositories + the composed budget, against a real (in-memory) DB. */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("FinAccountRepo", () => {
  it("lazily creates one zero account per space and adjusts balance/buffer", () => {
    const acct = new FinAccountRepo(handle, "s1");
    const a = acct.getOrCreate();
    expect(a.balanceCents).toBe(0);
    expect(acct.setBalance(50000).balanceCents).toBe(50000);
    expect(acct.setBuffer(5000).bufferCents).toBe(5000);
    expect(acct.adjustBalance(-2000).balanceCents).toBe(48000);
    // A second getOrCreate returns the SAME row (no duplicate account).
    const rows = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM fin_account WHERE space_id = 's1'`).get() as { c: number };
    expect(rows.c).toBe(1);
  });
});

describe("space scoping", () => {
  it("never leaks money data across spaces", () => {
    new FinAccountRepo(handle, "alice").setBalance(100000);
    new FinAccountRepo(handle, "bob").setBalance(200000);
    new FinIncomeRepo(handle, "alice").create({ date: "2026-01-05", netCents: 30000, platform: "GoPuff" });

    expect(new FinAccountRepo(handle, "alice").getOrCreate().balanceCents).toBe(100000);
    expect(new FinAccountRepo(handle, "bob").getOrCreate().balanceCents).toBe(200000);
    expect(new FinIncomeRepo(handle, "alice").list()).toHaveLength(1);
    expect(new FinIncomeRepo(handle, "bob").list()).toHaveLength(0);
  });
});

describe("income / expense repos", () => {
  it("records income + sums a week; flags duplicates", () => {
    const inc = new FinIncomeRepo(handle, "s1");
    inc.create({ date: "2026-01-05", netCents: 30000, platform: "GoPuff" });
    inc.create({ date: "2026-01-07", netCents: 44300, platform: "DoorDash" });
    expect(inc.sumNetBetween("2026-01-05", "2026-01-11")).toBe(74300);
    expect(inc.findDuplicate("2026-01-05", 30000)).not.toBeNull();
    expect(inc.findDuplicate("2026-01-05", 99999)).toBeNull();
    expect(inc.dates()).toEqual(["2026-01-05", "2026-01-07"]);
  });

  it("records expenses + dedups on amount+date+merchant", () => {
    const exp = new FinExpenseRepo(handle, "s1");
    exp.create({ date: "2026-01-06", amountCents: 1200, category: "food", merchant: "Cafe" });
    expect(exp.findDuplicate("2026-01-06", 1200, "Cafe")).not.toBeNull();
    expect(exp.findDuplicate("2026-01-06", 1200, "Other")).toBeNull();
    expect(exp.sumOutBetween("2026-01-01", "2026-01-31")).toBe(1200);
  });
});

describe("FinBillRepo — materialization is idempotent + preserves paid state", () => {
  it("materializes occurrences once and marks paid", () => {
    const bills = new FinBillRepo(handle, "s1");
    const rent = bills.create({ name: "Rent", amountCents: 60000, frequency: "monthly", anchorDate: "2026-01-01" });

    bills.materialize(rent.id, "2026-01-01", "2026-03-31");
    let occ = bills.upcoming();
    expect(occ.map((o) => o.dueDate)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);

    // Re-materializing the same window inserts nothing new (UNIQUE index).
    bills.materialize(rent.id, "2026-01-01", "2026-03-31");
    expect(bills.upcoming()).toHaveLength(3);

    // Mark the first paid; it leaves the upcoming set and is not re-created.
    bills.markPaid(occ[0]!.id);
    bills.materialize(rent.id, "2026-01-01", "2026-03-31");
    occ = bills.upcoming();
    expect(occ.map((o) => o.dueDate)).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("unpaidThrough returns only occurrences due on/before the horizon", () => {
    const bills = new FinBillRepo(handle, "s1");
    const b = bills.create({ name: "Phone", amountCents: 7000, frequency: "monthly", anchorDate: "2026-01-10" });
    bills.materialize(b.id, "2026-01-01", "2026-06-30");
    expect(bills.unpaidThrough("2026-02-28").map((o) => o.dueDate)).toEqual(["2026-01-10", "2026-02-10"]);
  });
});

describe("getBudgetSummary — end to end", () => {
  it("reproduces the docs example ($1140 balance, $10 safe to spend)", () => {
    const spaceId = "ray";
    new FinAccountRepo(handle, spaceId).setBalance(114000);
    const inc = new FinIncomeRepo(handle, spaceId);
    inc.create({ date: "2026-01-03", netCents: 30000, platform: "GoPuff" });
    inc.create({ date: "2026-01-10", netCents: 44300, platform: "DoorDash" });
    const bills = new FinBillRepo(handle, spaceId);
    bills.create({ name: "Rent", amountCents: 60000, frequency: "monthly", anchorDate: "2026-01-20" });
    bills.create({ name: "Insurance", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });
    bills.create({ name: "Car", amountCents: 21000, frequency: "monthly", anchorDate: "2026-01-22" });
    bills.create({ name: "Phone", amountCents: 7000, frequency: "monthly", anchorDate: "2026-01-16" });

    // now = Sat 2026-01-10; cadence 30 → horizon ~2026-02-09, so all four Jan bills reserve.
    const b = getBudgetSummary(handle, spaceId, new Date("2026-01-10T12:00:00Z"), 30); // midday UTC = Sat Jan 10 in Florida too
    expect(b.reservedCents).toBe(113000);
    expect(b.safeToSpendCents).toBe(1000);
    expect(b.shortfallCents).toBe(0);
    expect(b.weekEarnedCents).toBe(44300); // week of Mon 2026-01-05 → only the 01-10 income
    expect(b.reserved.map((r) => r.name)).toEqual(["Phone", "Insurance", "Rent", "Car"]);
  });

  it("works with no income and no bills (empty but valid)", () => {
    const b = getBudgetSummary(handle, "empty", new Date("2026-01-10T00:00:00Z"));
    expect(b.balanceCents).toBe(0);
    expect(b.reserved).toHaveLength(0);
    expect(b.safeToSpendCents).toBe(0);
    expect(b.shortfallCents).toBe(0);
  });
});
