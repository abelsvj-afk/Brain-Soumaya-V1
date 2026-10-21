import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { recordCandidate, listCandidates, acceptCandidate, dismissCandidate, restoreCandidate } from "../analysis/candidates.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

async function mem(label: string, content: string) {
  return new NodesRepo(handle, "legacy").create({ label, type: "daily", content } as never, await embeddings.embed(label));
}

describe("IM-120 — candidate context + restore (undo)", () => {
  it("listCandidates carries each memory's content + createdAt for the preview", async () => {
    const a = await mem("apple", "apple content body");
    const b = await mem("banana", "banana content body");
    recordCandidate(handle, "legacy", a.id, b.id, "possible link", 0.7);
    const [c] = listCandidates(handle, "legacy");
    const contents = [c!.aContent, c!.bContent].sort();
    expect(contents).toEqual(["apple content body", "banana content body"]);
    expect(c!.aCreatedAt).toBeTruthy();
    expect(c!.bCreatedAt).toBeTruthy();
  });

  it("restore after accept removes the created edge and re-pends the candidate", async () => {
    const a = await mem("apple", "a");
    const b = await mem("banana", "b");
    recordCandidate(handle, "legacy", a.id, b.id, "r", 0.7);
    const id = listCandidates(handle, "legacy")[0]!.id;
    acceptCandidate(handle, "legacy", id);
    const edges = new EdgesRepo(handle, "legacy");
    expect(edges.exists(a.id, b.id) || edges.exists(b.id, a.id)).toBe(true);
    expect(restoreCandidate(handle, "legacy", id)).toBe(true);
    expect(edges.exists(a.id, b.id) || edges.exists(b.id, a.id)).toBe(false);
    expect(listCandidates(handle, "legacy")).toHaveLength(1);
    // Restoring a pending candidate is a no-op.
    expect(restoreCandidate(handle, "legacy", id)).toBe(false);
  });

  it("restore after dismiss clears the rejection so the pair can return", async () => {
    const a = await mem("apple", "a");
    const b = await mem("banana", "b");
    recordCandidate(handle, "legacy", a.id, b.id, "r", 0.7);
    const id = listCandidates(handle, "legacy")[0]!.id;
    dismissCandidate(handle, "legacy", id);
    expect(listCandidates(handle, "legacy")).toHaveLength(0);
    expect(restoreCandidate(handle, "legacy", id)).toBe(true);
    expect(listCandidates(handle, "legacy")).toHaveLength(1);
  });
});
