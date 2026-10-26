import { Router } from "express";
import type { AppContext } from "../../context.js";
import { GraphService } from "../../graph/service.js";
import { spaceOf } from "../middleware.js";

export function searchRoutes(ctx: AppContext): Router {
  const r = Router();
  // GET /api/search?q=...&k=10 -> hybrid RRF search envelope
  // { hits, total, hasMore, totalCapped } (REG-186: the old bare array could
  // never say more matches existed than the top-k page showed).
  r.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim().length === 0) {
      res.status(400).json({ error: "Query param q is required" });
      return;
    }
    const k = Math.min(Math.max(Number(req.query.k ?? 10) || 10, 1), 50);
    const graph = new GraphService(ctx.handle, spaceOf(res));
    res.json(await graph.search(ctx.embeddings, q, k));
  });
  return r;
}
