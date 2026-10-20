/**
 * W3 guarded write boundary (design Rev 11, §6.1) — Milestone 2, Phase C.
 *
 * Exactly one function in the W3 module is permitted to issue INSERT/UPDATE
 * statements against `user_model`: `applyConsolidationMutation()`. All SQL
 * against `user_model` in this file lives between the BOUNDARY WRITE ZONE
 * markers below, in small applier functions called only from
 * `applyConsolidationMutation()`. The source-scan gate test
 * (w3-boundary-gate.test.ts) enforces this mechanically.
 *
 * The stated-row invariant (canonical definition, §6.1): a user_model row
 * with origin='stated' has protected columns that no W3-initiated operation
 * may write, by any verb, at ANY confidence (the W2 0.95 carve-out is
 * withdrawn for W3 writes). The sole exception is SetReviewFlag, which
 * writes only `review_flag` / `review_flagged_at` (§6.4).
 *
 * SCHEMA NOTE (design-vs-schema discrepancy, flagged in the M2 report):
 * §6.1's integrity projection names `invalidated_by` and `updated_at`, but
 * the real `user_model` table has neither column. The invalidation state
 * lives in `invalid_at` + `invalid_reason` + `replaced_by`. The fingerprint
 * below therefore covers every column that must remain unchanged FOR
 * STATED ROWS in the actual schema — id, slot, content, evidence_ids,
 * confidence, valid_at, invalid_at, invalid_reason, replaced_by — which
 * is exactly the design's intent ("every column that must remain
 * unchanged is in the projection", §6.1 P0-A). A content edit that leaves
 * other columns untouched still changes the hash (T-C57).
 *
 * Transaction discipline (Rev 6, round-5 P1): no SQLite write lock is
 * ever held across an LLM call. Non-insert mutations run in a single
 * BEGIN IMMEDIATE transaction. Inserts follow the two-phase protocol:
 * Phase A evaluates Tier 2 against a lock-free snapshot; Phase B is a
 * short BEGIN IMMEDIATE verify-and-commit transaction (SQL only).
 */

import { createHash } from "node:crypto";
import type { RawDb } from "../../db/vec.js";
import type { DbHandle } from "../../db/client.js";
import {
  SLOTS,
  detectContradiction,
  tokenJaccard,
  validateEvidenceRefs,
  validateOneProposition,
  checkFirstOrderOnly,
  ValidationError,
  type EvidenceRef,
  type InvalidReason,
  type LlmJudge,
  type Slot,
} from "../userModel.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** §6.4 closed value set for review flags. */
export type ReviewFlagValue =
  | "evidence_withdrawn"
  | "stale_emotion"
  | "contradiction_pending";

export const REVIEW_FLAG_VALUES: readonly ReviewFlagValue[] = [
  "evidence_withdrawn",
  "stale_emotion",
  "contradiction_pending",
];

export interface InsertConsolidatedEntry {
  slot: Slot;
  content: string;
  /** Typed evidence refs; must be non-empty (INV-C-4) and every ref's
   * lineage must be known (non-NULL) per §4.3. */
  evidence: EvidenceRef[];
  /** If omitted, derived by the caller-side topic mapper convention:
   * the boundary never invents labels — omitted means []. */
  topicLabels?: string[];
  /** When the belief became current. Defaults to now. */
  validAt?: string;
}

/**
 * The closed mutation union (§6.1). SetReviewFlag is structurally limited
 * to the two review-metadata columns: its payload carries only a flag
 * value from the §6.4 closed set — there is no field through which
 * content could be smuggled.
 */
export type ConsolidationMutation =
  | { kind: "InsertConsolidated"; entry: InsertConsolidatedEntry }
  | { kind: "InvalidateEntry"; entryId: number; reason: InvalidReason }
  | { kind: "AppendEvidence"; entryId: number; evidence: EvidenceRef[] }
  | {
      kind: "WithdrawEvidence";
      entryId: number;
      episodeIds: number[];
      /**
       * W3 Milestone 3 (Amendment 1): reason written when the withdrawal
       * escalates to invalidation. Defaults to "evidence_withdrawn" (the
       * Milestone 2 behavior, T-C61). The §7.3 forget-propagation path
       * passes "evidence_forgotten" — lawful since the Amendment 1
       * migration extended the invalid_reason CHECK to seven values.
       */
      escalationReason?: "evidence_withdrawn" | "evidence_forgotten";
    }
  | { kind: "SetReviewFlag"; entryId: number; flag: ReviewFlagValue };

export type MutationError =
  | "stated_protected"
  | "stated_covers"
  | "stated_contradiction_detected"
  | "stated_state_changed"
  | "empty_evidence"
  | "unknown_lineage"
  | "evidence_not_subset"
  | "entry_not_found"
  | "entry_not_current"
  | "invalid_mutation";

