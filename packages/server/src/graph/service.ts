import { type GraphData, type GraphEdge, type GraphNode, deriveMass, classify, entropyFrom, DURABLE_COGNITIVE_KINDS } from "@brain/shared";
import { memoryStrength } from "../analysis/review.js";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { heuristicImportance } from "../llm/heuristic.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import { knn } from "../db/vec.js";
import { keywordSearch, fuseRrf } from "../db/fts.js";
import { multiHopNeighbors } from "./traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";

export interface SearchHit extends GraphNode {
  similarity: number;
}

/**
 * Populate-path repair D3 (docs/repairs/galaxy-populate-render-stall.md):
 * per-request caps for the id-set APIs. Over-cap requests get an explicit
 * 400 — never silent truncation.
 */
/** Max `includeIds` accepted by one overview request. */
export const INCLUDE_IDS_CAP = 200;
/** Max union ids accepted by one `POST /api/graph/edges` request body. */
export const MAX_UNION_IDS = 50000;

/**
 * Read-side graph queries. Designed for heavy dumping: the default view is
 * BOUNDED (never ships all N nodes), and deeper exploration pulls neighborhoods
 * on demand.
 */
export class GraphService {
  private readonly nodes: NodesRepo;
  private readonly edges: EdgesRepo;
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {
    this.nodes = new NodesRepo(h, spaceId);
    this.edges = new EdgesRepo(h, spaceId);
  }

