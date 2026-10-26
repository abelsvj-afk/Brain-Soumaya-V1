import { and, desc, eq, or } from "drizzle-orm";
import type { AppContext } from "../context.js";
import { findCandidates } from "../synthesis/engine.js";
import { researchSteer } from "../analysis/researchType.js";
import { pickResearchTarget } from "./researchPriority.js";
import { rationaleFor } from "./jobRationale.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { UserPersonaRepo } from "../repositories/knowledge.repo.js";
import { deriveBehavior } from "../persona/behavior.js";
import { GraphService } from "../graph/service.js";
import { EconomyRepo, FUEL_JOB_COST } from "../economy.js";
import { insights, agentLogs, settings, nodes, edges, dailyLogs } from "../db/schema.js";
import { upsertEmbedding, getEmbedding, knn } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import { mergeMemories, combineContent } from "../analysis/dedup.js";
import { getPreferences, localDay } from "../agent/notify/policy.js";
import { parseTolerantMs } from "../lib/time.js";

/**
 * Soumaya's maintenance brain, extracted from the HTTP route so BOTH the
 * browser-driven loop (api/routes/maintenance.ts) AND the server-side 24/7
 * autonomy loop (index.ts) run the exact same job selection + execution. This is
 * the single source of truth — keep all gating here.
 *
 * Gating (unchanged): Research Mode (per-space `space_meta.research_enabled`) + the USD
 * budget gate everything LLM-backed; Fuel is a per-brain softer throttle on the
 * discretionary *expansion* jobs (research + sector_vibe) only. Free upkeep
 * (pruning/harmonization/calibration/patrol) always runs.
 */

export type JobType =
  | "synthesis"
  | "calibration"
  | "patrol"
  | "pruning"
  | "harmonization"
  | "research"
  | "merging"
  | "sector_vibe"
  | "daily_log";

/**
 * A short, business-style breakdown of WHY she chose this — derived from graph
 * facts, never an LLM call, so every decision is explainable even offline.
 */
export interface JobRationale {
  objective: string; // WHAT she's doing, in one line
  why: string; // the signal that triggered it (the "diagnosis")
  benefit: string; // what the user gets out of it
}

export interface AgentJob {
  type: JobType;
  targets: number[];
  description: string;
  rationale?: JobRationale;
}

/** Jobs that burn Fuel (discretionary expansion). Everything else is free. */
const FUEL_JOBS = new Set<JobType>(["research", "sector_vibe"]);
// Paid / discretionary cloud-LLM jobs. `selectJob` already refuses to hand these out
// with Research Mode off, but `complete-job` reaches `executeJob` with client-supplied
// type/targets, so we re-check the SAME gate here — otherwise a tenant could loop these
// to drain the shared deployment budget with Research Mode off. The free core duties
// (daily_log genesis, calibration/pruning/harmonization/patrol) stay ungated.
const PAID_JOBS = new Set<JobType>(["synthesis", "merging", "research", "sector_vibe"]);

/** Best-effort label for a node id (falls back to "#id" / "a memory"). */
function labelOf(nodesRepo: NodesRepo, id: number | undefined): string {
  if (id == null) return "a memory";
  try {
    return nodesRepo.getById(id)?.label ?? `#${id}`;
  } catch {
    return `#${id}`;
  }
}

/**
 * Build the explainable rationale for a job from the graph itself (no LLM, so it
 * always works offline). This is the single source of truth used both when a job
 * is *selected* (for the live "what she's doing" view) and when it's *executed*
 * (persisted to agent_logs.result), so the two never drift.
 *
 * The philosophy the user asked for is baked into the wording: research is NOT a
 * default — it's reserved for genuine gaps/blind spots — and synthesis exists to
 * connect the dots across old and new memories over time.
 */
export function buildRationale(
  ctx: AppContext,
  spaceId: string,
  type: JobType,
  targets: number[],
  detail?: string,
): JobRationale {
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  const a = labelOf(nodesRepo, targets[0]);
  const b = labelOf(nodesRepo, targets[1]);
  return rationaleFor(type, a, b, detail);
}

