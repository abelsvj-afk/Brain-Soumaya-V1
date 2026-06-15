import type { Insight, NodeRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { knn, getEmbedding } from "../db/vec.js";
import { multiHopNeighbors } from "../graph/traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import type { LlmProvider } from "../llm/adapter.js";

export interface SynthesisOptions {
  /** Cosine floor for a pair to be "related". */
  threshold: number;
  /** Nearest neighbours to inspect per node. */
  k: number;
  /** Minimum graph distance to count as "latent" (not already connected). */
  minHops: number;
  /** Cap on candidate pairs per run (bounds LLM cost). */
  maxCandidates: number;
}

export const DEFAULT_SYNTHESIS: SynthesisOptions = {
  threshold: 0.82,
  k: 8,
  minHops: 3,
  maxCandidates: 12,
};

export interface Candidate {
  a: number;
  b: number;
  similarity: number;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Find pairs that are semantically near but graph-distant — latent connections
 * the user hasn't drawn. This is the heart of the "compounding memory" magic.
 */
export function findCandidates(h: DbHandle, opts: SynthesisOptions = DEFAULT_SYNTHESIS): Candidate[] {
  const nodes = new NodesRepo(h).all();
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const node of nodes) {
    const emb = getEmbedding(h.sqlite, node.id);
    if (!emb) continue;
    const reachable = new Set(
      multiHopNeighbors(h.sqlite, node.id, opts.minHops).map((x) => x.nodeId),
    );
    const hits = knn(h.sqlite, emb, opts.k + 1).filter(
      (hit) =>
        hit.nodeId !== node.id && hit.similarity >= opts.threshold && !reachable.has(hit.nodeId),
    );
    for (const hit of hits) {
      const key = pairKey(node.id, hit.nodeId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: node.id, b: hit.nodeId, similarity: hit.similarity });
      if (out.length >= opts.maxCandidates) return out;
    }
  }
  return out;
}

const refOf = (n: { id: number; label: string; type: NodeRef["type"] }): NodeRef => ({
  id: n.id,
  label: n.label,
  type: n.type,
});

/**
 * Run synthesis: for each new latent pair, ask the LLM to write an insight and
 * persist it. Skips pairs that already have an insight.
 */
export async function runSynthesis(
  h: DbHandle,
  llm: LlmProvider,
  opts: SynthesisOptions = DEFAULT_SYNTHESIS,
): Promise<Insight[]> {
  const nodesRepo = new NodesRepo(h);
  const insightsRepo = new InsightsRepo(h);
  const created: Insight[] = [];

  for (const c of findCandidates(h, opts)) {
    if (insightsRepo.existsPair(c.a, c.b)) continue;
    const a = nodesRepo.getById(c.a);
    const b = nodesRepo.getById(c.b);
    if (!a || !b) continue;
    const { text, score } = await llm.synthesize(
      { label: a.label, content: a.content },
      { label: b.label, content: b.content },
      c.similarity,
    );
    const row = insightsRepo.create(c.a, c.b, text, score);
    created.push({ id: row.id, text, score, createdAt: row.createdAt, nodes: [refOf(a), refOf(b)] });
  }
  return created;
}