export interface MutationResult {
  status: "applied" | "rejected" | "noop";
  kind: ConsolidationMutation["kind"];
  /** The affected (or would-be) user_model row id, when one exists. */
  entryId?: number;
  /** Rejection code (status='rejected'). */
  error?: MutationError;
  /** Human-readable detail — reason codes and IDs only, never content. */
  detail?: string;
  /**
   * For rejected inserts: true when the rejection is transient for this
   * evidence state (the work item should be recorded failed_retryable and
   * re-evaluated next run); false when deterministic-terminal.
   */
  retryable?: boolean;
  /** Tier 2 diagnostics (inserts): selection bounds actually applied. */
  tier2?: {
    snapshotFingerprint: string;
    deterministicHits: number;
    ambiguousPairs: number;
    selectedBeliefs: number;
    selectedTokens: number;
    judgedEntryId: number | null;
    attempts: number;
  };
}

/**
 * Caller context for a boundary call. `runId` is the consolidation_runs
 * id when invoked from a W3 run (Milestone 3); direct maintenance calls
 * (the W2 sweeps) pass null. `llmJudge` is injectable per the repo's
 * adapter pattern — when absent, Tier 2 runs deterministic-only and
 * unresolved ambiguity does not block (see evaluateTier2). `llmBudget`,
 * when provided, is a shared mutable counter: each Tier 2 judgment
 * decrements `remaining`; a judgment that would exceed the budget defers
 * the insert (failed_retryable) instead of evaluating unboundedly.
 */
export interface ConsolidationRunContext {
  spaceId: string;
  runId?: number | null;
  llmJudge?: LlmJudge;
  llmBudget?: { remaining: number };
  /** Token estimator for the Tier 2 input bound. Defaults to chars/4. */
  estimateTokens?: (text: string) => number;
  /** Clock override for tests (canonical ISO UTC). Defaults to now. */
  now?: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Protected projection for stated rows — see the schema note above. */
const STATED_PROTECTED_COLUMNS = [
  "id",
  "slot",
  "content",
  "evidence_ids",
  "confidence",
  "valid_at",
  "invalid_at",
  "invalid_reason",
  "replaced_by",
] as const;

const INSERT_MAX_ATTEMPTS = 3; // 1 initial + 2 retries (§6.1 retry bound)
const TIER2_MAX_BELIEFS = 50;
const TIER2_MAX_TOKENS = 8000;
/** Below this token similarity (and no topic overlap / shared signal), a
 * pair is not even ambiguous — Tier 2 does not spend a judgment on it. */
const TIER2_AMBIGUITY_SIMILARITY = 0.2;

function nowIso(ctx: ConsolidationRunContext): string {
  return ctx.now ?? new Date().toISOString();
}

function estimateTokens(ctx: ConsolidationRunContext, text: string): number {
  return ctx.estimateTokens
    ? ctx.estimateTokens(text)
    : Math.ceil(text.length / 4);
}

/* ------------------------------------------------------------------ */
/* Local copies of the §8.6 bump + audit helpers.                      */
/* (Same pattern as episodic.ts: userModel.ts's copies are module-     */
/* private; this module must not import mutable internals from it.)    */
/* ------------------------------------------------------------------ */

function bumpStatedSetVersion(sqlite: RawDb, spaceId: string, by = 1): void {
  if (by <= 0) return;
  sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, stated_set_version)
       VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE
       SET stated_set_version = stated_set_version + excluded.stated_set_version`,
    )
    .run(spaceId, by);
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

/* ------------------------------------------------------------------ */
/* Stated-state fingerprints + run-level integrity helpers             */
/* ------------------------------------------------------------------ */

interface StatedRow {
  id: number;
  slot: string;
  content: string;
  evidence_ids: string;
  confidence: number;
  valid_at: string;
  invalid_at: string | null;
  invalid_reason: string | null;
  replaced_by: number | null;
  topic_labels: string;
}

function readStatedRows(
  sqlite: RawDb,
  spaceId: string,
  currentOnly: boolean,
): StatedRow[] {
  return sqlite
    .prepare(
      `SELECT id, slot, content, evidence_ids, confidence,
              valid_at, invalid_at, invalid_reason, replaced_by, topic_labels
       FROM user_model
       WHERE space_id = ? AND origin = 'stated'
         ${currentOnly ? "AND invalid_at IS NULL" : ""}
       ORDER BY id`,
    )
    .all(spaceId) as StatedRow[];
}

/** Canonical serialization of the protected projection (topic_labels is
 * deliberately excluded: it is not a protected column — the fingerprint
 * guards belief state, and Tier 1 reads labels live inside its txn). */
function fingerprintStatedRows(rows: StatedRow[]): string {
  const canon = rows.map((r) => [
    r.id,
    r.slot,
    r.content,
    r.evidence_ids,
    r.confidence,
    r.valid_at,
    r.invalid_at,
    r.invalid_reason,
    r.replaced_by,
  ]);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** Fingerprint over the CURRENT stated set (Tier 2 snapshot identity). */
export function currentStatedFingerprint(
  sqlite: RawDb,
  spaceId: string,
): string {
  return fingerprintStatedRows(readStatedRows(sqlite, spaceId, true));
}

/**
 * Run-level integrity snapshot (§6.1, defense-in-depth): hash of the
 * complete protected state of EVERY stated row in the space (current and
 * invalidated). Stored on the run row by the caller (Milestone 3).
 */
export function snapshotStatedIntegrity(
  sqlite: RawDb,
  spaceId: string,
): { hash: string; rowCount: number } {
  const rows = readStatedRows(sqlite, spaceId, false);
  return { hash: fingerprintStatedRows(rows), rowCount: rows.length };
}

export interface StatedIntegrityResult {
  ok: boolean;
  expectedHash: string;
  actualHash: string;
  rowCount: number;
}

/** Recompute and compare against a snapshot taken at run start. */
export function verifyStatedIntegrity(
  sqlite: RawDb,
  spaceId: string,
  expectedHash: string,
): StatedIntegrityResult {
  const now = snapshotStatedIntegrity(sqlite, spaceId);
  return {
    ok: now.hash === expectedHash,
    expectedHash,
    actualHash: now.hash,
    rowCount: now.rowCount,
  };
}

/**
 * Finalize-time integrity handling (§6.1 + §9.4): on mismatch this writes
 * the alert-grade audit row and sets `space_meta.w3_frozen = 1` — the
 * incident procedure's automated half. It does NOT roll anything back and
 * does not claim to restore safety: the freeze stops future W3 runs
 * until a human reviews and unfreezes (run-claim enforcement is
 * Milestone 3's run.ts; the flag + audit live here so the detector and
 * the response can never drift apart).
 */
export function finalizeStatedIntegrityCheck(
  sqlite: RawDb,
  ctx: ConsolidationRunContext,
  expectedHash: string,
): StatedIntegrityResult & { error?: "stated_integrity_violation" } {
  const result = verifyStatedIntegrity(sqlite, ctx.spaceId, expectedHash);
  if (result.ok) return result;
  auditLog(
    sqlite,
    ctx.spaceId,
    "w3_stated_integrity_violation",
    `w3_stated_integrity_violation run_id=${ctx.runId ?? "none"}`,
    {
      run_id: ctx.runId ?? null,
      expected_hash: result.expectedHash,
      actual_hash: result.actualHash,
      stated_row_count: result.rowCount,
    },
    "failed",
  );
  sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, w3_frozen)
       VALUES (?, 1)
       ON CONFLICT (space_id) DO UPDATE SET w3_frozen = 1`,
    )
    .run(ctx.spaceId);
  return { ...result, error: "stated_integrity_violation" };
}

