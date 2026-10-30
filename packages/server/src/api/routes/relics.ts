import { Router } from "express";
import { RELIC_BY_ID } from "@brain/shared";
import type { AppContext } from "../../context.js";
import { TravelRepo } from "../../repositories/travel.repo.js";
import { RelicHoldingsStore, STATION_REQUIRED_MESSAGE, isOwnerSpace } from "../../relics/holdings.js";
import { RelicClaimService } from "../../relics/claims.js";
import { RelicExchangeService, type ExchangeOption } from "../../relics/exchange.js";
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

  /**
   * Relics I-4 (§5.2): the claim is SAMPLED. Three calls make one claim —
   * /sample (the settling moment), /scan (the attunement pulse), /found
   * (the claim itself). The world is always derived server-side from
   * the travel ledger, never taken from the request; the claim's reward
   * is paid inside the claim transaction by the claim service.
   */
  const currentWorldOf = (res: import("express").Response, s: RelicHoldingsStore) =>
    new TravelRepo(ctx.handle, spaceOf(res), () => s.gateHoldings(spaceOf(res))).currentWorld();

  r.post("/sample", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    // A client-claimed world that disagrees with the ledger is refused:
    // samples are evidence about where the server knows you are.
    const claimed = typeof req.body?.world === "string" ? req.body.world : null;
    const world = currentWorldOf(res, s);
    if (claimed !== null && claimed !== world) {
      res.status(400).json({ error: "You are not standing in that world right now.", state: s.state(spaceId) });
      return;
    }
    const out = new RelicClaimService(ctx.handle).recordSample(spaceId, world, req.body?.position, String(req.body?.kind ?? ""));
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    // §5.2's response is { ok } — the matched relics are NOT named back:
    // the endpoint must not become an oracle for which anchor a probed
    // position belongs to (independent review, I-4).
    res.json({ ok: true, state: s.state(spaceId) });
  });

  r.post("/scan", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const relicId = String(req.body?.relicId ?? "");
    const out = new RelicClaimService(ctx.handle).scan(spaceId, relicId, req.body?.position, currentWorldOf(res, s), req.body?.widened === true);
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    // Band + bearing only — never coordinates, never a distance (§5.3).
    res.json({ ok: true, band: out.band, bearing: out.bearing, widened: out.widened, quiet: out.quiet, state: s.state(spaceId) });
  });

  r.post("/found", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const relicId = String(req.body?.relicId ?? "");
    const def = RELIC_BY_ID.get(relicId);
    if (!def) { res.status(400).json({ error: "That relic is not in the Codex.", state: s.state(spaceId) }); return; }
    if (!def.discoverable) { res.status(400).json({ error: "That relic cannot be found yet — its resting place is not open.", state: s.state(spaceId) }); return; }
    // I-4: the anchorKey parameter is DELETED from this contract — the
    // server derives the anchor from the validated samples; a request
    // that still sends one is ignored, exactly as §5.2 specifies. The
    // claim carries { relicId, claimId, position }; claimId is the
    // idempotency key whose recorded outcome a replay returns verbatim.
    const claimId = typeof req.body?.claimId === "string" ? req.body.claimId : "";
    const result = new RelicClaimService(ctx.handle).claim(spaceId, relicId, claimId, req.body?.position, currentWorldOf(res, s));
    if (!result.ok) {
      res.status(result.kind === "empty-pool" ? 409 : 400).json({ error: result.reason, state: s.state(spaceId) });
      return;
    }
    // Relics I-6: a Seed claim's disposition rides the answer — the
    // copy was consumed, never held (R2-1/R3-3).
    res.json({ ok: true, alreadyFound: result.alreadyFound, awarded: result.awarded, ...(result.disposition ? { disposition: result.disposition } : {}), state: s.state(spaceId) });
  });

  r.post("/legacy-sync", (req, res) => {
    const spaceId = spaceOf(res);
    const s = store(res);
    s.ensureMigrated();
    const ids = Array.isArray(req.body?.relicIds) ? req.body.relicIds.map((x: unknown) => String(x)) : [];
    const out = s.syncLegacy(spaceId, ids);
    res.json({ ok: true, ...out, state: s.state(spaceId) });
  });

  /**
   * Relics I-6 (O-R7 / §9 ruling 5): Hold CHANGES — hold, unhold,
   * store, carry — are accepted only while the traveller stands at
   * the Great Station. The world is the server-derived travel state
   * (currentWorldOf), never client-supplied; a refusal mutates
   * nothing. Release is deliberately NOT gated (§5.7 enumerates
   * hold/unhold/store/carry/exchange only), and reads never are.
   */
  const atStation = (res: import("express").Response, s: RelicHoldingsStore) => currentWorldOf(res, s) === "great-station";
  const refuseOffStation = (res: import("express").Response, s: RelicHoldingsStore, spaceId: string) => {
    res.status(400).json({ error: STATION_REQUIRED_MESSAGE, state: s.state(spaceId) });
  };

  r.post("/hold", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!atStation(res, s)) { refuseOffStation(res, s, spaceId); return; }
    const out = s.hold(spaceId, String(req.body?.relicId ?? ""));
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  r.post("/unhold", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!atStation(res, s)) { refuseOffStation(res, s, spaceId); return; }
    const out = s.unhold(spaceId, String(req.body?.relicId ?? ""));
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  r.post("/store", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!atStation(res, s)) { refuseOffStation(res, s, spaceId); return; }
    const out = s.setLocation(spaceId, String(req.body?.relicId ?? ""), "station");
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  r.post("/carry", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    if (!atStation(res, s)) { refuseOffStation(res, s, spaceId); return; }
    const out = s.setLocation(spaceId, String(req.body?.relicId ?? ""), "carried");
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, state: s.state(spaceId) });
  });
  /**
   * Relics I-6 (§5.6): the Legacy exchange. The service enforces the
   * Station rule itself (it also owns the replay path, which is not
   * a change and answers from anywhere); the route only shapes the
   * HTTP answer. The response names the outcome — never a
   * RelicReturnView: the exchange's return is its own record (the
   * copy's chain carries the `exchanged`/`returned` truth).
   */
  r.post("/exchange", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    s.ensureMigrated();
    const out = new RelicExchangeService(ctx.handle).exchange(spaceId, {
      relicId: String(req.body?.relicId ?? ""),
      option: String(req.body?.option ?? "") as ExchangeOption,
      chartTargetRelicId: typeof req.body?.chartTargetRelicId === "string" ? req.body.chartTargetRelicId : null,
      attemptKey: typeof req.body?.attemptKey === "string" ? req.body.attemptKey : "",
    }, currentWorldOf(res, s));
    if (!out.ok) { res.status(out.kind === "not-held" ? 404 : 400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({
      ok: true, replayed: out.replayed, option: out.option, relicId: out.relicId,
      unlockedThreadIds: out.unlockedThreadIds, chartStirringId: out.chartStirringId,
      returnAnchor: out.returnAnchor, returnState: out.returnState, state: s.state(spaceId),
    });
  });
  r.post("/release", (req, res) => {
    const spaceId = spaceOf(res); const s = store(res);
    const relicId = String(req.body?.relicId ?? "");
    // Gate warning data is the client's two-step concern; the endpoint returns
    // whether this relic is part of the space's still-uncrossed gate set.
    const gateBefore = s.gateView(spaceId);
    const wasGatePiece = !gateBefore.open && (relicId === "witness-without-a-name" || s.gateHoldings(spaceId).otherRelicCount <= 2) && s.foundIds(spaceId).includes(relicId);
    const out = s.release(spaceId, relicId);
    if (!out) { res.status(404).json({ error: "You do not hold a copy of that relic.", state: s.state(spaceId) }); return; }
    // I-3 fix (b): a Keystone release is refused cleanly — 400 with the
    // plain reason, and the holding is untouched (the store changed
    // nothing but, where due, the gate-permanence record).
    if (!out.ok) { res.status(400).json({ error: out.reason, state: s.state(spaceId) }); return; }
    res.json({ ok: true, comet: out.event, wasGatePiece, gate: s.gateView(spaceId), state: s.state(spaceId) });
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
