import { randomBytes } from "node:crypto";
import type { GraphEdge, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { SourcesRepo, extractionHashOf } from "../repositories/sources.repo.js";
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
  /**
   * Verbatim-Recall V1 capture channel — selects the source kind when
   * `sourceKind` is not set explicitly: telegram -> kind 'telegram',
   * chat -> kind 'chat', anything else -> kind 'note'.
   */
  channel?: "web" | "telegram" | "chat";
  /** Verbatim-Recall V1: explicit source kind (e.g. 'document' for file import). */
  sourceKind?: string;
  /** Verbatim-Recall V1: citation class (e.g. 'imported_text' for file import). */
  citationClass?: string;
  /** Verbatim-Recall V1: capture idempotency key (one source per key). */
  idempotencyKey?: string;
  /** Verbatim-Recall V1: source title, when the caller has one. */
  sourceTitle?: string;
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

/**
 * Verbatim-Recall V1 (design sections 12A/18.3): run extraction for an
 * already-persisted source under the single-winner lease claim.
 *
 * - Claim lost (another worker holds a live lease, or the source is in a
 *   terminal state): returns the nodes already linked to the source and
 *   creates nothing.
 * - A retry whose extraction reproduces the recorded (or inferable)
 *   extraction_hash reuses the existing nodes and creates none; the
 *   node_sources unique index makes duplicate links impossible.
 * - Extraction failure: the claim is released as extraction_failed (or
 *   failed_permanent after 5 attempts) and the error propagates — the
 *   source itself stays preserved and exact-searchable.
 */
export async function processSourceExtraction(
  h: DbHandle,
  deps: IngestDeps,
  sourceId: number,
  spaceId: string,
  meta?: IngestMeta,
  ctx?: AppContext,
): Promise<IngestResult> {
  const sourcesRepo = new SourcesRepo(h, spaceId);
  const nodesRepo = new NodesRepo(h, spaceId);
  const source = sourcesRepo.getById(sourceId);
  if (!source) throw new Error(`processSourceExtraction: source ${sourceId} not found`);
  const existingNodes = (): GraphNode[] =>
    nodesRepo.byIds(sourcesRepo.nodeIdsWithOriginFrom(sourceId), { includeSuperseded: true });

  if (source.processingStatus === "extracted") {
    return { nodes: existingNodes(), extractedEdges: [], associativeEdges: [] };
  }
  const owner = `worker:${process.pid}:${Date.now()}:${randomBytes(6).toString("hex")}`;
  const claimed = sourcesRepo.claim(sourceId, owner);
  if (!claimed) {
    // Another worker holds the lease (or the source went terminal):
    // create nothing; surface whatever is already linked.
    return { nodes: existingNodes(), extractedEdges: [], associativeEdges: [] };
  }

  const rawText = claimed.rawText ?? "";
  try {
    const edgesRepo = new EdgesRepo(h, spaceId);

    // 1. Extract typed nodes + edges, grounded in recent context.
    const context = nodesRepo.recent(deps.contextSize ?? 20).map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      content: n.content,
    }));
    const extraction = await deps.llm.extract(rawText, context);
    const resultHash = extractionHashOf(extraction.nodes);

    // Retry idempotency (18.3): the same extraction over nodes already
    // linked to this source reuses them — no new nodes, no new links.
    const prior = existingNodes();
    if (prior.length > 0 && extractionHashOf(prior) === resultHash) {
      sourcesRepo.completeExtraction(sourceId, owner, resultHash);
      for (const n of prior) n.hasOriginSource = true;
      return { nodes: prior, extractedEdges: [], associativeEdges: [] };
    }
    if (claimed.extractionHash && claimed.extractionHash === resultHash && prior.length > 0) {
      sourcesRepo.completeExtraction(sourceId, owner, resultHash);
      for (const n of prior) n.hasOriginSource = true;
      return { nodes: prior, extractedEdges: [], associativeEdges: [] };
    }

    // 2 + 3. Embed each new node (external call — stays OUTSIDE the
    // write transaction below, like the extraction LLM call above).
    const contents = extraction.nodes.map((n) => n.content);
    const vectors = await deps.embeddings.embedBatch(contents);
    const createdNodes: GraphNode[] = [];
    const labelToId = new Map<string, number>();
    const extractedEdges: GraphEdge[] = [];
    const mentionEdges: GraphEdge[] = [];

    // Fix round (review finding — exactly-once under mid-loop failure):
    // the attempt's writes are ATOMIC. Node creation, origin-link
    // writes, cognitive-anchor links, LLM-extracted edges, people-
    // mention edges, and the completion bookkeeping all run in ONE
    // synchronous DB transaction. Any failure mid-loop (e.g. the
    // second node's insert) rolls the whole attempt back — no partial
    // nodes, no partial links, no recorded extraction_hash — so the
    // retryable failure path re-runs extraction over a clean slate
    // and creates the node set exactly once. (Previously each node
    // committed independently; a mid-loop fault left earlier nodes
    // committed, the hash-reuse check only matches COMPLETE sets, and
    // recovery re-created the already-committed nodes as duplicates.)
    // Nested repo transactions (NodesRepo.create) join this one as
    // savepoints under better-sqlite3, so their writes roll back too.
    const writeTx = h.sqlite.transaction(() => {
      for (let i = 0; i < extraction.nodes.length; i++) {
        const n = extraction.nodes[i]!;
        // Stamp the user's event date / reminder / tags on each node from this dump.
        const node = nodesRepo.create(
          { ...n, occurredAt: meta?.occurredAt, remindAt: meta?.remindAt, tags: meta?.tags },
          vectors[i]!,
        );
        sourcesRepo.linkNodeToAllChunks(node.id, sourceId);
        node.hasOriginSource = true;
        createdNodes.push(node);
        labelToId.set(n.label, node.id);

        // Immediate cognitive linking
        if (ctx) {
            linkCognitiveAnchor(ctx, spaceId, node.id, node.label, vectors[i]!);
        }
      }

      // 4a. Persist the edges the LLM extracted within this input (label -> id).
      for (const e of extraction.edges) {
        const sourceNode = labelToId.get(e.sourceLabel);
        const target = labelToId.get(e.targetLabel);
        if (sourceNode === undefined || target === undefined || sourceNode === target) continue;
        if (edgesRepo.exists(sourceNode, target)) continue;
        extractedEdges.push(edgesRepo.create({ source: sourceNode, target, relationship: e.relationship }));
      }

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
          mentionEdges.push(edgesRepo.create({ source: node.id, target: person.id, relationship: "supports" }));
        }
      }

      // Completion bookkeeping INSIDE the same transaction: the source
      // only becomes 'extracted' (with its extraction_hash) if every
      // write above committed with it. Losing the lease here aborts
      // the whole attempt rather than stranding unowned nodes.
      if (!sourcesRepo.completeExtraction(sourceId, owner, resultHash)) {
        throw new Error(`processSourceExtraction: completion lost the lease for source ${sourceId}`);
      }
    });
    writeTx();

    // 4b. Autonomous associative linking against existing memory. This
    // step genuinely CANNOT join the write transaction above: it awaits
    // LLM validateLink calls, and a better-sqlite3 transaction is
    // synchronous — holding one open across awaits would commit before
    // the async work finished (and block the connection meanwhile).
    // It therefore runs AFTER the extraction commit as best-effort
    // enrichment: the extracted node set is already durable and marked
    // extracted, its own per-validation failures are already contained
    // inside associativeLink, and a top-level failure here is logged,
    // never re-marking the source failed or duplicating nodes (a later
    // retry takes the hash-reuse path and creates nothing).
    // D4: at most 2 concurrent per-node jobs — with each job's max 3
    // concurrent validations, the aggregate in-flight bound is
    // 2 × 3 = 6 (structural, not timing-based). Per-node results are
    // collected by index so output order stays deterministic.
    let associativeEdges: GraphEdge[] = [];
    try {
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
      associativeEdges = perNodeLinks.flat();
    } catch (err) {
      console.warn(
        `[ingest] associative linking failed for source ${sourceId} (extraction already committed): ${err instanceof Error ? err.message : err}`,
      );
    }
    associativeEdges.push(...mentionEdges);
    return { nodes: createdNodes, extractedEdges, associativeEdges };
  } catch (err) {
    sourcesRepo.failExtraction(sourceId, owner);
    throw err;
  }
}

// Internal shared implementation: persist the source FIRST (12A order:
// persist -> acknowledge -> extract). A persistence failure propagates
// and the capture reports failure — nothing claims preservation (13).
async function ingestCore(
  h: DbHandle,
  deps: IngestDeps,
  rawText: string,
  spaceId: string,
  meta?: IngestMeta,
  ctx?: AppContext,
): Promise<IngestResult> {
  const sourcesRepo = new SourcesRepo(h, spaceId);
  const kind =
    meta?.sourceKind ??
    (meta?.channel === "telegram" ? "telegram" : meta?.channel === "chat" ? "chat" : "note");
  const citationClass = meta?.citationClass ?? "verbatim_typed";
  const { source } = sourcesRepo.persistText({
    kind,
    citationClass,
    text: rawText,
    occurredAt: meta?.occurredAt,
    idempotencyKey: meta?.idempotencyKey,
    title: meta?.sourceTitle,
  });
  return processSourceExtraction(h, deps, source.id, spaceId, meta, ctx);
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
