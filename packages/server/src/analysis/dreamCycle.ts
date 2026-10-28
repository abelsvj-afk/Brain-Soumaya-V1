import { SPECIAL_COLORS } from "@brain/shared";
import type { AppContext } from "../context.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { upsertEmbedding } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import { evolveLore } from "../lore/engine.js";
import { getProposal, proposeWorldChange, type WorldProposal } from "../worlds/mutation.js";
import { localDay, spaceTimezone } from "../agent/notify/policy.js";

/**
 * Dream cycles (Level 2, B2). Like sleep consolidating episodic memory into
 * semantic memory, once per day Soumaya distills the densest cluster of related
 * memories into ONE durable BELIEF about the user — a `kind:"belief"` node that
 * `summarizes` its evidence. Memories stay; UNDERSTANDING compounds, so 500 notes
 * become a worldview she can reason from in chat.
 *
 * Deterministic selection + LLM (or template) consolidation. Budget/Research-Mode
 * gated by the caller. Additive-only — a re-consolidation appends the prior belief
 * as a lore chapter (versioned Chronicle) and never deletes anything.
 */

const BELIEF_COLOR = SPECIAL_COLORS.belief; // heavy indigo — a belief reads distinct in the galaxy
const MIN_CLUSTER = 5; // a belief needs real evidence
const CONFIDENCE_IMPORTANCE = 0.72; // beliefs are weighty → render large

interface Cluster {
  hubId: number;
  memberIds: number[];
  /** An existing belief node already summarizing this hub, if any (→ revise it). */
  existingBeliefId: number | null;
}

/**
 * Pick the cluster most worth consolidating: the highest-degree real memory whose
 * neighborhood (itself + direct neighbors) has ≥ MIN_CLUSTER members and isn't
 * already well-covered by a fresh belief.
 */
function pickCluster(ctx: AppContext, spaceId: string): Cluster | null {
  const s = ctx.handle.sqlite;
  // Candidate hubs: real memories, highest degree first.
  const hubs = s
    .prepare(
      `SELECT n.id,
         (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id)) AS degree
       FROM nodes n
       WHERE n.space_id = ? AND n.deleted_at IS NULL
         AND (n.kind IS NULL OR n.kind NOT IN ('action','moc','belief'))
       ORDER BY degree DESC LIMIT 20`,
    )
    .all(spaceId) as { id: number; degree: number }[];

  for (const hub of hubs) {
    if (hub.degree < MIN_CLUSTER - 1) break; // sorted desc — nothing dense enough left
    // Members = the hub + its direct neighbor memories (no hubs/actions/beliefs).
    const members = s
      .prepare(
        `SELECT DISTINCT m.id FROM edges e
         JOIN nodes m ON m.id = CASE WHEN e.source = ? THEN e.target ELSE e.source END
         WHERE e.space_id = ? AND (e.source = ? OR e.target = ?)
           AND m.deleted_at IS NULL AND (m.kind IS NULL OR m.kind NOT IN ('action','moc','belief'))`,
      )
      .all(hub.id, spaceId, hub.id, hub.id) as { id: number }[];
    const memberIds = [hub.id, ...members.map((m) => m.id)];
    if (memberIds.length < MIN_CLUSTER) continue;

    // Is a belief already summarizing this hub? (revise rather than duplicate)
    const existing = s
      .prepare(
        `SELECT b.id FROM nodes b
         JOIN edges e ON e.source = b.id AND e.target = ?
         WHERE b.space_id = ? AND b.kind = 'belief' AND b.deleted_at IS NULL
           AND e.relationship = 'summarizes' LIMIT 1`,
      )
      .get(hub.id, spaceId) as { id: number } | undefined;

    // Skip a hub whose belief was refreshed in the last 3 days (don't churn).
    if (existing) {
      const fresh = s
        .prepare(
          `SELECT 1 FROM nodes WHERE id = ? AND last_tended_at > datetime('now','-3 days')`,
        )
        .get(existing.id);
      if (fresh) continue;
    }
    return { hubId: hub.id, memberIds, existingBeliefId: existing?.id ?? null };
  }
  return null;
}

