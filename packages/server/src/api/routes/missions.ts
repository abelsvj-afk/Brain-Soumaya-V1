import { Router, type Response } from "express";
import type { AppContext } from "../../context.js";
import { type MissionKind } from "@brain/shared";
import { spaceOf } from "../middleware.js";
import {
  dispatchMission,
  getMissionsOverview,
  MissionError,
  recallMission,
  resumeFleet,
  stopFleet,
  type DispatchInput,
} from "../../missions/loop.js";

/**
 * Fleets on automated missions: thin routes over the loop in
 * missions/loop.ts. The server owns every outcome — the settle, the
 * report, the stop switch. GET / runs a lazy settle (the travel
 * pattern) and returns the overview; POST /dispatch is the approve
 * step. The client renders what the server returns and decides
 * nothing. Missions are free: there is no insufficient-fuel path.
 */
export function missionsRoutes(ctx: AppContext): Router {
  const r = Router();

  function fail(res: Response, e: unknown): void {
    if (e instanceof MissionError) {
      const status =
        e.code === "UNKNOWN_MISSION"
          ? 404
          : e.code === "FLEET_STOPPED" || e.code === "MISSION_NOT_ACTIVE"
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
      res.json(getMissionsOverview(ctx.handle, spaceId));
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/dispatch", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: DispatchInput = {
        clientKey: String(body.clientKey ?? ""),
        kind: body.kind as MissionKind,
        destination: String(body.destination ?? ""),
        durationMinutes: Number(body.durationMinutes),
        fleetSize: Number(body.fleetSize),
      };
      const mission = dispatchMission(ctx.handle, spaceId, input);
      res.json({ mission, overview: getMissionsOverview(ctx.handle, spaceId) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:id/recall", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      const id = String(req.params.id ?? "");
      const mission = recallMission(ctx.handle, spaceId, id);
      res.json({ mission, overview: getMissionsOverview(ctx.handle, spaceId) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/stop", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      stopFleet(ctx.handle, spaceId);
      res.json({ overview: getMissionsOverview(ctx.handle, spaceId) });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/resume", (req, res) => {
    try {
      const spaceId = spaceOf(res);
      resumeFleet(ctx.handle, spaceId);
      res.json({ overview: getMissionsOverview(ctx.handle, spaceId) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
