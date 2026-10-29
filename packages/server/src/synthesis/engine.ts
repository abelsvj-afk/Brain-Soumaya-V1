import type { Insight, NodeRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
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

/**
 * REG-151 / INS-04: provider-aware synthesis gate, mirroring the sibling
 * contradiction scan's `contradictionOptionsFor`. Hash embeddings produce
 * much lower cosines than a real model — the contradiction scan's own
 * measurement puts an obvious planted pair at ~0.69 under hash, so the old
 * flat 0.82 made "🔍 Find new links" effectively inert offline while
 * honestly reporting "No new connections yet". Under hash the gate drops to
 * 0.5, the same floor the contradiction scan uses; real embeddings keep 0.82.
 */
export function synthesisOptionsFor(embeddingsModel: string): SynthesisOptions {
  const isHash = embeddingsModel.toLowerCase().includes("hash");
  return { ...DEFAULT_SYNTHESIS, threshold: isHash ? 0.5 : DEFAULT_SYNTHESIS.threshold };
}

/**
 * The maintenance latent job's own gate: stricter than the default synthesis
 * gate (0.85 vs 0.82) — it feeds latent insights, so it asks for a closer pair.
 */
export const LATENT_SYNTHESIS: SynthesisOptions = {
  threshold: 0.85,
  k: 5,
  minHops: 3,
  maxCandidates: 15,
};

/**
 * Provider-aware latent-job gate (Batch R, REG-227). Hash embeddings produce
 * much lower cosines than a real model — the contradiction scan documents the
 * same asymmetry (`contradictionOptionsFor` drops its threshold to 0.5 under
 * hash, after measuring ~0.69 for an obvious same-topic pair: the old flat
 * 0.86 made that scan find NOTHING offline). The flat 0.85 here starved the
 * latent-insight supply the same way on a hash brain — and 0.85 is even less
 * reachable under hash than REG-215's 0.72. Mirror the contradiction gate:
 * 0.5 under hash, 0.85 for real embeddings. Only the cosine floor adapts;
 * the latent job's own k/minHops/maxCandidates are unchanged, and the LLM
 * synthesis step downstream still judges each pair, so the lower hash bar
 * admits candidates for synthesis — it never auto-draws a link.
 *
 * Renamed from `synthesisOptionsFor` at the Batch R rebase onto f2f8611c:
 * Batch N (REG-151) had already taken that name for the DEFAULT-based gate
 * (0.82), and both helpers are pinned by their own tests — the latent job
 * keeps its stricter 0.85 base under its own name.
 */
export function latentSynthesisOptionsFor(embeddingsModel: string): SynthesisOptions {
  const isHash = embeddingsModel.toLowerCase().includes("hash");
  return { ...LATENT_SYNTHESIS, threshold: isHash ? 0.5 : LATENT_SYNTHESIS.threshold };
}

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
export function findCandidates(
  h: DbHandle,
  opts: SynthesisOptions = DEFAULT_SYNTHESIS,
  spaceId: string = DEFAULT_SPACE,
): Candidate[] {
  const nodes = new NodesRepo(h, spaceId).all();
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const node of nodes) {
    const emb = getEmbedding(h.sqlite, node.id);
    if (!emb) continue;
    const reachable = new Set(
      multiHopNeighbors(h.sqlite, node.id, opts.minHops).map((x) => x.nodeId),
    );
    const hits = knn(h.sqlite, emb, opts.k + 1, spaceId).filter(
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
  spaceId: string = DEFAULT_SPACE,
): Promise<Insight[]> {
  const nodesRepo = new NodesRepo(h, spaceId);
  const insightsRepo = new InsightsRepo(h, spaceId);
  const created: Insight[] = [];

  for (const c of findCandidates(h, opts, spaceId)) {
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
