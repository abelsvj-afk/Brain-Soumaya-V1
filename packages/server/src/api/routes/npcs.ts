import { Router, type Response } from "express";
import type { AppContext } from "../../context.js";
import { NPC_DEFINITIONS, NPC_QUESTION_KINDS, type NpcQuestionKind } from "@brain/shared";
import { spaceOf } from "../middleware.js";
import { askNpc, getNpcState, NpcError, resumeNpc, runNpcTick, stopNpc } from "../../npcs/loop.js";

/**
 * NPC autonomy (Wave 2): thin routes over the loop in npcs/loop.ts.
 * The server owns every outcome — the loop runs lazily here, on read,
 * never on a timer. GET /:id runs one autonomous tick (throttled) and
 * returns the state; POST /:id/ask answers a question from live state.
 * The client renders what the server returns and decides nothing.
 */
export function npcsRoutes(ctx: AppContext): Router {
  const r = Router();

  function fail(res: Response, e: unknown): void {
    if (e instanceof NpcError) {
      const status =
        e.code === "UNKNOWN_NPC"
          ? 404
          : e.code === "NPC_BUDGET_EXHAUSTED"
            ? 429
            : e.code === "NPC_STOPPED"
              ? 409
              : 403;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }

  r.get("/", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const nowMs = Date.now();
      const npcs = NPC_DEFINITIONS.map((d) => getNpcState(ctx.handle, spaceId, d.id, nowMs));
      res.json({ npcs });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/:id", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = String(req.params.id ?? "");
      // One lazy autonomous tick on read — throttled inside the loop,
      // so a refresh storm never becomes a tick storm.
      runNpcTick(ctx.handle, spaceId, id);
      res.json({ npc: getNpcState(ctx.handle, spaceId, id) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/ask", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = String(req.params.id ?? "");
      const question = req.body?.question as NpcQuestionKind | undefined;
      if (!question || !NPC_QUESTION_KINDS.includes(question)) {
        res.status(400).json({
          error: "Ask about routes, arrivals, traffic, fuel, or the gate — those are the questions the controller answers.",
          code: "INVALID_QUESTION",
        });
        return;
      }
      const result = askNpc(ctx.handle, spaceId, id, question);
      res.json({ npc: getNpcState(ctx.handle, spaceId, id), answer: result.entry?.act ?? null });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/stop", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = String(req.params.id ?? "");
      res.json({ npc: stopNpc(ctx.handle, spaceId, id) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/resume", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = String(req.params.id ?? "");
      res.json({ npc: resumeNpc(ctx.handle, spaceId, id) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
