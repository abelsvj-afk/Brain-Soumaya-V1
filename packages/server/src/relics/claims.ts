/**
 * Relics I-4 — the sampled claim (implementation design §5.2/§5.3, §4.7;
 * approved design §4/§4.2). The unified claim core §5.5 will reuse: the
 * player route calls this service; the award itself is the holdings
 * store's single award core, wrapped here with everything sampling
 * adds — server-stamped position samples, presence/dwell validation
 * from SERVER receipt times, the scan pulse, claim receipts, the
 * first-discovery write, and the discovery reward paid INSIDE the
 * claim transaction (so the recorded outcome and the payment can never
 * diverge — §5.2's deliberate change from route-pays-after).
 *
 * The honesty ceiling (approved design §4.2) is stated plainly because
 * it is the design, not a caveat: samples are client-REPORTED positions
 * that the server stamps and cross-checks — radius, dwell, and
 * sample-to-sample plausibility. That is plausibility enforcement, not
 * proof of presence; a modified client can fabricate a plausible path,
 * but outright forgeries (teleports, fake dwell, impossible speed)
 * fail. Speed plausibility is OBSERVE-ONLY in this increment (owner
 * ruling 3 — see RELIC_SPEED_CAPS_ENFORCED in @brain/shared): every
 * claim records its verdict on the attempt receipt; nothing is
 * rejected on speed until the caps are measured against the real
 * client flight.
 *
 * Relics I-5 makes this service the single claim entry for BOTH
 * claimer kinds (§5.5, fix (d)): the player route above, and
 * claimForNpc below for the NPC daily loop. The store under them is
 * shared (one copy pool, one bind/materialize core — relics/
 * holdings.ts); the dispositions stay player-shaped (holdings +
 * Codex + discovery + reward) vs NPC-shaped (the read-model row
 * only). Player claims also resolve stirrings inside their award
 * transaction (§5.2 step 5, relics/stirrings.ts), and NPC claims
 * honor the last-copy courtesy in the same serialization as the
 * award — never a check-then-act gap.
 *
 * The exact-copy follow-up (approved design §3; I-5 review P2-2;
 * owner delegation 2026-10-30) makes the stirring's promise exact
 * at claim time: a claimer with an open stirring is awarded exactly
 * the stirred copy or nothing — standing at another anchor is an
 * honest, non-committed refusal with the stirring left open, a
 * promised copy no longer placed resolves the stirring quiet at
 * the holder's own attempt, and ANY award (player or NPC) quiets
 * every other space's stirring that promised the awarded copy,
 * inside the award transaction. The P2-A rider rides here too:
 * the scan's private-class read converts first (senseableAnchors).
 */
import {
  RELICS, RELIC_BY_ID, RELIC_ANCHOR_POINTS, RELIC_COPY_LIMITS,
  RELIC_DWELL_MS, RELIC_SCAN_COOLDOWN_MS, RELIC_SAMPLE_FRESHNESS_MS,
  RELIC_SAMPLE_KEEP, RELIC_PLAUSIBILITY_SLACK_UNITS, RELIC_SPEED_CAPS_ENFORCED,
  RELIC_WORLD_SPEED_CAPS, RELIC_SCAN_BAND_EDGES, RELIC_SCAN_WIDEN_COST,
  type RelicAnchorDef, type RelicScanBand,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { EconomyRepo } from "../economy.js";
import {
  RelicHoldingsStore, EMPTY_POOL_MESSAGE, WRONG_WORLD_MESSAGE,
  NOT_FINDABLE_MESSAGE, UNKNOWN_RELIC_MESSAGE,
  STIRRED_ELSEWHERE_MESSAGE, TRAIL_QUIET_MESSAGE,
} from "./holdings.js";
import { RelicStirringService } from "./stirrings.js";

export type ClaimFailureKind = "unknown" | "not-findable" | "wrong-world" | "no-presence" | "empty-pool" | "malformed";
export type ClaimResult =
  | { ok: true; alreadyFound: boolean; awarded: boolean; replayed: boolean; copyId: string | null }
  | { ok: false; reason: string; kind: ClaimFailureKind; replayed: boolean };
export type ScanResult =
  | { ok: true; band: RelicScanBand | null; bearing: string | null; widened: boolean; quiet: boolean }
  | { ok: false; reason: string; kind: "unknown" | "not-findable" | "wrong-world" | "cooldown" | "malformed" };
/** Relics I-5: the NPC claim's outcome — awarded, deferred by the
 *  last-copy courtesy, or nothing takeable in the NPC's world. */
export type NpcClaimResult =
  | { status: "awarded"; relicId: string; copyId: string }
  | { status: "deferred" }
  | { status: "empty" };
export interface PlausibilityVerdict { enforced: boolean; wouldReject: boolean; maxSpeed: number; cap: number }

type Pos = readonly [number, number, number];
interface SampleRow { id: number; x: number; y: number; z: number; kind: string; received_at: string }

const KEY_CONFLICT_MESSAGE = "That claim key already belongs to a different relic's claim — start a fresh claim for this one.";
const NO_PRESENCE_MESSAGE = "The glimmer fades — a claim needs you settled beside it first. Stay close for a few breaths, then reach again.";
const COOLDOWN_MESSAGE = "The pulse needs a moment to gather again.";
const NOWHERE_MESSAGE = "Nothing rests within reach of where you are standing.";
const MALFORMED_MESSAGE = "That didn't arrive whole — please try again.";

function isPos(p: unknown): p is Pos {
  return Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n));
}
function dist(a: Pos, b: Pos): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
/** Parse a stored stamp the way the economy layer does: naive stamps read as UTC. */
function parseTs(s: string): number {
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}
/** The pool a copy belongs to (mirrors the holdings store's scope rule). */
function scopeFor(relicId: string, spaceId: string): string | null {
  return RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private" ? spaceId : null;
}

