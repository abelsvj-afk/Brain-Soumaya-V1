import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { GameEconomy, type GameActorKind } from "../../game/economy.js";

/**
 * G1 "The Hold" economy routes — the API surface the requirements
 * specify, and no more (server + shared only; player-facing economy UI
 * is a later, separately-authorized surface).
 *
 * Thin routes: validate shape → delegate to GameEconomy → json. The
 * space comes ONLY from the validated requireSpace context (I-4): a
 * space id in a path, body, or query is never honored — the service is
 * constructed for the validated space, so foreign identifiers simply
 * do not resolve. Requests carry intent + an idempotency key, never a
 * price, a yield, or a balance (I-1/I-5); a body field naming a price
 * is ignored by construction (the schemas below do not admit one, and
 * the service computes every value server-side — TX-AC-08).
 *
 * Actor kind: the settled guest rule is "look and talk, never write".
 * A request marked `x-actor-kind: guest` may read but every mutating
 * action is refused by the service (TX-AC-13). Absent the header the
 * actor is the space's owner.
 */

const Key = z.string().min(1).max(200);

const GatherBody = z.object({
  nodeId: z.string().min(1).max(200),
  idempotencyKey: Key,
});

const SellBody = z.object({
  buyerId: z.string().min(1).max(100),
  good: z.string().min(1).max(50),
  qty: z.unknown(),
  idempotencyKey: Key,
});

const RefineBody = z.object({
  recipeId: z.string().min(1).max(50),
  count: z.unknown().optional(),
  idempotencyKey: Key,
});

const TransferBody = z.object({
  direction: z.string().min(1).max(50),
  good: z.string().min(1).max(50),
  qty: z.unknown(),
  idempotencyKey: Key,
});

function actorOf(req: { header: (name: string) => string | undefined }): GameActorKind {
  return req.header("x-actor-kind") === "guest" ? "guest" : "owner";
}

export function gameEconomyRoutes(ctx: AppContext): Router {
  const r = Router();
  const econ = (res: Parameters<typeof spaceOf>[0]) => new GameEconomy(ctx.handle, spaceOf(res));

  // GET /api/game/state — credits, cargo, storage, dock, period, nodes.
  r.get("/state", (_req, res) => {
    res.json(econ(res).getState());
  });

  // GET /api/game/buyers-guide — posted prices + remaining premium
  // demand, from server state at render time (G1-AC-12).
  r.get("/buyers-guide", (_req, res) => {
    res.json(econ(res).buyersGuide());
  });

  // GET /api/game/recipes — inputs, fee, output, current sell values.
  r.get("/recipes", (_req, res) => {
    res.json({ recipes: econ(res).recipesView() });
  });

  // GET /api/game/ledger — recent ledger rows (game data only).
  r.get("/ledger", (req, res) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? raw : 100;
    res.json({ entries: econ(res).ledger(limit) });
  });

  // GET /api/game/mint-report — Credits minted per space-local day,
  // derived from the ledger alone (G1-AC-10).
  r.get("/mint-report", (_req, res) => {
    res.json({ days: econ(res).mintedPerDay() });
  });

  // GET /api/game/reconcile — ledger-vs-stored reconciliation (TX-AC-12).
  r.get("/reconcile", (_req, res) => {
    res.json(econ(res).reconcile());
  });

  // POST /api/game/dock | /undock — station services require docked.
  r.post("/dock", (req, res) => {
    const out = econ(res).dock(actorOf(req));
    res.status(out.ok ? 200 : 403).json(out);
  });
  r.post("/undock", (req, res) => {
    const out = econ(res).undock(actorOf(req));
    res.status(out.ok ? 200 : 403).json(out);
  });

  // POST /api/game/gather { nodeId, idempotencyKey }
  r.post("/gather", (req, res) => {
    const parsed = GatherBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { nodeId, idempotencyKey }", issues: parsed.error.issues });
      return;
    }
    const out = econ(res).gather({
      nodeId: parsed.data.nodeId,
      idempotencyKey: parsed.data.idempotencyKey,
      actorKind: actorOf(req),
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  // POST /api/game/sell { buyerId, good, qty, idempotencyKey }
  r.post("/sell", (req, res) => {
    const parsed = SellBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { buyerId, good, qty, idempotencyKey }", issues: parsed.error.issues });
      return;
    }
    const out = econ(res).sell({
      buyerId: parsed.data.buyerId,
      good: parsed.data.good,
      qty: parsed.data.qty,
      idempotencyKey: parsed.data.idempotencyKey,
      actorKind: actorOf(req),
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  // POST /api/game/refine { recipeId, count?, idempotencyKey }
  r.post("/refine", (req, res) => {
    const parsed = RefineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { recipeId, count?, idempotencyKey }", issues: parsed.error.issues });
      return;
    }
    const out = econ(res).refine({
      recipeId: parsed.data.recipeId,
      count: parsed.data.count,
      idempotencyKey: parsed.data.idempotencyKey,
      actorKind: actorOf(req),
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  // POST /api/game/transfer { direction, good, qty, idempotencyKey }
  r.post("/transfer", (req, res) => {
    const parsed = TransferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Body must be { direction, good, qty, idempotencyKey }",
        issues: parsed.error.issues,
      });
      return;
    }
    const out = econ(res).transfer({
      direction: parsed.data.direction,
      good: parsed.data.good,
      qty: parsed.data.qty,
      idempotencyKey: parsed.data.idempotencyKey,
      actorKind: actorOf(req),
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  return r;
}