/** Assemble a job with its explainable rationale attached. `detail` (research-only —
 *  see jobRationale.ts's own doc comment) carries the SAME scored-factors text already
 *  embedded in `description`, so the rationale card and the description never disagree. */
function mkJob(
  ctx: AppContext,
  spaceId: string,
  type: JobType,
  targets: number[],
  description: string,
  detail?: string,
): AgentJob {
  return { type, targets, description, rationale: buildRationale(ctx, spaceId, type, targets, detail) };
}

/**
 * Per-space "Research Mode" toggle (paid autonomous work). Stored on space_meta so
 * one brain can't flip paid work on/off for every tenant. A space that has never
 * set it (NULL) falls back to the legacy global settings row.
 */
export function researchEnabled(ctx: AppContext, spaceId: string): boolean {
  const row = ctx.handle.sqlite
    .prepare(`SELECT research_enabled FROM space_meta WHERE space_id = ?`)
    .get(spaceId) as { research_enabled: string | null } | undefined;
  if (row?.research_enabled != null) return row.research_enabled === "true";
  return (
    ctx.handle.db.select().from(settings).where(eq(settings.key, "research_enabled")).get()
      ?.value === "true"
  );
}

/** Write the per-space Research Mode flag (creates the meta row if needed). */
export function setResearchEnabled(ctx: AppContext, spaceId: string, on: boolean): void {
  ctx.handle.sqlite
    .prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`)
    .run(spaceId);
  ctx.handle.sqlite
    .prepare(`UPDATE space_meta SET research_enabled = ? WHERE space_id = ?`)
    .run(String(on), spaceId);
}

/** Most-recent memories scanned for near-duplicate merging each tick. */
const MERGE_SCAN_LIMIT = 50;
/** Two memories must be at least this similar to fuse (selection AND execution). */
export const MERGE_SIMILARITY = 0.96;

/** Cosine similarity of two stored embeddings (L2-normalized → plain dot product). */
function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/**
 * In-memory job claim guard (idempotency). The browser maintenance loop and the
 * server-side 24/7 loop both poll /next-job against the SAME single Fly process,
 * so a short-lived in-process claim is enough to stop them double-running the same
 * job: the first caller gets the real job + records its signature; a second caller
 * within the TTL gets a harmless patrol instead. (One process today; a multi-
 * instance deploy would need a DB `claimed_at` lock — noted in TASKS.)
 */
const issuedJobs = new Map<string, number>();
const CLAIM_TTL_MS = 20_000;

function withClaim(ctx: AppContext, spaceId: string, job: AgentJob | null): AgentJob | null {
  if (!job || job.type === "patrol") return job; // patrol is idempotent — never gated
  const sig = `${spaceId}:${job.type}:${job.targets.join(",")}`;
  const now = Date.now();
  const exp = issuedJobs.get(sig);
  if (exp && exp > now) {
    // Just handed this exact job to another caller — give this one a no-op patrol.
    return mkJob(ctx, spaceId, "patrol", [], "Routine patrol & health check.");
  }
  issuedJobs.set(sig, now + CLAIM_TTL_MS);
  if (issuedJobs.size > 256) for (const [k, v] of issuedJobs) if (v <= now) issuedJobs.delete(k);
  return job;
}

/**
 * User-requested high-priority maintenance: a small per-space queue of node ids
 * the user asked Soumaya to tend NOW. selectJob drains this before its normal
 * ladder, so a "tend this" tap gets attention on the next tick. In-memory (one
 * Fly process); requests are best-effort and naturally expire when drained.
 */
const requestedJobs = new Map<string, number[]>();

/** Enqueue a node for priority maintenance (called by the route). */
export function requestMaintenance(spaceId: string, nodeId: number): void {
  const q = requestedJobs.get(spaceId) ?? [];
  if (!q.includes(nodeId)) q.push(nodeId);
  requestedJobs.set(spaceId, q.slice(-20)); // cap the backlog
}

/** Build the best available job for a user-requested node, or null to skip it. */
function jobForRequest(ctx: AppContext, spaceId: string, id: number): AgentJob | null {
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  const node = nodesRepo.getById(id);
  if (!node) return null;
  const economy = new EconomyRepo(ctx.handle, spaceId);
  const expansionOn = researchEnabled(ctx, spaceId) && !ctx.usage.overBudget() && economy.canRunJob();
  // Richest action first: deep-dive research (if Research Mode + fuel allow).
  if (expansionOn) {
    return mkJob(ctx, spaceId, "research", [id], `On request: deep-dive research on "${node.label}".`);
  }
  // Else pair it with its nearest not-yet-linked neighbour for synthesis.
  const emb = getEmbedding(ctx.handle.sqlite, id);
  if (emb && researchEnabled(ctx, spaceId) && !ctx.usage.overBudget()) {
    const edges = new EdgesRepo(ctx.handle, spaceId);
    const hit = knn(ctx.handle.sqlite, emb, 4, spaceId).find(
      (h) => h.nodeId !== id && !edges.exists(id, h.nodeId) && !edges.exists(h.nodeId, id),
    );
    if (hit) return mkJob(ctx, spaceId, "synthesis", [id, hit.nodeId], `On request: connecting "${node.label}".`);
  }
  // Free fallback — recalibrate its mass so something visibly happens offline.
  return mkJob(ctx, spaceId, "calibration", [id], `On request: recalibrating "${node.label}".`);
}

/** The research-gap job as a standalone option for the planner (or null). Uses the
 *  same scored picker (#2) as the ladder rung. */
function researchGapJob(ctx: AppContext, spaceId: string): AgentJob | null {
  const economy = new EconomyRepo(ctx.handle, spaceId);
  if (!(researchEnabled(ctx, spaceId) && !ctx.usage.overBudget() && economy.canRunJob())) return null;
  const pick = pickResearchTarget(ctx, spaceId);
  if (!pick) return null;
  const factorsText = pick.factors.length ? pick.factors.join(", ") : undefined;
  const why = factorsText ? ` — prioritized for ${factorsText}` : "";
  return mkJob(ctx, spaceId, "research", [pick.id], `Gap-filling: deep-dive research on a high-priority memory${why}.`, factorsText);
}

/** Compact, cheap brain summary for the planner's decision. */
function brainSummary(ctx: AppContext, spaceId: string): string {
  const s = ctx.handle.sqlite;
  const nodes = (s.prepare(`SELECT COUNT(*) c FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind NOT IN ('action','moc'))`).get(spaceId) as { c: number }).c;
  const edges = (s.prepare(`SELECT COUNT(*) c FROM edges WHERE space_id = ?`).get(spaceId) as { c: number }).c;
  const cold = (s.prepare(`SELECT COUNT(*) c FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND last_tended_at IS NOT NULL AND julianday('now') - julianday(last_tended_at) > 14`).get(spaceId) as { c: number }).c;
  return `${nodes} memories, ${edges} connections, ${cold} cooling from neglect.`;
}

/**
 * Choose the next meaningful job for a brain, or null if there's nothing to do.
 * Drains user-requested priority work first, then the deterministic ladder. When a
 * cloud LLM with a planner is available, it may choose between the ladder's pick and
 * a strategic alternative (the ladder is always the fallback). All wrapped with an
 * idempotency claim so concurrent pollers don't double-execute.
 */
export async function selectJob(ctx: AppContext, spaceId: string): Promise<AgentJob | null> {
  const q = requestedJobs.get(spaceId);
  while (q && q.length > 0) {
    const id = q.shift()!;
    const job = jobForRequest(ctx, spaceId, id);
    if (job) return withClaim(ctx, spaceId, job);
  }

  const base = selectJobInner(ctx, spaceId);
  // Optional LLM planner: pick between the deterministic choice and a research-gap
  // alternative. Absent/erroring → the ladder stands (always-available fallback).
  if (base && ctx.llm.planJob && researchEnabled(ctx, spaceId) && !ctx.usage.overBudget()) {
    const options: AgentJob[] = [base];
    const alt = researchGapJob(ctx, spaceId);
    if (alt && alt.targets.join(",") !== base.targets.join(",")) options.push(alt);
    if (options.length > 1) {
      try {
        const idx = await ctx.llm.planJob(
          brainSummary(ctx, spaceId),
          options.map((o) => ({ type: o.type, objective: o.rationale?.objective ?? o.description })),
        );
        const chosen = options[idx] ?? base;
        return withClaim(ctx, spaceId, chosen);
      } catch {
        /* planner failed — the deterministic ladder stands */
      }
    }
  }
  return withClaim(ctx, spaceId, base);
}

function selectJobInner(ctx: AppContext, spaceId: string): AgentJob | null {
  const economy = new EconomyRepo(ctx.handle, spaceId);
  const llmOn = researchEnabled(ctx, spaceId) && !ctx.usage.overBudget();
  const expansionOn = llmOn && economy.canRunJob();
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);

  // Daily Log — once per day per brain, when there's enough to summarize.
  // The "day" is the SPACE's local day (owner decision 2026-10-20 — audit gap
  // #9; timezone from space_meta via the notify layer, the same source quiet
  // hours/digest use), never the UTC day.
  const tz = getPreferences(ctx.handle.sqlite, spaceId).timezone;
  const today = localDay(new Date(), tz);
  // Day membership is DERIVED from each row's created_at instant in the space
  // timezone — not from the stored `date` string — because rows written before
  // the changeover were keyed by UTC day. Deriving keeps history reading
  // consistently on the new basis without rewriting any stored row. Rows whose
  // created_at won't parse fall back to their stored date.
  const recentLogs = ctx.handle.db
    .select({ date: dailyLogs.date, createdAt: dailyLogs.createdAt })
    .from(dailyLogs)
    .where(eq(dailyLogs.spaceId, spaceId))
    .orderBy(desc(dailyLogs.id))
    .limit(40)
    .all();
  const logExists = recentLogs.some((r) => {
    const ms = parseTolerantMs(r.createdAt);
    return Number.isFinite(ms) ? localDay(new Date(ms), tz) === today : r.date === today;
  });
  // Genesis log: a brand-new brain (no log ever) gets its first Captain's Log as
  // soon as it has a memory — even offline (heuristic generateDailyLog works with
  // no key), so a new user immediately sees Soumaya narrating their galaxy.
  const everLogged = ctx.handle.db
    .select()
    .from(dailyLogs)
    .where(eq(dailyLogs.spaceId, spaceId))
    .get();
  const nodeCount = nodesRepo.count();
  if (!logExists && nodeCount >= 1 && (llmOn ? nodeCount > 5 : !everLogged)) {
    return mkJob(
      ctx,
      spaceId,
      "daily_log",
      [],
      everLogged ? "Captain's Log: Summarizing today's brain evolution." : "Genesis Log: Soumaya's first entry for this brain.",
    );
  }

  // 0. Merging — near-duplicate memories (similarity ≥ MERGE_SIMILARITY). Only the
  // most recent memories are scanned: duplicates arrive with new input, and older
  // ones were already checked/merged on earlier passes. Bounds this from an
  // O(n) knn-per-node full scan every tick to a small constant (perf: Gap #4).
  if (llmOn) {
    const recent = nodesRepo.all().slice(-MERGE_SCAN_LIMIT);
    for (const node of recent) {
      const emb = getEmbedding(ctx.handle.sqlite, node.id);
      if (!emb) continue;
      const hits = knn(ctx.handle.sqlite, emb, 2, spaceId);
      const redundant = hits.find((h) => h.nodeId !== node.id && h.similarity >= MERGE_SIMILARITY);
      if (redundant) {
        return mkJob(
          ctx,
          spaceId,
          "merging",
          [node.id, redundant.nodeId],
          "Memory Fusion: Detecting and consolidating redundant information nodes.",
        );
      }
    }
  }

  const candidates = findCandidates(ctx.handle, { threshold: 0.85, k: 5, minHops: 3, maxCandidates: 15 }, spaceId);
  let c0 = null;
  for (const candidate of candidates) {
    const exists = ctx.handle.db
      .select()
      .from(insights)
      .where(
        and(
          eq(insights.spaceId, spaceId),
          or(
            and(eq(insights.nodeA, candidate.a), eq(insights.nodeB, candidate.b)),
            and(eq(insights.nodeA, candidate.b), eq(insights.nodeB, candidate.a))
          )
        )
      )
      .get();
    if (!exists) {
      c0 = candidate;
      break;
    }
  }
  if (llmOn && c0) {
    return mkJob(
      ctx,
      spaceId,
      "synthesis",
      [c0.a, c0.b],
      "Synthesizing latent connection between semantically related memories.",
    );
  }

  // 2. Research — NOT a default. Reserved for a genuine GAP, and now SCORED (#2): among
  // under-connected important memories, pick the most research-WORTHY by emotional
  // intensity / contradiction / identity / goal / recurring theme (minus noise). If
  // nothing clears the floor she does no research and lets synthesis keep connecting.
  if (expansionOn) {
    const pick = pickResearchTarget(ctx, spaceId);
    if (pick) {
      const factorsText = pick.factors.length ? pick.factors.join(", ") : undefined;
      const why = factorsText ? ` — prioritized for ${factorsText}` : "";
      return mkJob(
        ctx,
        spaceId,
        "research",
        [pick.id],
        `Gap-filling: deep-dive research on a high-priority memory${why}.`,
        factorsText,
      );
    }
  }

  // 3. Pruning — a weak associative link.
  const weakEdge = ctx.handle.sqlite
    .prepare(`SELECT id, source, target FROM edges WHERE space_id = ? AND weight < 0.25 ORDER BY weight ASC LIMIT 1`)
    .get(spaceId) as { id: number; source: number; target: number } | undefined;
  if (weakEdge) {
    return mkJob(
      ctx,
      spaceId,
      "pruning",
      [weakEdge.source, weakEdge.target],
      "Pruning weak or redundant associative link to maintain graph clarity.",
    );
  }

  // 4. Harmonization — a node whose emotion deviates from its neighbors'.
  const erraticNode = ctx.handle.sqlite
    .prepare(
      `SELECT n.id FROM nodes n
       JOIN (
         SELECT e.node_id, AVG(nb.emotional_weight) AS cluster_avg
         FROM (
           SELECT source AS node_id, target AS other FROM edges
           UNION ALL SELECT target AS node_id, source AS other FROM edges
         ) e
         JOIN nodes nb ON nb.id = e.other AND nb.emotional_weight IS NOT NULL
         GROUP BY e.node_id
       ) c ON c.node_id = n.id
       WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.emotional_weight IS NOT NULL
         AND ABS(n.emotional_weight - c.cluster_avg) > 0.4 LIMIT 1`,
    )
    .get(spaceId) as { id: number } | undefined;
  if (erraticNode) {
    return mkJob(ctx, spaceId, "harmonization", [erraticNode.id], "Harmonizing emotional resonance across memory cluster.");
  }

  // 5. Sector Vibe — chart a dense cluster (costs fuel).
  const cluster = ctx.handle.sqlite
    .prepare(
      `SELECT n.id FROM nodes n
       JOIN (
         SELECT node_id, COUNT(*) as deg
         FROM (SELECT source as node_id FROM edges UNION ALL SELECT target as node_id FROM edges)
         GROUP BY node_id
       ) d ON d.node_id = n.id
       WHERE n.space_id = ? AND n.deleted_at IS NULL
       AND n.content NOT LIKE '%--- Sector Vibe ---%' AND d.deg >= 3
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(spaceId) as { id: number } | undefined;
  if (expansionOn && cluster) {
    return mkJob(ctx, spaceId, "sector_vibe", [cluster.id], "Atmospheric scan: Charting the vibe of a local memory sector.");
  }

  // 6. Calibration — recompute mass for an under-weighted hub.
  const hub = ctx.handle.sqlite
    .prepare(
      `SELECT n.id FROM nodes n
       JOIN (
         SELECT node_id, COUNT(*) as deg
         FROM (SELECT source as node_id FROM edges UNION ALL SELECT target as node_id FROM edges)
         GROUP BY node_id
       ) d ON d.node_id = n.id
       WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.importance < 0.5 AND d.deg > 5
       ORDER BY d.deg DESC LIMIT 1`,
    )
    .get(spaceId) as { id: number } | undefined;
  if (hub) {
    return mkJob(ctx, spaceId, "calibration", [hub.id], "Recalibrating gravitational mass for highly-connected memory hub.");
  }

  // 7. Patrol — fallback health check on a random node.
  const all = nodesRepo.all();
  const randomNode = all[Math.floor(Math.random() * all.length)];
  if (randomNode) {
    return mkJob(ctx, spaceId, "patrol", [randomNode.id], "Routine maintenance patrol and health check.");
  }

  return null;
}

