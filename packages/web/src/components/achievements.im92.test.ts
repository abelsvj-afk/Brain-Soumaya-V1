import { describe, it, expect, beforeEach } from "vitest";
import type { GraphNode } from "@brain/shared";
import {
  ACHIEVEMENTS,
  loadEarnedAt,
  loadUnlocked,
  pathDepth,
  recordUnlocked,
  unlockedIds,
  type AchievementCtx,
} from "./achievements.js";

/**
 * IM-92 / IM-94 logic: earned-set timestamps (with the no-invented-dates
 * honesty rule for legacy entries), a distance hint for EVERY achievement,
 * and the Pathfinder Quest's dependence on the full link context.
 */
beforeEach(() => localStorage.clear());

const node = (id: number, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: `m${id}`, kind: "memory", type: "daily", degree: 0, entropy: 0, ...extra }) as GraphNode;

const chain = (n: number) => {
  const memories = Array.from({ length: n }, (_, i) => node(i + 1));
  const linkObjects = Array.from({ length: n - 1 }, (_, i) => ({ source: i + 1, target: i + 2 }));
  return { memories, linkObjects };
};

describe("IM-92 — earned-set timestamps", () => {
  it("reads a legacy bare-array earned set, with NO dates attached", () => {
    localStorage.setItem("brain.achv.s1", JSON.stringify(["connector", "nexus"]));
    expect([...loadUnlocked("s1")].sort()).toEqual(["connector", "nexus"]);
    // The honesty rule: legacy unlocks have no recorded time — none invented.
    expect(loadEarnedAt("s1")).toEqual({});
  });

  it("recordUnlocked stamps new unlocks and preserves legacy entries dateless", () => {
    localStorage.setItem("brain.achv.s1", JSON.stringify(["connector"]));
    recordUnlocked("s1", ["nexus"], "2026-10-21T12:00:00.000Z");
    expect([...loadUnlocked("s1")].sort()).toEqual(["connector", "nexus"]);
    expect(loadEarnedAt("s1")).toEqual({ nexus: "2026-10-21T12:00:00.000Z" });
  });

  it("re-recording an id never rewrites its first unlock time", () => {
    recordUnlocked("s1", ["nexus"], "2026-10-21T12:00:00.000Z");
    recordUnlocked("s1", ["nexus"], "2026-12-25T12:00:00.000Z");
    expect(loadEarnedAt("s1")).toEqual({ nexus: "2026-10-21T12:00:00.000Z" });
  });
});

describe("IM-92 — every achievement carries a distance hint", () => {
  it("no achievement is left without a progress function", () => {
    const missing = ACHIEVEMENTS.filter((a) => typeof a.progress !== "function").map((a) => a.id);
    expect(missing).toEqual([]);
  });

  it("the previously hint-less feats report real progress", () => {
    const ctx: AchievementCtx = {
      memories: [
        node(1, { kind: "goal", progress: 0.5 }),
        node(2, { kind: "skill", progress: 0.3 }),
        node(3, { createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
      links: 0,
      fuel: null,
    };
    const byId = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
    expect(byId.get("goal_achiever")!.progress!(ctx)).toEqual({ cur: 50, target: 100 });
    expect(byId.get("skill_advanced")!.progress!(ctx)).toEqual({ cur: 30, target: 60 });
    expect(byId.get("gardener")!.progress!(ctx)).toEqual({ cur: 3, target: 10 });
  });
});

describe("IM-94 — Pathfinder Quest needs the full context", () => {
  it("a 5-memory chain satisfies the predicate ONLY with linkObjects present", () => {
    const { memories, linkObjects } = chain(5);
    const bare: AchievementCtx = { memories, links: 4, fuel: null };
    const full: AchievementCtx = { memories, links: 4, fuel: null, linkObjects };
    expect(unlockedIds(bare)).not.toContain("pathfinder_quest");
    expect(unlockedIds(full)).toContain("pathfinder_quest");
  });

  it("pathDepth reports the chain length, capped, and 0 without links", () => {
    const { memories, linkObjects } = chain(5);
    expect(pathDepth({ memories, links: 4, fuel: null, linkObjects })).toBe(5);
    expect(pathDepth({ memories, links: 4, fuel: null })).toBe(0);
    const pf = ACHIEVEMENTS.find((a) => a.id === "pathfinder_quest")!;
    expect(pf.progress!({ memories, links: 4, fuel: null, linkObjects })).toEqual({ cur: 5, target: 5 });
  });
});
