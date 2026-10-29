import { Router } from "express";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import {
  decideWorldChange,
  explainChange,
  getMutationState,
  listProposals,
  listWorldChangeLog,
  sweepWorldProposals,
  undoWorldChange,
} from "../../worlds/mutation.js";
import { sweepApprovals } from "../../agent/approvals.js";
import "../../worlds/brainAppliers.js";

/**
 * Phase 4 — world-change rail routes (§17). Thin routes over the mutation
 * module; the server owns all state, the client renders it.
 *
 * Decision notes: the decide body accepts an optional `note`, but no column
 * stores free-text decision notes in this increment — the note is accepted
 * and ignored (the decision itself is what the log records). Silence is
 * never approval: only an explicit approve/reject/defer here decides.
 * Space ID is the login credential (decided_by = space).
 */
export function worldChangesRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get("/state", (req, res) => {
    res.json(getMutationState(ctx, spaceOf(res)));
  });

  r.get("/proposals", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    res.json({ proposals: listProposals(ctx.handle.sqlite, spaceOf(res), { status, kind }) });
  });

  r.get("/proposals/:id", (req, res) => {
    const spaceId = spaceOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "proposal id must be an integer" });
      return;
    }
    const explained = explainChange(ctx.handle.sqlite, spaceId, id);
    if (!explained) {
      res.status(404).json({ error: "proposal not found" });
      return;
    }
    res.json({ proposal: explained.proposal, lines: explained.lines });
  });

  r.post("/proposals/:id/decide", async (req, res) => {
    const spaceId = spaceOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "proposal id must be an integer" });
      return;
    }
    const decision = req.body?.decision;
    if (decision !== "approve" && decision !== "reject" && decision !== "defer") {
      res.status(400).json({ error: "decision must be approve, reject, or defer" });
      return;
    }
    const result = await decideWorldChange(ctx, spaceId, id, decision, spaceId);
    if (!result.proposal) {
      res.status(404).json({ error: result.error ?? "proposal not found" });
      return;
    }
    if (!result.ok) {
      // Approve attempted but the apply failed: the proposal stands approved
      // (M1) — report 409 with the live proposal so the client can retry.
      res.status(409).json({ proposal: result.proposal, error: result.error });
      return;
    }
    res.json({ proposal: result.proposal });
  });

  r.post("/proposals/:id/undo", (req, res) => {
    const spaceId = spaceOf(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "proposal id must be an integer" });
      return;
    }
    const result = undoWorldChange(ctx, spaceId, id);
    if (!result.proposal) {
      res.status(404).json({ error: result.error ?? "proposal not found" });
      return;
    }
    if (!result.ok) {
      res.status(409).json({ proposal: result.proposal, error: result.error });
      return;
    }
    res.json({ proposal: result.proposal, logId: result.logId });
  });

  r.get("/log", (req, res) => {
    res.json({ entries: listWorldChangeLog(ctx.handle.sqlite, spaceOf(res)) });
  });

  r.post("/sweep", async (req, res) => {
    const spaceId = spaceOf(res);
    const world = await sweepWorldProposals(ctx, spaceId);
    // The tool-approval sweep runs here too, so pending approvals of both
    // kinds surface in the one inbox. Background context: no conversational
    // principal, no-op notify (a retried tool's notification has nowhere to
    // go from a sweep; its executed status is recorded and visible).
    const tc = { ctx, spaceId, now: Date.now(), notify: async () => {} };
    const approvals = await sweepApprovals(tc);
    res.json({ world, approvals });
  });

  return r;
}
