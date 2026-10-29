import { describe, it, expect } from "vitest";
import type { GraphData, GraphEdge, GraphNode, Journey } from "@brain/shared";
import {
  buildGardenLayout,
  isEligibleGardenNode,
  terraceForDate,
  clampToGardenFloor,
  GARDEN_BUDGET,
  GARDEN_TERRACE_COUNT,
  GARDEN_TERRACE_HEIGHT,
  GARDEN_FLOOR_Y,
  GARDEN_CAMERA_FLOOR_Y,
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

  it("the garden floor sits below the lowest terrace, and the camera floor holds above it", () => {
    // Solid floor: lowest terrace (y=0) minus the 60-unit skirt.
    expect(GARDEN_FLOOR_Y).toBe(GARDEN_TERRACE_HEIGHT[0]! - 60);
    expect(GARDEN_FLOOR_Y).toBe(-60);
    // Camera floor: above the lowest terrace, so no view can sink under the garden.
    expect(GARDEN_CAMERA_FLOOR_Y).toBeGreaterThan(GARDEN_TERRACE_HEIGHT[0]!);
    expect(GARDEN_CAMERA_FLOOR_Y).toBe(12);
    // The clamp holds a sunken camera at the floor and leaves a high camera alone.
    expect(clampToGardenFloor(-100)).toBe(GARDEN_CAMERA_FLOOR_Y);
    expect(clampToGardenFloor(-60)).toBe(GARDEN_CAMERA_FLOOR_Y);
    expect(clampToGardenFloor(0)).toBe(GARDEN_CAMERA_FLOOR_Y);
    expect(clampToGardenFloor(300)).toBe(300);
  });
});

