import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { suggestGardenPlots } from "../analysis/garden.js";
import { DORMANT_DAYS } from "../analysis/dormant.js";

/**
 * Verb 1 — Tend a plot: the three suggestions Soumaya makes on arrival in
 * Growing Place (coldest, most-linked-but-untended, oldest untended).
 *
 * Fail-before: on the base tree there is no suggestion query at all, so
 * these tests fail at import time (no such module) — the behavior they
 * pin is entirely new.
 */
let handle: DbHandle;
const NOW = Date.parse("2026-10-27T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

function seedNode(label: string, opts: { created?: string; lastTended?: string | null; status?: string } = {}): number {
  const row = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, importance, last_tended_at, created_at, status)
       VALUES ('legacy', ?, 'memory', ?, 0.5, ?, ?, ?)`,
    )
    .run(label, label, opts.lastTended ?? null, opts.created ?? daysAgo(0), opts.status ?? "active");
  return Number(row.lastInsertRowid);
}

function seedEdge(a: number, b: number): void {
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES ('legacy', ?, ?, 'relates_to', 0.85)`)
    .run(a, b);
}

function suggest(exclude: number[] = []) {
  const nodes = new NodesRepo(handle, "legacy").all();
  const edges = new EdgesRepo(handle, "legacy").all();
  return suggestGardenPlots(nodes, edges, NOW, exclude);
}

describe("garden suggestions (Verb 1)", () => {
  it("uses the dormant threshold for 'untended'", () => {
    expect(DORMANT_DAYS).toBe(30);
  });

  it("returns nothing for an empty garden", () => {
    expect(suggest()).toEqual([]);
  });

  it("suggests the coldest, the most-linked, and the oldest — each with one plain why-line", () => {
    const cold = seedNode("Cold one", { created: daysAgo(400), lastTended: daysAgo(120) });
    const linked = seedNode("Well linked", { created: daysAgo(200), lastTended: daysAgo(90) });
    const old = seedNode("Old one", { created: daysAgo(365), lastTended: daysAgo(60) });
    const fresh = seedNode("Fresh one", { created: daysAgo(2), lastTended: daysAgo(0) });
    // The linked plot has the most links; the fresh one is warm and linked least.
    seedEdge(linked, cold);
    seedEdge(linked, old);
    seedEdge(linked, fresh);
    seedEdge(cold, old);

    const out = suggest();
    expect(out).toHaveLength(3);
    expect(out[0]!.slot).toBe("coldest");
    expect(out[0]!.nodeId).toBe(cold);
    expect(out[0]!.why).toBe("gone quiet for 120 days");
    expect(out[1]!.slot).toBe("most-linked");
    expect(out[1]!.nodeId).toBe(linked);
    expect(out[1]!.why).toBe("3 links, quiet for 90 days");
    expect(out[2]!.slot).toBe("oldest");
    expect(out[2]!.nodeId).toBe(old);
    expect(out[2]!.why).toBe("a year old today");
  });

  it("the oldest slot says 'a year old today' at 365 days, and counts years after", () => {
    const cold = seedNode("Coldest", { created: daysAgo(100), lastTended: daysAgo(120) });
    const hub = seedNode("Hub", { created: daysAgo(60), lastTended: daysAgo(40) });
    const year = seedNode("Exactly a year", { created: daysAgo(365), lastTended: daysAgo(40) });
    seedEdge(hub, cold);
    seedEdge(hub, year);
    const out = suggest();
    expect(out[0]!.nodeId).toBe(cold);
    expect(out[1]!.nodeId).toBe(hub);
    expect(out[2]!.nodeId).toBe(year);
    expect(out[2]!.why).toBe("a year old today");
  });

  it("the oldest slot counts whole years past one", () => {
    const cold = seedNode("Coldest", { created: daysAgo(100), lastTended: daysAgo(120) });
    const hub = seedNode("Hub", { created: daysAgo(60), lastTended: daysAgo(40) });
    const old = seedNode("Two years", { created: daysAgo(800), lastTended: daysAgo(40) });
    seedEdge(hub, cold);
    seedEdge(hub, old);
    const out = suggest();
    expect(out[2]!.nodeId).toBe(old);
    expect(out[2]!.why).toBe("2 years old");
  });

  it("never suggests the same ignored plot twice in a row", () => {
    const cold = seedNode("Cold one", { created: daysAgo(400), lastTended: daysAgo(120) });
    seedNode("Second", { created: daysAgo(100), lastTended: daysAgo(50) });
    seedNode("Third", { created: daysAgo(90), lastTended: daysAgo(45) });
    const first = suggest();
    expect(first.map((s) => s.nodeId)).toContain(cold);
    const second = suggest([cold]);
    expect(second.map((s) => s.nodeId)).not.toContain(cold);
  });

  it("skips archived plots — the garden never shows them either", () => {
    const cold = seedNode("Cold one", { created: daysAgo(400), lastTended: daysAgo(120) });
    seedNode("Archived cold", { created: daysAgo(500), lastTended: daysAgo(200), status: "archived" });
    const out = suggest();
    expect(out.map((s) => s.nodeId)).toContain(cold);
    expect(out.find((s) => s.slot === "coldest")!.nodeId).toBe(cold);
  });

  it("falls back to the coldest remaining plot when nothing is untended yet", () => {
    const a = seedNode("Five days quiet", { created: daysAgo(20), lastTended: daysAgo(5) });
    const b = seedNode("Two days quiet", { created: daysAgo(10), lastTended: daysAgo(2) });
    const out = suggest();
    expect(out).toHaveLength(2);
    expect(out[0]!.nodeId).toBe(a);
    expect(out[0]!.why).toBe("gone quiet for 5 days");
    expect(out[1]!.nodeId).toBe(b);
    // The most-linked slot falls back to the only remaining plot; its
    // why-line states the true numbers, never claims "untended".
    expect(out[1]!.why).toBe("0 links, quiet for 2 days");
  });

  it("returns fewer than three when the garden holds fewer plots", () => {
    seedNode("Only one", { created: daysAgo(100), lastTended: daysAgo(60) });
    expect(suggest()).toHaveLength(1);
  });
});
