import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Graph JSON export (IM-129c). The only pre-existing export facility is the
 * client-side Markdown export in Browse (one note / a folder / the whole brain
 * rendered as prose) — there was no machine-readable export of the graph
 * itself. This repo assembles one space's full graph (live nodes + the edges
 * between them) as plain JSON. Space-scoped like every repo; soft-deleted
 * nodes are excluded, and an edge is only included when BOTH endpoints are
 * in the exported node set (the dangling-link lesson from the galaxy fix:
 * never ship a reference to something the payload itself doesn't contain).
 */
export interface GraphExport {
  exportedAt: string;
  spaceId: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

export class GraphExportRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  exportGraph(): GraphExport {
    const nodes = this.h.sqlite
      .prepare(
        `SELECT id, label, celestial_title AS celestialTitle, type, content,
                emotional_weight AS emotionalWeight, importance, color, origin,
                kind, progress, tags, created_at AS createdAt,
                occurred_at AS occurredAt, last_tended_at AS lastTendedAt
         FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    const ids = new Set(nodes.map((n) => n.id as number));
    const allEdges = this.h.sqlite
      .prepare(
        `SELECT id, source, target, relationship, weight, created_at AS createdAt
         FROM edges
         WHERE space_id = ?
         ORDER BY id ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    const edges = allEdges.filter(
      (e) => ids.has(e.source as number) && ids.has(e.target as number),
    );
    return {
      exportedAt: new Date().toISOString(),
      spaceId: this.spaceId,
      nodes,
      edges,
    };
  }
}
