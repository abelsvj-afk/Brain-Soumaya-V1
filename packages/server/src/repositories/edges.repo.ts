import { and, eq, inArray } from "drizzle-orm";
import type { GraphEdge, RelationshipType } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { edges, DEFAULT_SPACE, type EdgeRow } from "../db/schema.js";

/** Max edges returned per page by the cursor-paginated edge reads (D3). */
export const MAX_EDGES_PER_RESPONSE = 5000;

export interface EdgePage {
  edges: GraphEdge[];
  /** Last returned edge id, or null when the stream is complete. */
  nextCursor: number | null;
}

/**
 * Populate-path repair D3 (docs/repairs/galaxy-populate-render-stall.md):
 * database-safe id-set predicate evaluation. Binding every id as a separate
 * SQL parameter would exceed SQLite's bind-variable limit for large id sets,
 * so the id set is staged in a connection-scoped TEMP table filled via a
 * SINGLE bind:
 *   INSERT OR IGNORE INTO want_ids SELECT value FROM json_each(?)
 * (`OR IGNORE` makes duplicate ids safe — set semantics; JSON1 is compiled
 * into better-sqlite3's SQLite). The create/fill/query/drop sequence runs as
 * one synchronous block with NO `await` between steps (better-sqlite3 calls
 * are synchronous), so interleaved requests on a shared connection can never
 * observe another request's temp rows; the `finally` drop guarantees no
 * leakage even on error.
 */
function withWantIds(sqlite: DbHandle["sqlite"], ids: number[], fn: () => EdgePage): EdgePage {
  sqlite.exec("CREATE TEMP TABLE want_ids (id INTEGER PRIMARY KEY)");
  try {
    sqlite
      .prepare("INSERT OR IGNORE INTO want_ids SELECT value FROM json_each(?)")
      .run(JSON.stringify(ids));
    return fn();
  } finally {
    sqlite.exec("DROP TABLE want_ids");
  }
}

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
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  create(input: NewEdge): GraphEdge {
    const row = this.h.db
      .insert(edges)
      .values({
        spaceId: this.spaceId,
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
      .where(and(eq(edges.spaceId, this.spaceId), eq(edges.source, source), eq(edges.target, target)))
      .get();
    return row !== undefined;
  }

  all(): GraphEdge[] {
    return this.h.db
      .select()
      .from(edges)
      .where(eq(edges.spaceId, this.spaceId))
      .all()
      .map(toGraphEdge);
  }

  /** Edges where BOTH endpoints are in the given id set (subgraph edges). */
  within(ids: number[]): GraphEdge[] {
    if (ids.length === 0) return [];
    return this.h.db
      .select()
      .from(edges)
      .where(
        and(eq(edges.spaceId, this.spaceId), inArray(edges.source, ids), inArray(edges.target, ids)),
      )
      .all()
      .map(toGraphEdge);
  }

  /**
   * D3: id-ordered cursor page over space-scoped edges with BOTH endpoints in
   * the id set. Temp-table backed so arbitrarily large id sets never hit the
   * bind-variable limit. Backs `overview()`'s internal edge fetch.
   */
  withinIdsPaged(ids: number[], cursor: number | null): EdgePage {
    if (ids.length === 0) return { edges: [], nextCursor: null };
    return withWantIds(this.h.sqlite, ids, () =>
      this.edgePage(
        cursor,
        "AND e.source IN (SELECT id FROM want_ids) AND e.target IN (SELECT id FROM want_ids)",
      ),
    );
  }

  /**
   * D3: id-ordered cursor page over space-scoped edges INCIDENT TO any id in
   * the set (`source IN (…)` OR `target IN (…)`). Temp-table backed. Backs
   * `POST /api/graph/edges`. Edge ids are monotonic (AUTOINCREMENT, never
   * reused), so a `id > :cursor` stream to a null cursor returns every edge
   * satisfying the predicate present at the final page's read instant —
   * concurrent writes are caught by the stream itself.
   */
  incidentToIdsPaged(ids: number[], cursor: number | null): EdgePage {
    if (ids.length === 0) return { edges: [], nextCursor: null };
    return withWantIds(this.h.sqlite, ids, () =>
      this.edgePage(
        cursor,
        "AND (e.source IN (SELECT id FROM want_ids) OR e.target IN (SELECT id FROM want_ids))",
      ),
    );
  }

  /** One id-ordered page; fetches one extra row to determine `nextCursor`. */
  private edgePage(cursor: number | null, predicate: string): EdgePage {
    const startId = cursor ?? 0;
    const rows = this.h.sqlite
      .prepare(
        `SELECT e.id AS id, e.source AS source, e.target AS target,
                e.relationship AS relationship, e.weight AS weight,
                e.created_at AS createdAt
         FROM edges e
         WHERE e.space_id = ? AND e.id > ? ${predicate}
         ORDER BY e.id ASC
         LIMIT ${MAX_EDGES_PER_RESPONSE + 1}`,
      )
      .all(this.spaceId, startId) as {
      id: number;
      source: number;
      target: number;
      relationship: string;
      weight: number;
      createdAt: string;
    }[];
    let nextCursor: number | null = null;
    let page = rows;
    if (rows.length > MAX_EDGES_PER_RESPONSE) {
      page = rows.slice(0, MAX_EDGES_PER_RESPONSE);
      nextCursor = page.at(-1)?.id ?? null;
    }
    return {
      edges: page.map((r) => ({
        id: r.id,
        source: r.source,
        target: r.target,
        relationship: r.relationship as RelationshipType,
        weight: r.weight,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }
}
