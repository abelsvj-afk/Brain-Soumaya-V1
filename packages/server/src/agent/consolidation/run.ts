/**
 * W3 run engine (design Rev 11 §3, §7.3, §9, §11, §14; implementation
 * plan Milestone 3, Phase D). The nightly consolidation run: a SIBLING
 * of the dream cycle on the same autonomy tick — never merged into it
 * (one proposition, one home: dream = world/nodes → belief nodes;
 * W3 = user/episodes → user_model).
 *
 * Lifecycle (§9.1): claim the (space, window) row → stated-integrity
 * snapshot → Phase A (lineage backfill, §7.3 forget propagation, the
 * two §6.3 sweeps) → Phase B (adjudication) → Phase C (distillation) →
 * Phase D (reconciliation, §5.6) → integrity verify →
 * finalize. Any phase throwing aborts the run: status 'failed', error
 * class recorded, last_consolidation_date NOT advanced, and the claim
 * is reclaimable next window with a bumped fencing token.
 *
 * Skip paths are normal outcomes, not failures: w3_enabled=0 →
 * 'w3_disabled' (§12); outside the space-local quiet window →
 * 'outside_window'; a completed claim for the window → 'already_ran';
 * a live-leased claim → 'already_running'; w3_frozen=1 → frozen
 * short-circuit (operator/forget gate or an integrity incident).
 *
 * §9.4: if the run-end integrity check fails, the space FREEZES
 * (w3_frozen=1 + alert audit) and the run is marked failed with error
 * class 'stated_integrity_violation'. No rollback is claimed — stated
 * writes only ever happen through authorized writers and the boundary.
 *
 * Every belief write in every phase goes through the §6.1 boundary
 * (applyConsolidationMutation); this module contains no direct
 * user_model writes.
 */
import type { DbHandle } from "../../db/client.js";
import type { RawDb } from "../../db/vec.js";
import {
  applyConsolidationMutation,
  snapshotStatedIntegrity,
  finalizeStatedIntegrityCheck,
  type ConsolidationRunContext,
} from "./boundary.js";
import type { LlmJudge } from "../userModel.js";
import { sweepStaleEmotions, sweepWithdrawnEvidence } from "../userModel.js";
import { backfillEpisodeLineage } from "../episodic.js";
import { runAdjudication, type AdjudicationSummary } from "./adjudicate.js";
import { runDistillation, type DistillationSummary, type ThemeExtractor, type WorldWriter } from "./distill.js";
import {
  runReconciliationPhase,
  type ReconciliationSummary,
  type ReconSimilarityScorer,
} from "./reconciliation.js";
import {
  getPreferences,
  isQuietHours,
  localDay,
  localTime,
  spaceTimezone,
  type NotifyPreferences,
} from "../notify/policy.js";
import { localDayBoundsMs } from "../../lib/time.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ConsolidationRunOptions {
  /** Clock override (tests). Defaults to now. */
  now?: Date;
  /** Injectable Tier 2 judge (boundary). Null/absent → Tier 2 fails closed. */
  llmJudge?: LlmJudge | null;
  estimateTokens?: (text: string) => number;
  /** Injectable Phase C theme extractor. Null/absent → §14 template path. */
  extractor?: ThemeExtractor | null;
  worldWriter?: WorldWriter | null;
  /** Injectable Phase D deterministic similarity scorer (tests count
   * pair examinations through it — T-C74/T-C80). */
  reconScorer?: ReconSimilarityScorer;
  /** Skip the quiet-window check (manual/test invocation). */
  force?: boolean;
}

export interface RunPhaseSummaries {
  backfilledLineage: number;
  forgetPropagated: number;
  sweeps: { staleEmotions: number; withdrawnEvidence: number; flagged: number };
  adjudication: AdjudicationSummary | null;
  distillation: DistillationSummary | null;
  reconciliation: ReconciliationSummary | null;
}

