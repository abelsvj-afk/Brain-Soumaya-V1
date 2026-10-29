import { describe, it, expect } from "vitest";
import {
  buildQuietArchiveLayout,
  QUIET_ARCHIVE_BUDGET,
  QUIET_ARCHIVE_CLUSTER_SPACING,
  QUIET_ARCHIVE_EMPTY_FIELD_RADIUS,
  QUIET_ARCHIVE_SEED,
  quietArchiveSputnikPosition,
} from "./quietArchiveLayout.js";
import type { GraphData } from "@brain/shared";

function person(id: number, label: string, over: Record<string, unknown> = {}) {
  return { id, label, type: "daily", content: label, createdAt: "2026-01-01T00:00:00.000Z", kind: "person_entity", status: "archived", ...over };
}
function memory(id: number, label: string, over: Record<string, unknown> = {}) {
  return { id, label, type: "daily", content: label, createdAt: "2026-01-01T00:00:00.000Z", status: "archived", ...over };
}
function edge(id: number, source: number, target: number) {
  return { id, source, target, relationship: "relates_to" as const, weight: 0.5, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** Two archived people, one shared archived memory, one lone archived memory. */
function archiveGraph(): GraphData {
  return {
    nodes: [
      person(1, "Shaqavia"),
      person(2, "Syncere"),
      memory(10, "first day"),
      memory(11, "birthday walk", { occurredAt: "2026-06-01T00:00:00.000Z" }),
      memory(12, "school run"),
      memory(13, "shared supper"),
      memory(14, "a note with no one"),
      memory(15, "call her back", { kind: "action" }),
      memory(16, "the gathering", { kind: "moc" }),
    ],
    links: [
      edge(100, 10, 1),
      edge(101, 11, 1),
      edge(102, 12, 2),
      edge(103, 13, 1), // shared supper: persons 1 and 2 share memory 13
      edge(104, 13, 2),
      edge(105, 15, 1), // rested thread on person 1
      edge(106, 16, 2), // gathering on person 2
      edge(107, 1, 2), // direct person↔person edge: also a bridge
    ],
  } as unknown as GraphData;
}

describe("buildQuietArchiveLayout — the resting set", () => {
  it("clusters every archived person, even one with no archived memories", () => {
    const layout = buildQuietArchiveLayout({
      nodes: [person(1, "Alone"), memory(10, "unrelated")],
      links: [],
    } as unknown as GraphData);
    expect(layout.clusters).toHaveLength(1);
    expect(layout.clusters[0]!.personId).toBe(1);
    expect(layout.clusters[0]!.lights).toHaveLength(0);
    expect(layout.clusters[0]!.why).toBe("Alone — resting.");
    expect(layout.loneLights.map((l) => l.nodeId)).toEqual([10]);
  });

  it("lights are the person's archived memories, form by kind, dates carried quietly", () => {
    const layout = buildQuietArchiveLayout(archiveGraph());
    const one = layout.clusters.find((c) => c.personId === 1)!;
    expect(one.lights.map((l) => l.nodeId).sort((a, b) => a - b)).toEqual([10, 11, 13, 15]);
    const byId = new Map(one.lights.map((l) => [l.nodeId, l]));
    expect(byId.get(10)!.form).toBe("memory");
    expect(byId.get(11)!.form).toBe("date");
    expect(byId.get(11)!.occurredAt).toBe("2026-06-01T00:00:00.000Z");
    expect(byId.get(15)!.form).toBe("thread"); // an archived action: a rested thread, never an overdue one
    expect(byId.get(13)!.form).toBe("memory");
    expect(one.why).toBe("Shaqavia — 4 memories, 1 rested thread, 1 date that matters.");
    const two = layout.clusters.find((c) => c.personId === 2)!;
    expect(two.lights.map((l) => l.nodeId).sort((a, b) => a - b)).toEqual([12, 13, 16]);
    expect(two.lights.find((l) => l.nodeId === 16)!.form).toBe("gathering");
  });

  it("a memory linked to no archived person rests as a lone light", () => {
    const layout = buildQuietArchiveLayout(archiveGraph());
    expect(layout.loneLights.map((l) => l.nodeId)).toEqual([14]);
  });

  it("a shared archived memory bridges its two clusters; a direct person edge does too", () => {
    const layout = buildQuietArchiveLayout(archiveGraph());
    expect(layout.bridges).toHaveLength(1);
    const bridge = layout.bridges[0]!;
    expect(bridge.fromPersonId).toBe(1);
    expect(bridge.toPersonId).toBe(2);
    expect(bridge.viaNodeIds).toEqual([13]);
    expect(bridge.edgeIds).toEqual(expect.arrayContaining([103, 104, 107]));
  });

  it("edges to live nodes are omitted, never drawn to an invented endpoint", () => {
    const graph = archiveGraph();
    // Node 99 is live — absent from the archived payload entirely.
    graph.links.push(edge(108, 10, 99));
    const layout = buildQuietArchiveLayout(graph);
    expect(layout.omittedEdgeCount).toBe(1);
    expect(layout.clusters.find((c) => c.personId === 1)!.lights.map((l) => l.nodeId)).not.toContain(99);
  });

  it("an empty archive renders the still field itself — never a locked door", () => {
    const layout = buildQuietArchiveLayout({ nodes: [], links: [] });
    expect(layout.clusters).toEqual([]);
    expect(layout.loneLights).toEqual([]);
    expect(layout.fieldRadius).toBe(QUIET_ARCHIVE_EMPTY_FIELD_RADIUS);
    expect(layout.archivedCount).toBe(0);
    expect(layout.relicSpots).toHaveLength(2);
  });

  it("the field grows with the archive and keeps its spacing (Q3)", () => {
    const many = buildQuietArchiveLayout({
      nodes: Array.from({ length: 40 }, (_, i) => person(100 + i, `P${i}`)),
      links: [],
    } as unknown as GraphData);
    expect(many.fieldRadius).toBeGreaterThan(QUIET_ARCHIVE_EMPTY_FIELD_RADIUS);
    // No two clusters closer than the spacing rule allows (spiral grows with sqrt(i)).
    const centers = many.clusters.map((c) => [c.x, c.z] as const);
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = Math.hypot(centers[i]![0] - centers[j]![0], centers[i]![1] - centers[j]![1]);
        expect(d).toBeGreaterThan(QUIET_ARCHIVE_CLUSTER_SPACING * 0.5);
      }
    }
  });

  it("placement is deterministic under the recipe seed, whatever the arrival order", () => {
    const a = buildQuietArchiveLayout(archiveGraph());
    const shuffled = archiveGraph();
    shuffled.nodes.reverse();
    shuffled.links.reverse();
    const b = buildQuietArchiveLayout(shuffled);
    expect(b).toEqual(a);
  });

  it("relic spots match the registry's place and glimmer, one per relic of this world", () => {
    const layout = buildQuietArchiveLayout(archiveGraph());
    const seal = layout.relicSpots.find((s) => s.id === "stillness-seal")!;
    expect(seal.place).toBe("at the threshold of a quiet alcove");
    expect(seal.glimmer).toBe("at the threshold of a quiet alcove");
    const fold = layout.relicSpots.find((s) => s.id === "unopened-fold")!;
    expect(fold.place).toBe("kept in the Archive, unopened");
    expect(fold.glimmer).toBe("kept in the Archive, unopened");
    // The Seal rests gate-side, the Fold at the field's heart.
    expect(Math.hypot(seal.x, seal.z)).toBeGreaterThan(Math.hypot(fold.x, fold.z));
    // Both inside the field.
    for (const spot of layout.relicSpots) {
      expect(Math.hypot(spot.x, spot.z)).toBeLessThanOrEqual(layout.fieldRadius);
    }
  });

  it("Sputnik rests in its alcove by the arrival edge — beside the threshold, never in it", () => {
    const layout = buildQuietArchiveLayout(archiveGraph());
    const spot = quietArchiveSputnikPosition(layout.fieldRadius);
    // Inside the field, 40 units in from the edge, low (a small bright thing).
    expect(Math.hypot(spot.x, spot.z)).toBe(layout.fieldRadius - 40);
    expect(spot.y).toBe(8);
    // Off the threshold's axis (threshold at angle 0.6, field edge):
    // more than 100 units from the doorway's center, so it never stands
    // in the doorway — and clear of the Stillness Seal's relic spot.
    const threshold = {
      x: Math.cos(0.6) * (layout.fieldRadius + 10),
      z: Math.sin(0.6) * (layout.fieldRadius + 10),
    };
    expect(Math.hypot(spot.x - threshold.x, spot.z - threshold.z)).toBeGreaterThan(100);
    const seal = layout.relicSpots.find((s) => s.id === "stillness-seal")!;
    expect(Math.hypot(spot.x - seal.x, spot.z - seal.z)).toBeGreaterThan(50);
    // Deterministic from the field radius alone.
    expect(quietArchiveSputnikPosition(layout.fieldRadius)).toEqual(spot);
    expect(quietArchiveSputnikPosition(QUIET_ARCHIVE_EMPTY_FIELD_RADIUS).x).toBeCloseTo(
      Math.cos(1.1) * (QUIET_ARCHIVE_EMPTY_FIELD_RADIUS - 40),
      5,
    );
  });

  it("no cluster is nearer, larger, or brighter for importance or review strength", () => {
    const base = {
      nodes: [
        person(1, "Important", { importance: 1, reviewStrength: 0.01 }),
        person(2, "Quiet", { importance: 0, reviewStrength: 0.99 }),
      ],
      links: [],
    } as unknown as GraphData;
    const swapped = {
      nodes: [
        person(1, "Important", { importance: 0, reviewStrength: 0.99 }),
        person(2, "Quiet", { importance: 1, reviewStrength: 0.01 }),
      ],
      links: [],
    } as unknown as GraphData;
    // Rank drives nothing: swapping the rank signals changes no position.
    expect(buildQuietArchiveLayout(swapped)).toEqual(buildQuietArchiveLayout(base));
  });
});

describe("quiet-archive recipe constants", () => {
  it("the seed is the settled recipe seed", () => {
    expect(QUIET_ARCHIVE_SEED).toBe("quiet-archive / still-water-1");
  });
  it("the budget is the note's planned ceiling", () => {
    expect(QUIET_ARCHIVE_BUDGET).toEqual({ maxDrawCalls: 60, maxTris: 300_000 });
  });
});
