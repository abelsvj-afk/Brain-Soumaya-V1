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
  resetCaptain,
  resumeCaptain,
  stopCaptain,
  wipeCaptainMeetings,
} from "../../captains/engine.js";
import { getDirectorState, setDirectorEnabled } from "../../captains/director.js";

/**
 * Captain routes (NPC-Player Layer L1): thin routes over the engine
 * in captains/engine.ts, in the harbor controller's grammar
 * (routes/npcs.ts). The server owns every outcome — captains
 * advance lazily here, on read, never on a timer. GET / advances
 * the active captains and returns the roster; POST /:id/ask answers
 * from live state and her own memory; stop/resume/wipe-meetings are
 * the owner's controls, each logged as an owner act. P2 adds
 * POST /:id/reset — the targeted reset of a purpose captain's own
 * stores (§6.2), also an owner act.
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

  // The Director switch (P3, R14): the owner's Station-panel
  // toggle for Director-lite, stored per space and logged as an
  // owner act. Declared before /:id so "director" never reads as
  // a captain id.
  r.post("/director", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "The Director switch takes a true or false.", code: "INVALID_DIRECTOR_SWITCH" });
        return;
      }
      const state = setDirectorEnabled(ctx.handle, spaceId, enabled, Date.now());
      res.json({ director: { enabled: state.enabled } });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/director", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ director: { enabled: getDirectorState(ctx.handle, spaceId).enabled } });
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
          error: "Ask what she's doing, whether you've met, where she's headed, or what she thinks of another captain — those are the questions she answers.",
          code: "INVALID_QUESTION",
        });
        return;
      }
      const aboutRaw = req.body?.about as string | undefined;
      const about = aboutRaw ? captainId(aboutRaw) : undefined;
      const out = askCaptain(ctx.handle, spaceId, id, question, Date.now(), about);
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

  r.post("/:id/reset", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ captain: resetCaptain(ctx.handle, spaceId, captainId(String(req.params.id ?? "")), Date.now()) });
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