export type ConsolidationRunOutcome =
  | { status: "skipped"; reason: "w3_disabled" | "outside_window" | "already_ran" | "already_running" }
  | { status: "frozen"; reason: "w3_frozen" | "stated_integrity_violation"; runId?: number }
  | {
      status: "completed" | "aborted_budget" | "failed";
      runId: number;
      windowDate: string;
      itemsProcessed: number;
      llmCalls: number;
      contradictionsResolved: number;
      consolidationsWritten: number;
      flagged: number;
      error?: string;
      phases: RunPhaseSummaries;
    };

const RUN_LEASE_MS = 30 * 60 * 1000;
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Window (§3.1 — space-local, Phase 2 policy source)                 */
/* ------------------------------------------------------------------ */

/**
 * The open window's date: the space-local date on which the current
 * quiet window OPENED (21:00–04:30 → the evening's date, including the
 * after-midnight portion). Null when outside quiet hours.
 */
export function consolidationWindowDate(now: Date, prefs: NotifyPreferences): string | null {
  if (!isQuietHours(now, prefs)) return null;
  const t = localTime(now, prefs.timezone);
  if (prefs.quietStart > prefs.quietEnd && t < prefs.quietEnd) {
    return localDay(new Date(now.getTime() - MS_PER_DAY), prefs.timezone);
  }
  return localDay(now, prefs.timezone);
}

/* ------------------------------------------------------------------ */
/* Claim (§9.2 — atomic, fenced, at most one live claim per window)   */
/* ------------------------------------------------------------------ */

export type ClaimResult =
  | { claimed: true; runId: number; fence: number }
  | { claimed: false; reason: "already_completed" | "live_lease"; runId: number; fence: number };

export function claimConsolidationRun(
  sqlite: RawDb,
  spaceId: string,
  windowDate: string,
  now: Date = new Date(),
): ClaimResult {
  const nowIso = now.toISOString();
  const lease = new Date(now.getTime() + RUN_LEASE_MS).toISOString();
  try {
    const r = sqlite
      .prepare(
        `INSERT INTO consolidation_runs
           (space_id, window_date, fence, started_at, status, lease_expires_at)
         VALUES (?, ?, 1, ?, 'running', ?)`,
      )
      .run(spaceId, windowDate, nowIso, lease);
    return { claimed: true, runId: Number(r.lastInsertRowid), fence: 1 };
  } catch {
    // UNIQUE(space_id, window_date) conflict — inspect the existing row.
  }
  // NOTE: consolidation_runs.fence is a TEXT column (Milestone 1) — the
  // fencing token is stored as its decimal string; parse to compare.
  const existing = sqlite
    .prepare(
      `SELECT id, fence, status, lease_expires_at FROM consolidation_runs
       WHERE space_id = ? AND window_date = ?`,
    )
    .get(spaceId, windowDate) as
    | { id: number; fence: string; status: string; lease_expires_at: string | null }
    | undefined;
  if (!existing) {
    // Lost a race with a concurrent claim that then vanished — treat as live.
    return { claimed: false, reason: "live_lease", runId: -1, fence: 0 };
  }
  const existingFence = Number(existing.fence);
  if (existing.status === "completed" || existing.status === "aborted_budget") {
    return { claimed: false, reason: "already_completed", runId: existing.id, fence: existingFence };
  }
  if (
    existing.status === "running" &&
    existing.lease_expires_at !== null &&
    existing.lease_expires_at > nowIso
  ) {
    return { claimed: false, reason: "live_lease", runId: existing.id, fence: existingFence };
  }
  // Failed / crashed / stale-lease row: reclaim with a bumped fence. The
  // guarded UPDATE (old fence in WHERE) means a concurrent reclaim that
  // already bumped it makes this one a no-op → live lease.
  const newFence = existingFence + 1;
  const upd = sqlite
    .prepare(
      `UPDATE consolidation_runs
       SET fence = ?, status = 'running', started_at = ?, completed_at = NULL,
           lease_expires_at = ?, error = NULL
       WHERE id = ? AND fence = ?`,
    )
    .run(String(newFence), nowIso, lease, existing.id, existing.fence);
  if (upd.changes !== 1) {
    return { claimed: false, reason: "live_lease", runId: existing.id, fence: newFence };
  }
  return { claimed: true, runId: existing.id, fence: newFence };
}

