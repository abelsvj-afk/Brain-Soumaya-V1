import type { AppContext } from "../context.js";
import { registerBrainApplier, type BrainApplier } from "./mutation.js";
import { applyBelief, type DistilledBelief } from "../analysis/dreamCycle.js";
import { recordStated, SLOTS, type Slot } from "../agent/userModel.js";
import { applyConsolidationMutation, type ConsolidationMutation } from "../agent/consolidation/boundary.js";
import { recordOutcome } from "../agent/consolidation/distill.js";

/**
 * Phase 4 — brain appliers: the functions that execute an approved brain
 * proposal. Each one is IDEMPOTENT (it checks for its own prior effect
 * before writing), because the sweep retries approved-but-unapplied
 * proposals and a retry must never duplicate the effect.
 *
 * Registration happens here, at module load; the route module imports this
 * file for its side effect, so the appliers exist whenever the server boots.
 * mutation.ts itself imports none of these modules (no cycles).
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** brain_belief: apply a distilled belief (create or revise the node). */
const applyBrainBelief: BrainApplier = async (ctx, spaceId, payload) => {
  const d = payload as Partial<DistilledBelief> & { action?: unknown };
  if (
    typeof d.belief !== "string" ||
    !d.belief.trim() ||
    typeof d.label !== "string" ||
    !Array.isArray(d.memberIds) ||
    !isInt(d.hubId)
  ) {
    return { ok: false, error: "belief payload is malformed" };
  }
  const distilled: DistilledBelief = {
    hubId: d.hubId,
    memberIds: d.memberIds.filter(isInt),
    existingBeliefId: isInt(d.existingBeliefId) ? d.existingBeliefId : null,
    belief: d.belief,
    confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
    label: d.label,
  };
  const id = await applyBelief(ctx, spaceId, distilled);
  return { ok: true, detail: { beliefId: id } };
};

/** brain_stated: record a trigger-matched stated assertion. */
const applyBrainStated: BrainApplier = async (ctx, spaceId, payload) => {
  const slot = payload.slot;
  const content = payload.content;
  const episodeId = payload.episodeId;
  if (typeof slot !== "string" || !(SLOTS as readonly string[]).includes(slot)) {
    return { ok: false, error: "stated payload has an unknown slot" };
  }
  if (typeof content !== "string" || !content.trim() || !isInt(episodeId)) {
    return { ok: false, error: "stated payload is malformed" };
  }
  const sqlite = ctx.handle.sqlite;
  // Idempotency: the same stated entry already stands — nothing to do.
  const existing = sqlite
    .prepare(
      `SELECT id FROM user_model WHERE space_id = ? AND slot = ? AND content = ?
       AND origin = 'stated' AND invalid_at IS NULL LIMIT 1`,
    )
    .get(spaceId, slot, content) as { id: number } | undefined;
  if (existing) return { ok: true, detail: { entryId: existing.id } };
  try {
    const res = recordStated(ctx.handle, spaceId, slot as Slot, content, [
      { type: "episode", id: episodeId, isUserStatement: true },
    ]);
    return { ok: true, detail: { entryId: res.id } };
  } catch (e) {
    return { ok: false, error: `recordStated rejected: ${(e as Error).message}`.slice(0, 200) };
  }
};

