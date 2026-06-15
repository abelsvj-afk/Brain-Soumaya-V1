import { Router } from "express";
import type { AppContext } from "../../context.js";
import { InsightsRepo } from "../../repositories/insights.repo.js";
import { runSynthesis } from "../../synthesis/engine.js";

export function digestRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/digest -> recent synthesized insights
  r.get("/", (_req, res) => {
    res.json(new InsightsRepo(ctx.handle).recent());
  });

  // POST /api/digest/run -> scan for latent connections and synthesize new insights
  r.post("/run", async (_req, res) => {
    const created = await runSynthesis(ctx.handle, ctx.llm);
    res.json(created);
  });

  return r;
}
