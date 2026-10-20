/**
 * W3 reconciliation sweep (design Rev 11 §5.6, §8.6; implementation
 * plan Milestone 4, Phase E). Phase D of the nightly run — after
 * sweeps (A), adjudication (B), and distillation (C), before finalize.
 * Records filed here enter adjudication in the NEXT run's Phase B,
 * never the same run: discovery and adjudication are separate nights'
 * work.
 *
 * What this phase does: it systematically re-compares a bounded slice
 * of current consolidated beliefs against the current stated set, in
 * two passes:
 *
 *   1. Deterministic pass (zero LLM) — the Tier 1 coverage predicate
 *      (same slot + topic-label overlap; both sides current, so their
 *      open validity intervals overlap by construction) and Tier 2's
 *      deterministic rules (W2's detectContradiction), per pair.
 *      A detected contradiction files a typed contradictions record
 *      (reported_by='reconciliation', report_ref='recon:<entry_id>').
 *      A pair the rules leave inconclusive whose deterministic
 *      similarity is at/above w3_recon_sim_threshold is NOT cleared —
 *      it is queued in w3_recon_semantic_queue for the semantic pass.
 *      Below-threshold inconclusive pairs are cleared with no action.
 *   2. Semantic pass — the durable queue drains oldest-first, at most
 *      min(w3_recon_semantic_budget, remaining w3_llm_budget) pairwise
 *      LLM judgments. 'contradiction' files; 'ambiguous' files too
 *      (fail-closed, the insertion guard's asymmetry); a clean verdict
 *      deletes the entry; a throwing judge leaves the entry queued
 *      with attempts+1, and at 3 failed attempts the entry is deleted
 *      with a 'recon_semantic_failed' audit row — an honest terminal
 *      state, not a silent pass.
 *
 * DETECTION ENVELOPE — the exact scope of the guarantee (§5.6). This
 * phase covers exactly two classes: (a) deterministically recognizable
 * contradictions, and (b) semantic contradictions in pairs whose
 * deterministic similarity is at/above w3_recon_sim_threshold. A
 * genuinely contradictory pair that no deterministic rule recognizes
 * AND whose similarity scores below the threshold is never queued,
 * never judged, and never filed by this phase — not tonight, not on
 * any later pass. The threshold (default 0.75) is an explicit
 * cost/recall tradeoff the operator may tune; no log line or comment
 * in this module claims broader coverage. Detection is also EVENTUAL,
 * not immediate: an in-envelope false negative is discovered within
 * K = max(ceil(C / w3_recon_batch), ceil(P / w3_recon_pairs_budget))
 * successful Phase D runs over a stable set (C = current consolidated
 * count, P = C × stated count), plus a queue-drain lag of up to
 * ceil(Q / w3_recon_semantic_budget) runs for ambiguous-zone pairs.
 * Failed runs do not advance the cursor; new beliefs enter at the
 * front of the newest-first ordering and can extend detection time
 * for the oldest beliefs beyond K.
 *
 * DISCOVERY ONLY. This module's writes are contradiction filings,
 * semantic-queue rows, the w3_recon_progress cursor/marker, and
 * content-free agent_logs rows. It never writes the user_model table
 * (T-C75 pins byte-identity across a filing run), never calls the
 * §6.1 mutation union — filing a discovery record is not a belief
 * mutation — and never holds a write transaction across an LLM call:
 * the deterministic unit (filings + queue inserts + cursor/marker)
 * commits in ONE transaction at the end of the deterministic pass,
 * and each semantic judgment runs on plain reads before its own
 * short resolve transaction.
 *
 * Filing follows §5.6's own idempotency contract, which is stricter
 * than adjudicate.ts's fileContradiction helper (that helper dedups
 * OPEN records for Phase B's candidate path; §5.6 additionally treats
 * resolved/stated_conflict records as known, and re-files a moot-only
 * pair with a fresh 'recon:<id>:r<k>' ref and reopens_id set).
 */
