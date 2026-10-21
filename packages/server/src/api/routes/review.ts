import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { dueForReview, gradeReview, memoryStrength } from "../../analysis/review.js";
import { EconomyRepo, EARN_REVIEW } from "../../economy.js";
import { StreakRepo, STREAK_DAY_BONUS } from "../../streak.js";
import { spaceOf } from "../middleware.js";

const gradeSchema = z.object({ remembered: z.boolean() });

/** Spaced-repetition review (NEURO_ALIGNMENT #1): list what's due, grade a recall. */
export function reviewRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/review/due -> memories due for recall, with current strength.
  r.get("/due", (_req, res) => {
    const now = Date.now();
    const due = dueForReview(ctx, spaceOf(res), now, 20).map((m) => ({
      id: m.id,
      label: m.label,
      // IM-111: the memory's actual content — Reveal in the Recall panel shows
      // this so the user grades recall of something they were actually shown.
      // (dueForReview already selects `content` from nodes.)
      content: m.content,
      strength: Math.round(memoryStrength(m, now) * 100) / 100,
      reviewCount: m.review_count,
    }));
    res.json(due);
  });

  // POST /api/review/:id { remembered } -> grade a recall attempt, reschedule (SM-2).
  r.post("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    const parsed = gradeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const spaceId = spaceOf(res);
    const next = gradeReview(ctx, spaceId, id, parsed.data.remembered, Date.now());
    if (next === null) return res.status(404).json({ error: "not found" });
    // Retrieval IS the point (memory is made by recall, not storage) — so a completed
    // review feeds the same loop as logging: it keeps the daily streak alive and earns
    // Fuel. This was the game layer's biggest blind spot: it rewarded storage, not recall.
    const { advanced } = new StreakRepo(ctx.handle, spaceId).touch();
    const fuelEarned = EARN_REVIEW + (advanced ? STREAK_DAY_BONUS : 0);
    new EconomyRepo(ctx.handle, spaceId).add(fuelEarned);
    res.json({ ok: true, nextReviewAt: next, fuelEarned, streakAdvanced: advanced });
  });

  return r;
}