  /**
   * Attach celestial physics to nodes: global connection degree, derived mass,
   * a size hint (`val`), and a body class. Done on read so it always reflects
   * the current edge set without denormalizing into the nodes table.
   */
  private enrich(nodes: GraphNode[]): GraphNode[] {
    if (nodes.length === 0) return nodes;
    const ids = nodes.map((n) => n.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.h.sqlite
      .prepare(
        `SELECT node_id, COUNT(*) AS deg FROM (
           SELECT source AS node_id FROM edges WHERE space_id = ?
           UNION ALL
           SELECT target AS node_id FROM edges WHERE space_id = ?
         ) WHERE node_id IN (${placeholders})
         GROUP BY node_id`,
      )
      .all(this.spaceId, this.spaceId, ...ids) as { node_id: number; deg: number }[];
    const degreeById = new Map(rows.map((r) => [r.node_id, r.deg]));

    // Reinforcement: how many latent insights each memory appears in. This is the
    // signal that "feeds" a memory's slow growth over time — the AI surfacing a
    // hidden connection makes the memory matter more. (node ids are space-unique
    // and insights are space-scoped, so this never crosses brains.)
    const insightRows = this.h.sqlite
      .prepare(
        `SELECT node_id, COUNT(*) AS cnt FROM (
           SELECT node_a AS node_id FROM insights WHERE space_id = ?
           UNION ALL
           SELECT node_b AS node_id FROM insights WHERE space_id = ?
         ) WHERE node_id IN (${placeholders})
         GROUP BY node_id`,
      )
      .all(this.spaceId, this.spaceId, ...ids) as { node_id: number; cnt: number }[];
    const insightById = new Map(insightRows.map((r) => [r.node_id, r.cnt]));

    // Spaced-repetition strength: needs each memory's last-reviewed + interval so the
    // star can dim toward its review point (NEURO_ALIGNMENT #1). Fetched here so it's
    // always live on read, never denormalized into the table.
    const reviewRows = this.h.sqlite
      .prepare(
        `SELECT id, created_at, last_reviewed_at, review_interval_days
         FROM nodes WHERE space_id = ? AND id IN (${placeholders})`,
      )
      .all(this.spaceId, ...ids) as { id: number; created_at: string; last_reviewed_at: string | null; review_interval_days: number | null }[];
    const reviewById = new Map(reviewRows.map((r) => [r.id, r]));

    const now = Date.now();
    const daysSince = (ts?: string): number => {
      const ms = Date.parse(ts?.includes("T") ? ts : `${(ts ?? "").replace(" ", "T")}Z`);
      return Number.isNaN(ms) ? 0 : Math.max(0, (now - ms) / 86_400_000);
    };
    return nodes.map((n) => {
      const degree = degreeById.get(n.id) ?? 0;
      const reinforcement = insightById.get(n.id) ?? 0;
      const ageDays = daysSince(n.createdAt);
      const mass = deriveMass({
        importance: n.importance,
        degree,
        emotionalWeight: n.emotionalWeight,
        ageDays,
        reinforcement,
      });
      // Entropy: days since last tended (fall back to creation), resisted by degree.
      // Action items and constellation hubs never "cool".
      const days = daysSince(n.lastTendedAt ?? n.createdAt);
      const entropy =
        n.kind === "action" ||
        n.kind === "moc" ||
        n.kind === "belief" ||
        (n.kind != null && DURABLE_COGNITIVE_KINDS.has(n.kind as never))
          ? 0
          : entropyFrom(days, degree);
      // A constellation hub's degree IS its member count (every edge is a member).
      const memberCount = n.kind === "moc" ? degree : undefined;
      // Only real memories carry a review-decay dimming; cognitive nodes / hubs / actions don't.
      const isMemory = n.kind == null || n.kind === "memory";
      const rv = reviewById.get(n.id);
      const reviewStrength = isMemory && rv ? memoryStrength(rv, now) : undefined;
      return { ...n, degree, mass, val: mass, celestial: classify(mass), entropy, memberCount, reviewStrength };
    });
  }

  /** Whole graph — fine for small datasets, used as a fast path. */
  full(): GraphData {
    return { nodes: this.enrich(this.nodes.all()), links: this.edges.all() };
  }

  /**
   * Bounded overview: the `limit` highest-degree hubs (ties broken by recency),
   * plus all edges among them. Keeps the galaxy legible as the brain grows.
   *
   * D3: honors explicit `includeIds` — the union of (a) top-`limit` by degree
   * and (b) `byIds(includeIds)`, which is space-scoped and skips unknown ids,
   * so missing ids are skipped, duplicates deduped, and cross-space ids can
   * never leak in. The internal edge fetch uses the temp-table strategy
   * (see edges.repo.ts) and is cursor-bounded at MAX_EDGES_PER_RESPONSE;
   * `nextEdgeCursor` is the additive "more to fetch" signal (null = complete).
   */
  overview(limit = 300, includeIds: number[] = []): GraphData & { nextEdgeCursor: number | null } {
    const rows = this.h.sqlite
      .prepare(
        `SELECT n.id AS id
         FROM nodes n
         LEFT JOIN (
           SELECT node_id, COUNT(*) AS deg FROM (
             SELECT source AS node_id FROM edges WHERE space_id = ?
             UNION ALL
             SELECT target AS node_id FROM edges WHERE space_id = ?
           ) GROUP BY node_id
         ) d ON d.node_id = n.id
         WHERE n.space_id = ? AND n.deleted_at IS NULL
         ORDER BY COALESCE(d.deg, 0) DESC, n.id DESC
         LIMIT ?`,
      )
      .all(this.spaceId, this.spaceId, this.spaceId, limit) as { id: number }[];
    const unionIds = [...new Set([...rows.map((r) => r.id), ...includeIds])];
    const nodes = this.enrich(this.nodes.byIds(unionIds));
    const { edges, nextCursor } = this.edges.withinIdsPaged(unionIds, null);
    return { nodes, links: edges, nextEdgeCursor: nextCursor };
  }

  /**
   * D3: space-scoped edges incident to any of the given node ids, as an
   * id-ordered cursor page. Backs `POST /api/graph/edges`. Ids outside this
   * space simply match no edges (edges are space-scoped), so cross-space ids
   * can never leak edges.
   */
  incidentEdges(
    ids: number[],
    cursor: number | null,
  ): { edges: GraphEdge[]; nextCursor: number | null } {
    return this.edges.incidentToIdsPaged(ids, cursor);
  }

  /** Multi-hop neighborhood subgraph around a node (lazy expansion). */
  neighborhood(startId: number, depth = 2): GraphData {
    // Only traverse from a node this space actually owns (edges never cross
    // spaces, but this guards a forged start id from peeking elsewhere).
    if (!this.nodes.getById(startId)) return { nodes: [], links: [] };
    const hops = multiHopNeighbors(this.h.sqlite, startId, depth);
    const ids = Array.from(new Set([startId, ...hops.map((hp) => hp.nodeId)]));
    return { nodes: this.enrich(this.nodes.byIds(ids)), links: this.edges.within(ids) };
  }

  /**
   * HYBRID search: semantic KNN fused with BM25 keyword hits via Reciprocal Rank
   * Fusion. Embeddings alone missed exact names/keywords (badly so under the
   * offline hash provider); BM25 alone misses paraphrase. Fused order wins.
   */
  async search(embeddings: EmbeddingProvider, query: string, k = 10): Promise<SearchHit[]> {
    const vec = await embeddings.embed(query);
    const vecHits = knn(this.h.sqlite, vec, k, this.spaceId);
    const kwHits = keywordSearch(this.h.sqlite, this.spaceId, query, k);
    const simById = new Map(vecHits.map((h) => [h.nodeId, h.similarity]));
    const ordered = fuseRrf(vecHits, kwHits, k);
    const byId = new Map(this.nodes.byIds(ordered).map((n) => [n.id, n]));
    return ordered
      .map((id) => {
        const node = byId.get(id);
        // Keyword-only hits carry no cosine — surface them with a neutral score.
        return node ? { ...node, similarity: simById.get(id) ?? 0.5 } : undefined;
      })
      .filter((x): x is SearchHit => x !== undefined);
  }

  getNode(id: number): GraphNode | undefined {
    const n = this.nodes.getById(id);
    return n ? this.enrich([n])[0] : undefined;
  }

  /**
   * Set a node's importance manually (0..1), or pass null to recompute it
   * offline from the content via the heuristic ("reset to auto" — no API needed).
   * Returns the enriched node so the caller sees the new mass/celestial class.
   */
  setImportance(id: number, importance: number | null): GraphNode | undefined {
    let value = importance;
    if (value === null) {
      const existing = this.nodes.getById(id);
      if (!existing) return undefined;
      value = heuristicImportance(existing.content);
    }
    const updated = this.nodes.updateImportance(id, value);
    return updated ? this.enrich([updated])[0] : undefined;
  }

  /** Permanently delete a memory (node + embedding + edges + insights). */
  deleteNode(id: number): boolean {
    return this.nodes.delete(id);
  }
}
