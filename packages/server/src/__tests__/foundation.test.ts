import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { knn, upsertEmbedding, EMBED_DIM } from "../db/vec.js";
import { multiHopNeighbors, multiHopDirected } from "../graph/traversal.js";
import { seed, seedLarge, insertNode, type SeedIds } from "../seed.js";

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});

afterEach(() => {
  handle.sqlite.close();
});

/** Build a normalized vector that is mostly along axis `axis`, with light noise. */
function axisVec(axis: number, noise = 0): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[axis] = 1;
  if (noise > 0) {
    for (let i = 0; i < EMBED_DIM; i++) v[i] = (v[i] ?? 0) + (Math.random() * 2 - 1) * noise;
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) v[i] = v[i]! / norm;
  return v;
}

describe("recursive-CTE traversal", () => {
  let ids: SeedIds;
  beforeEach(() => {
    ids = seed(handle.sqlite);
  });

  it("reaches a depth-3 node along the chain with the correct path", () => {
    const hops = multiHopNeighbors(handle.sqlite, ids.a, 3);
    const dNode = hops.find((h) => h.nodeId === ids.d);
    expect(dNode).toBeDefined();
    expect(dNode!.depth).toBe(3);
    // ,a,b,c,d,
    expect(dNode!.path).toBe(`,${ids.a},${ids.b},${ids.c},${ids.d},`);
  });

  it("respects maxDepth (does not reach beyond the limit)", () => {
    const hops = multiHopNeighbors(handle.sqlite, ids.a, 2);
    expect(hops.find((h) => h.nodeId === ids.d)).toBeUndefined();
    expect(hops.find((h) => h.nodeId === ids.c)).toBeDefined();
  });

  it("terminates on a cycle and never revisits within a path", () => {
    const hops = multiHopNeighbors(handle.sqlite, ids.x, 10);
    // Bounded result (no infinite loop).
    expect(hops.length).toBeLessThan(50);
    // No path contains the same node id twice.
    for (const h of hops) {
      const visited = h.path.split(",").filter(Boolean);
      expect(new Set(visited).size).toBe(visited.length);
    }
  });

  it("directed traversal does not reach upstream ancestors; undirected does", () => {
    // From C (directed) we should reach D but NOT A or B.
    const directed = multiHopDirected(handle.sqlite, ids.c, 5).map((h) => h.nodeId);
    expect(directed).toContain(ids.d);
    expect(directed).not.toContain(ids.a);
    expect(directed).not.toContain(ids.b);

    // Undirected from C reaches the upstream ancestors.
    const undirected = multiHopNeighbors(handle.sqlite, ids.c, 5).map((h) => h.nodeId);
    expect(undirected).toContain(ids.a);
    expect(undirected).toContain(ids.b);
  });
});

describe("sqlite-vec KNN", () => {
  it("returns the nearest neighbour with similarity >= 0.85, ordered by distance", () => {
    const target = insertNode(handle.sqlite, "target", "concept", "t");
    const orthogonal = insertNode(handle.sqlite, "orthogonal", "concept", "o");
    const opposite = insertNode(handle.sqlite, "opposite", "concept", "p");

    const targetVec = axisVec(0);
    upsertEmbedding(handle.sqlite, target, targetVec);
    upsertEmbedding(handle.sqlite, orthogonal, axisVec(1));
    const opp = new Float32Array(targetVec);
    for (let i = 0; i < opp.length; i++) opp[i] = -opp[i]!;
    upsertEmbedding(handle.sqlite, opposite, opp);

    // Query close to the target.
    const query = axisVec(0, 0.05);
    const hits = knn(handle.sqlite, query, 3);

    expect(hits.length).toBe(3);
    expect(hits[0]!.nodeId).toBe(target);
    expect(hits[0]!.similarity).toBeGreaterThanOrEqual(0.85);
    // Ordered by ascending distance.
    expect(hits[0]!.distance).toBeLessThanOrEqual(hits[1]!.distance);
    expect(hits[1]!.distance).toBeLessThanOrEqual(hits[2]!.distance);
    // The opposite vector should be the least similar.
    expect(hits[2]!.nodeId).toBe(opposite);
  });
});

describe("latency (<100ms on ~500 nodes)", () => {
  it("KNN and depth-3 traversal each complete under 100ms", () => {
    const ids = seedLarge(handle.sqlite, 500);

    const q = axisVec(3, 0.1);
    let t = performance.now();
    const hits = knn(handle.sqlite, q, 10);
    const knnMs = performance.now() - t;
    expect(hits.length).toBeGreaterThan(0);
    expect(knnMs).toBeLessThan(100);

    t = performance.now();
    const hops = multiHopNeighbors(handle.sqlite, ids[0]!, 3);
    const traverseMs = performance.now() - t;
    expect(hops.length).toBeGreaterThan(0);
    expect(traverseMs).toBeLessThan(100);
  });
});