describe("garden layout v2 — Journeys as groves (docs/specs/growing-place-v2-2026-10-29.md)", () => {
  const link = (refId: number, kind: "node" | "task" = "node") => ({ kind, refId, label: `n${refId}` });
  const OLD = "2024-03-01T00:00:00.000Z"; // well outside the meadow's 30 days

  it("every Journey is a grove; its open missions are sprouts and its memories stones, inside the grove", () => {
    const g = graph([
      node({ id: 1, kind: "action", createdAt: OLD }),
      node({ id: 2, createdAt: OLD }),
      node({ id: 3, kind: "action", createdAt: OLD }),
    ]);
    const layout = buildGardenLayout(g, [journey({ id: 5, missionsCompleted: 3 })], NOW, {
      links: new Map([[5, [link(1, "task"), link(2), link(3)]]]),
    });
    expect(layout.groves).toHaveLength(1);
    const grove = layout.groves[0]!;
    expect(grove).toMatchObject({ journeyId: 5, status: "active", missionsCompleted: 3, unshown: 0 });
    expect(grove.terrace).toBeGreaterThanOrEqual(1);
    expect(grove.terrace).toBeLessThanOrEqual(4);
    const roles = Object.fromEntries(layout.plots.map((p) => [p.nodeId, p.role]));
    expect(roles).toEqual({ 1: "mission", 2: "memory", 3: "mission" });
    for (const p of layout.plots) {
      expect(p.journeyId).toBe(5);
      expect(Math.hypot(p.x - grove.x, p.z - grove.z)).toBeLessThan(grove.radius);
      expect(p.y).toBe(grove.y);
    }
  });

  it("the meadow holds only loose memories from the last 30 days; older loose ones are not in the garden", () => {
    const g = graph([
      node({ id: 1, createdAt: "2026-10-20T00:00:00.000Z" }),
      node({ id: 2, createdAt: "2026-09-10T00:00:00.000Z" }), // 44 days before NOW
      node({ id: 3, createdAt: OLD }),
    ]);
    const layout = buildGardenLayout(g, [journey({ id: 5 })], NOW, { links: new Map([[5, [link(3)]]]) });
    expect(layout.plots.filter((p) => p.role === "wild").map((p) => p.nodeId)).toEqual([1]);
    expect(layout.plots.find((p) => p.nodeId === 3)?.role).toBe("memory"); // old, but it has a home
    expect(layout.plots.some((p) => p.nodeId === 2)).toBe(false);
    const wild = layout.plots.find((p) => p.nodeId === 1)!;
    expect(wild.terrace).toBe(0);
    expect(wild.journeyId).toBeNull();
  });

  it("a node shared by Journeys rests in the lowest-id grove, and the sharing is a trail between groves", () => {
    const g = graph([node({ id: 1, createdAt: OLD }), node({ id: 2, createdAt: OLD })]);
    const layout = buildGardenLayout(g, [journey({ id: 9 }), journey({ id: 4 })], NOW, {
      links: new Map([
        [4, [link(1)]],
        [9, [link(1), link(2)]],
      ]),
    });
    expect(layout.plots.find((p) => p.nodeId === 1)?.journeyId).toBe(4);
    expect(layout.plots.find((p) => p.nodeId === 2)?.journeyId).toBe(9);
    expect(layout.grovePaths).toEqual([{ fromJourneyId: 4, toJourneyId: 9, shared: 1 }]);
  });

  it("dangling or archived links are skipped, never drawn", () => {
    const g = graph([node({ id: 1, status: "archived", createdAt: OLD })]);
    const layout = buildGardenLayout(g, [journey({ id: 5 })], NOW, { links: new Map([[5, [link(1), link(99)]]]) });
    expect(layout.plots).toHaveLength(0);
    expect(layout.groves[0]!.unshown).toBe(0);
  });

  it("done groves stand on the crown at their landmark spot; paused groves keep their status (they rest under mist)", () => {
    const layout = buildGardenLayout(graph([]), [journey({ id: 2, status: "done" }), journey({ id: 3, status: "paused" })], NOW);
    const done = layout.groves.find((g) => g.journeyId === 2)!;
    const lm = layout.landmarks.find((l) => l.journeyId === 2)!;
    expect(done.terrace).toBe(GARDEN_TERRACE_COUNT - 1);
    expect({ x: done.x, z: done.z }).toEqual({ x: lm.x, z: lm.z });
    expect(layout.groves.find((g) => g.journeyId === 3)?.status).toBe("paused");
    expect(layout.landmarks.map((l) => l.journeyId)).toEqual([2]);
  });

  it("open groves never overlap, and adding a Journey never moves an existing grove", () => {
    const js = Array.from({ length: 14 }, (_, i) => journey({ id: i + 1 }));
    const a = buildGardenLayout(graph([]), js, NOW).groves;
    for (let i = 0; i < a.length; i++) {
      for (let k = i + 1; k < a.length; k++) {
        expect(Math.hypot(a[i]!.x - a[k]!.x, a[i]!.z - a[k]!.z)).toBeGreaterThanOrEqual(a[i]!.radius + a[k]!.radius);
      }
    }
    const b = buildGardenLayout(graph([]), [...js, journey({ id: 40 })], NOW).groves;
    expect(b.slice(0, 14)).toEqual(a);
  });

  it("a crowded grove counts what didn't fit instead of hiding it silently", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node({ id: i + 1, createdAt: OLD }));
    const layout = buildGardenLayout(graph(nodes), [journey({ id: 5 })], NOW, {
      links: new Map([[5, nodes.map((n) => link(n.id))]]),
    });
    expect(layout.plots).toHaveLength(18);
    expect(layout.groves[0]!.unshown).toBe(12);
  });

  it("seed pods: at most 5, over where the memory rests, and only for real nodes", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node({ id: i + 1 }));
    const layout = buildGardenLayout(graph(nodes), [], NOW, {
      due: [{ id: 99 }, ...nodes.map((n) => ({ id: n.id }))],
    });
    expect(layout.pods.map((p) => p.nodeId)).toEqual([1, 2, 3, 4, 5]);
    const plot = layout.plots.find((p) => p.nodeId === 1)!;
    expect(layout.pods[0]).toMatchObject({ x: plot.x, y: plot.y, z: plot.z, label: "node 1" });
  });

  it("nothing is placed by importance, strength, or degree — the same nodes with different weights lay out identically", () => {
    const base = [node({ id: 1, createdAt: OLD }), node({ id: 2 })];
    const heavy = base.map((n) => ({ ...n, importance: 1, reviewStrength: 0.1, degree: 40 }) as GraphNode);
    const links = new Map([[5, [link(1)]]]);
    const a = buildGardenLayout(graph(base), [journey({ id: 5 })], NOW, { links });
    const b = buildGardenLayout(graph(heavy), [journey({ id: 5 })], NOW, { links });
    expect(b.plots).toEqual(a.plots);
    expect(b.groves).toEqual(a.groves);
  });
});
