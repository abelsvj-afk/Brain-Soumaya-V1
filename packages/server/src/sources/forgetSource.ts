import type { DbHandle } from "../db/client.js";
import { isVectorEnabled } from "../db/vec.js";
import { SourcesRepo } from "../repositories/sources.repo.js";

/**
 * Verbatim-Recall V1 — source forgetting (design section 18.1).
 *
 * Immutability governs EDITING; forgetting governs EXISTENCE, and it
 * goes through the repo's existing door only: a forget_requests row
 * with requested_by='user' and status='approved' (the INV-DEL-1
 * pattern in agent/episodic.ts). This module invents no second
 * deletion door — without an approved user request it refuses, and
 * ordinary node deletion never reaches here (it deactivates links;
 * sources are untouched by node events, section 12D).
 *
 * The source id is an explicit argument of the apply call rather than
 * a new forget_requests column: the V1 schema bound is the four new
 * tables, and the approved request row remains the authorization.
 *
 * Dependency rule (18.1): a node is erased with a forgotten source
 * ONLY if that source was its sole remaining origin. If other active
 * origin/support links remain, the node survives but is scrub-
 * verified: its content is searched for verbatim spans of the
 * forgotten chunk text. Found and not regenerable -> tombstoned.
 * Unverifiable-clean -> tombstoned. (No regeneration-from-sources
 * machinery exists in V1, so a dirty scrub always tombstones.)
 *
 * Everything runs in ONE transaction, mirroring applyForgetRequest.
 */

export interface SourceForgetResult {
  requestId: number;
  sourceId: number;
  chunksErased: number;
  correctionsErased: number;
  linksErased: number;
  /** Nodes erased because this source was their sole remaining origin. */
  nodesErased: number[];
  /** Multi-origin nodes that survived scrub verification clean. */
  nodesSurvivedClean: number[];
  /** Multi-origin nodes tombstoned because forgotten text remained. */
  nodesTombstoned: number[];
}

const FORGET_TOMBSTONE = "[forgotten at the owner's request]";

/** Minimum verbatim span length used by scrub verification. Shorter
 *  overlaps are common words, not quotable spans. */
export const SCRUB_SPAN_CHARS = 24;

/**
 * Does `content` contain a verbatim span of any forgotten chunk text?
 * Checks whole chunk texts and every SCRUB_SPAN_CHARS window of them.
 * The empty/short-text case: a chunk shorter than the span is checked
 * whole (it IS a complete owner utterance).
 */
export function containsVerbatimSpan(content: string, chunkTexts: string[]): boolean {
  if (!content) return false;
  for (const t of chunkTexts) {
    if (!t) continue;
    if (t.length <= SCRUB_SPAN_CHARS) {
      if (t.length >= 4 && content.includes(t)) return true;
      continue;
    }
    for (let i = 0; i + SCRUB_SPAN_CHARS <= t.length; i += 8) {
      if (content.includes(t.slice(i, i + SCRUB_SPAN_CHARS))) return true;
    }
    // Always check the tail window too (the stride can skip it).
    if (content.includes(t.slice(t.length - SCRUB_SPAN_CHARS))) return true;
  }
  return false;
}

interface ForgetRequestRow {
  id: number;
  space_id: string;
  requested_by: string;
  status: string;
}

