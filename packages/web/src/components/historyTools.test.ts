import { describe, it, expect } from "vitest";
import { filterHistoryRows, monthlyTotals, monthLabel, EMPTY_HISTORY_FILTERS, type HistoryRowLike } from "./historyTools.js";

const ROWS: HistoryRowLike[] = [
  { kind: "income", date: "2026-10-02", cents: 90000, label: "Acme" },
  { kind: "expense", date: "2026-10-03", cents: 12000, label: "Store", category: "food" },
  { kind: "expense", date: "2026-09-15", cents: 60000, label: "", category: "rent" },
  { kind: "income", date: "2026-09-01", cents: 90000, label: "Acme" },
];

describe("historyTools (IM-82)", () => {
  it("passes everything through with empty filters", () => {
    expect(filterHistoryRows(ROWS, EMPTY_HISTORY_FILTERS)).toHaveLength(4);
  });

  it("filters by kind", () => {
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, kind: "income" })).toHaveLength(2);
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, kind: "expense" })).toHaveLength(2);
  });

  it("searches label AND category, case-insensitively", () => {
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, query: "acme" })).toHaveLength(2);
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, query: "RENT" })).toHaveLength(1);
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, query: "food" })).toHaveLength(1);
    expect(filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, query: "zzz" })).toHaveLength(0);
  });

  it("applies an inclusive date range", () => {
    const out = filterHistoryRows(ROWS, { ...EMPTY_HISTORY_FILTERS, from: "2026-10-01", to: "2026-10-03" });
    expect(out.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-03"]);
  });

  it("computes monthly in/out/net totals, newest month first", () => {
    const totals = monthlyTotals(ROWS);
    expect(totals).toEqual([
      { month: "2026-10", incomeCents: 90000, expenseCents: 12000, netCents: 78000 },
      { month: "2026-09", incomeCents: 90000, expenseCents: 60000, netCents: 30000 },
    ]);
  });

  it("labels months in local human form", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("garbage")).toBe("garbage");
  });
});
