import { describe, it, expect, beforeEach } from "vitest";
import type { GraphNode } from "@brain/shared";
import {
  allQuestsDone,
  dailyQuests,
  loadQuestDayState,
  questDayStorageKey,
  questLocalDay,
  resolveDailyQuests,
  saveQuestDayState,
  type QuestDayState,
} from "./quests.js";

/**
 * CL1 (Immersion Round 3): the client quest system completed honestly.
 *
 * The v1 defects these tests pin down (all fail against the pre-change
 * quests.ts, which hardcoded `done: false` for warm/connect and took no
 * day state):
 *  1. Warming the named cooling memory never showed the quest complete —
 *     it just vanished (pool shrank) or treadmilled to the next cold one.
 *  2. A drifting memory that gained a link vanished instead of completing.
 *  3. There was no stable daily target and no all-done state to present.
 */

const TZ = "America/New_York";
// 15:00 UTC = 11:00 in New York — unambiguously the 21st locally.
const NOW = new Date("2026-10-21T15:00:00.000Z");
const TODAY_ISO = "2026-10-21T14:00:00.000Z"; // 10:00 NY, same local day
const YESTERDAY_ISO = "2026-10-20T14:00:00.000Z"; // previous local day

function memory(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1,
    label: "a memory",
    type: "memory",
    content: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    degree: 1,
    entropy: 0,
    ...over,
  } as GraphNode;
}

const opts = (dayState?: QuestDayState | null) => ({ dayState: dayState ?? null, now: NOW, timeZone: TZ });

describe("questLocalDay — space-local day, never UTC", () => {
  it("reads a near-midnight instant as the previous day in New York but the same day in Kiritimati", () => {
    const instant = new Date("2026-10-21T01:30:00.000Z"); // 21:30 Oct 20 NY / 15:30 Oct 21 Kiritimati
    expect(questLocalDay(instant, "America/New_York")).toBe("2026-10-20");
    expect(questLocalDay(instant, "Pacific/Kiritimati")).toBe("2026-10-21");
  });
});

describe("dailyQuests — log quest", () => {
  it("mirrors fedToday exactly", () => {
    expect(dailyQuests([], false, opts())[0]).toMatchObject({ id: "log", done: false });
    expect(dailyQuests([], true, opts())[0]).toMatchObject({ id: "log", done: true, text: "Fed your brain today" });
  });

  it("returns only the log quest when nothing is cooling or drifting", () => {
    const qs = dailyQuests([memory({ id: 1 })], true, opts());
    expect(qs.map((q) => q.id)).toEqual(["log"]);
    expect(allQuestsDone(qs)).toBe(true);
    expect(allQuestsDone([])).toBe(false);
  });
});

