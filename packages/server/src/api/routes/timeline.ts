import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { listChapters, countChapters, createManualChapter, deleteChapter, backfillInitialChapter } from "../../analysis/timeline.js";
import { LifeSeasonsRepo } from "../../repositories/lifeSeasons.repo.js";
import { JourneysRepo } from "../../repositories/journeys.repo.js";
import { spaceOf } from "../middleware.js";

const createSchema = z.object({ title: z.string().max(120).optional() });

/** The Chronicle — the 3D flowing-river life timeline (docs/TIMELINE_DESIGN.md). */
export function timelineRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/timeline -> { chapters: TimelineChapter[] (oldest → newest, the
  // NEWEST 500), total: number }. First open of an established brain seeds a
  // one-time opening chapter from its existing history. The total lets the
  // surface state the truncation past the cap (CHR-07) instead of silently
  // dropping the newest chapters.
  r.get("/", (_req, res) => {
    const space = spaceOf(res);
    try {
      backfillInitialChapter(ctx, space);
    } catch (e) {
      console.error("[timeline] backfill failed:", e);
    }
    res.json({ chapters: listChapters(ctx, space), total: countChapters(ctx, space) });
  });

  // GET /api/timeline/seasons -> Life Seasons + Journey spans (IM-132).
  // Seasons are DERIVED from auto-detected chapters (the existing Chronicle
  // heuristic is the detection pass); Journey spans use the hybrid derivation
  // (explicit dates → linked-item dates → created/updated fallbacks).
  // Windowed (limit/offset, unlike the legacy chapters list) per the spec's
  // acceptance criteria — totals report the full counts.
  r.get("/seasons", (req, res) => {
    const space = spaceOf(res);
    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    const seasons = new LifeSeasonsRepo(ctx.handle, space).listSeasons();
    const spans = new JourneysRepo(ctx.handle, space).listSpans();
    res.json({
      seasons: seasons.slice(offset, offset + limit),
      journeySpans: spans.slice(offset, offset + limit),
      totalSeasons: seasons.length,
      totalJourneySpans: spans.length,
    });
  });

  // POST /api/timeline { title? } -> mark a chapter now (manual). An empty
  // window (nothing new since the last chapter) is a 409 with the
  // machine-readable reason — the surface explains it and writes nothing
  // (CHR-12), instead of storing a content-free chapter.
  r.post("/", (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const chapter = createManualChapter(ctx, spaceOf(res), { title: parsed.data.title });
    if (!chapter) {
      return res.status(409).json({
        error: "empty-window",
        message: "Nothing new to narrate yet — add a few memories first, then mark the moment.",
      });
    }
    res.json(chapter);
  });

  // DELETE /api/timeline/:id -> remove a chapter.
  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    res.json({ ok: deleteChapter(ctx, spaceOf(res), id) });
  });

  return r;
}
