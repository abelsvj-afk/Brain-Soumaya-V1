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
 * The source id is an explicit argument of the apply call — and that
 * is the known gap (fix round 2, audit P1): no forget_requests field
 * names a source, so the approved request does NOT authorize the
 * specific sourceId (see the comment on forgetSourceByRequest). The
 * V1 schema bound was the four new tables; binding needs a new
 * target_source_id column + approval flow — a schema/design decision
 * for the owner, not taken in this round. Until it lands, this helper
 * MUST have no production caller.
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
  /** Episodes tombstoned because their summary/detail quoted the source. */
  episodesTombstoned: number[];
  /** Derived/cache/draft rows deleted by the scrub pass below. */
  derivedRowsScrubbed: number;
}

const FORGET_TOMBSTONE = "[forgotten at the owner's request]";

/** Minimum verbatim span length used by scrub verification. Shorter
 *  overlaps are common words, not quotable spans. */
export const SCRUB_SPAN_CHARS = 24;

/**
 * Does `content` contain a verbatim span of any forgotten chunk text?
 * Checks whole chunk texts and EVERY SCRUB_SPAN_CHARS window of them
 * (fix round 2, audit P1: the previous stride-8 sampling could miss a
 * quote starting at an unaligned offset, certifying it "scrub-verified
 * clean"). Every-window checking is exact: a 24-char span of forgotten
 * text appears in `content` iff some window equals it. Bounded cost —
 * chunks are at most SOURCE_CHUNK_CHARS (1000) characters and node
 * content is short, so the window scan is small and terminates.
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
    for (let i = 0; i + SCRUB_SPAN_CHARS <= t.length; i++) {
      if (content.includes(t.slice(i, i + SCRUB_SPAN_CHARS))) return true;
    }
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
  // FIX ROUND 2 (audit P1) — INVESTIGATED, NOT FIXABLE WITHOUT A
  // SCHEMA/DESIGN CHANGE: this function does NOT bind the approved
  // request to the specific sourceId. The forget_requests schema
  // (db/schemaSql.ts + agent/episodic.ts applyForgetRequest) names
  // its target ONLY as target_episode_id / target_node_id /
  // scope_episode_ids / scope_node_ids / scope_topics — no field can
  // name a source. target_query is nulled at approval (B4 Rev 4) and
  // is free text, not an id; scope_node_ids names NODES (repurposing
  // it would conflate the episodic forget flow and still would not
  // name the source — an unrelated approved request whose scope
  // happened to list a linked node could authorize the wrong source).
  // Binding genuinely requires a new target_source_id (or
  // scope_source_ids) column + a creation/approval flow that resolves
  // it — a schema change to an existing table and a design decision,
  // outside this fix round's authorization. So: this helper MUST NOT
  // gain a production caller until that binding lands, and the merge
  // remains blocked on it unless the owner explicitly defers it with
  // a guarantee no route/tool can call it. See the gates checklist
  // (Gate 2 forget-path box, still open) and the fix-round report.
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

    // --- Derived-representation scrub (fix round 2, audit P1: the
    // erasure guarantee is broader than the implementation). The node
    // loop above handles nodes LINKED to the source; a forgotten quote
    // can also live in unlinked nodes and in every other persisted
    // representation the E2 inventory names (design §18.1). This pass
    // walks that inventory inside the same transaction:
    //   * episodes quoting the source: summary tombstoned (the
    //     applyForgetRequest treatment), enrichments + FTS + vec rows
    //     deleted. Episodes are owner captures, so they are tombstoned,
    //     never silently deleted. (Detail lives in enrichments/FTS.)
    //   * unlinked nodes quoting the source: tombstoned like dirty
    //     multi-origin nodes (a node may never keep forgotten words by
    //     hiding inside a summary, linked or not).
    //   * derived/operational rows quoting the source (insights,
    //     enrichments, daily logs, working memory, inquiries, chapters,
    //     drafts, agent logs, attachments, journeys, lore,
    //     contradictions, run errors, correction reasons, inbox items,
    //     pending tool approvals, candidate-link reasons, codex
    //     discoveries): deleted — they are regenerable derivations,
    //     transient state, or convention-violating copies, not owner
    //     captures. agent_logs deletes lift the append-only trigger
    //     exactly like deleteSpace does; journeys also lose their
    //     vec_journeys rows.
    //   Deliberately NOT scrubbed, with reasons: knowledge_docs/chunks
    //   (independent imports — V1's §18.4 no-touch decision; the same
    //   words there are a separate copy, not a derivation of the
    //   source), user_model/user_persona/instruction_profiles
    //   (owner-authored claims/instructions with evidence semantics and
    //   no source->model evidence linkage in V1 — known limitation,
    //   recorded in the fix-round report), tts_audio_cache (rows are
    //   keyed by content hash over voice+model+text, so a forgotten
    //   source's audio cannot be located by text — disclosed residual,
    //   like the Fly snapshot residue in §18.1; rows age out under the
    //   500-row cap), fin_* (out of scope by design, E2).
    const episodesTombstoned: number[] = [];
    let derivedRowsScrubbed = 0;
    const tableExists = (t: string): boolean => {
      const r = sqlite
        .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
        .get(t) as { x: number } | undefined;
      return !!r;
    };
    const rowHasSpan = (texts: (string | null | undefined)[]): boolean => {
      const joined = texts.filter((t) => t != null && t !== "").join("\n");
      return joined.length > 0 && containsVerbatimSpan(joined, chunkTexts);
    };

    // Episodes: tombstone + drop enrichments/FTS/vec. (There is no
    // episodes.detail column in the bootstrap/migration DDL — "detail"
    // lives in episode_enrichments.detail and in episodes_fts, both
    // deleted here; the capture column is summary.)
    if (tableExists("episodes")) {
      const epRows = sqlite
        .prepare(`SELECT id, summary FROM episodes WHERE space_id = ? AND forgotten_at IS NULL`)
        .all(spaceId) as { id: number; summary: string | null }[];
      for (const ep of epRows) {
        if (!rowHasSpan([ep.summary])) continue;
        sqlite
          .prepare(
            `UPDATE episodes SET summary = ?, forgotten_at = ?, enrichment_lease = NULL
             WHERE id = ? AND space_id = ?`,
          )
          .run(FORGET_TOMBSTONE, now, ep.id, spaceId);
        if (tableExists("episode_enrichments")) {
          sqlite.prepare(`DELETE FROM episode_enrichments WHERE episode_id = ? AND space_id = ?`).run(ep.id, spaceId);
        }
        try { sqlite.prepare(`DELETE FROM episodes_fts WHERE rowid = ?`).run(ep.id); } catch { /* FTS absent */ }
        if (isVectorEnabled(sqlite)) {
          try { sqlite.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`).run(BigInt(ep.id)); } catch { /* vec absent */ }
        }
        episodesTombstoned.push(ep.id);
      }
    }

    // Unlinked nodes quoting the source: tombstone (linked nodes were
    // already decided by the loop above; clean survivors match no span).
    const linkedSet = new Set(linkedNodeIds);
    const liveNodes = sqlite
      .prepare(`SELECT id, content FROM nodes WHERE space_id = ? AND deleted_at IS NULL`)
      .all(spaceId) as { id: number; content: string }[];
    for (const n of liveNodes) {
      if (linkedSet.has(n.id)) continue;
      if (!containsVerbatimSpan(n.content, chunkTexts)) continue;
      sqlite
        .prepare(
          `UPDATE nodes SET content = ?, deleted_at = COALESCE(deleted_at, ?)
           WHERE id = ? AND space_id = ?`,
        )
        .run(FORGET_TOMBSTONE, now, n.id, spaceId);
      try { sqlite.prepare(`DELETE FROM vec_nodes WHERE node_id = ?`).run(BigInt(n.id)); } catch { /* vec absent */ }
      sqlite.prepare(`DELETE FROM nodes_fts WHERE rowid = ?`).run(n.id);
      nodesTombstoned.push(n.id);
    }

    // Derived/operational rows quoting the source: delete.
    const deleteScrub: { table: string; textCols: string[] }[] = [
      { table: "insights", textCols: ["text"] },
      { table: "daily_logs", textCols: ["content"] },
      { table: "working_memory", textCols: ["text"] },
      { table: "inquiries", textCols: ["question"] },
      { table: "timeline_chapters", textCols: ["title", "summary"] },
      { table: "attachments", textCols: ["filename", "data"] },
      { table: "lore", textCols: ["text"] },
      { table: "contradictions", textCols: ["resolution"] },
      { table: "consolidation_runs", textCols: ["error"] },
      { table: "corrections", textCols: ["reason"] },
      { table: "inbox_notifications", textCols: ["text"] },
      { table: "episode_enrichments", textCols: ["detail"] },
      { table: "candidate_links", textCols: ["reason"] },
      { table: "codex_discoveries", textCols: ["title", "lore"] },
      { table: "tool_approvals", textCols: ["args_json"] },
      { table: "journeys", textCols: ["title", "description"] },
      { table: "agent_logs", textCols: ["description", "targets"] },
    ];
    // agent_logs is guarded by the append-only BEFORE DELETE trigger:
    // lift it for exactly this delete (the deleteSpace precedent) and
    // restore it verbatim before commit. DDL is transactional, so a
    // failed scrub rolls the DROP back too.
    const agentLogsTrigger = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_logs_no_delete'`)
      .get() as { sql: string } | undefined;
    if (agentLogsTrigger) sqlite.exec(`DROP TRIGGER agent_logs_no_delete`);
    try {
      for (const { table, textCols } of deleteScrub) {
        if (!tableExists(table)) continue;
        const cols = ["id", ...textCols].join(", ");
        const rows = sqlite
          .prepare(`SELECT ${cols} FROM ${table} WHERE space_id = ?`)
          .all(spaceId) as Record<string, unknown>[];
        for (const row of rows) {
          const texts = textCols.map((c) => row[c] as string | null | undefined);
          if (!rowHasSpan(texts)) continue;
          sqlite.prepare(`DELETE FROM ${table} WHERE id = ? AND space_id = ?`).run(row.id as number, spaceId);
          derivedRowsScrubbed++;
          if (table === "journeys" && isVectorEnabled(sqlite)) {
            try { sqlite.prepare(`DELETE FROM vec_journeys WHERE journey_id = ?`).run(BigInt(row.id as number)); } catch { /* vec absent */ }
          }
        }
      }
      // Telegram drafts are keyed by (space_id, chat_id), not id.
      if (tableExists("telegram_note_drafts")) {
        const drafts = sqlite
          .prepare(`SELECT chat_id, text FROM telegram_note_drafts WHERE space_id = ?`)
          .all(spaceId) as { chat_id: number; text: string }[];
        for (const d of drafts) {
          if (!containsVerbatimSpan(d.text, chunkTexts)) continue;
          sqlite.prepare(`DELETE FROM telegram_note_drafts WHERE space_id = ? AND chat_id = ?`).run(spaceId, d.chat_id);
          derivedRowsScrubbed++;
        }
      }
    } finally {
      if (agentLogsTrigger) sqlite.exec(agentLogsTrigger.sql);
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
      episodesTombstoned,
      derivedRowsScrubbed,
    };
  });
  return tx();
}