/** brain_dedup: apply distilled consolidation mutations (insert / strengthen). */
const applyBrainDedup: BrainApplier = async (ctx, spaceId, payload) => {
  const sqlite = ctx.handle.sqlite;
  if (!Array.isArray(payload.mutations) || payload.mutations.length === 0) {
    return { ok: false, error: "dedup payload has no mutations" };
  }
  const mutations = payload.mutations as ConsolidationMutation[];
  for (const m of mutations) {
    if (m.kind !== "InsertConsolidated" && m.kind !== "AppendEvidence") {
      return { ok: false, error: `dedup applier does not apply ${m.kind} mutations` };
    }
  }
  // Phase 4 (Tier 2 restoration): an insert lands ONLY on a clean
  // proposal-time Tier 2 verdict stored in the payload by distillation.
  // The old auto-apply flow judged every insert inside the boundary
  // before writing; the approval sweep has no judge and no budget, so
  // the verdict recorded at proposal time is the judgment. A missing
  // or non-clean verdict refuses the apply (fail-closed — the proposal
  // stays approved and retryable, nothing is written). AppendEvidence
  // never reaches Tier 2 in either flow, so it needs no verdict.
  if (mutations.some((m) => m.kind === "InsertConsolidated")) {
    const tier2 = payload.tier2;
    if (
      !isRecord(tier2) ||
      tier2.verdict !== "clean" ||
      typeof tier2.detail !== "string"
    ) {
      return {
        ok: false,
        error: "dedup insert has no clean proposal-time Tier 2 verdict — refusing to apply unjudged content",
      };
    }
  }
  const episodeIds = Array.isArray(payload.episodeIds)
    ? (payload.episodeIds as unknown[]).filter(isInt)
    : [];
  const groups = Array.isArray(payload.groups)
    ? (payload.groups as unknown[]).filter((g): g is string => typeof g === "string")
    : [];
  const fingerprint = typeof payload.fingerprint === "string" ? payload.fingerprint : "";
  const runId = isInt(payload.runId) ? payload.runId : null;
  const runCtx = { spaceId, runId, now: new Date().toISOString() };

  let resultingEntryId: number | null = null;
  let outcome: "consolidated" | "strengthened" = "consolidated";
  for (const m of mutations) {
    if (m.kind === "InsertConsolidated") {
      outcome = "consolidated";
      // Idempotency: a consolidated entry with the same slot + content
      // already stands — use it, do not insert a duplicate.
      const existing = sqlite
        .prepare(
          `SELECT id FROM user_model WHERE space_id = ? AND slot = ? AND content = ?
           AND origin = 'consolidated' AND invalid_at IS NULL LIMIT 1`,
        )
        .get(spaceId, m.entry.slot, m.entry.content.trim()) as { id: number } | undefined;
      if (existing) {
        resultingEntryId = existing.id;
        continue;
      }
      const res = await applyConsolidationMutation(sqlite, runCtx, m);
      if (res.status === "applied" && res.entryId != null) {
        resultingEntryId = res.entryId;
        continue;
      }
      if (res.status === "rejected" && res.entryId != null) {
        // Covered by a stated row (or similar) — the content already stands
        // under that entry; record the outcome against it, do not fail.
        resultingEntryId = res.entryId;
        continue;
      }
      return { ok: false, error: `insert rejected: ${res.error ?? "unknown"} — ${res.detail ?? ""}`.slice(0, 200) };
    }
    // AppendEvidence
    outcome = "strengthened";
    if (m.kind !== "AppendEvidence") {
      return { ok: false, error: `dedup applier does not apply ${m.kind} mutations` };
    }
    const row = sqlite
      .prepare(`SELECT id, evidence_ids FROM user_model WHERE id = ? AND space_id = ?`)
      .get(m.entryId, spaceId) as { id: number; evidence_ids: string } | undefined;
    if (!row) return { ok: false, error: `append target entry ${m.entryId} not found` };
    let have: number[] = [];
    try {
      const parsed: unknown = JSON.parse(row.evidence_ids);
      if (Array.isArray(parsed)) {
        have = parsed
          .filter(
            (x): x is { type: unknown; id: number } =>
              isRecord(x) && x.type === "episode" && isInt(x.id),
          )
          .map((x) => x.id);
      }
    } catch {
      have = [];
    }
    const wanted = m.evidence.filter((e) => e.type === "episode").map((e) => e.id);
    if (wanted.every((id) => have.includes(id))) {
      resultingEntryId = row.id;
      continue;
    }
    const res = await applyConsolidationMutation(sqlite, runCtx, m);
    if (res.status === "applied") {
      resultingEntryId = res.entryId ?? row.id;
      continue;
    }
    return { ok: false, error: `append rejected: ${res.error ?? "unknown"} — ${res.detail ?? ""}`.slice(0, 200) };
  }
  // Record the episode outcomes (upsert — a retry re-records the same rows).
  for (const episodeId of episodeIds) {
    recordOutcome(sqlite, spaceId, episodeId, outcome, resultingEntryId, groups, fingerprint, runId);
  }
  return { ok: true, detail: { entryId: resultingEntryId } };
};

registerBrainApplier("brain_belief", applyBrainBelief);
registerBrainApplier("brain_stated", applyBrainStated);
registerBrainApplier("brain_dedup", applyBrainDedup);

// brain_user_model has no producer in this increment (updateUserModel has no
// production callers; W3 writes go through the dedup path) and therefore no
// applier — a proposal of that kind cannot be approved ("no applier
// registered"), by design rather than by accident.
