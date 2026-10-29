import { Router } from "express";
import type { AppContext } from "../../context.js";
import { InsightsRepo } from "../../repositories/insights.repo.js";
import { runSynthesis, synthesisOptionsFor } from "../../synthesis/engine.js";
import { runContradictionScan, contradictionOptionsFor } from "../../synthesis/contradictions.js";
import { buildDailyDigest } from "../../synthesis/dailyDigest.js";
import { buildEmotionalTrajectory } from "../../analysis/emotional.js";
import { buildDormantList } from "../../analysis/dormant.js";
import { buildEvolutionLinks } from "../../analysis/temporalChains.js";
import { buildLifeAreaCounts } from "../../analysis/lifeAreas.js";
import { buildSelfReview } from "../../analysis/selfReview.js";
import { buildAwayDigest, markSeen } from "../../analysis/awayDigest.js";
import { spaceOf, rateLimit } from "../middleware.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";

// Most of this router is cheap reads, but /run and /contradictions call the LLM —
// give just those two a tighter ceiling than the generic /api limit.
const llmLimiter = rateLimit({ max: Number(process.env.LLM_RATE_LIMIT_MAX ?? 20) });

export function digestRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/digest -> recent synthesized insights
  r.get("/", (_req, res) => {
    res.json(new InsightsRepo(ctx.handle, spaceOf(res)).recent());
  });

  // GET /api/digest/beliefs -> what she's consolidated about you (dream cycles).
  // Newest first; each carries its member (evidence) count.
  r.get("/beliefs", (_req, res) => {
    const spaceId = spaceOf(res);
    const rows = ctx.handle.sqlite
      .prepare(
        `SELECT n.id, n.content, n.created_at AS createdAt,
           (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND e.source = n.id AND e.relationship = 'summarizes') AS evidence
         FROM nodes n
         WHERE n.space_id = ? AND n.kind = 'belief' AND n.deleted_at IS NULL
         ORDER BY n.id DESC LIMIT 12`,
      )
      .all(spaceId) as { id: number; content: string; createdAt: string; evidence: number }[];
    res.json(rows);
  });

  // GET /api/digest/daily -> Soumaya's daily digest (free, no LLM call)
  r.get("/daily", (_req, res) => {
    res.json(buildDailyDigest(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/emotional -> mood-over-time trajectory + detected patterns (free, offline)
  r.get("/emotional", (_req, res) => {
    res.json(buildEmotionalTrajectory(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/dormant -> dormant skills/goals/projects worth reviving (free, offline)
  r.get("/dormant", (_req, res) => {
    res.json(buildDormantList(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/evolution -> how a thread of thinking evolved over time (free, offline)
  r.get("/evolution", (_req, res) => {
    res.json(buildEvolutionLinks(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/life-areas -> distribution of memories across life-areas (free, offline)
  r.get("/life-areas", (_req, res) => {
    res.json(buildLifeAreaCounts(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/self-review -> Soumaya's read-only coverage self-check (free, offline)
  r.get("/self-review", (_req, res) => {
    res.json(buildSelfReview(ctx.handle, spaceOf(res)));
  });

  // GET /api/digest/away -> "while you were away" digest since last visit (read-only)
  r.get("/away", (_req, res) => {
    res.json(buildAwayDigest(ctx.handle, spaceOf(res)));
  });

  // POST /api/digest/away/seen -> advance the "last visit" window to now
  r.post("/away/seen", (_req, res) => {
    markSeen(ctx.handle, spaceOf(res), new Date().toISOString());
    res.json({ ok: true });
  });

  // POST /api/digest/run -> scan for latent connections and synthesize new insights.
  // REG-151 / INS-04: the similarity gate adapts to the embeddings provider
  // (0.5 under hash, 0.82 for real embeddings) — the same provider-awareness
  // the contradiction scan below already has. NOTE (REG-227 cross-link): the
  // maintenance latent job in maintenance/agent.ts feeds latent insights
  // through its OWN explicit flat gate (threshold 0.85) — it does not go
  // through this route or synthesisOptionsFor, so it is untouched here and
  // stays tracked at REG-227.
  r.post("/run", llmLimiter, async (_req, res) => {
    const created = await runSynthesis(ctx.handle, ctx.llm, synthesisOptionsFor(ctx.embeddings.model), spaceOf(res));
    res.json(created);
  });

  // POST /api/digest/contradictions -> scan same-topic memories for conflicts
  // (changed beliefs / reversed goals / shifting identity). Offline-safe — the
  // similarity gate adapts to the embeddings provider (hash cosines run lower).
  r.post("/contradictions", llmLimiter, async (_req, res) => {
    const created = await runContradictionScan(
      ctx.handle,
      ctx.llm,
      contradictionOptionsFor(ctx.embeddings.model),
      spaceOf(res),
    );
    res.json(created);
  });

  // POST /api/digest/insights/:id/resolve -> the user reconciled (or dismissed) a
  // surfaced insight. Deletes it and, for contradictions, tends both memories —
  // the "RECONCILE" badge used to be display-only with no affordance behind it.
  r.post("/insights/:id/resolve", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const row = ctx.handle.sqlite
      .prepare(`SELECT node_a AS a, node_b AS b FROM insights WHERE id = ? AND space_id = ?`)
      .get(id, spaceId) as { a: number; b: number } | undefined;
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const repo = new NodesRepo(ctx.handle, spaceId);
    repo.tend(row.a);
    repo.tend(row.b);
    ctx.handle.sqlite.prepare(`DELETE FROM insights WHERE id = ? AND space_id = ?`).run(id, spaceId);
    res.json({ ok: true });
  });

  return r;
}
