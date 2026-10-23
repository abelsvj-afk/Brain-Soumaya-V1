import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ingest, ingestWithContext } from "../../ingestion/pipeline.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { SourcesRepo, extractionHashOf } from "../../repositories/sources.repo.js";
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
    if (kind === "action") {
      // Verbatim V1 (evidence E1): the source is taken BEFORE this
      // branch's trim — the untrimmed submitted text is what is owed
      // preservation. Persistence failure fails the capture honestly:
      // the throw propagates and no node is created.
      const sourcesRepo = new SourcesRepo(ctx.handle, spaceId);
      const { source, created: sourceCreated } = sourcesRepo.persistText({
        kind: "note",
        citationClass: "verbatim_typed",
        text,
        occurredAt,
        idempotencyKey,
      });
      if (!sourceCreated && source.processingStatus === "extracted") {
        // Idempotent replay of an already-saved action capture: return
        // its node instead of creating a duplicate.
        const priorIds = sourcesRepo.nodeIdsWithOriginFrom(source.id);
        const prior = new NodesRepo(ctx.handle, spaceId).byIds(priorIds, { includeSuperseded: true });
        res.json({ nodes: prior, extractedEdges: [], associativeEdges: [] });
        return;
      }
      const expiresAt = new Date(Date.now() + (ttlHours ?? 24) * 3_600_000).toISOString();
      const label = text.trim().split(/\s+/).slice(0, 6).join(" ") || "Action item";
      const vec = await ctx.embeddings.embed(text.trim());
      const node = new NodesRepo(ctx.handle, spaceId).create(
        {
          label,
          type: "daily",
          content: text.trim(),
          importance: 0.12, // small celestial body
          kind: "action",
          expiresAt,
          occurredAt,
          remindAt,
          tags,
        },
        vec,
      );
      // Direct (extraction-free) capture: claim + complete so the
      // processing state machine still terminates honestly.
      const owner = `action:${process.pid}:${Date.now()}`;
      if (sourcesRepo.claim(source.id, owner)) {
        sourcesRepo.linkNodeToAllChunks(node.id, source.id);
        node.hasOriginSource = true;
        sourcesRepo.completeExtraction(source.id, owner, extractionHashOf([node]));
      }
      res.json({ nodes: [node], extractedEdges: [], associativeEdges: [] });
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
