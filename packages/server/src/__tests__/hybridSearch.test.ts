import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { GraphService } from "../graph/service.js";
import { keywordSearch, fuseRrf } from "../db/fts.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

const add = async (label: string, content: string, spaceId = "legacy") => {
  const repo = new NodesRepo(handle, spaceId);
  return repo.create(
    { label, type: "daily", content } as never,
    await embeddings.embed(`${label} ${content}`),
  );
};

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

describe("hybrid retrieval (FTS5 keyword + vector, RRF-fused)", () => {
  it("keyword search finds exact-term hits, space-scoped, and survives injection", async () => {
    const a = await add("Repossession fear", "scared they will repossess the car");
    await add("Sunday picnic", "a calm afternoon in the park");
    await add("Other brain note", "repossess everything", "other-space");
    const hits = keywordSearch(handle.sqlite, "legacy", "repossess", 10);
    expect(hits.map((h) => h.nodeId)).toEqual([a.id]);
    // FTS5 query syntax in user input must not throw or match everything.
    expect(() => keywordSearch(handle.sqlite, "legacy", 'car" OR x NEAR/ (', 10)).not.toThrow();
  });

  it("fused search surfaces a keyword match the hash embedding misses", async () => {
    const target = await add("Lawyer meeting", "spoke with attorney Delgado about the case");
    for (let i = 0; i < 5; i++) await add(`Filler ${i}`, `unrelated musing number ${i} about clouds`);
    const svc = new GraphService(handle, "legacy");
    // "Delgado" is an exact name — hash cosine may rank fillers above it, but the
    // BM25 side pins it, and RRF puts it in the results.
    const { hits } = await svc.search(embeddings, "Delgado", 5);
    expect(hits.some((h) => h.id === target.id)).toBe(true);
  });

  it("FTS index follows node deletion", async () => {
    const n = await add("Ephemeral", "a note about zanzibar spice routes");
    expect(keywordSearch(handle.sqlite, "legacy", "zanzibar", 5).length).toBe(1);
    new NodesRepo(handle, "legacy").delete(n.id);
    expect(keywordSearch(handle.sqlite, "legacy", "zanzibar", 5).length).toBe(0);
  });

  it("RRF fusion is deterministic and favors items on both lists", () => {
    const fused = fuseRrf(
      [{ nodeId: 1 }, { nodeId: 2 }, { nodeId: 3 }],
      [{ nodeId: 3 }, { nodeId: 4 }],
      10,
    );
    expect(fused[0]).toBe(3); // on both lists → highest fused score
    expect(fused).toContain(1);
    expect(fused).toContain(4);
  });
});
