import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtractionResult } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { createEmbeddingProvider } from "../embeddings/adapter.js";
import { EMBED_DIM } from "../db/vec.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "../llm/adapter.js";
import { ingest } from "../ingestion/pipeline.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/** Deterministic LLM stand-in. */
class FakeLlm implements LlmProvider {
  readonly available = true;
  readonly model = "fake";
  constructor(private readonly extraction?: ExtractionResult) {}
  async extract(text: string, _ctx: ContextNode[]): Promise<ExtractionResult> {
    return (
      this.extraction ?? {
        nodes: [{ label: text.slice(0, 24), type: "random_thought", content: text }],
        edges: [],
      }
    );
  }
  async validateLink(
    _s: LinkCandidate,
    _t: LinkCandidate,
    similarity: number,
  ): Promise<LinkValidation> {
    return { linked: true, relationship: "relates_to", weight: similarity };
  }
  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    return { text: `${a.label} ~ ${b.label}`, score: similarity };
  }
  async answer(
    _question: string,
    context: ContextNode[],
  ): Promise<{ answer: string; citations: number[] }> {
    return { answer: "ok", citations: context.map((c) => c.id) };
  }
}

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("ingestion pipeline", () => {
  it("extracts, embeds, and stores a node (with retrievable embedding)", async () => {
    const res = await ingest(
      handle,
      { embeddings, llm: new FakeLlm() },
      "A fleeting idea about morning routines",
    );
    expect(res.nodes).toHaveLength(1);
    const stored = new NodesRepo(handle).getById(res.nodes[0]!.id);
    expect(stored?.content).toContain("morning routines");
    const vecCount = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_nodes`).get() as {
      c: number;
    };
    expect(vecCount.c).toBe(1);
  });

  it("persists LLM-extracted edges between nodes in the same input", async () => {
    const extraction: ExtractionResult = {
      nodes: [
        { label: "Coffee subscription", type: "business_idea", content: "monthly coffee delivery" },
        { label: "Roaster partnership", type: "business_idea", content: "partner with local roasters" },
      ],
      edges: [{ sourceLabel: "Coffee subscription", targetLabel: "Roaster partnership", relationship: "builds_on" }],
    };
    const res = await ingest(handle, { embeddings, llm: new FakeLlm(extraction) }, "raw");
    expect(res.nodes).toHaveLength(2);
    expect(res.extractedEdges).toHaveLength(1);
    expect(res.extractedEdges[0]!.relationship).toBe("builds_on");
    expect(res.extractedEdges[0]!.source).toBe(res.nodes[0]!.id);
    expect(res.extractedEdges[0]!.target).toBe(res.nodes[1]!.id);
  });

  it("auto-discovers an associative link to a semantically similar older memory", async () => {
    const deps = { embeddings, llm: new FakeLlm(), linkOptions: { threshold: 0.6, k: 10 } };
    const first = await ingest(handle, deps, "I want to start a coffee subscription business");
    const second = await ingest(handle, deps, "I want to start a coffee subscription company");

    expect(second.associativeEdges.length).toBeGreaterThanOrEqual(1);
    const edge = second.associativeEdges[0]!;
    expect(edge.source).toBe(second.nodes[0]!.id);
    expect(edge.target).toBe(first.nodes[0]!.id);
    expect(edge.weight).toBeGreaterThanOrEqual(0.6);
  });

  it("does not link unrelated thoughts below the similarity threshold", async () => {
    const deps = { embeddings, llm: new FakeLlm(), linkOptions: { threshold: 0.85, k: 10 } };
    await ingest(handle, deps, "quantum chromodynamics lattice gauge theory");
    const second = await ingest(handle, deps, "my grandmother's apple pie recipe");
    expect(second.associativeEdges).toHaveLength(0);
  });

  it("works with the no-key heuristic provider (guesses node type)", async () => {
    const res = await ingest(
      handle,
      { embeddings, llm: new HeuristicProvider() },
      "I have a startup idea for a SaaS product targeting the coffee market",
    );
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]!.type).toBe("business_idea");
  });
});

describe("embedding provider factory", () => {
  it("builds a hash provider with the correct dimension", async () => {
    const provider = await createEmbeddingProvider("hash");
    expect(provider.dim).toBe(EMBED_DIM);
    const v = await provider.embed("hello world");
    expect(v).toHaveLength(EMBED_DIM);
    // L2-normalized.
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });
});
