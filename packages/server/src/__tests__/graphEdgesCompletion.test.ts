import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { GraphService, INCLUDE_IDS_CAP, MAX_UNION_IDS } from "../graph/service.js";
import { MAX_EDGES_PER_RESPONSE } from "../repositories/edges.repo.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * D3 (docs/repairs/galaxy-populate-render-stall.md §4.3): `overview()` honors
 * explicit `includeIds`, and `POST /api/graph/edges` completes the edge set
 * via a single id-ordered cursor stream backed by a temp-table id set.
 *
 * NOTE: these tests need the better-sqlite3 native binding and do not run in
 * environments without it (see the implementation report).
 */

/* ---------- setup helpers ---------- */

function addNode(sqlite: DbHandle["sqlite"], space = "test-space"): number {
  const info = sqlite
    .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'n', 'memory', 'c')")
    .run(space);
  return Number(info.lastInsertRowid);
}

function addEdge(sqlite: DbHandle["sqlite"], source: number, target: number, space = "test-space"): number {
  const info = sqlite
    .prepare("INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates_to')")
    .run(space, source, target);
  return Number(info.lastInsertRowid);
}

function tempTableExists(sqlite: DbHandle["sqlite"]): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_temp_master WHERE name = 'want_ids'")
    .get() as { name: string } | undefined;
  return row !== undefined;
}

/* ---------- service-level: overview includeIds ---------- */

describe("D3 overview includeIds", () => {
  let handle: DbHandle;
  let svc: GraphService;

  beforeEach(() => {
    handle = createDb(":memory:");
    svc = new GraphService(handle, "test-space");
  });
  afterEach(() => {
    handle.sqlite.close();
  });

  it("unions top-limit nodes with explicit includeIds beyond the degree cut", () => {
    const ids: number[] = [];
    for (let i = 0; i < 310; i++) ids.push(addNode(handle.sqlite));
    // No edges: every node has degree 0, ties broken by id DESC, so the
    // top-300 are ids 310..11 and ids[0..2] (the three lowest) are excluded.
    const out = svc.overview(300, [ids[0]!, ids[1]!, ids[2]!]);
    const got = new Set(out.nodes.map((n) => n.id));
    expect(got.has(ids[0]!)).toBe(true);
    expect(got.has(ids[1]!)).toBe(true);
    expect(got.has(ids[2]!)).toBe(true);
    expect(out.nodes).toHaveLength(303);
    expect(out.nextEdgeCursor).toBeNull();
  });

  it("skips missing ids and dedupes duplicates", () => {
    const a = addNode(handle.sqlite);
    const out = svc.overview(300, [a, a, a, 999999]);
    expect(out.nodes.filter((n) => n.id === a)).toHaveLength(1);
  });

  it("filters cross-space ids — they can never leak into another brain", () => {
    const other = addNode(handle.sqlite, "other-space");
    const out = svc.overview(300, [other]);
    expect(out.nodes.some((n) => n.id === other)).toBe(false);
  });

  it("returns the additive nextEdgeCursor field (null when complete)", () => {
    const a = addNode(handle.sqlite);
    const b = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, b);
    const out = svc.overview(300, [a, b]);
    expect(out.nextEdgeCursor).toBeNull();
    expect(out.links).toHaveLength(1);
  });

  it("exposes the documented per-request caps", () => {
    expect(INCLUDE_IDS_CAP).toBe(200);
    expect(MAX_UNION_IDS).toBe(50000);
    expect(MAX_EDGES_PER_RESPONSE).toBe(5000);
  });
});

/* ---------- service-level: incident edge stream ---------- */

