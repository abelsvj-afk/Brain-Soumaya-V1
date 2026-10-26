import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import {
  addThought,
  listThoughts,
  reinforceThought,
  dismissThought,
  promoteThought,
  editThought,
} from "../../analysis/workingMemory.js";
import { spaceOf } from "../middleware.js";
import { EconomyRepo, EARN_THOUGHT, EARN_THOUGHT_DAILY_CAP, claimDailyEarn } from "../../economy.js";
import { spaceTimezone, localDay } from "../../agent/notify/policy.js";

const AddBody = z.object({
  text: z.string().min(1).max(500),
  source: z.enum(["manual", "chat", "goal", "priority", "emotion"]).optional(),
});
const EditBody = z.object({ text: z.string().min(1).max(500) });

/** Working Memory (the "mind space"): hold, reinforce, promote, or dismiss thoughts. */
export function workingRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/working -> live thoughts (decayed strength, strongest first).
  r.get("/", (_req, res) => {
    res.json(listThoughts(ctx, spaceOf(res)));
  });

  // POST /api/working { text, source? } -> add a thought to the mind space.
  r.post("/", (req, res) => {
    const parsed = AddBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { text, source? }", issues: parsed.error.issues });
      return;
    }
    const source = parsed.data.source ?? "manual";
    const id = addThought(ctx, spaceOf(res), parsed.data.text, source);
    // A thought you personally capture earns a little Fuel; system-seeded thoughts
    // (chat/goal/priority/emotion) don't, so it can't be farmed by the autonomy loop.
    // REG-051 (PG-08): the manual earn is server-capped per space-local day — the
    // thought row is hard-deleted on dismiss, so only this durable count can see
    // the add→dismiss→add loop. Past the cap the thought is still saved; it pays 0.
    let fuelEarned = 0;
    if (source === "manual") {
      const spaceId = spaceOf(res);
      const day = localDay(new Date(), spaceTimezone(ctx.handle.sqlite, spaceId));
      if (claimDailyEarn(ctx.handle, spaceId, day, "thought", EARN_THOUGHT_DAILY_CAP)) {
        new EconomyRepo(ctx.handle, spaceId).add(EARN_THOUGHT);
        fuelEarned = EARN_THOUGHT;
      }
    }
    res.json({ id, fuelEarned });
  });

  // POST /api/working/:id/reinforce -> top it up; may auto-promote to a memory.
  r.post("/:id/reinforce", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const result = await reinforceThought(ctx, spaceOf(res), id);
    if (!result.ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true, promotedNodeId: result.promotedNodeId });
  });

  // POST /api/working/:id/promote -> consolidate this thought into the galaxy now.
  r.post("/:id/promote", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const nodeId = await promoteThought(ctx, spaceOf(res), id);
    if (nodeId == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true, nodeId });
  });

  // PATCH /api/working/:id { text } -> edit a thought's wording.
  r.patch("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = EditBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { text }" });
      return;
    }
    if (!editThought(ctx, spaceOf(res), id, parsed.data.text)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  // DELETE /api/working/:id -> dismiss (let the thought go).
  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!dismissThought(ctx, spaceOf(res), id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}
