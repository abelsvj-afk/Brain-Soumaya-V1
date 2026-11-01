import { Router, type Response } from "express";
import type { AppContext } from "../../context.js";
import { CAPTAIN_QUESTION_KINDS, captainDefinition, type CaptainQuestionKind } from "@brain/shared";
import { spaceOf } from "../middleware.js";
import {
  CaptainError,
  askCaptain,
  getCaptainState,
  getChronicle,
  listCaptainStates,
  resumeCaptain,
  stopCaptain,
  wipeCaptainMeetings,
} from "../../captains/engine.js";

/**
 * Captain routes (NPC-Player Layer L1): thin routes over the engine
 * in captains/engine.ts, in the harbor controller's grammar
 * (routes/npcs.ts). The server owns every outcome — captains
 * advance lazily here, on read, never on a timer. GET / advances
 * the active captains and returns the roster; POST /:id/ask answers
 * from live state and her own memory; stop/resume/wipe-meetings are
 * the owner's controls, each logged as an owner act.
 */
export function captainsRoutes(ctx: AppContext): Router {
  const r = Router();

  function fail(res: Response, e: unknown): void {
    if (e instanceof CaptainError) {
      res.status(e.httpStatus).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }

  function captainId(raw: string) {
    const def = captainDefinition(raw);
    if (!def) {
      throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${raw}".`);
    }
    return def.id;
  }

  r.get("/", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captains: listCaptainStates(ctx.handle, spaceId, Date.now()) });
    } catch (e) {
      fail(res, e);
    }
  });

  // The Chronicle: captain + harbor acts as plain lines, newest
  // first. Declared before /:id so "chronicle" never reads as a
  // captain id.
  r.get("/chronicle", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const raw = Number(req.query.limit ?? 30);
      const limit = Number.isFinite(raw) ? raw : 30;
      res.json({ lines: getChronicle(ctx.handle, spaceId, Date.now(), limit) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/:id", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captain: getCaptainState(ctx.handle, spaceId, captainId(String(req.params.id ?? "")), Date.now()) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/ask", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = captainId(String(req.params.id ?? ""));
      const question = req.body?.question as CaptainQuestionKind | undefined;
      if (!question || !CAPTAIN_QUESTION_KINDS.includes(question)) {
        res.status(400).json({
          error: "Ask what she's doing, whether you've met, or where she's headed — those are the questions she answers in L1.",
          code: "INVALID_QUESTION",
        });
        return;
      }
      const out = askCaptain(ctx.handle, spaceId, id, question, Date.now());
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/stop", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captain: stopCaptain(ctx.handle, spaceId, captainId(String(req.params.id ?? "")), Date.now()) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/resume", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captain: resumeCaptain(ctx.handle, spaceId, captainId(String(req.params.id ?? "")), Date.now()) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/wipe-meetings", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captain: wipeCaptainMeetings(ctx.handle, spaceId, captainId(String(req.params.id ?? "")), Date.now()) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
