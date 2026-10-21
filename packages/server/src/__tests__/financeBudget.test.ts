import { describe, it, expect } from "vitest";
import { occurrenceDates, nextDueOnOrAfter } from "../finance/bills.js";
import {
  computeBudget,
  estimateNextIncomeDate,
  medianIncomeGapDays,
  weekStart,
  weeksOfIncomeHistory,
} from "../finance/budget.js";

/** Stage 1a — the PURE money math. No DB, no LLM: deterministic + hit hard. */

describe("weeksOfIncomeHistory (the divisor for the trailing weekly average)", () => {
  it("returns 1 for a same-day-as-today first paycheck (not a hardcoded 4)", () => {
    expect(weeksOfIncomeHistory("2026-01-29", "2026-01-29")).toBe(1);
  });

  it("returns 1 for a first paycheck a couple days ago", () => {
    expect(weeksOfIncomeHistory("2026-01-27", "2026-01-29")).toBe(1);
  });

  it("returns 2 once history spans into a second week", () => {
    expect(weeksOfIncomeHistory("2026-01-20", "2026-01-29")).toBe(2);
  });

  it("caps at 4 once history is well past a month old", () => {
    expect(weeksOfIncomeHistory("2025-06-01", "2026-01-29")).toBe(4);
  });

  it("returns 1 (not 0 or NaN) with no income history at all", () => {
    expect(weeksOfIncomeHistory(undefined, "2026-01-29")).toBe(1);
  });
});

describe("bill occurrence date math", () => {
  it("monthly recurrence walks month by month within the window", () => {
    const dates = occurrenceDates({ frequency: "monthly", anchorDate: "2026-01-15" }, "2026-01-01", "2026-04-30");
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
  });

  it("monthly clamps a day-31 anchor to shorter months (no March 3rd bug)", () => {
    const dates = occurrenceDates({ frequency: "monthly", anchorDate: "2026-01-31" }, "2026-01-01", "2026-03-31");
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("weekly + biweekly step by 7 / 14 days", () => {
    expect(occurrenceDates({ frequency: "weekly", anchorDate: "2026-01-01" }, "2026-01-01", "2026-01-22"))
      .toEqual(["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]);
    expect(occurrenceDates({ frequency: "biweekly", anchorDate: "2026-01-01" }, "2026-01-01", "2026-01-29"))
      .toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
  });

  it("custom uses everyDays (min 1) and never loops forever", () => {
    expect(occurrenceDates({ frequency: "custom", anchorDate: "2026-01-01", everyDays: 10 }, "2026-01-01", "2026-01-31"))
      .toEqual(["2026-01-01", "2026-01-11", "2026-01-21", "2026-01-31"]);
    // Degenerate everyDays is clamped to 1, still bounded by the horizon.
    expect(occurrenceDates({ frequency: "custom", anchorDate: "2026-01-01", everyDays: 0 }, "2026-01-01", "2026-01-03").length).toBe(3);
  });

  it("skips occurrences before the window start (long-past anchor is cheap)", () => {
    const dates = occurrenceDates({ frequency: "monthly", anchorDate: "2020-06-10" }, "2026-01-01", "2026-02-28");
    expect(dates).toEqual(["2026-01-10", "2026-02-10"]);
  });

  it("nextDueOnOrAfter finds the first due date at/after a point", () => {
    expect(nextDueOnOrAfter({ frequency: "monthly", anchorDate: "2026-01-15" }, "2026-02-01")).toBe("2026-02-15");
    expect(nextDueOnOrAfter({ frequency: "monthly", anchorDate: "2026-01-15" }, "2026-01-15")).toBe("2026-01-15");
  });
});

describe("income cadence estimate", () => {
  it("median gap of evenly-spaced incomes", () => {
    expect(medianIncomeGapDays(["2026-01-01", "2026-01-08", "2026-01-15"])).toBe(7);
  });
  it("returns null with fewer than two incomes", () => {
    expect(medianIncomeGapDays(["2026-01-01"])).toBeNull();
    expect(medianIncomeGapDays([])).toBeNull();
  });
  it("projects the next income forward past 'now' using the cadence", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    // last income 2026-01-08, weekly cadence → next future multiple is 2026-01-15.
    expect(estimateNextIncomeDate(["2026-01-01", "2026-01-08"], now)).toBe("2026-01-15");
  });
  it("falls back to a 14-day horizon with no cadence", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(estimateNextIncomeDate([], now)).toBe("2026-01-24");
  });
  it("honors an explicit cadenceDays override", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(estimateNextIncomeDate(["2026-01-09"], now, 7)).toBe("2026-01-16");
  });
});

describe("computeBudget — Safe to Spend", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const occ = [
    { billId: 1, name: "Rent", amountCents: 60000, dueDate: "2026-01-20" },
    { billId: 2, name: "Insurance", amountCents: 25000, dueDate: "2026-01-18" },
    { billId: 3, name: "Car", amountCents: 21000, dueDate: "2026-01-22" },
    { billId: 4, name: "Phone", amountCents: 7000, dueDate: "2026-01-16" },
  ];

  it("reserves bills due before the next income and leaves the rest as safe to spend", () => {
    const b = computeBudget({
      balanceCents: 114000, bufferCents: 0, occurrences: occ,
      incomeDates: ["2026-01-10"], weekEarnedCents: 74300, avgWeeklyIncomeCents: 0, now, cadenceDays: 30, // horizon 2026-02-09
    });
    expect(b.reservedCents).toBe(113000);
    expect(b.reserved.map((r) => r.name)).toEqual(["Phone", "Insurance", "Rent", "Car"]); // sorted by due date
    expect(b.safeToSpendCents).toBe(1000); // $10
    expect(b.shortfallCents).toBe(0);
    expect(b.weekEarnedCents).toBe(74300);
  });

  it("only reserves occurrences due before the horizon", () => {
    // Tight horizon: cadence 5 days from last income 2026-01-10 → next 2026-01-15.
    const b = computeBudget({
      balanceCents: 114000, bufferCents: 0, occurrences: occ,
      incomeDates: ["2026-01-10"], weekEarnedCents: 0, avgWeeklyIncomeCents: 0, now, cadenceDays: 5,
    });
    expect(b.nextIncomeDate).toBe("2026-01-15");
    expect(b.reserved).toHaveLength(0); // all bills due after the 15th
    expect(b.safeToSpendCents).toBe(114000);
  });

  it("subtracts the buffer and never shows a negative safe-to-spend", () => {
    const b = computeBudget({
      balanceCents: 10000, bufferCents: 5000,
      occurrences: [{ billId: 1, name: "Rent", amountCents: 8000, dueDate: "2026-01-12" }],
      incomeDates: ["2026-01-10"], weekEarnedCents: 0, avgWeeklyIncomeCents: 0, now, cadenceDays: 30,
    });
    expect(b.reservedCents).toBe(8000);
    expect(b.safeToSpendCents).toBe(0); // 10000 - 8000 - 5000 = -3000, floored to 0
    expect(b.shortfallCents).toBe(3000); // the true shortfall is surfaced explicitly
  });
});

describe("weekStart", () => {
  it("anchors to the Monday of the given zone's local week", () => {
    // The zone is now an explicit input (owner rule 2026-10-21: the budget
    // week follows the user's own calendar). Passing "UTC" reproduces the
    // original pins exactly.
    expect(weekStart(new Date("2026-01-10T00:00:00Z"), "UTC")).toBe("2026-01-05"); // Sat 10th → Mon 5th
    expect(weekStart(new Date("2026-01-05T00:00:00Z"), "UTC")).toBe("2026-01-05"); // Monday maps to itself
  });
});
