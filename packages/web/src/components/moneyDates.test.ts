import { describe, it, expect } from "vitest";
import { parseMoneyDate, daysFromToday, relDayLabel, fmtMoneyDate, fmtMoneyDateRel, fmtStampRel } from "./moneyDates.js";

// ADR-019 §3.4: relative-day math is pinned to the SPACE timezone, not the
// device zone. The base cases below pass an explicit zone with a fixed UTC
// instant for "now", so they hold identically under both gate TZs
// (TZ=America/New_York and TZ=Pacific/Kiritimati).
const NY = "America/New_York";
const KIRITIMATI = "Pacific/Kiritimati";
// Tuesday 2026-10-20, midday in America/New_York (16:00Z = 12:00 EDT).
const NOW = new Date("2026-10-20T16:00:00Z");
// Un-migrated callers (no zone) still resolve through spaceLocalDay's fallback
// (device zone pre-load) — a device-local midday keeps those expectations stable.
const NOW_LOCAL = new Date(2026, 9, 20, 12, 0, 0);

describe("moneyDates (IM-83)", () => {
  it("parses a date-only string as that LOCAL day, not UTC midnight", () => {
    const d = parseMoneyDate("2026-10-23")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(23);
  });

  it("counts whole days from the space-local today", () => {
    expect(daysFromToday("2026-10-20", NOW, NY)).toBe(0);
    expect(daysFromToday("2026-10-23", NOW, NY)).toBe(3);
    expect(daysFromToday("2026-10-17", NOW, NY)).toBe(-3);
  });

  it("relativizes with weekday language", () => {
    expect(relDayLabel("2026-10-20", NOW, NY)).toBe("today");
    expect(relDayLabel("2026-10-21", NOW, NY)).toBe("tomorrow");
    expect(relDayLabel("2026-10-19", NOW, NY)).toBe("yesterday");
    expect(relDayLabel("2026-10-23", NOW, NY)).toBe("in 3 days");
    expect(relDayLabel("2026-10-10", NOW, NY)).toBe("10 days ago");
  });

  it("renders weekday + relative instead of a bare ISO slice", () => {
    // 2026-10-23 is a Friday.
    expect(fmtMoneyDate("2026-10-23")).toBe("Fri, Oct 23");
    expect(fmtMoneyDateRel("2026-10-23", NOW, NY)).toBe("Fri, Oct 23 · in 3 days");
    expect(fmtMoneyDateRel("2026-10-20", NOW, NY)).toBe("Tue, Oct 20 · today");
  });

  it("renders timestamps with a date and a near-term relative label", () => {
    // 13:30Z is 09:30 EDT on Oct 18 — the space-zone day of the instant.
    expect(fmtStampRel("2026-10-18T13:30:00Z", NOW, NY)).toBe("Oct 18, 2026 · 2 days ago");
    expect(fmtStampRel("2025-01-05T14:30:00Z", NOW, NY)).toBe("Jan 5, 2025");
  });

  it("without a zone, falls back to the device-zone day (un-migrated callers)", () => {
    expect(daysFromToday("2026-10-20", NOW_LOCAL)).toBe(0);
    expect(relDayLabel("2026-10-23", NOW_LOCAL)).toBe("in 3 days");
    expect(fmtStampRel("2026-10-18T09:30:00", NOW_LOCAL)).toBe("Oct 18, 2026 · 2 days ago");
  });

  it("degrades honestly on garbage input", () => {
    expect(parseMoneyDate("x")).toBeNull();
    expect(relDayLabel("x", NOW, NY)).toBe("");
    expect(fmtMoneyDate("x")).toBe("x");
    expect(fmtStampRel("x", NOW, NY)).toBe("");
  });
});

describe("moneyDates — space timezone (ADR-019 §3.4)", () => {
  // 2026-10-20T02:30:00Z is Oct 19 22:30 in New York (EDT) but Oct 20 16:30 in
  // Kiritimati — the device day and the space day differ in at least one gate TZ
  // for each case, which is exactly the D7 defect.
  const INSTANT = new Date("2026-10-20T02:30:00Z");

  it("T11: labels follow America/New_York when it is the space zone, not the UTC/device day", () => {
    // Space day is Oct 19 even though the UTC day is Oct 20.
    expect(daysFromToday("2026-10-19", INSTANT, NY)).toBe(0);
    expect(relDayLabel("2026-10-19", INSTANT, NY)).toBe("today");
    expect(relDayLabel("2026-10-20", INSTANT, NY)).toBe("tomorrow");
    expect(relDayLabel("2026-10-18", INSTANT, NY)).toBe("yesterday");
    expect(fmtMoneyDateRel("2026-10-20", INSTANT, NY)).toBe("Tue, Oct 20 · tomorrow");
    // A timestamp input takes its day in the space zone too: the instant itself
    // is "today" (Oct 19 in NY), and 02:30Z the previous day was Oct 18 in NY.
    expect(daysFromToday("2026-10-20T02:30:00Z", INSTANT, NY)).toBe(0);
    expect(relDayLabel("2026-10-19T02:30:00Z", INSTANT, NY)).toBe("yesterday");
    expect(fmtStampRel("2026-10-20T02:30:00Z", INSTANT, NY)).toBe("Oct 19, 2026 · today");
  });

  it("T11: labels follow Pacific/Kiritimati when it is the space zone", () => {
    // The same instant is Oct 20 in Kiritimati.
    expect(daysFromToday("2026-10-20", INSTANT, KIRITIMATI)).toBe(0);
    expect(relDayLabel("2026-10-20", INSTANT, KIRITIMATI)).toBe("today");
    expect(relDayLabel("2026-10-21", INSTANT, KIRITIMATI)).toBe("tomorrow");
    expect(fmtMoneyDateRel("2026-10-19", INSTANT, KIRITIMATI)).toBe("Mon, Oct 19 · yesterday");
    // 11:00Z on Oct 19 is 01:00 on Oct 20 in Kiritimati — "today" there,
    // even though its UTC day is Oct 19.
    expect(daysFromToday("2026-10-19T11:00:00Z", INSTANT, KIRITIMATI)).toBe(0);
    expect(fmtStampRel("2026-10-19T11:00:00Z", INSTANT, KIRITIMATI)).toBe("Oct 20, 2026 · today");
  });
});
