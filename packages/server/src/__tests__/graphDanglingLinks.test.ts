import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { GraphData } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import { GraphService } from "../graph/service.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { MAX_EDGES_PER_RESPONSE } from "../repositories/edges.repo.js";

/**
 * Regression: `node not found: 150` (owner report, 2026-10-21).
 *
 * The graph payload builders filtered links against a DIFFERENT id set than
 * the nodes they shipped: `overview()`'s id selection ignored supersession
 * while `byIds` excluded superseded rows; `neighborhood()` traversed the raw
 * edge table; `full()` paired filtered nodes with unfiltered edges. Any
 * superseded or merged-away node with edges therefore shipped DANGLING links,
 * and the 3D renderer (d3-force) throws `node not found: <id>` on the first
 * one, taking down the whole galaxy.
 *
 * The fix prunes every payload's links to the ids of the nodes actually
 * returned. These tests pin that invariant per builder — each of A/B/C is a
 * reproduction case from the diagnosis and FAILS against the pre-fix service.
 */

const SPACE = "test-space";

function addNode(sqlite: DbHandle["sqlite"]): number {
  const info = sqlite
    .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'n', 'memory', 'c')")
    .run(SPACE);
  return Number(info.lastInsertRowid);
}

function addEdge(sqlite: DbHandle["sqlite"], source: number, target: number): number {
  const info = sqlite
    .prepare("INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates_to')")
    .run(SPACE, source, target);
  return Number(info.lastInsertRowid);
}

function supersede(sqlite: DbHandle["sqlite"], id: number): void {
  sqlite
    .prepare("UPDATE nodes SET superseded_at = ? WHERE id = ? AND space_id = ?")
    .run("2026-10-21T00:00:00.000Z", id, SPACE);
}

/** The invariant the renderer depends on: no link endpoint outside the node set. */
function expectNoDangling(data: GraphData): void {
  const ids = new Set(data.nodes.map((n) => n.id));
  for (const l of data.links) {
    expect(ids.has(l.source), `link ${l.id} source ${l.source} must be a shipped node`).toBe(true);
    expect(ids.has(l.target), `link ${l.id} target ${l.target} must be a shipped node`).toBe(true);
  }
}

describe("graph payloads never ship dangling links", () => {
  let handle: DbHandle;
  let svc: GraphService;
  let nodesRepo: NodesRepo;

  beforeEach(() => {
    handle = createDb(":memory:");
    svc = new GraphService(handle, SPACE);
    nodesRepo = new NodesRepo(handle, SPACE);
  });
  afterEach(() => {
    handle.sqlite.close();
  });

  it("A: overview drops links to a superseded node in the selected set", () => {
    const a = addNode(handle.sqlite);
    const b = addNode(handle.sqlite);
    const c = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, b);
    const healthy = addEdge(handle.sqlite, a, c);
    supersede(handle.sqlite, b);

    const data = svc.overview(300);

    // The superseded node is hidden (by design) — its link must not ship.
    expect(data.nodes.map((n) => n.id).sort((x, y) => x - y)).toEqual([a, c]);
    expectNoDangling(data);
    // The healthy link survives untouched.
    expect(data.links.map((l) => l.id)).toEqual([healthy]);
  });

  it("B: overview drops links to a soft-deleted (merged-away) node named via includeIds", () => {
    const a = addNode(handle.sqlite);
    const c = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, c);
    // Dedup merge: c is soft-deleted into a; its stored edges stay (recoverable).
    nodesRepo.softDelete(c, a);

    const data = svc.overview(300, [c]);

    expect(data.nodes.map((n) => n.id)).toEqual([a]);
    expect(data.links).toEqual([]);
    expectNoDangling(data);
  });

  it("C: neighborhood across a soft-deleted intermediate ships no dangling links", () => {
    const a = addNode(handle.sqlite);
    const d = addNode(handle.sqlite);
    const e = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, d);
    addEdge(handle.sqlite, d, e);
    nodesRepo.softDelete(d, a);

    const data = svc.neighborhood(a, 2);

    // Traversal still discovers e through the (stored) edges via d, but d
    // itself is not a shipped node, so neither of its links may ship.
    expect(new Set(data.nodes.map((n) => n.id))).toEqual(new Set([a, e]));
    expect(data.links).toEqual([]);
    expectNoDangling(data);
  });

  it("full() drops links to superseded nodes", () => {
    const a = addNode(handle.sqlite);
    const b = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, b);
    supersede(handle.sqlite, b);

    const data = svc.full();

    expect(data.nodes.map((n) => n.id)).toEqual([a]);
    expect(data.links).toEqual([]);
    expectNoDangling(data);
  });

  it("overview edge paging still pages on the shipped set (cursor + page size preserved)", () => {
    const a = addNode(handle.sqlite);
    const b = addNode(handle.sqlite);
    // Bulk-insert MAX+1 parallel edges a->b (raw SQL bypasses the app-level
    // dedupe guard on purpose — paging must hold regardless of edge count).
    handle.sqlite
      .prepare(
        `WITH RECURSIVE seq(x) AS (
           SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < ?
         )
         INSERT INTO edges (space_id, source, target, relationship)
         SELECT ?, ?, ?, 'relates_to' FROM seq`,
      )
      .run(MAX_EDGES_PER_RESPONSE + 1, SPACE, a, b);

    const data = svc.overview(300);

    expect(data.links).toHaveLength(MAX_EDGES_PER_RESPONSE);
    expect(data.nextEdgeCursor).not.toBeNull();
    expectNoDangling(data);
  });

  it("invariant holds for randomized fixtures across overview / neighborhood / full", () => {
    // Deterministic LCG so the fixture is stable run to run.
    let s = 0x2f6e2b1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };

    const N = 40;
    const ids: number[] = [];
    for (let i = 0; i < N; i++) ids.push(addNode(handle.sqlite));
    for (let i = 0; i < 90; i++) {
      const a = ids[Math.floor(rnd() * N)]!;
      const b = ids[Math.floor(rnd() * N)]!;
      if (a !== b) addEdge(handle.sqlite, a, b);
    }
    // Supersede ~8 and soft-delete ~6 of the nodes (never the start node,
    // which stays live and current for the neighborhood check).
    const start = ids[0]!;
    const victims = ids.slice(1);
    for (let i = 0; i < 8; i++) supersede(handle.sqlite, victims[i]!);
    for (let i = 8; i < 14; i++) nodesRepo.softDelete(victims[i]!, start);

    expectNoDangling(svc.overview(300));
    expectNoDangling(svc.overview(10)); // also under the degree cut
    expectNoDangling(svc.overview(300, victims.slice(0, 14))); // includeIds naming the hidden ones
    expectNoDangling(svc.neighborhood(start, 3));
    expectNoDangling(svc.full());
  });
});
