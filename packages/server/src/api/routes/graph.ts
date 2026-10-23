import { Router } from "express";
import type { GalaxyEntityKind } from "@brain/shared";
import type { AppContext } from "../../context.js";
import { GraphService, INCLUDE_IDS_CAP, MAX_UNION_IDS } from "../../graph/service.js";
import { resolveGalaxyEntity, navigationIntentFor } from "../../analysis/galaxyEntity.js";
import { GraphExportRepo } from "../../repositories/graphExport.repo.js";
import { spaceOf } from "../middleware.js";

const GALAXY_ENTITY_KINDS: readonly GalaxyEntityKind[] = ["node", "journey", "bill", "goal"];

/** Parse a comma-separated `?includeIds=1,2,3` query param into finite numbers. */
function parseIdList(value: unknown): number[] {
  if (value == null || value === "") return [];
  const s = Array.isArray(value) ? value.join(",") : String(value);
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
}

export function graphRoutes(ctx: AppContext): Router {
  const r = Router();
  // GET /api/graph?limit=300&includeIds=1,2,3 -> bounded overview
  // (react-force-graph-3d shape) + additive `nextEdgeCursor`. D3: `includeIds`
  // forces explicit ids into the overview (union with top-`limit` by degree);
  // over-cap -> explicit 400, never silent truncation.
  r.get("/", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 300) || 300, 1), 5000);
    const includeIds = parseIdList(req.query.includeIds);
    if (includeIds.length > INCLUDE_IDS_CAP) {
      return res
        .status(400)
        .json({ error: `includeIds exceeds the per-request cap of ${INCLUDE_IDS_CAP}` });
    }
    res.json(new GraphService(ctx.handle, spaceOf(res)).overview(limit, includeIds));
  });
  // POST /api/graph/edges?cursor= -> D3 edge completion. JSON body
  // `{ids: number[]}` (the full union id set U; over-cap -> explicit 400).
  // Returns space-scoped edges incident to any given id, ordered by edge id
  // ASC, cursor-paginated: `{edges, nextCursor | null}`. A 50k-id body is
  // ~350KB — comfortably inside the app's global 8mb JSON body limit
  // (api/server.ts), so no per-route parser override is needed.
  r.post("/edges", (req, res) => {
    const body = req.body as { ids?: unknown } | undefined;
    if (!body || !Array.isArray(body.ids)) {
      return res.status(400).json({ error: "body must be { ids: number[] }" });
    }
    if (body.ids.length > MAX_UNION_IDS) {
      return res
        .status(400)
        .json({ error: `ids exceeds the per-request cap of ${MAX_UNION_IDS}` });
    }
    const ids = body.ids.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const rawCursor = req.query.cursor;
    const cursor = rawCursor == null || rawCursor === "" ? null : Number(rawCursor);
    if (cursor !== null && (!Number.isInteger(cursor) || cursor < 0)) {
      return res.status(400).json({ error: "cursor must be a non-negative integer edge id" });
    }
    res.json(new GraphService(ctx.handle, spaceOf(res)).incidentEdges(ids, cursor));
  });
  // GET /api/graph/export -> this space's whole graph as JSON (IM-129c) —
  // the Settings "Download your brain (JSON)" button. Repository-owned and
  // space-scoped; see GraphExportRepo for the payload contract.
  r.get("/export", (_req, res) => {
    res.json(new GraphExportRepo(ctx.handle, spaceOf(res)).exportGraph());
  });
  // POST /api/graph/restore -> rebuild a graph export (v2 with sources,
  // or a pre-V1 v1 export) into this space (Verbatim V1 section 18.4.3).
  // Hash mismatches abort with 422 and restore nothing.
  r.post("/restore", (req, res) => {
    const body = req.body as { nodes?: unknown; edges?: unknown } | undefined;
    if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      return res.status(400).json({ error: "body must be a graph export { nodes: [], edges: [], sources?: [] }" });
    }
    try {
      const report = new GraphExportRepo(ctx.handle, spaceOf(res)).restoreGraph(
        body as unknown as import("../../repositories/graphExport.repo.js").GraphExport,
      );
      return res.json({ ok: true, ...report });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("content_hash mismatch")) {
        return res.status(422).json({ error: message });
      }
      return res.status(400).json({ error: message });
    }
  });
  // GET /api/graph/entity/:kind/:id -> GalaxyEntityDescriptor (Maya Intelligence Part I3:
  // "what's that star?"). One bounded, deterministic lookup per Galaxy body kind — no
  // embeddings/LLM call, so this is safe to hit on every click.
  r.get("/entity/:kind/:id", (req, res) => {
    const kind = req.params.kind as GalaxyEntityKind;
    const id = Number(req.params.id);
    if (!GALAXY_ENTITY_KINDS.includes(kind) || !Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid kind or id" });
    }
    const descriptor = resolveGalaxyEntity(ctx.handle, spaceOf(res), kind, id);
    if (!descriptor) return res.status(404).json({ error: "not found" });
    res.json({ descriptor, navigation: navigationIntentFor(descriptor) });
  });
  return r;
}
