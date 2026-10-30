import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { reactionBetween } from "@brain/shared";
import { StoryError, StoryRepo } from "../../story/story.js";
import { computeFlavor, setFlavorOn } from "../../story/flavor.js";
import { createNarrator, isTide, narrationText, type Narrator } from "../../story/narration.js";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * The story's private progress (docs/specs/lore-storage-2026-10-30.md). The client reports EVENTS ("I found this here"); the server decides. No response carries a
 * total, ratio or percentage. Validate → delegate → json.
 */
export function storyRoutes(ctx: AppContext, deps: { narrator?: Narrator } = {}): Router {
  const r = Router();
  // Shared, public-canon audio lives beside the database on the persistent volume (or the temp dir for an in-memory test database).
  const dbPath = process.env.DB_PATH ?? "";
  const narrator =
    deps.narrator ?? createNarrator({ dir: process.env.LORE_AUDIO_DIR ?? (dbPath && dbPath !== ":memory:" ? join(dirname(dbPath), "lore-audio") : join(tmpdir(), "soumaya-lore-audio")) });
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

  // Narration: the clip for an entry the brain has FOUND. The server speaks canon text only — the request names an entry, never words. 204 = no audio (the client reads it
  // with captions and the browser's own voice).
  // Is the studio voice on, and if not, why (names of secrets, never their values). The Book shows it so "it used my phone's voice" is never a mystery.
  r.get("/narration-status", (_req, res) => {
    res.json(narrator.status());
  });

  // A person's reaction to something you hold, in THEIR voice. Names the person and the held thing, never words; only a pairing the canon has, and only if you hold it.
  r.get("/narration/react/:npc", async (req, res) => {
    const reaction = reactionBetween(String(req.params.npc), String(req.query.holds ?? ""));
    if (!reaction) {
      res.status(404).json({ error: "They have nothing to say about that." });
      return;
    }
    const found = new Set(repo(res).book().finds.map((f) => f.entryId));
    if (!found.has(reaction.holds)) {
      res.status(403).json({ error: "You are not holding that." });
      return;
    }
    const clip = await narrator.narrate(reaction.line, "plain", reaction.role);
    if (!clip) {
      res.status(204).end();
      return;
    }
    res.setHeader("Content-Type", clip.contentType);
    res.setHeader("ETag", `"${clip.key}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(clip.audio);
  });

  r.get("/narration/:entryId", async (req, res) => {
    const entryId = String(req.params.entryId);
    const register = req.query.register === "warm" || req.query.register === "grave" ? req.query.register : "plain";
    const tide = isTide(req.query.tide) ? req.query.tide : undefined;
    const book = repo(res).book();
    const found = new Set(book.finds.map((f) => f.entryId));
    if (!found.has(entryId)) {
      res.status(403).json({ error: "You have not found that yet." });
      return;
    }
    const text = narrationText(entryId, register, found, tide);
    const clip = text ? await narrator.narrate(text, register) : null;
    if (!clip) {
      res.status(204).end();
      return;
    }
    res.setHeader("Content-Type", clip.contentType);
    res.setHeader("ETag", `"${clip.key}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(clip.audio);
  });

  // Flavour: how the locked story is voiced for this brain. Words and coarse labels only; never a number about the player, never memory text.
  r.get("/flavor", (_req, res) => {
    res.json(computeFlavor(ctx.handle, spaceOf(res)));
  });
  const flavorBody = z.object({ on: z.boolean() });
  r.put("/flavor", (req, res) => {
    const p = flavorBody.safeParse(req.body);
    if (!p.success) return bad(res, "Expected { on: boolean }.");
    setFlavorOn(ctx.handle, spaceOf(res), p.data.on);
    res.json(computeFlavor(ctx.handle, spaceOf(res)));
  });

  return r;
}
