import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ingest, ingestWithContext, processActionCapture } from "../../ingestion/pipeline.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { SourcesRepo } from "../../repositories/sources.repo.js";
import { EconomyRepo, EARN_MEMORY, EARN_LINK } from "../../economy.js";
import { StreakRepo, STREAK_DAY_BONUS } from "../../streak.js";
import { applyCognitiveGravity } from "../../analysis/cognitive.js";
import { generateInquiry } from "../../analysis/inquiry.js";
import { stepSkills } from "../../analysis/skills.js";
import { stepIdentities } from "../../analysis/identity.js";
import { stepDrives } from "../../analysis/drives.js";
import { spaceOf } from "../middleware.js";

const IngestBody = z.object({
  text: z.string().min(1).max(20000),
  // Optional: create a transient day-to-day action item that times out.
  kind: z.enum(["memory", "action"]).optional(),
  ttlHours: z.number().min(1).max(24 * 30).optional(),
  // Optional temporal/context metadata. occurredAt = when it happened (backdatable),
  // remindAt = a future nudge, tags = curated/free labels.
  occurredAt: z.string().datetime().optional(),
  remindAt: z.string().datetime().optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  // Verbatim-Recall V1: capture provenance. sourceKind 'document' marks a
  // file import — its source is the submitted extracted text, citation
  // class 'imported_text' (design section 23: the server never receives
  // file bytes in the current flow; no new upload route). idempotencyKey
  // makes a retried capture return the one existing source.
  sourceKind: z.enum(["note", "document", "chat"]).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export function ingestRoutes(ctx: AppContext): Router {
  const r = Router();
  // POST /api/ingest  { text, kind?, ttlHours?, occurredAt?, remindAt?, tags? }
  r.post("/", async (req, res) => {
    const parsed = IngestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { text: string }" });
      return;
    }
    const { text, kind, ttlHours, occurredAt, remindAt, tags, sourceKind, idempotencyKey } = parsed.data;
    const spaceId = spaceOf(res);

    // Action items are quick to-dos: a small body, no LLM extraction or linking,
    // and an expiry. (Keeps them cheap + transient, distinct from real memories.)
    // REG-144/AG-05: an action NEVER carries remindAt — the firing tool would
    // deliver it while every web reminder surface excludes actions, so the
    // reminder would fire invisibly. The capture paths refuse the combination
    // up front (IngestPanel) and say so; this branch is the backstop that
    // drops a remindAt any other caller sends, so the write paths can never
    // create the data state the read surfaces assert is impossible.
    if (kind === "action") {
      // Verbatim V1 (evidence E1): the source is taken BEFORE this
      // branch's trim — the untrimmed submitted text is what is owed
      // preservation. Persistence failure fails the capture honestly:
      // the throw propagates and no node is created.
      //
      // Fix round 2 (audit P1): the source row persists the direct-
      // capture intent ('action') + params (expiry, occurredAt,
      // tags — never remindAt, REG-144) at capture time, and completion
      // is the shared
      // processActionCapture path — the same crash/retry exactly-once
      // path boot recovery runs. A crash anywhere after persist
      // recovers as an action node, never as an extracted memory.
      const sourcesRepo = new SourcesRepo(ctx.handle, spaceId);
      const expiresAt = new Date(Date.now() + (ttlHours ?? 24) * 3_600_000).toISOString();
      const { source, created: sourceCreated } = sourcesRepo.persistText({
        kind: "note",
        citationClass: "verbatim_typed",
        text,
        occurredAt,
        idempotencyKey,
        captureIntent: "action",
        // REG-144/AG-05: remindAt is NOT persisted for actions — see the
        // backstop comment above this branch.
        captureParams: { expiresAt, occurredAt, tags },
      });
      if (!sourceCreated && source.processingStatus === "extracted") {
        // Idempotent replay of an already-saved action capture: return
        // its node instead of creating a duplicate.
        const priorIds = sourcesRepo.nodeIdsWithOriginFrom(source.id);
        const prior = new NodesRepo(ctx.handle, spaceId).byIds(priorIds, { includeSuperseded: true });
        res.json({ nodes: prior, extractedEdges: [], associativeEdges: [] });
        return;
      }
      const result = await processActionCapture(
        ctx.handle,
        { embeddings: ctx.embeddings, llm: ctx.llm },
        source.id,
        spaceId,
      );
      res.json({ nodes: result.nodes, extractedEdges: [], associativeEdges: [] });
      return;
    }

    const result = await ingestWithContext(
      ctx.handle,
      { embeddings: ctx.embeddings, llm: ctx.llm },
      ctx,
      text,
      spaceId,
      {
        occurredAt,
        remindAt,
        tags,
        sourceKind,
        citationClass: sourceKind === "document" ? "imported_text" : undefined,
        idempotencyKey,
      },
    );
    // Tending the galaxy advances the daily streak; a new day grants a small bonus.
    const { streak, advanced, shieldUsed } = new StreakRepo(ctx.handle, spaceId).touch();
    // Earn fuel for tending the galaxy: a memory + each association it forged,
    // plus the once-per-day streak bonus when a new day was counted.
    const fuelEarned =
      EARN_MEMORY + EARN_LINK * result.associativeEdges.length + (advanced ? STREAK_DAY_BONUS : 0);
    const econ = new EconomyRepo(ctx.handle, spaceId);
    econ.add(fuelEarned);
    // A fresh memory may support an existing Mind anchor (goal/person/…) — pull it
    // into orbit right away, then let Soumaya notice any new structural connection
    // it forms and raise a question about it. Both free/offline + best-effort.
    try {
      applyCognitiveGravity(ctx, spaceId);
      stepSkills(ctx, spaceId); // a logged practice levels the skill right away
      stepIdentities(ctx, spaceId); // affirm/contest identities from the new memory
      stepDrives(ctx, spaceId); // a memory can fulfil an intention / brighten a drive
      generateInquiry(ctx, spaceId);
    } catch {
      /* best-effort; the autonomy loop retries */
    }
    res.json({ ...result, fuelEarned, fuel: econ.toFuel(), streak, streakAdvanced: advanced, shieldUsed: !!shieldUsed });
  });
  return r;
}
