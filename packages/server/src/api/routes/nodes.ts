import { Router } from "express";
import type { AppContext } from "../../context.js";

export function nodesRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/nodes/:id -> node detail
  r.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const node = ctx.graph.getNode(id);
    if (!node) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(node);
  });

  // GET /api/nodes/:id/neighbors?depth=2 -> multi-hop neighborhood subgraph
  r.get("/:id/neighbors", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const depth = Math.min(Math.max(Number(req.query.depth ?? 2) || 2, 1), 5);
    res.json(ctx.graph.neighborhood(id, depth));
  });

  return r;
}
