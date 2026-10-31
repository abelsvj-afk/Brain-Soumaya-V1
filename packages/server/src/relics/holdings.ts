/**
 * Relic holdings store (design note v2 §§5–9). Reads the LANDED shared
 * registry — there is no second registry. Scarcity is a limit checked inside
 * the claim transaction; holdings never expire and are never removed by any
 * read/sweep path. Release and brain deletion are the only ways a copy leaves.
 *
 * Relics I-2: relics are PHYSICAL COPIES. `relic_copies` is the pool's
 * single source of truth (counting reads copies, never holdings), and
 * each copy's append-only `relic_copy_events` chain is both its
 * provenance and its placement history (approved design §2.1/R3-4).
 * A holding is one space's current ownership of one copy (`copy_id`);
 * `location` is Hold organization only and never gates buffs.
 *
 * Relics I-3: gate permanence is RECORDED at set completion in
 * `relic_gate_opened` (fix (a) — B-01's "once open, stays open" anchors
 * at the moment the found set completes, not at first arrival), and
 * release is class-aware (fix (b) — a Keystone is never released).
 *
 * Relics I-4: the find's transaction body lives in ONE award core
 * (`awardClaimInTransaction`) that the sampled player claim
 * (relics/claims.ts) and this store's claimFind both wrap — the player
 * route's claim is validated from server-stamped position samples
 * before it ever reaches the award.
 *
 * Relics I-5: the pool becomes ONE pool. The copy-binding primitives
 * are parameterized by HOLDER (space | npc), so the NPC award
 * (`awardCopyForNpcInTransaction`) binds and materializes through the
 * exact same code as the player award — only the disposition differs
 * (an npc_relic_holdings read-model row instead of the player
 * records). `claimableSupply` is the single supply reading the
 * last-copy courtesy and stirring resolution share, and
 * `ensurePlacedCopyInScope` is how a stirring gets a real placed
 * copy to promise.
 */
