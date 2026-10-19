/**
 * W1 temporal truth (wisdom layer): the supersession writer and temporal query
 * helpers. See docs/wisdom/w1-design-revision.md for the full design.
 *
 * Core principle: a memory can stop being current without its history being
 * rewritten, and a correction must not create false historical truth.
 *
 * - Corrections are APPEND-ONLY EVENTS in the `corrections` table — never row
 *   mutations. A mutable flag on the node row would corrupt historical as-of
 *   queries (an Oct 5 query would see a flag set on Oct 10).
 * - Every supersession shares ONE canonical UTC timestamp (`opTime`) across all
 *   writes in the transaction — no millisecond drift between superseded_at,
 *   recorded_at, and corrected_at.
 * - Cascade is DISABLED BY DEFAULT (space_meta.w1_cascade_enabled=false).
 */

import type { DbHandle } from "../db/client.js";
import type { RawDb } from "../db/vec.js";
import { upsertEmbedding } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import type { NodeRow, CorrectionRow } from "../db/schema.js";

/** The three correction types (design §2.2). */
export type CorrectionType = "factual_update" | "false_belief" | "preference_override";

/** Reason codes stored on the superseded row (denormalized convenience). */
export type SupersedeReason = "update" | "false_belief" | "user_override";

/** Origin of a new fact — only user-originated facts qualify for W1 auto-supersession. */
export type FactOrigin = "user_statement" | "user_correction" | "model_inference" | "tool_output" | "document";

export class SupersessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupersessionConflictError";
  }
}

export interface SupersedeInput {
  /** The node being superseded (must be current: superseded_at IS NULL). */
  oldNodeId: number;
  /** The replacement node (null for pure false-belief corrections with no replacement). */
  newNode: {
    label: string;
    type: string;
    content: string;
    /** When the fact became true in the real world (canonical ISO UTC). Null = unknown. */
    validFrom?: string | null;
    /** Embedding for vector search indexing (optional but recommended — without it
     * the replacement node is invisible to memorySearch). */
    embedding?: Float32Array;
  } | null;
  /** Which kind of correction this is. */
  correctionType: CorrectionType;
  /** Who made the correction. */
  correctedBy: "user" | "system";
  /** Content-free reason code (no memory text — see design §8). */
  reason?: string;
  /** Origin of the new fact — must be user_statement or user_correction for auto-supersession. */
  origin: FactOrigin;
  /** If true, the contradiction is ambiguous — do NOT supersede, log for W3 review. */
  ambiguous?: boolean;
  /** Set by the agent loop when the LLM proposes (advisory only — never auto-executes). */
  llmProposed?: boolean;
}

export interface SupersedeResult {
  oldNodeId: number;
  /** The new node's id, or null if no replacement was created. */
  newNodeId: number | null;
  correctionId: number;
  /** The single shared operation timestamp used for all writes. */
  opTime: string;
}

/** Space-meta key gating the dependent-fact cascade (default false = disabled). */
export const CASCADE_FLAG = "w1_cascade_enabled";

/**
 * Execute a supersession: atomically supersede the old row, insert the new row
 * (if any), record the correction event, and audit to agent_logs.
 *
 * Trigger contract (design §3.1):
 * - The LLM may PROPOSE (advisory only, logged as 'supersession_proposed').
 * - Code verifies: same space, user-origin fact, direct unambiguous contradiction.
 * - W1 auto-triggers: explicit user corrections + direct user-provided contradictions only.
 * - Ambiguous cases → logged as 'potential_contradiction' for W3, NOT superseded.
 */