/** Offline template belief when no LLM key is present — grounded in the cluster. */
function templateBelief(labels: string[], avgEw: number): string {
  const theme = labels.slice(0, 3).join(", ");
  const tone =
    avgEw <= -0.3 ? "a recurring weight" : avgEw >= 0.3 ? "a source of energy" : "a steady thread";
  return `A cluster of your memories keeps circling ${theme} — ${tone} in how you think.`;
}

/** A distilled belief, before it is written anywhere. */
export interface DistilledBelief {
  hubId: number;
  memberIds: number[];
  existingBeliefId: number | null;
  belief: string;
  confidence: number;
  label: string;
}

/**
 * Distill the densest cluster into a belief text. Pure read + LLM/template —
 * writes nothing. The caller decides whether the belief is applied now
 * (runDreamCycle) or proposed for the owner's approval (proposeDreamCycle).
 */
export async function distillBelief(
  ctx: AppContext,
  spaceId: string,
  useLlm: boolean,
): Promise<DistilledBelief | null> {
  const cluster = pickCluster(ctx, spaceId);
  if (!cluster) return null;

  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  const members = nodesRepo.byIds(cluster.memberIds);
  if (members.length < MIN_CLUSTER) return null;

  const avgEw =
    members.reduce((acc, m) => acc + (m.emotionalWeight ?? 0), 0) / members.length;

  // Distill the belief (LLM when allowed + available, else offline template).
  let belief = "";
  let confidence = 0.5;
  if (useLlm && ctx.llm.consolidate) {
    try {
      const out = await ctx.llm.consolidate(members.map((m) => ({ label: m.label, content: m.content })));
      belief = out.belief;
      confidence = out.confidence;
    } catch {
      /* degrade to template */
    }
  }
  if (!belief) {
    belief = templateBelief(members.map((m) => m.label), avgEw);
    confidence = 0.4;
  }

  const label = belief.length > 60 ? `${belief.slice(0, 57)}…` : belief;
  return { hubId: cluster.hubId, memberIds: cluster.memberIds, existingBeliefId: cluster.existingBeliefId, belief, confidence, label };
}

/**
 * Apply a distilled belief: create or revise the belief node. Idempotent on
 * create — a belief already summarizing this hub with the same content is
 * the same belief; do not duplicate it on a retry. A revise always
 * rewrites and appends a lore chapter (versioned history), even when the
 * distilled text matches the current content — the second dream cycle over
 * the same cluster is a revision event, not a no-op.
 */
export async function applyBelief(
  ctx: AppContext,
  spaceId: string,
  d: DistilledBelief,
): Promise<number> {
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  const edges = new EdgesRepo(ctx.handle, spaceId);
  const members = nodesRepo.byIds(d.memberIds);

  if (d.existingBeliefId != null) {
    const current = nodesRepo.getById(d.existingBeliefId);
    // REVISE: keep the node (its edges/history), append the OLD text as a lore
    // chapter, update content, re-embed + re-index. Nothing is destroyed.
    const prior = current;
    ctx.handle.sqlite
      .prepare(`UPDATE nodes SET label = ?, content = ?, importance = ?, last_tended_at = datetime('now') WHERE id = ? AND space_id = ?`)
      .run(d.label, d.belief, Math.max(CONFIDENCE_IMPORTANCE, d.confidence), d.existingBeliefId, spaceId);
    upsertEmbedding(ctx.handle.sqlite, d.existingBeliefId, await ctx.embeddings.embed(d.belief));
    ftsUpsert(ctx.handle.sqlite, d.existingBeliefId, d.label, d.belief);
    if (prior) evolveLore(ctx.handle, spaceId, "memory", String(d.existingBeliefId), "revised");
    // Make sure every current member is still linked.
    for (const m of members) {
      if (!edges.exists(d.existingBeliefId, m.id)) {
        edges.create({ source: d.existingBeliefId, target: m.id, relationship: "summarizes", weight: 0.85 });
      }
    }
    return d.existingBeliefId;
  }

  // CREATE: idempotency — a belief already summarizing this hub with the
  // same content is the same belief; do not duplicate it on a retry.
  const existing = ctx.handle.sqlite
    .prepare(
      `SELECT b.id FROM nodes b
       JOIN edges e ON e.source = b.id AND e.target = ?
       WHERE b.space_id = ? AND b.kind = 'belief' AND b.deleted_at IS NULL
         AND b.content = ? AND e.relationship = 'summarizes' LIMIT 1`,
    )
    .get(d.hubId, spaceId, d.belief) as { id: number } | undefined;
  if (existing) return existing.id;

  const node = nodesRepo.create(
    {
      label: d.label,
      type: "concept",
      kind: "belief",
      content: d.belief,
      importance: Math.max(CONFIDENCE_IMPORTANCE, d.confidence),
      color: BELIEF_COLOR,
      origin: "agent",
    },
    await ctx.embeddings.embed(d.belief),
  );
  for (const m of members) {
    edges.create({ source: node.id, target: m.id, relationship: "summarizes", weight: 0.85 });
  }
  // Genesis lore chapter so the belief has a story from birth — later revisions
  // append to it (versioned history), never overwrite.
  evolveLore(ctx.handle, spaceId, "memory", String(node.id), "genesis");
  return node.id;
}

