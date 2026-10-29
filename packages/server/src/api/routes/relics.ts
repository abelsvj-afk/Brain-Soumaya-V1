import { Router } from "express";
import { RELIC_BY_ID } from "@brain/shared";
import type { AppContext } from "../../context.js";
import { EconomyRepo } from "../../economy.js";
import { TravelRepo } from "../../repositories/travel.repo.js";
import { RelicHoldingsStore, isOwnerSpace } from "../../relics/holdings.js";
import { spaceOf } from "../middleware.js";

/** Relic Buffs v2 routes (§§6–10). Every write re-checks its preconditions server-side; no user-facing payload carries a timestamp. */
export function relicsRoutes(ctx: AppContext): Router {
  const r = Router();
  const store = (res: import("express").Response) => new RelicHoldingsStore(ctx.handle);

  r.get("/", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const previewId = typeof req.query.preview === "string" ? req.query.preview : null;
    if (previewId) {
      const p = s.preview(spaceId, previewId);
      res.json({
        previewFor: previewId,
        previewName: RELIC_BY_ID.get(previewId)?.name ?? previewId,
        refused: p.refused ?? null,
        wouldHold: p.heldIds,
        buffs: p.buffs,
      });
      return;
    }
    res.json(s.state(spaceId));
  });

  r.post("/found", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const relicId = String(req.body?.relicId ?? "");
    const def = RELIC_BY_ID.get(relicId);
    if (!def) { res.status(400).json({ error: "That relic is not in the Codex.", state: s.state(spaceId) }); return; }
    if (!def.discoverable) { res.status(400).json({ error: "That relic cannot be found yet — its resting place is not open.", state: s.state(spaceId) }); return; }
    const currentWorld = new TravelRepo(ctx.handle, spaceId, () => s.gateHoldings(spaceId)).currentWorld();
    const anchorKey = typeof req.body?.anchorKey === "string" ? req.body.anchorKey : undefined;
    const result = s.claimFind(spaceId, relicId, currentWorld, anchorKey);
    if (!result.ok) {
      res.status(result.kind === "empty-pool" ? 409 : 400).json({ error: result.reason, state: s.state(spaceId) });
      return;
    }
    if (result.rewardAmount > 0) new EconomyRepo(ctx.handle, spaceId).add(result.rewardAmount);
    res.json({ ok: true, alreadyFound: result.alreadyFound, awarded: result.rewardAmount > 0, state: s.state(spaceId) });
  });

  r.post("/legacy-sync", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const ids = Array.isArray(req.body?.relicIds) ? req.body.relicIds.map((x: unknown) => String(x)) : [];
    const out = s.syncLegacy(spaceId, ids);
    res.json({ ok: true, ...out, state: s.state(spaceId) });
  });

  r.post("/hold", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    const out = s.hold(spaceId, String(req.body?.relicId ?? ""));
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  r.post("/unhold", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    const out = s.unhold(spaceId, String(req.body?.relicId ?? ""));
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  r.post("/release", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    const relicId = String(req.body?.relicId ?? "");
    // Gate warning data is the client's two-step concern; the endpoint returns
    // whether this relic is part of the space's still-uncrossed gate set.
    const gateBefore = s.gateView(spaceId);
    const wasGatePiece = !gateBefore.open && (relicId === "witness-without-a-name" || s.gateHoldings(spaceId).otherRelicCount <= 2) && s.foundIds(spaceId).includes(relicId);
    const event = s.release(spaceId, relicId);
    if (!event) { res.status(404).json({ error: "You do not hold a copy of that relic.", state: s.state(spaceId) }); return; }
    res.json({ ok: true, comet: event, wasGatePiece, gate: s.gateView(spaceId), state: s.state(spaceId) });
  });

  r.get("/scarcity", (_req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!isOwnerSpace(spaceId)) { res.status(403).json({ error: "The scarcity switch is only for the owner's own testing space." }); return; }
    res.json({ isOwnerSpace: true, scarcityOff: s.scarcityOff(spaceId) });
  });
  r.post("/scarcity", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!isOwnerSpace(spaceId)) { res.status(403).json({ error: "The scarcity switch is only for the owner's own testing space." }); return; }
    const ok = s.setScarcityOff(spaceId, req.body?.off === true);
    res.json({ ok, isOwnerSpace: true, scarcityOff: s.scarcityOff(spaceId) });
  });

  return r;
}
