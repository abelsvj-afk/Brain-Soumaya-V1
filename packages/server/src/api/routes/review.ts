import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { dueForReview, gradeReview, memoryStrength } from "../../analysis/review.js";
import { EconomyRepo } from "../../economy.js";
import { buffsForSpace } from "../../relics/buffs.js";
import { StreakRepo, STREAK_DAY_BONUS } from "../../streak.js";
import { spaceOf } from "../middleware.js";

const gradeSchema = z.object({
  remembered: z.boolean(),
  /**
   * REG-197 (RC-04): opaque idempotency key, minted by the client per grade
   * attempt (one card, one tap-series). A retry that carries the same key
   * replays the committed outcome instead of re-grading, re-paying, and
   * re-running SM-2. Absent (old clients) the route behaves exactly as
   * before — idempotency is opt-in per attempt, never a breaking change.
   */
  attemptKey: z.string().min(1).max(80).optional(),
});

interface GradeAttemptRow {
  node_id: number;
  remembered: number;
  next_review_at: string;
  next_interval_days: number;
  fuel_earned: number;
  streak_advanced: number;
}

/** Spaced-repetition review (NEURO_ALIGNMENT #1): list what's due, grade a recall. */
export function reviewRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/review/due -> memories due for recall, with current strength.
  // Batch G (REG-196): the list is NOT capped — the badge count in App is
  // `getDueReviews().length`, so a cap here silently reported "20 due" on a
  // brain with 35 due. The panel slices to its session size itself, and the
  // Observatory takes only the first row; the full due set is small.
  r.get("/due", (_req, res) => {
    const now = Date.now();
    const due = dueForReview(ctx, spaceOf(res), now, Number.MAX_SAFE_INTEGER).map((m) => ({
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

  // POST /api/review/:id { remembered, attemptKey? } -> grade a recall attempt, reschedule (SM-2).
  r.post("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    const parsed = gradeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const spaceId = spaceOf(res);
    const { remembered, attemptKey } = parsed.data;
    const now = Date.now();

    // REG-197: a retry of the same attempt replays the committed outcome —
    // no second grade, no second payment, no second SM-2 run. The same key
    // with a different grade is a protocol violation (the first tap wins for
    // that card), refused without moving anything.
    if (attemptKey) {
      const prior = ctx.handle.sqlite
        .prepare(
          `SELECT node_id, remembered, next_review_at, next_interval_days, fuel_earned, streak_advanced
           FROM review_grade_attempts WHERE space_id = ? AND attempt_key = ?`,
        )
        .get(spaceId, attemptKey) as GradeAttemptRow | undefined;
      if (prior) {
        if (prior.node_id !== id || (prior.remembered === 1) !== remembered) {
          return res.status(409).json({ error: "attempt key already used with a different grade" });
        }
        return res.json({
          ok: true,
          nextReviewAt: prior.next_review_at,
          nextIntervalDays: prior.next_interval_days,
          fuelEarned: prior.fuel_earned,
          streakAdvanced: prior.streak_advanced === 1,
          duplicate: true,
        });
      }
    }

    // Grade + streak touch + fuel credit + receipt insert commit together or
    // not at all, so a receipt never exists without its grade and a grade
    // never exists without its receipt.
    const outcome = ctx.handle.sqlite.transaction(() => {
      const next = gradeReview(ctx, spaceId, id, remembered, now);
      if (next === null) return null;
      // Retrieval IS the point (memory is made by recall, not storage) — so a completed
      // review feeds the same loop as logging: it keeps the daily streak alive and earns
      // Fuel. This was the game layer's biggest blind spot: it rewarded storage, not recall.
      const { advanced } = new StreakRepo(ctx.handle, spaceId).touch();
      const fuelEarned = buffsForSpace(ctx.handle, spaceId).reviewEarn + (advanced ? STREAK_DAY_BONUS : 0);
      new EconomyRepo(ctx.handle, spaceId).add(fuelEarned);
      // IM-114 (additive): the interval until that next review, in whole days, so
      // the client can say "next review in ~N days" without re-deriving SM-2.
      const nextIntervalDays = Math.max(0, Math.round((Date.parse(next) - now) / 86_400_000));
      if (attemptKey) {
        ctx.handle.sqlite
          .prepare(
            `INSERT INTO review_grade_attempts
             (space_id, attempt_key, node_id, remembered, next_review_at, next_interval_days, fuel_earned, streak_advanced)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(spaceId, attemptKey, id, remembered ? 1 : 0, next, nextIntervalDays, fuelEarned, advanced ? 1 : 0);
      }
      return { next, nextIntervalDays, fuelEarned, advanced };
    })();
    if (outcome === null) return res.status(404).json({ error: "not found" });
    res.json({
      ok: true,
      nextReviewAt: outcome.next,
      nextIntervalDays: outcome.nextIntervalDays,
      fuelEarned: outcome.fuelEarned,
      streakAdvanced: outcome.advanced,
    });
  });

  return r;
}
