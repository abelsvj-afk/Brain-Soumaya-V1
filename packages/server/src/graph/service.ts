import type { GraphData, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import { knn } from "../db/vec.js";
import { multiHopNeighbors } from "./traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";

export interface SearchHit extends GraphNode {
  similarity: number;
}

/**
 * Read-side graph queries. Designed for heavy dumping: the default view is
 * BOUNDED (never ships all N nodes), and deeper exploration pulls neighborhoods
 * on demand.
 */
export class GraphService {
  private readonly nodes: NodesRepo;
  private readonly edges: EdgesRepo;
  constructor(private readonly h: DbHandle) {
    this.nodes = new NodesRepo(h);
    this.edges = new EdgesRepo(h);
  }

  /** Whole graph — fine for small datasets, used as a fast path. */
  full(): GraphData {
    return { nodes: this.nodes.all(), links: this.edges.all() };
  }

  /**
   * Bounded overview: the `limit` highest-degree hubs (ties broken by recency),
   * plus all edges among them. Keeps the galaxy legible as the brain grows.
   */
  overview(limit = 300): GraphData {
    if (this.nodes.count() <= limit) return this.full();
    const rows = this.h.sqlite
      .prepare(
        `SELECT n.id AS id
         FROM nodes n
         LEFT JOIN (
           SELECT node_id, COUNT(*) AS deg FROM (
             SELECT source AS node_id FROM edges
             UNION ALL
             SELECT target AS node_id FROM edges
           ) GROUP BY node_id
         ) d ON d.node_id = n.id
         ORDER BY COALESCE(d.deg, 0) DESC, n.id DESC
         LIMIT ?`,
      )
      .all(limit) as { id: number }[];
    const ids = rows.map((r) => r.id);
    return { nodes: this.nodes.byIds(ids), links: this.edges.within(ids) };
  }

  /** Multi-hop neighborhood subgraph around a node (lazy expansion). */
  neighborhood(startId: number, depth = 2): GraphData {
    const hops = multiHopNeighbors(this.h.sqlite, startId, depth);
    const ids = Array.from(new Set([startId, ...hops.map((hp) => hp.nodeId)]));
    return { nodes: this.nodes.byIds(ids), links: this.edges.within(ids) };
  }

  /** Semantic search: embed query -> KNN -> nodes with similarity scores. */
  async search(embeddings: EmbeddingProvider, query: string, k = 10): Promise<SearchHit[]> {
    const vec = await embeddings.embed(query);
    const hits = knn(this.h.sqlite, vec, k);
    const byId = new Map(this.nodes.byIds(hits.map((hp) => hp.nodeId)).map((n) => [n.id, n]));
    return hits
      .map((hit) => {
        const node = byId.get(hit.nodeId);
        return node ? { ...node, similarity: hit.similarity } : undefined;
      })
      .filter((x): x is SearchHit => x !== undefined);
  }

  getNode(id: number): GraphNode | undefined {
    return this.nodes.getById(id);
  }
}