/* ------------------------------------------------------------------ */
/* Evidence facts: lineage + recency resolution (§4.3 / §4.4)          */
/* ------------------------------------------------------------------ */

interface EvidenceFacts {
  ref: EvidenceRef;
  lineageKey: string | null;
  occurredAt: string | null;
}

function resolveEvidenceFacts(
  sqlite: RawDb,
  spaceId: string,
  refs: EvidenceRef[],
): EvidenceFacts[] {
  const out: EvidenceFacts[] = [];
  for (const ref of refs) {
    if (ref.type === "episode") {
      const row = sqlite
        .prepare(
          `SELECT lineage_key, occurred_at FROM episodes WHERE id = ? AND space_id = ?`,
        )
        .get(ref.id, spaceId) as
        | { lineage_key: string | null; occurred_at: string }
        | undefined;
      out.push({
        ref,
        lineageKey: row?.lineage_key ?? null,
        occurredAt: row?.occurred_at ?? null,
      });
    } else if (ref.type === "enrichment") {
      const row = sqlite
        .prepare(
          `SELECT e.lineage_key AS lineage_key, e.occurred_at AS occurred_at
           FROM episode_enrichments en
           JOIN episodes e ON e.id = en.episode_id
           WHERE en.id = ? AND en.space_id = ?`,
        )
        .get(ref.id, spaceId) as
        | { lineage_key: string | null; occurred_at: string }
        | undefined;
      out.push({
        ref,
        lineageKey: row?.lineage_key ?? null,
        occurredAt: row?.occurred_at ?? null,
      });
    } else if (ref.type === "correction") {
      // A corrections-table row is a distinct user act: its own lineage.
      const row = sqlite
        .prepare(
          `SELECT created_at FROM corrections WHERE id = ? AND space_id = ?`,
        )
        .get(ref.id, spaceId) as { created_at: string } | undefined;
      out.push({
        ref,
        lineageKey: row ? `corr:${ref.id}` : null,
        occurredAt: row?.created_at ?? null,
      });
    } else {
      // node: lineage is inherited from its source episode (§4.3). The
      // durable link is episode_enrichments.source_node_ids (the node's
      // extraction provenance). No link → lineage unknown.
      const node = sqlite
        .prepare(
          `SELECT occurred_at, created_at FROM nodes WHERE id = ? AND space_id = ?`,
        )
        .get(ref.id, spaceId) as
        | { occurred_at: string | null; created_at: string }
        | undefined;
      let lineageKey: string | null = null;
      if (node) {
        const enrichments = sqlite
          .prepare(
            `SELECT source_node_ids, episode_id FROM episode_enrichments
             WHERE space_id = ? AND superseded_by IS NULL`,
          )
          .all(spaceId) as { source_node_ids: string; episode_id: number }[];
        for (const en of enrichments) {
          let ids: unknown;
          try {
            ids = JSON.parse(en.source_node_ids);
          } catch {
            continue;
          }
          if (Array.isArray(ids) && ids.includes(ref.id)) {
            const ep = sqlite
              .prepare(
                `SELECT lineage_key FROM episodes WHERE id = ? AND space_id = ?`,
              )
              .get(en.episode_id, spaceId) as
              | { lineage_key: string | null }
              | undefined;
            lineageKey = ep?.lineage_key ?? null;
            break;
          }
        }
      }
      out.push({
        ref,
        lineageKey,
        occurredAt: node?.occurred_at ?? node?.created_at ?? null,
      });
    }
  }
  return out;
}

