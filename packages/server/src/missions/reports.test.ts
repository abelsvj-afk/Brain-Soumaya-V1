import { describe, it, expect } from "vitest";
import { buildScoutingReport } from "./reports.js";
import type { ScoutFacts } from "./repo.js";

/**
 * Scouting reports: a plain-words observation of a true fact, never
 * a fabrication, never urgency. The builder is pure — these tests
 * pin the sentences for each shape of verified fact. Destinations
 * are the four mission destinations only; the Growing Place and
 * Deep Past have no sentences here (AD4).
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z");

const facts = (over: Partial<ScoutFacts> = {}): ScoutFacts => ({
  arrivals: 0,
  lastArrivalMs: null,
  worldCount: null,
  worldCountLabel: null,
  arrivalsToday: null,
  inbound: null,
  peopleCount: null,
  ...over,
});

describe("buildScoutingReport", () => {
  it("says plainly when no journey of yours has arrived", () => {
    const report = buildScoutingReport("scale", facts(), T0);
    expect(report).toContain("No journey of yours has arrived at Scale yet.");
    expect(report).toContain("That is what the fleet saw — nothing more, nothing added.");
  });

  it("counts arrivals and dates the last one in plain words", () => {
    const report = buildScoutingReport(
      "scale",
      facts({ arrivals: 3, lastArrivalMs: T0 - 2 * 3_600_000 }),
      T0,
    );
    expect(report).toContain("3 journeys of yours have arrived at Scale");
    expect(report).toContain("about 2 hours ago");
  });

  it("uses the singular for a single held thing", () => {
    const report = buildScoutingReport(
      "quiet-archive",
      facts({ arrivals: 1, lastArrivalMs: T0 - 60_000, worldCount: 1, worldCountLabel: "things resting" }),
      T0,
    );
    expect(report).toContain("One journey of yours has arrived at Quiet/Archive");
    expect(report).toContain("It holds 1 thing resting.");
  });

  it("reports the Station's day honestly", () => {
    const report = buildScoutingReport(
      "great-station",
      facts({ arrivals: 2, lastArrivalMs: T0 - 30 * 60_000, arrivalsToday: 2, inbound: 1 }),
      T0,
    );
    expect(report).toContain("2 journeys have arrived here today.");
    expect(report).toContain("One journey is on its way in.");
  });

  it("reports the People gathered, and never invents a lantern or growth", () => {
    const report = buildScoutingReport(
      "people",
      facts({ arrivals: 0, peopleCount: 4 }),
      T0,
    );
    expect(report).toContain("4 people are gathered here.");
    expect(report).not.toContain("grown");
    expect(report).not.toContain("lantern");
    expect(report).not.toContain("NOW");
    expect(report).not.toContain("urgent");
  });
});
