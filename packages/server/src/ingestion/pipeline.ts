import type { GraphEdge, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { linkCognitiveAnchor } from "../analysis/cognitive.js";
import {
  associativeLink,
  mapWithConcurrency,
  DEFAULT_LINK_OPTIONS,
  type AssociativeLinkOptions,
} from "./associativeLink.js";
import type { AppContext } from "../context.js";

export interface IngestDeps {
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
  linkOptions?: AssociativeLinkOptions;
  /** How many recent nodes to give the LLM as extraction context. */
  contextSize?: number;
}

/** Optional user-supplied temporal/context metadata stamped on every created node. */
export interface IngestMeta {
  occurredAt?: string;
  remindAt?: string;
  tags?: string[];
}

// Detect mentions of existing person entities in a piece of text, so a new memory
// that names someone already tracked gets linked to them automatically — this is
// what actually grows a person's interaction count in the Mind tab. Deliberately a
// plain substring match (not embeddings): it must catch an exact name/alias mention
// every time, which a similarity score can't guarantee.
function getMentionedPeople(s: any, spaceId: string, text: string): { id: number; label: string }[] {
  const people = s
    .prepare(`SELECT id, label, aliases FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND kind = 'person_entity'`)
    .all(spaceId) as { id: number; label: string; aliases: string | null }[];

  const lower = text.toLowerCase();
  const mentioned: { id: number; label: string }[] = [];
  for (const p of people) {
    const tokens = [p.label.toLowerCase()];
    if (p.aliases) {
        try {
            const parsed: unknown = JSON.parse(p.aliases);
            // Same aliases-column contract as parseTags (nodes.repo.ts) and
            // listCognitive: the column is meant to hold a JSON array, but a legacy
            // row can hold any valid JSON. The old cast trusted the parse result's
            // type — a non-string element in an otherwise valid array made
            // .toLowerCase() throw, and the blanket catch then dropped the person's
            // ENTIRE alias list, so real alias mentions silently never linked.
            // Keep only a real array, elements mapped through String; anything
            // else degrades to no aliases.
            if (Array.isArray(parsed)) tokens.push(...parsed.map(a => String(a).toLowerCase()));
        } catch {}
    }

    if (tokens.some(t => lower.includes(t))) {
        mentioned.push({ id: p.id, label: p.label });
    }
  }
  return mentioned;
}

export interface IngestResult {
  nodes: GraphNode[];
  /** Edges explicitly extracted by the LLM within this input. */
  extractedEdges: GraphEdge[];
  /** Edges auto-discovered against existing memory (associative linking). */
  associativeEdges: GraphEdge[];
}

// Internal shared implementation
async function ingestCore(
  h: DbHandle,
  deps: IngestDeps,
  rawText: string,
  spaceId: string,
  meta?: IngestMeta,
  ctx?: AppContext,
): Promise<IngestResult> {
  const nodesRepo = new NodesRepo(h, spaceId);
  const edgesRepo = new EdgesRepo(h, spaceId);

  // 1. Extract typed nodes + edges, grounded in recent context.
  const context = nodesRepo.recent(deps.contextSize ?? 20).map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    content: n.content,
  }));
  const extraction = await deps.llm.extract(rawText, context);

  // 2 + 3. Embed each new node and store it (relational + vector).
  // REG-190: embed the same "label. content" composition the Details edit path
  // uses — content-only here made a memory's semantic findability depend on
  // whether it had ever been edited in Details.
  const contents = extraction.nodes.map((n) => `${n.label}. ${n.content}`);
  const vectors = await deps.embeddings.embedBatch(contents);
  const createdNodes: GraphNode[] = [];
  const labelToId = new Map<string, number>();
  for (let i = 0; i < extraction.nodes.length; i++) {
    const n = extraction.nodes[i]!;
    // Stamp the user's event date / reminder / tags on each node from this dump.
    const node = nodesRepo.create(
      { ...n, occurredAt: meta?.occurredAt, remindAt: meta?.remindAt, tags: meta?.tags },
      vectors[i]!,
    );
    createdNodes.push(node);
    labelToId.set(n.label, node.id);
    
    // Immediate cognitive linking
    if (ctx) {
        linkCognitiveAnchor(ctx, spaceId, node.id, node.label, vectors[i]!);
    }
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

  // 4b. Autonomous associative linking against existing memory. D4: at most 2
  // concurrent per-node jobs — with each job's max 3 concurrent validations,
  // the aggregate in-flight bound is 2 × 3 = 6 (structural, not timing-based).
  // Per-node results are collected by index so output order stays deterministic.
  const perNodeLinks = await mapWithConcurrency(
    createdNodes,
    2,
    (node, i) =>
      associativeLink(
        h,
        { nodes: nodesRepo, edges: edgesRepo, llm: deps.llm },
        node,
        vectors[i]!,
        deps.linkOptions ?? DEFAULT_LINK_OPTIONS,
        spaceId,
      ),
  );
  const associativeEdges: GraphEdge[] = perNodeLinks.flat();

  // 4c. Auto-link mentions of already-tracked people (Mind tab CRM). Checked per
  // CREATED NODE's own content, not the whole raw dump — a multi-node capture
  // shouldn't link every resulting node to someone only ONE of them actually
  // mentions. This is what grows `personProfile().count`; without it a person's
  // interaction count never advances past however many mentions they had when
  // added, however many new memories name them afterward.
  for (let i = 0; i < createdNodes.length; i++) {
    const node = createdNodes[i]!;
    const mentioned = getMentionedPeople(h.sqlite, spaceId, `${node.label}. ${extraction.nodes[i]!.content}`);
    for (const person of mentioned) {
      if (edgesRepo.exists(node.id, person.id)) continue;
      associativeEdges.push(edgesRepo.create({ source: node.id, target: person.id, relationship: "supports" }));
    }
  }

  return { nodes: createdNodes, extractedEdges, associativeEdges };
}

export async function ingest(
  h: DbHandle,
  deps: IngestDeps,
  rawText: string,
  spaceId: string = DEFAULT_SPACE,
  meta?: IngestMeta,
): Promise<IngestResult> {
    return ingestCore(h, deps, rawText, spaceId, meta);
}

export async function ingestWithContext(
  h: DbHandle,
  deps: IngestDeps,
  ctx: AppContext,
  rawText: string,
  spaceId: string = DEFAULT_SPACE,
  meta?: IngestMeta,
): Promise<IngestResult> {
    return ingestCore(h, deps, rawText, spaceId, meta, ctx);
}