/**
 * §4.4 evidence strength, exact formula:
 *   groups G by lineage (unknown-lineage items form NO group — §4.3);
 *   r(g) = 0.5 ^ (age_days(newest item in g) / 90);  c(g) = 0.34 · r(g);
 *   strength = 1 − ∏ (1 − c(g)).
 */
export function computeConsolidationStrength(
  facts: EvidenceFacts[],
  now: string,
): number {
  const groups = new Map<string, number>(); // lineageKey -> newest occurredAt ms
  const nowMs = Date.parse(now);
  for (const f of facts) {
    if (!f.lineageKey) continue;
    const t = f.occurredAt ? Date.parse(f.occurredAt) : NaN;
    const ms = Number.isNaN(t) ? nowMs : t;
    const prev = groups.get(f.lineageKey);
    if (prev === undefined || ms > prev) groups.set(f.lineageKey, ms);
  }
  let product = 1;
  for (const newestMs of groups.values()) {
    const ageDays = Math.max(0, (nowMs - newestMs) / 86_400_000);
    const r = Math.pow(0.5, ageDays / 90);
    product *= 1 - 0.34 * r;
  }
  return groups.size === 0 ? 0 : 1 - product;
}

/** §4.4/§4.5: consolidated confidence is a deterministic function of
 * strength, capped at 0.69. */
export function consolidatedConfidence(evidenceStrength: number): number {
  return Math.min(0.69, 0.3 + 0.39 * evidenceStrength);
}

/* ------------------------------------------------------------------ */
/* Tier 2 — semantic backstop against a lock-free snapshot (Rev 5/6)   */
/* ------------------------------------------------------------------ */

interface Tier2Outcome {
  verdict: "clean" | "contradiction" | "deferred";
  detail: string;
  deterministicHits: number;
  ambiguousPairs: number;
  selectedBeliefs: number;
  selectedTokens: number;
  judgedEntryId: number | null;
}

