import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { AppContext } from "../context.js";
import { ingestRoutes } from "./routes/ingest.js";
import { graphRoutes } from "./routes/graph.js";
import { nodesRoutes } from "./routes/nodes.js";
import { searchRoutes } from "./routes/search.js";

/** Assemble the Express app over an AppContext. */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      embeddings: { model: ctx.embeddings.model, dim: ctx.embeddings.dim },
      llm: { model: ctx.llm.model, available: ctx.llm.available },
      nodes: ctx.graph.full().nodes.length,
    });
  });

  app.use("/api/ingest", ingestRoutes(ctx));
  app.use("/api/graph", graphRoutes(ctx));
  app.use("/api/nodes", nodesRoutes(ctx));
  app.use("/api/search", searchRoutes(ctx));

  // Centralized error handler (Express 5 forwards rejected async handlers here).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] error:", err);
    res.status(500).json({ error: (err as Error)?.message ?? "Internal error" });
  });

  return app;
}
