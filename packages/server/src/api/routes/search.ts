import { Router } from "express";
import type { AppContext } from "../../context.js";

export function searchRoutes(ctx: AppContext): Router {
  const r = Router();
  // GET /api/search?q=...&k=10 -> semantic KNN hits with similarity
  r.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.trim().length === 0) {
      res.status(400).json({ error: "Query param q is required" });
      return;
    }
    const k = Math.min(Math.max(Number(req.query.k ?? 10) || 10, 1), 50);
    res.json(await ctx.graph.search(ctx.embeddings, q, k));
  });
  return r;
}
