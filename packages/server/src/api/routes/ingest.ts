import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ingest } from "../../ingestion/pipeline.js";

const IngestBody = z.object({ text: z.string().min(1).max(20000) });

export function ingestRoutes(ctx: AppContext): Router {
  const r = Router();
  // POST /api/ingest  { text }
  r.post("/", async (req, res) => {
    const parsed = IngestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { text: string }" });
      return;
    }
    const result = await ingest(
      ctx.handle,
      { embeddings: ctx.embeddings, llm: ctx.llm },
      parsed.data.text,
    );
    res.json(result);
  });
  return r;
}