import type { DbHandle } from "../../db/client.js";
import type { RawDb } from "../../db/vec.js";
import {
  detectContradiction,
  tokenJaccard,
  type LlmJudge,
  type Slot,
} from "../userModel.js";
import type { ConsolidationRunContext } from "./boundary.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ReconRow {
  id: number;
  slot: string;
  content: string;
  topic_labels: string;
  valid_at: string;
  confidence: number;
}

interface StatedCandidate extends ReconRow {
  labels: string[];
  /** Topic-label overlap count with the belief under examination. */
  overlap: number;
}

/**
 * The deterministic similarity scorer — injectable so tests can count
 * examinations (T-C74/T-C80: every pair examination invokes it exactly
 * once) and record pair keys. Default: W2's token Jaccard, the same
 * normalized score Tier 2's deterministic pass computes (§5.6).
 */
export type ReconSimilarityScorer = (
  consolidated: ReconRow,
  stated: ReconRow,
) => number;

export interface ReconciliationOptions {
  scorer?: ReconSimilarityScorer;
}

export interface ReconciliationSummary {
  /** Consolidated beliefs whose pair iteration ran (incl. partial). */
  beliefsExamined: number;
  /** (belief, stated) pairs examined in the deterministic pass. */
  pairsExamined: number;
  /** Contradiction records created by the deterministic pass. */
  filedDeterministic: number;
  /** Pairs inserted into the semantic queue this run. */
  queued: number;
  /** Pairwise judgments spent in the semantic drain. */
  semanticJudged: number;
  /** Drain judgments that filed a contradiction record. */
  semanticFiled: number;
  /** Queue entries deleted because a side is no longer current. */
  semanticStaleDropped: number;
  /** Entries deleted after 3 failed judge attempts (audited). */
  semanticExhausted: number;
  /** True when this run completed the pass (cursor reset to NULL). */
  passCompleted: boolean;
}

interface ReconConfig {
  batch: number;
  pairsBudget: number;
  semanticBudget: number;
  simThreshold: number;
  statedSetVersion: number;
}

interface ProgressRow {
  cursor_valid_at: string | null;
  cursor_id: number | null;
  partial_valid_at: string | null;
  partial_id: number | null;
  partial_stated_overlap: number | null;
  partial_stated_id: number | null;
  partial_stated_version: number | null;
  last_pass_completed_at: string | null;
}

/** A pending deterministic filing, resolved inside the slice-end txn. */
interface IntendedFiling {
  statedId: number;
  consolidatedId: number;
  category: string;
}

