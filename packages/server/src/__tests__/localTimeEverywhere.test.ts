import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { setPreference } from "../agent/notify/policy.js";
import {
  localDayInZone,
  localMonthInZone,
  localDayBoundsMs,
  localDateOfStored,
} from "../lib/time.js";
import { actionFiredToday } from "../communication/context.js";
import { buildDailyDigest } from "../synthesis/dailyDigest.js";
import { getDailyContact } from "../analysis/dailyContact.js";
import { detectForesight } from "../analysis/foresight.js";
import { buildEmotionalTrajectory } from "../analysis/emotional.js";
import { weekStart } from "../finance/budget.js";
import { incomeSeries } from "../finance/incomeTrend.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";

/**
 * Local-time-everywhere sweep (owner rule, restated 2026-10-21: NO UTC in
 * anything user-facing — every calendar boundary, bucket, label, "today",
 * and day-keyed limit is computed in the SPACE's own timezone).
 *
 * The discriminating instant used throughout: 2026-10-22T01:00:00Z is
 * Oct 21, 9:00 PM in America/New_York (the owner's Florida evening) but
 * Oct 22, 3:00 PM in Pacific/Kiritimati — the two zones disagree about
 * which calendar day it is, so any code still keying on the UTC day (or
 * the stored string's date prefix) fails these pins in at least one zone.
 */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => {
  vi.useRealTimers();
  handle.sqlite.close();
});

function setTz(spaceId: string, tz: string) {
  handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
  setPreference(handle.sqlite, spaceId, "timezone", tz);
}

describe("lib/time — space-local calendar helpers", () => {
  const INSTANT = Date.parse("2026-10-22T01:00:00.000Z"); // Oct 21 NY / Oct 22 Kiritimati

  it("localDayInZone follows the zone, not UTC", () => {
    expect(localDayInZone(INSTANT, "America/New_York")).toBe("2026-10-21");
    expect(localDayInZone(INSTANT, "Pacific/Kiritimati")).toBe("2026-10-22");
    expect(localMonthInZone(INSTANT, "America/New_York")).toBe("2026-10");
  });

  it("localDayBoundsMs spans the real local midnights (24h on a plain day)", () => {
    const { startMs, endMs } = localDayBoundsMs(INSTANT, "America/New_York");
    expect(new Date(startMs).toISOString()).toBe("2026-10-21T04:00:00.000Z"); // NY midnight (EDT)
    expect(new Date(endMs).toISOString()).toBe("2026-10-22T04:00:00.000Z");
  });

  it("localDayBoundsMs spans 23h on the spring-forward day", () => {
    // 2026-03-08 is the US spring-forward day; noon UTC is that local day in NY.
    const { startMs, endMs } = localDayBoundsMs(Date.parse("2026-03-08T12:00:00.000Z"), "America/New_York");
    expect(endMs - startMs).toBe(23 * 3_600_000);
    expect(localDayInZone(startMs, "America/New_York")).toBe("2026-03-08");
  });

  it("localDateOfStored: bare dates are verbatim in every zone; instants take their local day", () => {
    expect(localDateOfStored("2026-10-21", "America/New_York")).toBe("2026-10-21");
    expect(localDateOfStored("2026-10-21", "Pacific/Kiritimati")).toBe("2026-10-21");
    // Naive SQLite timestamp (stored as UTC): Oct 22 01:30 UTC.
    expect(localDateOfStored("2026-10-22 01:30:00", "America/New_York")).toBe("2026-10-21");
    expect(localDateOfStored("2026-10-22 01:30:00", "Pacific/Kiritimati")).toBe("2026-10-22");
    expect(localDateOfStored("2026-10-22T01:30:00.000Z", "America/New_York")).toBe("2026-10-21");
    expect(localDateOfStored("not a date", "America/New_York")).toBeNull();
    expect(localDateOfStored(null, "America/New_York")).toBeNull();
  });
});

