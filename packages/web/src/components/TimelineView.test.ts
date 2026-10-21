import { describe, it, expect } from "vitest";
import type { TimelineChapter } from "@brain/shared";
import { normalizeDate, daysBetween, gapFor, buildRows, formatLocalDate } from "./TimelineView.js";

function chapter(overrides: Partial<TimelineChapter> & { periodEnd: string }): TimelineChapter {
  return {
    id: 1,
    title: "Untitled",
    summary: "",
    theme: "",
    trend: "neutral",
    score: 0.5,
    periodStart: overrides.periodEnd,
    memoryIds: [],
    photoIds: [],
    threads: [],
    origin: "auto",
    createdAt: overrides.periodEnd,
    ...overrides,
  };
}


/** Regression test for the same class of bug already fixed for remindAt/expiresAt
 *  elsewhere in the app: a naive SQLite timestamp ("YYYY-MM-DD HH:MM:SS", no zone)
 *  must be read as UTC, not the viewer's local timezone, or a chapter's displayed
 *  date can land a day off from what the server (analysis/timeline.ts) computed. */
describe("TimelineView.normalizeDate", () => {
  it("treats a naive space-separated timestamp as UTC", () => {
    const d = normalizeDate("2026-01-15 23:30:00");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(23);
  });

  it("leaves an already-zoned ISO string untouched", () => {
    const d = normalizeDate("2026-01-15T23:30:00Z");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCDate()).toBe(15);
  });

  it("leaves an explicit-offset timestamp untouched", () => {
    const d = normalizeDate("2026-01-15T23:30:00+05:00");
    expect(d.getUTCHours()).toBe(18);
  });
});

describe("TimelineView.daysBetween", () => {
  it("counts whole days between two UTC timestamps", () => {
    expect(daysBetween("2026-01-01 00:00:00", "2026-01-04 00:00:00")).toBe(3);
  });

  it("never goes negative for an out-of-order pair", () => {
    expect(daysBetween("2026-01-10 00:00:00", "2026-01-01 00:00:00")).toBe(0);
  });
});

/** The actual "does this behave like a real timeline now" check — replaces the old
 *  index-based river spacing (every gap identical regardless of elapsed time) with a
 *  measured, monotonic function of real elapsed days. Verified by assertion, not by
 *  eyeballing a rendered scene, per this repo's own measure-before-you-ship rule. */
describe("TimelineView.gapFor", () => {
  it("floors at the minimum gap for zero, negative, or NaN elapsed days", () => {
    expect(gapFor(0)).toBe(28);
    expect(gapFor(-5)).toBe(28);
    expect(gapFor(NaN)).toBe(28);
  });

  it("grows monotonically with more elapsed time", () => {
    const oneDay = gapFor(1);
    const oneMonth = gapFor(30);
    const oneYear = gapFor(365);
    expect(oneDay).toBeLessThan(oneMonth);
    expect(oneMonth).toBeLessThan(oneYear);
  });

  it("caps at the maximum gap for a very long gap", () => {
    expect(gapFor(10_000)).toBe(220);
    expect(gapFor(100_000)).toBe(220);
  });
});

describe("TimelineView.buildRows", () => {
  it("puts zero gap before the very first chapter", () => {
    const rows = buildRows([chapter({ id: 1, periodEnd: "2026-01-01 00:00:00" })]);
    expect(rows[0]).toMatchObject({ type: "header", gapBefore: 0 });
  });

  it("gives a chapter a day apart a smaller TOTAL gap than one a year apart", () => {
    // "Total" matters, not just the chapter row's own gapBefore — a month-crossing pair
    // puts the real elapsed-time gap on the inserted header row instead, so the fair
    // comparison sums everything between the two chapters, however it's distributed.
    const totalGapAfterFirst = (chapters: TimelineChapter[]) => {
      const rows = buildRows(chapters);
      const firstChapterIdx = rows.findIndex((r) => r.type === "chapter");
      return rows.slice(firstChapterIdx + 1).reduce((sum, r) => sum + r.gapBefore, 0);
    };
    const close = totalGapAfterFirst([
      chapter({ id: 1, periodEnd: "2026-01-01 00:00:00" }),
      chapter({ id: 2, periodEnd: "2026-01-02 00:00:00" }),
    ]);
    const far = totalGapAfterFirst([
      chapter({ id: 1, periodEnd: "2025-01-01 00:00:00" }),
      chapter({ id: 2, periodEnd: "2026-01-01 00:00:00" }),
    ]);
    expect(close).toBeLessThan(far);
  });

  it("inserts a month/year header only when the calendar month actually changes", () => {
    // Midday-UTC fixtures: the LOCAL month is Jan/Jan/Feb in both gate zones
    // (America/New_York and Pacific/Kiritimati) — grouping is local now.
    const rows = buildRows([
      chapter({ id: 1, periodEnd: "2026-01-05 12:00:00" }),
      chapter({ id: 2, periodEnd: "2026-01-20 12:00:00" }), // same month — no new header
      chapter({ id: 3, periodEnd: "2026-02-01 12:00:00" }), // new month — new header
    ]);
    const headers = rows.filter((r) => r.type === "header");
    expect(headers).toHaveLength(2);
  });

  it("groups a chapter under its LOCAL month, not the UTC month of the stored instant", () => {
    // 2026-02-01 02:00 UTC is Jan 31 21:00 in America/New_York and Feb 1
    // 16:00 in Pacific/Kiritimati — the header must match the zone the
    // runtime reports (the device/space zone), computed independently here.
    const rows = buildRows([chapter({ id: 1, periodEnd: "2026-02-01 02:00:00" })]);
    const header = rows.find((r) => r.type === "header");
    const expectedLabel = new Date(Date.UTC(2026, 1, 1, 2)).toLocaleString(undefined, { month: "long", year: "numeric" });
    expect(header).toMatchObject({ type: "header", label: expectedLabel });
  });
});

describe("TimelineView.formatLocalDate — the day the user lived, in their zone", () => {
  it("renders the local calendar day of a stored instant (never its UTC day)", () => {
    const raw = "2026-01-01 02:00:00"; // naive SQLite = 02:00 UTC
    const instant = new Date(Date.UTC(2026, 0, 1, 2));
    const expected = instant.toLocaleDateString(undefined);
    expect(formatLocalDate(raw)).toBe(expected);
    // In America/New_York this is 12/31/2025 — a UTC-pinned render (the old
    // code) would print 1/1/2026 there and fail this assertion under that TZ.
  });

  it("a bare YYYY-MM-DD is a fixed calendar date and renders as itself", () => {
    const rendered = formatLocalDate("2026-03-15");
    const back = new Date(rendered);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(2);
    expect(back.getDate()).toBe(15);
  });

  it("returns '' for an unparseable value instead of 'Invalid Date'", () => {
    expect(formatLocalDate("not-a-date")).toBe("");
    expect(formatLocalDate("")).toBe("");
  });
});