/**
 * Execute a job: perform its mutations, log it, and spend Fuel if it's an
 * expansion job. Returns a human description on success, or null for a no-op
 * (e.g. a target went missing). Mirrors the original complete-job branches.
 */
export async function executeJob(
  ctx: AppContext,
  spaceId: string,
  job: { type: JobType; targets: number[]; description?: string },
): Promise<string | null> {
  const { type, targets } = job;
  // Re-enforce the maintenance gate for paid jobs (defense for the public complete-job
  // route): Research Mode on + under the USD budget, and — for fuel-cost jobs — enough
  // Fuel. Without this a crafted complete-job request bypasses selectJob's gating.
  if (PAID_JOBS.has(type)) {
    if (!researchEnabled(ctx, spaceId) || ctx.usage.overBudget()) return null;
    if (FUEL_JOBS.has(type) && !new EconomyRepo(ctx.handle, spaceId).canRunJob()) return null;
  }
  // Execution dedupe: the 20s issuance claim can expire during the browser's
  // next-job → complete-job round trip, after which the 24/7 loop re-selects the
  // same job — research/sector_vibe would double-append and double-spend. If the
  // identical job already committed recently, this one is a no-op. (Patrol is
  // idempotent and cheap; leave it out.)
  if (type !== "patrol") {
    const dup = ctx.handle.sqlite
      .prepare(
        `SELECT 1 FROM agent_logs WHERE space_id = ? AND action = ? AND targets = ?
         AND created_at >= datetime('now', '-10 minutes')`,
      )
      .get(spaceId, type, JSON.stringify(targets));
    if (dup) return null;
  }
  const [t0, t1] = targets as [number, number];
  const graph = new GraphService(ctx.handle, spaceId);
  const nodesRepo = new NodesRepo(ctx.handle, spaceId);
  // Capture the explainable rationale BEFORE any mutation (merging soft-deletes a
  // target, so labels must be read up-front). Stored on agent_logs.result.
  const rationale = buildRationale(ctx, spaceId, type, targets);
  let description: string | null = null;

  if (type === "synthesis" && targets.length === 2) {
    const a = nodesRepo.getById(t0);
    const b = nodesRepo.getById(t1);
    if (a && b) {
      // Check if insight already exists to prevent duplicate synthesis!
      const exists = ctx.handle.db
        .select()
        .from(insights)
        .where(
          and(
            eq(insights.spaceId, spaceId),
            or(
              and(eq(insights.nodeA, t0), eq(insights.nodeB, t1)),
              and(eq(insights.nodeA, t1), eq(insights.nodeB, t0))
            )
          )
        )
        .get();
      if (exists) {
        return `Insight already exists between "${a.label}" and "${b.label}".`;
      }

      const { text, score } = await ctx.llm.synthesize(
        { label: a.label, content: a.content },
        { label: b.label, content: b.content },
        0.9,
      );
      ctx.handle.db.insert(insights).values({ spaceId, nodeA: t0, nodeB: t1, text, score }).run();
      nodesRepo.tend(t0);
      nodesRepo.tend(t1);
      description = `Synthesized latent connection between "${a.label}" and "${b.label}".`;
    }
  } else if (type === "calibration" && targets.length === 1) {
    graph.setImportance(t0, null);
    description = `Recalibrated importance for "${graph.getNode(t0)?.label || t0}".`;
  } else if (type === "pruning" && targets.length === 2) {
    ctx.handle.sqlite
      .prepare(
        `DELETE FROM edges WHERE space_id = ? AND ((source = ? AND target = ?) OR (source = ? AND target = ?)) AND weight < 0.25`,
      )
      .run(spaceId, t0, t1, t1, t0);
    description = `Pruned weak connection between node ${t0} and ${t1}.`;
  } else if (type === "harmonization" && targets.length === 1) {
    ctx.handle.sqlite
      .prepare(
        `UPDATE nodes SET emotional_weight = (
           SELECT AVG(n2.emotional_weight) FROM nodes n2
           JOIN edges e ON (e.source = n2.id OR e.target = n2.id)
           WHERE (e.source = ? OR e.target = ?)
         ) WHERE id = ? AND space_id = ?`,
      )
      .run(t0, t0, t0, spaceId);
    description = `Harmonized emotional resonance for "${graph.getNode(t0)?.label || t0}".`;
  } else if (type === "research" && targets.length === 1) {
    const original = nodesRepo.getById(t0);
    // Precondition re-check (complete-job supplies client-crafted targets): a memory
    // already deep-dived doesn't get a second stacked dive (mirrors selection).
    if (original?.content.includes("--- Research Deep Dive ---")) return null;
    if (original) {
      const research = await ctx.llm.research({ label: original.label, content: original.content }, researchSteer(original as any));
      if (research.questions && research.questions.length > 0) {
        nodesRepo.updateResearch(original.id, research.questions, {});
        description = `Researched "${original.label}" and found information gaps. Generated ${research.questions.length} clarifying questions for the pilot.`;
      } else {
        const expandedContent = `${original.content}\n\n--- Research Deep Dive ---\n${research.content}`;
        const newImp = Math.min(1.0, (original.importance ?? 0.5) + 0.2);
        ctx.handle.db
          .update(nodes)
          .set({
            content: expandedContent,
            importance: newImp,
            label: research.label || original.label,
            researchQuestions: null,
            researchAnswers: null
          })
          .where(and(eq(nodes.id, original.id), eq(nodes.spaceId, spaceId)))
          .run();
        // REG-190: same "label. content" composition as the edit path (the
        // autonomous research expansion is the same write shape as synthesize).
        upsertEmbedding(ctx.handle.sqlite, original.id, await ctx.embeddings.embed(`${research.label || original.label}. ${expandedContent}`));
        ftsUpsert(ctx.handle.sqlite, original.id, research.label || original.label, expandedContent);
        nodesRepo.tend(original.id);
        nodesRepo.setAgent(original.id, "soumaya"); // attribute the deep-dive to her
        description = `Expanded memory hub "${original.label}" with deep-dive research. Node mass increased.`;
      }
    }
  } else if (type === "merging" && targets.length === 2) {
    const a = nodesRepo.getById(t0);
    const b = nodesRepo.getById(t1);
    if (a && b && t0 !== t1) {
      // Precondition re-check: only true near-duplicates may fuse. complete-job
      // accepts client-supplied targets, so without this ANY two owned memories
      // could be irreversibly merged.
      const embA = getEmbedding(ctx.handle.sqlite, a.id);
      const embB = getEmbedding(ctx.handle.sqlite, b.id);
      if (!embA || !embB || cosine(embA, embB) < MERGE_SIMILARITY) return null;
      // LLM writes the merged narrative; then true-merge so photos/edges/insights/age
      // all follow and nothing is lost. Fall back to a lossless concat if the LLM is off.
      const { text } = await ctx.llm.synthesize(
        { label: a.label, content: a.content },
        { label: b.label, content: b.content },
        1.0,
      );
      const mergedContent = text && text.trim().length > 0 ? text : combineContent(a.content, b.content);
      await mergeMemories(ctx, spaceId, a.id, b.id, mergedContent);
      description = `Fused redundant memory "${b.label}" into "${a.label}". Nothing lost — text, links & photos kept.`;
    }
  } else if (type === "sector_vibe" && targets.length === 1) {
    const center = nodesRepo.getById(t0);
    // Precondition re-check: one vibe per sector hub (mirrors selection's NOT LIKE guard).
    if (center?.content.includes("--- Sector Vibe ---")) return null;
    if (center) {
      const neighbors = ctx.handle.sqlite
        .prepare(
          `SELECT n.id, n.label, n.content FROM nodes n
           JOIN edges e ON (e.source = n.id OR e.target = n.id)
           WHERE n.space_id = ? AND (e.source = ? OR e.target = ?) AND n.id != ? LIMIT 5`,
        )
        .all(spaceId, center.id, center.id, center.id) as { id: number; label: string; content: string }[];
      const vibe = await ctx.llm.summarizeSector(
        [center, ...neighbors].map((n) => ({ label: n.label, content: n.content })),
      );
      ctx.handle.db
        .update(nodes)
        .set({ content: `${center.content}\n\n--- Sector Vibe ---\n${vibe}` })
        .where(and(eq(nodes.id, center.id), eq(nodes.spaceId, spaceId)))
        .run();
      ftsUpsert(ctx.handle.sqlite, center.id, center.label, `${center.content}\n\n--- Sector Vibe ---\n${vibe}`);
      nodesRepo.tend(center.id);
      description = `Charted sector vibe around "${center.label}": ${vibe}`;
    }
  } else if (type === "daily_log") {
    const recentNodes = nodesRepo.recent(10);
    const recentLogs = ctx.handle.sqlite
      .prepare(`SELECT action, description FROM agent_logs WHERE space_id = ? ORDER BY id DESC LIMIT 10`)
      .all(spaceId) as { action: string; description: string }[];
    // Persona awareness: her autonomous log is tailored to who you are (she's
    // aware of you, never becomes you) — plus the live behavioral read so the
    // log's tone matches the stretch you're actually in.
    const personaBase = new UserPersonaRepo(ctx.handle, spaceId).get() ?? "";
    const behavior = deriveBehavior(ctx.handle, spaceId);
    const persona = [personaBase, behavior].filter(Boolean).join("\n\n") || undefined;
    const logText = await ctx.llm.generateDailyLog(
      recentNodes.map((n) => ({ label: n.label, content: n.content })),
      recentLogs.map((l) => l.description),
      persona,
    );
    // Stored under the SPACE's local day (owner decision 2026-10-20), matching
    // selectJobInner's membership read — which derives from created_at, so
    // this row reads back consistently the moment it lands.
    const logDate = localDay(new Date(), getPreferences(ctx.handle.sqlite, spaceId).timezone);
    ctx.handle.db
      .insert(dailyLogs)
      .values({ spaceId, content: logText, date: logDate })
      .run();
    description = `Captain's Log recorded: ${logText.slice(0, 50)}...`;
  } else if (type === "patrol") {
    description = `Performed routine patrol on node ${t0}.`;
  }

  if (description) {
    if (FUEL_JOBS.has(type)) new EconomyRepo(ctx.handle, spaceId).spend(FUEL_JOB_COST);
    ctx.handle.db
      .insert(agentLogs)
      .values({ spaceId, action: type, description, targets: JSON.stringify(targets), result: JSON.stringify(rationale) })
      .run();
  }
  return description;
}
