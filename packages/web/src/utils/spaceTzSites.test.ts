import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphNode, TimelineChapter } from "@brain/shared";

/**
 * Audit-2 item 2 — FALSIFICATION: with the device zone ≠ the space's
 * configured zone, EVERY listed web derivation must follow the SPACE zone.
 *
 * Method: the process TZ is the device zone (the gate runs this suite
 * under both America/New_York and Pacific/Kiritimati). The configured
 * space zone is set explicitly to whichever of those two zones gives a
 * DIFFERENT calendar day for the fixture instant, so the two zones
 * disagree by construction in every run. Each assertion below compares a
 * derivation that takes NO zone argument (the production call shape)
 * against an independent Intl oracle for the space zone — on the base
 * code every one of these derivations used the device zone and failed.
 */

import { spaceLocalDay, localDateOfStored } from "./localDay.js";
import { parseTolerantMs } from "./dueReminders.js";
import { getSpaceTimeZone, resetSpaceTimeZoneForTests, setSpaceTimeZone } from "./spaceTimezone.js";
import { questLocalDay, resolveDailyQuests } from "../components/quests.js";
import { formatLocalDate, buildRows } from "../components/TimelineView.js";
import { billNotificationKey, hasLoggedToday } from "../App.helpers.js";
import { emptyDailyDigest, getDailyDigest } from "../api/client.js";
import { today as financeToday } from "../components/FinancePanel.js";
import { todayKey as reviewTodayKey } from "../components/ReviewPanel.js";

/** Independent oracle: the YYYY-MM-DD of an instant in a zone, via Intl parts. */
function dayIn(d: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
// 2026-10-22T01:00Z is Oct 21 in America/New_York, Oct 22 in Pacific/Kiritimati.
const INSTANT = new Date("2026-10-22T01:00:00.000Z");
const SPACE_ZONE =
  dayIn(INSTANT, "America/New_York") !== dayIn(INSTANT, DEVICE_ZONE)
    ? "America/New_York"
    : "Pacific/Kiritimati";
const SPACE_DAY = dayIn(INSTANT, SPACE_ZONE);
const DEVICE_DAY = dayIn(INSTANT, DEVICE_ZONE);
// An instant that is "today" (same calendar day as INSTANT) in BOTH
// candidate zones, and a second instant that is NOT that day in either.
const TENDED_TODAY_ISO = "2026-10-21T12:00:00.000Z";
const NOT_TODAY_ISO = "2026-10-22T12:00:00.000Z";

function memory(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1, label: "a memory", type: "memory", content: "",
    createdAt: "2026-09-01T00:00:00.000Z", degree: 1, entropy: 0, ...over,
  } as GraphNode;
}

function chapter(overrides: Partial<TimelineChapter> & { periodEnd: string }): TimelineChapter {
  return {
    id: 1, title: "Untitled", summary: "", theme: "", trend: "neutral", score: 0.5,
    periodStart: overrides.periodEnd, memoryIds: [], photoIds: [], threads: [],
    origin: "auto", createdAt: overrides.periodEnd, ...overrides,
  };
}

beforeEach(() => {
  resetSpaceTimeZoneForTests();
  setSpaceTimeZone(SPACE_ZONE);
});

afterEach(() => {
  resetSpaceTimeZoneForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fixture sanity — the two zones really disagree", () => {
  it("space zone ≠ device zone and their days differ for the fixture instant", () => {
    expect(SPACE_ZONE).not.toBe(DEVICE_ZONE);
    expect(SPACE_DAY).not.toBe(DEVICE_DAY);
    expect(getSpaceTimeZone()).toBe(SPACE_ZONE);
    expect(dayIn(new Date(TENDED_TODAY_ISO), SPACE_ZONE)).toBe(SPACE_DAY);
    expect(dayIn(new Date(NOT_TODAY_ISO), SPACE_ZONE)).not.toBe(SPACE_DAY);
  });

  it("pre-load (no configured zone set), the same helpers fall back to the device day", () => {
    resetSpaceTimeZoneForTests();
    expect(spaceLocalDay(INSTANT)).toBe(DEVICE_DAY);
    expect(questLocalDay(INSTANT)).toBe(DEVICE_DAY);
  });
});

describe("canonical helpers — localDay.ts", () => {
  it("spaceLocalDay() with no zone follows the SPACE zone", () => {
    expect(spaceLocalDay(INSTANT)).toBe(SPACE_DAY);
  });

  it("localDateOfStored() with no zone buckets a stored timestamp by the SPACE day", () => {
    const stored = "2026-10-22 01:30:00"; // naive SQLite = 01:30 UTC
    const expected = dayIn(new Date("2026-10-22T01:30:00.000Z"), SPACE_ZONE);
    expect(localDateOfStored(stored, parseTolerantMs)).toBe(expected);
    expect(localDateOfStored(stored, parseTolerantMs)).not.toBe(
      dayIn(new Date("2026-10-22T01:30:00.000Z"), DEVICE_ZONE),
    );
  });
});

