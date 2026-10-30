import { describe, expect, it } from "vitest";
import { NPC_CAST } from "./npcs.js";
import { STORY_ENTRY_BY_ID } from "./storyCanon.js";
import { STORY_ROADS, checkStoryRoads, roadOffered, roadView } from "./storyRoads.js";

const entryIds = new Set(STORY_ENTRY_BY_ID.keys());
const castIds = new Set(NPC_CAST.map((c) => c.id));

describe("story roads", () => {
  it("are well formed: real entries, real people, plain words", () => {
    expect(checkStoryRoads(STORY_ROADS, entryIds, castIds)).toEqual([]);
  });

  it("every giver can actually be met in the road's world", () => {
    for (const r of STORY_ROADS) {
      const c = NPC_CAST.find((m) => m.id === r.giver)!;
      expect([c.home, ...c.roams], r.id).toContain(r.world);
    }
  });

  it("are ordered: a later find reached early leaves the road at the earlier line", () => {
    const road = STORY_ROADS.find((r) => r.id === "road.open-alcove")!;
    const early = roadView(road, { found: new Set(["sight.aldous-at-rest"]), meetings: {} });
    expect(early.done).toBe(false);
    expect(early.past).toEqual([]);
    expect(early.current).toBe(road.steps[0]!.line);
    const mid = roadView(road, { found: new Set(["sight.open-alcove"]), meetings: {} });
    expect(mid.past).toHaveLength(1);
    expect(mid.current).toBe(road.steps[1]!.line);
    const done = roadView(road, { found: new Set(["sight.open-alcove", "sight.aldous-at-rest"]), meetings: {} });
    expect(done).toMatchObject({ done: true, current: null });
  });

  it("are offered only once the giver has been met", () => {
    const road = STORY_ROADS[0]!;
    expect(roadOffered(road, { found: new Set(), meetings: {} })).toBe(false);
    expect(roadOffered(road, { found: new Set(), meetings: { [road.giver]: 1 } })).toBe(true);
  });

  it("checker catches a bad road", () => {
    const bad = [{ ...STORY_ROADS[0]!, giver: "nobody", steps: [{ id: "x", line: "Walk 3 steps.", signal: { find: "nope" } }] }];
    expect(checkStoryRoads(bad, entryIds, castIds).length).toBeGreaterThanOrEqual(3);
  });
});