describe("D3 incident edge stream", () => {
  let handle: DbHandle;
  let svc: GraphService;

  beforeEach(() => {
    handle = createDb(":memory:");
    svc = new GraphService(handle, "test-space");
  });
  afterEach(() => {
    handle.sqlite.close();
  });

  it("paginates >5000 incident edges: exactly 5000 + non-null cursor, then the rest + null", () => {
    const hub = addNode(handle.sqlite);
    const total = MAX_EDGES_PER_RESPONSE + 200;
    handle.sqlite
      .transaction(() => {
        for (let i = 0; i < total; i++) addEdge(handle.sqlite, hub, addNode(handle.sqlite));
      })();
    const seen = new Set<number>();
    let cursor: number | null = null;
    let pages = 0;
    do {
      const { edges, nextCursor } = svc.incidentEdges([hub], cursor);
      pages++;
      if (pages === 1) {
        expect(edges).toHaveLength(MAX_EDGES_PER_RESPONSE);
        expect(nextCursor).not.toBeNull();
      }
      for (const e of edges) {
        expect(e.source).toBe(hub);
        seen.add(e.id);
      }
      cursor = nextCursor;
    } while (cursor !== null);
    expect(pages).toBe(2);
    // Complete deduped set, no silent truncation.
    expect(seen.size).toBe(total);
    expect(tempTableExists(handle.sqlite)).toBe(false);
  });

  it("captures an edge inserted mid-stream (concurrent-write self-completion)", () => {
    // Regression test for the round-5 race: the old per-chunk sweep protocol
    // could miss a write landing after its chunk's sweep; the single
    // id-ordered stream has no sweep phase, so `id > :cursor` necessarily
    // includes any edge inserted after the previous page's read.
    const hub = addNode(handle.sqlite);
    const total = MAX_EDGES_PER_RESPONSE + 100;
    handle.sqlite
      .transaction(() => {
        for (let i = 0; i < total; i++) addEdge(handle.sqlite, hub, addNode(handle.sqlite));
      })();
    const p1 = svc.incidentEdges([hub], null);
    expect(p1.edges).toHaveLength(MAX_EDGES_PER_RESPONSE);
    expect(p1.nextCursor).not.toBeNull();
    // The concurrent write lands after page 1's read: AUTOINCREMENT gives it
    // an id greater than every id the stream has returned.
    const late = addEdge(handle.sqlite, hub, addNode(handle.sqlite));
    expect(late).toBeGreaterThan(p1.nextCursor!);
    const seen = new Set(p1.edges.map((e) => e.id));
    let cursor: number | null = p1.nextCursor;
    do {
      const { edges, nextCursor } = svc.incidentEdges([hub], cursor);
      for (const e of edges) seen.add(e.id);
      cursor = nextCursor;
    } while (cursor !== null);
    expect(seen.has(late)).toBe(true);
    expect(seen.size).toBe(total + 1);
  });

  it("executes a 50000-id request end-to-end (bind-limit safety via temp table)", () => {
    const hub = addNode(handle.sqlite);
    const leaf = addNode(handle.sqlite);
    addEdge(handle.sqlite, hub, leaf);
    // Maximum accepted id count, with heavy duplication: INSERT OR IGNORE
    // must never PK-fail, and the single-bind fill must not hit the
    // bind-variable limit. Proves the documented contract is
    // database-executable, not just HTTP-accepted.
    const ids: number[] = [];
    for (let i = 0; i < MAX_UNION_IDS; i++) ids.push(i % 997 === 0 ? hub : 900000 + i);
    const { edges, nextCursor } = svc.incidentEdges(ids, null);
    expect(edges.some((e) => e.source === hub && e.target === leaf)).toBe(true);
    expect(nextCursor).toBeNull();
    expect(tempTableExists(handle.sqlite)).toBe(false);
  });

  it("temp table: sequential requests never observe each other's ids", () => {
    const a = addNode(handle.sqlite);
    const b = addNode(handle.sqlite);
    const c = addNode(handle.sqlite);
    addEdge(handle.sqlite, a, b);
    addEdge(handle.sqlite, b, c);
    const r1 = svc.incidentEdges([a], null);
    expect(r1.edges).toHaveLength(1);
    expect(tempTableExists(handle.sqlite)).toBe(false);
    const r2 = svc.incidentEdges([c], null);
    expect(r2.edges).toHaveLength(1);
    expect(r2.edges[0]!.source).toBe(b);
    expect(r2.edges[0]!.target).toBe(c);
    expect(tempTableExists(handle.sqlite)).toBe(false);
  });

  it("temp table: dropped even when the fill fails mid-request", () => {
    const a = addNode(handle.sqlite);
    // BigInt is not JSON-serializable: the single-bind fill throws INSIDE the
    // try block, and the finally must still drop want_ids.
    expect(() =>
      svc.incidentEdges([a, BigInt(1) as unknown as number], null),
    ).toThrow();
    expect(tempTableExists(handle.sqlite)).toBe(false);
    // The connection is still fully usable afterwards.
    const r = svc.incidentEdges([a], null);
    expect(r.edges).toHaveLength(0);
    expect(tempTableExists(handle.sqlite)).toBe(false);
  });

  it("cross-space ids match no edges (space-scoped)", () => {
    const other = addNode(handle.sqlite, "other-space");
    const other2 = addNode(handle.sqlite, "other-space");
    addEdge(handle.sqlite, other, other2, "other-space");
    const { edges } = svc.incidentEdges([other], null);
    expect(edges).toHaveLength(0);
  });
});

