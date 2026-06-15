import type BetterSqlite3 from "better-sqlite3";

/**
 * HIGHEST-RISK / most isolated file: every raw vector SQL statement lives here.
 * Keeping sqlite-vec specifics behind this module means swapping to libsql
 * (native vectors) or an ANN index later does not touch any caller.
 */

export type RawDb = BetterSqlite3.Database;

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
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_nodes USING vec0(
      node_id INTEGER PRIMARY KEY,
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
  if (vec.length !== EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}. ` +
        `The vec_nodes column is fixed-width; re-embed if you changed models.`,
    );
  }
  // vec0 requires the INTEGER PRIMARY KEY bound as a BigInt via better-sqlite3.
  db.prepare(`INSERT OR REPLACE INTO vec_nodes(node_id, embedding) VALUES (?, ?)`).run(
    BigInt(nodeId),
    vecToBlob(vec),
  );
}

/** Read back a stored embedding as a Float32Array (e.g. to KNN from an existing node). */
export function getEmbedding(db: RawDb, nodeId: number): Float32Array | undefined {
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
 * K-nearest-neighbour search over stored embeddings. Returns hits ordered by
 * ascending distance (most similar first).
 */
export function knn(db: RawDb, queryVec: Float32Array, k: number): KnnHit[] {
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  const rows = db
    .prepare(
      `SELECT node_id AS nodeId, distance
       FROM vec_nodes
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(vecToBlob(queryVec), k) as { nodeId: number; distance: number }[];

  return rows.map((r) => ({
    nodeId: r.nodeId,
    distance: r.distance,
    similarity: cosineSimilarity(r.distance),
  }));
}
