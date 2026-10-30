import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { computeSociety, setReflect } from "../../society/society.js";

/**
 * The society's reading of this brain (docs/specs/npc-hive-society-2026-10-30.md). Numbers and words only — never memory text. Optional: PUT /reflect turns the
 * reflection off (a neutral, still-living society; nothing is read) or back on. Validate → delegate → json.
 */
export function societyRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    res.json(computeSociety(ctx.handle, spaceOf(res)));
  });

  const body = z.object({ reflect: z.boolean() });
  r.put("/reflect", (req, res) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Expected { reflect: boolean }." });
      return;
    }
    setReflect(ctx.handle, spaceOf(res), parsed.data.reflect);
    res.json(computeSociety(ctx.handle, spaceOf(res)));
  });

  return r;
}
