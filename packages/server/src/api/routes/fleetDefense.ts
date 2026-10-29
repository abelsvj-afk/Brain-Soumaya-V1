import { Router, type Response } from "express";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import {
  FleetDefenseError,
  getDefense,
  getOverview,
  offerRelease,
  startDefense,
  tickDefense,
} from "../../fleetDefense/defense.js";

/**
 * Fleet defense (Wave 2): thin routes over the service in
 * fleetDefense/defense.ts. The server owns every outcome — the
 * offer, the summoning, the board, the win and the loss. The
 * client renders what the server returns and decides nothing.
 * Home defense is free: no route here spends fuel, and no route
 * writes to a brain record.
 */
export function fleetDefenseRoutes(ctx: AppContext): Router {
  const r = Router();

  function fail(res: Response, e: unknown): void {
    if (e instanceof FleetDefenseError) {
      const status =
        e.code === "UNKNOWN_RELEASE" || e.code === "UNKNOWN_DEFENSE" || e.code === "NODE_NOT_FOUND"
          ? 404
          : e.code === "RELEASE_NOT_OFFERED" ||
              e.code === "DEFENSE_ALREADY_ACTIVE" ||
              e.code === "DEFENSE_NOT_ACTIVE"
            ? 409
            : 400;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    throw e;
  }

  r.get("/", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      res.json({ overview: getOverview(ctx.handle, spaceId) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/releases", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const release = offerRelease(ctx.handle, spaceId, req.body);
      res.status(201).json({ release });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/releases/:id/start", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "That release isn't a real one.", code: "INVALID_INPUT" });
        return;
      }
      const defense = startDefense(ctx.handle, spaceId, id);
      res.status(201).json({ defense });
    } catch (e) {
      fail(res, e);
    }
  });

  r.get("/defenses/:id", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "That defense isn't a real one.", code: "INVALID_INPUT" });
        return;
      }
      res.json({ defense: getDefense(ctx.handle, spaceId, id) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/defenses/:id/tick", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "That defense isn't a real one.", code: "INVALID_INPUT" });
        return;
      }
      const defense = tickDefense(ctx.handle, spaceId, id, {
        mode: req.body?.mode,
        lane: req.body?.lane,
      });
      res.json({ defense });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
