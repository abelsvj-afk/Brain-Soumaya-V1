import type { RawDb } from "./vec.js";

/**
 * Keyword retrieval beside the vector index (Level 2, B1). Embeddings miss exact
 * names/keywords — catastrophically so under the offline hash provider — so search
 * and chat seed retrieval fuse BM25 (FTS5) with knn via Reciprocal Rank Fusion.
 *
 * The FTS table mirrors nodes (rowid = node id). Sync is EXPLICIT (called from
 * NodesRepo on create/update/delete — no triggers, keeps WAL behavior simple),
 * with an idempotent boot-time backfill for volumes that predate the table.
 */

export function bootstrapFts(sqlite: RawDb): void {
  sqlite.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(label, content)`,
  );
  // Backfill once: any live node missing from the index (first boot after this
  // ships, or a crash between insert and sync).
  const missing = sqlite
    .prepare(
      `SELECT n.id, n.label, n.content FROM nodes n
       WHERE n.deleted_at IS NULL
         AND n.id NOT IN (SELECT rowid FROM nodes_fts)`,
    )
    .all() as { id: number; label: string; content: string }[];
  if (missing.length > 0) {
    const ins = sqlite.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, ?, ?)`);
    sqlite.transaction(() => {
      for (const m of missing) ins.run(m.id, m.label ?? "", m.content ?? "");
    })();
  }
}

export function ftsUpsert(sqlite: RawDb, id: number, label: string, content: string): void {
  sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(id);
  sqlite.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, ?, ?)`).run(id, label ?? "", content ?? "");
}

export function ftsDelete(sqlite: RawDb, id: number): void {
  sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(id);
}

/** Escape user input for FTS5 MATCH: quote each term (no query-syntax injection). */
function ftsQuery(raw: string): string {
  const terms = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  return terms.map((t) => `"${t}"`).join(" OR ");
}

/** BM25 keyword hits (space-scoped, live nodes only), best first.
 * W1: superseded rows are excluded in the WHERE clause (before LIMIT), so they
 * never occupy result slots. */
export function keywordSearch(
  sqlite: RawDb,
  spaceId: string,
  query: string,
  k: number,
): { nodeId: number; rank: number }[] {
  const match = ftsQuery(query);
  if (!match) return [];
  try {
    const rows = sqlite
      .prepare(
        `SELECT f.rowid AS nodeId FROM nodes_fts f
         JOIN nodes n ON n.id = f.rowid
         WHERE nodes_fts MATCH ? AND n.space_id = ? AND n.deleted_at IS NULL AND n.status != 'archived'
           AND n.superseded_at IS NULL
         ORDER BY bm25(nodes_fts) LIMIT ?`,
      )
      .all(match, spaceId, k) as { nodeId: number }[];
    return rows.map((r, i) => ({ nodeId: r.nodeId, rank: i + 1 }));
  } catch {
    return []; // malformed query — vector side still answers
  }
}

/** Tag hits for search (REG-118 / BR-07): the FTS index is label+content only,
 * so a tag query found nothing on the Search/palette surface while Hubs search
 * matched member tags. Tags are a JSON array string; a LIKE on the raw token
 * is the same approach evalLens uses. Terms come from the same tokenizer as
 * the BM25 query (≥2 chars, max 12); matching is by substring, so a query
 * for "paris" finds the tag "paris-trip". Live, current nodes only, with the
 * same eligibility as keywordSearch — ineligible nodes never occupy fusion
 * slots. Terms cannot contain LIKE wildcards (the tokenizer strips them). */
export function tagSearch(
  sqlite: RawDb,
  spaceId: string,
  query: string,
  k: number,
): { nodeId: number; rank: number }[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 12);
  if (terms.length === 0) return [];
  const ors = terms.map(() => `n.tags LIKE ?`).join(" OR ");
  const rows = sqlite
    .prepare(
      `SELECT n.id AS nodeId FROM nodes n
       WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.status != 'archived'
         AND n.superseded_at IS NULL AND (${ors})
       ORDER BY n.id DESC LIMIT ?`,
    )
    .all(spaceId, ...terms.map((t) => `%${t}%`), k) as { nodeId: number }[];
  return rows.map((r, i) => ({ nodeId: r.nodeId, rank: i + 1 }));
}

/**
 * Reciprocal Rank Fusion of the vector and keyword result lists (k=60, the
 * standard constant): score = Σ 1/(60 + rank). Deterministic, tune-free.
 */
export function fuseRrf(
  vector: { nodeId: number }[],
  keyword: { nodeId: number }[],
  k: number,
): number[] {
  const score = new Map<number, number>();
  const add = (list: { nodeId: number }[]) => {
    list.forEach((r, i) => score.set(r.nodeId, (score.get(r.nodeId) ?? 0) + 1 / (60 + i + 1)));
  };
  add(vector);
  add(keyword);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}
