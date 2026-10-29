import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { ingestWithContext } from "../ingestion/pipeline.js";
import type {
  LlmProvider,
  LinkCandidate,
  LinkValidation,
  ExtractionResult,
  ContradictionResult,
  ClarificationInterpretation,
  AnswerResult,
} from "../llm/adapter.js";

/**
 * REG-215 (CN-17) — behavioural proof, using only the pre-existing public API:
 * on a hash-embeddings brain (model "hash-bow"), ingest must still link a
 * genuinely related pair whose cosine is ~0.6. The old flat 0.72 gate filtered
 * it before the LLM ever saw it, so the queue's supply dried up at the gate.
 *
 * `knn` is mocked (vector search needs the sqlite-vec native binding); the
 * gate under test is the threshold filter inside `associativeLink`, reached
 * through the real `ingestWithContext` path.
 */
const mockKnn = vi.fn();
vi.mock("../db/vec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/vec.js")>();
  return { ...actual, knn: (...args: unknown[]) => mockKnn(...args) };
});

class FakeLlm implements LlmProvider {
  readonly available = true;
  readonly model = "fake";
  validateCalls: number[] = [];
  async extract(): Promise<ExtractionResult> {
    return {
      nodes: [{ label: "quokka sunrise", type: "memory", content: "quokka sunrise" }],
      edges: [],
    } as unknown as ExtractionResult;
  }
  async validateLink(
    _s: LinkCandidate,
    _t: LinkCandidate,
    similarity: number,
  ): Promise<LinkValidation> {
    this.validateCalls.push(similarity);
    return { linked: true, relationship: "relates_to", weight: similarity };
  }
  async synthesize(): Promise<{ text: string; score: number }> {
    throw new Error("not stubbed");
  }
  async detectContradiction(): Promise<ContradictionResult> {
    throw new Error("not stubbed");
  }
  async interpretClarificationAnswer(): Promise<ClarificationInterpretation> {
    throw new Error("not stubbed");
  }
  async answer(): Promise<AnswerResult> {
    throw new Error("not stubbed");
  }
  async research(): Promise<{ label: string; content: string; questions?: string[] }> {
    throw new Error("not stubbed");
  }
  async summarizeSector(): Promise<string> {
    throw new Error("not stubbed");
  }
  async generateDailyLog(): Promise<string> {
    throw new Error("not stubbed");
  }
}

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings,
    llm: new FakeLlm(),
    usage: new UsageTracker(handle),
  } as AppContext;
});
afterEach(() => handle.sqlite.close());

describe("REG-215 — ingest-time gate adapts to the embeddings provider (CN-17)", () => {
  it("a 0.6-similarity pair links on a hash brain (gate 0.5), not starved by the flat 0.72", async () => {
    const existing = new NodesRepo(handle, "legacy").create(
      { label: "velvet tundra", type: "memory", content: "velvet tundra" } as never,
      await embeddings.embed("velvet tundra"),
    );
    // The new node's nearest neighbour is the existing memory at cosine 0.6 —
    // genuinely related, but below the old flat 0.72 gate. The labels share no
    // whole word, so the cognitive name-match pass can't link them first; and
    // the mock only answers associativeLink's own k+1=13 call, so the cognitive
    // gravity pass (k=12) sees nothing. The gate under test is the only path.
    mockKnn.mockImplementation((...args: unknown[]) =>
      args[2] === 13 ? [{ nodeId: existing.id, similarity: 0.6 }] : [],
    );
    const result = await ingestWithContext(
      handle,
      { embeddings, llm: ctx.llm },
      ctx,
      "quokka sunrise",
      "legacy",
    );
    expect(result.associativeEdges).toHaveLength(1);
    expect(result.associativeEdges[0]!.source).toBe(result.nodes[0]!.id);
    expect(result.associativeEdges[0]!.target).toBe(existing.id);
    expect(new EdgesRepo(handle, "legacy").exists(result.nodes[0]!.id, existing.id)).toBe(true);
  });

  it("an explicitly passed linkOptions still wins over the provider default", async () => {
    const existing = new NodesRepo(handle, "legacy").create(
      { label: "velvet tundra", type: "memory", content: "velvet tundra" } as never,
      await embeddings.embed("velvet tundra"),
    );
    mockKnn.mockImplementation((...args: unknown[]) =>
      args[2] === 13 ? [{ nodeId: existing.id, similarity: 0.6 }] : [],
    );
    const result = await ingestWithContext(
      handle,
      { embeddings, llm: ctx.llm, linkOptions: { threshold: 0.9, k: 12, maxLinks: 3 } },
      ctx,
      "quokka sunrise",
      "legacy",
    );
    // 0.6 < 0.9: the explicit gate holds, nothing is linked or even validated.
    expect(result.associativeEdges).toHaveLength(0);
    expect((ctx.llm as FakeLlm).validateCalls).toHaveLength(0);
  });
});
