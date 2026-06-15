import type { GraphEdge, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { knn } from "../db/vec.js";
import type { LlmProvider } from "../llm/adapter.js";
import type { EdgesRepo } from "../repositories/edges.repo.js";
import type { NodesRepo } from "../repositories/nodes.repo.js";

export interface AssociativeLinkOptions {
  /** Cosine similarity floor for a candidate to be considered. */
  threshold: number;
  /** Max nearest neighbours to inspect (caps LLM fan-out). */
  k: number;
}

export const DEFAULT_LINK_OPTIONS: AssociativeLinkOptions = { threshold: 0.85, k: 10 };

/**
 * The autonomous "dot-connecting" step: for a freshly stored node, find its
 * nearest semantic neighbours, then ask the LLM to validate each into a typed
 * edge. Emulates associative memory — connecting new thoughts to forgotten ones.
 */
export async function associativeLink(
  h: DbHandle,
  deps: { nodes: NodesRepo; edges: EdgesRepo; llm: LlmProvider },
  newNode: GraphNode,
  embedding: Float32Array,
  options: AssociativeLinkOptions = DEFAULT_LINK_OPTIONS,
): Promise<GraphEdge[]> {
  // k+1 because the node itself is its own nearest neighbour.
  const hits = knn(h.sqlite, embedding, options.k + 1).filter(
    (hit) => hit.nodeId !== newNode.id && hit.similarity >= options.threshold,
  );

  const created: GraphEdge[] = [];
  for (const hit of hits) {
    if (deps.edges.exists(newNode.id, hit.nodeId)) continue;
    const target = deps.nodes.getById(hit.nodeId);
    if (!target) continue;

    const decision = await deps.llm.validateLink(
      { label: newNode.label, content: newNode.content },
      { label: target.label, content: target.content },
      hit.similarity,
    );
    if (decision.linked) {
      created.push(
        deps.edges.create({
          source: newNode.id,
          target: hit.nodeId,
          relationship: decision.relationship ?? "relates_to",
          weight: decision.weight ?? hit.similarity,
        }),
      );
    }
  }
  return created;
}
