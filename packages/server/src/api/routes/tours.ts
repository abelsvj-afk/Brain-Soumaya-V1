import { Router, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { ToursRepo, TourError } from "../../repositories/tours.repo.js";
import { TravelError } from "../../repositories/travel.repo.js";
import type { TravelKind } from "@brain/shared";

/**
 * Guided tours (Wave 2, N7): thin routes over ToursRepo — the contract
 * the web tours layer integrates against. The server owns every
 * outcome: which stops a tour walks, which leg carries the traveler,
 * and where the tour waits. A tour never starts unasked, never
 * auto-plays, and leaving one is always free.
 *
 * Literal paths (/suggestions, /session) are registered before the
 * /:id routes, so they are never read as a tour id.
 */

const CreateBody = z.object({ journeyId: z.number().int().positive(), title: z.string().trim().min(1).max(80).optional() }).strict();
const RenameBody = z.object({ title: z.string().trim().min(1).max(80) }).strict();
const MoveBody = z.object({ kind: z.enum(["drift", "warp"]).optional() }).strict();

export function toursRoutes(ctx: AppContext): Router {
  const r = Router();
  const repo = (res: Response) => new ToursRepo(ctx.handle, spaceOf(res));

  function fail(res: Response, e: unknown): void {
    if (e instanceof TourError) {
      const status =
        e.code === "JOURNEY_NOT_FOUND" || e.code === "TOUR_NOT_FOUND" || e.code === "NO_ACTIVE_SESSION"
          ? 404
          : 400;
      res.status(status).json({ error: e.message, code: e.code, leftOut: e.leftOut ?? undefined });
      return;
    }
    if (e instanceof TravelError) {
      // A leg the tour tried to arm ran into the travel ledger's own
      // guard (usually: another journey is already in progress). The
      // tour waits; the traveler's own journey comes first.
      const status = e.code === "ACTIVE_JOURNEY_EXISTS" ? 409 : 400;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }

  const bad = (res: Response, msg: string, issues?: unknown) => res.status(400).json({ error: msg, issues });

  // Soumaya's proposals — a live read, never a stored row. Ignoring
  // one creates nothing; silence is never approval.
  r.get("/suggestions", (req, res) => {
    res.json({ suggestions: repo(res).suggestions() });
  });

  // The current session, if any — playing first, else the most recently
  // updated. Reading settles a pending leg lazily (an arrived leg
  // advances the pointer; a cancelled one clears and the tour waits).
  r.get("/session", (req, res) => {
    res.json({ session: repo(res).session() });
  });

  r.get("/", (req, res) => {
    res.json({ tours: repo(res).list() });
  });

  r.post("/", (req, res) => {
    try {
      const p = CreateBody.safeParse(req.body);
      if (!p.success) return bad(res, "A tour needs a finished chapter to walk.", p.error.issues);
      res.status(201).json(repo(res).create(p.data.journeyId, p.data.title));
    } catch (e) {
      fail(res, e);
    }
  });

  r.patch("/:id", (req, res) => {
    try {
      const p = RenameBody.safeParse(req.body);
      if (!p.success) return bad(res, "A tour title is 1–80 characters.", p.error.issues);
      const tour = repo(res).rename(req.params.id, p.data.title);
      return tour ? res.json({ tour }) : res.status(404).json({ error: "That tour couldn't be found.", code: "TOUR_NOT_FOUND" });
    } catch (e) {
      fail(res, e);
    }
  });

  r.delete("/:id", (req, res) => {
    try {
      return repo(res).remove(req.params.id)
        ? res.json({ ok: true })
        : res.status(404).json({ error: "That tour couldn't be found.", code: "TOUR_NOT_FOUND" });
    } catch (e) {
      fail(res, e);
    }
  });

  // The compensating entry for a delete: the tour comes back unchanged.
  r.post("/:id/restore", (req, res) => {
    try {
      const tour = repo(res).restore(req.params.id);
      return tour ? res.json({ tour }) : res.status(404).json({ error: "That tour couldn't be found.", code: "TOUR_NOT_FOUND" });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/start", (req, res) => {
    try {
      const p = MoveBody.safeParse(req.body ?? {});
      if (!p.success) return bad(res, "A leg is a drift or a warp.", p.error.issues);
      res.json(repo(res).start(req.params.id, (p.data.kind ?? "drift") as TravelKind));
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/advance", (req, res) => {
    try {
      const p = MoveBody.safeParse(req.body ?? {});
      if (!p.success) return bad(res, "A leg is a drift or a warp.", p.error.issues);
      res.json(repo(res).advance(req.params.id, (p.data.kind ?? "drift") as TravelKind));
    } catch (e) {
      fail(res, e);
    }
  });

  // Step off the tour: free, instant, unpunished. A leg still inside
  // its cancel window is cancelled free; a leg already in flight is
  // left to the traveler's own travel.
  r.post("/:id/leave", (req, res) => {
    try {
      res.json({ session: repo(res).leave(req.params.id) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