import { randomUUID } from "node:crypto";
import {
  RELICS, RELIC_BY_ID, RELIC_BLESSINGS, RELIC_COPY_LIMITS, MAX_HELD_RELICS,
  RELIC_ANCHOR_POINTS, RELIC_THREADS, relicCodexKey, eternityGateOpen, eligibleExchangeThreads,
  type EternityGateHoldings, type RelicCodexView, type RelicExchangeView, type RelicGateView, type RelicHoldingView,
  type RelicProvenanceEventView, type RelicReturnView, type RelicStirringView, type RelicsStateView,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { buffsForSpace, computeRelicBuffs, heldRelicIds, relicName, seedEffectIdsForSpace } from "./buffs.js";
import { postedExchangeValue } from "../economy.js";

export const EMPTY_POOL_MESSAGE =
  "Every copy of this relic is held right now. Yours will be here to find when one returns — nothing is lost by having come, and nothing is recorded against you.";
export const WRONG_WORLD_MESSAGE = "That relic does not rest in the world you are standing in right now.";
export const NOT_FINDABLE_MESSAGE = "That relic cannot be found yet — its resting place is not open.";
export const UNKNOWN_RELIC_MESSAGE = "That relic is not in the Codex.";
/** The exact-copy refusal (follow-up to I-5, approved design §3): a
 *  stirred claim standing at the wrong anchor is refused plainly —
 *  the promised copy is never substituted, and the stirring stays
 *  open because the trail still leads to the copy's own place. */
export const STIRRED_ELSEWHERE_MESSAGE =
  "Your stirring does not rest here — the copy it promised waits at its own place, and no other copy will be given in its stead.";
/** The trail-gone-quiet refusal (§3): the copy a stirring promised
 *  is no longer there to claim; the stirring resolves quiet in the
 *  same transaction that records this refusal. */
export const TRAIL_QUIET_MESSAGE =
  "The trail has gone quiet — the copy your stirring promised is no longer there to claim.";
export const HOLD_CAP_MESSAGE = `You can hold ${MAX_HELD_RELICS} relics at once. Set one down first to take up another — setting one down costs nothing and loses nothing.`;
/** The Station refusal (Relics I-6, O-R7 / §9 ruling 5): Hold
 *  CHANGES — hold, unhold, store, carry, exchange — are accepted
 *  only while the traveller stands at the Great Station. The world
 *  is always the server-derived travel state, never client-supplied,
 *  and a refusal mutates nothing. Reads are never gated. */
export const STATION_REQUIRED_MESSAGE =
  "That change happens at the Great Station — travel there first. Your relics are exactly as you left them.";

/** Owner spaces: deployment config only (env RELIC_OWNER_SPACE_IDS, comma-separated; empty by default). Used ONLY to gate the scarcity switch. */
export function ownerSpaceIds(): string[] {
  return (process.env.RELIC_OWNER_SPACE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
export function isOwnerSpace(spaceId: string): boolean { return ownerSpaceIds().includes(spaceId); }

export interface HoldingRow { space_id: string; relic_id: string; found_at: string; test_only: number; held: number; held_at: string | null; anchor_key: string; copy_id: string | null; location: string; }

export interface CopyRow { copy_id: string; relic_id: string; state: string; world: string | null; anchor_key: string | null; holder_kind: string | null; holder_id: string | null; holder_space_id: string | null; scope_space_id: string | null; test_only: number; created_at: string; updated_at: string; }

/** The pool a copy belongs to: private-class copies are scoped to one brain; global-pool copies (public / Eternity class) carry NULL. */
function scopeFor(relicId: string, spaceId: string): string | null {
  return RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private" ? spaceId : null;
}

/** The definition's first real anchor key (RELIC_ANCHOR_POINTS registry order), or the legacy synthetic key for relics with no anchor set yet. */
function firstAnchorKey(relicId: string): string {
  return RELIC_ANCHOR_POINTS[relicId]?.[0]?.anchorKey ?? `${relicId}:resting-place-one`;
}

/** Map a historical anchor string to a real anchor: itself when it is one of the definition's real keys, else the definition's first real anchor (backfill provenance mapping, implementation design §4.2). */
function realAnchorOrFirst(relicId: string, anchorKey: string | null | undefined): string {
  const keys = (RELIC_ANCHOR_POINTS[relicId] ?? []).map((a) => a.anchorKey);
  return anchorKey && keys.includes(anchorKey) ? anchorKey : firstAnchorKey(relicId);
}

/** The plain place words for one of a relic's real anchors (Relics I-7 read model), or null when the key names no real anchor. */
function anchorPlaceName(relicId: string, anchorKey: string | null | undefined): string | null {
  if (!anchorKey) return null;
  return (RELIC_ANCHOR_POINTS[relicId] ?? []).find((a) => a.anchorKey === anchorKey)?.placeName ?? null;
}
export type FindResult =
  | { ok: true; alreadyFound: boolean; rewardAmount: number; claimKey: string; disposition?: "seed-consumed" | "seed-consumed-duplicate" }
  | { ok: false; reason: string; kind: "unknown" | "not-findable" | "wrong-world" | "empty-pool" };

/** The award core's outcome (Relics I-4): the transaction-internal half
 *  of a find, before any caller wraps it in its own result shape. */
export type AwardResult =
  | { status: "already" }
  | { status: "empty" }
  /** An exact-copy award was demanded (a stirring's promise) and the
   *  promised copy is not bindable as read inside this transaction —
   *  the structural backstop for the claim service's own read of the
   *  promise; it never falls through to a substitute. */
  | { status: "exact-missed" }
  /** Relics I-6 (R2-1): a Seed's disposition — the copy was consumed
   *  in this transaction and NEVER entered the Hold. `duplicate` is
   *  true when the space's effect was already recorded: the copy is
   *  consumed without effect and without returning to the world
   *  (R3-3). */
  | { status: "seed-consumed"; copyId: string; anchorKey: string; rewardAmount: number; testOnly: boolean; duplicate: boolean }
  | { status: "awarded"; copyId: string; anchorKey: string; rewardAmount: number; testOnly: boolean };

/** The NPC award core's outcome (Relics I-5): the player AwardResult's
 *  sibling — no reward is ever computed for an NPC claim. */
export type NpcAwardResult =
  | { status: "already" }
  | { status: "empty" }
  /** Residuals sweep (I-6 review P2-2): a Seed-class copy claimed by
   *  an NPC is consumed like any Seed claim — never held — and its
   *  effect is recorded against the NPC's space. `duplicate` mirrors
   *  the player core's R3-3 flag: the effect was already recorded,
   *  so this copy was consumed without effect. */
  | { status: "seed-consumed"; copyId: string; anchorKey: string; duplicate: boolean }
  | { status: "awarded"; copyId: string; anchorKey: string };

/**
 * Who is claiming a copy (Relics I-5, §5.5): a player space, or an
 * NPC resident in a space. The copy-binding primitives are
 * parameterized by holder so there is exactly ONE bind/materialize
 * implementation under both claim dispositions.
 */
export interface CopyHolder { kind: "space" | "npc"; id: string; spaceId: string }
const spaceHolder = (spaceId: string): CopyHolder => ({ kind: "space", id: spaceId, spaceId });

/**
 * release() outcome (I-3, fix (b)): the return view on success, or a
 * clean refusal with the plain reason (a Keystone is never released).
 * A null return keeps its original meaning — the space does not hold
 * that relic at all.
 */
export type ReleaseResult =
  | { ok: true; event: RelicReturnView }
  | { ok: false; reason: string };

const migratedHandles = new WeakSet<object>();

/**
 * Settings key recording that the one-time legacy-eligibility marking has
 * run for this database. Written exactly once, inside the same transaction
 * as the marking itself (see markLegacyEligibilityOnce below), so a later
 * re-run of the claims migration can never extend eligibility to spaces
 * created after ship.
 */
export const LEGACY_ELIGIBILITY_MARKED_KEY = "relic_legacy_eligibility_marked";

export class RelicHoldingsStore {
  constructor(private h: DbHandle) {}

  /** §8 migration, idempotent: every codex_claims relic-* row becomes a holding. Runs once per handle, lazily, plus is safe to re-run. */
  migrateLegacyClaims(): number {
    let inserted = 0;
    const rows = this.h.sqlite.prepare(`SELECT space_id, reward_key FROM codex_claims WHERE reward_key LIKE 'relic-%'`).all() as { space_id: string; reward_key: string }[];
    const ins = this.h.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, ?, 0, 0, NULL, ?)`,
    );
    const nowIso = new Date().toISOString();
    for (const r of rows) {
      const id = r.reward_key.slice("relic-".length);
      if (!RELIC_BY_ID.has(id)) continue;
      // Tier implementation (2026-10-30): a Seed's codex claim is a
      // DISCOVERY record, never a holding — every claim writes one,
      // and a Seed claim's disposition is consumption, so converting
      // the claim into a holding would resurrect a Seed into the
      // Hold on every fresh handle (each restart would mint and
      // re-consume a phantom copy). A genuine pre-tier Seed holding
      // exists as a relic_holdings row already and converts through
      // convertSeedHoldings below; it never needs this path.
      if (RELIC_BY_ID.get(id)?.tierClass === "seed") continue;
      const res = ins.run(r.space_id, id, nowIso, this.currentAnchorFor(id));
      inserted += Number(res.changes ?? 0);
    }
    this.markLegacyEligibilityOnce();
    return inserted;
  }

  /**
   * P1 fix — scope the §8 legacy sync to genuine pre-ship spaces.
   *
   * The FIRST time the ship migration runs on a database, every space the
   * server has any record of at that moment (a row in `spaces`, a
   * `space_meta` row, or a `codex_claims` row) is marked
   * `relic_legacy_eligible = 1`: those spaces existed when the ship
   * migration ran, so their local finds may predate verification. The
   * marking and its done-marker (a `settings` row) are written in ONE
   * transaction, and the marker makes the marking one-time for the life of
   * the database — re-running the claims migration converts any remaining
   * claim rows but can never mark a space created later. Spaces born after
   * ship carry the column default 0 (and SpacesRepo births them already
   * synced), and a space with no `space_meta` row at all has no marker —
   * in both cases syncLegacy refuses. Absence of the marker = NOT eligible.
   * Any failure here leaves eligibility unset (fail closed); the claims
   * conversion above is unaffected.
   */
  private markLegacyEligibilityOnce(): void {
    try {
      const run = this.h.sqlite.transaction(() => {
        const done = this.h.sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get(LEGACY_ELIGIBILITY_MARKED_KEY) as { value: string } | undefined;
        if (done) return;
        const ids = new Set<string>();
        for (const r of this.h.sqlite.prepare(`SELECT id FROM spaces`).all() as { id: string }[]) ids.add(r.id);
        for (const r of this.h.sqlite.prepare(`SELECT space_id FROM space_meta`).all() as { space_id: string }[]) ids.add(r.space_id);
        for (const r of this.h.sqlite.prepare(`SELECT DISTINCT space_id FROM codex_claims`).all() as { space_id: string }[]) ids.add(r.space_id);
        const ensure = this.h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`);
        const mark = this.h.sqlite.prepare(`UPDATE space_meta SET relic_legacy_eligible = 1 WHERE space_id = ?`);
        for (const id of ids) { ensure.run(id); mark.run(id); }
        this.h.sqlite.prepare(`INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).run(LEGACY_ELIGIBILITY_MARKED_KEY);
      });
      run.immediate();
    } catch { /* bare handle without the full schema: eligibility stays off (fail closed) */ }
  }

  /** True only when the ship migration marked this space legacy-eligible (see markLegacyEligibilityOnce). A missing row or column reads as NOT eligible. */
  legacyEligible(spaceId: string): boolean {
    try {
      const row = this.h.sqlite.prepare(`SELECT relic_legacy_eligible FROM space_meta WHERE space_id = ?`).get(spaceId) as { relic_legacy_eligible: number | null } | undefined;
      return row?.relic_legacy_eligible === 1;
    } catch { return false; }
  }
  ensureMigrated(): void {
    if (migratedHandles.has(this.h.sqlite as object)) return;
    try {
      this.migrateLegacyClaims();
      // I-2: the same lazy boot converts any pre-existing holdings into
      // physical copies (idempotent — see backfillCopies).
      this.backfillCopies();
      // I-3: the same lazy boot records gate permanence for spaces that
      // already crossed to Eternity (idempotent — see backfillGateOpened).
      this.backfillGateOpened();
      // Tier implementation (2026-10-30): the same lazy boot converts
      // any pre-existing holdings of Seed-class relics — the Seed
      // lifecycle admits no owned state (idempotent, atomic per
      // space — see convertSeedHoldings).
      this.convertSeedHoldings();
      // Canon-entry P2-1 (2026-10-31): the same lazy boot completes
      // L3 threads for spaces whose personal discoveries of both
      // members predate the discovery sweep (idempotent, atomic per
      // space — see backfillDiscoveryThreadCompletions).
      this.backfillDiscoveryThreadCompletions();
      migratedHandles.add(this.h.sqlite as object);
    } catch { /* tables may not exist in a bare unit handle */ }
  }

  rows(spaceId: string): HoldingRow[] {
    return this.h.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ? ORDER BY found_at ASC, rowid ASC`).all(spaceId) as HoldingRow[];
  }
  foundIds(spaceId: string): string[] { return this.rows(spaceId).map((r) => r.relic_id); }
  heldIds(spaceId: string): string[] { return heldRelicIds(this.h, spaceId); }
  gateHoldings(spaceId: string): EternityGateHoldings {
    const found = this.foundIds(spaceId);
    return {
      witnessWithoutName: found.includes("witness-without-a-name"),
      otherRelicCount: found.filter((id) => id !== "witness-without-a-name").length,
    };
  }
  /** Fix (a): has this space's gate completion been recorded? (Reads fall back to the arrived-journey derivation when no record exists yet.) */
  gateOpenedRecorded(spaceId: string): boolean {
    try {
      const row = this.h.sqlite.prepare(`SELECT 1 AS x FROM relic_gate_opened WHERE space_id = ?`).get(spaceId) as { x: number } | undefined;
      return !!row;
    } catch { return false; }
  }

  /**
   * Fix (a) (§6): record gate permanence at SET COMPLETION. Runs inside
   * the claim, hold, and release transactions: the moment the space's
   * found set completes B-01, the fact is written once (INSERT OR
   * IGNORE) and never removed, so releasing or storing any set member
   * afterwards — the Witness included, before any travel — cannot
   * re-close the gate. Running it in release's transaction too means a
   * space that completed the set before this build records its
   * permanence BEFORE the release that would otherwise endanger it.
   * The caller owns the transaction; this helper only writes.
   * Public since Relics I-6: the exchange service runs the same
   * recorder before ITS holding delete, in its own transaction —
   * one implementation, every relic write path.
   */
  recordGateCompletionIfComplete(spaceId: string): void {
    if (!eternityGateOpen(this.foundIds(spaceId))) return;
    try {
      this.h.sqlite.prepare(`INSERT OR IGNORE INTO relic_gate_opened (space_id) VALUES (?)`).run(spaceId);
    } catch { /* bare handle without the I-3 table: reads fall back to the arrived-journey derivation */ }
  }

  /**
   * Fix (a) backfill (§4.8): spaces that already crossed to Eternity
   * get their permanence record with the crossing's own arrival time
   * (the earliest arrived Eternity journey). Idempotent; runs with the
   * store's lazy migration, so a volume picks it up on first touch.
   */
  backfillGateOpened(): number {
    try {
      const res = this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_gate_opened (space_id, opened_at)
         SELECT space_id, MIN(arrived_at) FROM travel_journeys
         WHERE destination = 'eternity' AND state = 'arrived' AND arrived_at IS NOT NULL
         GROUP BY space_id`,
      ).run();
      return Number(res.changes ?? 0);
    } catch { return 0; }
  }
  /**
   * Tier implementation (2026-10-30, decisions doc §6 — the flagged
   * riskiest point): the one-time conversion of pre-existing Seed
   * holdings. Until the tier rulings landed, a space could OWN — and
   * hold — a Mooring Ring or a Dawn Leaf; the Seed lifecycle (§2.2)
   * admits no owned state: a Seed is consumed inside its claim
   * transaction and an owned copy never exists. Grandfathering the
   * old holdings was considered and rejected in the decisions doc
   * (it would leave a permanent exception class in every future
   * feature); conversion is one honest moment instead.
   *
   * Per affected space, in ONE transaction: gate permanence is
   * recorded from the found set AS IT STANDS (a Seed can be one of
   * B-01's "two others" today; conversion must never re-close a
   * completed gate), then every Seed-class holding — held or merely
   * owned, carried or Station-stored — converts: the Seed Effect is
   * recorded (the relic_seed_effects primary key is the idempotency;
   * a Dawn Leaf records with NO effect entry, debt D-1 — its
   * consumption is banked and lights up when the value is authored),
   * the copy enters its terminal `consumed` state through the same
   * update the award core performs, its chain gains a truthful
   * consumption event whose detail names the tier migration (NOT
   * dressed up as a claim — it wasn't one), and the holding row is
   * removed. The converted
   * Ring holder's one real cost is named in the decisions doc: the
   * held form's daily-cap half does not carry into permanence.
   * NPC residents' Seed holdings convert by the same class rule —
   * the residuals sweep established that an NPC's Seed claim
   * consumes with the effect recorded against the NPC's space; a
   * pre-tier NPC holding is the same fact waiting for the same
   * disposition. Pool copies (placed, unowned) are untouched — only
   * OWNED copies convert.
   *
   * Idempotent by construction: after conversion no Seed holdings
   * exist, so any later pass finds nothing. Runs inside
   * ensureMigrated (after the copies backfill has bound every
   * holding), and once more inside syncLegacy's transaction for the
   * finds that path reports. Returns the number of copies converted.
   */
  convertSeedHoldings(): number {
    const seedIds = RELICS.filter((r) => r.tierClass === "seed").map((r) => r.id);
    if (seedIds.length === 0) return 0;
    // Every holding must be copy-bound before it can convert (the
    // I-2 discipline: convert first, then read).
    try { this.backfillCopies(); } catch { /* bare handle without the I-2 tables: the reads below fail exactly as poolCount's do */ }
    const marks = seedIds.map(() => "?").join(",");
    const spaces = new Set<string>();
    for (const r of this.h.sqlite.prepare(`SELECT DISTINCT space_id FROM relic_holdings WHERE relic_id IN (${marks})`).all(...seedIds) as { space_id: string }[]) spaces.add(r.space_id);
    for (const r of this.h.sqlite.prepare(`SELECT DISTINCT space_id FROM npc_relic_holdings WHERE relic_id IN (${marks})`).all(...seedIds) as { space_id: string }[]) spaces.add(r.space_id);
    let converted = 0;
    for (const spaceId of spaces) {
      if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) {
        converted += this.convertSeedHoldingsForSpace(spaceId);
      } else {
        const run = this.h.sqlite.transaction(() => { converted += this.convertSeedHoldingsForSpace(spaceId); });
        run.immediate();
      }
    }
    return converted;
  }

  /** One space's half of convertSeedHoldings. The caller owns the
   *  transaction; this only writes. Public for syncLegacy, which
   *  converts the Seed finds it just recorded inside its own
   *  transaction, and for the idempotency tests. */
  convertSeedHoldingsForSpace(spaceId: string): number {
    let converted = 0;
    // Fix (a) discipline, same as release/exchange: permanence is
    // recorded from the found set as it stands BEFORE any delete in
    // this conversion can drop it below completion.
    this.recordGateCompletionIfComplete(spaceId);
    const consumeCopy = (copyId: string, relicId: string, effectRecorded: boolean, npcId?: string): void => {
      // The award core's own terminal update (I-6): same state, same
      // cleared holder fields — a converted copy is indistinguishable
      // in state from a claimed-and-consumed one; only its chain's
      // last event differs, and it differs truthfully.
      this.h.sqlite.prepare(
        `UPDATE relic_copies SET state = 'consumed', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
      ).run(copyId);
      // The event kind is the schema's own `consumed` (the
      // relic_copy_events CHECK constraint enumerates the kinds —
      // a new kind would be a schema change, outside this
      // increment's fence); the DETAIL names it what it is: reason
      // "tier-migration" — a tier-migration consumption, told apart
      // from a claim's consumption at a glance, never dressed as one.
      this.recordEvent(copyId, "consumed", {
        spaceId, world: RELIC_BY_ID.get(relicId)?.world ?? null,
        detail: { reason: "tier-migration", effectRecorded, ...(npcId ? { npcId } : {}) },
      });
    };
    const rows = this.h.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ?`).all(spaceId) as HoldingRow[];
    for (const row of rows) {
      if (RELIC_BY_ID.get(row.relic_id)?.tierClass !== "seed") continue;
      // A holding the copies backfill could not bind (a bare handle
      // without the I-2 tables) cannot convert truthfully — its
      // effect record names a copy — so it is left for a later,
      // fuller touch rather than converted halfway.
      if (!row.copy_id) continue;
      const recorded = this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES (?, ?, ?)`,
      ).run(spaceId, row.relic_id, row.copy_id);
      consumeCopy(row.copy_id, row.relic_id, Number(recorded.changes ?? 0) > 0);
      this.h.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).run(spaceId, row.relic_id);
      converted++;
    }
    const npcRows = this.h.sqlite.prepare(`SELECT npc_id, relic_id FROM npc_relic_holdings WHERE space_id = ?`).all(spaceId) as { npc_id: string; relic_id: string }[];
    for (const row of npcRows) {
      if (RELIC_BY_ID.get(row.relic_id)?.tierClass !== "seed") continue;
      const copy = this.h.sqlite.prepare(
        `SELECT copy_id FROM relic_copies WHERE holder_kind = 'npc' AND holder_id = ? AND holder_space_id = ? AND relic_id = ? AND state = 'held'`,
      ).get(row.npc_id, spaceId, row.relic_id) as { copy_id: string } | undefined;
      if (!copy) continue; // unbound on a bare handle: left, as above
      const recorded = this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES (?, ?, ?)`,
      ).run(spaceId, row.relic_id, copy.copy_id);
      consumeCopy(copy.copy_id, row.relic_id, Number(recorded.changes ?? 0) > 0, row.npc_id);
      this.h.sqlite.prepare(`DELETE FROM npc_relic_holdings WHERE npc_id = ? AND space_id = ? AND relic_id = ?`).run(row.npc_id, spaceId, row.relic_id);
      converted++;
    }
    return converted;
  }

  /** Append one fact to a copy's chain. Events are never updated or
   *  deleted. Public since Relics I-6: the exchange service writes
   *  its `exchanged` event through the same primitive as every other
   *  copy transition. */
  recordEvent(copyId: string, kind: string, facts: { spaceId?: string | null; world?: string | null; anchorKey?: string | null; detail?: unknown } = {}): void {
    this.h.sqlite.prepare(
      `INSERT INTO relic_copy_events (copy_id, kind, space_id, world, anchor_key, detail) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(copyId, kind, facts.spaceId ?? null, facts.world ?? null, facts.anchorKey ?? null, facts.detail === undefined ? null : JSON.stringify(facts.detail));
  }

  /** Mint the physical copy for one holding row and bind it. Writes the genesis event; the caller owns the transaction. */
  private mintCopyForHolding(row: HoldingRow): string {
    const def = RELIC_BY_ID.get(row.relic_id);
    const copyId = `rc_${randomUUID()}`;
    this.h.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'held', NULL, NULL, 'space', ?, ?, ?, ?)`,
    ).run(copyId, row.relic_id, row.space_id, row.space_id, scopeFor(row.relic_id, row.space_id), row.test_only);
    const mapped = realAnchorOrFirst(row.relic_id, row.anchor_key);
    this.recordEvent(copyId, "genesis", {
      spaceId: row.space_id,
      world: def?.world ?? null,
      anchorKey: mapped,
      detail: { backfill: true, ...(mapped !== row.anchor_key ? { syntheticAnchor: row.anchor_key } : {}) },
    });
    this.h.sqlite.prepare(`UPDATE relic_holdings SET copy_id = ? WHERE space_id = ? AND relic_id = ?`).run(copyId, row.space_id, row.relic_id);
    return copyId;
  }

  /**
   * I-2 backfill (§4.2): every existing holding — player or NPC — becomes
   * a physical copy with a genesis event. Holdings are CONVERTED, never
   * discarded: holdings, codex_claims and discovery records are untouched.
   * Idempotent: holdings already bound (copy_id set) and NPC holdings
   * already bound are skipped, so re-running mints nothing. Joins an open
   * transaction; otherwise runs in its own IMMEDIATE transaction.
   */
  backfillCopies(): { minted: number; npcMinted: number; npcRows: number } {
    const body = (): { minted: number; npcMinted: number; npcRows: number } => {
      let minted = 0;
      const unbound = this.h.sqlite.prepare(`SELECT * FROM relic_holdings WHERE copy_id IS NULL`).all() as HoldingRow[];
      for (const row of unbound) { this.mintCopyForHolding(row); minted++; }
      // Pre-flight count (§4.2): NPC holdings mint copies that count in the
      // unified pool for the first time — surface the count loudly.
      const npcRows = this.h.sqlite.prepare(`SELECT npc_id, space_id, relic_id, found_in_world FROM npc_relic_holdings`).all() as { npc_id: string; space_id: string; relic_id: string; found_in_world: string }[];
      let npcMinted = 0;
      for (const n of npcRows) {
        const bound = this.h.sqlite.prepare(`SELECT copy_id FROM relic_copies WHERE holder_kind = 'npc' AND holder_id = ? AND holder_space_id = ? AND relic_id = ? AND state = 'held'`).get(n.npc_id, n.space_id, n.relic_id);
        if (bound) continue;
        const copyId = `rc_${randomUUID()}`;
        this.h.sqlite.prepare(
          `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'held', NULL, NULL, 'npc', ?, ?, ?, 0)`,
        ).run(copyId, n.relic_id, n.npc_id, n.space_id, scopeFor(n.relic_id, n.space_id));
        this.recordEvent(copyId, "genesis", { spaceId: n.space_id, world: n.found_in_world, detail: { backfill: true, npc: true } });
        npcMinted++;
      }
      if (npcMinted > 0) console.warn(`[relics] I-2 backfill: ${npcRows.length} NPC holding row(s) exist; ${npcMinted} NPC copy(ies) minted — NPC copies count in the unified copy pool from this increment (design §4.2 pre-flight).`);
      return { minted, npcMinted, npcRows: npcRows.length };
    };
    if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) return body();
    return this.h.sqlite.transaction(body).immediate();
  }

  /** Copies of this definition existing in one scope, in the given live states. */
  private copiesInScope(relicId: string, scopeSpaceId: string | null, testOnly: boolean, states: readonly string[] = ["placed", "held", "return-pool"]): number {
    const marks = states.map(() => "?").join(",");
    const row = this.h.sqlite.prepare(
      `SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = ? AND test_only = ? AND state IN (${marks}) AND scope_space_id IS ?`,
    ).get(relicId, testOnly ? 1 : 0, ...states, scopeSpaceId) as { n: number };
    return row.n;
  }

  /** Bind a copy to its claimer: state held, holder set, resting place cleared from the copy row (the claim event keeps it). */
  private bindCopy(copyId: string, holder: CopyHolder, world: string, anchorKey: string): void {
    this.h.sqlite.prepare(
      `UPDATE relic_copies SET state = 'held', world = NULL, anchor_key = NULL, holder_kind = ?, holder_id = ?, holder_space_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
    ).run(holder.kind, holder.id, holder.spaceId, copyId);
    this.recordEvent(copyId, "claimed", {
      spaceId: holder.spaceId, world, anchorKey,
      ...(holder.kind === "npc" ? { detail: { npcId: holder.id } } : {}),
    });
  }

  /** Bind a resting copy of this definition in scope to the claimant, or null when none rests placed. */
  private bindPlacedCopy(spaceId: string, relicId: string, scope: string | null, testOnly: boolean): { copyId: string; anchorKey: string } | null {
    return this.bindPlacedCopyAt(spaceId, relicId, scope, testOnly, null);
  }

  /**
   * Relics I-4: bind a resting copy AT one validated anchor (the sampled
   * claim's anchor), or — with anchorKey null — at any anchor (the
   * legacy store-level find). Copies at one anchor are fungible for
   * presence (§5.2 step 5); which copy rests there is the pool's fact,
   * never the client's assertion.
   */
  private bindPlacedCopyAt(spaceId: string, relicId: string, scope: string | null, testOnly: boolean, anchorKey: string | null, holder: CopyHolder = spaceHolder(spaceId)): { copyId: string; anchorKey: string } | null {
    const copy = anchorKey === null
      ? this.h.sqlite.prepare(
          `SELECT * FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND test_only = ? AND scope_space_id IS ? ORDER BY created_at ASC, copy_id ASC LIMIT 1`,
        ).get(relicId, testOnly ? 1 : 0, scope) as CopyRow | undefined
      : this.h.sqlite.prepare(
          `SELECT * FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND test_only = ? AND scope_space_id IS ? AND anchor_key = ? ORDER BY created_at ASC, copy_id ASC LIMIT 1`,
        ).get(relicId, testOnly ? 1 : 0, scope, anchorKey) as CopyRow | undefined;
    if (!copy) return null;
    const boundAnchor = copy.anchor_key ?? firstAnchorKey(relicId);
    this.bindCopy(copy.copy_id, holder, copy.world ?? RELIC_BY_ID.get(relicId)?.world ?? "", boundAnchor);
    return { copyId: copy.copy_id, anchorKey: boundAnchor };
  }

  /**
   * No copy rests placed: materialize one at the first anchor not
   * currently holding a placed sibling (deterministic registry order),
   * genesis + placed events, then bind it. Null only when the definition
   * has no anchors at all (unplaced relics refuse finds earlier anyway).
   */
  private materializeAndBind(spaceId: string, relicId: string, scope: string | null, testOnly: boolean, holder: CopyHolder = spaceHolder(spaceId)): { copyId: string; anchorKey: string } | null {
    const anchors = RELIC_ANCHOR_POINTS[relicId] ?? [];
    if (anchors.length === 0) return null;
    const world = RELIC_BY_ID.get(relicId)?.world ?? anchors[0]!.world;
    const occupied = new Set((this.h.sqlite.prepare(
      `SELECT anchor_key FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND scope_space_id IS ? AND anchor_key IS NOT NULL`,
    ).all(relicId, scope) as { anchor_key: string }[]).map((r) => r.anchor_key));
    const anchor = anchors.find((a) => !occupied.has(a.anchorKey)) ?? anchors[0]!;
    const copyId = `rc_${randomUUID()}`;
    this.h.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'placed', ?, ?, NULL, NULL, NULL, ?, ?)`,
    ).run(copyId, relicId, world, anchor.anchorKey, scope, testOnly ? 1 : 0);
    this.recordEvent(copyId, "genesis", { spaceId: holder.spaceId, world, anchorKey: anchor.anchorKey, detail: { materializedAtClaim: true } });
    this.recordEvent(copyId, "placed", { world, anchorKey: anchor.anchorKey });
    this.bindCopy(copyId, holder, world, anchor.anchorKey);
    return { copyId, anchorKey: anchor.anchorKey };
  }

  /**
   * Relics I-4: materialize a fresh copy AT one validated anchor and
   * bind it (the sampled claim's award when no copy rests there yet but
   * the pool has room). Null when the anchor is not one of the
   * definition's resting places at all.
   */
  private materializeAndBindAt(spaceId: string, relicId: string, scope: string | null, testOnly: boolean, anchorKey: string, holder: CopyHolder = spaceHolder(spaceId)): { copyId: string; anchorKey: string } | null {
    const anchor = (RELIC_ANCHOR_POINTS[relicId] ?? []).find((a) => a.anchorKey === anchorKey);
    if (!anchor) return null;
    const world = anchor.world;
    const copyId = `rc_${randomUUID()}`;
    this.h.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'placed', ?, ?, NULL, NULL, NULL, ?, ?)`,
    ).run(copyId, relicId, world, anchor.anchorKey, scope, testOnly ? 1 : 0);
    this.recordEvent(copyId, "genesis", { spaceId: holder.spaceId, world, anchorKey: anchor.anchorKey, detail: { materializedAtClaim: true } });
    this.recordEvent(copyId, "placed", { world, anchorKey: anchor.anchorKey });
    this.bindCopy(copyId, holder, world, anchor.anchorKey);
    return { copyId, anchorKey: anchor.anchorKey };
  }

  /**
   * Fix (c) (§6): the resting place a returning copy may take — the
   * definition's anchors in registry order, minus every anchor in THIS
   * copy's own placement history (genesis + placed events on its chain —
   * history is never reset or bypassed, ruling 2), minus anchors
   * currently holding a placed sibling of the same definition in the
   * same scope (a copy never rests on another copy). Null when nothing
   * remains: the copy waits in return-pool until a placement session
   * gives the definition new anchors.
   */
  chooseReturnAnchor(copyId: string): string | null {
    const copy = this.h.sqlite.prepare(`SELECT * FROM relic_copies WHERE copy_id = ?`).get(copyId) as CopyRow | undefined;
    if (!copy) return null;
    const anchors = RELIC_ANCHOR_POINTS[copy.relic_id] ?? [];
    if (anchors.length === 0) return null;
    const history = new Set((this.h.sqlite.prepare(
      `SELECT anchor_key FROM relic_copy_events WHERE copy_id = ? AND kind IN ('genesis','placed') AND anchor_key IS NOT NULL`,
    ).all(copyId) as { anchor_key: string }[]).map((r) => r.anchor_key));
    const occupied = new Set((this.h.sqlite.prepare(
      `SELECT anchor_key FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND scope_space_id IS ? AND copy_id != ? AND anchor_key IS NOT NULL`,
    ).all(copy.relic_id, copy.scope_space_id, copyId) as { anchor_key: string }[]).map((r) => r.anchor_key));
    for (const a of anchors) if (!history.has(a.anchorKey) && !occupied.has(a.anchorKey)) return a.anchorKey;
    return null;
  }

  /**
   * The pool is counted in relic_copies, once (I-2 §4.2): non-test
   * copies in states placed + held + return-pool. A pre-I-2 holding
   * that has not been converted yet is converted first (backfill is
   * idempotent), so the count never silently drops a live holding.
   */
  poolCount(relicId: string): number {
    try { this.backfillCopies(); } catch { /* bare handle without the I-2 tables: the count below fails exactly as the old one did */ }
    const scoped = RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private";
    const row = scoped
      ? this.h.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = ? AND test_only = 0 AND state IN ('placed','held','return-pool')`).get(relicId) as { n: number }
      : this.h.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = ? AND test_only = 0 AND state IN ('placed','held','return-pool') AND scope_space_id IS NULL`).get(relicId) as { n: number };
    return row.n;
  }
  poolAvailable(relicId: string): number | null {
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    if (limit === null) return null;
    return limit - this.poolCount(relicId);
  }
  /**
   * Claimable supply for (relic, scope) — how many more copies a
   * claim could still bind there: copies resting `placed` in scope,
   * plus the room to materialize (limit − live copies, for the
   * limited classes). For the private class the scope's one copy is
   * the whole supply, claimable only while it does not yet exist or
   * rests placed — a held or return-pool private copy is supply 0,
   * exactly as the award core rules it (I-4, P1-B). Relics I-5: the
   * last-copy courtesy and stirring quiet-resolution both read THIS
   * number, so the two rules can never disagree about what "the
   * last copy" means. Like poolCount above, the read converts first
   * (P2-1, I-5 review): on a pre-I-2 volume whose holdings were
   * never converted, an unconverted held copy is invisible to the
   * copy reads below — supply would read high and the last-copy
   * courtesy would never engage.
   */
  claimableSupply(relicId: string, scopeSpaceId: string | null): number {
    try { this.backfillCopies(); } catch { /* bare handle without the I-2 tables: the reads below fail exactly as poolCount's did */ }
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    const resting = this.copiesInScope(relicId, scopeSpaceId, false, ["placed"]);
    if (limit !== null) {
      const live = this.copiesInScope(relicId, scopeSpaceId, false);
      return resting + Math.max(0, limit - live);
    }
    const live = this.copiesInScope(relicId, scopeSpaceId, false);
    return live === 0 ? 1 : resting;
  }

  /**
   * Relics I-5 (§4.6): guarantee a copy of this definition rests
   * PLACED in scope, and say which — a stirring promises a specific
   * placed copy, so issuance needs one to exist. A copy already
   * resting in scope is the promise (earliest first, the award
   * core's own order); else one materializes at the first anchor
   * not holding a placed sibling in scope, while the pool allows;
   * else null — the pool could not furnish a copy, and no stirring
   * may be issued against it. Writes genesis + placed events;
   * binds nothing. The caller owns the transaction. The pool read
   * converts first (P2-1, I-5 review — the same backfill-first
   * discipline as poolCount): on a dormant pre-I-2 volume the live
   * count below would otherwise miss every unconverted holding,
   * and issuance could mint a copy over the pool's limit.
   */
  ensurePlacedCopyInScope(relicId: string, scopeSpaceId: string | null, actorSpaceId: string): { copyId: string; anchorKey: string } | null {
    try { this.backfillCopies(); } catch { /* bare handle without the I-2 tables: the reads below fail exactly as poolCount's did */ }
    const resting = this.h.sqlite.prepare(
      `SELECT * FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND test_only = 0 AND scope_space_id IS ? ORDER BY created_at ASC, copy_id ASC LIMIT 1`,
    ).get(relicId, scopeSpaceId) as CopyRow | undefined;
    if (resting?.anchor_key) return { copyId: resting.copy_id, anchorKey: resting.anchor_key };
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    const live = this.copiesInScope(relicId, scopeSpaceId, false);
    if (limit !== null ? live >= limit : live >= 1) return null;
    const anchors = RELIC_ANCHOR_POINTS[relicId] ?? [];
    if (anchors.length === 0) return null;
    const occupied = new Set((this.h.sqlite.prepare(
      `SELECT anchor_key FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND scope_space_id IS ? AND anchor_key IS NOT NULL`,
    ).all(relicId, scopeSpaceId) as { anchor_key: string }[]).map((r) => r.anchor_key));
    const anchor = anchors.find((a) => !occupied.has(a.anchorKey));
    if (!anchor) return null;
    const world = RELIC_BY_ID.get(relicId)?.world ?? anchor.world;
    const copyId = `rc_${randomUUID()}`;
    this.h.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'placed', ?, ?, NULL, NULL, NULL, ?, 0)`,
    ).run(copyId, relicId, world, anchor.anchorKey, scopeSpaceId);
    this.recordEvent(copyId, "genesis", { spaceId: actorSpaceId, world, anchorKey: anchor.anchorKey, detail: { materializedForStirring: true } });
    this.recordEvent(copyId, "placed", { world, anchorKey: anchor.anchorKey });
    return { copyId, anchorKey: anchor.anchorKey };
  }
  scarcityOff(spaceId: string): boolean {
    if (!isOwnerSpace(spaceId)) {
      // A flag row a non-owner somehow holds is inert — the switch is owner-only on read too.
      try {
        const row = this.h.sqlite.prepare(`SELECT relic_scarcity_off FROM space_meta WHERE space_id = ?`).get(spaceId) as { relic_scarcity_off: string | null } | undefined;
        void row;
      } catch { /* column may be absent on a bare handle */ }
      return false;
    }
    try {
      const row = this.h.sqlite.prepare(`SELECT relic_scarcity_off FROM space_meta WHERE space_id = ?`).get(spaceId) as { relic_scarcity_off: string | null } | undefined;
      return row?.relic_scarcity_off === "true";
    } catch { return false; }
  }
  setScarcityOff(spaceId: string, off: boolean): boolean {
    if (!isOwnerSpace(spaceId)) return false;
    this.h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
    try {
      this.h.sqlite.prepare(`UPDATE space_meta SET relic_scarcity_off = ? WHERE space_id = ?`).run(off ? "true" : "false", spaceId);
    } catch { return false; }
    return true;
  }
  /**
   * The anchor the world currently presents for a definition: a resting
   * (placed) copy's anchor when one rests; else the most recent legacy
   * return's destination; else the definition's first real anchor.
   */
  currentAnchorFor(relicId: string): string {
    try {
      const placed = this.h.sqlite.prepare(`SELECT anchor_key FROM relic_copies WHERE relic_id = ? AND state = 'placed' AND anchor_key IS NOT NULL ORDER BY updated_at DESC, copy_id ASC LIMIT 1`).get(relicId) as { anchor_key: string } | undefined;
      if (placed?.anchor_key) return placed.anchor_key;
    } catch { /* bare handle without the I-2 tables: fall through to the legacy read */ }
    const ret = this.h.sqlite.prepare(`SELECT to_anchor FROM relic_returns WHERE relic_id = ? AND to_anchor IS NOT NULL ORDER BY id DESC LIMIT 1`).get(relicId) as { to_anchor: string } | undefined;
    if (ret?.to_anchor) return ret.to_anchor;
    return firstAnchorKey(relicId);
  }

  /**
   * THE AWARD CORE (Relics I-4, implementation design §5.2/§5.5): the
   * single implementation that turns a validated presence into an owned
   * copy — scarcity read from the copy pool, one copy bound (a resting
   * one at the validated anchor, else a fresh one materialized AT that
   * anchor while the pool allows), the holding + Codex claim + gate
   * record written. The CALLER owns the transaction (this joins it) and
   * everything around the award: the sampled claim in relics/claims.ts
   * wraps it with sample validation, the first-discovery write, the
   * Fuel reward paid inside the same transaction, and the attempt
   * receipt; claimFind below wraps it for the store-level callers.
   * anchorKey null = any anchor (the pre-sampling presence model);
   * a non-null anchorKey binds/materializes at exactly that anchor.
   * exactCopyId (the stirring's promise, §3) binds exactly that copy
   * or returns "exact-missed" — no substitute, no materialization.
   * The reward is computed here but NOT paid — paying is the caller's
   * act, inside the caller's transaction.
   */
  awardClaimInTransaction(spaceId: string, relicId: string, anchorKey: string | null, exactCopyId?: string): AwardResult {
    // I-2: any pre-existing holdings on this volume become copies first
    // (idempotent), so the scarcity check below reads the true copy pool.
    this.backfillCopies();
    const existing = this.h.sqlite.prepare(`SELECT relic_id FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(spaceId, relicId);
    if (existing) {
      // Fix (a): an already-complete set records its permanence on any
      // claim touch, even a repeat find that writes nothing else.
      this.recordGateCompletionIfComplete(spaceId);
      return { status: "already" };
    }
    const testOnly = this.scarcityOff(spaceId);
    const scope = scopeFor(relicId, spaceId);
    // Buffed discovery rate from the held set BEFORE this find — a relic's
    // own buff never applies to its own discovery (it is not held yet).
    const rewardAmount = buffsForSpace(this.h, spaceId).discoveryEarn;
    // I-2: the find BINDS a physical copy (§4.3) — a resting one when one
    // rests in scope (binding is always allowed: the copy exists and is
    // free), else a newly materialized one while the scope count is
    // below the class limit, else the empty-pool refusal.
    // The stirring's promise (approved design §3, exact-copy follow-up):
    // when the claim service names the promised copy, the award binds
    // THAT copy or no copy — re-validated here inside the transaction
    // (same relic, resting placed, this scope, the validated anchor),
    // and never substituted, never materialized around. The promised
    // copy is read without the claimer's test_only filter: issuance
    // furnishes real (test_only = 0) copies, and the promise binds the
    // claim to that copy whatever the claimer's scarcity mode; the
    // holding row below still records the claimer's own flag.
    let bound: { copyId: string; anchorKey: string } | null = null;
    if (exactCopyId !== undefined) {
      const copy = this.h.sqlite.prepare(`SELECT * FROM relic_copies WHERE copy_id = ?`).get(exactCopyId) as CopyRow | undefined;
      if (!copy || copy.relic_id !== relicId || copy.state !== "placed" || copy.scope_space_id !== scope || (anchorKey !== null && copy.anchor_key !== anchorKey)) {
        return { status: "exact-missed" };
      }
      const boundAnchor = copy.anchor_key ?? firstAnchorKey(relicId);
      this.bindCopy(copy.copy_id, spaceHolder(spaceId), copy.world ?? RELIC_BY_ID.get(relicId)?.world ?? "", boundAnchor);
      bound = { copyId: copy.copy_id, anchorKey: boundAnchor };
    } else {
      bound = this.bindPlacedCopyAt(spaceId, relicId, scope, testOnly, anchorKey);
    }
    if (!bound) {
      if (!testOnly) {
        const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
        if (limit !== null && this.poolCount(relicId) >= limit) {
          return { status: "empty" };
        }
        // Private class: one copy per scope — ANY live copy in scope
        // blocks materialization, including one resting placed at a
        // DIFFERENT anchor than the validated one (re-review P1-B,
        // I-4): the resting copy at THIS anchor was bound above; a
        // resting copy elsewhere is still the scope's one copy, and
        // minting a second beside it would break §4.2's invariant.
        if (limit === null && this.copiesInScope(relicId, scope, false, ["placed", "held", "return-pool"]) >= 1) {
          return { status: "empty" };
        }
      }
      bound = anchorKey === null
        ? this.materializeAndBind(spaceId, relicId, scope, testOnly)
        : this.materializeAndBindAt(spaceId, relicId, scope, testOnly, anchorKey);
      if (!bound) return { status: "empty" };
    }
    const nowIso = new Date().toISOString();
    const claim = this.h.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, relicCodexKey(relicId));
    // Canon entry (§5.6): the discovery just recorded may complete a
    // thread's pair for this space — the L3 completion sweep runs
    // here, inside the award transaction, BEFORE the Seed branch, so
    // a consumed Seed's discovery completes its threads like any
    // other's (the Dawn Leaf's thread T2 is exactly that case).
    this.sweepDiscoveryThreads(spaceId, relicId);
    const effectiveReward = Number(claim.changes ?? 0) > 0 ? rewardAmount : 0;
    // Relics I-6 (R2-1): a Seed's disposition is consumption, not
    // keeping — the copy bound above is spent inside this same
    // transaction and NEVER enters the Hold (no relic_holdings row
    // is written). Its permanent effect is recorded exactly once:
    // the relic_seed_effects primary key IS the idempotency, so a
    // duplicate Seed — effect already recorded — inserts nothing and
    // is consumed without effect and without returning to the world
    // (R3-3). The Codex claim above still stands: personal discovery
    // is written like every claim's.
    if (RELIC_BY_ID.get(relicId)?.tierClass === "seed") {
      const recorded = this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES (?, ?, ?)`,
      ).run(spaceId, relicId, bound.copyId);
      const effectRecorded = Number(recorded.changes ?? 0) > 0;
      this.h.sqlite.prepare(
        `UPDATE relic_copies SET state = 'consumed', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
      ).run(bound.copyId);
      this.recordEvent(bound.copyId, "consumed", { spaceId, world: RELIC_BY_ID.get(relicId)?.world ?? null, detail: { effectRecorded } });
      // Fix (a): the recorder rides this transaction too — uniform
      // across award paths (a Seed never lands in foundIds, so it
      // cannot complete the B-01 set itself).
      this.recordGateCompletionIfComplete(spaceId);
      return { status: "seed-consumed", copyId: bound.copyId, anchorKey: bound.anchorKey, rewardAmount: effectiveReward, testOnly, duplicate: !effectRecorded };
    }
    this.h.sqlite.prepare(
      `INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key, copy_id) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
    ).run(spaceId, relicId, nowIso, testOnly ? 1 : 0, bound.anchorKey, bound.copyId);
    // Fix (a): if this find completed the set, permanence is recorded
    // in the same transaction — the gate is open from this moment,
    // whatever happens to the holdings later.
    this.recordGateCompletionIfComplete(spaceId);
    return { status: "awarded", copyId: bound.copyId, anchorKey: bound.anchorKey, rewardAmount: effectiveReward, testOnly };
  }

  /**
   * The L3 completion sweep (Relics canon entry, 2026-10-31;
   * implementation design §5.6): called from the two personal-
   * discovery write points (the award core above and the legacy
   * sync) INSIDE the same transaction that recorded the discovery.
   * For every discovery-condition thread involving the just-found
   * relic whose other member this space has ALSO personally
   * discovered (the codex_claims record — a consumed Seed's discovery
   * stands there like any other's), the thread unlocks from BOTH
   * members' Codex entries with source='discovery', mirroring the
   * lore exchange's both-members grant. INSERT OR IGNORE against the
   * layer primary key makes the sweep idempotent and monotonic: a
   * row the exchange wrote first is never rewritten, and re-running
   * the sweep (a repeat claim, a later sync) writes nothing twice.
   * Only authored AND owner-approved threads can complete — the same
   * reveal rule codexViews reads — and every thread in RELIC_THREADS
   * has both members placed by construction (the NOT-YET threads are
   * omitted until O-R6, design §3.3), so no sweep row can ever name
   * an unplaced relic. NPC awards write no personal-discovery record
   * (see awardCopyForNpcInTransaction), so they never reach this
   * sweep; an NPC space's threads complete only through discoveries
   * recorded for the space itself.
   */
  private sweepDiscoveryThreads(spaceId: string, discoveredRelicId: string): void {
    try {
      this.completeDiscoveryThreads(spaceId, discoveredRelicId);
    } catch { /* bare handle without the I-4 table: no layers to complete */ }
  }

  /**
   * The completion loop behind the sweep (and the P2-1 backfill
   * below): every discovery-condition thread — restricted to the
   * threads involving `onlyInvolving` when one is named, which is
   * the sweep's incremental case — whose BOTH members stand in this
   * space's personal discovery record unlocks from both members'
   * Codex entries with source='discovery'. The reveal-rule guards
   * (authored AND owner-approved) are the same ones codexViews
   * reads. INSERT OR IGNORE against the layer primary key makes
   * completion idempotent and monotonic: a row the lore exchange
   * wrote first is never rewritten or duplicated. The caller owns
   * the transaction and any error handling; this only writes.
   * Returns the number of rows inserted.
   */
  private completeDiscoveryThreads(spaceId: string, onlyInvolving?: string): number {
    const discovered = this.personalDiscoveryIds(spaceId);
    if (onlyInvolving !== undefined && !discovered.has(onlyInvolving)) return 0;
    let inserted = 0;
    for (const t of RELIC_THREADS) {
      if (t.condition !== "discovery") continue;
      if (onlyInvolving !== undefined && t.relicA !== onlyInvolving && t.relicB !== onlyInvolving) continue;
      if (t.approved !== true || typeof t.text !== "string" || t.text.length === 0) continue;
      if (!discovered.has(t.relicA) || !discovered.has(t.relicB)) continue;
      for (const member of [t.relicA, t.relicB]) {
        const res = this.h.sqlite.prepare(
          `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L3', ?, 'discovery')`,
        ).run(spaceId, member, t.threadId);
        inserted += Number(res.changes ?? 0);
      }
    }
    return inserted;
  }

  /**
   * Canon-entry P2-1 (2026-10-31): the ONE-TIME completion pass for
   * spaces whose discoveries predate the sweep. The sweep is
   * incremental: it completes a thread only when a member is newly
   * discovered, and the award core's "already" return means a
   * re-claim of a long-held relic never reaches it — so a space that
   * had personally discovered both members of a pair BEFORE the
   * canon entry (the Basin Stone and the Lantern, say, both found
   * under the old registry) held no L3 rows and could gain them only
   * through a lore exchange. This pass closes that gap once: for
   * every space with a personal discovery record, each entered
   * discovery-condition thread whose both members stand in that
   * record gains its both-members rows with source='discovery',
   * exactly as the sweep would have written them at the second
   * discovery. A consumed Seed's discovery record stands like any
   * other's, so a pre-entry T2 pair completes too.
   *
   * One-time by the same discipline as the rest of ensureMigrated:
   * it runs inside the lazy migration (at most once per handle) and
   * is idempotent by construction — INSERT OR IGNORE against the
   * layer primary key — so re-entry on a fresh handle, or a direct
   * re-run, writes nothing, and no marker row or schema change is
   * needed. Atomic per space: each space's completions run in one
   * IMMEDIATE transaction (joining the caller's, when there is one),
   * so a failure rolls that space back whole — and, like the Seed
   * conversion's failures, it propagates rather than being swallowed
   * here (only the bare-handle enumeration is caught, below), so a
   * failed run leaves the handle unmigrated and the next touch
   * retries the pass; spaces already completed keep their rows, and
   * their retry inserts nothing. Monotonic against the exchange,
   * like the sweep: an unlock a space already holds — from any
   * source — is never overwritten, downgraded, or duplicated.
   *
   * NPC reach is the sweep's, exactly: the pass reads ONLY the
   * personal discovery record (codex_claims), which NPC awards never
   * write — an NPC resident's finds live in npc_relic_holdings and
   * complete nothing for the space, here as at claim time.
   * Public for the idempotency tests, like convertSeedHoldings.
   * Returns the number of rows inserted.
   */
  backfillDiscoveryThreadCompletions(): number {
    let spaces: { space_id: string }[];
    try {
      spaces = this.h.sqlite.prepare(
        `SELECT DISTINCT space_id FROM codex_claims WHERE reward_key LIKE 'relic-%'`,
      ).all() as { space_id: string }[];
    } catch { return 0; /* bare handle without the codex tables: nothing to complete */ }
    let inserted = 0;
    for (const { space_id } of spaces) {
      if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) {
        inserted += this.completeDiscoveryThreads(space_id);
      } else {
        const run = this.h.sqlite.transaction(() => { inserted += this.completeDiscoveryThreads(space_id); });
        run.immediate();
      }
    }
    return inserted;
  }

  /**
   * THE NPC AWARD (Relics I-5, §5.5 / fix (d)): the same copy pool
   * and the same bind/materialize primitives as the player award
   * above, with the NPC disposition — the copy binds with
   * holder_kind='npc', and the npc_relic_holdings read-model row is
   * written in the SAME transaction (the two records can never
   * diverge because they are never written separately; the copy
   * table remains the single counting source for scarcity). No
   * player records are written: no relic_holdings row, no Codex
   * claim, no first discovery (that record names a discoverer
   * SPACE, resolvable to a display name — an NPC is a resident of a
   * space, not a space), and no Fuel reward (the discovery earn is
   * the player's). One class rule binds this core exactly as it
   * binds the player's: a Seed is consumed on claim, never held
   * (residuals sweep, I-6 review P2-2 — see the disposition below).
   * Courtesy is not decided here — it is the claim
   * service's pre-award check inside the same transaction
   * (relics/claims.ts, claimForNpc). The CALLER owns the transaction.
   */
  awardCopyForNpcInTransaction(spaceId: string, npcId: string, relicId: string): NpcAwardResult {
    // Same conversion-first discipline as the player award: any
    // pre-unification NPC rows become copies before scarcity reads.
    this.backfillCopies();
    const held = this.h.sqlite.prepare(
      `SELECT 1 AS x FROM npc_relic_holdings WHERE space_id = ? AND npc_id = ? AND relic_id = ?`,
    ).get(spaceId, npcId, relicId) as { x: number } | undefined;
    if (held) return { status: "already" };
    const scope = scopeFor(relicId, spaceId);
    const holder: CopyHolder = { kind: "npc", id: npcId, spaceId };
    let bound = this.bindPlacedCopyAt(spaceId, relicId, scope, false, null, holder);
    if (!bound) {
      const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
      if (limit !== null && this.copiesInScope(relicId, scope, false) >= limit) return { status: "empty" };
      // Private class: one copy per scope — ANY live copy in scope
      // blocks materialization (the award core's P1-B rule, I-4).
      if (limit === null && this.copiesInScope(relicId, scope, false) >= 1) return { status: "empty" };
      bound = this.materializeAndBind(spaceId, relicId, scope, false, holder);
      if (!bound) return { status: "empty" };
    }
    // The Seed disposition (R2-1/R3-3) is a CLASS rule, not a player
    // rule: a Seed is consumed on claim and never becomes a holding,
    // whoever claims it — the approved design runs NPC claims
    // through the same claim path with no NPC-only eligibility
    // carve-out, and §5.5's unchanged NPC disposition governs
    // holdable relics. So an NPC's Seed find consumes its copy in
    // this same transaction, writes NO npc_relic_holdings row
    // (nothing is held), and records the permanent effect against
    // the NPC's space — the space the consumption happened in, the
    // same key the player core records for a claiming space — with
    // the same INSERT OR IGNORE idempotency: a later NPC Seed claim
    // whose effect is already recorded consumes its copy without
    // effect and without returning to the world.
    if (RELIC_BY_ID.get(relicId)?.tierClass === "seed") {
      const recorded = this.h.sqlite.prepare(
        `INSERT OR IGNORE INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES (?, ?, ?)`,
      ).run(spaceId, relicId, bound.copyId);
      const effectRecorded = Number(recorded.changes ?? 0) > 0;
      this.h.sqlite.prepare(
        `UPDATE relic_copies SET state = 'consumed', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
      ).run(bound.copyId);
      this.recordEvent(bound.copyId, "consumed", { spaceId, world: RELIC_BY_ID.get(relicId)?.world ?? null, detail: { effectRecorded, npcId } });
      return { status: "seed-consumed", copyId: bound.copyId, anchorKey: bound.anchorKey, duplicate: !effectRecorded };
    }
    this.h.sqlite.prepare(
      `INSERT OR IGNORE INTO npc_relic_holdings (npc_id, space_id, relic_id, found_at, found_in_world) VALUES (?, ?, ?, ?, ?)`,
    ).run(npcId, spaceId, relicId, new Date().toISOString(), RELIC_BY_ID.get(relicId)?.world ?? "");
    return { status: "awarded", copyId: bound.copyId, anchorKey: bound.anchorKey };
  }

  /**
   * The store-level find (§7): world-level presence, derived by the
   * caller (the travel ledger's current world) and passed in. This is
   * the entry the pre-sampling callers use — today, the test suites.
   * (The NPC loop's §5.5 presence model — an NPC has no client, so
   * there are no samples; its presence is its own server-known
   * state — lands in Relics I-5 as awardCopyForNpcInTransaction
   * above, wrapped by the claim service, not through this entry.) The player
   * HTTP path no longer lands here: it goes through the sampled claim
   * in relics/claims.ts, which wraps the same award core with sample
   * validation, receipts, and the reward paid inside the transaction.
   * The reward here is RETURNED, not paid — the caller owns payment.
   */
  claimFind(spaceId: string, relicId: string, currentWorld: string): FindResult {
    const def = RELIC_BY_ID.get(relicId);
    if (!def) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE, kind: "unknown" };
    if (!def.discoverable) return { ok: false, reason: NOT_FINDABLE_MESSAGE, kind: "not-findable" };
    if (currentWorld !== def.world) return { ok: false, reason: WRONG_WORLD_MESSAGE, kind: "wrong-world" };
    const run = this.h.sqlite.transaction((): FindResult => {
      const claimKey = relicCodexKey(relicId);
      const r = this.awardClaimInTransaction(spaceId, relicId, null);
      if (r.status === "already") return { ok: true, alreadyFound: true, rewardAmount: 0, claimKey };
      // Unreachable here (no exact copy is ever named on this path) —
      // the guard keeps the outcome union honest rather than assumed.
      if (r.status === "empty" || r.status === "exact-missed") return { ok: false, reason: EMPTY_POOL_MESSAGE, kind: "empty-pool" };
      // Relics I-6: a Seed's find consumed its copy (R2-1) — the
      // answer names the disposition; alreadyFound stays false
      // because nothing was ever held.
      if (r.status === "seed-consumed") return { ok: true, alreadyFound: false, rewardAmount: r.rewardAmount, claimKey, disposition: r.duplicate ? "seed-consumed-duplicate" : "seed-consumed" };
      return { ok: true, alreadyFound: false, rewardAmount: r.rewardAmount, claimKey };
    });
    return run.immediate();
  }

  /**
   * One-time per-space legacy sync (§8): local finds the server lacks, no
   * presence check. Genuine pre-ship spaces only (P1 fix): the space must
   * carry the eligibility marker the one-time ship migration wrote
   * (markLegacyEligibilityOnce) AND not have synced yet. A post-ship space
   * — marker absent, or no space_meta row at all — is refused exactly like
   * a second sync: no holdings written, no partial writes.
   */
  syncLegacy(spaceId: string, relicIds: readonly string[]): { synced: boolean; added: string[] } {
    let already = false;
    try {
      const row = this.h.sqlite.prepare(`SELECT relic_legacy_synced FROM space_meta WHERE space_id = ?`).get(spaceId) as { relic_legacy_synced: number | null } | undefined;
      already = row?.relic_legacy_synced === 1;
    } catch { already = false; }
    if (already || !this.legacyEligible(spaceId)) return { synced: false, added: [] };
    const added: string[] = [];
    const nowIso = new Date().toISOString();
    const tx = this.h.sqlite.transaction(() => {
      for (const id of relicIds) {
        if (!RELIC_BY_ID.has(id)) continue;
        const anchor = this.currentAnchorFor(id);
        const res = this.h.sqlite.prepare(
          `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, ?, 0, 0, NULL, ?)`,
        ).run(spaceId, id, nowIso, anchor);
        if (Number(res.changes ?? 0) > 0) {
          added.push(id);
          this.h.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, relicCodexKey(id));
          // Canon entry (§5.6): a synced discovery completes threads
          // by the same sweep the award path runs.
          this.sweepDiscoveryThreads(spaceId, id);
          // I-2: a legacy-synced holding is a physical copy like any other.
          try {
            this.mintCopyForHolding({ space_id: spaceId, relic_id: id, found_at: nowIso, test_only: 0, held: 0, held_at: null, anchor_key: anchor, copy_id: null, location: "carried" });
          } catch { /* bare handle without the I-2 tables: the next claim backfills it */ }
        }
      }
      // Tier implementation (2026-10-30): a synced Seed find is a
      // consumption, not a holding — it converts inside this same
      // transaction, so the sync never leaves a Seed in the Hold for
      // a later migration pass to find. `added` still names it: the
      // find happened, and its record (discovery + banked Seed
      // consumption) is exactly what a claim would have written.
      this.convertSeedHoldingsForSpace(spaceId);
      this.h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
      try { this.h.sqlite.prepare(`UPDATE space_meta SET relic_legacy_synced = 1 WHERE space_id = ?`).run(spaceId); } catch { /* column absent on bare handles */ }
    });
    tx.immediate();
    return { synced: true, added };
  }

  hold(spaceId: string, relicId: string): { ok: boolean; reason?: string } {
    if (!RELIC_BY_ID.has(relicId)) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE };
    const row = this.rows(spaceId).find((r) => r.relic_id === relicId);
    if (!row) return { ok: false, reason: "You have not found that relic yet." };
    if (row.held === 1) return { ok: true };
    if (this.heldIds(spaceId).length >= MAX_HELD_RELICS) return { ok: false, reason: HOLD_CAP_MESSAGE };
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite.prepare(`UPDATE relic_holdings SET held = 1, held_at = ? WHERE space_id = ? AND relic_id = ?`).run(new Date().toISOString(), spaceId, relicId);
      // Fix (a): the recorder rides every relic write transaction (§4.8).
      this.recordGateCompletionIfComplete(spaceId);
    });
    run.immediate();
    return { ok: true };
  }
  unhold(spaceId: string, relicId: string): { ok: boolean; reason?: string } {
    if (!RELIC_BY_ID.has(relicId)) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE };
    this.h.sqlite.prepare(`UPDATE relic_holdings SET held = 0, held_at = NULL WHERE space_id = ? AND relic_id = ?`).run(spaceId, relicId);
    return { ok: true };
  }

  /**
   * Store or carry a held relic (Relics I-6, §5.7): the holding's
   * location state — "carried" or "station" — is the I-2 state on
   * the holding row. This method only flips the state; WHERE the
   * change may happen (the Great Station only, O-R7) is enforced by
   * the caller with the server-derived current world, exactly as
   * hold/unhold are gated at the routes. Location never gates buffs
   * (§9 item 7, RULED in the tier decisions, 2026-10-30): a stored
   * relic lends exactly as a carried one does — decided law, pinned
   * by test, not an open question.
   */
  setLocation(spaceId: string, relicId: string, location: "carried" | "station"): { ok: boolean; reason?: string } {
    if (!RELIC_BY_ID.has(relicId)) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE };
    const row = this.h.sqlite.prepare(`SELECT location FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(spaceId, relicId) as { location: string } | undefined;
    if (!row) return { ok: false, reason: "You have not found that relic yet." };
    if (row.location === location) return { ok: true };
    const run = this.h.sqlite.transaction(() => {
      this.h.sqlite.prepare(`UPDATE relic_holdings SET location = ? WHERE space_id = ? AND relic_id = ?`).run(location, spaceId, relicId);
      // Fix (a): the recorder rides every relic write transaction (§4.8).
      this.recordGateCompletionIfComplete(spaceId);
    });
    run.immediate();
    return { ok: true };
  }

  /**
   * Chart eligibility, read-only (Relics I-6, §5.6): could a chart
   * stirring for this relic honestly be issued to this space right
   * now? The mirror of RelicStirringService.issue()'s checks —
   * discoverable, placed (has anchors), not already discovered by
   * this space, no live open stirring, and a pool that can furnish
   * a placed copy in scope — plus the Eternity-gate rule for
   * Eternity-class relics. The Hold's chart menu reads this; the
   * exchange transaction re-validates through issue() itself, so a
   * menu that went stale can never force a bad exchange through.
   */
  chartTargetEligible(spaceId: string, relicId: string): boolean {
    const def = RELIC_BY_ID.get(relicId);
    if (!def || !def.discoverable) return false;
    if ((RELIC_ANCHOR_POINTS[relicId] ?? []).length === 0) return false;
    if ((def.world as string) === "eternity" && !this.gateView(spaceId).open) return false;
    const discovered = this.h.sqlite.prepare(`SELECT 1 AS x FROM codex_claims WHERE space_id = ? AND reward_key = ?`).get(spaceId, relicCodexKey(relicId));
    if (discovered) return false;
    const open = this.h.sqlite.prepare(
      `SELECT 1 AS x FROM relic_stirrings WHERE space_id = ? AND relic_id = ? AND state = 'open' AND open_until > ?`,
    ).get(spaceId, relicId, new Date().toISOString());
    if (open) return false;
    return this.claimableSupply(relicId, scopeFor(relicId, spaceId)) > 0;
  }

  /** Every relic this space could honestly be charted to right now. */
  chartEligibleTargetIds(spaceId: string): string[] {
    return RELICS.filter((def) => this.chartTargetEligible(spaceId, def.id)).map((def) => def.id);
  }

  /**
   * Places a freed copy back into the world (Relics I-2 fix (c),
   * shared since I-6): the resting place is chosen from the COPY's
   * own event-chain history — never an anchor this copy has occupied
   * (ruling 2) — or the copy waits in the return pool when every
   * anchor is in its history. Writes the `returned` event (with the
   * caller's reason in its detail) and the `placed` event when a
   * placement lands. Returns the chosen anchor, or null for the
   * pool. The caller owns the transaction and the holding delete:
   * release() and the I-6 exchange both end a holding this way, and
   * §5.6's exchange return is this same machinery, never a parallel
   * one. (Brain deletion's return is deliberately NOT this helper:
   * its chain records `brain-deleted`, not `returned`.)
   */
  returnPlacedCopy(copyId: string, spaceId: string, relicId: string, fromAnchorKey: string | null, reason: string, detailExtra?: Record<string, unknown>): string | null {
    const world = RELIC_BY_ID.get(relicId)?.world ?? null;
    const toAnchor = this.chooseReturnAnchor(copyId);
    this.recordEvent(copyId, "returned", { spaceId, world, anchorKey: fromAnchorKey, detail: { ...detailExtra, reason, toAnchor } });
    if (toAnchor) {
      this.h.sqlite.prepare(
        `UPDATE relic_copies SET state = 'placed', world = ?, anchor_key = ?, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
      ).run(world, toAnchor, copyId);
      this.recordEvent(copyId, "placed", { world, anchorKey: toAnchor });
    } else {
      // Every anchor is in this copy's history: it waits in the
      // return pool, visible, until a placement session adds anchors.
      this.h.sqlite.prepare(
        `UPDATE relic_copies SET state = 'return-pool', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
      ).run(copyId);
    }
    return toAnchor;
  }

  release(spaceId: string, relicId: string): ReleaseResult | null {
    const run = this.h.sqlite.transaction((): ReleaseResult | null => {
      this.backfillCopies();
      const row = this.h.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(spaceId, relicId) as HoldingRow | undefined;
      if (!row) return null;
      // Fix (a): record permanence from the found set AS IT STANDS —
      // inside this transaction, before the delete below can endanger
      // it (§6). A space whose set completed before this build is made
      // permanent by its first release, not endangered by it.
      this.recordGateCompletionIfComplete(spaceId);
      // Fix (b): a Keystone is never released (approved design §2.2/§5 —
      // classification owns object behavior). The refusal is clean and
      // honest, and the holding stays exactly as it was. Brain deletion
      // is NOT this path: releaseAllForSpace below still returns
      // Keystone copies when a brain ends.
      const def = RELIC_BY_ID.get(relicId);
      if (def?.tierClass === "keystone") {
        return { ok: false, reason: `${def.name} is a keystone — it stays with you. Keystones cannot be released or given back.` };
      }
      let toAnchor: string | null = null;
      if (row.copy_id) {
        // Fix (c): placement is chosen from the COPY's own event-chain
        // history — never an anchor this copy has occupied (ruling 2).
        toAnchor = this.returnPlacedCopy(row.copy_id, spaceId, relicId, row.anchor_key, "release");
      }
      this.h.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).run(spaceId, relicId);
      return { ok: true, event: { relicId, name: RELIC_BY_ID.get(relicId)?.name ?? relicId, reason: "release" as const, fromAnchor: row.anchor_key, toAnchor } };
    });
    return run.immediate();
  }

  /** Brain deletion contract (§6, relic copies per I-2): counted copies return to the world via their own chains (brain-deleted event, then placement); test/private copies are deleted with the brain — their event chains remain as the record, with no pool effect.
   *
   * Fix (b) distinction (I-3): brain deletion is NOT a player release.
   * The class gate in release() governs a living player's choices; when
   * a brain ends, its counted Keystone copies still return to the world
   * here — "stays held" was never a promise that a deleted brain keeps
   * its relics out of the pool forever. */
  releaseAllForSpace(spaceId: string): { returnedCounted: number; removedTotal: number } {
    const body = () => {
      // Convert first, THEN read the rows — the snapshot must carry copy_id.
      this.backfillCopies();
      const rows = this.rows(spaceId);
      let returnedCounted = 0;
      for (const row of rows) {
        const counted = (RELIC_COPY_LIMITS[row.relic_id]?.limit ?? null) !== null && row.test_only === 0;
        if (row.copy_id) {
          const world = RELIC_BY_ID.get(row.relic_id)?.world ?? null;
          this.recordEvent(row.copy_id, "brain-deleted", { spaceId, world, anchorKey: row.anchor_key, detail: { reason: "brain-deleted", counted } });
          if (counted) {
            // A counted copy returns to the world (fix (c) placement);
            // its chain records brain-deleted as the reason.
            const toAnchor = this.chooseReturnAnchor(row.copy_id);
            if (toAnchor) {
              this.h.sqlite.prepare(
                `UPDATE relic_copies SET state = 'placed', world = ?, anchor_key = ?, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
              ).run(world, toAnchor, row.copy_id);
              this.recordEvent(row.copy_id, "placed", { world, anchorKey: toAnchor });
            } else {
              this.h.sqlite.prepare(
                `UPDATE relic_copies SET state = 'return-pool', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
              ).run(row.copy_id);
            }
            returnedCounted++;
          } else {
            // Test/private copies leave with the brain: the copy row is
            // deleted; its event chain remains as the record.
            this.h.sqlite.prepare(`DELETE FROM relic_copies WHERE copy_id = ?`).run(row.copy_id);
          }
        } else if (counted) {
          // No copy bound (the I-2 tables are unavailable on this handle):
          // preserve the pre-I-2 count without inventing a placement.
          returnedCounted++;
        }
      }
      // Relics I-5: copies held by this brain's NPC residents leave
      // with the brain too (the exit I-2's review deferred to
      // unification). Brain deletion erases the npc_* rows in its
      // census; unless the copies move first, a counted copy would
      // sit 'held' by a dead resident forever, silently out of the
      // pool it now shares with everyone. Counted copies return
      // through their chains exactly like player copies; private
      // copies — minted against this brain's own scope — are
      // deleted with it, as player private copies are above.
      const npcCopies = this.h.sqlite.prepare(
        `SELECT * FROM relic_copies WHERE holder_kind = 'npc' AND holder_space_id = ?`,
      ).all(spaceId) as CopyRow[];
      for (const copy of npcCopies) {
        const counted = (RELIC_COPY_LIMITS[copy.relic_id]?.limit ?? null) !== null && copy.test_only === 0;
        const world = RELIC_BY_ID.get(copy.relic_id)?.world ?? null;
        // The anchor this copy was claimed at (residuals sweep, I-5
        // review P2-4): the player loop above records its holding
        // row's anchor, but a held copy's own row carries none —
        // binding clears it, and "the claim event keeps it"
        // (bindCopy). So the NPC path reads the anchor from the
        // copy's most recent claim event, aligning the two paths'
        // brain-deleted records. A copy with no claim event (a
        // pre-unification backfill, whose genesis names no anchor)
        // has no recorded anchor anywhere; NULL stays honest there.
        const claimedEvent = this.h.sqlite.prepare(
          `SELECT anchor_key FROM relic_copy_events WHERE copy_id = ? AND kind = 'claimed' AND anchor_key IS NOT NULL ORDER BY id DESC LIMIT 1`,
        ).get(copy.copy_id) as { anchor_key: string } | undefined;
        this.recordEvent(copy.copy_id, "brain-deleted", { spaceId, world, anchorKey: claimedEvent?.anchor_key ?? copy.anchor_key, detail: { reason: "brain-deleted", counted, npcId: copy.holder_id } });
        if (counted) {
          const toAnchor = this.chooseReturnAnchor(copy.copy_id);
          if (toAnchor) {
            this.h.sqlite.prepare(
              `UPDATE relic_copies SET state = 'placed', world = ?, anchor_key = ?, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
            ).run(world, toAnchor, copy.copy_id);
            this.recordEvent(copy.copy_id, "placed", { world, anchorKey: toAnchor });
          } else {
            this.h.sqlite.prepare(
              `UPDATE relic_copies SET state = 'return-pool', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
            ).run(copy.copy_id);
          }
          returnedCounted++;
        } else {
          // The brain's own private/test NPC copies leave with it:
          // the copy row is deleted; its event chain remains.
          this.h.sqlite.prepare(`DELETE FROM relic_copies WHERE copy_id = ?`).run(copy.copy_id);
        }
      }
      const removed = this.h.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = ?`).run(spaceId);
      return { returnedCounted, removedTotal: Number(removed.changes ?? 0) };
    };
    // Brain deletion calls this from inside its own transaction — in that
    // case run inline (the outer transaction is the atomic unit); otherwise
    // run as its own immediate transaction.
    if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) return body();
    return this.h.sqlite.transaction(body).immediate();
  }

  // ---- Relics I-7: the presentation read model (§5.1/§5.8) ----------
  // Everything in this section is a READ over records the earlier
  // increments wrote (relic_codex_layers, codex_claims,
  // relic_first_discoveries, relic_stirrings, relic_copy_events).
  // CONCEALMENT: a layer's text is included ONLY when this viewer has
  // unlocked that layer — locked text is never serialized (approved
  // design §3.3, acceptance §8.1 #12). A layer whose canon text does
  // not exist yet reads "unwritten", never as an empty unlocked text.

  /** The viewer's PERSONAL DISCOVERY record (review P1-2): the
   *  codex_claims rows — written by every award path, permanent across
   *  release, and the same record the stirring service and the chart
   *  eligibility read. NOT the holdings rows: a released relic stays
   *  discovered, and a consumed Seed was discovered without ever being
   *  held. */
  private personalDiscoveryIds(spaceId: string): Set<string> {
    try {
      const rows = this.h.sqlite.prepare(
        `SELECT reward_key FROM codex_claims WHERE space_id = ? AND reward_key LIKE 'relic-%'`,
      ).all(spaceId) as { reward_key: string }[];
      return new Set(rows.map((r) => r.reward_key.slice("relic-".length)));
    } catch { return new Set(); }
  }

  /** Whether THIS viewer has unlocked the relic's place (L1) layer —
   *  the gate every place string in the payload answers to (§8.1 #12:
   *  an anchor's placeName rides on the L1 unlock for its relic, so it
   *  is serialized only for viewers who hold the unlock; review P1-1). */
  private placeUnlockedIds(spaceId: string): Set<string> {
    try {
      const rows = this.h.sqlite.prepare(
        `SELECT DISTINCT relic_id FROM relic_codex_layers WHERE space_id = ? AND layer = 'L1'`,
      ).all(spaceId) as { relic_id: string }[];
      return new Set(rows.map((r) => r.relic_id));
    } catch { return new Set(); }
  }

  /** One held copy's provenance: its whole event chain, in order.
   *  Event place names ride only when the viewer holds the relic's L1
   *  unlock (placeUnlocked) — otherwise the step reads by kind alone. */
  private provenanceFor(copyId: string, relicId: string, placeUnlocked: boolean): RelicProvenanceEventView[] {
    try {
      const rows = this.h.sqlite.prepare(
        `SELECT kind, world, anchor_key, detail FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`,
      ).all(copyId) as { kind: string; world: string | null; anchor_key: string | null; detail: string | null }[];
      return rows.map((e) => {
        let reason: string | null = null;
        if (e.detail) {
          try {
            const d = JSON.parse(e.detail) as { reason?: unknown };
            if (typeof d?.reason === "string") reason = d.reason;
          } catch { reason = null; }
        }
        return { kind: e.kind, world: e.world, anchorKey: e.anchor_key, placeName: placeUnlocked ? anchorPlaceName(relicId, e.anchor_key) : null, reason };
      });
    } catch { return []; }
  }

  /** The copy's pool context in plain words, from the registry truth. */
  private copyContextFor(relicId: string): string {
    const lim = RELIC_COPY_LIMITS[relicId];
    if (!lim) return "A copy in the shared pool.";
    if (lim.scarcityClass === "private") return "A copy made for your brain alone.";
    if (lim.limit !== null) return `One of at most ${lim.limit} copies in the shared pool.`;
    return "A copy in the shared pool.";
  }

  /** The viewer's stirrings, oldest first. Expiry is evaluated at
   *  read time (§4.6 — there is no background sweeper), the same
   *  update the stirring service performs on its own reads. */
  private stirringViews(spaceId: string): RelicStirringView[] {
    try {
      const nowIso = new Date().toISOString();
      this.h.sqlite.prepare(
        `UPDATE relic_stirrings SET state = 'expired', resolved_at = ?, resolved_reason = 'window-ended' WHERE space_id = ? AND state = 'open' AND open_until <= ?`,
      ).run(nowIso, spaceId, nowIso);
    } catch { /* bare handle without the I-5 table: no stirrings to read */ }
    try {
      const rows = this.h.sqlite.prepare(
        `SELECT relic_id, source, state, resolved_reason FROM relic_stirrings WHERE space_id = ? ORDER BY id ASC`,
      ).all(spaceId) as { relic_id: string; source: string; state: string; resolved_reason: string | null }[];
      return rows.flatMap((r) => {
        const def = RELIC_BY_ID.get(r.relic_id);
        if (!def) return [];
        return [{
          relicId: r.relic_id, name: def.name, world: def.world, worldName: def.worldName,
          source: (r.source === "chart" ? "chart" : "ambient") as RelicStirringView["source"],
          state: r.state as RelicStirringView["state"], resolvedReason: r.resolved_reason,
        }];
      });
    } catch { return []; }
  }

  /** The layered Codex (§5.8): per relic, the layer unlocks for THIS
   *  viewer, the first-discovery record for the relic's scope, the
   *  viewer's own discovery state, and the viewer's stirrings. */
  private codexViews(spaceId: string, found: Set<string>): RelicCodexView[] {
    const layerRows = new Map<string, Set<string>>();
    try {
      const rows = this.h.sqlite.prepare(
        `SELECT relic_id, layer, thread_id FROM relic_codex_layers WHERE space_id = ?`,
      ).all(spaceId) as { relic_id: string; layer: string; thread_id: string }[];
      for (const r of rows) {
        const set = layerRows.get(r.relic_id) ?? new Set<string>();
        set.add(`${r.layer}:${r.thread_id}`);
        layerRows.set(r.relic_id, set);
      }
    } catch { /* bare handle without the I-4 table: every layer reads locked/unwritten */ }
    const stirrings = this.stirringViews(spaceId);
    return RELICS.map((def) => {
      const unlocked = layerRows.get(def.id) ?? new Set<string>();
      const discovered = found.has(def.id);
      const stirringText = typeof def.loreStirring === "string" && def.loreStirring.length > 0 ? def.loreStirring : null;
      const stirringLayer: RelicCodexView["layers"]["stirring"] = stirringText === null
        ? { state: "unwritten" }
        : unlocked.has("L0:")
          ? { state: "unlocked", text: stirringText }
          : { state: "locked" };
      const placeLayer: RelicCodexView["layers"]["place"] = unlocked.has("L1:")
        ? { state: "unlocked", text: RELIC_ANCHOR_POINTS[def.id]?.[0]?.placeText ?? def.place }
        : { state: "locked" };
      const descriptionLayer: RelicCodexView["layers"]["description"] = discovered
        ? { state: "unlocked", text: def.lore }
        : { state: "locked" };
      const threadEntries = RELIC_THREADS
        .filter((t) => t.relicA === def.id || t.relicB === def.id)
        .map((t) => {
          const otherId = t.relicA === def.id ? t.relicB : t.relicA;
          const isUnlocked = unlocked.has(`L3:${t.threadId}`) && t.approved === true && typeof t.text === "string" && t.text.length > 0;
          return {
            threadId: t.threadId, otherRelicId: otherId,
            otherName: RELIC_BY_ID.get(otherId)?.name ?? otherId,
            unlocked: isUnlocked, ...(isUnlocked ? { text: t.text as string } : {}),
          };
        });
      const threadsState: RelicCodexView["layers"]["threads"]["state"] = threadEntries.length === 0
        ? "unwritten"
        : threadEntries.some((e) => e.unlocked) ? "unlocked" : "locked";
      // The first-discovery record for the relic's scope (the same
      // scope rule the claim writes with: private pools are per-brain,
      // every other pool's record is the public one).
      let firstDiscovery: RelicCodexView["firstDiscovery"] = null;
      try {
        const scope = RELIC_COPY_LIMITS[def.id]?.scarcityClass === "private" ? spaceId : "public";
        const row = this.h.sqlite.prepare(
          `SELECT space_id, anchor_key FROM relic_first_discoveries WHERE scope = ? AND relic_id = ?`,
        ).get(scope, def.id) as { space_id: string; anchor_key: string } | undefined;
        if (row) {
          const byViewer = row.space_id === spaceId;
          let discovererName = "Another traveller";
          if (byViewer) discovererName = "You";
          else {
            try {
              const s = this.h.sqlite.prepare(`SELECT name FROM spaces WHERE id = ?`).get(row.space_id) as { name: string } | undefined;
              if (s?.name) discovererName = s.name;
            } catch { /* the record stands without a resolvable name */ }
          }
          // The record's place rides ONLY for viewers holding the
          // relic's L1 unlock (review P1-1 — §8.1 #12 concealment
          // governs every field, not just layers).
          const placeName = unlocked.has("L1:") ? (anchorPlaceName(def.id, row.anchor_key) ?? def.place) : undefined;
          firstDiscovery = { discovererName, byViewer, ...(placeName !== undefined ? { placeName } : {}) };
        }
      } catch { /* bare handle without the I-4 table */ }
      return {
        relicId: def.id, name: def.name, world: def.world, worldName: def.worldName, discovered,
        layers: { stirring: stirringLayer, place: placeLayer, description: descriptionLayer, threads: { state: threadsState, entries: threadEntries } },
        firstDiscovery,
        stirrings: stirrings.filter((s) => s.relicId === def.id),
      };
    });
  }

  /**
   * Recent departures read from BOTH records: copy event chains
   * (returned / brain-deleted events, I-2 onward) and the legacy
   * relic_returns rows written before I-2 — a departure written before
   * the copies era stays visible after it. Newest first; the shape is
   * the RelicReturnView the web already renders.
   */
  recentDepartures(spaceId: string, limit = 5): RelicReturnView[] {
    interface Dep { relicId: string; reason: "release" | "exchange" | "brain-deleted"; fromAnchor: string | null; toAnchor: string | null; at: string; ord: number }
    const deps: Dep[] = [];
    try {
      const evs = this.h.sqlite.prepare(
        `SELECT e.kind, e.anchor_key, e.detail, e.created_at, e.id, c.relic_id FROM relic_copy_events e JOIN relic_copies c ON c.copy_id = e.copy_id WHERE e.space_id = ? AND e.kind IN ('returned','brain-deleted') ORDER BY e.id DESC LIMIT ?`,
      ).all(spaceId, limit) as { kind: string; anchor_key: string | null; detail: string | null; created_at: string; id: number; relic_id: string }[];
      for (const e of evs) {
        let toAnchor: string | null = null;
        let detailReason: string | null = null;
        if (e.kind === "returned" && e.detail) {
          try {
            const d = JSON.parse(e.detail) as { toAnchor?: string | null; reason?: unknown };
            toAnchor = d.toAnchor ?? null;
            if (typeof d.reason === "string") detailReason = d.reason;
          } catch { toAnchor = null; }
        }
        // Relics I-7: an exchange's return is labeled an exchange —
        // the stored detail has carried reason='exchange' since I-6;
        // only the presentation mapping called everything a release.
        const reason: Dep["reason"] = e.kind === "brain-deleted" ? "brain-deleted" : detailReason === "exchange" ? "exchange" : "release";
        deps.push({ relicId: e.relic_id, reason, fromAnchor: e.anchor_key, toAnchor, at: e.created_at, ord: e.id });
      }
    } catch { /* bare handle without the I-2 tables: the legacy rows below still read */ }
    const rows = this.h.sqlite.prepare(`SELECT * FROM relic_returns WHERE space_id = ? ORDER BY id DESC LIMIT ?`).all(spaceId, limit) as
      { relic_id: string; reason: string; from_anchor: string | null; to_anchor: string | null; created_at: string; id: number }[];
    for (const r of rows) {
      deps.push({ relicId: r.relic_id, reason: r.reason === "brain-deleted" ? "brain-deleted" : "release", fromAnchor: r.from_anchor, toAnchor: r.to_anchor, at: r.created_at, ord: -r.id });
    }
    deps.sort((a, b) => (b.at.localeCompare(a.at)) || (b.ord - a.ord));
    return deps.slice(0, limit).map((d) => ({
      relicId: d.relicId, name: RELIC_BY_ID.get(d.relicId)?.name ?? d.relicId,
      reason: d.reason, fromAnchor: d.fromAnchor, toAnchor: d.toAnchor,
    }));
  }

  gateView(spaceId: string): RelicGateView {
    // Fix (a): openedBefore reads the permanence record first — the
    // same source TravelRepo.eternityGateOpened() reads, so the view
    // and the enforcement can never disagree. The arrived-journey
    // derivation remains as the fallback for a volume whose backfill
    // has not run yet; both describe the same fact.
    let openedBefore = this.gateOpenedRecorded(spaceId);
    if (!openedBefore) {
      try {
        const row = this.h.sqlite.prepare(`SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = ? AND destination = 'eternity' AND state = 'arrived'`).get(spaceId) as { n: number };
        openedBefore = row.n > 0;
      } catch { openedBefore = false; }
    }
    const found = new Set(this.foundIds(spaceId));
    const open = openedBefore || eternityGateOpen(found);
    let missingPlain = "The way to Eternity's world is open to you.";
    if (!open) {
      const missing: string[] = [];
      if (!found.has("witness-without-a-name")) missing.push("the Witness Without a Name");
      const others = [...found].filter((id) => id !== "witness-without-a-name").length;
      if (others < 2) missing.push(others === 0 ? "any two other relics" : "one more relic");
      missingPlain = `The gate is still closed. Still needed: ${missing.join(" and ")}.`;
    }
    return { open, openedBefore, missingPlain };
  }

  state(spaceId: string): RelicsStateView {
    this.ensureMigrated();
    const rows = this.rows(spaceId);
    const held = this.heldIds(spaceId);
    const buffs = buffsForSpace(this.h, spaceId);
    const currentAnchorByRelic: Record<string, string> = {};
    for (const def of RELICS) currentAnchorByRelic[def.id] = this.currentAnchorFor(def.id);
    const placeIds = this.placeUnlockedIds(spaceId);
    return {
      found: rows.map((r) => r.relic_id),
      held,
      holdings: rows.map((r) => ({
        relicId: r.relic_id, name: RELIC_BY_ID.get(r.relic_id)?.name ?? r.relic_id,
        held: r.held === 1, testOnly: r.test_only === 1, anchorKey: r.anchor_key,
        blessing: RELIC_BLESSINGS[r.relic_id] ?? { status: "cut" as const, giftPlain: "It lends no blessing yet.", costPlain: "No trade-off." },
        // Relics I-6: the class, the resting place, and the exchange
        // surface ride the read model — computed fresh, never stored.
        // Reads are unrestricted (O-R7); the exchange transaction
        // re-validates everything this view offers.
        tierClass: RELIC_BY_ID.get(r.relic_id)?.tierClass ?? null,
        location: r.location,
        exchange: this.exchangeViewFor(r.relic_id),
        // Relics I-7 (§5.1): the held copy's identity, pool context,
        // and provenance chain ride the read model.
        copyId: r.copy_id,
        copyContext: this.copyContextFor(r.relic_id),
        provenance: r.copy_id ? this.provenanceFor(r.copy_id, r.relic_id, placeIds.has(r.relic_id)) : [],
      })),
      buffs: { ...buffs, riseWindowSetByName: relicName(buffs.riseWindowSetBy), riseWindowOverruledNames: buffs.riseWindowOverruled.map((id) => relicName(id) ?? id) } as RelicsStateView["buffs"],
      gate: this.gateView(spaceId),
      recentDepartures: this.recentDepartures(spaceId),
      isOwnerSpace: isOwnerSpace(spaceId),
      scarcityOff: this.scarcityOff(spaceId),
      currentAnchorByRelic,
      chartTargets: this.chartEligibleTargetIds(spaceId),
      // Relics I-7 (§5.1/§5.8): the layered Codex + stirring states.
      // Discovery keys to the PERSONAL DISCOVERY record (codex_claims),
      // never to current holdings (review P1-2).
      codex: this.codexViews(spaceId, this.personalDiscoveryIds(spaceId)),
      stirrings: this.stirringViews(spaceId),
    };
  }

  /** The exchange menu for one relic (§4.7): class eligibility, the
   *  eligible lore threads, and the Credits seam's posted value —
   *  all computed from the same sources the exchange transaction
   *  validates against, so menu and transaction cannot disagree
   *  about the RULES (only about a world that changed in between,
   *  which the transaction re-checks). */
  private exchangeViewFor(relicId: string): RelicExchangeView {
    const legacy = RELIC_BY_ID.get(relicId)?.tierClass === "legacy";
    if (!legacy) return { eligible: false, loreThreadIds: [], creditsOffered: false, creditsValue: null };
    const value = postedExchangeValue(relicId);
    return {
      eligible: true,
      loreThreadIds: eligibleExchangeThreads(relicId).map((t) => t.threadId),
      creditsOffered: value.offered,
      creditsValue: value.offered ? value.value : null,
    };
  }

  preview(spaceId: string, relicId: string): { refused?: string; buffs: ReturnType<typeof computeRelicBuffs>; heldIds: string[] } {
    const held = this.heldIds(spaceId);
    // The preview must read the same buffs as every other surface:
    // recorded Seed gifts are part of the space's true buffs, so the
    // seed input rides every branch (review F-1 — while the seed map
    // was empty this omission was vacuous; with ruled values live it
    // understated a player's permanent gifts on this surface).
    const seeds = seedEffectIdsForSpace(this.h, spaceId);
    if (!RELIC_BY_ID.has(relicId)) return { refused: UNKNOWN_RELIC_MESSAGE, buffs: computeRelicBuffs(held, seeds), heldIds: held };
    if (!this.foundIds(spaceId).includes(relicId)) return { refused: "You have not found that relic yet.", buffs: computeRelicBuffs(held, seeds), heldIds: held };
    if (held.includes(relicId)) return { refused: `You already hold ${RELIC_BY_ID.get(relicId)!.name}.`, buffs: computeRelicBuffs(held, seeds), heldIds: held };
    if (held.length >= MAX_HELD_RELICS) return { refused: HOLD_CAP_MESSAGE, buffs: computeRelicBuffs(held, seeds), heldIds: held };
    const would = [...held, relicId];
    const buffs = computeRelicBuffs(would, seeds);
    return { buffs: { ...buffs, riseWindowSetByName: relicName(buffs.riseWindowSetBy), riseWindowOverruledNames: buffs.riseWindowOverruled.map((id) => relicName(id) ?? id) } as ReturnType<typeof computeRelicBuffs>, heldIds: would };
  }
}
