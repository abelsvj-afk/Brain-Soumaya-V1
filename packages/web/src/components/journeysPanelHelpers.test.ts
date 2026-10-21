import { describe, it, expect } from "vitest";
import type { Journey } from "@brain/shared";
import {
  firstGrapheme,
  nextIconValue,
  formatJourneyDate,
  filterAndSortJourneys,
  nextStepFor,
} from "./journeysPanelHelpers.js";

/**
 * CL-10 helpers — IM-89 (grapheme-aware icon truncation), IM-88 (local dates,
 * search/filter/sort, next-step prompt). Falsification note: firstGrapheme /
 * nextIconValue fail against the pre-change code-point truncation
 * (`Array.from(v).slice(0, 1)`) for every ZWJ/flag/modifier case below.
 */

describe("firstGrapheme (IM-89)", () => {
  it("keeps a ZWJ family emoji whole instead of cutting it to the first person", () => {
    expect(firstGrapheme("👨‍👩‍👧")).toBe("👨‍👩‍👧");
    expect(firstGrapheme("👨‍👩‍👧abc")).toBe("👨‍👩‍👧");
  });

  it("keeps a flag (regional-indicator pair) whole instead of a lone half-flag", () => {
    expect(firstGrapheme("🇺🇸")).toBe("🇺🇸");
    expect(firstGrapheme("🇺🇸x")).toBe("🇺🇸");
  });

  it("keeps skin-tone modifiers and keycaps attached", () => {
    expect(firstGrapheme("👍🏽")).toBe("👍🏽");
    expect(firstGrapheme("1️⃣")).toBe("1️⃣");
  });

  it("keeps combining marks attached and handles plain input", () => {
    expect(firstGrapheme("éclair")).toBe("é"); // e + combining acute
    expect(firstGrapheme("🧭")).toBe("🧭");
    expect(firstGrapheme("a")).toBe("a");
    expect(firstGrapheme("")).toBe("");
  });
});

describe("nextIconValue (IM-89)", () => {
  it("replaces the icon when a new emoji is typed after the existing one", () => {
    expect(nextIconValue("🧭", "🧭🚀")).toBe("🚀");
    expect(nextIconValue("🧭", "🧭👨‍👩‍👧")).toBe("👨‍👩‍👧");
  });

  it("keeps the first grapheme of a fresh/pasted value and clears on empty", () => {
    expect(nextIconValue("", "🇺🇸🇨🇦")).toBe("🇺🇸");
    expect(nextIconValue("🧭", "")).toBe("");
  });
});

describe("formatJourneyDate (IM-88, local time)", () => {
  it("formats a full ISO timestamp in local time", () => {
    // 2026-03-04T12:00:00Z is the morning of Mar 4 in America/New_York.
    // Zone-derived expectation (Round 2 coordinator): IM-88 dates are LOCAL
    // time by design — noon UTC is Mar 4 in New York, Mar 5 in Kiritimati.
    expect(formatJourneyDate("2026-03-04T12:00:00.000Z")).toBe(
      new Date("2026-03-04T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    );
  });

  it("treats a date-only string as that local calendar date, not UTC midnight", () => {
    // new Date("2026-01-01") is UTC midnight = Dec 31, 2025 in New York; the
    // transaction's date is Jan 1 and must render as Jan 1.
    expect(formatJourneyDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("returns null for missing or unparseable values", () => {
    expect(formatJourneyDate(undefined)).toBeNull();
    expect(formatJourneyDate(null)).toBeNull();
    expect(formatJourneyDate("not a date")).toBeNull();
  });
});

function j(over: Partial<Journey>): Journey {
  return {
    id: 1, title: "Alpha", description: "", status: "active", progress: 0,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", linkCount: 0,
    ...over,
  } as Journey;
}

describe("filterAndSortJourneys (IM-88)", () => {
  const list = [
    j({ id: 1, title: "Beta", description: "health chapter", progress: 0.2, linkCount: 5, updatedAt: "2026-02-01T00:00:00.000Z" }),
    j({ id: 2, title: "alpha", description: "money", progress: 0.9, linkCount: 1, updatedAt: "2026-03-01T00:00:00.000Z", status: "paused" }),
    j({ id: 3, title: "Gamma", description: "Health too", progress: 0.5, linkCount: 3, updatedAt: "2026-01-15T00:00:00.000Z" }),
  ];

  it("searches title and description, case-insensitively", () => {
    expect(filterAndSortJourneys(list, "health", "all", "recent").map((x) => x.id)).toEqual([1, 3]);
    expect(filterAndSortJourneys(list, "ALPHA", "all", "recent").map((x) => x.id)).toEqual([2]);
  });

  it("filters by status", () => {
    expect(filterAndSortJourneys(list, "", "paused", "recent").map((x) => x.id)).toEqual([2]);
  });

  it("sorts by recent / title / progress / links without mutating the input", () => {
    expect(filterAndSortJourneys(list, "", "all", "recent").map((x) => x.id)).toEqual([2, 1, 3]);
    expect(filterAndSortJourneys(list, "", "all", "title").map((x) => x.id)).toEqual([2, 1, 3]);
    expect(filterAndSortJourneys(list, "", "all", "progress").map((x) => x.id)).toEqual([2, 3, 1]);
    expect(filterAndSortJourneys(list, "", "all", "links").map((x) => x.id)).toEqual([1, 3, 2]);
    expect(list.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe("nextStepFor (IM-88)", () => {
  it("prompts to link something when the journey is empty", () => {
    expect(nextStepFor({ status: "active", pct: 0, totalCount: 0, taskCount: 0, goalCount: 0 })).toMatch(/link a memory, task, or transaction/i);
  });

  it("names the linked tasks when tasks are linked", () => {
    expect(nextStepFor({ status: "active", pct: 20, totalCount: 3, taskCount: 2, goalCount: 0 })).toMatch(/2 linked tasks/);
  });

  it("surfaces the 100% milestone and stays silent for a done journey", () => {
    expect(nextStepFor({ status: "active", pct: 100, totalCount: 1, taskCount: 0, goalCount: 0 })).toMatch(/Milestone reached/);
    expect(nextStepFor({ status: "done", pct: 100, totalCount: 1, taskCount: 0, goalCount: 0 })).toBeNull();
  });
});
