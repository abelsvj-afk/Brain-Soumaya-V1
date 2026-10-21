import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { LensesRepo } from "../../repositories/lenses.repo.js";
import { evalLens } from "../../analysis/lenses.js";
import { spaceOf } from "../middleware.js";

/**
 * Smart Lenses — saved queries the galaxy renders as live, self-updating constellations.
 * Thin routes: validate the flat query DSL with zod, delegate to LensesRepo + evalLens.
 * Deterministic + offline; every op is space-scoped via the repo.
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

  // GET /api/lenses -> the space's lenses, each with a live match count.
  r.get("/", (_req, res) => {
    const spaceId = spaceOf(res);
    const lenses = new LensesRepo(ctx.handle, spaceId).list();
    res.json(lenses.map((l) => ({ ...l, count: evalLens(ctx, spaceId, l.query).length })));
  });

  // POST /api/lenses/preview { query } -> live match count for an UNSAVED query
  // (IM-118: the builder used to save blind — the API could only evaluate a
  // lens after it existed). Additive; evaluates exactly like a saved lens.
  r.post("/preview", (req, res) => {
    const parsed = z.object({ query: QuerySchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { query }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    res.json({ count: evalLens(ctx, spaceId, parsed.data.query).length });
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
    res.json({ ...lens, count: evalLens(ctx, spaceId, lens.query).length });
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
    res.json({ ...lens, count: evalLens(ctx, spaceId, lens.query).length });
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
    res.json({ ids: evalLens(ctx, spaceId, lens.query) });
  });

  return r;
}