describe("actionFiredToday — once-per-day guards follow the space's local day", () => {
  function logAt(spaceId: string, createdAt: string) {
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES (?, 'tool:check_in', 'x', '[]', ?)`)
      .run(spaceId, createdAt);
  }

  it("New York: a 9:30pm-local firing belongs to that local day, not the next UTC day", () => {
    setTz("ny", "America/New_York");
    logAt("ny", "2026-10-22 01:30:00"); // stored UTC string = Oct 21, 9:30 PM in New York
    // Later that same New York evening → already fired today.
    expect(actionFiredToday(handle, "ny", "tool:check_in", new Date("2026-10-22T03:00:00.000Z"))).toBe(true);
    // 1:00 AM New York on Oct 22 → a NEW local day, even though the stored
    // row's UTC date (Oct 22) equals the UTC date of "now" (the old
    // substr(created_at,1,10) guard wrongly blocked this).
    expect(actionFiredToday(handle, "ny", "tool:check_in", new Date("2026-10-22T05:00:00.000Z"))).toBe(false);
  });

  it("Kiritimati: a late-evening-local firing does not leak into the next local day", () => {
    setTz("ki", "Pacific/Kiritimati");
    logAt("ki", "2026-10-22 09:00:00"); // = Oct 22, 11:00 PM in Kiritimati
    // Oct 23, 1:00 AM in Kiritimati (= Oct 22 11:00 UTC) — new local day,
    // same UTC date as the stored row (the old guard wrongly blocked this).
    expect(actionFiredToday(handle, "ki", "tool:check_in", new Date("2026-10-22T11:00:00.000Z"))).toBe(false);
    // Same local evening → fired.
    expect(actionFiredToday(handle, "ki", "tool:check_in", new Date("2026-10-22T09:30:00.000Z"))).toBe(true);
  });
});

describe("daily digest — 'today' is the space's local day", () => {
  it("an evening-local memory counts as today's; a just-after-local-midnight one does not (yet)", () => {
    setTz("s1", "America/New_York");
    // "Now" = Oct 21, 11:00 PM in New York (= Oct 22 03:00 UTC).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T03:00:00.000Z"));
    const ins = handle.sqlite.prepare(
      `INSERT INTO nodes (space_id, label, type, content, created_at) VALUES ('s1', ?, 'daily', 'x', ?)`,
    );
    ins.run("evening memory", "2026-10-22 01:30:00"); // Oct 21, 9:30 PM local → today
    ins.run("after midnight", "2026-10-22 05:30:00"); // Oct 22, 1:30 AM local → NOT today yet
    const digest = buildDailyDigest(handle, "s1");
    expect(digest.date).toBe("2026-10-21");
    const labels = digest.fresh.map((f) => f.node.label);
    expect(labels).toContain("evening memory");
    expect(labels).not.toContain("after midnight");
  });
});

describe("daily contact — the daily question is keyed by the space's local day", () => {
  it("rolls over at local midnight, not UTC midnight", () => {
    setTz("s1", "America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T03:00:00.000Z")); // Oct 21, 11 PM in New York
    const contact = getDailyContact(ctx, "s1");
    expect(contact.date).toBe("2026-10-21");
  });
});

describe("foresight — weekday patterns use the space's local calendar", () => {
  function neg(spaceId: string, iso: string) {
    handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content, emotional_weight, occurred_at, created_at)
         VALUES (?, 'heavy', 'daily', 'a hard day', -0.6, ?, ?)`,
      )
      .run(spaceId, iso, iso);
  }

  it("memories logged Monday evenings local are a MONDAY pattern (their UTC weekday is Tuesday)", () => {
    setTz("s1", "America/New_York");
    // Four Mondays in New York, each logged 9:30 PM local = Tuesday 01:30 UTC.
    for (const d of ["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"]) {
      neg("s1", `${d}T01:30:00.000Z`); // local: Sep 28 / Oct 5 / Oct 12 / Oct 19 (Mondays)
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T16:00:00.000Z")); // Monday Oct 26, noon in New York
    const f = detectForesight(handle, "s1");
    expect(f?.kind).toBe("weekday");
    expect(f?.text).toContain("Mondays");
    expect(f?.text).toContain("That's today");
    expect(f?.inDays).toBe(0);
  });
});

describe("emotional trajectory — day buckets follow the space's local day", () => {
  it("an evening-local memory buckets into its local day", () => {
    setTz("s1", "America/New_York");
    const ins = handle.sqlite.prepare(
      `INSERT INTO nodes (space_id, label, type, content, emotional_weight, occurred_at, created_at)
       VALUES ('s1', ?, 'daily', 'x', -0.5, ?, ?)`,
    );
    ins.run("a", "2026-10-22T01:30:00.000Z", "2026-10-22T01:30:00.000Z"); // Oct 21 local
    ins.run("b", "2026-10-22T02:30:00.000Z", "2026-10-22T02:30:00.000Z"); // Oct 21 local
    const t = buildEmotionalTrajectory(handle, "s1");
    expect(t.points.map((p) => p.date)).toEqual(["2026-10-21"]);
  });
});

describe("finance — week and month boundaries follow the space's local calendar", () => {
  it("weekStart anchors on the local day's week", () => {
    // Oct 18, 2026 (a Sunday) 9:00 PM in New York = Oct 19 01:00 UTC (a Monday in UTC).
    const now = new Date("2026-10-19T01:00:00.000Z");
    // The user's week is the one containing their Sunday → Monday Oct 12.
    expect(weekStart(now, "America/New_York")).toBe("2026-10-12");
    // In Kiritimati the same instant is Monday Oct 19 → week starts Oct 19.
    expect(weekStart(now, "Pacific/Kiritimati")).toBe("2026-10-19");
  });

  it("incomeSeries ends at the space-local current month", () => {
    setTz("ny", "America/New_York");
    setTz("ki", "Pacific/Kiritimati");
    const incNy = new FinIncomeRepo(handle, "ny");
    incNy.create({ date: "2026-10-15", netCents: 1000 });
    const incKi = new FinIncomeRepo(handle, "ki");
    incKi.create({ date: "2026-10-15", netCents: 1000 });
    // Oct 31, 9:00 PM in New York (= Nov 1 01:00 UTC): still October for the user.
    const now = new Date("2026-11-01T01:00:00.000Z");
    const nySeries = incomeSeries(handle, "ny", 2, now);
    expect(nySeries[nySeries.length - 1]!.periodStart).toBe("2026-10-01");
    // Same instant in Kiritimati is Nov 1, 3:00 PM → the series ends at November.
    const kiSeries = incomeSeries(handle, "ki", 2, now);
    expect(kiSeries[kiSeries.length - 1]!.periodStart).toBe("2026-11-01");
  });
});
