import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { getVapidConfig } from "../../push/service.js";
import { PushSubscriptionsRepo } from "../../repositories/pushSubscriptions.repo.js";

/**
 * Web-push routes (Immersion Round 3, CL3). Mounted behind requireSpace in
 * api/server.ts, so every handler's space comes from spaceOf(res).
 *
 * Unconfigured-off: with no VAPID env, /config reports disabled and
 * /subscribe refuses with 503 WITHOUT storing anything — the feature never
 * half-exists.
 */

const SubscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  // Browser PushSubscription JSON also carries expirationTime; accepted
  // and ignored so the client can post subscription.toJSON() verbatim.
  expirationTime: z.number().nullable().optional(),
  userAgent: z.string().max(512).optional(),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().min(1).max(2048),
});

export function pushRoutes(ctx: AppContext): Router {
  const r = Router();

  // GET /api/push/config -> { enabled, vapidPublicKey }
  // The public key is not a secret — the client needs it as the
  // applicationServerKey when subscribing. Null whenever disabled.
  r.get("/config", (_req, res) => {
    const cfg = getVapidConfig();
    res.json({ enabled: cfg !== null, vapidPublicKey: cfg?.publicKey ?? null });
  });

  // POST /api/push/subscribe { endpoint, keys: { p256dh, auth }, userAgent? }
  r.post("/subscribe", (req: Request, res: Response) => {
    if (!getVapidConfig()) {
      res.status(503).json({ error: "Push notifications are not configured on this server." });
      return;
    }
    const parsed = SubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { endpoint: url, keys: { p256dh, auth } }" });
      return;
    }
    const { endpoint, keys, userAgent } = parsed.data;
    try {
      new URL(endpoint);
    } catch {
      res.status(400).json({ error: "endpoint must be a valid URL" });
      return;
    }
    const repo = new PushSubscriptionsRepo(ctx.handle, spaceOf(res));
    const row = repo.upsert({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? req.get("user-agent")?.slice(0, 512) ?? null,
    });
    res.status(201).json({ ok: true, id: row.id });
  });

  // Unsubscribe: POST (fetch-friendly) and DELETE both accepted, same body.
  const unsubscribe = (req: Request, res: Response) => {
    const parsed = UnsubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { endpoint }" });
      return;
    }
    const repo = new PushSubscriptionsRepo(ctx.handle, spaceOf(res));
    const removed = repo.deleteByEndpoint(parsed.data.endpoint);
    res.json({ ok: true, removed });
  };
  r.post("/unsubscribe", unsubscribe);
  r.delete("/unsubscribe", unsubscribe);

  return r;
}
