import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM, upsertEmbedding } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { latentSynthesisOptionsFor, LATENT_SYNTHESIS } from "../synthesis/engine.js";
import { selectJob, setResearchEnabled } from "../maintenance/agent.js";

/**
 * REG-227 — behavioural proof, mirroring REG-215's Batch H test: on a
 * hash-embeddings brain (model "hash-bow"), the maintenance latent job must
 * still surface a genuinely related pair whose cosine is ~0.6. The old flat
 * 0.85 gate filtered it before synthesis ever saw it, so latent insights
 * were dead offline too — and 0.85 is even less reachable under hash than
 * REG-215's 0.72.
 *
 * `knn` is mocked (vector search needs the sqlite-vec native binding); the
 * gate under test is the threshold filter inside `findCandidates`, reached
 * through the real `selectJob` path.
 */
const mockKnn = vi.fn();
vi.mock("../db/vec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/vec.js")>();
  return { ...actual, knn: (...args: unknown[]) => mockKnn(...args) };
});

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
  setResearchEnabled(ctx, "legacy", true);
  mockKnn.mockReset();
});
afterEach(() => handle.sqlite.close());

/** Two plain daily memories with stored hash embeddings; returns their ids. */
async function seedPair(): Promise<[number, number]> {
  const insert = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at)
     VALUES ('legacy', ?, 'daily', ?, ?, ?, ?)`,
  );
  const a = Number(
    insert.run("morning run", "morning run along the river trail", 0.5, 0.5, "2026-10-20T08:00:00Z").lastInsertRowid,
  );
  const b = Number(
    insert.run("river trail run", "river trail run at dawn", 0.5, 0.5, "2026-10-21T08:00:00Z").lastInsertRowid,
  );
  upsertEmbedding(handle.sqlite, a, await embeddings.embed("morning run along the river trail"));
  upsertEmbedding(handle.sqlite, b, await embeddings.embed("river trail run at dawn"));
  return [a, b];
}

describe("REG-227 — the latent-job gate adapts to the embeddings provider", () => {
  it("latentSynthesisOptionsFor drops the gate to 0.5 under hash, keeps 0.85 for real embeddings", () => {
    const hash = latentSynthesisOptionsFor("hash-bow");
    expect(hash.threshold).toBe(0.5);
    expect(hash.k).toBe(LATENT_SYNTHESIS.k);
    expect(hash.minHops).toBe(LATENT_SYNTHESIS.minHops);
    expect(hash.maxCandidates).toBe(LATENT_SYNTHESIS.maxCandidates);
    const real = latentSynthesisOptionsFor("all-MiniLM-L6-v2");
    expect(real.threshold).toBe(0.85);
    expect(real.k).toBe(LATENT_SYNTHESIS.k);
    expect(real.minHops).toBe(LATENT_SYNTHESIS.minHops);
    expect(real.maxCandidates).toBe(LATENT_SYNTHESIS.maxCandidates);
  });

  it("the hash check is case-insensitive and never mutates the latent defaults", () => {
    expect(latentSynthesisOptionsFor("HASH-BOW").threshold).toBe(0.5);
    expect(LATENT_SYNTHESIS.threshold).toBe(0.85);
  });

  it("selectJob surfaces a synthesis job for a ~0.6-similar pair on a hash brain", async () => {
    const [a, b] = await seedPair();
    // Both nodes see each other at 0.6 — below the old flat 0.85, above the
    // hash bar of 0.5, and far below the 0.96 merge floor (no fusion).
    mockKnn.mockImplementation(() => [{ nodeId: b, similarity: 0.6 }]);
    const job = await selectJob(ctx, "legacy");
    expect(job?.type).toBe("synthesis");
    expect(job?.targets).toEqual(expect.arrayContaining([a, b]));
  });
});
