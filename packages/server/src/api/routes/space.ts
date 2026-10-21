import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { SpacesRepo } from "../../auth/spaces.js";
import { seedWelcomeStar } from "../../analysis/welcome.js";
import {
  getPreferences,
  setPreference,
  validateTimezone,
  type NotifyPreferences,
} from "../../agent/notify/policy.js";

const AuthBody = z.object({
  gamerTag: z.string().trim().min(2).max(40),
  passcode: z.string().min(4).max(100),
  name: z.string().trim().min(2).max(40).optional(),
});

const ProfileBody = z.object({
  gamerTag: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(1).max(40).optional(),
});

// IM-129a/b: the space's timezone + proactive-notification preferences.
// These already exist as stored data (space_meta, owned by agent/notify/policy.ts
// — quiet hours, digest time and the daily proactive cap genuinely gate when
// Soumaya may reach out, and the timezone drives every space-local day) but no
// route exposed them, so Settings had nothing real to bind to.
const PreferencesBody = z.object({
  timezone: z.string().min(1).max(64).optional(),
  quietStart: z.string().max(5).optional(),
  quietEnd: z.string().max(5).optional(),
  digestTime: z.string().max(5).optional(),
  dailyProactiveCap: z.number().int().min(0).max(100).optional(),
});

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validate a whole preferences patch BEFORE any write, so a bad field can
 *  never leave a half-applied patch behind. Mirrors policy.ts's own rules. */
function preferencesPatchError(p: z.infer<typeof PreferencesBody>): string | null {
  if (p.timezone !== undefined && !validateTimezone(p.timezone)) return `Invalid IANA timezone: ${p.timezone}`;
  for (const k of ["quietStart", "quietEnd", "digestTime"] as const) {
    if (p[k] !== undefined && !HHMM_RE.test(p[k]!)) return `Invalid time (expected HH:MM): ${p[k]}`;
  }
  return null;
}

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

  // GET /api/space/preferences -> this brain's timezone + notification
  // preferences (defaults filled in by the policy store when unset).
  r.get("/preferences", (req, res) => {
    const id = (req.header("x-space-id") ?? "").trim();
    if (!id || !repo.getById(id)) {
      res.status(401).json({ error: "No valid brain selected." });
      return;
    }
    res.json(getPreferences(ctx.handle.sqlite, id));
  });

  // PATCH /api/space/preferences { timezone?, quietStart?, quietEnd?,
  // digestTime?, dailyProactiveCap? } -> update any subset; the whole patch
  // is validated first, then written through the policy store (the same
  // functions the notification boundary reads — no duplicate state).
  r.patch("/preferences", (req, res) => {
    const id = (req.header("x-space-id") ?? "").trim();
    if (!id || !repo.getById(id)) {
      res.status(401).json({ error: "No valid brain selected." });
      return;
    }
    const parsed = PreferencesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { timezone?, quietStart?, quietEnd?, digestTime?, dailyProactiveCap? }" });
      return;
    }
    const err = preferencesPatchError(parsed.data);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    const keys = Object.keys(parsed.data) as (keyof NotifyPreferences)[];
    for (const k of keys) {
      const r2 = setPreference(ctx.handle.sqlite, id, k, String(parsed.data[k]));
      if (!r2.ok) {
        res.status(400).json({ error: r2.error });
        return;
      }
    }
    res.json(getPreferences(ctx.handle.sqlite, id));
  });

  return r;
}
