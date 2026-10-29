import { describe, it, expect } from "vitest";
import { spaceLocalDay, localDateOfStored } from "./localDay.js";
import { parseTolerantMs } from "./dueReminders.js";

/**
 * Local-time-everywhere sweep, web side (owner rule, restated 2026-10-21:
 * NO UTC in anything user-facing — every "today", day key, grouping, and
 * label follows the user's own timezone). These pins run under BOTH gate
 * timezones (America/New_York and Pacific/Kiritimati via test:web:tz).
 */
describe("spaceLocalDay", () => {
  it("renders the target zone's calendar date at a near-midnight boundary", () => {
    // 2026-10-22T01:00:00Z is Oct 21 in New York, Oct 22 in Kiritimati.
    const instant = new Date("2026-10-22T01:00:00.000Z");
    expect(spaceLocalDay(instant, "America/New_York")).toBe("2026-10-21");
    expect(spaceLocalDay(instant, "Pacific/Kiritimati")).toBe("2026-10-22");
  });

  it("never returns the UTC date when the device zone disagrees with UTC", () => {
    const instant = new Date("2026-10-22T01:00:00.000Z");
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Under either gate zone (New_York / Kiritimati), the local day of this
    // instant is well-defined and matches the Intl rendering in that zone.
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: deviceZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(instant).replace(/\//g, "-");
    // en-CA may render YYYY-MM-DD directly in this runtime; normalize both shapes.
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(expected)
      ? expected
      : spaceLocalDay(instant, deviceZone);
    expect(spaceLocalDay(instant)).toBe(normalized);
  });
});

describe("localDateOfStored", () => {
  it("returns a bare calendar date verbatim in every zone", () => {
    expect(localDateOfStored("2026-10-21", parseTolerantMs)).toBe("2026-10-21");
  });

  it("buckets a stored timestamp by the local day of its instant, not its string prefix", () => {
    // Naive SQLite timestamp for 2026-10-22 01:30 UTC. Its string prefix says
    // "2026-10-22" — the old `.slice(0, 10)` answer. The correct answer is the
    // local day of that instant on THIS device (the gate runs this file under
    // both America/New_York → 2026-10-21 and Pacific/Kiritimati → 2026-10-22).
    // Derived for whatever zone this machine is in (NY → 10-21, Kiritimati
    // and UTC → 10-22) — the claim is "the local day of the instant", never
    // "the string prefix", so the expectation comes from the instant itself.
    const instant = new Date(Date.UTC(2026, 9, 22, 1, 30));
    const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, "0")}-${String(instant.getDate()).padStart(2, "0")}`;
    expect(localDateOfStored("2026-10-22 01:30:00", parseTolerantMs)).toBe(expected);
    expect(localDateOfStored("2026-10-22T01:30:00.000Z", parseTolerantMs)).toBe(expected);
  });

  it("returns null for empty or unparseable values", () => {
    expect(localDateOfStored("", parseTolerantMs)).toBeNull();
    expect(localDateOfStored(null, parseTolerantMs)).toBeNull();
    expect(localDateOfStored("not a date", parseTolerantMs)).toBeNull();
  });
});
