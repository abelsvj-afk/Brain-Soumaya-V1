import type { GraphEdge, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import {
  associativeLink,
  DEFAULT_LINK_OPTIONS,
  type AssociativeLinkOptions,
} from "./associativeLink.js";

export interface IngestDeps {
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
  linkOptions?: AssociativeLinkOptions;
  /** How many recent nodes to give the LLM as extraction context. */
  contextSize?: number;
}

export interface IngestResult {
  nodes: GraphNode[];
  /** Edges explicitly extracted by the LLM within this input. */
  extractedEdges: GraphEdge[];
  /** Edges auto-discovered against existing memory (associative linking). */
  associativeEdges: GraphEdge[];
}

/**
 * The full ingestion pipeline: extract -> embed -> store -> associatively link.
 * Pure orchestration over the injected providers, so it is provider-agnostic and
 * testable with fakes.
 */
export async function ingest(h: DbHandle, deps: IngestDeps, rawText: string): Promise<IngestResult> {
  const nodesRepo = new NodesRepo(h);
  const edgesRepo = new EdgesRepo(h);

  // 1. Extract typed nodes + edges, grounded in recent context.
  const context = nodesRepo.recent(deps.contextSize ?? 20).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    content: n.content,
  }));
  const extraction = await deps.llm.extract(rawText, context);

  // 2 + 3. Embed each new node and store it (relational + vector).
  const contents = extraction.nodes.map((n) => n.content);
  const vectors = await deps.embeddings.embedBatch(contents);
  const createdNodes: GraphNode[] = [];
  const labelToId = new Map<string, number>();
  for (let i = 0; i < extraction.nodes.length; i++) {
    const n = extraction.nodes[i]!;
    const node = nodesRepo.create(n, vectors[i]!);
    createdNodes.push(node);
    labelToId.set(n.label, node.id);
  }

  // 4a. Persist the edges the LLM extracted within this input (label -> id).
  const extractedEdges: GraphEdge[] = [];
  for (const e of extraction.edges) {
    const source = labelToId.get(e.sourceLabel);
    const target = labelToId.get(e.targetLabel);
    if (source === undefined || target === undefined || source === target) continue;
    if (edgesRepo.exists(source, target)) continue;
    extractedEdges.push(edgesRepo.create({ source, target, relationship: e.relationship }));
  }

  // 4b. Autonomous associative linking against existing memory.
  const associativeEdges: GraphEdge[] = [];
  for (let i = 0; i < createdNodes.length; i++) {
    const links = await associativeLink(
      h,
      { nodes: nodesRepo, edges: edgesRepo, llm: deps.llm },
      createdNodes[i]!,
      vectors[i]!,
      deps.linkOptions ?? DEFAULT_LINK_OPTIONS,
    );
    associativeEdges.push(...links);
  }

  return { nodes: createdNodes, extractedEdges, associativeEdges };
}
