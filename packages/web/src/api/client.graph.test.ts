import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGraph } from "./client.js";

/**
 * Regression: `node not found: 150` (2026-10-21). A galaxy payload whose links
 * reference nodes outside its own node set crashes the 3D renderer (d3-force
 * throws on the dangling endpoint). `getGraph` is the first client guard
 * point: it must filter such links out of every payload it returns. fetch is
 * stubbed; no network is touched.
 */

const node = (id: number) => ({ id, label: `n${id}`, type: "memory", content: "c" });
const edge = (id: number, source: number, target: number) => ({
  id,
  source,
  target,
  relationship: "relates_to",
  weight: 1,
  createdAt: "2026-10-21T00:00:00Z",
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("getGraph dangling-link guard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        nodes: [node(1), node(2)],
        links: [edge(9, 1, 150), edge(10, 1, 2)],
        nextEdgeCursor: null,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters out links whose endpoints are not in the payload's node set", async () => {
    const g = await getGraph();
    expect(g.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(g.links.map((l) => l.id)).toEqual([10]);
  });
});
