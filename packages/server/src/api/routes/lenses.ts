import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { LensesRepo } from "../../repositories/lenses.repo.js";
import { evalLensDetailed, type LensEvalResult } from "../../analysis/lenses.js";
import { spaceOf } from "../middleware.js";
import type { LensQuery } from "@brain/shared";

/**
 * Smart Lenses — saved queries the galaxy renders as live, self-updating constellations.
 * Thin routes: validate the flat query DSL with zod, delegate to LensesRepo + evalLens.
 * Deterministic + offline; every op is space-scoped via the repo.
 *
 * Batch H (REG-208 / CN-09): every count is the TRUE total with its cap flags —
 * `count` is never the truncated length dressed as the total. Batch H (REG-214 /
 * CN-16): a lens whose stored query cannot be parsed is `broken` — it lists
 * with a null count and its nodes endpoint refuses (422), never an all-matching
 * lens with the whole-brain count.
 */

const QuerySchema = z
  .object({
    kinds: z.array(z.string().min(1).max(40)).max(16).optional(),
    tags: z.array(z.string().min(1).max(40)).max(16).optional(),
    emotion: z.enum(["positive", "heavy", "neutral"]).optional(),
    minImportance: z.number().min(0).max(1).optional(),
    withinDays: z.number().int().positive().max(3650).optional(),
    linkedTo: z.number().int().positive().optional(),
    state: z.enum(["active", "archived", "due", "orphan"]).optional(),
    text: z.string().max(200).optional(),
  })
  .strict(); // reject unknown predicate keys

const CreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  query: QuerySchema,
  pinned: z.boolean().optional(),
});
const PatchBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  query: QuerySchema.optional(),
  pinned: z.boolean().optional(),
});

export function lensesRoutes(ctx: AppContext): Router {
  const r = Router();

  // The disclosed evaluation of one lens: true total + cap flags. A broken
  // lens (unparseable stored query) never evaluates — null count, not the
  // whole-brain count.
  const evaluate = (spaceId: string, lens: { query: LensQuery; broken?: boolean }) => {
    if (lens.broken) return null;
    return evalLensDetailed(ctx, spaceId, lens.query);
  };
  const withCount = (spaceId: string, lens: { query: LensQuery; broken?: boolean }) => {
    const ev: LensEvalResult | null = evaluate(spaceId, lens);
    return ev == null
      ? { ...lens, count: null, capped: false, totalIsLowerBound: false, shown: 0 }
      : { ...lens, count: ev.total, capped: ev.capped, totalIsLowerBound: ev.totalIsLowerBound, shown: ev.ids.length };
  };

  // GET /api/lenses -> the space's lenses, each with a live match count.
  r.get("/", (_req, res) => {
    const spaceId = spaceOf(res);
    const lenses = new LensesRepo(ctx.handle, spaceId).list();
    res.json(lenses.map((l) => withCount(spaceId, l)));
  });

  // POST /api/lenses/preview { query } -> live match count for an UNSAVED query
  // (IM-118: the builder used to save blind — the API could only evaluate a
  // lens after it existed). Additive; evaluates exactly like a saved lens.
  // Batch H (REG-208): the preview discloses the true total + cap flags.
  r.post("/preview", (req, res) => {
    const parsed = z.object({ query: QuerySchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { query }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const ev = evalLensDetailed(ctx, spaceId, parsed.data.query);
    res.json({ count: ev.total, capped: ev.capped, totalIsLowerBound: ev.totalIsLowerBound, shown: ev.ids.length });
  });

  // POST /api/lenses { name, query, pinned? } -> create.
  r.post("/", (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { name, query, pinned? }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const lens = new LensesRepo(ctx.handle, spaceId).create(parsed.data.name, parsed.data.query, parsed.data.pinned);
    res.json(withCount(spaceId, lens));
  });

  // PATCH /api/lenses/:id { name?, query?, pinned? } -> edit.
  r.patch("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { name?, query?, pinned? }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const lens = new LensesRepo(ctx.handle, spaceId).update(id, parsed.data);
    if (!lens) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(withCount(spaceId, lens));
  });

  // DELETE /api/lenses/:id
  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!new LensesRepo(ctx.handle, spaceOf(res)).remove(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  });

  // GET /api/lenses/:id/nodes -> evaluate -> the node ids the galaxy should isolate.
  // Batch H (REG-214): a broken lens refuses here (422) instead of isolating
  // to everything; Batch H (REG-208): the response discloses the true total.
  r.get("/:id/nodes", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const lens = new LensesRepo(ctx.handle, spaceId).get(id);
    if (!lens) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (lens.broken) {
      res.status(422).json({ error: "This lens's saved query couldn't be read." });
      return;
    }
    const ev = evalLensDetailed(ctx, spaceId, lens.query);
    res.json({ ids: ev.ids, total: ev.total, capped: ev.capped, totalIsLowerBound: ev.totalIsLowerBound, shown: ev.ids.length });
  });

  return r;
}
