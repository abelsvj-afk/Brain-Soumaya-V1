import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { GraphData, GraphNode } from "@brain/shared";
import { DailyQuests } from "./DailyQuests.js";
import {
  loadQuestDayState,
  questDayStorageKey,
  questLocalDay,
  resolveDailyQuests,
  saveQuestDayState,
} from "./quests.js";

/**
 * REG-045 (PG-01): the Progress tab derives quests WITHOUT the persisted
 * dayState the Observatory uses — warm/connect quests treadmill and can show
 * "not done" after the work. With `questKey` the tab consumes the same
 * persisted dayState, so both surfaces render the same quest list, targets,
 * and done states.
 *
 * Fail-before: without the key the tab re-baselines on every render — warming
 * the named memory re-targets the next cooling one and the quest reads not
 * done, while the Observatory's resolver (same inputs, same dayState) reads ✓.
 */
function node(over: Partial<GraphNode>): GraphNode {
  return {
    id: 7,
    label: "An old note",
    kind: "memory",
    type: "daily",
    content: "x",
    importance: 0.5,
    celestial: "asteroid",
    degree: 0,
    entropy: 0.9,
    emotionalWeight: 0,
    createdAt: "2026-10-01T12:00:00.000Z",
    ...over,
  } as unknown as GraphNode;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("REG-045 — DailyQuests consumes the Observatory's persisted dayState", () => {
  it("warming the named target shows ✓ here, matching the Observatory derivation exactly", () => {
    const key = questDayStorageKey("s1");
    const day = questLocalDay();
    // The Observatory baselined node 7 as today's warm target earlier.
    saveQuestDayState(key, { day, warmTargetId: 7 });
    const cooling = node({});
    const graph = { nodes: [cooling], links: [] } as unknown as GraphData;

    const { getByText, rerender } = render(
      <DailyQuests graph={graph} fedToday={false} questKey={key} onFocus={() => {}} onCapture={() => {}} />,
    );
    expect(getByText(/Warm a cooling memory/)).toBeTruthy();

    // Warm node 7: its entropy falls below the cooling line.
    const warmed = node({ entropy: 0.1 });
    const warmedGraph = { nodes: [warmed], links: [] } as unknown as GraphData;
    rerender(
      <DailyQuests graph={warmedGraph} fedToday={false} questKey={key} onFocus={() => {}} onCapture={() => {}} />,
    );
    expect(getByText(/Warmed a cooling memory today/)).toBeTruthy();

    // The Observatory's resolver, same inputs, same persisted dayState, agrees
    // quest-for-quest (same list, same targets, same done states).
    const memories = [warmed];
    const obs = resolveDailyQuests(memories, false, {
      dayState: loadQuestDayState(key),
      timeZone: undefined,
    }).quests;
    expect(obs.find((q) => q.id === "warm")).toMatchObject({
      done: true,
      text: "Warmed a cooling memory today",
      focusId: 7,
    });
    // And the tab's own rendered warm quest is the same quest.
    expect(getByText(/Warmed a cooling memory today/).closest("button")?.className).toContain("done");
  });

  it("without a questKey it still renders (back-compatible, unpersisted)", () => {
    const graph = { nodes: [node({})], links: [] } as unknown as GraphData;
    const { getByText } = render(
      <DailyQuests graph={graph} fedToday={false} onFocus={() => {}} onCapture={() => {}} />,
    );
    expect(getByText(/Warm a cooling memory/)).toBeTruthy();
  });
});