interface IntendedQueueInsert {
  consolidatedId: number;
  statedId: number;
  similarity: number;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function parseLabels(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function auditLog(
  sqlite: RawDb,
  spaceId: string,
  action: string,
  description: string,
  targets: Record<string, unknown>,
  result: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', ?, ?, ?, ?)`,
    )
    .run(spaceId, action, description, JSON.stringify(targets), result);
}

function readConfig(sqlite: RawDb, spaceId: string): ReconConfig {
  sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
  const row = sqlite
    .prepare(
      `SELECT w3_recon_batch, w3_recon_pairs_budget, w3_recon_semantic_budget,
              w3_recon_sim_threshold, stated_set_version
       FROM space_meta WHERE space_id = ?`,
    )
    .get(spaceId) as {
    w3_recon_batch: number | null;
    w3_recon_pairs_budget: number | null;
    w3_recon_semantic_budget: number | null;
    w3_recon_sim_threshold: number | null;
    stated_set_version: number | null;
  };
  return {
    batch: row.w3_recon_batch ?? 200,
    pairsBudget: row.w3_recon_pairs_budget ?? 2000,
    semanticBudget: row.w3_recon_semantic_budget ?? 10,
    simThreshold: row.w3_recon_sim_threshold ?? 0.75,
    statedSetVersion: row.stated_set_version ?? 0,
  };
}

function readProgress(sqlite: RawDb, spaceId: string): ProgressRow | null {
  const row = sqlite
    .prepare(`SELECT * FROM w3_recon_progress WHERE space_id = ?`)
    .get(spaceId) as ProgressRow | undefined;
  return row ?? null;
}

function currentRow(
  sqlite: RawDb,
  spaceId: string,
  id: number,
  origin: "consolidated" | "stated",
): ReconRow | null {
  const row = sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, valid_at, confidence FROM user_model
       WHERE space_id = ? AND id = ? AND origin = ? AND invalid_at IS NULL`,
    )
    .get(spaceId, id, origin) as ReconRow | undefined;
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Slice selection (§5.6 — two prepared paths, never nullable params)  */
/* ------------------------------------------------------------------ */

/**
 * The Path 1 / Path 2 slice selection, exported for T-C79. Path 1
 * (fresh pass) is used when there is no progress row or its cursor
 * columns are NULL — the query OMITS the cursor predicate entirely,
 * because in SQLite `(valid_at, id) < (NULL, NULL)` is unknown, not
 * true: a parameterized single query would return zero rows and a
 * fresh pass would silently examine nothing. Path 2 (resume) runs
 * only with both cursor parameters NOT NULL, strictly below the last
 * fully processed belief.
 */
export function selectReconSlice(
  sqlite: RawDb,
  spaceId: string,
  limit: number,
): { path: 1 | 2; beliefs: ReconRow[] } {
  const progress = readProgress(sqlite, spaceId);
  const cols = `id, slot, content, topic_labels, valid_at, confidence`;
  if (
    progress === null ||
    progress.cursor_valid_at === null ||
    progress.cursor_id === null
  ) {
    const beliefs = sqlite
      .prepare(
        `SELECT ${cols} FROM user_model
         WHERE space_id = ? AND origin = 'consolidated' AND invalid_at IS NULL
         ORDER BY valid_at DESC, id DESC
         LIMIT ?`,
      )
      .all(spaceId, limit) as ReconRow[];
    return { path: 1, beliefs };
  }
  const beliefs = sqlite
    .prepare(
      `SELECT ${cols} FROM user_model
       WHERE space_id = ? AND origin = 'consolidated' AND invalid_at IS NULL
         AND (valid_at, id) < (?, ?)
       ORDER BY valid_at DESC, id DESC
       LIMIT ?`,
    )
    .all(spaceId, progress.cursor_valid_at, progress.cursor_id, limit) as ReconRow[];
  return { path: 2, beliefs };
}

/** Fill selection below an explicit in-run cursor (partial completion). */
function selectBelowCursor(
  sqlite: RawDb,
  spaceId: string,
  cursor: { valid_at: string; id: number },
  limit: number,
): ReconRow[] {
  return sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, valid_at, confidence FROM user_model
       WHERE space_id = ? AND origin = 'consolidated' AND invalid_at IS NULL
         AND (valid_at, id) < (?, ?)
       ORDER BY valid_at DESC, id DESC
       LIMIT ?`,
    )
    .all(spaceId, cursor.valid_at, cursor.id, limit) as ReconRow[];
}

/* ------------------------------------------------------------------ */
/* §5.6 filing (directional skip-if-known + moot re-file)             */
/* ------------------------------------------------------------------ */

const SKIP_STATES = ["pending", "claimed", "unresolved", "resolved", "stated_conflict"];

/**
 * File one reconciliation discovery record inside the caller's
 * transaction, applying §5.6's idempotency check for the directional
 * pair (old side = stated belief, new side = consolidated belief):
 * any record in a non-moot state → skip (the pair is known or already
 * adjudicated); only moot records → re-file with
 * report_ref='recon:<entry_id>:r<k>' (k = prior moot filings + 1) and
 * reopens_id pointing at the latest moot record; no record → file
 * with report_ref='recon:<entry_id>'. Returns true when a row was
 * inserted. The (pair, report_ref) UNIQUE index makes even a raced
 * double-file of the same ref impossible.
 */
