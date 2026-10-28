import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import type { AppContext } from "../context.js";
import { ingestRoutes } from "./routes/ingest.js";
import { graphRoutes } from "./routes/graph.js";
import { nodesRoutes } from "./routes/nodes.js";
import { searchRoutes } from "./routes/search.js";
import { digestRoutes } from "./routes/digest.js";
import { chatRoutes } from "./routes/chat.js";
import { maintenanceRoutes } from "./routes/maintenance.js";
import { travelRoutes } from "./routes/travel.js";
import { toursRoutes } from "./routes/tours.js";
import { npcsRoutes } from "./routes/npcs.js";
import { usageRoutes } from "./routes/usage.js";
import { constellationRoutes } from "./routes/constellations.js";
import { loreRoutes } from "./routes/lore.js";
import { instructionsRoutes } from "./routes/instructions.js";
import { documentsRoutes } from "./routes/documents.js";
import { personaRoutes } from "./routes/persona.js";
import { visitorRoutes } from "./routes/visitors.js";
import { contactRoutes } from "./routes/contact.js";
import { cognitiveRoutes } from "./routes/cognitive.js";
import { workingRoutes } from "./routes/working.js";
import { inquiryRoutes } from "./routes/inquiries.js";
import { candidateRoutes } from "./routes/candidates.js";
import { gardenRoutes } from "./routes/garden.js";
import { peopleRoutes } from "./routes/people.js";
import { timelineRoutes } from "./routes/timeline.js";
import { reviewRoutes } from "./routes/review.js";
import { lensesRoutes } from "./routes/lenses.js";
import { codexRoutes } from "./routes/codex.js";
import { financeRoutes } from "./routes/finance.js";
import { journeysRoutes } from "./routes/journeys.js";
import { notificationRoutes } from "./routes/notifications.js";
import { investigateRoutes } from "./routes/investigate.js";
import { spaceRoutes } from "./routes/space.js";
import { telegramRoutes } from "./routes/telegram.js";
import { pushRoutes } from "./routes/push.js";
import { securityHeaders, rateLimit, requireSpace } from "./middleware.js";

