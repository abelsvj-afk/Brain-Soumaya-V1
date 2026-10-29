import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { EdgesRepo } from "../../repositories/edges.repo.js";
import { spaceOf } from "../middleware.js";
import { suggestGardenPlots, tendGardenPlot, listRecentGardenTends, type TendKind } from "../../analysis/garden.js";

const TendBody = z.object({
  nodeId: z.number().int(),
  mode: z.enum(["line", "link", "affirm", "visit"]),
  text: z.string().max(2000).optional(),
  targetId: z.number().int().optional(),
  changed: z.boolean().optional(),
});

/**
 * Verb 1 — Tend a plot (Growing Place). Thin routes: validate → delegate
 * to analysis/garden → json. Suggestions live in-world only — this route
 * is fetched on garden entry, never pushed, never in the digest.
 */
export function gardenRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/garden/suggestions?exclude=1,2 -> the 3 plots Soumaya suggests
  // on arrival (coldest, most-linked-but-untended, oldest untended), each
  // with one plain line for why. Ignored ids arrive as `exclude` and are
  // never suggested twice in a row.
  r.get("/suggestions", (req, res) => {
    const spaceId = spaceOf(res);
    const exclude =
      typeof req.query.exclude === "string"
        ? req.query.exclude
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n))
        : [];
    const nodes = new NodesRepo(ctx.handle, spaceId).all();
    const edges = new EdgesRepo(ctx.handle, spaceId).all();
    res.json({ suggestions: suggestGardenPlots(nodes, edges, Date.now(), exclude) });
  });

  // GET /api/garden/tends?days=7 -> recent tend acts (newest first) — the
  // garden's warm glow and lit paths read from this.
  r.get("/tends", (req, res) => {
    const spaceId = spaceOf(res);
    const daysRaw = Number(req.query.days);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 90) : 7;
    res.json({ tends: listRecentGardenTends(ctx.handle, spaceId, days) });
  });

  // POST /api/garden/tend { nodeId, mode, text?, targetId?, changed? } ->
  // the tend result: updated node, tend record, fuel earned (0 for a visit,
  // or past the Mind 10/day cap, or when the link already existed).
  r.post("/tend", async (req, res) => {
    const parsed = TendBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { nodeId, mode, text?, targetId?, changed? }", issues: parsed.error.issues });
      return;
    }
    const result = await tendGardenPlot(ctx, spaceOf(res), parsed.data as { nodeId: number; mode: TendKind; text?: string; targetId?: number; changed?: boolean });
    if (!result.ok) {
      const status = result.error === "not_found" || result.error === "target_not_found" ? 404 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  return r;
}