function fileReconContradiction(
  sqlite: RawDb,
  spaceId: string,
  filing: IntendedFiling,
): boolean {
  const existing = sqlite
    .prepare(
      `SELECT id, state FROM contradictions
       WHERE space_id = ? AND domain = 'user_model' AND old_id = ? AND new_id = ?
       ORDER BY id ASC`,
    )
    .all(spaceId, filing.statedId, filing.consolidatedId) as {
    id: number;
    state: string;
  }[];
  if (existing.some((r) => SKIP_STATES.includes(r.state))) return false;
  const moots = existing.filter((r) => r.state === "moot");
  let reportRef = `recon:${filing.consolidatedId}`;
  let reopensId: number | null = null;
  if (moots.length > 0) {
    reportRef = `recon:${filing.consolidatedId}:r${moots.length + 1}`;
    reopensId = moots[moots.length - 1]!.id;
  }
  const r = sqlite
    .prepare(
      `INSERT INTO contradictions
         (space_id, domain, old_kind, old_id, new_kind, new_id, category,
          reported_by, report_ref, reopens_id, state, attempts)
       VALUES (?, 'user_model', 'user_model_entry', ?, 'user_model_entry', ?, ?,
               'reconciliation', ?, ?, 'pending', 0)`,
    )
    .run(
      spaceId,
      filing.statedId,
      filing.consolidatedId,
      filing.category,
      reportRef,
      reopensId,
    );
  return r.changes === 1;
}

/** Whether the directional pair already has a non-moot record. */
function pairAlreadyKnown(
  sqlite: RawDb,
  spaceId: string,
  statedId: number,
  consolidatedId: number,
): boolean {
  const row = sqlite
    .prepare(
      `SELECT 1 FROM contradictions
       WHERE space_id = ? AND domain = 'user_model' AND old_id = ? AND new_id = ?
         AND state != 'moot' LIMIT 1`,
    )
    .get(spaceId, statedId, consolidatedId);
  return row !== undefined;
}

/* ------------------------------------------------------------------ */
/* Progress persistence                                                */
/* ------------------------------------------------------------------ */

