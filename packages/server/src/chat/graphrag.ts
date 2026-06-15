import type { ChatResponse, NodeRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { knn } from "../db/vec.js";
import { multiHopNeighbors } from "../graph/traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";

export interface ChatOptions {
  /** Semantic seed nodes from KNN. */
  k: number;
  /** Hops to expand around each seed (the GraphRAG neighborhood step). */
  depth: number;
}

export const DEFAULT_CHAT: ChatOptions = { k: 6, depth: 1 };

/**
 * GraphRAG: embed the question -> KNN seeds -> expand neighborhoods via recursive
 * CTE -> assemble subgraph context -> LLM answers with node citations.
 */
export async function chat(
  h: DbHandle,
  deps: { embeddings: EmbeddingProvider; llm: LlmProvider },
  question: string,
  opts: ChatOptions = DEFAULT_CHAT,
): Promise<ChatResponse> {
  const vec = await deps.embeddings.embed(question);
  const seeds = knn(h.sqlite, vec, opts.k);

  const ids = new Set<number>();
  for (const s of seeds) {
    ids.add(s.nodeId);
    for (const hop of multiHopNeighbors(h.sqlite, s.nodeId, opts.depth)) ids.add(hop.nodeId);
  }

  const nodesRepo = new NodesRepo(h);
  const ctxNodes = nodesRepo.byIds([...ids]);
  const context = ctxNodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    content: n.content,
  }));

  const { answer, citations } = await deps.llm.answer(question, context);

  const refById = new Map<number, NodeRef>(
    ctxNodes.map((n) => [n.id, { id: n.id, label: n.label, type: n.type }]),
  );
  const validCitations = citations
    .map((id) => refById.get(id))
    .filter((x): x is NodeRef => x !== undefined);

  return { answer, citations: validCitations, contextIds: [...ids] };
}
