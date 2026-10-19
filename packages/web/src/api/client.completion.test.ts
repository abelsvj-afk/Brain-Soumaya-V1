import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGraphWithCompletion } from "./client.js";

/**
 * D3 client (docs/repairs/galaxy-populate-render-stall.md §4.3): `refresh`
 * passes ingest-returned ids through chunked overview requests plus a single
 * id-ordered edge-completion stream. fetch is stubbed; no network is touched.
 */

interface Call {
  url: string;
  init?: RequestInit;
}

const node = (id: number) => ({ id, label: `n${id}`, type: "memory", content: "c" });
const edge = (id: number, source: number, target: number) => ({
  id,
  source,
  target,
  relationship: "relates_to",
  weight: 1,
  createdAt: "2026-10-18T00:00:00Z",
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("getGraphWithCompletion (D3)", () => {
  const calls: Call[] = [];
  // Per-test programmable stubs for the two endpoints.
  let graphStub: (includeIds: number[]) => { nodes: unknown[]; links: unknown[] };
  let edgesStub: (ids: number[], cursor: number | null) => { edges: unknown[]; nextCursor: number | null };

  beforeEach(() => {
    calls.length = 0;
    graphStub = (includeIds) => ({
      nodes: [{ ...node(1) }, ...includeIds.filter((id) => id !== 1).map(node)],
      links: [],
    });
    edgesStub = () => ({ edges: [], nextCursor: null });
    vi.stubGlobal(
      "fetch",
      async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        const u = new URL(url, "http://test");
        if (u.pathname === "/api/graph") {
          const raw = u.searchParams.get("includeIds") ?? "";
          const includeIds = raw === "" ? [] : raw.split(",").map(Number);
          return jsonResponse({ ...graphStub(includeIds), nextEdgeCursor: null });
        }
        if (u.pathname === "/api/graph/edges") {
          const body = JSON.parse((init?.body as string) ?? "{}") as { ids?: number[] };
          const q = u.searchParams.get("cursor");
          const cursor = q == null || q === "" ? null : Number(q);
          return jsonResponse(edgesStub(body.ids ?? [], cursor));
        }
        return jsonResponse({}, false, 404);
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const graphCalls = () => calls.filter((c) => new URL(c.url, "http://test").pathname === "/api/graph");
  const edgeCalls = () => calls.filter((c) => new URL(c.url, "http://test").pathname === "/api/graph/edges");
  const includeIdsOf = (c: Call) =>
    (new URL(c.url, "http://test").searchParams.get("includeIds") ?? "").split(",").filter(Boolean);

  it("chunks 250 ids into 200 + 50 overview requests and unions the nodes", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => 1000 + i);
    const g = await getGraphWithCompletion(ids);
    const gc = graphCalls();
    expect(gc).toHaveLength(2);
    expect(includeIdsOf(gc[0]!)).toHaveLength(200);
    expect(includeIdsOf(gc[1]!)).toHaveLength(50);
    // Union: hub node 1 + all 250 requested ids, each exactly once.
    expect(g.nodes).toHaveLength(251);
    const got = new Set(g.nodes.map((n) => (n as { id: number }).id));
    for (const id of ids) expect(got.has(id)).toBe(true);
  });

  it("sends no includeIds param for an empty id list (single plain overview)", async () => {
    await getGraphWithCompletion([]);
    const gc = graphCalls();
    expect(gc).toHaveLength(1);
    expect(new URL(gc[0]!.url, "http://test").searchParams.get("includeIds")).toBeNull();
  });

  it("completes cross-chunk edges via the stream, filters half-edges, dedupes by id", async () => {
    // Overview returns a stale copy of edge 100; the stream returns the fresh
    // copy plus a half-edge (target outside U) and a both-in-U edge.
    graphStub = (includeIds) => ({
      nodes: [{ ...node(1) }, ...includeIds.filter((id) => id !== 1).map(node)],
      links: [{ ...edge(100, 10, 20), weight: 0.1 }],
    });
    const seen: Array<{ ids: number[]; cursor: number | null }> = [];
    edgesStub = (ids, cursor) => {
      seen.push({ ids: [...ids].sort((a, b) => a - b), cursor });
      if (cursor === null) {
        return {
          edges: [
            { ...edge(100, 10, 20), weight: 0.9 },
            edge(101, 10, 999), // half-edge: target 999 not in U -> filtered
            edge(102, 20, 1), // both endpoints in U -> kept
          ],
          nextCursor: 102,
        };
      }
      return { edges: [], nextCursor: null };
    };
    const g = await getGraphWithCompletion([10, 20]);
    // Single id-ordered stream: first call has no cursor, second follows it.
    expect(seen).toHaveLength(2);
    expect(seen[0]!.cursor).toBeNull();
    expect(seen[1]!.cursor).toBe(102);
    // The stream carried the full union id set U = {1, 10, 20}.
    expect(seen[0]!.ids).toEqual([1, 10, 20]);
    const byId = new Map(g.links.map((l) => [l.id, l]));
    // Edge 100: stream's fresh copy wins over overview's stale copy (dedupe).
    expect(byId.get(100)!.weight).toBe(0.9);
    // Edge 101: half-edge filtered (999 not in U).
    expect(byId.has(101)).toBe(false);
    // Edge 102: both endpoints in U, present after completion.
    expect(byId.has(102)).toBe(true);
    expect(g.links).toHaveLength(2);
  });

  it("follows the cursor to null (multi-page completion)", async () => {
    const pages = [
      { edges: [edge(1, 1, 2)], nextCursor: 1 },
      { edges: [edge(2, 2, 3)], nextCursor: 2 },
      { edges: [edge(3, 3, 1)], nextCursor: null },
    ];
    let i = 0;
    edgesStub = () => pages[i++]!;
    graphStub = () => ({ nodes: [node(1), node(2), node(3)], links: [] });
    const g = await getGraphWithCompletion([1, 2, 3]);
    expect(edgeCalls()).toHaveLength(3);
    expect(g.links.map((l) => l.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
