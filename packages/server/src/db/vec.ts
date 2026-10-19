import type BetterSqlite3 from "better-sqlite3";

/**
 * HIGHEST-RISK / most isolated file: every raw vector SQL statement lives here.
 * Keeping sqlite-vec specifics behind this module means swapping to libsql
 * (native vectors) or an ANN index later does not touch any caller.
 */

export type RawDb = BetterSqlite3.Database;

const dbVectorSupport = new WeakMap<RawDb, boolean>();

export function setVectorEnabled(db: RawDb, enabled: boolean): void {
  dbVectorSupport.set(db, enabled);
}

export function isVectorEnabled(db: RawDb): boolean {
  return dbVectorSupport.get(db) ?? true;
}

/**
 * Single source of truth for the embedding dimension. This is LOCKED to the
 * active embedding model: the vec0 column width is fixed, so changing the model
 * (e.g. MiniLM-384 -> gte-base-768) requires recreating vec_nodes and
 * re-embedding every node. Defaults to MiniLM (384).
 */
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 384);

/**
 * Create the vec0 virtual table with a cosine distance metric. We store
 * already-L2-normalized vectors, so cosine distance is well-behaved and
 * similarity = 1 - distance.
 */
export function bootstrapVec(db: RawDb): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
      node_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}] distance_metric=cosine
    );`,
  );
  // AI Companion: knowledge-document chunk vectors + instruction-profile vectors
  // (the latter powers intent routing of 'auto' profiles). Same vec0 shape/rules.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_docs USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}] distance_metric=cosine
    );`,
  );
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_profiles USING vec0(
      profile_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}] distance_metric=cosine
    );`,
  );
  // Vision 2.0 Journeys: title+description embeddings power capture-time auto-link/
  // suggestion of related Journeys. Same vec0 shape/rules as the tables above.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_journeys USING vec0(
      journey_id INTEGER PRIMARY KEY,
      embedding float[${EMBED_DIM}] distance_metric=cosine
    );`,
  );
}

/** Serialize a Float32Array as the raw little-endian byte BLOB sqlite-vec expects. */
function vecToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Insert or replace a node's embedding. The caller is responsible for
 * L2-normalizing the vector (transformers.js does this with `normalize: true`).
 */