function parseLabels(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Phase A of the insert protocol. Runs against a snapshot read in
 * autocommit — NO transaction is open while this runs, so the optional
 * LLM judgment never happens under a write lock.
 *
 * Deterministic pass (unbounded, over the whole snapshot): W2's
 * detectContradiction rules in their existing priority. A hit rejects.
 * Ambiguous pairs (topic overlap, shared entity signal, or token
 * similarity ≥ threshold, with no deterministic verdict) may spend ONE
 * judgment from the run's budget, against the single most relevant
 * pair, selected from at most 50 beliefs / 8K tokens (whole rows only).
 * Fail-closed: a 'contradiction' OR 'uncertain' OR 'transition' judgment
 * rejects; only a clean 'compatible'/'restatement' admits. When no
 * judge is configured, Tier 2 is deterministic-only and unresolved
 * ambiguity does not block (the no-cloud-key fallback: without an LLM
 * the distillation path never creates beliefs via templates anyway, §14).
 */
async function evaluateTier2(
  ctx: ConsolidationRunContext,
  entry: InsertConsolidatedEntry,
  snapshot: StatedRow[],
): Promise<Tier2Outcome> {
  const candidateLabels = entry.topicLabels ?? [];
  let deterministicHits = 0;
  const ambiguous: { row: StatedRow; overlap: number; sim: number }[] = [];

  for (const row of snapshot) {
    const det = detectContradiction(entry.content, {
      content: row.content,
      slot: row.slot as Slot,
    });
    if (det === "genuine_negation" || det === "explicit_transition") {
      deterministicHits++;
      return {
        verdict: "contradiction",
        detail: `deterministic:${det} stated_id=${row.id}`,
        deterministicHits,
        ambiguousPairs: 0,
        selectedBeliefs: 0,
        selectedTokens: 0,
        judgedEntryId: null,
      };
    }
    if (det === "succession") continue;
    const rowLabels = parseLabels(row.topic_labels);
    const overlap = candidateLabels.filter((l) => rowLabels.includes(l)).length;
    const sim = tokenJaccard(entry.content, row.content);
    if (overlap > 0 || sim >= TIER2_AMBIGUITY_SIMILARITY) {
      ambiguous.push({ row, overlap, sim });
    }
  }

  if (ambiguous.length === 0) {
    return {
      verdict: "clean",
      detail: "no_deterministic_hit_no_ambiguity",
      deterministicHits: 0,
      ambiguousPairs: 0,
      selectedBeliefs: 0,
      selectedTokens: 0,
      judgedEntryId: null,
    };
  }

  // Relevance order: topic overlap desc, similarity desc, valid_at desc,
  // id asc — deterministic (§6.1).
  ambiguous.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      b.sim - a.sim ||
      (a.row.valid_at < b.row.valid_at ? 1 : a.row.valid_at > b.row.valid_at ? -1 : 0) ||
      a.row.id - b.row.id,
  );

  // Selection bound: ≤50 beliefs, ≤8K tokens (candidate + selected rows,
  // whole rows only — a truncated belief could read as its own negation).
  let tokens = estimateTokens(ctx, entry.content);
  const selected: typeof ambiguous = [];
  for (const pair of ambiguous) {
    if (selected.length >= TIER2_MAX_BELIEFS) break;
    const rowTokens = estimateTokens(ctx, pair.row.content);
    if (tokens + rowTokens > TIER2_MAX_TOKENS) break;
    tokens += rowTokens;
    selected.push(pair);
  }

  const base = {
    deterministicHits: 0,
    ambiguousPairs: ambiguous.length,
    selectedBeliefs: selected.length,
    selectedTokens: tokens,
    judgedEntryId: null as number | null,
  };

  if (!ctx.llmJudge) {
    return { ...base, verdict: "clean", detail: "deterministic_only_no_judge" };
  }
  if (selected.length === 0) {
    // Ambiguity exists but nothing fits the input bound — fail closed.
    return {
      ...base,
      verdict: "contradiction",
      detail: "ambiguous_unjudgeable_input_bound",
    };
  }
  if (ctx.llmBudget && ctx.llmBudget.remaining <= 0) {
    // §6.1: a judgment that would exceed the run budget defers the
    // insert (failed_retryable) rather than evaluating unboundedly.
    return { ...base, verdict: "deferred", detail: "llm_budget_exhausted" };
  }

  const top = selected[0]!;
  if (ctx.llmBudget) ctx.llmBudget.remaining -= 1;
  let judgment: string;
  try {
    judgment = await ctx.llmJudge({
      candidate: entry.content,
      entry: {
        id: top.row.id,
        slot: top.row.slot as Slot,
        content: top.row.content,
        confidence: top.row.confidence,
      },
    });
  } catch {
    return {
      ...base,
      verdict: "contradiction",
      detail: "judge_error_fail_closed",
      judgedEntryId: top.row.id,
    };
  }
  if (judgment === "compatible" || judgment === "restatement") {
    return {
      ...base,
      verdict: "clean",
      detail: `judged:${judgment}`,
      judgedEntryId: top.row.id,
    };
  }
  // 'contradiction' | 'uncertain' | 'transition' — fail closed (§6.1:
  // ambiguous-but-contradiction-likely rejects; only a clean verdict
  // admits). A 'transition' judgment means the candidate terminates the
  // stated state — against a CURRENT stated belief that is a conflict.
  return {
    ...base,
    verdict: "contradiction",
    detail: `judged:${judgment}`,
    judgedEntryId: top.row.id,
  };
}

