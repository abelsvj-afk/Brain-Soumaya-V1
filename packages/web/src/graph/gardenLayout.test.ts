import { describe, it, expect } from "vitest";
import type { GraphData, GraphEdge, GraphNode, Journey } from "@brain/shared";
import {
  buildGardenLayout,
  isEligibleGardenNode,
  terraceForDate,
  GARDEN_BUDGET,
  GARDEN_TERRACE_COUNT,
} from "./gardenLayout.js";

const NOW = new Date("2026-10-24T12:00:00");

function node(partial: Partial<GraphNode> & { id: number }): GraphNode {
  return {
    label: `node ${partial.id}`,
    type: "memory",
    content: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  } as GraphNode;
}

function edge(id: number, source: number, target: number): GraphEdge {
  return { id, source, target, relationship: "relates_to", weight: 0.5, createdAt: "2026-10-01T00:00:00.000Z" };
}

function journey(partial: Partial<Journey> & { id: number }): Journey {
  return {
    title: `journey ${partial.id}`,
    description: "",
    status: "active",
    progress: 0,
    ...partial,
  } as Journey;
}

const graph = (nodes: GraphNode[], links: GraphEdge[] = []): GraphData => ({ nodes, links });

describe("garden layout (P3-1, C1/C2)", () => {
  it("plots reconcile exactly against the eligible set, with identity", () => {
    const g = graph(
      [node({ id: 3 }), node({ id: 1, kind: "action" }), node({ id: 2, kind: "moc" }), node({ id: 4, status: "archived" })],
      [edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 4)],
    );
    const layout = buildGardenLayout(g, [], NOW);
    // Archived node 4 is deliberately excluded; its edge is omitted, not invented.
    expect(layout.eligibleCount).toBe(3);
    expect(layout.excludedCount).toBe(1);
    expect(layout.plots.map((p) => p.nodeId)).toEqual([1, 2, 3]); // canonical id order
    expect(layout.plots.find((p) => p.nodeId === 2)?.gathering).toBe(true);
    expect(layout.plots.find((p) => p.nodeId === 1)?.kind).toBe("action");
    expect(layout.paths.map((p) => p.edgeId)).toEqual([10, 11]);
    expect(layout.omittedEdgeCount).toBe(1);
  });

  it("is deterministic under shuffled input order and repeated runs", () => {
    const nodes = [node({ id: 5 }), node({ id: 2 }), node({ id: 9 }), node({ id: 1 })];
    const links = [edge(3, 2, 9), edge(1, 1, 2), edge(2, 5, 1)];
    const a = buildGardenLayout(graph(nodes, links), [journey({ id: 7, status: "done" })], NOW);
    const b = buildGardenLayout(graph([...nodes].reverse(), [...links].reverse()), [journey({ id: 7, status: "done" })], NOW);
    const c = buildGardenLayout(graph(nodes, links), [journey({ id: 7, status: "done" })], NOW);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("terrace bands by age: arrival is the present, the crown is the oldest light", () => {
    expect(terraceForDate("2026-10-01T00:00:00.000Z", NOW)).toBe(0);
    expect(terraceForDate("2024-03-01T00:00:00.000Z", NOW)).toBe(2);
    expect(terraceForDate("2019-01-01T00:00:00.000Z", NOW)).toBe(GARDEN_TERRACE_COUNT - 1);
    expect(terraceForDate(undefined, NOW)).toBe(0); // no timestamp: arrival terrace, never guessed
    expect(terraceForDate("not-a-date", NOW)).toBe(0);
  });

  it("landmarks are presence-only for completed Journeys, on the crown", () => {
    const layout = buildGardenLayout(graph([]), [
      journey({ id: 1, status: "done", title: "Finished" }),
      journey({ id: 2, status: "active" }),
      journey({ id: 3, status: "paused" }),
    ], NOW);
    expect(layout.landmarks).toHaveLength(1);
    expect(layout.landmarks[0]).toMatchObject({
      journeyId: 1,
      title: "Finished",
      terrace: GARDEN_TERRACE_COUNT - 1,
    });
  });

  it("empty and sparse graphs render honest ground, never fabricated plots", () => {
    const empty = buildGardenLayout(graph([]), [], NOW);
    expect(empty.plots).toEqual([]);
    expect(empty.paths).toEqual([]);
    expect(empty.landmarks).toEqual([]);
    const one = buildGardenLayout(graph([node({ id: 1 })]), [], NOW);
    expect(one.plots).toHaveLength(1);
    expect(one.paths).toEqual([]);
    // A disconnected graph: plots stand, no paths are invented.
    const two = buildGardenLayout(graph([node({ id: 1 }), node({ id: 2 })]), [], NOW);
    expect(two.plots).toHaveLength(2);
    expect(two.paths).toEqual([]);
  });

  it("eligibility follows the contract: every kind plots, archived never does", () => {
    for (const kind of ["memory", "action", "belief", "moc", "goal", "idea", "skill"] as const) {
      expect(isEligibleGardenNode(node({ id: 1, kind: kind as never }))).toBe(true);
    }
    expect(isEligibleGardenNode(node({ id: 1, status: "archived" }))).toBe(false);
  });

  it("the recipe budget is asserted as constants, not as performance proof", () => {
    expect(GARDEN_BUDGET.maxDrawCalls).toBe(95);
    expect(GARDEN_BUDGET.maxTris).toBe(700_000);
  });
});
