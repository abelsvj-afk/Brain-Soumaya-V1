import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { StoryError, StoryRepo } from "../../story/story.js";

/**
 * The story's private progress (docs/specs/lore-storage-2026-10-30.md). The client reports EVENTS ("I found this here"); the server decides. No response carries a
 * total, ratio or percentage. Validate → delegate → json.
 */
export function storyRoutes(ctx: AppContext): Router {
  const r = Router();
  const repo = (res: Parameters<typeof spaceOf>[0]) => new StoryRepo(ctx.handle, spaceOf(res));
  const id = z.string().min(1).max(120);

  const fail = (res: import("express").Response, e: unknown) => {
    if (e instanceof StoryError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    throw e;
  };
  const bad = (res: import("express").Response, msg: string) => res.status(400).json({ error: msg });

  r.get("/book", (_req, res) => {
    res.json(repo(res).book());
  });

  const findBody = z.object({ entryId: id, source: z.string().min(1).max(60) });
  r.post("/find", (req, res) => {
    const p = findBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { entryId, source }.");
    try {
      res.json(repo(res).find(p.data.entryId, p.data.source));
    } catch (e) {
      fail(res, e);
    }
  });

  const pairBody = z.object({ a: id, b: id });
  r.put("/link", (req, res) => {
    const p = pairBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { a, b }.");
    try {
      res.json(repo(res).link(p.data.a, p.data.b));
    } catch (e) {
      fail(res, e);
    }
  });
  r.delete("/link", (req, res) => {
    const p = pairBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { a, b }.");
    repo(res).unlink(p.data.a, p.data.b);
    res.json({ ok: true });
  });

  const noteBody = z.object({ entryId: id, note: z.string().max(10_000) });
  r.put("/note", (req, res) => {
    const p = noteBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { entryId, note }.");
    try {
      repo(res).setNote(p.data.entryId, p.data.note);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  const recallBody = z.object({ entryId: id });
  r.post("/recall", (req, res) => {
    const p = recallBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { entryId }.");
    try {
      repo(res).recall(p.data.entryId);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