interface StoredOutcome {
  ok: boolean; alreadyFound?: boolean; awarded?: boolean; copyId?: string | null;
  kind?: ClaimFailureKind; reason?: string; plausibility?: PlausibilityVerdict;
  /**
   * Only COMMITTED dispositions replay (awarded / already-found /
   * empty-pool — outcomes the claim transaction or the caller's own
   * holdings settled). Validation refusals (wrong-world, no-presence)
   * are recorded with outcome + reason like every other attempt, but
   * committed:false — a hunter who fixes the mistake and retries the
   * same claim key must land, not be refused forever by their first
   * error (independent review, I-4).
   */
  committed?: boolean;
}

export class RelicClaimService {
  private store: RelicHoldingsStore;
  constructor(private h: DbHandle) { this.store = new RelicHoldingsStore(h); }

  // ---- samples -------------------------------------------------------

  /** Stamp and store one sample (the server's clock is the only one), then prune the (space, world) evidence window to its newest RELIC_SAMPLE_KEEP. */
  private insertSample(spaceId: string, world: string, pos: Pos, kind: "scan" | "claim-start" | "claim-end"): void {
    this.h.sqlite.prepare(
      `INSERT INTO relic_position_samples (space_id, world, x, y, z, kind) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(spaceId, world, pos[0], pos[1], pos[2], kind);
    this.h.sqlite.prepare(
      `DELETE FROM relic_position_samples WHERE space_id = ? AND world = ? AND id NOT IN (
         SELECT id FROM relic_position_samples WHERE space_id = ? AND world = ? ORDER BY id DESC LIMIT ?)`,
    ).run(spaceId, world, spaceId, world, RELIC_SAMPLE_KEEP);
  }

  private samples(spaceId: string, world: string): SampleRow[] {
    return this.h.sqlite.prepare(
      `SELECT id, x, y, z, kind, received_at FROM relic_position_samples WHERE space_id = ? AND world = ? ORDER BY id ASC`,
    ).all(spaceId, world) as SampleRow[];
  }

  /**
   * The anchors this space can honestly SENSE for a definition (§5.3:
   * the scan reads the nearest PLACED copy's anchor). While the pool
   * has room for this space, a claim materializes a copy AT the
   * validated anchor — every registry anchor is a truthful signal.
   * When the pool cannot materialize (full, or any live private copy
   * already in scope — held, waiting, or resting placed), only anchors where a copy actually rests
   * placed in scope may signal: a scan that answers Resonant at an
   * EMPTY anchor fabricates a claim the award path cannot honor
   * (independent review P1-2, I-4). Mirrors the award core's own
   * availability logic — the sample/scan layer must never promise
   * what the award would refuse.
   */
  private senseableAnchors(spaceId: string, relicId: string): RelicAnchorDef[] {
    const anchors = RELIC_ANCHOR_POINTS[relicId] ?? [];
    if (anchors.length === 0) return [];
    const testOnly = this.store.scarcityOff(spaceId);
    const scope = scopeFor(relicId, spaceId);
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    let canMaterialize: boolean;
    if (testOnly) canMaterialize = true;
    else if (limit !== null) canMaterialize = this.store.poolCount(relicId) < limit;
    else {
      // Private class: ANY live copy in scope blocks materialization —
      // including one resting PLACED (re-review P1-B): a placed copy is
      // the scope's one copy, and minting a second beside it would
      // break the one-per-brain invariant. Mirrors the award core.
      // The read converts first (P2-A, I-5 P2-1 follow-up — the same
      // backfill-first discipline as poolCount, which the limited
      // branch above already gets): on a dormant volume, an
      // unconverted private holding is invisible to the count below,
      // and the scan would signal anchors the award core — which
      // converts first — would refuse.
      try { this.store.backfillCopies(); } catch { /* bare handle without the I-2 tables: the count below fails exactly as the award core's read does */ }
      const liveInScope = this.h.sqlite.prepare(
        `SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = ? AND test_only = 0 AND state IN ('placed','held','return-pool') AND scope_space_id IS ?`,
      ).get(relicId, scope) as { n: number };
      canMaterialize = liveInScope.n === 0;
    }
    if (canMaterialize) return [...anchors];
    const placedKeys = new Set((this.h.sqlite.prepare(
      `SELECT anchor_key FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND test_only = ? AND scope_space_id IS ? AND anchor_key IS NOT NULL`,
    ).all(relicId, testOnly ? 1 : 0, scope) as { anchor_key: string }[]).map((r) => r.anchor_key));
    return anchors.filter((a) => placedKeys.has(a.anchorKey));
  }

  /** Anchors of one definition whose radius contains the position, nearest first. */
  private anchorsContaining(relicId: string, pos: Pos): { anchor: RelicAnchorDef; d: number }[] {
    return (RELIC_ANCHOR_POINTS[relicId] ?? [])
      .map((anchor) => ({ anchor, d: dist(pos, anchor.position) }))
      .filter(({ anchor, d }) => d <= anchor.radius)
      .sort((a, b) => a.d - b.d);
  }

  /**
   * §5.2 step 1 — the claim-start moment. The client fires this when the
   * hunter settles inside an anchor's radius; the server stamps the
   * sample and, for each definition whose anchor holds the position AND
   * whose pool this space could actually claim from, writes the L1
   * (place) unlock — the first validated arrival (§4.4). A position
   * beside no claimable anchor is a plain refusal and stores nothing:
   * a refused sample is not a settling moment and never becomes
   * evidence.
   */
  recordSample(spaceId: string, world: string, position: unknown, kind: string): { ok: boolean; reason?: string; relicIds?: string[] } {
    if (kind !== "claim-start") return { ok: false, reason: "Only the settling moment is the client's to report — the server stamps the rest itself." };
    if (!isPos(position)) return { ok: false, reason: MALFORMED_MESSAGE };
    const matched: string[] = [];
    for (const def of RELICS) {
      if (!def.discoverable || def.world !== world) continue;
      // Senseable anchors only (P1-2): settling beside an anchor where
      // no copy rests and none can materialize is not a settling moment.
      const containing = this.senseableAnchors(spaceId, def.id).filter((a) => dist(position, a.position) <= a.radius);
      if (containing.length === 0) continue;
      matched.push(def.id);
    }
    if (matched.length === 0) return { ok: false, reason: NOWHERE_MESSAGE };
    this.insertSample(spaceId, world, position, "claim-start");
    for (const relicId of matched) {
      this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L1', '', 'arrival')`,
      ).run(spaceId, relicId);
    }
    return { ok: true, relicIds: matched };
  }

  // ---- scan (§5.3) ----------------------------------------------------

  scan(spaceId: string, relicId: string, position: unknown, currentWorld: string, widened: boolean): ScanResult {
    const def = RELIC_BY_ID.get(relicId);
    if (!def) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE, kind: "unknown" };
    if (!def.discoverable) return { ok: false, reason: NOT_FINDABLE_MESSAGE, kind: "not-findable" };
    if (currentWorld !== def.world) return { ok: false, reason: WRONG_WORLD_MESSAGE, kind: "wrong-world" };
    if (!isPos(position)) return { ok: false, reason: MALFORMED_MESSAGE, kind: "malformed" };
    const world = def.world;
    const priorScans = this.samples(spaceId, world).filter((s) => s.kind === "scan");
    const lastScanAt = priorScans.length > 0 ? parseTs(priorScans[priorScans.length - 1]!.received_at) : null;
    // Availability before any charge: a pulse over an empty pool answers
    // honestly quiet and costs nothing — widened or not. The cooldown
    // binds quiet pulses too (re-review P2-2): §5.3's 3 s is a property
    // of the pulse, not of the answer. A widened request over a quiet
    // pool widens nothing, so it is never charged and earns no waiver.
    const senseable = this.senseableAnchors(spaceId, relicId);
    const quiet = senseable.length === 0;
    // Fuel widening (O-R2): pay only when the pulse actually widens; an
    // unpayable widening fires the free pulse under free rules — refusal
    // is never the outcome of an optional upgrade.
    let effectiveWide = false;
    if (widened && !quiet) effectiveWide = new EconomyRepo(this.h, spaceId).spend(RELIC_SCAN_WIDEN_COST);
    if (!effectiveWide && lastScanAt !== null && Date.now() - lastScanAt < RELIC_SCAN_COOLDOWN_MS) {
      // A refused pulse stores no sample (independent review, I-4): it
      // must not become the new lastScanAt and perpetually extend its
      // own cooldown, nor flood the shared evidence window.
      return { ok: false, reason: COOLDOWN_MESSAGE, kind: "cooldown" };
    }
    this.insertSample(spaceId, world, position, "scan");
    if (quiet) return { ok: true, band: null, bearing: null, widened: false, quiet: true };
    let nearest: { anchor: RelicAnchorDef; d: number } | null = null;
    for (const anchor of senseable) {
      const d = dist(position, anchor.position);
      if (!nearest || d < nearest.d) nearest = { anchor, d };
    }
    if (!nearest) return { ok: true, band: null, bearing: null, widened: effectiveWide, quiet: true };
    const edges = RELIC_SCAN_BAND_EDGES[world];
    const { d } = nearest;
    const radius = nearest.anchor.radius;
    let band: RelicScanBand;
    if (d <= radius) band = "Resonant";
    else if (d <= edges.near) band = "Near";
    else if (effectiveWide && d <= (edges.near + edges.warm) / 2) band = "Closing";
    else if (d <= edges.warm) band = "Warm";
    else if (effectiveWide && d <= edges.warm * 1.6) band = "Fading";
    else band = "Far";
    // Bearing: the anchor's own place words until a world's authored
    // sector phrases land in WORLD_BEARING_SECTORS (content pipeline) —
    // the registry ships them empty, so placeName is today's bearing.
    const bearing = nearest.anchor.placeName;
    return { ok: true, band, bearing, widened: effectiveWide, quiet: false };
  }

  // ---- claim (§5.2) ---------------------------------------------------

  /** The raw attempt row for a key — outcome AND the relic it belongs to (a receipt is bound to its relic; see claim()). */
  private receiptRow(spaceId: string, claimId: string): { relicId: string; outcome: StoredOutcome } | null {
    const row = this.h.sqlite.prepare(
      `SELECT relic_id, outcome FROM relic_claim_attempts WHERE space_id = ? AND attempt_key = ?`,
    ).get(spaceId, claimId) as { relic_id: string; outcome: string } | undefined;
    if (!row) return null;
    try { return { relicId: row.relic_id, outcome: JSON.parse(row.outcome) as StoredOutcome }; }
    catch { return null; }
  }

  private writeReceipt(spaceId: string, claimId: string, relicId: string, outcome: StoredOutcome): void {
    this.h.sqlite.prepare(
      `INSERT INTO relic_claim_attempts (space_id, attempt_key, relic_id, copy_id, outcome) VALUES (?, ?, ?, ?, ?)`,
    ).run(spaceId, claimId, relicId, outcome.copyId ?? null, JSON.stringify(outcome));
  }

  private deleteReceipt(spaceId: string, claimId: string): void {
    this.h.sqlite.prepare(`DELETE FROM relic_claim_attempts WHERE space_id = ? AND attempt_key = ?`).run(spaceId, claimId);
  }

  /**
   * Record an outcome outside the award transaction (validation
   * refusals and the already-found disposition). A committed row is
   * never overwritten; a non-committed row is replaced by the newer
   * outcome — the row records the latest state of the attempt, and
   * only committed outcomes ever replay.
   */
  private recordOutcome(spaceId: string, claimId: string, relicId: string, outcome: StoredOutcome): StoredOutcome {
    const existing = this.receiptRow(spaceId, claimId);
    // A receipt is bound to its relic at EVERY site that reads one
    // (re-review P1-A): a row belonging to another relic is never
    // replayed and never clobbered — this attempt's own outcome stands,
    // unrecorded (the key is spent; a retry meets the step-2 conflict).
    if (existing && existing.relicId !== relicId) return outcome;
    if (existing && existing.outcome.committed) return existing.outcome;
    if (existing) this.deleteReceipt(spaceId, claimId);
    try { this.writeReceipt(spaceId, claimId, relicId, outcome); return outcome; }
    catch { const row = this.receiptRow(spaceId, claimId); return row && row.relicId === relicId ? row.outcome : outcome; }
  }

  private outcomeToResult(outcome: StoredOutcome, replayed: boolean): ClaimResult {
    if (outcome.ok) {
      return { ok: true, alreadyFound: outcome.alreadyFound ?? false, awarded: outcome.awarded ?? false, replayed, copyId: outcome.copyId ?? null };
    }
    return { ok: false, reason: outcome.reason ?? "That claim could not land.", kind: outcome.kind ?? "no-presence", replayed };
  }

  /**
   * Presence (§5.2 step 4): over the space's own samples in this world,
   * find a claim-start sample that (a) sat inside an anchor's radius,
   * (b) was received at least the dwell before the claim-end sample and
   * no more than the freshness bound before it, and (c) whose anchor
   * also holds the claim-end position. Dwell is the difference of
   * SERVER receipt stamps — no client-reported duration is ever read.
   * Plausibility is computed over the arrival leg (the sample before
   * the claim-start), the dwell, and the claim-end, and RECORDED —
   * observe-only in this increment (RELIC_SPEED_CAPS_ENFORCED).
   */
  private validatePresence(spaceId: string, relicId: string, endSampleId: number, endPos: Pos): { anchor: RelicAnchorDef; plausibility: PlausibilityVerdict } | null {
    const def = RELIC_BY_ID.get(relicId)!;
    const rows = this.samples(spaceId, def.world);
    const end = rows.find((s) => s.id === endSampleId);
    if (!end) return null;
    const endAt = parseTs(end.received_at);
    const cap = RELIC_WORLD_SPEED_CAPS[def.world];
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = rows[i]!;
      if (s.kind !== "claim-start") continue;
      const startAt = parseTs(s.received_at);
      const elapsed = endAt - startAt;
      if (elapsed < RELIC_DWELL_MS || elapsed > RELIC_SAMPLE_FRESHNESS_MS) continue;
      const containing = this.anchorsContaining(relicId, [s.x, s.y, s.z]);
      if (containing.length === 0) continue;
      const anchor = containing[0]!.anchor;
      if (dist(endPos, anchor.position) > anchor.radius) continue;
      // Plausibility chain: the arrival leg + every sample from the
      // claim-start through the claim-end, in receipt order.
      const chain: SampleRow[] = [];
      if (i > 0) chain.push(rows[i - 1]!);
      for (let j = i; j < rows.length; j++) { chain.push(rows[j]!); if (rows[j]!.id === endSampleId) break; }
      let maxSpeed = 0; let wouldReject = false;
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1]!; const b = chain[k]!;
        const dtMs = parseTs(b.received_at) - parseTs(a.received_at);
        const d = dist([a.x, a.y, a.z], [b.x, b.y, b.z]);
        const speed = dtMs > 0 ? d / (dtMs / 1000) : (d > 0 ? Number.POSITIVE_INFINITY : 0);
        if (speed > maxSpeed) maxSpeed = speed;
        if (d > cap * Math.max(0, dtMs / 1000) + RELIC_PLAUSIBILITY_SLACK_UNITS) wouldReject = true;
      }
      // Same-millisecond legs over a positive distance give an unbounded
      // speed; the receipt must still carry a NUMBER (re-review P2-3 —
      // JSON would otherwise serialize Infinity as null), so the
      // recorded value clamps at 1e9 units/s: "faster than any cap by
      // orders of magnitude" is the honest content of the record.
      return { anchor, plausibility: { enforced: RELIC_SPEED_CAPS_ENFORCED, wouldReject, maxSpeed: Math.min(Math.round(maxSpeed), 1_000_000_000), cap } };
    }
    return null;
  }

  claim(spaceId: string, relicId: string, claimId: string, position: unknown, currentWorld: string): ClaimResult {
    const def = RELIC_BY_ID.get(relicId);
    if (!def) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE, kind: "unknown", replayed: false };
    if (!def.discoverable) return { ok: false, reason: NOT_FINDABLE_MESSAGE, kind: "not-findable", replayed: false };
    if (!claimId || !isPos(position)) return { ok: false, reason: MALFORMED_MESSAGE, kind: "malformed", replayed: false };
    // Step 2 — idempotency. A receipt is BOUND to its relic (review
    // P1-1): a key spent on one relic must never replay its outcome —
    // above all its award — for another. The conflict refuses without
    // recording; the original claim's receipt stands untouched. Only
    // COMMITTED outcomes replay; recorded refusals (committed:false)
    // fall through and the attempt re-executes.
    const priorRow = this.receiptRow(spaceId, claimId);
    if (priorRow && priorRow.relicId !== relicId) {
      return { ok: false, reason: KEY_CONFLICT_MESSAGE, kind: "malformed", replayed: false };
    }
    if (priorRow && priorRow.outcome.committed) return this.outcomeToResult(priorRow.outcome, true);
    // Step 3 — world, server-derived by the caller from the travel ledger.
    if (currentWorld !== def.world) {
      return this.outcomeToResult(this.recordOutcome(spaceId, claimId, relicId, { ok: false, kind: "wrong-world", reason: WRONG_WORLD_MESSAGE, committed: false }), false);
    }
    // Already found is an identity fact about the caller's own space: it
    // grants nothing, so it is answered before presence — a repeat find
    // never demands a fresh dwell.
    if (this.store.foundIds(spaceId).includes(relicId)) {
      const holding = this.store.rows(spaceId).find((r) => r.relic_id === relicId);
      return this.outcomeToResult(this.recordOutcome(spaceId, claimId, relicId, { ok: true, alreadyFound: true, awarded: false, copyId: holding?.copy_id ?? null, committed: true }), false);
    }
    // Step 4 — presence. The claim itself is the claim-end sample,
    // stamped on receipt; validation reads only server stamps.
    this.insertSample(spaceId, def.world, position, "claim-end");
    const endRow = this.h.sqlite.prepare(
      `SELECT MAX(id) AS id FROM relic_position_samples WHERE space_id = ? AND world = ?`,
    ).get(spaceId, def.world) as { id: number };
    const presence = this.validatePresence(spaceId, relicId, endRow.id, position);
    if (!presence) {
      return this.outcomeToResult(this.recordOutcome(spaceId, claimId, relicId, { ok: false, kind: "no-presence", reason: NO_PRESENCE_MESSAGE, committed: false }), false);
    }
    // Step 5 — the atomic award: receipt re-checked inside, copy bound
    // at the validated anchor, first-discovery + reward + receipt all
    // written in the same transaction as the holding (D-02).
    const run = this.h.sqlite.transaction((): ClaimResult => {
      const inner = this.receiptRow(spaceId, claimId);
      // The relic binding holds INSIDE the transaction too (re-review
      // P1-A): a racing claim that committed this key for ANOTHER relic
      // is a conflict — its row is never replayed as this relic's award
      // and never deleted by this claim.
      if (inner && inner.relicId !== relicId) {
        return { ok: false, reason: KEY_CONFLICT_MESSAGE, kind: "malformed", replayed: false };
      }
      if (inner && inner.outcome.committed) return this.outcomeToResult(inner.outcome, true);
      // A non-committed row for this key (an earlier refusal) yields to
      // the committed outcome written below.
      if (inner) this.deleteReceipt(spaceId, claimId);
      // The stirring's promise (approved design §3; I-5 bound it at
      // issuance, this follow-up enforces it at claim time): a claimer
      // WITH an open stirring for this relic is promised ONE specific
      // copy, and this claim honors exactly that promise or none.
      // Read inside the transaction, expiries evaluated — the promise
      // that is honored is the promise that is live in this same
      // serialization.
      const stirrings = new RelicStirringService(this.h);
      const stirring = stirrings.openFor(spaceId, relicId);
      let exactCopyId: string | undefined;
      if (stirring) {
        const promised = this.h.sqlite.prepare(
          `SELECT state, anchor_key FROM relic_copies WHERE copy_id = ?`,
        ).get(stirring.copy_id) as { state: string; anchor_key: string | null } | undefined;
        if (!promised || promised.state !== "placed") {
          // The promised copy is no longer there to claim (held by
          // another through a path that carried no stirring
          // resolution, waiting in the return pool, or gone): the
          // stirring resolves quiet HERE, at its holder's own claim
          // attempt, and no award is made under it — never a
          // substitute in its stead. The refusal is non-committed:
          // the stirring is honestly over, and a fresh attempt hunts
          // as an ordinary claim.
          stirrings.resolveCopyGone(stirring.copy_id);
          const outcome: StoredOutcome = { ok: false, kind: "empty-pool", reason: TRAIL_QUIET_MESSAGE, plausibility: presence.plausibility, committed: false };
          this.writeReceipt(spaceId, claimId, relicId, outcome);
          return this.outcomeToResult(outcome, false);
        }
        if (promised.anchor_key !== presence.anchor.anchorKey) {
          // The promised copy rests — at a DIFFERENT anchor than the
          // one this claim validated. No award, no substitute: the
          // stirring stays open (the trail still leads to the copy's
          // own place), and the refusal is non-committed so the same
          // claim key re-executes when the hunter stands where the
          // promise rests.
          const outcome: StoredOutcome = { ok: false, kind: "no-presence", reason: STIRRED_ELSEWHERE_MESSAGE, plausibility: presence.plausibility, committed: false };
          this.writeReceipt(spaceId, claimId, relicId, outcome);
          return this.outcomeToResult(outcome, false);
        }
        exactCopyId = stirring.copy_id;
      }
      const award = this.store.awardClaimInTransaction(spaceId, relicId, presence.anchor.anchorKey, exactCopyId);
      if (award.status === "exact-missed") {
        // The award core's own re-validation refused the promised
        // copy the read above had just seen placed — unreachable
        // under this transaction's serialization; answered with the
        // copy-gone honesty rather than any substitute.
        if (stirring) stirrings.resolveCopyGone(stirring.copy_id);
        const outcome: StoredOutcome = { ok: false, kind: "empty-pool", reason: TRAIL_QUIET_MESSAGE, plausibility: presence.plausibility, committed: false };
        this.writeReceipt(spaceId, claimId, relicId, outcome);
        return this.outcomeToResult(outcome, false);
      }
      if (award.status === "already") {
        const heldRow = this.store.rows(spaceId).find((r) => r.relic_id === relicId);
        const outcome: StoredOutcome = { ok: true, alreadyFound: true, awarded: false, copyId: heldRow?.copy_id ?? null, plausibility: presence.plausibility, committed: true };
        this.writeReceipt(spaceId, claimId, relicId, outcome);
        return this.outcomeToResult(outcome, false);
      }
      if (award.status === "empty") {
        // Another traveller took the last copy first — the honest empty
        // outcome, recorded like every other (never a fabricated reward,
        // never the winner's identity). Stirrings for this relic read
        // the emptied pool in the same transaction (§5.2 step 5).
        const outcome: StoredOutcome = { ok: false, kind: "empty-pool", reason: EMPTY_POOL_MESSAGE, plausibility: presence.plausibility, committed: true };
        this.writeReceipt(spaceId, claimId, relicId, outcome);
        new RelicStirringService(this.h).resolveAfterPlayerClaim(spaceId, relicId, false);
        return this.outcomeToResult(outcome, false);
      }
      if (!award.testOnly) {
        const scope = RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private" ? spaceId : "public";
        this.h.sqlite.prepare(
          `INSERT OR IGNORE INTO relic_first_discoveries (scope, relic_id, copy_id, space_id, world, anchor_key) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(scope, relicId, award.copyId, spaceId, def.world, award.anchorKey);
      }
      if (award.rewardAmount > 0) new EconomyRepo(this.h, spaceId).add(award.rewardAmount);
      const outcome: StoredOutcome = { ok: true, alreadyFound: false, awarded: award.rewardAmount > 0, copyId: award.copyId, plausibility: presence.plausibility, committed: true };
      this.writeReceipt(spaceId, claimId, relicId, outcome);
      // §5.2 step 5: the claimer's stirring resolves `claimed`, and a
      // pool this award emptied quiets every stirring still open on
      // it — inside this same transaction, never after the fact.
      stirrings.resolveAfterPlayerClaim(spaceId, relicId, true);
      // The exact-copy promise (§3): this award took a specific copy,
      // and any OTHER space's open stirring promising that very copy
      // resolves quiet at this moment — whether or not the claimer
      // themselves hunted under a stirring.
      stirrings.resolveCopyClaimed(award.copyId, spaceId);
      return this.outcomeToResult(outcome, false);
    });
    return run.immediate();
  }

  /**
   * THE NPC CLAIM (Relics I-5, §5.5 / fix (d)). The NPC hunts in its
   * own world — the design's hunt definition — taking the first
   * relic of that world it lacks (or the one named), through the
   * same copy pool and award core as players. Presence for an NPC
   * is its own server-known state, so there are no samples, no
   * dwell, and no scan here; scarcity, placement, and the pool
   * rules are exactly the player's.
   *
   * COURTESY lives here, in this same serialized transaction
   * (approved design §4.1 / ruling R2-4): before the award, the
   * candidate relic's stirring expiries are evaluated (expired ones
   * resolve here and stop blocking), and when exactly ONE claimable
   * copy remains in the relic's pool and a player's stirring for it
   * is live, the NPC defers — no write, no decrement — and the
   * stirring's player keeps the chance the stirring promised them.
   * "The pool's last copy" is the store's claimableSupply, the same
   * number the quiet-resolution reads, so the two rules can never
   * disagree. Player claims are never deferred.
   *
   * Returns awarded (with the copy bound), deferred (courtesy held
   * for every takeable candidate), or empty (nothing takeable in
   * this world — the loop's daily throttle means at most one
   * successful find per day, §5.5).
   */
  claimForNpc(spaceId: string, npcId: string, world: string, relicId?: string): NpcClaimResult {
    const body = (): NpcClaimResult => {
      const stirrings = new RelicStirringService(this.h);
      const candidates = RELICS.filter((def) =>
        def.world === world && def.discoverable && (RELIC_ANCHOR_POINTS[def.id] ?? []).length > 0 &&
        (relicId === undefined || def.id === relicId));
      let deferred = false;
      for (const def of candidates) {
        const held = this.h.sqlite.prepare(
          `SELECT 1 AS x FROM npc_relic_holdings WHERE space_id = ? AND npc_id = ? AND relic_id = ?`,
        ).get(spaceId, npcId, def.id);
        if (held) continue;
        const scope = scopeFor(def.id, spaceId);
        const supply = this.store.claimableSupply(def.id, scope);
        if (supply <= 0) continue;
        stirrings.evaluateExpiriesForRelic(def.id);
        if (supply === 1 && stirrings.liveStirringExists(def.id, scope)) {
          deferred = true;
          continue;
        }
        const award = this.store.awardCopyForNpcInTransaction(spaceId, npcId, def.id);
        if (award.status === "awarded") {
          // The exact-copy promise (§3): the copy this NPC just took
          // may be the very copy a player's open stirring promises
          // (courtesy guards only the pool's LAST copy) — that
          // stirring resolves quiet inside this same transaction.
          // NPCs hold no stirrings of their own; none is spared.
          stirrings.resolveCopyClaimed(award.copyId, null);
          return { status: "awarded", relicId: def.id, copyId: award.copyId };
        }
        // "already"/"empty" after the reads above cannot disagree
        // with them inside one serialized transaction; either way
        // this candidate is unavailable — move on, never fail the tick.
      }
      return deferred ? { status: "deferred" } : { status: "empty" };
    };
    if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) return body();
    return this.h.sqlite.transaction(body).immediate();
  }
}
