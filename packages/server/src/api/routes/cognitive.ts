import { Router } from "express";
import { z } from "zod";
import { COGNITIVE_KINDS } from "@brain/shared";
import type { AppContext } from "../../context.js";
import { createCognitive, listCognitive, setCognitiveProgress, updateCognitive, unlinkMemory, pruneAnchorLinks } from "../../analysis/cognitive.js";
import { promoteIdeaToGoal, splitIdeaManual, mergeIdeasManual } from "../../analysis/ideas.js";
import { cognitiveEvidence } from "../../analysis/identity.js";
import { formIdentityConstellation } from "../../analysis/identityConstellation.js";
import { personProfile } from "../../analysis/people.js";
import { upcomingEvents } from "../../analysis/future.js";
import { GraphService } from "../../graph/service.js";
import { spaceOf } from "../middleware.js";
import { EconomyRepo, EARN_MIND, EARN_MIND_DAILY_CAP, claimDailyEarn } from "../../economy.js";
import { spaceTimezone, localDay } from "../../agent/notify/policy.js";

const AliasList = z.array(z.string().min(1).max(60)).max(12);
const CreateBody = z.object({
  kind: z.enum(COGNITIVE_KINDS as [string, ...string[]]),
  label: z.string().min(1).max(200),
  content: z.string().max(4000).optional(),
  // Other names this entry answers to (person/place aliases), so vague memories link.
  aliases: AliasList.optional(),
  // For a future_event: when it's due. For a life_vision: an optional target date
  // (never a reminder for this kind — C2.1-locked). Ignored for every other kind.
  date: z.string().datetime().optional(),
});
const ProgressBody = z.object({ value: z.number().min(0).max(1) });
const EditBody = z
  .object({
    label: z.string().min(1).max(200).optional(),
    content: z.string().max(4000).optional(),
    aliases: AliasList.optional(),
    // Life Vision target date (docs/specs/life-vision.md). Only applied for kind
    // "life_vision" (see updateCognitive) — future_event's date remains creation-time
    // only, unchanged. null clears a previously-set date.
    date: z.string().datetime().nullable().optional(),
  })
  .refine((b) => b.label !== undefined || b.content !== undefined || b.aliases !== undefined || b.date !== undefined, {
    message: "Provide label, content, aliases, and/or date",
  });
const UnlinkBody = z.object({ memoryId: z.number().int() });
const SplitBody = z.object({
  newLabel: z.string().min(1).max(200),
  content: z.string().max(4000).optional(),
});
const MergeBody = z
  .object({ keepId: z.number().int(), dropId: z.number().int() })
  .refine((b) => b.keepId !== b.dropId, { message: "keepId and dropId must differ" });