describe("dailyQuests — warm quest completion is truthful", () => {
  const cold = memory({ id: 7, entropy: 0.9, degree: 2 });
  const colder = memory({ id: 8, entropy: 0.6, degree: 2 });

  it("baselines the coldest cooling memory as today's target, not done", () => {
    const { quests, dayState } = resolveDailyQuests([colder, cold], false, opts());
    const warm = quests.find((q) => q.id === "warm")!;
    expect(warm.done).toBe(false);
    expect(warm.focusId).toBe(7);
    expect(warm.text).toContain("2 drifting cold");
    expect(dayState.warmTargetId).toBe(7);
    expect(dayState.day).toBe("2026-10-21");
  });

  it("is DONE and still listed after its target is warmed (entropy reset by a tend)", () => {
    const first = resolveDailyQuests([cold, colder], false, opts());
    const warmed = memory({ id: 7, entropy: 0, degree: 2, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([warmed, colder], false, opts(first.dayState));
    const warm = second.quests.find((q) => q.id === "warm")!;
    expect(warm).toBeTruthy();
    expect(warm.done).toBe(true);
    expect(warm.focusId).toBe(7);
  });

  it("does not treadmill: warming the target does not promote the next cooling memory into today's quest", () => {
    const first = resolveDailyQuests([cold, colder], false, opts());
    const warmed = memory({ id: 7, entropy: 0, degree: 2, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([warmed, colder], false, opts(first.dayState));
    const warm = second.quests.find((q) => q.id === "warm")!;
    expect(warm.done).toBe(true);
    expect(warm.focusId).toBe(7); // not 8 — memory 8 is tomorrow's problem
  });

  it("is done when the target was tended today even if a stale snapshot still shows it cooling", () => {
    const first = resolveDailyQuests([cold], false, opts());
    const tended = memory({ id: 7, entropy: 0.9, degree: 2, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([tended], false, opts(first.dayState));
    expect(second.quests.find((q) => q.id === "warm")!.done).toBe(true);
  });

  it("is NOT done when a different memory was tended today but the target is still cold", () => {
    const first = resolveDailyQuests([cold, colder], false, opts());
    const otherTended = memory({ id: 8, entropy: 0, degree: 2, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([cold, otherTended], false, opts(first.dayState));
    const warm = second.quests.find((q) => q.id === "warm")!;
    expect(warm.done).toBe(false);
    expect(warm.focusId).toBe(7);
  });

  it("a tend from yesterday does not complete today's warm quest", () => {
    const stale = memory({ id: 7, entropy: 0.9, degree: 2, lastTendedAt: YESTERDAY_ISO });
    const { quests } = resolveDailyQuests([stale], false, opts());
    expect(quests.find((q) => q.id === "warm")!.done).toBe(false);
  });
});

describe("dailyQuests — connect quest completion is truthful", () => {
  const drifting = memory({ id: 11, degree: 0, entropy: 0.1, lastTendedAt: "2026-09-02T00:00:00.000Z" });

  it("baselines a drifting memory, not done, with reconnect copy", () => {
    const { quests, dayState } = resolveDailyQuests([drifting], false, opts());
    const connect = quests.find((q) => q.id === "connect")!;
    expect(connect.done).toBe(false);
    expect(connect.focusId).toBe(11);
    expect(connect.text).toContain("Reconnect a drifting memory");
    expect(connect.text).toContain("1 unlinked");
    expect(dayState.connectTargetId).toBe(11);
  });

  it("is NOT completed by merely visiting/tending the drifting memory (a visit does not link it)", () => {
    const first = resolveDailyQuests([drifting], false, opts());
    const visited = memory({ id: 11, degree: 0, entropy: 0, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([visited], false, opts(first.dayState));
    expect(second.quests.find((q) => q.id === "connect")!.done).toBe(false);
  });

  it("is DONE and still listed after its target gains a link", () => {
    const first = resolveDailyQuests([drifting], false, opts());
    const linked = memory({ id: 11, degree: 1, entropy: 0.1, lastTendedAt: TODAY_ISO });
    const second = resolveDailyQuests([linked], false, opts(first.dayState));
    const connect = second.quests.find((q) => q.id === "connect")!;
    expect(connect).toBeTruthy();
    expect(connect.done).toBe(true);
    expect(connect.text).toBe("Reconnected a drifting memory today");
  });
});

describe("dailyQuests — day rollover", () => {
  it("ignores a previous local day's baselined targets and does not carry a done state over", () => {
    const yesterday: QuestDayState = { day: "2026-10-20", warmTargetId: 99, connectTargetId: 98 };
    const warmOld = memory({ id: 99, entropy: 0, degree: 2, lastTendedAt: YESTERDAY_ISO });
    const coldToday = memory({ id: 5, entropy: 0.8, degree: 2 });
    const { quests, dayState } = resolveDailyQuests([warmOld, coldToday], false, opts(yesterday));
    expect(dayState.day).toBe("2026-10-21");
    expect(dayState.warmTargetId).toBe(5);
    const warm = quests.find((q) => q.id === "warm")!;
    expect(warm.focusId).toBe(5);
    expect(warm.done).toBe(false);
  });
});

describe("dailyQuests — shape", () => {
  it("never returns more than 3 quests", () => {
    const mems = [
      memory({ id: 1, entropy: 0.9, degree: 2 }),
      memory({ id: 2, degree: 0 }),
    ];
    expect(dailyQuests(mems, false, opts()).length).toBeLessThanOrEqual(3);
  });

  it("allQuestsDone requires every quest done", () => {
    const mems = [memory({ id: 1, entropy: 0.9, degree: 2 })];
    expect(allQuestsDone(dailyQuests(mems, true, opts()))).toBe(false);
    expect(allQuestsDone(dailyQuests([memory({ id: 1 })], true, opts()))).toBe(true);
  });
});

describe("quest day state storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a day state and rejects corrupt data", () => {
    const key = questDayStorageKey("space-1");
    expect(key).toBe("brain.quests.space-1");
    expect(loadQuestDayState(key)).toBeNull();
    saveQuestDayState(key, { day: "2026-10-21", warmTargetId: 7 });
    expect(loadQuestDayState(key)).toEqual({ day: "2026-10-21", warmTargetId: 7 });
    localStorage.setItem(key, "{not json");
    expect(loadQuestDayState(key)).toBeNull();
  });
});