export function forgetSourceByRequest(
  h: DbHandle,
  requestId: number,
  sourceId: number,
): SourceForgetResult {
  const sqlite = h.sqlite;
  const req = sqlite
    .prepare(`SELECT id, space_id, requested_by, status FROM forget_requests WHERE id = ?`)
    .get(requestId) as ForgetRequestRow | undefined;
  if (!req) throw new Error(`forget request ${requestId} does not exist`);
  if (req.requested_by !== "user") throw new Error("forget requests must be user-requested");
  if (req.status !== "approved") {
    throw new Error(`forget request ${requestId} has status '${req.status}' — only 'approved' requests can be applied`);
  }
  const spaceId = req.space_id;
  const repo = new SourcesRepo(h, spaceId);
  const source = repo.getById(sourceId);
  if (!source) throw new Error(`source ${sourceId} does not exist in this space`);
  const now = new Date().toISOString();

  const tx = sqlite.transaction((): SourceForgetResult => {
    const chunks = repo.chunksOf(sourceId);
    const chunkIds = chunks.map((c) => c.id);
    const chunkTexts = chunks.map((c) => c.text);

    // Nodes linked to this source (any role, active) BEFORE links go.
    const linkedNodeIds = [
      ...new Set(repo.activeLinksForSource(sourceId).map((l) => l.nodeId)),
    ];

    // The source's own derived rows: vec rows, FTS rows, chunks,
    // corrections, links — all erased.
    if (isVectorEnabled(sqlite)) {
      const delVec = sqlite.prepare(`DELETE FROM vec_source_chunks WHERE chunk_id = ?`);
      for (const cid of chunkIds) {
        try { delVec.run(BigInt(cid)); } catch { /* vec table absent */ }
      }
    }
    const delFts = sqlite.prepare(`DELETE FROM sources_fts WHERE rowid = ?`);
    for (const cid of chunkIds) delFts.run(cid);

    const linksErased = sqlite
      .prepare(`DELETE FROM node_sources WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    const correctionsErased = sqlite
      .prepare(`DELETE FROM source_corrections WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    const chunksErased = sqlite
      .prepare(`DELETE FROM source_chunks WHERE space_id = ? AND source_id = ?`)
      .run(spaceId, sourceId).changes;
    sqlite.prepare(`DELETE FROM sources WHERE id = ? AND space_id = ?`).run(sourceId, spaceId);

    // Dependency-aware node handling.
    const nodesErased: number[] = [];
    const nodesSurvivedClean: number[] = [];
    const nodesTombstoned: number[] = [];
    for (const nodeId of linkedNodeIds) {
      const remaining = sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM node_sources
           WHERE space_id = ? AND node_id = ? AND active = 1 AND role IN ('origin', 'support')`,
        )
        .get(spaceId, nodeId) as { c: number };
      const nodeRow = sqlite
        .prepare(`SELECT content FROM nodes WHERE id = ? AND space_id = ?`)
        .get(nodeId, spaceId) as { content: string } | undefined;
      if (!nodeRow) continue;
      if (remaining.c === 0) {
        // Sole remaining origin forgotten: the node is erased with it —
        // row, embedding, FTS, edges, and its other (inactive/derived)
        // links, mirroring the episodic enrichment deletion discipline.
        try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(nodeId)); } catch { /* vec absent */ }
        sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(nodeId);
        sqlite.prepare(`DELETE FROM edges WHERE space_id = ? AND (source = ? OR target = ?)`).run(spaceId, nodeId, nodeId);
        sqlite.prepare(`DELETE FROM node_sources WHERE space_id = ? AND node_id = ?`).run(spaceId, nodeId);
        sqlite.prepare(`DELETE FROM nodes WHERE id = ? AND space_id = ?`).run(nodeId, spaceId);
        nodesErased.push(nodeId);
        continue;
      }
      // Other origins remain: survival requires a clean scrub.
      if (containsVerbatimSpan(nodeRow.content, chunkTexts)) {
        sqlite
          .prepare(
            `UPDATE nodes SET content = ?, deleted_at = COALESCE(deleted_at, ?)
             WHERE id = ? AND space_id = ?`,
          )
          .run(FORGET_TOMBSTONE, now, nodeId, spaceId);
        try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(nodeId)); } catch { /* vec absent */ }
        sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(nodeId);
        nodesTombstoned.push(nodeId);
      } else {
        nodesSurvivedClean.push(nodeId);
      }
    }

    // Mark the authorizing request applied (content-free audit, as in
    // applyForgetRequest) when it carried no other scope; a request
    // already applied by the episodic path is left as-is.
    sqlite
      .prepare(
        `UPDATE forget_requests SET status = 'applied', applied_at = COALESCE(applied_at, ?), target_query = NULL
         WHERE id = ? AND status = 'approved'`,
      )
      .run(now, requestId);
    sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'forget_source_applied', ?, ?, 'ok')`,
      )
      .run(
        spaceId,
        `forget_source_applied request_id=${requestId} source_id=${sourceId} nodes_erased=${nodesErased.length} nodes_tombstoned=${nodesTombstoned.length}`,
        JSON.stringify({ request_id: requestId, source_id: sourceId }),
      );

    return {
      requestId,
      sourceId,
      chunksErased,
      correctionsErased,
      linksErased,
      nodesErased,
      nodesSurvivedClean,
      nodesTombstoned,
    };
  });
  return tx();
}