export function upsertEmbedding(db: RawDb, nodeId: number, vec: Float32Array): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  if (vec.length !== EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}. ` +
        `The vec_nodes column is fixed-width; re-embed if you changed models.`,
    );
  }
  // vec0 requires the INTEGER PRIMARY KEY bound as a BigInt via better-sqlite3.
  // NOTE: sqlite-vec's vec0 does NOT honour `INSERT OR REPLACE` (it raises a
  // UNIQUE constraint on re-insert), so re-embedding an existing node — which the
  // autonomous research/merging jobs do when they grow a memory — must delete the
  // old row first, then insert. Wrapped so the pair is atomic.
  const id = BigInt(nodeId);
  const blob = vecToBlob(vec);
  db.transaction(() => {
    db.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(id);
    db.prepare(`INSERT INTO vec_nodes(node_id, embedding) VALUES (?, ?)`).run(id, blob);
  })();
}

/** Remove a node's stored embedding (used when deleting a memory). */
export function deleteEmbedding(db: RawDb, nodeId: number): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  db.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(nodeId));
}

/** Read back a stored embedding as a Float32Array (e.g. to KNN from an existing node). */
export function getEmbedding(db: RawDb, nodeId: number): Float32Array | undefined {
  if (!isVectorEnabled(db)) {
    return undefined;
  }
  const row = db.prepare(`SELECT embedding FROM vec_nodes WHERE node_id = ?`).get(BigInt(nodeId)) as
    | { embedding: Buffer }
    | undefined;
  if (!row) return undefined;
  const buf = row.embedding;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const arr = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < arr.length; i++) arr[i] = view.getFloat32(i * 4, true);
  return arr;
}

export interface KnnHit {
  nodeId: number;
  distance: number;
  /** Cosine similarity in [-1, 1]; for normalized vectors = 1 - distance. */
  similarity: number;
}

/** Cosine similarity from a cosine distance (normalized vectors). */
export const cosineSimilarity = (distance: number): number => 1 - distance;

/**
 * W1 temporal truth: KNN search that excludes superseded nodes via iterative
 * over-fetch with adaptive widening (design §6.2, Rev 4).
 *
 * The problem: superseded candidates can crowd out valid results if filtering
 * happens only after a bounded candidate selection. This loop keeps fetching
 * batches until k valid results are found, the pool is exhausted, or the
 * safety bound is hit.
 *
 * Exhaustion contract: ONLY an empty page means "no more candidates." A short
 * non-empty page is NOT proof of exhaustion — the loop continues.
 *
 * Safety bound honesty: MAX_CANDIDATES = 2000 is a circuit breaker, NOT a
 * completeness guarantee. On bound-hit: return partial results + emit a
 * queryable vecSearchTruncated diagnostic. Do NOT claim completeness.
 */
export const MAX_CANDIDATES = 2000;

export interface ScoredHit extends KnnHit {}

export function vecSearchCurrent(
  db: RawDb,
  spaceId: string,
  queryVec: Float32Array,
  k: number,
  logDiagnostic?: (event: string, data: Record<string, unknown>) => void,
  /**
   * Injectable page fetcher for tests. Returns the next page of
   * { nodeId, distance } candidates (already offset — NOT a cumulative window).
   * Defaults to the real vec0 windowed query.
   */
  fetchPage?: (fetchSize: number, offset: number) => { nodeId: number; distance: number }[],
): ScoredHit[] {
  if (!isVectorEnabled(db)) {
    return [];
  }
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  const valid: ScoredHit[] = [];
  let offset = 0;
  let fetchSize = Math.min(500, Math.max(k * 6, k + 40));
  let truncated = false;

  const lookup = db.prepare(
    `SELECT space_id AS s, deleted_at AS d, status AS st, superseded_at AS sup
     FROM nodes WHERE id = ?`,
  );
  const knnStmt = db.prepare(
    `SELECT node_id AS nodeId, distance
     FROM vec_nodes
     WHERE embedding MATCH ? AND k = ?
     ORDER BY distance`,
  );

  // Default page fetcher: vec0 KNN has no OFFSET, so emulate paging by growing
  // the fetch window and slicing off the already-seen prefix.
  const doFetchPage =
    fetchPage ??
    ((fetchSize: number, offset: number) => {
      const windowed = knnStmt.all(vecToBlob(queryVec), fetchSize + offset) as {
        nodeId: number;
        distance: number;
      }[];
      return windowed.slice(offset);
    });

  while (valid.length < k) {
    if (offset >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const page = doFetchPage(fetchSize, offset);

    // EXHAUSTION CONTRACT: only an empty page means "no more candidates."
    // A short non-empty page is NOT exhaustion — continue to the next offset.
    if (page.length === 0) break;

    let batchValid = 0;
    for (const h of page) {
      const row = lookup.get(h.nodeId) as
        | { s: string; d: string | null; st: string | null; sup: string | null }
        | undefined;
      if (
        row !== undefined &&
        row.s === spaceId &&
        row.d === null &&
        row.st !== "archived" &&
        row.sup === null // W1: exclude superseded
      ) {
        valid.push({ nodeId: h.nodeId, distance: h.distance, similarity: cosineSimilarity(h.distance) });
        batchValid++;
        if (valid.length >= k) break;
      }
    }

    offset += page.length;

    // Adaptive widening: if this batch was mostly superseded, double the fetch.
    if (page.length > 0 && batchValid < page.length / 2) {
      fetchSize = Math.min(fetchSize * 2, Math.max(1, MAX_CANDIDATES - offset));
    }
  }

  if (truncated && logDiagnostic) {
    logDiagnostic("vecSearchTruncated", {
      space_id: spaceId,
      found: valid.length,
      wanted: k,
      scanned: offset,
    });
  }

  return valid.slice(0, k);
}

/**
 * K-nearest-neighbour search over stored embeddings. Returns hits ordered by
 * ascending distance (most similar first).
 *
 * Multi-tenancy: vec0 KNN is global, so when a `spaceId` is given we over-fetch
 * and filter to that space (and drop any soft-deleted nodes) using the relational
 * `nodes` table — keeping every space's similarity search fully private.
 */
export function knn(db: RawDb, queryVec: Float32Array, k: number, spaceId?: string): KnnHit[] {
  if (!isVectorEnabled(db)) {
    return [];
  }
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  // When scoping to a space we can't know how many of the global nearest belong
  // to it, so pull a generous surplus and trim after filtering.
  const want = spaceId ? Math.min(500, Math.max(k * 6, k + 40)) : k;
  const rows = db
    .prepare(
      `SELECT node_id AS nodeId, distance
       FROM vec_nodes
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(vecToBlob(queryVec), want) as { nodeId: number; distance: number }[];

  let hits = rows.map((r) => ({
    nodeId: r.nodeId,
    distance: r.distance,
    similarity: cosineSimilarity(r.distance),
  }));

  if (spaceId) {
    const lookup = db.prepare(
      `SELECT space_id AS s, deleted_at AS d, status AS st FROM nodes WHERE id = ?`,
    );
    hits = hits
      .filter((h) => {
        const row = lookup.get(h.nodeId) as { s: string; d: string | null; st: string | null } | undefined;
        // Space-scoped, not deleted, and not archived (archived rests out of retrieval).
        return row !== undefined && row.s === spaceId && row.d === null && row.st !== "archived";
      })
      .slice(0, k);
  }
  return hits;
}

// --- AI Companion vector stores (mirror vec_nodes exactly) ---

