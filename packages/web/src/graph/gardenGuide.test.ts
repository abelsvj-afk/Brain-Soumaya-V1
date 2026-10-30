import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_GUIDE,
  dayBeats,
  dayComplete,
  dayDoneCount,
  gardenObjective,
  guideSteps,
  guideVisible,
  nextGuideStep,
  readDay,
  readGuide,
  writeDay,
  writeGuide,
} from "./gardenGuide.js";

const base = { carryingLabel: null, podsWaiting: 0, coldPlots: 0, groves: 2 };

describe("gardenObjective priority", () => {
  it("carrying beats everything", () => {
    const o = gardenObjective({ ...base, carryingLabel: "Mum's recipe", podsWaiting: 3, coldPlots: 4 });
    expect(o.kind).toBe("carrying");
    expect(o.text).toContain("Mum's recipe");
    expect(o.text).toContain("grove");
  });
  it("carrying with no groves says how to put it back", () => {
    expect(gardenObjective({ ...base, carryingLabel: "x", groves: 0 }).text).toContain("Drop");
  });
  it("pods beat cold plots, singular and plural", () => {
    expect(gardenObjective({ ...base, podsWaiting: 1, coldPlots: 5 }).text).toBe("A seed pod is ready — tap it to recall it.");
    expect(gardenObjective({ ...base, podsWaiting: 3 }).text).toContain("3 seed pods");
  });
  it("cold plots, then rest", () => {
    expect(gardenObjective({ ...base, coldPlots: 2 }).kind).toBe("plots");
    expect(gardenObjective(base).kind).toBe("rest");
  });
});

describe("first-visit guide", () => {
  it("lists three steps and advances", () => {
    expect(guideSteps(EMPTY_GUIDE).map((s) => s.done)).toEqual([false, false, false]);
    expect(nextGuideStep(EMPTY_GUIDE)?.id).toBe("walk");
    expect(nextGuideStep({ ...EMPTY_GUIDE, walked: true })?.id).toBe("tend");
    expect(nextGuideStep({ walked: true, tended: true, carried: true, dismissed: false })).toBeNull();
  });
  it("hides when dismissed or finished", () => {
    expect(guideVisible(EMPTY_GUIDE)).toBe(true);
    expect(guideVisible({ ...EMPTY_GUIDE, dismissed: true })).toBe(false);
    expect(guideVisible({ walked: true, tended: true, carried: true, dismissed: false })).toBe(false);
  });
});

describe("garden day", () => {
  it("needs 3 tends, 1 place and 1 recall", () => {
    expect(dayComplete({ tends: 3, places: 1, recalls: 1 })).toBe(true);
    expect(dayComplete({ tends: 2, places: 1, recalls: 1 })).toBe(false);
    expect(dayDoneCount({ tends: 9, places: 0, recalls: 1 })).toBe(2);
  });
  it("caps a beat's progress at its goal", () => {
    expect(dayBeats({ tends: 9, places: 0, recalls: 0 })[0]).toMatchObject({ have: 3, goal: 3, done: true });
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips the guide per brain", () => {
    writeGuide("a", { walked: true, tended: false, carried: false, dismissed: false });
    expect(readGuide("a").walked).toBe(true);
    expect(readGuide("b")).toEqual(EMPTY_GUIDE);
  });
  it("round-trips the day and ignores garbage", () => {
    const d = new Date(2026, 9, 30);
    writeDay("a", { tends: 2, places: 1, recalls: 0, bloomed: false }, d);
    expect(readDay("a", d)).toMatchObject({ tends: 2, places: 1 });
    expect(readDay("a", new Date(2026, 9, 31)).tends).toBe(0);
    localStorage.setItem("garden.guide.z", "{nope");
    expect(readGuide("z")).toEqual(EMPTY_GUIDE);
  });
});
