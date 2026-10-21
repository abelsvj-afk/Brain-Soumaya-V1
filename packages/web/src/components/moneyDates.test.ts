import { describe, it, expect } from "vitest";
import { parseMoneyDate, daysFromToday, relDayLabel, fmtMoneyDate, fmtMoneyDateRel, fmtStampRel } from "./moneyDates.js";

// Fixed "now": Tuesday 2026-10-20, midday local (TZ=America/New_York in the suite).
const NOW = new Date(2026, 9, 20, 12, 0, 0);

describe("moneyDates (IM-83)", () => {
  it("parses a date-only string as that LOCAL day, not UTC midnight", () => {
    const d = parseMoneyDate("2026-10-23")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(23);
  });

  it("counts whole local days from today", () => {
    expect(daysFromToday("2026-10-20", NOW)).toBe(0);
    expect(daysFromToday("2026-10-23", NOW)).toBe(3);
    expect(daysFromToday("2026-10-17", NOW)).toBe(-3);
  });

  it("relativizes with weekday language", () => {
    expect(relDayLabel("2026-10-20", NOW)).toBe("today");
    expect(relDayLabel("2026-10-21", NOW)).toBe("tomorrow");
    expect(relDayLabel("2026-10-19", NOW)).toBe("yesterday");
    expect(relDayLabel("2026-10-23", NOW)).toBe("in 3 days");
    expect(relDayLabel("2026-10-10", NOW)).toBe("10 days ago");
  });

  it("renders weekday + relative instead of a bare ISO slice", () => {
    // 2026-10-23 is a Friday.
    expect(fmtMoneyDate("2026-10-23")).toBe("Fri, Oct 23");
    expect(fmtMoneyDateRel("2026-10-23", NOW)).toBe("Fri, Oct 23 · in 3 days");
    expect(fmtMoneyDateRel("2026-10-20", NOW)).toBe("Tue, Oct 20 · today");
  });

  it("renders timestamps with a date and a near-term relative label", () => {
    expect(fmtStampRel("2026-10-18T09:30:00", NOW)).toBe("Oct 18, 2026 · 2 days ago");
    expect(fmtStampRel("2025-01-05T09:30:00", NOW)).toBe("Jan 5, 2025");
  });

  it("degrades honestly on garbage input", () => {
    expect(parseMoneyDate("x")).toBeNull();
    expect(relDayLabel("x", NOW)).toBe("");
    expect(fmtMoneyDate("x")).toBe("x");
    expect(fmtStampRel("x", NOW)).toBe("");
  });
});