describe("site 1 — Observatory quests (resolveDailyQuests with no timeZone opt)", () => {
  it("the quest day + per-day state key follow the SPACE zone", () => {
    const { dayState } = resolveDailyQuests([], false, { now: INSTANT, dayState: null });
    expect(dayState.day).toBe(SPACE_DAY);
    expect(questLocalDay(INSTANT)).toBe(SPACE_DAY);
  });

  it("tendedOnDay completion is judged on the SPACE day", () => {
    const cold = memory({ id: 7, entropy: 0.9, degree: 2 });
    const first = resolveDailyQuests([cold], false, { now: INSTANT, dayState: null });
    const tendedToday = memory({ id: 7, entropy: 0.9, degree: 2, lastTendedAt: TENDED_TODAY_ISO });
    const second = resolveDailyQuests([tendedToday], false, { now: INSTANT, dayState: first.dayState });
    expect(second.quests.find((q) => q.id === "warm")!.done).toBe(true);
    const tendedOtherDay = memory({ id: 7, entropy: 0.9, degree: 2, lastTendedAt: NOT_TODAY_ISO });
    const third = resolveDailyQuests([tendedOtherDay], false, { now: INSTANT, dayState: first.dayState });
    expect(third.quests.find((q) => q.id === "warm")!.done).toBe(false);
  });
});

describe("site 2 — Chronicle (TimelineView formatLocalDate + month bucketing)", () => {
  // 2026-11-01 02:00 UTC is Oct 31 in America/New_York, Nov 1 in Kiritimati.
  const RAW = "2026-11-01 02:00:00";
  const RAW_INSTANT = new Date("2026-11-01T02:00:00.000Z");

  it("formatLocalDate renders the SPACE zone's calendar day", () => {
    const [y, m, d] = dayIn(RAW_INSTANT, SPACE_ZONE).split("-").map(Number) as [number, number, number];
    const expected = new Date(y, m - 1, d).toLocaleDateString(undefined);
    const [dy, dm, dd] = dayIn(RAW_INSTANT, DEVICE_ZONE).split("-").map(Number) as [number, number, number];
    const deviceRendering = new Date(dy, dm - 1, dd).toLocaleDateString(undefined);
    expect(expected).not.toBe(deviceRendering);
    expect(formatLocalDate(RAW)).toBe(expected);
  });

  it("buildRows buckets the chapter under the SPACE zone's month", () => {
    const [y, m] = dayIn(RAW_INSTANT, SPACE_ZONE).split("-").map(Number) as [number, number, number];
    const expectedLabel = new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    const [dy, dm] = dayIn(RAW_INSTANT, DEVICE_ZONE).split("-").map(Number) as [number, number, number];
    const deviceLabel = new Date(dy, dm - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
    expect(expectedLabel).not.toBe(deviceLabel);
    const rows = buildRows([chapter({ id: 1, periodEnd: RAW })]);
    expect(rows.find((r) => r.type === "header")).toMatchObject({ type: "header", label: expectedLabel });
  });
});

describe("site 3 — App bill-notification day key", () => {
  it("billNotificationKey keys on the SPACE day", () => {
    expect(billNotificationKey(7, INSTANT)).toBe(`notif.bill.7.${SPACE_DAY}`);
    expect(billNotificationKey("rent", INSTANT)).toBe(`notif.bill.rent.${SPACE_DAY}`);
  });
});

describe("site 4 — App streak 'logged today'", () => {
  it("hasLoggedToday judges createdAt instants against the SPACE day", () => {
    const nodes = [{ kind: "memory", createdAt: TENDED_TODAY_ISO }] as Pick<GraphNode, "kind" | "createdAt">[];
    expect(hasLoggedToday(nodes, INSTANT)).toBe(true);
    const stale = [{ kind: "memory", createdAt: NOT_TODAY_ISO }] as Pick<GraphNode, "kind" | "createdAt">[];
    expect(hasLoggedToday(stale, INSTANT)).toBe(false);
    const actionsOnly = [{ kind: "action", createdAt: TENDED_TODAY_ISO }] as Pick<GraphNode, "kind" | "createdAt">[];
    expect(hasLoggedToday(actionsOnly, INSTANT)).toBe(false);
  });
});

describe("site 5 — api/client empty-digest fallback date", () => {
  it("emptyDailyDigest dates the fallback with the SPACE day", () => {
    expect(emptyDailyDigest(INSTANT).date).toBe(SPACE_DAY);
  });

  it("getDailyDigest's failure fallback carries the SPACE day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(INSTANT);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const digest = await getDailyDigest();
    expect(digest.date).toBe(SPACE_DAY);
    expect(digest.fresh).toEqual([]);
  });
});

describe("site 6 — FinancePanel form-default dates", () => {
  it("today() defaults form dates to the SPACE day", () => {
    expect(financeToday(INSTANT)).toBe(SPACE_DAY);
  });
});

describe("site 7 — ReviewPanel daily recall-cap key", () => {
  it("todayKey() keys the cap on the SPACE day", () => {
    expect(reviewTodayKey(INSTANT)).toBe(`review.doneToday.${SPACE_DAY}`);
  });
});
