import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { ingest } from "../ingestion/pipeline.js";
import { findCandidates, runSynthesis } from "../synthesis/engine.js";
import { chat } from "../chat/graphrag.js";

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const llm = new HeuristicProvider();

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

// Ingest without associative linking so pairs stay graph-distant for synthesis.
async function add(text: string) {
  return ingest(handle, { embeddings, llm, linkOptions: { threshold: 1.01, k: 0 } }, text);
}

describe("synthesis engine", () => {
  it("finds latent (semantically near, graph-distant) pairs and writes insights", async () => {
    await add("coffee subscription business with local roasters");
    await add("coffee subscription company with local roasters");
    await add("unrelated thoughts about lunar geology and rocks");

    const candidates = findCandidates(handle, {
      threshold: 0.6,
      k: 8,
      minHops: 3,
      maxCandidates: 12,
    });
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const insights = await runSynthesis(handle, llm, {
      threshold: 0.6,
      k: 8,
      minHops: 3,
      maxCandidates: 12,
    });
    expect(insights.length).toBeGreaterThanOrEqual(1);
    expect(insights[0]!.nodes.length).toBe(2);
    expect(insights[0]!.text.length).toBeGreaterThan(0);
  });

  it("does not duplicate insights for the same pair on a second run", async () => {
    await add("morning meditation routine and breathing");
    await add("daily breathing meditation in the morning");
    const opts = { threshold: 0.5, k: 8, minHops: 3, maxCandidates: 12 };
    const first = await runSynthesis(handle, llm, opts);
    const second = await runSynthesis(handle, llm, opts);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(second.length).toBe(0);
  });
});

describe("chat (GraphRAG)", () => {
  it("retrieves relevant memories and returns cited answer", async () => {
    await add("I want to start a coffee subscription business");
    await add("my budget for the coffee startup is tight");

    const res = await chat(handle, { embeddings, llm }, "coffee subscription budget");
    expect(res.contextIds.length).toBeGreaterThanOrEqual(1);
    expect(res.answer.length).toBeGreaterThan(0);
    // Heuristic cites the retrieved context nodes; all citations are valid ids.
    expect(res.citations.length).toBeGreaterThanOrEqual(1);
    expect(res.citations.every((c) => res.contextIds.includes(c.id))).toBe(true);
  });

  it("handles an empty brain gracefully", async () => {
    const res = await chat(handle, { embeddings, llm }, "anything?");
    expect(res.contextIds).toHaveLength(0);
    expect(res.citations).toHaveLength(0);
  });
});
