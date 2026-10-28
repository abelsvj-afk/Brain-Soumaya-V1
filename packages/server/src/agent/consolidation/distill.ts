/**
 * W3 Phase C — distillation (design Rev 11 §4.4–§4.6, §5.4; plan
 * Milestone 3). Turns eligible episodes into consolidated user_model
 * entries — or strengthens existing ones — under three hard rules:
 *
 * 1. INSERTION ONLY VIA THE BOUNDARY. Every user_model write here is an
 *    applyConsolidationMutation() call (InsertConsolidated /
 *    AppendEvidence). The boundary computes evidence strength (§4.4)
 *    and consolidated confidence (min(0.69, 0.30 + 0.39·strength))
 *    itself, enforces the ≥2-independent-lineage-groups gate, and runs
 *    the Tier 1/Tier 2 stated-coverage guard. This module never
 *    supplies a confidence anywhere. Phase 4: inserts are PROPOSED,
 *    not applied — but the Tier 2 half of the boundary still runs here,
 *    at proposal time, via evaluateInsertTier2() with the run ctx
 *    (judge + shared budget), and its verdict is stored in the
 *    proposal payload; the applier enforces it and re-runs the full
 *    boundary at approval time.
 * 2. THE LLM PROPOSES, NEVER DECIDES NUMBERS. Theme extraction goes
 *    through an injectable extractor (production: the repo LLM adapter;
 *    tests: stubs). It proposes (content, slot, topic labels, routing,
 *    episode ids). It never proposes a confidence or a strength.
 * 3. NO-LLM PATH (§14). With no extractor — or the run's LLM budget
 *    exhausted — Phase C runs its deterministic strengthening path
 *    only: it may AppendEvidence to existing consolidated entries whose
 *    content matches a candidate episode, and it NEVER creates.
 *
 * Bookkeeping: every processed episode lands in consolidation_episodes
 * with its outcome (consolidated / strengthened / abstained), the
 * resulting entry, the evidence group set (§4.3 lineage keys), and a
 * SHA-256 evidence fingerprint. Episodes already consolidated or
 * strengthened are excluded from future candidate sets; abstained
 * episodes stay eligible so NEW evidence can supersede an abstention
 * by forming a new candidate set (§5.4).
 */
import { createHash } from "node:crypto";
import type { DbHandle } from "../../db/client.js";
import type { RawDb } from "../../db/vec.js";
import type { ConsolidationRunContext } from "./boundary.js";
import { evaluateInsertTier2, type InsertTier2Verdict } from "./boundary.js";
import { contentTokens, tokenJaccard, SLOTS, type Slot } from "../userModel.js";
import { proposeWorldChange } from "../../worlds/mutation.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DistillCandidate {
  episodeId: number;
  summary: string;
  detail: string | null;
  occurredAt: string;
  lineageKey: string | null;
  importance: number;
}

export interface ThemeProposition {
  content: string;
  slot: string;
  topicLabels: string[];
  route: "self" | "world" | "abstain";
  episodeIds: number[];
}

/** Injectable theme extractor (the run's one LLM call site in Phase C). */
export type ThemeExtractor = (
  candidates: DistillCandidate[],
) => Promise<ThemeProposition[]>;

/** Injectable world-model writer for route='world' propositions. */
export type WorldWriter = (prop: ThemeProposition) => Promise<number | null>;

export interface DistillationDeps {
  extractor?: ThemeExtractor | null;
  worldWriter?: WorldWriter | null;
  /** Shared run budget ledger (also debited by boundary Tier 2 calls). */
  budget: { remaining: number };
  maxItems: number;
}

export interface DistillationSummary {
  candidates: number;
  created: number;
  strengthened: number;
  abstained: number;
  deferredOverflow: number;
  llmCalls: number;
  rejected: number;
  /** Phase 4: InsertConsolidated / AppendEvidence outcomes proposed to the
   * owner instead of applied (episode count, not proposal count). */
  proposed: number;
}

export type ConsolidationOutcome = "consolidated" | "strengthened" | "abstained";

/* ------------------------------------------------------------------ */
/* Candidate selection (§4.6/§5.4)                                     */
/* ------------------------------------------------------------------ */

/**
 * Eligible episodes: current (not forgotten), importance ≥ 0.4 (current
 * enrichment's importance, default 0.5 when unenriched — the same
 * default scoreEpisode uses), not already consolidated/strengthened.
 * Ordered never-processed first, then recency (occurred_at DESC): pure
 * recency ordering would starve overflow episodes forever once newer
 * abstentions keep refilling the cap. The caller caps at w3_max_items
 * and the overflow stays eligible for the next run.
 */
