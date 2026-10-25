import { describe, it, expect } from "vitest";
import type { GraphData, GraphEdge, GraphNode, Journey, JourneyLinkSummary } from "@brain/shared";
import {
  buildDeepPastLayout,
  isEligibleDeepPastNode,
  stratumForDate,
  DEEP_PAST_BUDGET,
  DEEP_PAST_STRATA_COUNT,
  DEEP_PAST_MIN_AGE_YEARS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_RISE_SHELF,
} from "./deepPastLayout.js";

const NOW = new Date("2026-10-25T12:00:00");

function node(partial: Partial<GraphNode> & { id: number }): GraphNode {
  return {
    label: `node ${partial.id}`,
    type: "memory",
    content: "",
    createdAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  } as GraphNode;
}

function edge(id: number, source: number, target: number, createdAt = "2020-01-01T00:00:00.000Z"): GraphEdge {
  return { id, source, target, relationship: "relates_to", weight: 0.5, createdAt };
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

function link(kind: "node" | "task", refId: number, nodeRefId?: number): JourneyLinkSummary {
  return { kind, refId, label: `link ${refId}`, nodeRefId } as JourneyLinkSummary;
}

const graph = (nodes: GraphNode[], links: GraphEdge[] = []): GraphData => ({ nodes, links });
const noLinks = new Map<number, JourneyLinkSummary[]>();

describe("deep past layout (P3-2, C1/C2)", () => {
  it("members reconcile exactly against the eligible set, with identity", () => {
    const g = graph(
      [
        node({ id: 3, createdAt: "2017-01-01T00:00:00.000Z" }),
        node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" }),
        node({ id: 2, createdAt: "2025-05-01T00:00:00.000Z", kind: "action" }),
        node({ id: 4, createdAt: "2026-10-01T00:00:00.000Z" }), // too young: kept this year
        node({ id: 5, status: "archived", createdAt: "2020-01-01T00:00:00.000Z" }),
        node({ id: 6, createdAt: "not-a-date" }), // age unreadable: excluded, never guessed
      ],
      [
        edge(10, 1, 2), // member ↔ member: the descent already connects them, not drawn
        edge(11, 2, 4), // member ↔ non-member: an anchor rising from node 2
        edge(12, 4, 5), // non-member ↔ non-member: omitted, never invented
        edge(13, 3, 99), // member ↔ missing endpoint: the link is real, its other end is elsewhere
      ],
    );
    const layout = buildDeepPastLayout(g, [], noLinks, NOW);
    expect(layout.eligibleCount).toBe(3);
    expect(layout.excludedCount).toBe(3);
    expect(layout.members.map((m) => m.nodeId)).toEqual([1, 2, 3]); // canonical id order
    expect(layout.members.find((m) => m.nodeId === 2)?.kind).toBe("action");
    expect(layout.anchors).toEqual([
      { edgeId: 11, fromNodeId: 2, toNodeId: 4 },
      { edgeId: 13, fromNodeId: 3, toNodeId: 99 },
    ]);
    expect(layout.omittedEdgeCount).toBe(1);
    expect(layout.thread).toBeNull();
  });

  it("is deterministic under shuffled input order and repeated runs", () => {
    const nodes = [node({ id: 5, createdAt: "2022-01-01T00:00:00.000Z" }), node({ id: 2, createdAt: "2024-01-01T00:00:00.000Z" }), node({ id: 9, createdAt: "2019-01-01T00:00:00.000Z" })];
    const links = [edge(3, 2, 9), edge(1, 2, 5), edge(2, 5, 9)];
    const journeys = [journey({ id: 7, status: "done" })];
    const mapA = new Map([[7, [link("node", 9), link("node", 2)]]]);
    const mapB = new Map([[7, [link("node", 2), link("node", 9)]]]);
    const a = buildDeepPastLayout(graph(nodes, links), journeys, mapA, NOW);
    const b = buildDeepPastLayout(graph([...nodes].reverse(), [...links].reverse()), journeys, mapB, NOW);
    const c = buildDeepPastLayout(graph(nodes, links), journeys, mapA, NOW);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("stratum bands by age: the rim is the most recent members, the basin the oldest", () => {
    expect(stratumForDate(new Date("2025-05-01T00:00:00.000Z"), NOW)).toBe(0); // kept 1–2 years
    expect(stratumForDate(new Date("2024-03-01T00:00:00.000Z"), NOW)).toBe(1);
    expect(stratumForDate(new Date("2017-01-01T00:00:00.000Z"), NOW)).toBe(DEEP_PAST_STRATA_COUNT - 1); // 9+ years
    expect(stratumForDate(new Date("2026-10-01T00:00:00.000Z"), NOW)).toBeNull(); // too young
    expect(stratumForDate(null, NOW)).toBeNull(); // no timestamp: excluded, never guessed
    // The minimum age is a named constant, not a magic number in the mapping.
    expect(DEEP_PAST_MIN_AGE_YEARS).toBe(1);
  });

  it("the rise is presentation only: warm context lifts the member, never its stratum", () => {
    const g = graph(
      [
        node({ id: 7, createdAt: "2020-01-01T00:00:00.000Z", lastTendedAt: "2026-10-20T00:00:00.000Z" }),
        node({ id: 8, createdAt: "2020-01-01T00:00:00.000Z" }),
        node({ id: 9, createdAt: "2020-01-01T00:00:00.000Z", lastTendedAt: "2026-01-01T00:00:00.000Z" }),
        node({ id: 2, createdAt: "2024-01-01T00:00:00.000Z" }),
      ],
      [edge(20, 8, 2, "2026-10-24T00:00:00.000Z")], // node 8 linked again this month
    );
    const layout = buildDeepPastLayout(g, [], noLinks, NOW);
    const tended = layout.members.find((m) => m.nodeId === 7)!;
    expect(tended.risen).toBe(true);
    expect(tended.riseReason).toBe("tended recently");
    expect(tended.stratum).toBe(5); // chronological home unchanged by the rise
    expect(tended.homeY).toBeLessThan(-400); // home is at depth
    expect(Math.hypot(tended.x - DEEP_PAST_RISE_SHELF.x, tended.z - DEEP_PAST_RISE_SHELF.z)).toBeLessThan(60); // presentation is at the rim shelf
    const linked = layout.members.find((m) => m.nodeId === 8)!;
    expect(linked.risen).toBe(true);
    expect(linked.riseReason).toBe("linked recently");
    const cold = layout.members.find((m) => m.nodeId === 9)!;
    expect(cold.risen).toBe(false);
    expect(cold.riseReason).toBeNull();
    expect(cold.x).toBe(cold.homeX); // not risen: presentation IS the home
  });

  it("the thread is the earliest done Journey with two member stops, in chronological order", () => {
    const g = graph(
      [
        node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" }),
        node({ id: 3, createdAt: "2017-01-01T00:00:00.000Z" }),
        node({ id: 4, createdAt: "2026-10-01T00:00:00.000Z" }), // too young to be a stop
      ],
      [],
    );
    const journeys = [
      journey({ id: 5, status: "done", title: "Later chapter" }),
      journey({ id: 2, status: "done", title: "First chapter" }),
      journey({ id: 9, status: "active", title: "Still being lived" }),
      journey({ id: 3, status: "done", title: "One stop only" }),
    ];
    const links = new Map<number, JourneyLinkSummary[]>([
      // Link order is assembly order, not life order: the thread re-orders chronologically.
      [2, [link("node", 3), link("node", 1)]],
      [3, [link("node", 1), link("node", 4)]],
      [5, [link("node", 3), link("node", 1)]],
      [9, [link("node", 1), link("node", 3)]],
    ]);
    const layout = buildDeepPastLayout(g, journeys, links, NOW);
    expect(layout.thread).not.toBeNull();
    expect(layout.thread!.routeId).toBe(2); // earliest done Journey with two member stops
    expect(layout.thread!.title).toBe("First chapter");
    expect(layout.thread!.stops.map((s) => s.nodeId)).toEqual([1, 3]); // rim before basin: down, never up
    expect(layout.thread!.stops[0]!.stratum).toBeLessThan(layout.thread!.stops[1]!.stratum);
    // Stops sit at the members' chronological alcoves, even if a member is risen.
    const stop = layout.thread!.stops[0]!;
    const member = layout.members.find((m) => m.nodeId === stop.nodeId)!;
    expect([stop.x, stop.y, stop.z]).toEqual([member.homeX, member.homeY, member.homeZ]);
  });

  it("no qualifying route means no thread — never a fabricated one", () => {
    const g = graph([node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" })], []);
    const onlyOneStop = buildDeepPastLayout(g, [journey({ id: 1, status: "done" })], new Map([[1, [link("node", 1)]]]), NOW);
    expect(onlyOneStop.thread).toBeNull();
    const noJourneys = buildDeepPastLayout(g, [], noLinks, NOW);
    expect(noJourneys.thread).toBeNull();
  });

  it("task links resolve to their node, other link kinds never become stops", () => {
    const g = graph(
      [
        node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" }),
        node({ id: 3, createdAt: "2017-01-01T00:00:00.000Z" }),
      ],
      [],
    );
    const links = new Map<number, JourneyLinkSummary[]>([
      [4, [link("task", 101, 1), link("node", 3), { kind: "income", refId: 55, label: "pay" } as JourneyLinkSummary]],
    ]);
    const layout = buildDeepPastLayout(g, [journey({ id: 4, status: "done" })], links, NOW);
    expect(layout.thread!.stops.map((s) => s.nodeId)).toEqual([1, 3]);
  });

  it("empty and sparse graphs render honest ground, never fabricated members", () => {
    const empty = buildDeepPastLayout(graph([]), [], noLinks, NOW);
    expect(empty.members).toEqual([]);
    expect(empty.anchors).toEqual([]);
    expect(empty.thread).toBeNull();
    expect(empty.eligibleCount).toBe(0);
    const one = buildDeepPastLayout(graph([node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" })]), [], noLinks, NOW);
    expect(one.members).toHaveLength(1);
    expect(one.anchors).toEqual([]);
    // A disconnected graph: members stand, no anchors are invented.
    const two = buildDeepPastLayout(
      graph([node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" }), node({ id: 2, createdAt: "2023-05-01T00:00:00.000Z" })]),
      [],
      noLinks,
      NOW,
    );
    expect(two.members).toHaveLength(2);
    expect(two.anchors).toEqual([]);
  });

  it("eligibility follows the contract: every kind rests here, archived never does", () => {
    for (const kind of ["memory", "action", "belief", "moc", "goal", "idea", "skill"] as const) {
      expect(isEligibleDeepPastNode(node({ id: 1, kind: kind as never }))).toBe(true);
    }
    expect(isEligibleDeepPastNode(node({ id: 1, status: "archived" }))).toBe(false);
    expect(isEligibleDeepPastNode(node({ id: 1, createdAt: "2026-10-01T00:00:00.000Z" }), NOW)).toBe(false);
    expect(isEligibleDeepPastNode(node({ id: 1, createdAt: "not-a-date" }), NOW)).toBe(false);
  });

  it("every member can answer why it rests here, naming the rule inputs", () => {
    const g = graph(
      [
        node({ id: 1, createdAt: "2024-05-01T00:00:00.000Z" }),
        node({ id: 7, createdAt: "2020-01-01T00:00:00.000Z", lastTendedAt: "2026-10-20T00:00:00.000Z" }),
      ],
      [],
    );
    const layout = buildDeepPastLayout(g, [], noLinks, NOW);
    const resting = layout.members.find((m) => m.nodeId === 1)!;
    expect(resting.why).toContain("2024");
    expect(resting.why).toContain("depth 2 of 9");
    const risen = layout.members.find((m) => m.nodeId === 7)!;
    expect(risen.why).toContain("risen because you tended it recently");
    expect(risen.why).toContain("returns to depth 6 of 9");
  });

  it("the recipe budget is asserted as constants, not as performance proof", () => {
    expect(DEEP_PAST_BUDGET.maxDrawCalls).toBe(90);
    expect(DEEP_PAST_BUDGET.maxTris).toBe(440_000);
    // The basin is the finished bottom: below the deepest stratum, solid.
    expect(DEEP_PAST_BASIN_Y).toBeLessThan(-720);
    expect(DEEP_PAST_BASIN_Y).toBe(-830);
  });
});