/** Assemble the Express app over an AppContext. */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.set("trust proxy", 1); // behind Fly's proxy — needed for correct req.ip
  app.use(securityHeaders);
  app.use(cors());
  // Raised from 1mb to accommodate knowledge-document text uploads (per-route zod
  // `max` bounds each endpoint independently). Env-overridable.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "8mb" }));
  app.use("/api", rateLimit());

  // Health is unauthenticated — provider status only, no data facts (the global
  // node count spanned every tenant's brain).
  // Health check (open) — a real dependency probe an external uptime monitor can use:
  // it verifies the SQLite handle is alive and returns 503 when it isn't, so an outage
  // is detectable (not a blind 200). LLM "degraded" is reported but is a normal
  // functional state (offline heuristic), so it never fails the check.
  app.get("/api/health", (_req, res) => {
    let dbOk = true;
    try {
      ctx.handle.sqlite.prepare("SELECT 1").get();
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      uptimeSec: Math.round(process.uptime()),
      db: { ok: dbOk },
      embeddings: { model: ctx.embeddings.model, dim: ctx.embeddings.dim },
      llm: {
        model: ctx.llm.model,
        available: ctx.llm.available,
        degraded: ctx.llm.degraded ?? false,
        degradedReason: ctx.llm.degradedReason ?? null,
      },
    });
  });

  // Auth (open): log in to or create a private brain. A much tighter limit than
  // the general API one — 4-char passcodes at 120 guesses/min was a brute-force
  // ceiling, and unlimited free creation inflates the autonomy loop's work.
  app.use("/api/space/auth", rateLimit({ max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10) }));
  app.use("/api/space", spaceRoutes(ctx));

  // Telegram webhook (open — secured by its own secret, resolves the brain itself).
  app.use("/api/telegram", telegramRoutes(ctx));

  // Every per-brain data route requires a valid x-space-id (set after login).
  const guard = requireSpace(ctx.handle);

  // LLM-backed routes previously shared the generic 120/min ceiling with cheap reads —
  // a single space could burn the deployment-wide LLM budget (usage.ts) fast. `/api/chat`
  // and `/api/ingest` are entirely LLM-backed, so tightened at the whole-router mount;
  // digest.ts/nodes.ts/finance.ts mix cheap reads with a few expensive endpoints, so
  // those get the tighter limiter applied per-route inside their own files instead.
  const llmLimiter = rateLimit({ max: Number(process.env.LLM_RATE_LIMIT_MAX ?? 20) });

  // Usage/budget is deployment-wide (shared API budget). Guarded so it can't be
  // tampered with anonymously; the mutating routes additionally honor ADMIN_TOKEN.
  app.use("/api/usage", guard, usageRoutes(ctx));
  app.use("/api/ingest", guard, llmLimiter, ingestRoutes(ctx));
  app.use("/api/graph", guard, graphRoutes(ctx));
  app.use("/api/nodes", guard, nodesRoutes(ctx));
  app.use("/api/search", guard, searchRoutes(ctx));
  app.use("/api/digest", guard, digestRoutes(ctx));
  app.use("/api/chat", guard, llmLimiter, chatRoutes(ctx));
  app.use("/api/maintenance", guard, maintenanceRoutes(ctx));
  app.use("/api/travel", guard, travelRoutes(ctx));
  app.use("/api/tours", guard, toursRoutes(ctx));
  app.use("/api/npcs", guard, npcsRoutes(ctx));
  app.use("/api/constellations", guard, constellationRoutes(ctx));
  app.use("/api/lore", guard, loreRoutes(ctx));
  app.use("/api/instructions", guard, instructionsRoutes(ctx));
  app.use("/api/documents", guard, documentsRoutes(ctx));
  app.use("/api/persona", guard, personaRoutes(ctx));
  app.use("/api/visitors", guard, visitorRoutes(ctx));
  app.use("/api/contact", guard, contactRoutes(ctx));
  app.use("/api/cognitive", guard, cognitiveRoutes(ctx));
  app.use("/api/working", guard, workingRoutes(ctx));
  app.use("/api/inquiries", guard, inquiryRoutes(ctx));
  app.use("/api/candidates", guard, candidateRoutes(ctx));
  app.use("/api/garden", guard, gardenRoutes(ctx));
  app.use("/api/people", guard, peopleRoutes(ctx));
  app.use("/api/timeline", guard, timelineRoutes(ctx));
  app.use("/api/review", guard, reviewRoutes(ctx));
  app.use("/api/lenses", guard, lensesRoutes(ctx));
  app.use("/api/codex", guard, codexRoutes(ctx));
  app.use("/api/finance", guard, financeRoutes(ctx));
  app.use("/api/journeys", guard, journeysRoutes(ctx));
  app.use("/api/investigate", guard, investigateRoutes(ctx));
  app.use("/api/push", guard, pushRoutes(ctx));
  app.use("/api/notifications", guard, notificationRoutes(ctx));

  // In production, serve the built web app (set WEB_DIR to packages/web/dist)
  // and fall back to index.html for client-side routes (non-API GETs).
  const webDir = process.env.WEB_DIR;
  if (webDir) {
    const dir = path.resolve(webDir);
    // The shell (index.html / sw.js / manifest) must NEVER be cached, or a deploy
    // won't reach an installed PWA. Content-hashed assets (…-AbC123.js/.css) are
    // immutable, so cache them hard. This is what makes new builds actually show up.
    app.use(
      express.static(dir, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (base === "index.html" || base === "sw.js" || base.endsWith(".webmanifest")) {
            res.setHeader("Cache-Control", "no-cache, must-revalidate");
          } else if (/\.[A-Za-z0-9]{8,}\.(?:js|css)$/.test(base)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.setHeader("Cache-Control", "no-cache, must-revalidate"); // SPA shell — always revalidate
      res.sendFile(path.join(dir, "index.html"));
    });
  }

  // Centralized error handler (Express 5 forwards rejected async handlers here).
  // The detail goes to the server log only — raw messages can carry SQL/provider
  // internals that don't belong in a client response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] error:", err);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
