import type { RawDb } from "../db/vec.js";

/**
 * Multi-hop graph traversal via recursive CTEs. Both variants track depth and a
 * comma-delimited path, doing cycle detection with
 * `path NOT LIKE '%,' || next || ',%'` so dense/cyclic webs never loop forever.
 */

export interface HopResult {
  nodeId: number;
  depth: number;
  /** e.g. ",1,4,9," — the lineage from the start node to this node. */
  path: string;
}

/**
 * Undirected traversal: follows edges in both directions. Use for exploring the
 * interrelated web of ideas regardless of which way a link was authored.
 */
export function multiHopNeighbors(db: RawDb, startId: number, maxDepth: number): HopResult[] {
  return db
    .prepare(
      `WITH RECURSIVE walk(node_id, depth, path) AS (
         SELECT CAST(:start AS INTEGER), 0, ',' || CAST(:start AS INTEGER) || ','
         UNION ALL
         SELECT e.nbr, w.depth + 1, w.path || e.nbr || ','
         FROM walk w
         JOIN (
           SELECT source AS frm, target AS nbr FROM edges
           UNION ALL
           SELECT target AS frm, source AS nbr FROM edges
         ) e ON e.frm = w.node_id
         WHERE w.depth < :maxDepth
           AND w.path NOT LIKE '%,' || e.nbr || ',%'
       )
       SELECT node_id AS nodeId, depth, path FROM walk WHERE depth > 0
       ORDER BY depth, nodeId`,
    )
    .all({ start: startId, maxDepth }) as HopResult[];
}

/**
 * Directed traversal: follows source -> target only. Use for chronological /
 * DAG sequences where one thought builds on a preceding one.
 */
export function multiHopDirected(db: RawDb, startId: number, maxDepth: number): HopResult[] {
  return db
    .prepare(
      `WITH RECURSIVE walk(node_id, depth, path) AS (
         SELECT CAST(:start AS INTEGER), 0, ',' || CAST(:start AS INTEGER) || ','
         UNION ALL
         SELECT e.target, w.depth + 1, w.path || e.target || ','
         FROM walk w
         JOIN edges e ON e.source = w.node_id
         WHERE w.depth < :maxDepth
           AND w.path NOT LIKE '%,' || e.target || ',%'
       )
       SELECT node_id AS nodeId, depth, path FROM walk WHERE depth > 0
       ORDER BY depth, nodeId`,
    )
    .all({ start: startId, maxDepth }) as HopResult[];
}