export function selectCandidates(
  sqlite: RawDb,
  spaceId: string,
  limit: number,
): DistillCandidate[] {
  const rows = sqlite
    .prepare(
      `SELECT e.id, e.summary, e.occurred_at, e.lineage_key,
              en.detail AS detail, en.importance AS importance,
              ce.episode_id AS processed_id
       FROM episodes e
       LEFT JOIN episode_enrichments en
         ON en.episode_id = e.id AND en.superseded_by IS NULL
       LEFT JOIN consolidation_episodes ce
         ON ce.space_id = e.space_id AND ce.episode_id = e.id
       WHERE e.space_id = ? AND e.forgotten_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM consolidation_episodes cx
           WHERE cx.space_id = e.space_id AND cx.episode_id = e.id
             AND cx.outcome IN ('consolidated','strengthened')
         )
       GROUP BY e.id
       ORDER BY (ce.episode_id IS NOT NULL) ASC, e.occurred_at DESC, e.id DESC
       LIMIT ?`,
    )
    .all(spaceId, Math.max(0, limit)) as {
    id: number;
    summary: string;
    occurred_at: string;
    lineage_key: string | null;
    detail: string | null;
    importance: number | null;
  }[];
  return rows
    .map((r) => ({
      episodeId: r.id,
      summary: r.summary,
      detail: r.detail,
      occurredAt: r.occurred_at,
      lineageKey: r.lineage_key,
      importance: r.importance ?? 0.5,
    }))
    .filter((c) => c.importance >= 0.4);
}

/* ------------------------------------------------------------------ */
/* Bookkeeping (consolidation_episodes)                                */
/* ------------------------------------------------------------------ */

export function evidenceFingerprint(refs: { type: string; id: number }[]): string {
  const canonical = refs
    .map((r) => `${r.type}:${r.id}`)
    .sort()
    .join(",");
  return createHash("sha256").update(canonical).digest("hex");
}

export function recordOutcome(
  sqlite: RawDb,
  spaceId: string,
  episodeId: number,
  outcome: ConsolidationOutcome,
  resultingEntryId: number | null,
  groupSet: string[],
  fingerprint: string,
  runId: number | null,
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO consolidation_episodes
         (space_id, episode_id, outcome, resulting_entry_id, evidence_group_set,
          evidence_fingerprint, last_run_id, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id, episode_id) DO UPDATE SET
         outcome = excluded.outcome,
         resulting_entry_id = excluded.resulting_entry_id,
         evidence_group_set = excluded.evidence_group_set,
         evidence_fingerprint = excluded.evidence_fingerprint,
         last_run_id = excluded.last_run_id,
         updated_at = excluded.updated_at`,
    )
    .run(
      spaceId,
      episodeId,
      outcome,
      resultingEntryId,
      JSON.stringify([...groupSet].sort()),
      fingerprint,
      runId ?? 0,
      now,
      now,
    );
}

function lineageGroupsOf(
  sqlite: RawDb,
  spaceId: string,
  episodeIds: number[],
): string[] {
  if (episodeIds.length === 0) return [];
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT lineage_key FROM episodes
       WHERE space_id = ? AND id IN (${episodeIds.map(() => "?").join(",")})
         AND lineage_key IS NOT NULL`,
    )
    .all(spaceId, ...episodeIds) as { lineage_key: string }[];
  return rows.map((r) => r.lineage_key);
}

/* ------------------------------------------------------------------ */
/* Strengthening match (existing-entry coverage)                       */
/* ------------------------------------------------------------------ */

interface ExistingEntry {
  id: number;
  slot: string;
  content: string;
  topic_labels: string;
  origin: string;
}