/** The cognitive layer: create/list/track goals, ideas, skills, identity, etc. */
export function cognitiveRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/cognitive?kind=goal -> cognitive objects (all, or one kind).
  r.get("/", (req, res) => {
    const kind = typeof req.query.kind === "string" && (COGNITIVE_KINDS as string[]).includes(req.query.kind)
      ? (req.query.kind as never)
      : undefined;
    res.json(listCognitive(ctx, spaceOf(res), kind));
  });

  // GET /api/cognitive/events/upcoming -> the future-events timeline (soonest first).
  r.get("/events/upcoming", (_req, res) => {
    res.json(upcomingEvents(ctx, spaceOf(res)));
  });

  // POST /api/cognitive { kind, label, content?, date? } -> create one.
  r.post("/", async (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { kind, label, content?, date? }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const id = await createCognitive(ctx, spaceId, parsed.data.kind as never, parsed.data.label, parsed.data.content ?? "", {
      date: parsed.data.date,
      aliases: parsed.data.aliases,
    });
    // Living Galaxy (IM-140): a NEW identity forms a constellation from the
    // memories that support it (existing machinery; no-op below 3 supporters
    // or when one already covers them). Best-effort — never fail the create.
    if (parsed.data.kind === "identity") {
      try {
        await formIdentityConstellation(ctx, spaceId, id);
      } catch {
        /* constellation formation is non-critical */
      }
    }
    // Building your Mind is real work — reward it with Fuel (your income, not just memories).
    // REG-051 (PG-08): the earn is server-capped per space-local day — a Mind node
    // is hard-deleted, so only this durable count can see the create→delete→
    // create loop. Past the cap the entry is still created; it pays 0.
    const day = localDay(new Date(), spaceTimezone(ctx.handle.sqlite, spaceId));
    let fuelEarned = 0;
    let fuel = new EconomyRepo(ctx.handle, spaceId).get();
    if (claimDailyEarn(ctx.handle, spaceId, day, "mind", EARN_MIND_DAILY_CAP)) {
      fuel = new EconomyRepo(ctx.handle, spaceId).add(EARN_MIND);
      fuelEarned = EARN_MIND;
    }
    const node = new GraphService(ctx.handle, spaceId).getNode(id);
    res.json({ ...node, fuelEarned, fuel });
  });

  // PATCH /api/cognitive/:id { label?, content?, aliases?, date? } -> edit + re-embed +
  // re-link. `date` only takes effect for kind "life_vision" (see updateCognitive).
  r.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = EditBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { label?, content?, aliases?, date? }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const ok = await updateCognitive(ctx, spaceId, id, parsed.data);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Living Galaxy (IM-140): an identity CHANGE can gather enough new
    // supporting memories to form a constellation (idempotent — see
    // formIdentityConstellation's coverage guard).
    const edited = new GraphService(ctx.handle, spaceId).getNode(id);
    if (edited?.kind === "identity") {
      try {
        await formIdentityConstellation(ctx, spaceId, id);
      } catch {
        /* constellation formation is non-critical */
      }
    }
    res.json(edited);
  });

  // POST /api/cognitive/:id/unlink { memoryId } -> sever one memory + remember it's unrelated.
  r.post("/:id/unlink", (req, res) => {
    const id = Number(req.params.id);
    const parsed = UnlinkBody.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      res.status(400).json({ error: "Body must be { memoryId }" });
      return;
    }
    unlinkMemory(ctx, spaceOf(res), id, parsed.data.memoryId);
    res.json({ ok: true });
  });

  // POST /api/cognitive/:id/prune -> sever every link that doesn't name this entry.
  r.post("/:id/prune", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const pruned = pruneAnchorLinks(ctx, spaceOf(res), id);
    res.json({ ok: true, pruned });
  });

  // GET /api/cognitive/:id/evidence -> affirming/contesting memories (identity core).
  r.get("/:id/evidence", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const ev = cognitiveEvidence(ctx, spaceOf(res), id);
    if (!ev) {
      res.status(404).json({ error: "Not a cognitive object" });
      return;
    }
    res.json(ev);
  });

  // GET /api/cognitive/:id/profile -> a person's CRM (interactions, recency, tone).
  r.get("/:id/profile", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const profile = personProfile(ctx, spaceOf(res), id);
    if (!profile) {
      res.status(404).json({ error: "Not a person" });
      return;
    }
    res.json(profile);
  });

  // POST /api/cognitive/:id/promote -> graduate an idea into a goal (commit to it).
  r.post("/:id/promote", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    if (!promoteIdeaToGoal(ctx, spaceId, id)) {
      res.status(404).json({ error: "Not an idea" });
      return;
    }
    res.json(new GraphService(ctx.handle, spaceId).getNode(id));
  });

  // POST /api/cognitive/merge { keepId, dropId } -> fold one idea into another
  // (IM-136, user-triggered). Registered BEFORE the /:id POST routes so "merge"
  // is never read as an id. Non-destructive: links unioned, the folded idea's
  // label survives as an alias, the folded node is soft-deleted (recoverable).
  r.post("/merge", async (req, res) => {
    const parsed = MergeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { keepId, dropId } with different ids", issues: parsed.error.issues });
      return;
    }
    const ok = await mergeIdeasManual(ctx, spaceOf(res), parsed.data.keepId, parsed.data.dropId);
    if (!ok) {
      res.status(404).json({ error: "Both ids must be ideas in this space" });
      return;
    }
    res.json({ ok: true, keepId: parsed.data.keepId });
  });

  // POST /api/cognitive/:id/split { newLabel, content? } -> branch an idea in two
  // (IM-136, user-triggered). The original keeps its identity; supporting
  // memories nearer the new branch move to it; nothing is deleted.
  r.post("/:id/split", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = SplitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { newLabel, content? }", issues: parsed.error.issues });
      return;
    }
    const out = await splitIdeaManual(ctx, spaceOf(res), id, parsed.data);
    if (!out) {
      res.status(404).json({ error: "Not an idea" });
      return;
    }
    res.json({ ok: true, id: out.newId, moved: out.moved });
  });

  // POST /api/cognitive/:id/progress { value } -> set 0..1 progress.
  r.post("/:id/progress", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = ProgressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { value: 0..1 }" });
      return;
    }
    const ok = setCognitiveProgress(ctx, spaceOf(res), id, parsed.data.value);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}
