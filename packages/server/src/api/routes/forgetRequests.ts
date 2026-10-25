import { Router } from "express";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import {
  ForgetSourceRefusal,
  approveForgetSourceRequest,
  createForgetSourceRequest,
  forgetSourceByRequest,
  inspectForgetSourceRequest,
  rejectForgetSourceRequest,
} from "../../sources/forgetSource.js";

// Verbatim-Recall V1 — source-forget routes (fix round 3, binding
// design D10, routes-only per OQ1): creation, approval, and apply are
// three separate explicit owner acts. No combined create+approve
// endpoint, no chat-driven creation, no approval-machine routing.
// Space-credential auth as for every other /api route (the `guard`
// at the mount point resolves x-space-id; spaceOf reads it).
//
// The apply route below is the ONLY production caller of
// forgetSourceByRequest (pinned by T-B9b). No other route receives a
// source id for forgetting — creation only creates a request.

function invalidId(res: import("express").Response): void {
  res.status(400).json({ error: "Invalid id" });
}

function refusal(res: import("express").Response, err: ForgetSourceRefusal): void {
  res.status(err.status).json({
    error: err.reason,
    message: err.message,
    ...(err.existingRequestId !== undefined ? { existingRequestId: err.existingRequestId } : {}),
  });
}

/** POST /api/sources/:id/forget-request — create (owner act 1). */
export function sourceForgetRequestRoutes(ctx: AppContext): Router {
  const r = Router();

  r.post("/:id/forget-request", (req, res) => {
    const sourceId = Number(req.params.id);
    if (!Number.isInteger(sourceId)) {
      invalidId(res);
      return;
    }
    try {
      const created = createForgetSourceRequest(ctx.handle, spaceOf(res), sourceId);
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof ForgetSourceRefusal) {
        refusal(res, err);
        return;
      }
      throw err;
    }
  });

  return r;
}

/**
 * GET /api/forget-requests/:id — binding inspection (the owner verifies
 * the bound source before confirming);
 * POST /api/forget-requests/:id/approve — approve (owner act 2);
 * POST /api/forget-requests/:id/reject — reject;
 * POST /api/forget-requests/:id/apply — apply (owner act 3).
 */
export function forgetRequestsRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/forget-requests/:id -> the content-free binding summary.
  r.get("/:id", (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      invalidId(res);
      return;
    }
    const summary = inspectForgetSourceRequest(ctx.handle, spaceOf(res), requestId);
    if (!summary) {
      res.status(404).json({ error: "not_found", message: `forget request ${requestId} does not exist` });
      return;
    }
    res.json(summary);
  });

  // POST /api/forget-requests/:id/approve -> status 'approved'.
  r.post("/:id/approve", (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      invalidId(res);
      return;
    }
    try {
      res.json(approveForgetSourceRequest(ctx.handle, spaceOf(res), requestId));
    } catch (err) {
      if (err instanceof ForgetSourceRefusal) {
        refusal(res, err);
        return;
      }
      throw err;
    }
  });

  // POST /api/forget-requests/:id/reject -> status 'rejected'.
  r.post("/:id/reject", (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      invalidId(res);
      return;
    }
    try {
      res.json(rejectForgetSourceRequest(ctx.handle, spaceOf(res), requestId));
    } catch (err) {
      if (err instanceof ForgetSourceRefusal) {
        refusal(res, err);
        return;
      }
      throw err;
    }
  });

  // POST /api/forget-requests/:id/apply -> erases the bound source.
  // The request must belong to the caller's space (a 404 otherwise —
  // one space's owner cannot apply another space's request); the
  // helper then re-verifies the binding itself (D7).
  r.post("/:id/apply", (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) {
      invalidId(res);
      return;
    }
    try {
      const summary = inspectForgetSourceRequest(ctx.handle, spaceOf(res), requestId);
      if (!summary) {
        res.status(404).json({ error: "not_found", message: `forget request ${requestId} does not exist` });
        return;
      }
      res.json(forgetSourceByRequest(ctx.handle, requestId));
    } catch (err) {
      if (err instanceof ForgetSourceRefusal) {
        refusal(res, err);
        return;
      }
      throw err;
    }
  });

  return r;
}