/**
 * Run one dream cycle for a space. Returns the belief node id if one was
 * created/revised, else null. LLM-gated by the caller (pass useLlm=false to force
 * the offline template).
 */
export async function runDreamCycle(
  ctx: AppContext,
  spaceId: string,
  useLlm: boolean,
): Promise<number | null> {
  const distilled = await distillBelief(ctx, spaceId, useLlm);
  if (!distilled) return null;
  return applyBelief(ctx, spaceId, distilled);
}

/**
 * Phase 4 — the brain's own mutation needs a gate too: instead of writing
 * the belief, propose it (kind 'brain_belief'). One proposal per hub per
 * space-local day (dedup key); the daily tick marks the day only when a
 * proposal is created, so a pending proposal is not re-proposed every tick.
 */
export async function proposeDreamCycle(
  ctx: AppContext,
  spaceId: string,
  useLlm: boolean,
): Promise<{ proposal: WorldProposal; duplicate: boolean } | null> {
  const distilled = await distillBelief(ctx, spaceId, useLlm);
  if (!distilled) return null;
  // A belief for this hub is already waiting on the owner — do not propose
  // it again (a new day must not duplicate a pending proposal).
  const waiting = ctx.handle.sqlite
    .prepare(
      `SELECT * FROM world_proposals
       WHERE space_id = ? AND kind = 'brain_belief' AND status IN ('pending','deferred','approved')
         AND json_extract(payload_json, '$.hubId') = ?`,
    )
    .get(spaceId, distilled.hubId) as
    | { id: number }
    | undefined;
  if (waiting) {
    const existing = getProposal(ctx.handle.sqlite, spaceId, waiting.id);
    if (existing) return { proposal: existing, duplicate: true };
  }
  const today = localDay(new Date(), spaceTimezone(ctx.handle.sqlite, spaceId));
  const action = distilled.existingBeliefId != null ? "revise" : "create";
  return proposeWorldChange(ctx.handle.sqlite, spaceId, {
    kind: "brain_belief",
    targetKind: "belief",
    targetId: distilled.existingBeliefId ?? distilled.hubId,
    title:
      action === "revise"
        ? `Revise a belief about you`
        : `A new belief about you: “${distilled.label}”`,
    reason:
      action === "revise"
        ? `While dreaming, the brain re-read a cluster of your memories and wants to update a belief it holds about you. The belief itself changes only if you approve — the memories it rests on are untouched.`
        : `While dreaming, the brain distilled a cluster of your memories into one belief about you. It becomes part of how the brain understands you only if you approve — the memories it rests on are untouched.`,
    evidence: distilled.memberIds.map((id) => ({ type: "node", id })),
    payload: {
      action,
      hubId: distilled.hubId,
      memberIds: distilled.memberIds,
      existingBeliefId: distilled.existingBeliefId,
      belief: distilled.belief,
      confidence: distilled.confidence,
      label: distilled.label,
    },
    dedupKey: `brain_belief:hub:${distilled.hubId}:${today}`,
  });
}