/* ------------------------------------------------------------------ */
/* §5.1 legacy retirement                                              */
/* ------------------------------------------------------------------ */

/**
 * Legacy potential_contradiction audit rows (W1's logPotentialContradiction,
 * result='pending_w3') are NEVER retro-filed: they lack an identified
 * new side (§5.1). agent_logs is append-only (UPDATE trigger-blocked),
 * so "marking them legacy_moot" is realized as ONE appended retirement
 * marker per space — readers treat pending_w3 rows as retired once the
 * marker exists. Returns the number of legacy rows retired (0 when
 * none, or when retirement already happened).
 */
export function retireLegacyContradictions(sqlite: RawDb, spaceId: string): number {
  const marker = sqlite
    .prepare(
      `SELECT 1 FROM agent_logs WHERE space_id = ? AND action = 'w3_legacy_retired' LIMIT 1`,
    )
    .get(spaceId);
  if (marker) return 0;
  const count = (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM agent_logs
         WHERE space_id = ? AND action = 'potential_contradiction' AND result = 'pending_w3'`,
      )
      .get(spaceId) as { n: number }
  ).n;
  if (count === 0) return 0;
  sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', 'w3_legacy_retired', ?, ?, 'legacy_moot')`,
    )
    .run(
      spaceId,
      `retired ${count} legacy potential_contradiction report(s) as legacy_moot (never retro-filed, §5.1)`,
      JSON.stringify({ count }),
    );
  return count;
}

/* ------------------------------------------------------------------ */
/* §7.3 forget propagation (scoped to the run)                         */
/* ------------------------------------------------------------------ */

/**
 * For forget requests applied since the last completed run, withdraw
 * the forgotten episodes from any consolidated/inferred entries still
 * citing them — through the boundary, escalating with
 * 'evidence_forgotten' when the withdrawal empties the evidence set.
 * (W2's applyForgetRequest already handled entries citing the episodes
 * at forget time; this closes the loop for entries consolidated AFTER
 * the forget and re-verifies coverage every run. Cheap and idempotent:
 * withdrawn ids are simply absent from evidence afterwards.)
 */
