import { and, eq, inArray } from "drizzle-orm";
import type { GraphEdge, RelationshipType } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { edges, type EdgeRow } from "../db/schema.js";

export interface NewEdge {
  source: number;
  target: number;
  relationship: RelationshipType;
  weight?: number;
}

function toGraphEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    relationship: row.relationship as RelationshipType,
    weight: row.weight,
    createdAt: row.createdAt,
  };
}

export class EdgesRepo {
  constructor(private readonly h: DbHandle) {}

  create(input: NewEdge): GraphEdge {
    const row = this.h.db
      .insert(edges)
      .values({
        source: input.source,
        target: input.target,
        relationship: input.relationship,
        weight: input.weight ?? 1,
      })
      .returning()
      .get();
    return toGraphEdge(row);
  }

  /** True if a directed edge source -> target already exists (dedupe guard). */
  exists(source: number, target: number): boolean {
    const row = this.h.db
      .select({ id: edges.id })
      .from(edges)
      .where(and(eq(edges.source, source), eq(edges.target, target)))
      .get();
    return row !== undefined;
  }

  all(): GraphEdge[] {
    return this.h.db.select().from(edges).all().map(toGraphEdge);
  }

  /** Edges where BOTH endpoints are in the given id set (subgraph edges). */
  within(ids: number[]): GraphEdge[] {
    if (ids.length === 0) return [];
    return this.h.db
      .select()
      .from(edges)
      .where(and(inArray(edges.source, ids), inArray(edges.target, ids)))
      .all()
      .map(toGraphEdge);
  }
}
