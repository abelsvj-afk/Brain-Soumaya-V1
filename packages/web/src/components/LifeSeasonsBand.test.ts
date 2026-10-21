import { describe, it, expect } from "vitest";
import type { JourneySpan, LifeSeason } from "@brain/shared";
import { buildSeasonAxis, utcDayMs } from "./LifeSeasonsBand.js";

function season(overrides: Partial<LifeSeason> = {}): LifeSeason {
  return {
    id: 1, chapterId: 1, label: "Recovery Era", theme: "recovery", trend: "growth",
    confidence: 0.6, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-03-31T00:00:00Z",
    startDate: "2026-01-01", endDate: "2026-03-31", ...overrides,
  };
}
function span(overrides: Partial<JourneySpan> = {}): JourneySpan {
  const base: JourneySpan = {
    journey: { id: 1, title: "Become an RN", description: "", status: "active", progress: 0.2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    start: "2026-01-01T00:00:00Z", end: "2026-07-01T00:00:00Z", ongoing: false,
    startDate: "2026-01-01", endDate: "2026-07-01", startSource: "explicit", endSource: "explicit",
  };
  return { ...base, ...overrides };
}

describe("LifeSeasonsBand.utcDayMs", () => {
  it("parses a fixed calendar date as UTC midnight in any timezone", () => {
    expect(utcDayMs("2026-01-15")).toBe(Date.UTC(2026, 0, 15));
    expect(new Date(utcDayMs("2026-01-15")).getUTCDate()).toBe(15);
  });
  it("returns NaN for malformed dates", () => {
    expect(Number.isNaN(utcDayMs("Jan 15 2026"))).toBe(true);
    expect(Number.isNaN(utcDayMs(""))).toBe(true);
  });
});

describe("LifeSeasonsBand.buildSeasonAxis — real time axis (IM-132)", () => {
  it("returns null when there is nothing dated to plot", () => {
    expect(buildSeasonAxis([], [], Date.UTC(2026, 0, 1))).toBeNull();
    expect(buildSeasonAxis([season({ startDate: "bad", endDate: "bad" })], [], 0)).toBeNull();
  });

  it("positions bands PROPORTIONALLY to elapsed time, not by index", () => {
    // Axis domain: Jan 1 → Jul 1 (span end). A season covering Jan–Mar is the
    // first ~half of the axis; an equal-length season starting later sits later.
    const now = Date.UTC(2026, 6, 1);
    const early = season({ id: 1, startDate: "2026-01-01", endDate: "2026-03-31" });
    const late = season({ id: 2, startDate: "2026-04-01", endDate: "2026-06-30" });
    const axis = buildSeasonAxis([early, late], [span()], now)!;
    const [a, b] = axis.bands;
    expect(a!.leftPct).toBeCloseTo(0, 0);
    expect(b!.leftPct).toBeGreaterThan(45);
    // Equal elapsed lengths → (near-)equal widths, unlike index-based spacing.
    expect(Math.abs(a!.widthPct - b!.widthPct)).toBeLessThan(2);
    // A season twice as long is (near) twice as wide.
    const long = buildSeasonAxis([season({ startDate: "2026-01-01", endDate: "2026-06-30" })], [span()], now)!;
    expect(long.bands[0]!.widthPct).toBeGreaterThan(a!.widthPct * 1.8);
  });

  it("places a journey span over the same domain as the bands behind it", () => {
    const now = Date.UTC(2026, 6, 1);
    const axis = buildSeasonAxis([season()], [span()], now)!;
    expect(axis.spans[0]!.leftPct).toBeCloseTo(0, 0);
    expect(axis.spans[0]!.widthPct).toBeGreaterThan(95);
  });

  it("an ongoing span extends to now, and never produces NaN positions", () => {
    const now = Date.UTC(2026, 6, 1);
    const ongoing = span({ end: null, endDate: null, ongoing: true, endSource: "open", start: "2026-06-01T00:00:00Z", startDate: "2026-06-01" });
    const axis = buildSeasonAxis([], [ongoing], now)!;
    expect(axis.domainEndMs).toBe(now);
    expect(Number.isFinite(axis.spans[0]!.leftPct)).toBe(true);
    expect(Number.isFinite(axis.spans[0]!.widthPct)).toBe(true);
    expect(axis.spans[0]!.widthPct).toBeGreaterThan(0);
  });

  it("skips unparseable span starts instead of corrupting the axis", () => {
    const axis = buildSeasonAxis([season()], [span({ start: "not-a-date" })], Date.UTC(2026, 6, 1))!;
    expect(axis.spans).toHaveLength(0);
    expect(axis.bands).toHaveLength(1);
  });
});