/** Tier 1 — deterministic coverage check (runs inside the commit txn). */
function findCoveringStatedRow(
  sqlite: RawDb,
  spaceId: string,
  entry: InsertConsolidatedEntry,
): StatedRow | null {
  const labels = entry.topicLabels ?? [];
  if (labels.length === 0) return null;
  const rows = readStatedRows(sqlite, spaceId, true);
  for (const row of rows) {
    if (row.slot !== entry.slot) continue;
    const rowLabels = parseLabels(row.topic_labels);
    if (!labels.some((l) => rowLabels.includes(l))) continue;
    // Temporal overlap is structural here: the stated rows read are all
    // current (invalid_at IS NULL → interval [valid_at, ∞)) and a new
    // consolidated row is likewise inserted open-ended ([validAt, ∞)).
    // Two open-ended intervals always overlap, so the same-slot +
    // topic-overlap match IS the coverage verdict. If stated rows ever
    // gain closed validity intervals, this is the one place to add the
    // interval comparison.
    return row;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The boundary                                                        */
/* ------------------------------------------------------------------ */

interface TargetRow {
  id: number;
  space_id: string;
  slot: string;
  origin: string;
  evidence_ids: string;
  invalid_at: string | null;
  review_flag: string | null;
}

function rejected(
  kind: ConsolidationMutation["kind"],
  error: MutationError,
  detail: string,
  extra?: Partial<MutationResult>,
): MutationResult {
  return { status: "rejected", kind, error, detail, ...extra };
}

/**
 * applyConsolidationMutation — the single W3 write path for user_model.
 *
 * Returns a MutationResult for every expected outcome (applied / noop /
 * rejected); it throws only on infrastructure failure (e.g. a sabotaged
 * statement), in which case the surrounding transaction has already
 * rolled back — no partial write persists (T-C42).
 */
export async function applyConsolidationMutation(
  sqlite: RawDb,
  ctx: ConsolidationRunContext,
  mutation: ConsolidationMutation,
): Promise<MutationResult> {
  if (mutation.kind === "InsertConsolidated") {
    return applyInsert(sqlite, ctx, mutation.entry);
  }
  return applyTargeted(sqlite, ctx, mutation);
}

/** Non-insert mutations: steps 1–2, 4–5 in one BEGIN IMMEDIATE txn. */
function applyTargeted(
  sqlite: RawDb,
  ctx: ConsolidationRunContext,
  mutation: Exclude<ConsolidationMutation, { kind: "InsertConsolidated" }>,
): MutationResult {
  // Structural validation that needs no DB access.
  if (mutation.kind === "SetReviewFlag") {
    if (!REVIEW_FLAG_VALUES.includes(mutation.flag)) {
      return rejected(
        mutation.kind,
        "invalid_mutation",
        `unknown review flag value: ${String(mutation.flag)}`,
        { entryId: mutation.entryId },
      );
    }
  }
  if (mutation.kind === "AppendEvidence") {
    if (!Array.isArray(mutation.evidence) || mutation.evidence.length === 0) {
      return rejected(mutation.kind, "empty_evidence", "append requires non-empty evidence", {
        entryId: mutation.entryId,
      });
    }
  }
  if (mutation.kind === "WithdrawEvidence") {
    if (!Array.isArray(mutation.episodeIds) || mutation.episodeIds.length === 0) {
      return rejected(
        mutation.kind,
        "invalid_mutation",
        "withdraw requires at least one episode id",
        { entryId: mutation.entryId },
      );
    }
  }

  let statedViolation = false;
  const runTxn = sqlite.transaction((): MutationResult => {
    // Step 1: in-transaction re-read of the target row.
    const row = sqlite
      .prepare(
        `SELECT id, space_id, slot, origin, evidence_ids, invalid_at, review_flag
         FROM user_model WHERE id = ?`,
      )
      .get(mutation.entryId) as TargetRow | undefined;
    if (!row || row.space_id !== ctx.spaceId) {
      return rejected(mutation.kind, "entry_not_found", `entry ${mutation.entryId} not found in space`, {
        entryId: mutation.entryId,
      });
    }

    // Step 2: the stated check — precondition, before any write. A
    // violation writes nothing in this transaction (equivalent to a
    // rollback); the canary audit row is written after the transaction
    // by the caller of this closure, in autocommit, so it survives.
    if (row.origin === "stated" && mutation.kind !== "SetReviewFlag") {
      statedViolation = true;
      return rejected(mutation.kind, "stated_protected", `stated row ${row.id} is not a ${mutation.kind} target`, {
        entryId: row.id,
      });
    }

    // === BOUNDARY WRITE ZONE BEGIN (targeted mutations) ===
    switch (mutation.kind) {
      case "SetReviewFlag": {
        if (row.review_flag !== null) {
          // Set-once (§6.3): a row already carrying ANY review flag is
          // left untouched — no write, and per §8.6 no version bump for
          // a no-op set. (A flag is cleared only by a human dismissal
          // outside W3; a later SetReviewFlag then applies afresh.)
          return { status: "noop", kind: mutation.kind, entryId: row.id, detail: "flag_already_set" };
        }
        sqlite
          .prepare(
            `UPDATE user_model SET review_flag = ?, review_flagged_at = ? WHERE id = ?`,
          )
          .run(mutation.flag, nowIso(ctx), row.id);
        // §8.6: a review-flag WRITE on a stated row is a stated-row
        // write — bump in the same transaction (writer #5).
        if (row.origin === "stated") bumpStatedSetVersion(sqlite, ctx.spaceId, 1);
        return { status: "applied", kind: mutation.kind, entryId: row.id };
      }
      case "InvalidateEntry": {
        if (row.invalid_at !== null) {
          return { status: "noop", kind: mutation.kind, entryId: row.id, detail: "entry_not_current" };
        }
        const info = sqlite
          .prepare(
            `UPDATE user_model
             SET invalid_at = ?, invalid_reason = ?
             WHERE id = ? AND invalid_at IS NULL`,
          )
          .run(nowIso(ctx), mutation.reason, row.id);
        if (Number(info.changes) === 0) {
          return { status: "noop", kind: mutation.kind, entryId: row.id, detail: "entry_not_current" };
        }
        return { status: "applied", kind: mutation.kind, entryId: row.id };
      }
      case "AppendEvidence": {
        if (row.invalid_at !== null) {
          return rejected(mutation.kind, "entry_not_current", `entry ${row.id} already invalidated`, {
            entryId: row.id,
          });
        }
        // New refs must exist in this space (§3.8 validation, reused).
        try {
          validateEvidenceRefs({ sqlite } as unknown as DbHandle, ctx.spaceId, mutation.evidence);
        } catch (e) {
          if (e instanceof ValidationError) {
            return rejected(mutation.kind, "invalid_mutation", `evidence validation: ${e.code}`, {
              entryId: row.id,
            });
          }
          throw e;
        }
        const current = parseEvidence(row.evidence_ids);
        const seen = new Set(current.map((r) => `${r.type}:${r.id}`));
        const merged = [...current];
        for (const ref of mutation.evidence) {
          const key = `${ref.type}:${ref.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push({ type: ref.type, id: ref.id });
          }
        }
        if (merged.length === current.length) {
          return { status: "noop", kind: mutation.kind, entryId: row.id, detail: "no_new_evidence" };
        }
        const facts = resolveEvidenceFacts(sqlite, ctx.spaceId, merged);
        const strength = computeConsolidationStrength(facts, nowIso(ctx));
        sqlite
          .prepare(
            `UPDATE user_model SET evidence_ids = ?, evidence_strength = ? WHERE id = ?`,
          )
          .run(JSON.stringify(merged), strength, row.id);
        return { status: "applied", kind: mutation.kind, entryId: row.id };
      }
      case "WithdrawEvidence": {
        if (row.invalid_at !== null) {
          return rejected(mutation.kind, "entry_not_current", `entry ${row.id} already invalidated`, {
            entryId: row.id,
          });
        }
        // Step 4: subset validation, recompute, conditional invalidate —
        // all inside this transaction (atomic).
        const current = parseEvidence(row.evidence_ids);
        const episodeIds = new Set(
          current.filter((r) => r.type === "episode").map((r) => r.id),
        );
        const missing = mutation.episodeIds.filter((id) => !episodeIds.has(id));
        if (missing.length > 0) {
          return rejected(
            mutation.kind,
            "evidence_not_subset",
            `episode ids not in evidence set: ${missing.join(",")}`,
            { entryId: row.id },
          );
        }
        const withdraw = new Set(mutation.episodeIds);
        const survivors = current.filter(
          (r) => !(r.type === "episode" && withdraw.has(r.id)),
        );
        if (survivors.length === 0) {
          // Escalates to invalidation in the same transaction (§6.1
          // step 4). The reason defaults to 'evidence_withdrawn'; the
          // §7.3 forget-propagation path passes 'evidence_forgotten'
          // (Amendment 1 extended the CHECK to admit both).
          const reason = mutation.escalationReason ?? "evidence_withdrawn";
          sqlite
            .prepare(
              `UPDATE user_model
               SET evidence_ids = '[]', invalid_at = ?, invalid_reason = ?
               WHERE id = ? AND invalid_at IS NULL`,
            )
            .run(nowIso(ctx), reason, row.id);
          return {
            status: "applied",
            kind: mutation.kind,
            entryId: row.id,
            detail: `escalated_to_invalidate:${reason}`,
          };
        }
        const facts = resolveEvidenceFacts(sqlite, ctx.spaceId, survivors);
        const strength = computeConsolidationStrength(facts, nowIso(ctx));
        sqlite
          .prepare(
            `UPDATE user_model SET evidence_ids = ?, evidence_strength = ? WHERE id = ?`,
          )
          .run(JSON.stringify(survivors), strength, row.id);
        return { status: "applied", kind: mutation.kind, entryId: row.id };
      }
    }
    // === BOUNDARY WRITE ZONE END (targeted mutations) ===
  });

  const result = runTxn.immediate();

  if (statedViolation) {
    // Canary (§6.1 step 2): content-free — IDs + mutation kind only.
    // Written in autocommit AFTER the mutation transaction, so the
    // rejection's rollback-equivalent can never swallow the evidence.
    auditLog(
      sqlite,
      ctx.spaceId,
      "w3_stated_write_blocked",
      `w3_stated_write_blocked kind=${mutation.kind} entry_id=${mutation.entryId}`,
      { entry_id: mutation.entryId, mutation_kind: mutation.kind, run_id: ctx.runId ?? null },
      "blocked",
    );
  }
  return result;
}

function parseEvidence(raw: string): EvidenceRef[] {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (r): r is EvidenceRef =>
          !!r && typeof r === "object" && typeof r.type === "string" && Number.isInteger(r.id),
      )
      .map((r) => ({ type: r.type, id: r.id }));
  } catch {
    return [];
  }
}

/** Insert path: §6.1 step 3 — two-phase protocol (Rev 6). */
async function applyInsert(
  sqlite: RawDb,
  ctx: ConsolidationRunContext,
  entry: InsertConsolidatedEntry,
): Promise<MutationResult> {
  const kind = "InsertConsolidated" as const;

  // Write-time validation that needs no snapshot (INV-C-1/C-4, §4.3).
  if (!SLOTS.includes(entry.slot)) {
    return rejected(kind, "invalid_mutation", `unknown slot: ${String(entry.slot)}`);
  }
  if (!entry.content || entry.content.trim().length === 0) {
    return rejected(kind, "invalid_mutation", "content is empty");
  }
  if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
    return rejected(kind, "empty_evidence", "INV-C-4: consolidated rows require non-empty evidence");
  }
  try {
    validateOneProposition(entry.content, entry.slot);
    checkFirstOrderOnly(entry.content);
    validateEvidenceRefs({ sqlite } as unknown as DbHandle, ctx.spaceId, entry.evidence);
  } catch (e) {
    if (e instanceof ValidationError) {
      return rejected(kind, "invalid_mutation", `validation: ${e.code}`);
    }
    throw e;
  }
  // Every evidence ref's lineage must be known (non-NULL) — unknown-
  // lineage evidence cannot be the basis of a new consolidated row.
  const facts = resolveEvidenceFacts(sqlite, ctx.spaceId, entry.evidence);
  if (facts.some((f) => !f.lineageKey)) {
    return rejected(
      kind,
      "unknown_lineage",
      "evidence with unknown lineage cannot ground a consolidated insert (§4.3)",
    );
  }
  const strength = computeConsolidationStrength(facts, nowIso(ctx));
  const confidence = consolidatedConfidence(strength);

  for (let attempt = 1; attempt <= INSERT_MAX_ATTEMPTS; attempt++) {
    // Phase A — snapshot + Tier 2 (no write lock held; the only await
    // in the insert path happens here, outside any transaction).
    const snapshot = readStatedRows(sqlite, ctx.spaceId, true);
    const fingerprint = fingerprintStatedRows(snapshot);
    const tier2 = await evaluateTier2(ctx, entry, snapshot);
    const tier2Diag = {
      snapshotFingerprint: fingerprint,
      deterministicHits: tier2.deterministicHits,
      ambiguousPairs: tier2.ambiguousPairs,
      selectedBeliefs: tier2.selectedBeliefs,
      selectedTokens: tier2.selectedTokens,
      judgedEntryId: tier2.judgedEntryId,
      attempts: attempt,
    };
    if (tier2.verdict === "contradiction") {
      return rejected(kind, "stated_contradiction_detected", tier2.detail, {
        retryable: tier2.detail === "judge_error_fail_closed",
        tier2: tier2Diag,
      });
    }
    if (tier2.verdict === "deferred") {
      return rejected(kind, "stated_state_changed", tier2.detail, {
        retryable: true,
        tier2: tier2Diag,
      });
    }

    // Phase B — verify + commit. BEGIN IMMEDIATE, SQL only, no I/O:
    // the transaction body below contains no await.
    const commitTxn = sqlite.transaction((): MutationResult => {
      const nowRows = readStatedRows(sqlite, ctx.spaceId, true);
      if (fingerprintStatedRows(nowRows) !== fingerprint) {
        // A stated write landed during evaluation — the Phase A
        // verdict is VOID. Nothing was written; the caller retries
        // against a fresh snapshot or fails closed at the bound.
        return rejected(kind, "stated_state_changed", "snapshot fingerprint mismatch at commit", {
          retryable: true,
          tier2: tier2Diag,
        });
      }
      // Tier 1 — deterministic coverage check, unbounded, in-transaction.
      const covering = findCoveringStatedRow(sqlite, ctx.spaceId, entry);
      if (covering) {
        return rejected(kind, "stated_covers", `covered by stated row ${covering.id}`, {
          entryId: covering.id,
          tier2: tier2Diag,
        });
      }
      // === BOUNDARY WRITE ZONE BEGIN (insert) ===
      const info = sqlite
        .prepare(
          `INSERT INTO user_model
             (space_id, slot, content, confidence, evidence_strength, evidence_ids,
              topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'consolidated')`,
        )
        .run(
          ctx.spaceId,
          entry.slot,
          entry.content.trim(),
          confidence,
          strength,
          JSON.stringify(entry.evidence.map((e) => ({ type: e.type, id: e.id }))),
          JSON.stringify(entry.topicLabels ?? []),
          entry.validAt ?? nowIso(ctx),
        );
      // === BOUNDARY WRITE ZONE END (insert) ===
      return {
        status: "applied",
        kind,
        entryId: Number(info.lastInsertRowid),
        tier2: tier2Diag,
      };
    });

    let result: MutationResult;
    try {
      result = commitTxn.immediate();
    } catch (e) {
      // e.g. the UNIQUE(space_id, slot, content, valid_at) constraint —
      // a duplicate consolidated proposition. Terminal for this entry.
      return rejected(kind, "invalid_mutation", `insert failed: ${(e as Error).message}`, {
        tier2: tier2Diag,
      });
    }
    if (
      result.status === "rejected" &&
      result.error === "stated_state_changed" &&
      attempt < INSERT_MAX_ATTEMPTS
    ) {
      continue; // retry from Phase A with a fresh snapshot
    }
    return result;
  }

  // Retry bound exhausted — fail closed (§6.1). No path from a stale
  // verdict to a write exists: every attempt re-verified in Phase B.
  return rejected(
    kind,
    "stated_state_changed",
    `fingerprint mismatch on all ${INSERT_MAX_ATTEMPTS} attempts`,
    { retryable: true },
  );
}