/** Generic delete-then-insert upsert into one of the companion vec0 tables. */
function upsertVec(db: RawDb, table: string, pk: string, id: number, vec: Float32Array): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  if (vec.length !== EMBED_DIM) {
    throw new Error(`Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}.`);
  }
  const bid = BigInt(id);
  const blob = vecToBlob(vec);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE ${pk} = ?`).run(bid);
    db.prepare(`INSERT INTO ${table}(${pk}, embedding) VALUES (?, ?)`).run(bid, blob);
  })();
}

export function upsertDocEmbedding(db: RawDb, chunkId: number, vec: Float32Array): void {
  upsertVec(db, "vec_docs", "chunk_id", chunkId, vec);
}
export function deleteDocEmbeddings(db: RawDb, chunkIds: number[]): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  const stmt = db.prepare(`DELETE FROM vec_docs WHERE chunk_id = ?`);
  db.transaction(() => {
    for (const id of chunkIds) stmt.run(BigInt(id));
  })();
}

export function upsertProfileEmbedding(db: RawDb, profileId: number, vec: Float32Array): void {
  upsertVec(db, "vec_profiles", "profile_id", profileId, vec);
}
export function deleteProfileEmbedding(db: RawDb, profileId: number): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  db.prepare(`DELETE FROM vec_profiles WHERE profile_id = ?`).run(BigInt(profileId));
}

export interface DocKnnHit {
  chunkId: number;
  distance: number;
  similarity: number;
}

/** KNN over knowledge-doc chunks, space-filtered via the relational knowledge_chunks table. */
export function knnDocs(db: RawDb, queryVec: Float32Array, k: number, spaceId?: string): DocKnnHit[] {
  if (!isVectorEnabled(db)) {
    return [];
  }
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  const want = spaceId ? Math.min(500, Math.max(k * 6, k + 40)) : k;
  const rows = db
    .prepare(
      `SELECT chunk_id AS chunkId, distance FROM vec_docs
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(vecToBlob(queryVec), want) as { chunkId: number; distance: number }[];
  let hits = rows.map((r) => ({ chunkId: r.chunkId, distance: r.distance, similarity: cosineSimilarity(r.distance) }));
  if (spaceId) {
    const lookup = db.prepare(`SELECT space_id AS s FROM knowledge_chunks WHERE id = ?`);
    hits = hits
      .filter((h) => (lookup.get(h.chunkId) as { s: string } | undefined)?.s === spaceId)
      .slice(0, k);
  }
  return hits;
}

export interface ProfileKnnHit {
  profileId: number;
  distance: number;
  similarity: number;
}

/** KNN over instruction-profile vectors (intent routing), space-filtered. */
export function knnProfiles(db: RawDb, queryVec: Float32Array, k: number, spaceId?: string): ProfileKnnHit[] {
  if (!isVectorEnabled(db)) {
    return [];
  }
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  const want = spaceId ? Math.min(200, Math.max(k * 6, k + 20)) : k;
  const rows = db
    .prepare(
      `SELECT profile_id AS profileId, distance FROM vec_profiles
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(vecToBlob(queryVec), want) as { profileId: number; distance: number }[];
  let hits = rows.map((r) => ({ profileId: r.profileId, distance: r.distance, similarity: cosineSimilarity(r.distance) }));
  if (spaceId) {
    const lookup = db.prepare(`SELECT space_id AS s FROM instruction_profiles WHERE id = ?`);
    hits = hits
      .filter((h) => (lookup.get(h.profileId) as { s: string } | undefined)?.s === spaceId)
      .slice(0, k);
  }
  return hits;
}

export function upsertJourneyEmbedding(db: RawDb, journeyId: number, vec: Float32Array): void {
  upsertVec(db, "vec_journeys", "journey_id", journeyId, vec);
}
export function deleteJourneyEmbedding(db: RawDb, journeyId: number): void {
  if (!isVectorEnabled(db)) {
    return;
  }
  db.prepare(`DELETE FROM vec_journeys WHERE journey_id = ?`).run(BigInt(journeyId));
}

export interface JourneyKnnHit {
  journeyId: number;
  distance: number;
  similarity: number;
}

/** KNN over Journey title+description vectors (capture-time auto-link/suggestion), space-filtered. */
export function knnJourneys(db: RawDb, queryVec: Float32Array, k: number, spaceId?: string): JourneyKnnHit[] {
  if (!isVectorEnabled(db)) {
    return [];
  }
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  const want = spaceId ? Math.min(200, Math.max(k * 6, k + 20)) : k;
  const rows = db
    .prepare(
      `SELECT journey_id AS journeyId, distance FROM vec_journeys
       WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
    )
    .all(vecToBlob(queryVec), want) as { journeyId: number; distance: number }[];
  let hits = rows.map((r) => ({ journeyId: r.journeyId, distance: r.distance, similarity: cosineSimilarity(r.distance) }));
  if (spaceId) {
    const lookup = db.prepare(`SELECT space_id AS s FROM journeys WHERE id = ?`);
    hits = hits
      .filter((h) => (lookup.get(h.journeyId) as { s: string } | undefined)?.s === spaceId)
      .slice(0, k);
  }
  return hits;
}