function writeProgress(
  sqlite: RawDb,
  spaceId: string,
  state: {
    cursor: { valid_at: string; id: number } | null;
    partial: {
      valid_at: string;
      id: number;
      stated_overlap: number;
      stated_id: number;
      stated_version: number;
    } | null;
    passCompletedAt: string | null;
  },
  nowIso: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO w3_recon_progress
         (space_id, cursor_valid_at, cursor_id, partial_valid_at, partial_id,
          partial_stated_overlap, partial_stated_id, partial_stated_version,
          last_pass_completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (space_id) DO UPDATE SET
         cursor_valid_at = excluded.cursor_valid_at,
         cursor_id = excluded.cursor_id,
         partial_valid_at = excluded.partial_valid_at,
         partial_id = excluded.partial_id,
         partial_stated_overlap = excluded.partial_stated_overlap,
         partial_stated_id = excluded.partial_stated_id,
         partial_stated_version = excluded.partial_stated_version,
         last_pass_completed_at = COALESCE(excluded.last_pass_completed_at, w3_recon_progress.last_pass_completed_at),
         updated_at = excluded.updated_at`,
    )
    .run(
      spaceId,
      state.cursor?.valid_at ?? null,
      state.cursor?.id ?? null,
      state.partial?.valid_at ?? null,
      state.partial?.id ?? null,
      state.partial?.stated_overlap ?? null,
      state.partial?.stated_id ?? null,
      state.partial?.stated_version ?? null,
      state.passCompletedAt,
      nowIso,
    );
}

/** Discard a stale pair-level marker before slice selection (§8.6). */
function clearPartialMarker(sqlite: RawDb, spaceId: string, nowIso: string): void {
  sqlite
    .prepare(
      `UPDATE w3_recon_progress
       SET partial_valid_at = NULL, partial_id = NULL, partial_stated_overlap = NULL,
           partial_stated_id = NULL, partial_stated_version = NULL, updated_at = ?
       WHERE space_id = ?`,
    )
    .run(nowIso, spaceId);
}

/* ------------------------------------------------------------------ */
/* The phase                                                           */
/* ------------------------------------------------------------------ */

export async function runReconciliationPhase(
  h: DbHandle,
  ctx: ConsolidationRunContext,
  opts: ReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const sqlite = h.sqlite;
  const spaceId = ctx.spaceId;
  const nowIso = ctx.now ?? new Date().toISOString();
  const scorer: ReconSimilarityScorer =
    opts.scorer ?? ((a, b) => tokenJaccard(a.content, b.content));
  const config = readConfig(sqlite, spaceId);
  const versionAtStart = config.statedSetVersion;

  const summary: ReconciliationSummary = {
    beliefsExamined: 0,
    pairsExamined: 0,
    filedDeterministic: 0,
    queued: 0,
    semanticJudged: 0,
    semanticFiled: 0,
    semanticStaleDropped: 0,
    semanticExhausted: 0,
    passCompleted: false,
  };

  /* ---------------- deterministic pass ---------------- */

  // The current stated set (the candidate universe for every belief;
  // the budgets are the bound, not a pre-filter — §5.6).
  const statedRows = sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, valid_at, confidence FROM user_model
       WHERE space_id = ? AND origin = 'stated' AND invalid_at IS NULL
       ORDER BY id ASC`,
    )
    .all(spaceId) as ReconRow[];
  const statedParsed = statedRows.map((r) => ({ ...r, labels: parseLabels(r.topic_labels) }));

  let progress = readProgress(sqlite, spaceId);

  // Pair-level marker handling (§8.6 contract). A marker is exact only
  // while its belief is still current AND the stated set has not
  // changed since it was written (stated_set_version match). Anything
  // else: discard the marker BEFORE slice selection — the belief is
  // then reached by ordinary path selection and re-examined from its
  // first pair (filings and queue inserts dedupe, so this is safe).
  interface ResumeState {
    belief: ReconRow;
    afterOverlap: number;
    afterStatedId: number;
  }
  let resume: ResumeState | null = null;
  if (progress !== null && progress.partial_id !== null) {
    const belief = currentRow(sqlite, spaceId, progress.partial_id, "consolidated");
    if (belief === null || progress.partial_stated_version !== versionAtStart) {
      clearPartialMarker(sqlite, spaceId, nowIso);
      progress = readProgress(sqlite, spaceId);
    } else {
      resume = {
        belief,
        afterOverlap: progress.partial_stated_overlap ?? 0,
        afterStatedId: progress.partial_stated_id ?? 0,
      };
    }
  }

  // Slice assembly: the resumed belief first (counts as 1 of the
  // batch), then path selection for the remaining slots. When the
  // resumed belief completes, the in-run cursor advances to its key
  // and the fill continues strictly below it (Path 2 by construction:
  // the just-handled belief can never be reselected in the same run).
  const slice: { belief: ReconRow; resumeAfter: { overlap: number; statedId: number } | null }[] = [];
  let selectionExhausted = false;
  if (resume !== null) {
    slice.push({
      belief: resume.belief,
      resumeAfter: { overlap: resume.afterOverlap, statedId: resume.afterStatedId },
    });
  }
  const fillLimit = Math.max(0, config.batch - slice.length);
  if (fillLimit > 0) {
    if (resume !== null) {
      // Fill is selected after the resumed belief is examined (its
      // completion moves the cursor); the selection itself happens
      // lazily in the examination loop below via pendingFill.
    } else {
      const sel = selectReconSlice(sqlite, spaceId, fillLimit);
      for (const b of sel.beliefs) slice.push({ belief: b, resumeAfter: null });
      selectionExhausted = sel.beliefs.length < fillLimit;
    }
  }

  const filings: IntendedFiling[] = [];
  const queueInserts: IntendedQueueInsert[] = [];
  let pairsSpent = 0;
  let lastFullyProcessed: { valid_at: string; id: number } | null =
    progress !== null && progress.cursor_valid_at !== null && progress.cursor_id !== null
      ? { valid_at: progress.cursor_valid_at, id: progress.cursor_id }
      : null;
  let partialOut: {
    valid_at: string;
    id: number;
    stated_overlap: number;
    stated_id: number;
    stated_version: number;
  } | null = null;
  /** True when the pairs budget stopped the slice early — the pass is
   * NOT complete even if the selection happened to be exhausted. */
  let sliceTruncated = false;

  const examineBelief = (
    belief: ReconRow,
    resumeAfter: { overlap: number; statedId: number } | null,
  ): "completed" | "partial" | "unreached" => {
    summary.beliefsExamined++;
    const beliefLabels = parseLabels(belief.topic_labels);
    let candidates: StatedCandidate[] = statedParsed.map((s) => ({
      ...s,
      overlap: s.labels.filter((l) => beliefLabels.includes(l)).length,
    }));
    // Deterministic pair ordering: topic-overlap DESC, stated id ASC.
    candidates.sort((a, b) => b.overlap - a.overlap || a.id - b.id);
    if (resumeAfter !== null) {
      // Resume rule: the first ordering key strictly after the marker.
      candidates = candidates.filter(
        (c) =>
          c.overlap < resumeAfter.overlap ||
          (c.overlap === resumeAfter.overlap && c.id > resumeAfter.statedId),
      );
    }
    let lastExamined: { overlap: number; statedId: number } | null = null;
    for (const cand of candidates) {
      if (pairsSpent >= config.pairsBudget) {
        // Budget exhausted mid-belief: the marker records the last
        // EXAMINED pair; the unexamined tail is deferred, never dropped.
        if (lastExamined !== null) {
          partialOut = {
            valid_at: belief.valid_at,
            id: belief.id,
            stated_overlap: lastExamined.overlap,
            stated_id: lastExamined.statedId,
            stated_version: versionAtStart,
          };
        } else if (resumeAfter !== null) {
          // Resumed belief, no capacity even for its next pair: the
          // marker carries forward unchanged.
          partialOut = {
            valid_at: belief.valid_at,
            id: belief.id,
            stated_overlap: resumeAfter.overlap,
            stated_id: resumeAfter.statedId,
            stated_version: versionAtStart,
          };
        } else {
          // Zero pairs examined of a fresh belief (pairs budget was
          // already spent): the belief is not partial — it simply was
          // not reached. Roll back the beliefsExamined increment: it
          // counts beliefs whose pair iteration actually ran.
          summary.beliefsExamined--;
          return "unreached";
        }
        return "partial";
      }
      pairsSpent++;
      summary.pairsExamined++;
      // Every pair examination invokes the scorer exactly once — the
      // examination count IS the scorer call count (T-C74/T-C80).
      const sim = scorer(belief, cand);
      lastExamined = { overlap: cand.overlap, statedId: cand.id };

      const det = detectContradiction(belief.content, {
        content: cand.content,
        slot: cand.slot as Slot,
      });
      if (det === "genuine_negation" || det === "explicit_transition") {
        filings.push({
          statedId: cand.id,
          consolidatedId: belief.id,
          category: det === "genuine_negation" ? "factual_update" : "state_transition",
        });
        continue;
      }
      if (det === "succession") continue; // deterministically resolved: not a contradiction
      // Tier 1 coverage predicate: same slot + topic-label overlap
      // (both rows current → open validity intervals overlap).
      if (belief.slot === cand.slot && cand.overlap > 0) {
        filings.push({ statedId: cand.id, consolidatedId: belief.id, category: "false_belief" });
        continue;
      }
      if (pairAlreadyKnown(sqlite, spaceId, cand.id, belief.id)) continue;
      if (sim >= config.simThreshold) {
        queueInserts.push({ consolidatedId: belief.id, statedId: cand.id, similarity: sim });
      }
      // Below threshold: cleared, no action — the documented envelope
      // boundary (§5.6). Nothing is queued, judged, or filed.
    }
    return "completed";
  };

  // Examination loop. The resumed belief goes first; the fill below
  // its key is selected only once it completes (cursor semantics).
  let fillSelected = resume === null;
  let idx = 0;
  while (idx < slice.length) {
    const item = slice[idx]!;
    const outcome = examineBelief(item.belief, item.resumeAfter);
    if (outcome === "completed") {
      lastFullyProcessed = { valid_at: item.belief.valid_at, id: item.belief.id };
      idx++;
      if (!fillSelected) {
        fillSelected = true;
        const limit = Math.max(0, config.batch - slice.length);
        if (limit > 0 && pairsSpent < config.pairsBudget) {
          const fill = selectBelowCursor(sqlite, spaceId, lastFullyProcessed, limit);
          for (const b of fill) slice.push({ belief: b, resumeAfter: null });
          selectionExhausted = fill.length < limit;
        } else if (limit === 0) {
          selectionExhausted = false;
        } else {
          // Pairs budget already spent: no further beliefs are
          // reachable this run; the pass is not complete.
          selectionExhausted = false;
        }
      }
      continue;
    }
    // Partial or unreached: the run's deterministic work ends here,
    // and the slice was truncated by the pairs budget.
    sliceTruncated = true;
    break;
  }

  const stoppedMidBelief = partialOut !== null;
  summary.passCompleted = !sliceTruncated && selectionExhausted && idx >= slice.length;

  // Slice-end commit (§5.6): filings + queue inserts + cursor/marker
  // in ONE transaction. A crash before this commit re-runs the whole
  // unit — safe, because filings dedupe and queue inserts are PK
  // no-ops. Cursor/marker advancement never waits on the semantic
  // pass, and advancing it never discards semantic work (the queue is
  // a separate durable table).
  const hadProgressRow = progress !== null;
  const didWork = summary.beliefsExamined > 0 || filings.length > 0 || queueInserts.length > 0;
  if (hadProgressRow || didWork) {
    const sliceTxn = sqlite.transaction(() => {
      for (const f of filings) {
        if (fileReconContradiction(sqlite, spaceId, f)) summary.filedDeterministic++;
      }
      for (const q of queueInserts) {
        const r = sqlite
          .prepare(
            `INSERT OR IGNORE INTO w3_recon_semantic_queue
               (space_id, consolidated_id, stated_id, similarity, queued_at, attempts)
             VALUES (?, ?, ?, ?, ?, 0)`,
          )
          .run(spaceId, q.consolidatedId, q.statedId, q.similarity, nowIso);
        if (r.changes === 1) summary.queued++;
      }
      writeProgress(
        sqlite,
        spaceId,
        {
          cursor: summary.passCompleted ? null : lastFullyProcessed,
          partial: stoppedMidBelief ? partialOut : null,
          passCompletedAt: summary.passCompleted ? nowIso : null,
        },
        nowIso,
      );
    });
    sliceTxn();
  }

  /* ---------------- semantic pass (queue drain) ---------------- */

  // No judge configured → no judgments are possible; the queue holds
  // its work for a future run (deferred, never dropped). This is the
  // no-cloud-key fallback (§14 spirit): the deterministic pass above
  // is fully functional without an LLM.
  if (ctx.llmJudge) {
    const judge: LlmJudge = ctx.llmJudge;
    const entries = sqlite
      .prepare(
        `SELECT space_id, consolidated_id, stated_id, similarity, queued_at, attempts
         FROM w3_recon_semantic_queue
         WHERE space_id = ?
         ORDER BY queued_at ASC, consolidated_id ASC, stated_id ASC`,
      )
      .all(spaceId) as {
      consolidated_id: number;
      stated_id: number;
      attempts: number;
    }[];

    for (const entry of entries) {
      if (summary.semanticJudged >= config.semanticBudget) break;
      const consolidated = currentRow(sqlite, spaceId, entry.consolidated_id, "consolidated");
      const stated = currentRow(sqlite, spaceId, entry.stated_id, "stated");
      if (consolidated === null || stated === null) {
        // Either side invalidated, superseded, or forgotten since
        // queueing → the entry is deleted; no judgment is spent.
        sqlite
          .prepare(
            `DELETE FROM w3_recon_semantic_queue
             WHERE space_id = ? AND consolidated_id = ? AND stated_id = ?`,
          )
          .run(spaceId, entry.consolidated_id, entry.stated_id);
        summary.semanticStaleDropped++;
        continue;
      }
      if (ctx.llmBudget && ctx.llmBudget.remaining <= 0) break;
      // A judgment (including a thrown one) counts against the shared
      // run budget. It runs here — after the slice commit, on plain
      // reads — with NO write transaction held (the Rev 6 rule).
      if (ctx.llmBudget) ctx.llmBudget.remaining -= 1;
      summary.semanticJudged++;
      let judgment: Awaited<ReturnType<LlmJudge>> | null = null;
      let threw = false;
      try {
        judgment = await judge({
          candidate: consolidated.content,
          entry: {
            id: stated.id,
            slot: stated.slot as Slot,
            content: stated.content,
            confidence: stated.confidence,
          },
        });
      } catch {
        threw = true;
      }
      if (threw) {
        const attempts = entry.attempts + 1;
        if (attempts >= 3) {
          // Terminal: semantic detection for this pair is exhausted —
          // recorded honestly, never silently passed over.
          const failTxn = sqlite.transaction(() => {
            sqlite
              .prepare(
                `DELETE FROM w3_recon_semantic_queue
                 WHERE space_id = ? AND consolidated_id = ? AND stated_id = ?`,
              )
              .run(spaceId, entry.consolidated_id, entry.stated_id);
            auditLog(
              sqlite,
              spaceId,
              "recon_semantic_failed",
              `semantic reconciliation exhausted for pair (consolidated ${entry.consolidated_id}, stated ${entry.stated_id}) after ${attempts} failed judge attempts`,
              { consolidated_id: entry.consolidated_id, stated_id: entry.stated_id, attempts },
              "failed",
            );
          });
          failTxn();
          summary.semanticExhausted++;
        } else {
          sqlite
            .prepare(
              `UPDATE w3_recon_semantic_queue SET attempts = ?
               WHERE space_id = ? AND consolidated_id = ? AND stated_id = ?`,
            )
            .run(attempts, spaceId, entry.consolidated_id, entry.stated_id);
        }
        continue;
      }
      if (judgment === "compatible" || judgment === "restatement") {
        // no_contradiction → delete; nothing is filed.
        sqlite
          .prepare(
            `DELETE FROM w3_recon_semantic_queue
             WHERE space_id = ? AND consolidated_id = ? AND stated_id = ?`,
          )
          .run(spaceId, entry.consolidated_id, entry.stated_id);
        continue;
      }
      // 'contradiction' files. 'uncertain' / 'transition' are the
      // judge's ambiguous outcomes — they file too (fail-closed: a
      // filed record costs one Phase B adjudication; a missed
      // contradiction costs the invariant). Filing + queue deletion
      // commit in ONE short transaction.
      const resolveTxn = sqlite.transaction(() => {
        const filed = fileReconContradiction(sqlite, spaceId, {
          statedId: entry.stated_id,
          consolidatedId: entry.consolidated_id,
          category: "false_belief",
        });
        if (filed) summary.semanticFiled++;
        sqlite
          .prepare(
            `DELETE FROM w3_recon_semantic_queue
             WHERE space_id = ? AND consolidated_id = ? AND stated_id = ?`,
          )
          .run(spaceId, entry.consolidated_id, entry.stated_id);
      });
      resolveTxn();
    }
  }

  return summary;
}
