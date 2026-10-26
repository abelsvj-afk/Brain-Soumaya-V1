import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../../context.js";
import { insights, nodes } from "../../db/schema.js";
import { upsertEmbedding } from "../../db/vec.js";
import { ftsUpsert } from "../../db/fts.js";
import { GraphService } from "../../graph/service.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { AttachmentsRepo } from "../../repositories/attachments.repo.js";
import { EconomyRepo, EARN_ACTION_DONE } from "../../economy.js";
import { JourneysRepo } from "../../repositories/journeys.repo.js";
import { requestMaintenance } from "../../maintenance/agent.js";
import { spaceOf, rateLimit } from "../middleware.js";
import { researchSteer } from "../../analysis/researchType.js";

// Most of this router is cheap CRUD, but synthesize/answer-research call the LLM —
// give just those two a tighter ceiling than the generic /api limit (see server.ts's
// llmLimiter for the same reasoning on the wholly-LLM-backed routers).
const llmLimiter = rateLimit({ max: Number(process.env.LLM_RATE_LIMIT_MAX ?? 20) });

// importance: 0..1 to set manually, or null to reset to the auto (heuristic) weight.
// label/content: the Details tab's edit flow (IM-26) — at least one field required.
const PatchBody = z
  .object({
    importance: z.number().min(0).max(1).nullable().optional(),
    label: z.string().min(1).max(200).optional(),
    content: z.string().max(100_000).optional(),
  })
  .refine((b) => b.importance !== undefined || b.label !== undefined || b.content !== undefined, {
    message: "Provide importance, label, and/or content",
  });

// Agenda edit/reschedule/snooze (IM-51, additive): label/content edits plus the
// two agenda timestamps. null clears a timestamp; omitting a field leaves it.
const AgendaPatchBody = z
  .object({
    label: z.string().min(1).max(200).optional(),
    content: z.string().max(4000).optional(),
    remindAt: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (b) => b.label !== undefined || b.content !== undefined || b.remindAt !== undefined || b.expiresAt !== undefined,
    { message: "Provide label, content, remindAt, and/or expiresAt" },
  );

// Attachment upload: base64 bytes capped so it fits the JSON body limit (8mb). Photos
// are downscaled client-side (lib/image.ts) to ~a few hundred KB, so this cap is really
// only a backstop for the occasional larger PDF/original.
const MAX_ATTACHMENT_BYTES = 4_000_000; // 4 MB decoded
const AttachmentBody = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().max(255).default("application/octet-stream"),
  data: z.string().min(1).max(6_000_000), // base64 (~4.4MB decoded ceiling)
});