function findCoveringEntry(
  sqlite: RawDb,
  spaceId: string,
  slot: string,
  content: string,
  topicLabels: string[],
): ExistingEntry | null {
  const rows = sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, origin FROM user_model
       WHERE space_id = ? AND invalid_at IS NULL AND slot = ?
         AND origin IN ('consolidated','inferred')
       ORDER BY created_at ASC`,
    )
    .all(spaceId, slot) as ExistingEntry[];
  for (const row of rows) {
    let topics: string[] = [];
    try {
      const p = JSON.parse(row.topic_labels) as unknown;
      if (Array.isArray(p)) topics = p.filter((x): x is string => typeof x === "string");
    } catch {
      topics = [];
    }
    const topicOverlap = topics.some((t) => topicLabels.includes(t));
    if (topicOverlap && tokenJaccard(content, row.content) >= 0.5) return row;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Phase C runner                                                      */
/* ------------------------------------------------------------------ */

export async function runDistillation(
  h: DbHandle,
  ctx: ConsolidationRunContext,
  deps: DistillationDeps,
): Promise<DistillationSummary> {
  const sqlite = h.sqlite;
  const spaceId = ctx.spaceId;
  const summary: DistillationSummary = {
    candidates: 0, created: 0, strengthened: 0, abstained: 0,
    deferredOverflow: 0, llmCalls: 0, rejected: 0, proposed: 0,
  };

  const candidates = selectCandidates(sqlite, spaceId, deps.maxItems);
  summary.candidates = candidates.length;
  // Overflow: eligible-but-over-cap episodes are counted by the caller
  // via a second count when needed; here the cap IS the selection.
  const byId = new Map(candidates.map((c) => [c.episodeId, c]));
  const processed = new Set<number>();

  const useExtractor = deps.extractor != null && deps.budget.remaining > 0;

  if (useExtractor) {
    deps.budget.remaining -= 1;
    summary.llmCalls += 1;
    let propositions: ThemeProposition[] = [];
    try {
      propositions = await deps.extractor!(candidates);
    } catch {
      propositions = []; // extractor failure → nothing proposed; episodes stay eligible
    }
    for (const prop of propositions) {
      const episodeIds = prop.episodeIds.filter((id) => byId.has(id));
      if (episodeIds.length === 0) continue;
      const fingerprint = evidenceFingerprint(episodeIds.map((id) => ({ type: "episode", id })));
      const groups = lineageGroupsOf(sqlite, spaceId, episodeIds);
      if (prop.route === "abstain" || !SLOTS.includes(prop.slot as Slot)) {
        for (const id of episodeIds) {
          recordOutcome(sqlite, spaceId, id, "abstained", null, groups, fingerprint, ctx.runId ?? null);
          processed.add(id);
        }
        summary.abstained += episodeIds.length;
        continue;
      }
      if (prop.route === "world") {
        const nodeId = deps.worldWriter ? await deps.worldWriter(prop) : null;
        for (const id of episodeIds) {
          recordOutcome(
            sqlite, spaceId, id,
            nodeId !== null ? "consolidated" : "abstained",
            nodeId, groups, fingerprint, ctx.runId ?? null,
          );
          processed.add(id);
        }
        if (nodeId !== null) summary.created++;
        else summary.abstained += episodeIds.length;
        continue;
      }
      // route === 'self': strengthen a covering entry, else insert.
      const evidence = episodeIds.map((id) => ({ type: "episode" as const, id }));
      const covering = findCoveringEntry(sqlite, spaceId, prop.slot, prop.content, prop.topicLabels);
      if (covering) {
        // Phase 4: PROPOSE the strengthen, do not apply it. No outcome row
        // is recorded — the episodes stay eligible, and the proposal's
        // dedup key (fingerprint of the evidence) keeps a later run from
        // proposing the same strengthen twice. Episodes are marked
        // processed in-memory only, so the tail loop below does not also
        // mark them abstained in this run.
        const { duplicate } = proposeWorldChange(sqlite, spaceId, {
          kind: "brain_dedup",
          targetKind: "user_model",
          targetId: covering.id,
          title: `Strengthen a known fact: “${covering.content.length > 80 ? `${covering.content.slice(0, 77)}…”` : covering.content}”`,
          reason: `Your recent notes add fresh evidence for something the brain already believes about you. Approving adds ${episodeIds.length} note${episodeIds.length === 1 ? "" : "s"} as supporting evidence; rejecting changes nothing and the notes stay as they are.`,
          evidence,
          payload: {
            mutations: [{ kind: "AppendEvidence", entryId: covering.id, evidence }],
            episodeIds, groups, fingerprint, runId: ctx.runId ?? null,
          },
          dedupKey: `brain_dedup:${fingerprint}`,
        });
        if (!duplicate) summary.proposed += episodeIds.length;
        for (const id of episodeIds) processed.add(id);
        continue;
      }
      const validAt = episodeIds
        .map((id) => byId.get(id)!.occurredAt)
        .sort()[0];
      const insertEntry = {
        slot: prop.slot as Slot,
        content: prop.content,
        evidence,
        topicLabels: prop.topicLabels,
        validAt,
      };
      // Phase 4 (Tier 2 restoration): run the SAME Tier 2 evaluation the
      // old auto-apply flow ran inside applyConsolidationMutation — via
      // the boundary, with the run ctx (judge + shared budget) — BEFORE
      // creating the proposal, and store the verdict in the payload.
      // The applier enforces it; a non-clean verdict proposes nothing.
      const tier2: InsertTier2Verdict = await evaluateInsertTier2(sqlite, ctx, insertEntry);
      if (tier2.verdict !== "clean") {
        // Mirror the old flow on a Tier 2 rejection (distill.ts, pristine
        // tip): summary.rejected += episodes, NO outcome row (episodes
        // stay eligible for a later run), processed in-memory so the tail
        // loop does not also mark them abstained. Covers both
        // "contradiction" (judged / deterministic) and "deferred"
        // (budget exhausted — the old flow's stated_state_changed /
        // retryable rejection, which also aborted the run on budget).
        summary.rejected += episodeIds.length;
        for (const id of episodeIds) processed.add(id);
        continue;
      }
      // Phase 4: PROPOSE the insert, do not apply it. Same bookkeeping as
      // the strengthen above — no outcome row, dedup key guards the inbox,
      // processed in-memory only.
      const { duplicate } = proposeWorldChange(sqlite, spaceId, {
        kind: "brain_dedup",
        targetKind: "user_model",
        targetId: null,
        title: `New understanding: “${prop.content.length > 80 ? `${prop.content.slice(0, 77)}…”` : prop.content}”`,
        reason: `The brain read ${episodeIds.length} of your recent note${episodeIds.length === 1 ? "" : "s"} and distilled this into one durable fact about you. It becomes part of how the brain understands you only if you approve; rejecting leaves your notes untouched.`,
        evidence,
        payload: {
          mutations: [{
            kind: "InsertConsolidated",
            entry: insertEntry,
          }],
          episodeIds, groups, fingerprint, runId: ctx.runId ?? null,
          tier2,
        },
        dedupKey: `brain_dedup:${fingerprint}`,
      });
      if (!duplicate) summary.proposed += episodeIds.length;
      for (const id of episodeIds) processed.add(id);
    }
    // Episodes the extractor saw but proposed nothing for: abstained.
    for (const c of candidates) {
      if (processed.has(c.episodeId)) continue;
      recordOutcome(
        sqlite, spaceId, c.episodeId, "abstained", null,
        c.lineageKey ? [c.lineageKey] : [],
        evidenceFingerprint([{ type: "episode", id: c.episodeId }]),
        ctx.runId ?? null,
      );
      summary.abstained++;
    }
    return summary;
  }

  // Deterministic strengthening-only path (§14): match candidate
  // episodes against existing consolidated/inferred entries by content
  // tokens; AppendEvidence via the boundary. NEVER creates entries.
  const entries = sqlite
    .prepare(
      `SELECT id, slot, content, topic_labels, origin FROM user_model
       WHERE space_id = ? AND invalid_at IS NULL AND origin IN ('consolidated','inferred')
       ORDER BY created_at ASC`,
    )
    .all(spaceId) as ExistingEntry[];
  for (const c of candidates) {
    const text = `${c.summary} ${c.detail ?? ""}`;
    let matched: ExistingEntry | null = null;
    for (const e of entries) {
      if (tokenJaccard(text, e.content) >= 0.5) {
        matched = e;
        break;
      }
    }
    if (!matched) continue;
    const evidence = [{ type: "episode" as const, id: c.episodeId }];
    const fingerprint = evidenceFingerprint(evidence);
    // Phase 4: PROPOSE the strengthen, do not apply it (same gate as the
    // extractor path). No outcome row — the episode stays eligible; the
    // dedup key guards the inbox against repeat proposals for the same
    // evidence.
    const { duplicate } = proposeWorldChange(sqlite, spaceId, {
      kind: "brain_dedup",
      targetKind: "user_model",
      targetId: matched.id,
      title: `Strengthen a known fact: “${matched.content.length > 80 ? `${matched.content.slice(0, 77)}…”` : matched.content}”`,
      reason: `A recent note of yours adds fresh evidence for something the brain already believes about you. Approving adds it as supporting evidence; rejecting changes nothing.`,
      evidence,
      payload: {
        mutations: [{ kind: "AppendEvidence", entryId: matched.id, evidence }],
        episodeIds: [c.episodeId],
        groups: c.lineageKey ? [c.lineageKey] : [],
        fingerprint,
        runId: ctx.runId ?? null,
      },
      dedupKey: `brain_dedup:${fingerprint}`,
    });
    if (!duplicate) summary.proposed++;
  }
  return summary;
}

/** Distinct stemmed tokens — used by candidate grouping diagnostics. */
export function candidateTokens(c: DistillCandidate): Set<string> {
  return new Set(contentTokens(`${c.summary} ${c.detail ?? ""}`));
}