async function propagateForgetToConsolidated(
  sqlite: RawDb,
  ctx: ConsolidationRunContext,
): Promise<number> {
  const forgotten = sqlite
    .prepare(
      `SELECT id FROM episodes WHERE space_id = ? AND forgotten_at IS NOT NULL`,
    )
    .all(ctx.spaceId) as { id: number }[];
  if (forgotten.length === 0) return 0;
  const forgottenSet = new Set(forgotten.map((f) => f.id));
  const entries = sqlite
    .prepare(
      `SELECT id, evidence_ids FROM user_model
       WHERE space_id = ? AND invalid_at IS NULL AND origin IN ('consolidated','inferred')`,
    )
    .all(ctx.spaceId) as { id: number; evidence_ids: string }[];
  let changed = 0;
  for (const entry of entries) {
    let refs: { type: string; id: number }[] = [];
    try {
      const p = JSON.parse(entry.evidence_ids) as unknown;
      if (Array.isArray(p)) refs = p as { type: string; id: number }[];
    } catch {
      refs = [];
    }
    const hit = refs
      .filter((r) => r.type === "episode" && forgottenSet.has(r.id))
      .map((r) => r.id);
    if (hit.length === 0) continue;
    const res = await applyConsolidationMutation(sqlite, ctx, {
      kind: "WithdrawEvidence",
      entryId: entry.id,
      episodeIds: hit,
      escalationReason: "evidence_forgotten",
    });
    if (res.status === "applied") changed++;
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

interface SpaceW3Config {
  last_consolidation_date: string | null;
  w3_enabled: number;
  w3_llm_budget: number;
  w3_max_items: number;
  w3_frozen: number;
}

function readConfig(sqlite: RawDb, spaceId: string): SpaceW3Config {
  sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
  const row = sqlite
    .prepare(
      `SELECT last_consolidation_date, w3_enabled, w3_llm_budget, w3_max_items, w3_frozen
       FROM space_meta WHERE space_id = ?`,
    )
    .get(spaceId) as SpaceW3Config;
  return row;
}

export async function runConsolidation(
  h: DbHandle,
  spaceId: string,
  opts: ConsolidationRunOptions = {},
): Promise<ConsolidationRunOutcome> {
  const sqlite = h.sqlite;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const config = readConfig(sqlite, spaceId);

  if (config.w3_enabled !== 1) return { status: "skipped", reason: "w3_disabled" };
  if (config.w3_frozen === 1) return { status: "frozen", reason: "w3_frozen" };

  const prefs = getPreferences(sqlite, spaceId);
  const windowDate = opts.force
    ? localDay(now, prefs.timezone)
    : consolidationWindowDate(now, prefs);
  if (windowDate === null) return { status: "skipped", reason: "outside_window" };

  const claim = claimConsolidationRun(sqlite, spaceId, windowDate, now);
  if (!claim.claimed) {
    return {
      status: "skipped",
      reason: claim.reason === "already_completed" ? "already_ran" : "already_running",
    };
  }
  const runId = claim.runId;

  const budget = { remaining: Math.max(0, config.w3_llm_budget) };
  const ctx: ConsolidationRunContext = {
    spaceId,
    runId,
    llmJudge: opts.llmJudge ?? undefined,
    llmBudget: budget,
    estimateTokens: opts.estimateTokens,
    now: nowIso,
  };

  const phases: RunPhaseSummaries = {
    backfilledLineage: 0,
    forgetPropagated: 0,
    sweeps: { staleEmotions: 0, withdrawnEvidence: 0, flagged: 0 },
    adjudication: null,
    distillation: null,
    reconciliation: null,
  };
  let llmCallsAtStart = budget.remaining;

  const failRun = (errorClass: string): ConsolidationRunOutcome => {
    sqlite
      .prepare(
        `UPDATE consolidation_runs SET status = 'failed', error = ?, completed_at = ?
         WHERE id = ? AND fence = ?`,
      )
      .run(errorClass, new Date().toISOString(), runId, String(claim.fence));
    return {
      status: "failed",
      runId,
      windowDate,
      itemsProcessed: 0,
      llmCalls: llmCallsAtStart - budget.remaining,
      contradictionsResolved: 0,
      consolidationsWritten: 0,
      flagged: 0,
      error: errorClass,
      phases,
    };
  };

  try {
    // Run-start stated-integrity snapshot (§9.1 step 2).
    const snapshot = snapshotStatedIntegrity(sqlite, spaceId);
    sqlite
      .prepare(`UPDATE consolidation_runs SET stated_integrity_hash = ? WHERE id = ?`)
      .run(snapshot.hash, runId);

    retireLegacyContradictions(sqlite, spaceId);

    // ---- Phase A: sweeps & maintenance (no LLM) ----
    phases.backfilledLineage = backfillEpisodeLineage(h, spaceId).updated;
    phases.forgetPropagated = await propagateForgetToConsolidated(sqlite, ctx);
    const stale = await sweepStaleEmotions(h, spaceId);
    phases.sweeps.staleEmotions = stale.expiredCount + stale.flaggedStatedCount;
    phases.sweeps.flagged += stale.flaggedStatedCount;
    const withdrawn = await sweepWithdrawnEvidence(h, spaceId);
    phases.sweeps.withdrawnEvidence = withdrawn.invalidatedIds.length;
    phases.sweeps.flagged += withdrawn.flaggedStatedIds.length;

    // ---- Phase B: adjudication (deterministic; no LLM) ----
    phases.adjudication = await runAdjudication(h, {
      boundary: ctx,
      runId,
      fence: claim.fence,
      now,
    });

    // ---- Phase C: distillation (budget ledger shared with Tier 2) ----
    phases.distillation = await runDistillation(h, ctx, {
      extractor: opts.extractor ?? null,
      worldWriter: opts.worldWriter ?? null,
      budget,
      maxItems: config.w3_max_items,
    });

    // ---- Phase D: reconciliation (§5.6 — discovery only; records it
    // files enter NEXT run's Phase B, never this run's) ----
    phases.reconciliation = await runReconciliationPhase(h, ctx, {
      scorer: opts.reconScorer,
    });

    // Budget exhaustion (§9.3): the ledger is empty AND LLM-dependent
    // work was left undone — the extractor never got to run despite
    // candidates waiting, or inserts were rejected with the ledger
    // empty. The run is marked 'aborted_budget' (terminal for the
    // window) and last_consolidation_date does NOT advance. A run that
    // merely spends its budget exactly while finishing is 'completed'.
    const dist = phases.distillation;
    const budgetExhausted =
      budget.remaining <= 0 &&
      ((opts.extractor != null && (dist?.candidates ?? 0) > 0 && (dist?.llmCalls ?? 0) === 0) ||
        (dist?.rejected ?? 0) > 0);

    // Run-end integrity verify (§9.1 step 6 / §9.4). On mismatch the
    // boundary helper has already frozen the space and written the
    // alert audit; here the run is marked failed with the incident's
    // error class — no rollback is claimed (§9.4).
    const check = finalizeStatedIntegrityCheck(sqlite, ctx, snapshot.hash);
    if (check.error !== undefined) {
      sqlite
        .prepare(
          `UPDATE consolidation_runs SET status = 'failed', error = 'stated_integrity_violation', completed_at = ?
           WHERE id = ? AND fence = ?`,
        )
        .run(new Date().toISOString(), runId, String(claim.fence));
      return { status: "frozen", reason: "stated_integrity_violation", runId };
    }

    const itemsProcessed =
      phases.backfilledLineage +
      phases.forgetPropagated +
      phases.sweeps.staleEmotions +
      phases.sweeps.withdrawnEvidence +
      (phases.adjudication?.claimed ?? 0) +
      (phases.distillation?.candidates ?? 0) +
      (phases.reconciliation?.pairsExamined ?? 0) +
      (phases.reconciliation?.semanticJudged ?? 0);
    // One shared ledger: the extractor debit and every boundary Tier 2
    // debit land on the same object, so spend = start − remaining.
    const llmCalls = llmCallsAtStart - budget.remaining;
    const finalStatus = budgetExhausted ? "aborted_budget" : "completed";
    sqlite
      .prepare(
        `UPDATE consolidation_runs
         SET status = ?, completed_at = ?, items_processed = ?, llm_calls = ?,
             contradictions_resolved = ?, consolidations_written = ?
         WHERE id = ? AND fence = ?`,
      )
      .run(
        finalStatus,
        new Date().toISOString(),
        itemsProcessed,
        llmCalls,
        phases.adjudication?.resolved ?? 0,
        phases.distillation?.created ?? 0,
        runId,
        String(claim.fence),
      );
    if (finalStatus === "completed") {
      sqlite
        .prepare(`UPDATE space_meta SET last_consolidation_date = ? WHERE space_id = ?`)
        .run(windowDate, spaceId);
    }
    // Run summary audit (content-free counts) — the digest line's input.
    sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'w3_run_completed', ?, ?, ?)`,
      )
      .run(
        spaceId,
        `w3 consolidation run ${runId} ${finalStatus}: created=${phases.distillation?.created ?? 0} strengthened=${phases.distillation?.strengthened ?? 0} flagged=${phases.sweeps.flagged} resolved=${phases.adjudication?.resolved ?? 0}`,
        JSON.stringify({
          run_id: runId,
          created: phases.distillation?.created ?? 0,
          strengthened: phases.distillation?.strengthened ?? 0,
          flagged: phases.sweeps.flagged,
          resolved: phases.adjudication?.resolved ?? 0,
        }),
        finalStatus,
      );
    return {
      status: finalStatus,
      runId,
      windowDate,
      itemsProcessed,
      llmCalls,
      contradictionsResolved: phases.adjudication?.resolved ?? 0,
      consolidationsWritten: phases.distillation?.created ?? 0,
      flagged: phases.sweeps.flagged,
      phases,
    };
  } catch (err) {
    // Any phase failure aborts the run (§9.1): failed status, error
    // class recorded, date NOT advanced, safe re-entry next window.
    return failRun(err instanceof Error ? err.message.slice(0, 200) : "unknown_error");
  }
}

/* ------------------------------------------------------------------ */
/* Digest line (§7.6/§10)                                              */
/* ------------------------------------------------------------------ */

/**
 * The quiet factual consolidation line for the daily digest.
 *
 * Phase 4: a consolidation lands only when the owner approves its
 * `brain_dedup` proposal through the rail — the run itself only
 * proposes, so the run-time audit's created/strengthened counts are
 * always 0 for distill now. The landed counts therefore come from
 * `world_change_log`: applied `brain_dedup` entries whose `applied_at`
 * falls inside the digest's window — the space-local day, the same
 * window the rest of the digest uses (owner rule 2026-10-21). A
 * proposal whose payload is an AppendEvidence mutation counts as a
 * strengthening; anything else (InsertConsolidated, or an unreadable
 * payload) counts as a new belief. Flagged/resolved still come from
 * the most recent run's summary audit, as before. Rendered ONLY when
 * something changed; zero-change days emit no line.
 */
export function consolidationDigestLine(sqlite: RawDb, spaceId: string): string | null {
  // Landed consolidations inside the space-local day.
  let created = 0;
  let strengthened = 0;
  try {
    const tz = spaceTimezone(sqlite, spaceId);
    const { startMs, endMs } = localDayBoundsMs(Date.now(), tz);
    const landed = sqlite
      .prepare(
        `SELECT p.payload_json AS payload FROM world_change_log l
         LEFT JOIN world_proposals p ON p.id = l.proposal_id
         WHERE l.space_id = ? AND l.kind = 'brain_dedup'
           AND julianday(l.applied_at) >= julianday(?) AND julianday(l.applied_at) < julianday(?)
         ORDER BY l.id ASC`,
      )
      .all(spaceId, new Date(startMs).toISOString(), new Date(endMs).toISOString()) as {
      payload: string | null;
    }[];
    for (const row of landed) {
      let isAppend = false;
      try {
        const payload = JSON.parse(row.payload ?? "{}") as { mutations?: { kind?: string }[] };
        const kinds = Array.isArray(payload.mutations) ? payload.mutations : [];
        isAppend = kinds.length > 0 && kinds.every((m) => m?.kind === "AppendEvidence");
      } catch {
        isAppend = false;
      }
      if (isAppend) strengthened++;
      else created++;
    }
  } catch {
    // Pre-Phase 4 schema (no world_change_log): no landed rows to count.
    created = 0;
    strengthened = 0;
  }
  // Flagged/resolved still come from the most recent run's summary audit.
  const row = sqlite
    .prepare(
      `SELECT targets FROM agent_logs
       WHERE space_id = ? AND action = 'w3_run_completed'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(spaceId) as { targets: string | null } | undefined;
  let flagged = 0;
  let resolved = 0;
  if (row?.targets) {
    try {
      const counts = JSON.parse(row.targets) as { flagged?: number; resolved?: number };
      flagged = counts.flagged ?? 0;
      resolved = counts.resolved ?? 0;
    } catch {
      flagged = 0;
      resolved = 0;
    }
  }
  if (created + strengthened + flagged + resolved === 0) return null;
  const parts: string[] = [];
  if (created > 0) parts.push(`consolidated ${created} new belief${created === 1 ? "" : "s"}`);
  if (strengthened > 0) parts.push(`strengthened ${strengthened}`);
  if (resolved > 0) parts.push(`resolved ${resolved} contradiction${resolved === 1 ? "" : "s"}`);
  if (flagged > 0) parts.push(`flagged ${flagged} for review`);
  return `Overnight I ${parts.join(", ")}`;
}

/** Manual/test trigger parity with the dream cycle's admin path. */
export async function runConsolidationNow(
  h: DbHandle,
  spaceId: string,
  opts: ConsolidationRunOptions = {},
): Promise<ConsolidationRunOutcome> {
  return runConsolidation(h, spaceId, { ...opts, force: true });
}
