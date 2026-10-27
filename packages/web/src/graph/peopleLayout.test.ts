import { describe, it, expect } from "vitest";
import {
  buildPeopleLayout,
  evaluatePeopleGate,
  isEligiblePersonNode,
  isPersonNode,
  PEOPLE_BUDGET,
} from "./peopleLayout.js";
import type { GraphData } from "@brain/shared";

const NOW = new Date("2026-10-26T12:00:00");

function person(id: number, label: string, over: Record<string, unknown> = {}) {
  return { id, label, type: "daily", content: label, createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", ...over };
}
function typedPerson(id: number, label: string, type = "person") {
  return { id, label, type, content: label, createdAt: "2026-01-01T00:00:00.000Z" };
}
function memory(id: number, label: string, over: Record<string, unknown> = {}) {
  return { id, label, type: "daily", content: label, createdAt: "2026-01-01T00:00:00.000Z", ...over };
}
function edge(id: number, source: number, target: number) {
  return { id, source, target, relationship: "relates_to" as const, weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** Three qualifying people (2+ memories each) + one memory shared between two of them. */
function gateGraph(): GraphData {
  return {
    nodes: [
      person(1, "Shaqavia"),
      person(2, "Syncere"),
      person(3, "Kehlani"),
      memory(10, "first day"),
      memory(11, "birthday walk", { occurredAt: "2026-06-01T00:00:00.000Z" }),
      memory(12, "school run"),
      memory(13, "bedtime story"),
      memory(14, "park afternoon"),
      memory(15, "shared supper"),
      memory(16, "call her back", { kind: "action" }),
    ],
    links: [
      edge(100, 10, 1),
      edge(101, 11, 1),
      edge(102, 12, 2),
      edge(103, 13, 2),
      edge(104, 14, 3),
      edge(105, 15, 3),
      edge(106, 15, 1), // shared supper: persons 1 and 3 share memory 15
      edge(107, 16, 1), // open thread on person 1
    ],
  } as unknown as GraphData;
}

describe("isPersonNode (recon: how the app knows people)", () => {
  it("a tracked person_entity counts", () => {
    expect(isPersonNode(person(1, "A") as never)).toBe(true);
  });
  it("an extraction-typed person node counts", () => {
    expect(isPersonNode(typedPerson(2, "B") as never)).toBe(true);
  });
  it("the legacy relationship_reflection type counts (normalizeNodeType)", () => {
    expect(isPersonNode(typedPerson(3, "C", "relationship_reflection") as never)).toBe(true);
  });
  it("a plain memory node does not count", () => {
    expect(isPersonNode(memory(9, "m") as never)).toBe(false);
  });
  it("eligibility needs ≥1 linked memory; archived never qualifies", () => {
    expect(isEligiblePersonNode(person(1, "A") as never, 1)).toBe(true);
    expect(isEligiblePersonNode(person(1, "A") as never, 0)).toBe(false);
    expect(isEligiblePersonNode(person(1, "A", { status: "archived" }) as never, 5)).toBe(false);
  });
});

describe("evaluatePeopleGate (Q1)", () => {
  it("opens at 3 people × 2 memories + 1 shared memory", () => {
    expect(
      evaluatePeopleGate(
        new Map([
          [1, 2],
          [2, 2],
          [3, 3],
        ]),
        1,
      ),
    ).toBe(true);
  });
  it("stays closed with only 2 qualifying people", () => {
    expect(
      evaluatePeopleGate(
        new Map([
          [1, 5],
          [2, 5],
        ]),
        1,
      ),
    ).toBe(false);
  });
  it("stays closed with 3 people but no shared memory", () => {
    expect(
      evaluatePeopleGate(
        new Map([
          [1, 2],
          [2, 2],
          [3, 2],
        ]),
        0,
      ),
    ).toBe(false);
  });
  it("a person with only 1 memory does not qualify toward the three", () => {
    expect(
      evaluatePeopleGate(
        new Map([
          [1, 2],
          [2, 2],
          [3, 1],
        ]),
        1,
      ),
    ).toBe(false);
  });
});

describe("buildPeopleLayout", () => {
  it("one cluster per eligible person — and only those (C2)", () => {
    const layout = buildPeopleLayout(gateGraph(), NOW);
    expect(layout.clusters.map((c) => c.personId)).toEqual([1, 2, 3]);
    expect(layout.eligibleCount).toBe(3);
    expect(layout.clusters.map((c) => c.name)).toEqual(["Shaqavia", "Syncere", "Kehlani"]);
    // Lights are the true linked-memory counts: 1 has 4 (10, 11, 15, 16), 2 has 2, 3 has 2.
    expect(layout.clusters.map((c) => c.lights.length)).toEqual([4, 2, 2]);
    expect(layout.clusters[0]!.lights.map((l) => l.nodeId).sort((a, b) => a - b)).toEqual([10, 11, 15, 16]);
    expect(layout.gateOpen).toBe(true);
  });

  it("excludes archived people and people with no linked memory — no invented clusters", () => {
    const graph = gateGraph();
    graph.nodes.push(
      person(6, "Archived One", { status: "archived" }) as never,
      person(7, "Name Only") as never,
    );
    graph.links.push(edge(108, 10, 6)); // even linked, an archived person has no cluster
    const layout = buildPeopleLayout(graph, NOW);
    expect(layout.clusters.map((c) => c.personId)).toEqual([1, 2, 3]);
    expect(layout.excludedCount).toBe(2);
  });

  it("a person linked only to another person has no cluster (no memory, no invention)", () => {
    const graph: GraphData = {
      nodes: [person(1, "A"), person(2, "B"), memory(10, "m")],
      links: [edge(100, 1, 2), edge(101, 10, 1)],
    } as unknown as GraphData;
    const layout = buildPeopleLayout(graph, NOW);
    expect(layout.clusters.map((c) => c.personId)).toEqual([1]);
    expect(layout.excludedCount).toBe(1);
  });

  it("light form says what kind of thing it is — thread, date, gathering, memory", () => {
    const graph: GraphData = {
      nodes: [
        person(1, "A"),
        memory(10, "plain"),
        memory(11, "do this", { kind: "action" }),
        memory(12, "done this", { kind: "action", expiresAt: "2026-10-01T00:00:00.000Z" }),
        memory(13, "that day", { occurredAt: "2026-05-01T00:00:00.000Z" }),
        memory(14, "hub", { kind: "moc" }),
      ],
      links: [edge(100, 10, 1), edge(101, 11, 1), edge(102, 12, 1), edge(103, 13, 1), edge(104, 14, 1)],
    } as unknown as GraphData;
    const layout = buildPeopleLayout(graph, NOW);
    const forms = new Map(layout.clusters[0]!.lights.map((l) => [l.nodeId, l.form]));
    expect(forms.get(10)).toBe("memory");
    expect(forms.get(11)).toBe("thread"); // open action
    expect(forms.get(12)).toBe("memory"); // expired action is a memory now, not a thread
    expect(forms.get(13)).toBe("date");
    expect(forms.get(14)).toBe("gathering");
    expect(layout.clusters[0]!.lights.find((l) => l.nodeId === 13)?.occurredAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("bridges: a shared memory bridges its people; a direct link bridges too; alone stands alone", () => {
    const layout = buildPeopleLayout(gateGraph(), NOW);
    // Shared supper (15) bridges persons 1 and 3.
    expect(layout.bridges).toHaveLength(1);
    const bridge = layout.bridges[0]!;
    expect(bridge.fromPersonId).toBe(1);
    expect(bridge.toPersonId).toBe(3);
    expect(bridge.viaNodeIds).toEqual([15]);
    expect(bridge.edgeIds).toEqual([105, 106]);
    // Person 2 has no bridge — and is still a full cluster, not a lesser one.
    expect(layout.clusters.find((c) => c.personId === 2)).toBeTruthy();
  });

  it("a direct person↔person edge is a bridge with no shared memory behind it", () => {
    const graph = gateGraph();
    graph.links.push(edge(109, 1, 2));
    const layout = buildPeopleLayout(graph, NOW);
    const direct = layout.bridges.find((b) => b.fromPersonId === 1 && b.toPersonId === 2)!;
    expect(direct).toBeTruthy();
    expect(direct.edgeIds).toEqual([109]);
    expect(direct.viaNodeIds).toEqual([]);
  });

  it("determinism (C1): shuffled input lays out identically, repeated runs agree", () => {
    const graph = gateGraph();
    const first = buildPeopleLayout(graph, NOW);
    const shuffled: GraphData = {
      nodes: [...graph.nodes].reverse(),
      links: [...graph.links].reverse(),
    } as unknown as GraphData;
    const second = buildPeopleLayout(shuffled, NOW);
    expect(second).toEqual(first);
    expect(buildPeopleLayout(graph, NOW)).toEqual(first);
  });

  it("the why line names the person and true counts — no judgment, no rank", () => {
    const layout = buildPeopleLayout(gateGraph(), NOW);
    const why = layout.clusters[0]!.why;
    expect(why).toContain("Shaqavia");
    expect(why).toContain("4 memories");
    expect(why).toContain("1 open thread");
    expect(why).toContain("1 date that matters");
    expect(why).not.toMatch(/neglect|forgot|missed|overdue|behind|less/i);
  });

  it("empty brain: an honest empty field, gate closed, nothing fabricated", () => {
    const layout = buildPeopleLayout({ nodes: [], links: [] }, NOW);
    expect(layout.clusters).toEqual([]);
    expect(layout.bridges).toEqual([]);
    expect(layout.eligibleCount).toBe(0);
    expect(layout.gateOpen).toBe(false);
  });

  it("one person, one memory: one warm cluster, gate closed, no locked door", () => {
    const graph: GraphData = {
      nodes: [person(1, "Only"), memory(10, "m")],
      links: [edge(100, 10, 1)],
    } as unknown as GraphData;
    const layout = buildPeopleLayout(graph, NOW);
    expect(layout.clusters).toHaveLength(1);
    expect(layout.gateOpen).toBe(false);
  });

  it("edges to missing endpoints are omitted, never drawn to an invented endpoint", () => {
    const graph = gateGraph();
    graph.links.push(edge(110, 1, 999)); // dangling: the server prunes these; defense in depth
    graph.links.push(edge(111, 10, 11)); // memory↔memory: the galaxy's edge, not People's
    const layout = buildPeopleLayout(graph, NOW);
    expect(layout.clusters.map((c) => c.personId)).toEqual([1, 2, 3]);
    expect(layout.omittedEdgeCount).toBe(1); // only the dangling person edge; memory↔memory is not People's
    expect(layout.bridges).toHaveLength(1);
  });

  it("cluster placement is seeded per person — the same person, the same place", () => {
    const a = buildPeopleLayout(gateGraph(), NOW);
    const b = buildPeopleLayout(gateGraph(), NOW);
    expect(a.clusters.map((c) => [c.x, c.y, c.z])).toEqual(b.clusters.map((c) => [c.x, c.y, c.z]));
    for (const cluster of a.clusters) {
      expect(Math.hypot(cluster.x, cluster.z)).toBeLessThanOrEqual(560);
      expect(cluster.y).toBe(0);
    }
  });

  it("the recipe budget is a real ceiling, not a wish", () => {
    expect(PEOPLE_BUDGET.maxDrawCalls).toBeLessThanOrEqual(80);
    expect(PEOPLE_BUDGET.maxTris).toBeLessThanOrEqual(400_000);
  });
});