export function nodesRoutes(ctx: AppContext): Router {
  const r = Router();
  const graphFor = (res: import("express").Response) =>
    new GraphService(ctx.handle, spaceOf(res));

  // POST /api/nodes/:id/tend -> reset a memory's entropy clock (revisiting it).
  // Free + space-scoped; the client calls this when you focus a memory.
  r.post("/:id/tend", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const ok = new NodesRepo(ctx.handle, spaceOf(res)).tend(id);
    res.json({ ok });
  });

  // --- Lifecycle: archive / restore (memory kept, but rests out of the galaxy) ---
  // GET /api/nodes/archived -> archived memories for the Browse "Archived" lens.
  r.get("/archived", (_req, res) => {
    res.json(new NodesRepo(ctx.handle, spaceOf(res)).archived());
  });
  // POST /api/nodes/:id/archive | /unarchive
  r.post("/:id/archive", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    res.json({ ok: new NodesRepo(ctx.handle, spaceOf(res)).setStatus(id, "archived") });
  });
  r.post("/:id/unarchive", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    res.json({ ok: new NodesRepo(ctx.handle, spaceOf(res)).setStatus(id, "active") });
  });

  // --- Attachments: downloadable documents kept inside a memory note ---

  // GET /api/nodes/:id/attachments -> metadata for this memory's files (no bytes).
  r.get("/:id/attachments", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    res.json(new AttachmentsRepo(ctx.handle, spaceOf(res)).listByNode(id));
  });

  // POST /api/nodes/:id/attachments -> attach a file (base64) to this memory.
  r.post("/:id/attachments", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = AttachmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid attachment", issues: parsed.error.issues });
      return;
    }
    const repo = new AttachmentsRepo(ctx.handle, spaceOf(res));
    if (!repo.ownsNode(id)) {
      res.status(404).json({ error: "No such memory in this brain." });
      return;
    }
    // Normalize a possible data-URL prefix and reject anything over the cap.
    const raw = parsed.data.data;
    const b64 = raw.includes("base64,") ? raw.slice(raw.indexOf("base64,") + 7) : raw;
    const size = Math.floor((b64.length * 3) / 4);
    if (size > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ error: `File too large (max ${(MAX_ATTACHMENT_BYTES / 1e6).toFixed(1)} MB).` });
      return;
    }
    res.json(repo.create(id, parsed.data.filename, parsed.data.mime, size, b64));
  });

  // GET /api/nodes/:id/attachments/:attId/download -> the file bytes.
  r.get("/:id/attachments/:attId/download", (req, res) => {
    const attId = Number(req.params.attId);
    if (!Number.isInteger(attId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const row = new AttachmentsRepo(ctx.handle, spaceOf(res)).get(attId);
    if (!row || row.nodeId !== Number(req.params.id)) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const buf = Buffer.from(row.data, "base64");
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename.replace(/"/g, "")}"`);
    res.send(buf);
  });

  // DELETE /api/nodes/:id/attachments/:attId -> remove a file.
  r.delete("/:id/attachments/:attId", (req, res) => {
    const attId = Number(req.params.attId);
    if (!Number.isInteger(attId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    res.json({ ok: new AttachmentsRepo(ctx.handle, spaceOf(res)).delete(attId) });
  });

  // POST /api/nodes/:id/request-maintenance -> ask Soumaya to prioritize tending
  // this memory on her next round (research / connect / recalibrate). Best-effort.
  r.post("/:id/request-maintenance", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    if (!new NodesRepo(ctx.handle, spaceId).getById(id)) {
      res.status(404).json({ error: "No such memory" });
      return;
    }
    requestMaintenance(spaceId, id);
    res.json({ ok: true });
  });

  // POST /api/nodes/:id/synthesize -> AI pieces this memory + its connections into
  // a fresh insight (the "connect the dots for me" action).
  r.post("/:id/synthesize", llmLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const graph = graphFor(res);
    const node = graph.getNode(id);
    if (!node) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Gather directly-connected memories (scoped to this brain).
    const rows = ctx.handle.sqlite
      .prepare(
        `SELECT CASE WHEN source = ? THEN target ELSE source END AS nid
         FROM edges WHERE space_id = ? AND (source = ? OR target = ?) LIMIT 8`,
      )
      .all(id, spaceId, id, id) as { nid: number }[];
    const neighbors = rows
      .map((x) => graph.getNode(x.nid))
      .filter((n): n is NonNullable<typeof n> => !!n);

    const cluster = [node, ...neighbors].map((n) => ({ label: n.label, content: n.content }));
    let text = "";
    let questions: string[] | undefined = undefined;

    try {
      if (neighbors.length > 0) {
        text = await ctx.llm.summarizeSector(cluster);
        ctx.handle.db
          .insert(insights)
          .values({ spaceId, nodeA: id, nodeB: neighbors[0]?.id ?? id, text, score: 0.8 })
          .run();
      } else {
        const research = await ctx.llm.research({ label: node.label, content: node.content }, researchSteer(node as any));
        if (research.questions && research.questions.length > 0) {
          questions = research.questions;
          new NodesRepo(ctx.handle, spaceId).updateResearch(id, questions, {});
          text = "Information gaps detected. Please answer the clarifying questions to complete research.";
        } else {
          text = research.content;
          const expandedContent = `${node.content}\n\n--- Research Deep Dive ---\n${text}`;
          const newImp = Math.min(1.0, (node.importance ?? 0.5) + 0.2);
          ctx.handle.db
            .update(nodes)
            .set({
              content: expandedContent,
              importance: newImp,
              label: research.label || node.label,
              researchQuestions: null,
              researchAnswers: null
            })
            .where(and(eq(nodes.id, id), eq(nodes.spaceId, spaceId)))
            .run();
          upsertEmbedding(ctx.handle.sqlite, id, await ctx.embeddings.embed(expandedContent));
          ftsUpsert(ctx.handle.sqlite, id, research.label || node.label, expandedContent);
        }
      }
    } catch (err) {
      console.error("[nodes] synthesize failed:", err);
      res.status(500).json({ error: "Synthesis failed — try again shortly." });
      return;
    }

    new NodesRepo(ctx.handle, spaceId).tend(id); // synthesizing tends the memory

    res.json({ text, connected: neighbors.length, questions });
  });

  // POST /api/nodes/:id/ack-reminder -> acknowledge a due reminder. Without this,
  // remind_at lived forever: the digest's 5 oldest-first slots filled with stale
  // reminders and newer ones never surfaced. REG-140: acking also clears the
  // fired state — the fired state never outlives its remind_at, so a later
  // re-scheduled remind_at starts clean.
  r.post("/:id/ack-reminder", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const changed = ctx.handle.sqlite
      .prepare(`UPDATE nodes SET remind_at = NULL, reminder_fired_at = NULL, fired_by_approval = NULL WHERE id = ? AND space_id = ?`)
      .run(id, spaceId).changes;
    if (changed === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    new NodesRepo(ctx.handle, spaceId).tend(id); // acknowledging = visiting it
    res.json({ ok: true });
  });

  // PATCH /api/nodes/:id/agenda { label?, content?, remindAt?, expiresAt? } ->
  // edit / reschedule / snooze an Agenda item in place (IM-51). Snooze is this
  // same patch with a future remindAt/expiresAt computed by the client.
  // NOTE: registered before PATCH /:id so Express matches the longer path first.
  r.patch("/:id/agenda", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = AgendaPatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { label?, content?, remindAt?, expiresAt? }", issues: parsed.error.issues });
      return;
    }
    const node = new NodesRepo(ctx.handle, spaceOf(res)).updateAgenda(id, parsed.data);
    if (!node) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(node);
  });

  // PATCH /api/nodes/:id  { importance?: number|null, label?: string, content?: string }
  // -> adjust gravitational weight and/or edit the label/body (IM-26).
  r.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { importance?: number 0..1 | null, label?: string, content?: string }", issues: parsed.error.issues });
      return;
    }
    const spaceId = spaceOf(res);
    const repo = new NodesRepo(ctx.handle, spaceId);
    if (parsed.data.label !== undefined || parsed.data.content !== undefined) {
      const updated = repo.updateDetails(id, { label: parsed.data.label, content: parsed.data.content });
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      // Keep search honest: the edited text is what FTS + semantic search must
      // find (same refresh the cognitive edit path performs).
      upsertEmbedding(ctx.handle.sqlite, id, await ctx.embeddings.embed(`${updated.label}. ${updated.content}`));
      ftsUpsert(ctx.handle.sqlite, id, updated.label, updated.content);
    }
    if (parsed.data.importance !== undefined) {
      const node = graphFor(res).setImportance(id, parsed.data.importance);
      if (!node) {
        res.status(404).json({ error: "Not found" });
        return;
      }
    } else if (!repo.getById(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    repo.tend(id); // editing tends it
    res.json(graphFor(res).getNode(id));
  });

  // DELETE /api/nodes/:id -> remove a memory and everything attached to it
  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const spaceId = spaceOf(res);
    const graph = graphFor(res);
    const existing = graph.getNode(id); // check kind before removing
    // Only actions that have existed a little while pay out — a create-then-delete
    // loop was a free offline fuel farm. (Checked before the row is removed.)
    const oldEnough =
      existing?.kind === "action" &&
      ctx.handle.sqlite
        .prepare(
          `SELECT 1 FROM nodes WHERE id = ? AND space_id = ? AND created_at <= datetime('now', '-10 minutes')`,
        )
        .get(id, spaceId) != null;
    // Living Galaxy (IM-140): completing an ACTION item is completing a
    // mission — capture its linked journeys BEFORE the node (and the meaning
    // of its links) is gone, then auto-credit them after the delete lands.
    const linkedJourneys =
      existing?.kind === "action" ? new JourneysRepo(ctx.handle, spaceId).journeysForMission(id) : [];
    const ok = graph.deleteNode(id);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Clearing a (real, aged) day-to-day action item earns a little fuel.
    if (oldEnough) new EconomyRepo(ctx.handle, spaceId).add(EARN_ACTION_DONE);
    const journeyProgress = linkedJourneys
      .map((j) => new JourneysRepo(ctx.handle, spaceId).creditCompletedMission(j.id, id))
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => ({ journeyId: c.journey.id, progress: c.journey.progress, missionsCompleted: c.completedCount }));
    res.json({ ok: true, id, ...(journeyProgress.length > 0 ? { journeyProgress } : {}) });
  });

  // GET /api/nodes/:id -> node detail. The web client reads via /api/graph, so
  // this is kept deliberately as the single-node public API (and test surface).
  r.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const node = graphFor(res).getNode(id);
    if (!node) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(node);
  });

  const AnswerResearchBody = z.object({
    answers: z.record(z.string(), z.string()),
  });

  // POST /api/nodes/:id/answer-research -> finalize research using user answers
  r.post("/:id/answer-research", llmLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = AnswerResearchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { answers: Record<string, string> }" });
      return;
    }
    const spaceId = spaceOf(res);
    const nodesRepo = new NodesRepo(ctx.handle, spaceId);
    const node = nodesRepo.getById(id);
    if (!node) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const answersMap = parsed.data.answers;
    const lines: string[] = [];
    for (const [q, a] of Object.entries(answersMap)) {
      lines.push(`Question: ${q}\nAnswer: ${a}`);
    }
    const userAnswersText = lines.join("\n\n");

    try {
      const research = await ctx.llm.research({ label: node.label, content: node.content }, `${researchSteer(node as any)}\n\n${userAnswersText}`);
      const expandedContent = `${node.content}\n\n--- Research Deep Dive ---\n${research.content}`;
      const newImp = Math.min(1.0, (node.importance ?? 0.5) + 0.2);

      ctx.handle.db
        .update(nodes)
        .set({
          content: expandedContent,
          importance: newImp,
          label: research.label || node.label,
          researchQuestions: null,
          researchAnswers: JSON.stringify(answersMap),
        })
        .where(and(eq(nodes.id, id), eq(nodes.spaceId, spaceId)))
        .run();

      upsertEmbedding(ctx.handle.sqlite, id, await ctx.embeddings.embed(expandedContent));
      ftsUpsert(ctx.handle.sqlite, id, node.label, expandedContent);
      nodesRepo.tend(id);

      const updatedNode = graphFor(res).getNode(id);
      res.json({ node: updatedNode });
    } catch (err) {
      console.error("[nodes] answer-research failed:", err);
      res.status(500).json({ error: "Research update failed — try again shortly." });
    }
  });

  // GET /api/nodes/:id/neighbors?depth=2 -> multi-hop neighborhood subgraph
  r.get("/:id/neighbors", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const depth = Math.min(Math.max(Number(req.query.depth ?? 2) || 2, 1), 5);
    res.json(graphFor(res).neighborhood(id, depth));
  });

  return r;
}
