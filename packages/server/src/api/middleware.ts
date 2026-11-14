import type { NextFunction, Request, Response } from "express";
import type { DbHandle } from "../db/client.js";
import { SpacesRepo } from "../auth/spaces.js";

/**
 * Conservative security headers. We don't serve third-party content, so deny
 * framing, sniffing, and referrer leakage. (No external dep — keeps the image
 * lean; swap for helmet if the surface grows.)
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  next();
}

/**
 * Multi-tenancy gate: resolve the caller's private brain from the `x-space-id`
 * header (set by the client after name+passcode login) and stash the validated
 * id on res.locals. Data routes mount this so one brain can never read another.
 */
export function requireSpace(
  handle: DbHandle,
): (req: Request, res: Response, next: NextFunction) => void {
  const repo = new SpacesRepo(handle);
  return (req, res, next) => {
    const id = req.header("x-space-id");
    if (!id || !repo.getById(id)) {
      res.status(401).json({ error: "Unauthorized — open a brain with a name + passcode first." });
      return;
    }
    (res.locals as { spaceId?: string }).spaceId = id;
    next();
  };
}

/** Read the validated space id attached by requireSpace. */
export function spaceOf(res: Response): string {
  return (res.locals as { spaceId?: string }).spaceId as string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Tiny in-memory fixed-window rate limiter, keyed by client IP. Guards the API
 * (especially the LLM-backed routes) from runaway loops or abuse. Per-process
 * only — fine for a single Fly machine; move to Redis if we scale horizontally.
 */
export const DEFAULT_RATE_LIMIT_MAX = 300;

export function rateLimit(
  opts: { windowMs?: number; max?: number } = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const windowMs = opts.windowMs ?? 60_000;
  // 300/min: a normal session (galaxy + panels + ingest) peaked ~155/min
  // before the next-job throttle; this leaves headroom without opening abuse.
  const max = opts.max ?? Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX);
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests — slow down." });
      return;
    }
    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    next();
  };
}
