import { Router, type Response } from "express";
import type { AppContext } from "../../context.js";
import { EconomyRepo } from "../../economy.js";
import { TravelRepo, TravelError } from "../../repositories/travel.repo.js";
import { spaceOf } from "../middleware.js";

/**
 * Worlds travel (Phase 2, P2-2): thin routes over TravelRepo — the
 * contract the web travel layer (P2-3) integrates against. Every response
 * returns the full journey view, so a client recovering from a retried
 * request never has to guess state. The server owns all timing: any
 * client-sent timestamps in a body are ignored.
 */
export function travelRoutes(ctx: AppContext): Router {
  const r = Router();
  const repo = (res: Response) => new TravelRepo(ctx.handle, spaceOf(res));

  function fail(res: Response, e: unknown): void {
    if (e instanceof TravelError) {
      const status =
        e.code === "ACTIVE_JOURNEY_EXISTS" || e.code === "JOURNEY_NOT_DEPARTED" ? 409 : 400;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }

  function act(
    res: Response,
    fn: (t: TravelRepo) => ReturnType<TravelRepo["arrive"]>,
  ): void {
    try {
      const journey = fn(repo(res));
      if (!journey) {
        res.status(404).json({ error: "Journey not found." });
        return;
      }
      res.json({ journey });
    } catch (e) {
      fail(res, e);
    }
  }

  r.post("/depart", (req, res) => {
    try {
      const journey = repo(res).depart({
        clientKey: String(req.body?.clientKey ?? ""),
        kind: req.body?.kind,
        destination: String(req.body?.destination ?? ""),
      });
      res.json({ journey });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/cancel", (req, res) => act(res, (t) => t.cancel(String(req.body?.journeyId ?? ""))));
  r.post("/turn-back", (req, res) => act(res, (t) => t.turnBack(String(req.body?.journeyId ?? ""))));
  r.post("/arrive", (req, res) => act(res, (t) => t.arrive(String(req.body?.journeyId ?? ""))));

  r.get("/state", (req, res) => {
    const spaceId = spaceOf(res);
    const state = new TravelRepo(ctx.handle, spaceId).getState();
    res.json({ ...state, fuel: new EconomyRepo(ctx.handle, spaceId).toFuel() });
  });

  return r;
}
