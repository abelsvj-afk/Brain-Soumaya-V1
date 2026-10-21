import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { SpacesRepo } from "../../auth/spaces.js";
import { requireSpace, spaceOf } from "../middleware.js";
import { seedWelcomeStar } from "../../analysis/welcome.js";

const AuthBody = z.object({
  gamerTag: z.string().trim().min(2).max(40),
  passcode: z.string().min(4).max(100),
  name: z.string().trim().min(2).max(40).optional(),
});

const ProfileBody = z.object({
  gamerTag: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(1).max(40).optional(),
});

// Passcode change + brain deletion (IM-129). Body floors stay at the login
// floor (min 1 / max 100) on purpose: the CURRENT passcode may be a legacy
// short one that must still verify, and the NEW-passcode minimum (8) is
// enforced in SpacesRepo beside the registration check it mirrors — a zod
// floor here would only produce a vaguer error for the same refusal.
const PasscodeBody = z.object({
  currentPasscode: z.string().min(1).max(100),
  newPasscode: z.string().min(1).max(100),
});

const DeleteBody = z.object({
  passcode: z.string().min(1).max(100),
  confirmation: z.string().min(1).max(40),
});

export function spaceRoutes(ctx: AppContext): Router {
  const r = Router();
  const repo = new SpacesRepo(ctx.handle);

  // POST /api/space/auth { gamerTag, passcode, name? } -> log in to or create a brain.
  // Returns the space's secret id, which the client stores and sends as
  // `x-space-id` on every later request.
  r.post("/auth", async (req, res) => {
    const parsed = AuthBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { gamerTag (2-40 chars), passcode (4+ chars), name (optional, 2-40 chars) }" });
      return;
    }
    const { gamerTag, passcode, name } = parsed.data;
    try {
      const result = repo.authOrCreate(gamerTag, passcode, name);
      if (!result) {
        res.status(401).json({ error: "Incorrect passcode for this gamer tag." });
        return;
      }
      // Endowed progress: a genuinely new, empty brain opens with its first star already
      // lit (seedWelcomeStar no-ops if the space has any memory, e.g. the legacy claim).
      if (result.created) {
        try {
          await seedWelcomeStar(ctx, result.space.id, result.space.name);
        } catch {
          /* a failed welcome seed must never block sign-in */
        }
      }
      res.json({ id: result.space.id, name: result.space.name, gamerTag: result.space.gamerTag, created: result.created });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/space/me -> validate the current x-space-id header.
  r.get("/me", (_req, res) => {
    const id = (res.req.header("x-space-id") ?? "").trim();
    const space = id ? repo.getById(id) : undefined;
    if (!space) {
      res.status(401).json({ error: "No valid brain selected." });
      return;
    }
    res.json({ id: space.id, name: space.name, gamerTag: space.gamerTag });
  });

  // PATCH /api/space/profile { gamerTag?, name? } -> update this brain's identity.
  // gamerTag stays unique; name is free. Uses the x-space-id header.
  r.patch("/profile", (req, res) => {
    const id = (res.req.header("x-space-id") ?? "").trim();
    if (!id || !repo.getById(id)) {
      res.status(401).json({ error: "No valid brain selected." });
      return;
    }
    const parsed = ProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { gamerTag?, name? }" });
      return;
    }
    try {
      res.json(repo.updateProfile(id, parsed.data));
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
    }
  });

  // POST /api/space/passcode { currentPasscode, newPasscode } -> rotate the
  // login passcode. Authenticated by x-space-id (requireSpace) AND by proof
  // of the current passcode — holding a stolen id alone cannot lock the
  // owner out by changing the secret. Wrong current passcode -> 401 (the
  // bad-login precedent in /auth above) and nothing changes. The space id
  // itself does NOT change (see SpacesRepo.changePasscode).
  r.post("/passcode", requireSpace(ctx.handle), (req, res) => {
    const parsed = PasscodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { currentPasscode, newPasscode }" });
      return;
    }
    try {
      const changed = repo.changePasscode(spaceOf(res), parsed.data.currentPasscode, parsed.data.newPasscode);
      if (!changed) {
        res.status(401).json({ error: "Current passcode is incorrect." });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/space { passcode, confirmation } -> permanently delete this
  // brain and all of its data. Requires BOTH the passcode re-entered (401
  // when wrong) AND `confirmation` exactly equal to the brain's gamer tag
  // (400 when mismatched) — either failure deletes nothing. There is no
  // undo and no recovery path; the client gates this behind a typed
  // hard-confirm flow for the same reason.
  r.delete("/", requireSpace(ctx.handle), (req, res) => {
    const parsed = DeleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { passcode, confirmation }" });
      return;
    }
    try {
      const deleted = repo.deleteSpace(spaceOf(res), parsed.data.passcode, parsed.data.confirmation);
      if (!deleted) {
        res.status(401).json({ error: "Passcode is incorrect." });
        return;
      }
      res.json({ ok: true, deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return r;
}