/* ---------- route-level: caps and contract ---------- */

describe("D3 graph routes", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "tester", passcode: "secret123", name: "tester" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });

  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function get(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, { headers: { "x-space-id": spaceId } });
    return { status: res.status, body: (await res.json()) as any };
  }
  async function postEdges(body: unknown, qs = ""): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}/api/graph/edges${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("GET /api/graph rejects over-cap includeIds with an explicit 400", async () => {
    const ids = Array.from({ length: INCLUDE_IDS_CAP + 1 }, (_, i) => i + 1).join(",");
    const { status, body } = await get(`/api/graph?limit=300&includeIds=${ids}`);
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/cap/i);
  });

  it("GET /api/graph honors within-cap includeIds and returns nextEdgeCursor", async () => {
    const sqlite = ctx.handle.sqlite;
    const ids: number[] = [];
    sqlite.transaction(() => {
      for (let i = 0; i < 310; i++) {
        const info = sqlite
          .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'n', 'memory', 'c')")
          .run(spaceId);
        ids.push(Number(info.lastInsertRowid));
      }
    })();
    const wanted = [ids[0], ids[1], ids[2]].join(",");
    const { status, body } = await get(`/api/graph?limit=300&includeIds=${wanted}`);
    expect(status).toBe(200);
    const got = new Set((body.nodes as { id: number }[]).map((n) => n.id));
    expect(got.has(ids[0])).toBe(true);
    expect(got.has(ids[1])).toBe(true);
    expect(got.has(ids[2])).toBe(true);
    expect(body.nodes.length).toBe(303);
    expect(body.nextEdgeCursor).toBeNull();
  });

  it("POST /api/graph/edges rejects a non-array body with 400", async () => {
    const { status } = await postEdges({ ids: "nope" });
    expect(status).toBe(400);
  });

  it("POST /api/graph/edges rejects >MAX_UNION_IDS ids with an explicit 400", async () => {
    const ids = Array.from({ length: MAX_UNION_IDS + 1 }, (_, i) => i + 1);
    const { status, body } = await postEdges({ ids });
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/cap/i);
  });

  it("POST /api/graph/edges rejects an invalid cursor with 400", async () => {
    const { status } = await postEdges({ ids: [1] }, "?cursor=abc");
    expect(status).toBe(400);
  });

  it("POST /api/graph/edges returns incident edges id-ordered with cursor", async () => {
    const sqlite = ctx.handle.sqlite;
    const a = Number(
      sqlite
        .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'a', 'memory', 'c')")
        .run(spaceId).lastInsertRowid,
    );
    const b = Number(
      sqlite
        .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'b', 'memory', 'c')")
        .run(spaceId).lastInsertRowid,
    );
    const e1 = Number(
      sqlite
        .prepare("INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates_to')")
        .run(spaceId, a, b).lastInsertRowid,
    );
    const e2 = Number(
      sqlite
        .prepare("INSERT INTO edges (space_id, source, target, relationship) VALUES (?, ?, ?, 'relates_to')")
        .run(spaceId, b, a).lastInsertRowid,
    );
    const { status, body } = await postEdges({ ids: [a] });
    expect(status).toBe(200);
    // Both e1 (a->b) and e2 (b->a) are incident to a; id-ordered ASC.
    expect(body.edges.map((e: { id: number }) => e.id)).toEqual([Math.min(e1, e2), Math.max(e1, e2)]);
    expect(body.nextCursor).toBeNull();
  });
});
