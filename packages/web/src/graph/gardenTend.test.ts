import { describe, it, expect } from "vitest";
import type { GraphEdge, GraphNode } from "@brain/shared";
import { warmPlotNodeIds, litPathEdgeIds, litPathEdges, GARDEN_WARM_DAYS } from "./gardenTend.js";
import type { GardenTend } from "../api/garden.js";

/**
 * Verb 1 — Tend a plot: the garden's warm glow and lit paths.
 *
 * Fail-before: on the base tree there is no gardenTend module at all, so
 * these tests fail at import time — the behavior they pin is entirely new.
 */
const NOW = Date.parse("2026-10-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function node(partial: Partial<GraphNode> & { id: number }): GraphNode {
  return {
    label: `node ${partial.id}`,
    type: "memory",
    content: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  } as GraphNode;
}

function tend(partial: Partial<GardenTend> & { id: number; nodeId: number }): GardenTend {
  return {
    kind: "visit",
    targetNodeId: null,
    edgeId: null,
    changed: null,
    createdAt: daysAgo(0),
    ...partial,
  };
}

function edge(id: number, source: number, target: number): GraphEdge {
  return { id, source, target, relationship: "relates_to", weight: 0.5, createdAt: "2026-10-01T00:00:00.000Z" };
}

describe("garden glow (Verb 1)", () => {
  it("the warm window is 7 days — presentation only, never a dimmer state", () => {
    expect(GARDEN_WARM_DAYS).toBe(7);
  });

  it("a plot tended inside the window glows; an older or never-tended plot looks as it always did", () => {
    const nodes = [
      node({ id: 1, lastTendedAt: daysAgo(2) }),
      node({ id: 2, lastTendedAt: daysAgo(10) }),
      node({ id: 3 }),
      node({ id: 4, lastTendedAt: daysAgo(7) }),
    ];
    const warm = warmPlotNodeIds(nodes, NOW);
    expect([...warm].sort()).toEqual([1]);
    // Exactly at the window edge, the glow has stopped — nothing dims,
    // it simply isn't drawn anymore.
    expect(warm.has(4)).toBe(false);
  });

  it("a future lastTendedAt never glows (bad data stays invisible, not warm)", () => {
    const warm = warmPlotNodeIds([node({ id: 1, lastTendedAt: daysAgo(-1) })], NOW);
    expect(warm.size).toBe(0);
  });

  it("a path lights only for a recent tend that carries an edge", () => {
    const tends = [
      tend({ id: 1, nodeId: 1, kind: "line", edgeId: 5, createdAt: daysAgo(2) }),
      tend({ id: 2, nodeId: 2, kind: "link", edgeId: 6, createdAt: daysAgo(9) }),
      tend({ id: 3, nodeId: 3, kind: "visit", edgeId: null, createdAt: daysAgo(1) }),
      tend({ id: 4, nodeId: 4, kind: "affirm", edgeId: null, createdAt: daysAgo(1) }),
    ];
    expect([...litPathEdgeIds(tends, NOW)].sort()).toEqual([5]);
  });

  it("litPathEdges resolves the lit ids against the graph's own edges", () => {
    const edges = [edge(5, 1, 2), edge(6, 2, 3), edge(7, 1, 3)];
    const tends = [tend({ id: 1, nodeId: 1, kind: "link", edgeId: 7, createdAt: daysAgo(0) })];
    expect(litPathEdges(edges, tends, NOW)).toEqual([edge(7, 1, 3)]);
  });
});