export function supersede(
  h: DbHandle,
  spaceId: string,
  input: SupersedeInput,
): SupersedeResult {
  // --- Trigger contract validation (before touching the DB) ---
  if (input.ambiguous) {
    logPotentialContradiction(h, spaceId, input, "ambiguous_flag");
    throw new SupersessionConflictError(
      "Supersession blocked: ambiguous contradiction flagged for W3 review",
    );
  }
  // HARD BLOCK (design §3.1): an LLM proposal is ADVISORY ONLY and must NEVER
  // auto-execute — regardless of the stated origin. This check runs FIRST,
  // before any origin logic. Log for review, change nothing.
  if (input.llmProposed === true) {
    h.sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'supersession_proposed', ?, ?, 'deferred')`,
      )
      .run(
        spaceId,
        `supersession proposed old_node_id=${input.oldNodeId} origin=${input.origin} (advisory only)`,
        JSON.stringify({ old_id: input.oldNodeId, origin: input.origin }),
      );
    logPotentialContradiction(h, spaceId, input, "llm_proposal_advisory_only");
    throw new SupersessionConflictError(
      "Supersession blocked: LLM proposals are advisory only and never auto-execute",
    );
  }
  if (input.origin !== "user_statement" && input.origin !== "user_correction") {
    logPotentialContradiction(h, spaceId, input, "non_user_origin");
    throw new SupersessionConflictError(
      `Supersession blocked: origin '${input.origin}' does not qualify for W1 auto-supersession`,
    );
  }

  // Type 3 (preference override) that is NOT asserting the fact is untrue:
  // do not touch temporal columns at all. The caller must distinguish
  // "stop bringing up X" (silence — no supersession) from "X is no longer
  // true" (factual update). We treat a bare preference_override with no
  // replacement as a no-op that is logged, not a supersession.
  if (input.correctionType === "preference_override" && input.newNode === null) {
    h.sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'supersede_skipped', ?, ?, 'ok')`,
      )
      .run(
        spaceId,
        `preference_override old_node_id=${input.oldNodeId} reason=${input.reason ?? "none"} (no temporal change)`,
        JSON.stringify({ old_id: input.oldNodeId, reason: input.reason ?? null }),
      );
    throw new SupersessionConflictError(
      "Supersession skipped: preference_override without factual assertion does not touch temporal columns",
    );
  }

  // ONE canonical timestamp for the entire operation (design §5.1, Rev 4 B3).
  // All three temporal writes share this — no millisecond drift.
  const opTime = new Date().toISOString();

  const tx = h.sqlite.transaction((): SupersedeResult => {
    // 1. Verify the old node exists, belongs to this space, and is current.
    const old = h.sqlite
      .prepare(`SELECT id, space_id, superseded_at FROM nodes WHERE id = ? AND space_id = ?`)
      .get(input.oldNodeId, spaceId) as
      | { id: number; space_id: string; superseded_at: string | null }
      | undefined;
    if (!old) {
      throw new SupersessionConflictError(
        `Supersession blocked: node ${input.oldNodeId} not found in space`,
      );
    }
    if (old.superseded_at !== null) {
      throw new SupersessionConflictError(
        `Supersession blocked: node ${input.oldNodeId} is already superseded (concurrent update?)`,
      );
    }

    // 2. Insert the new row (if any). recorded_at is the shared opTime —
    // supplied explicitly, NEVER left to the DB default inside a supersession.
    let newNodeId: number | null = null;
    if (input.newNode) {
      const r = h.sqlite
        .prepare(
          `INSERT INTO nodes
             (space_id, label, type, content, valid_from, recorded_at, created_at, last_tended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          spaceId,
          input.newNode.label,
          input.newNode.type,
          input.newNode.content,
          input.newNode.validFrom ?? null,
          opTime,
          opTime,
          opTime,
        );
      newNodeId = Number(r.lastInsertRowid);
      // Index the replacement node for search (vector + FTS). Without this,
      // the new "current truth" is invisible to memorySearch and keywordSearch.
      // Embedding is optional — callers that don't have one (e.g. tests) get
      // FTS indexing at minimum.
      if (input.newNode.embedding) {
        upsertEmbedding(h.sqlite, newNodeId, input.newNode.embedding);
      }
      ftsUpsert(h.sqlite, newNodeId, input.newNode.label, input.newNode.content);
    }

    // 3. Supersede the old row (optimistic guard: superseded_at IS NULL).
    // valid_to is set ONLY for Type 1 (factual update). For Type 2
    // (false-belief), valid_from/valid_to stay NULL — no interval is fabricated.
    const validTo =
      input.correctionType === "factual_update" && input.newNode?.validFrom
        ? input.newNode.validFrom
        : null;
    const reason: SupersedeReason =
      input.correctionType === "false_belief"
        ? "false_belief"
        : input.correctionType === "preference_override"
          ? "user_override"
          : "update";
    const upd = h.sqlite
      .prepare(
        `UPDATE nodes
         SET valid_to = ?, superseded_at = ?, superseded_by = ?, supersede_reason = ?
         WHERE id = ? AND space_id = ? AND superseded_at IS NULL`,
      )
      .run(validTo, opTime, newNodeId, reason, input.oldNodeId, spaceId);
    if (upd.changes !== 1) {
      throw new SupersessionConflictError(
        `Supersession conflict: node ${input.oldNodeId} was modified concurrently`,
      );
    }

    // 4. Record the correction event (append-only). corrected_at is the shared opTime.
    const cr = h.sqlite
      .prepare(
        `INSERT INTO corrections
           (space_id, node_id, correction_type, corrected_at, corrected_by, reason, superseding_node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        spaceId,
        input.oldNodeId,
        input.correctionType,
        opTime,
        input.correctedBy,
        input.reason ?? null,
        newNodeId,
      );
    const correctionId = Number(cr.lastInsertRowid);

    // 5. Cascade (DISABLED BY DEFAULT — see CASCADE_FLAG). Only runs when the
    // space has explicitly opted in after edge semantics are verified.
    // Edges point dependent → dependency (source = dependent, target = dependency),
    // so dependents of X are found via WHERE target = X.
    let cascadeOn = false;
    try {
      const meta = h.sqlite
        .prepare(`SELECT w1_cascade_enabled FROM space_meta WHERE space_id = ?`)
        .get(spaceId) as { w1_cascade_enabled: number | null } | undefined;
      cascadeOn = meta?.w1_cascade_enabled === 1;
    } catch {
      cascadeOn = false; // column missing (very old volume) → disabled
    }
    if (cascadeOn && reason === "false_belief") {
      h.sqlite
        .prepare(
          `UPDATE nodes
           SET superseded_at = ?, superseded_by = ?, supersede_reason = 'false_belief'
           WHERE id IN (
             SELECT source FROM edges
             WHERE target = ? AND space_id = ? AND relationship IN ('depends_on', 'assumes')
           )
           AND space_id = ? AND superseded_at IS NULL`,
        )
        .run(opTime, newNodeId, input.oldNodeId, spaceId, spaceId);
    }

    // 6. Audit log (content-free: IDs and reason codes only — design §8).
    h.sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'supersede', ?, ?, 'ok')`,
      )
      .run(
        spaceId,
        `supersede node_id=${input.oldNodeId} reason=${reason} new_id=${newNodeId ?? "null"} op=${opTime}`,
        JSON.stringify({
          old_id: input.oldNodeId,
          new_id: newNodeId,
          reason,
          correction_id: correctionId,
          actor: input.correctedBy,
        }),
      );

    return { oldNodeId: input.oldNodeId, newNodeId, correctionId, opTime };
  });

  return tx();
}

function logPotentialContradiction(
  h: DbHandle,
  spaceId: string,
  input: SupersedeInput,
  why: string,
): void {
  h.sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', 'potential_contradiction', ?, ?, 'pending_w3')`,
    )
    .run(
      spaceId,
      `potential_contradiction old_node_id=${input.oldNodeId} why=${why}`,
      JSON.stringify({ old_id: input.oldNodeId, why }),
    );
}

/**
 * Was this node ever corrected as a false belief? DERIVED from the corrections
 * table — never stored on the row (design §2.4).
 */
export function isNeverTrue(sqlite: RawDb, nodeId: number): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1 FROM corrections WHERE node_id = ? AND correction_type = 'false_belief' LIMIT 1`,
    )
    .get(nodeId);
  return row !== undefined;
}

/** Full correction history for a node (for audit / history views). */
export function getCorrections(sqlite: RawDb, nodeId: number): CorrectionRow[] {
  return sqlite
    .prepare(`SELECT * FROM corrections WHERE node_id = ? ORDER BY corrected_at ASC, id ASC`)
    .all(nodeId) as CorrectionRow[];
}

/**
 * Contract 1 — as-of belief query: "what facts were believed current at time T?"
 * (design §2.3). No correction join. Superseded rows are correctly excluded.
 */
export function asOfBelief(sqlite: RawDb, spaceId: string, asOf: string): NodeRow[] {
  return sqlite
    .prepare(
      `SELECT n.* FROM nodes n
       WHERE n.space_id = ?
         AND n.deleted_at IS NULL
         AND n.recorded_at <= ?
         AND (n.superseded_at IS NULL OR n.superseded_at > ?)`,
    )
    .all(spaceId, asOf, asOf) as NodeRow[];
}

export interface NodeHistory {
  node: NodeRow;
  wasCorrectedAsFalse: boolean;
  /** Chronological correction timeline (ordered by corrected_at, then id). */
  correctionHistory: Array<{
    type: string;
    at: string;
    by: string;
    reason: string | null;
  }>;
}

/**
 * Contract 2 — correction-history query: "show me this node's full history,
 * including all corrections" (design §2.3). Uses EXISTS (not LEFT JOIN) so
 * multiple correction events can never duplicate the row. Ordering is enforced
 * in an inner subquery before json_group_array (Rev 6 fix).
 */
export function nodeHistory(
  sqlite: RawDb,
  spaceId: string,
  nodeId: number,
): NodeHistory | undefined {
  const row = sqlite
    .prepare(
      `SELECT n.*,
         EXISTS (
           SELECT 1 FROM corrections c
           WHERE c.node_id = n.id
             AND c.correction_type = 'false_belief'
         ) AS was_corrected_as_false,
         (SELECT json_group_array(
            json_object('type', ordered_c.correction_type, 'at', ordered_c.corrected_at,
                        'by', ordered_c.corrected_by, 'reason', ordered_c.reason)
          )
          FROM (
            SELECT c2.correction_type, c2.corrected_at, c2.corrected_by, c2.reason
            FROM corrections c2
            WHERE c2.node_id = n.id
            ORDER BY c2.corrected_at ASC, c2.id ASC
          ) AS ordered_c
         ) AS correction_history
       FROM nodes n
       WHERE n.space_id = ? AND n.id = ?`,
    )
    .get(spaceId, nodeId) as (NodeRow & { was_corrected_as_false: number; correction_history: string | null }) | undefined;
  if (!row) return undefined;
  return {
    node: row,
    wasCorrectedAsFalse: row.was_corrected_as_false === 1,
    correctionHistory: row.correction_history ? JSON.parse(row.correction_history) : [],
  };
}

/** Canonical timestamp regex (design §1.2): YYYY-MM-DDTHH:MM:SS.sssZ */
export const CANONICAL_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Normalize a legacy 'YYYY-MM-DD HH:MM:SS' timestamp to canonical form. */
export function normalizeTimestamp(ts: string): string {
  if (CANONICAL_TS.test(ts)) return ts;
  // Legacy SQLite CURRENT_TIMESTAMP format: 'YYYY-MM-DD HH:MM:SS'
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(ts);
  if (m) return `${m[1]}T${m[2]}.000Z`;
  // Fallback: parse and re-emit (handles offsets).
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable timestamp: ${ts}`);
  return d.toISOString();
}
