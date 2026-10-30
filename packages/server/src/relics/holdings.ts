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
  RELIC_ANCHOR_POINTS, relicCodexKey, eternityGateOpen,
  type EternityGateHoldings, type RelicGateView, type RelicHoldingView,
  type RelicReturnView, type RelicsStateView,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { buffsForSpace, computeRelicBuffs, heldRelicIds, relicName } from "./buffs.js";

export const EMPTY_POOL_MESSAGE =
  "Every copy of this relic is held right now. Yours will be here to find when one returns — nothing is lost by having come, and nothing is recorded against you.";
export const WRONG_WORLD_MESSAGE = "That relic does not rest in the world you are standing in right now.";
export const NOT_FINDABLE_MESSAGE = "That relic cannot be found yet — its resting place is not open.";
export const UNKNOWN_RELIC_MESSAGE = "That relic is not in the Codex.";
export const HOLD_CAP_MESSAGE = `You can hold ${MAX_HELD_RELICS} relics at once. Set one down first to take up another — setting one down costs nothing and loses nothing.`;

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
export type FindResult =
  | { ok: true; alreadyFound: boolean; rewardAmount: number; claimKey: string }
  | { ok: false; reason: string; kind: "unknown" | "not-findable" | "wrong-world" | "empty-pool" };

/** The award core's outcome (Relics I-4): the transaction-internal half
 *  of a find, before any caller wraps it in its own result shape. */
export type AwardResult =
  | { status: "already" }
  | { status: "empty" }
  | { status: "awarded"; copyId: string; anchorKey: string; rewardAmount: number; testOnly: boolean };

/** The NPC award core's outcome (Relics I-5): the player AwardResult's
 *  sibling — no reward is ever computed for an NPC claim. */
export type NpcAwardResult =
  | { status: "already" }
  | { status: "empty" }
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
   */
  private recordGateCompletionIfComplete(spaceId: string): void {
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
  /** Append one fact to a copy's chain. Events are never updated or deleted. */
  private recordEvent(copyId: string, kind: string, facts: { spaceId?: string | null; world?: string | null; anchorKey?: string | null; detail?: unknown } = {}): void {
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
   * The reward is computed here but NOT paid — paying is the caller's
   * act, inside the caller's transaction.
   */
  awardClaimInTransaction(spaceId: string, relicId: string, anchorKey: string | null): AwardResult {
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
    let bound = this.bindPlacedCopyAt(spaceId, relicId, scope, testOnly, anchorKey);
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
    this.h.sqlite.prepare(
      `INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key, copy_id) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
    ).run(spaceId, relicId, nowIso, testOnly ? 1 : 0, bound.anchorKey, bound.copyId);
    const claim = this.h.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, relicCodexKey(relicId));
    // Fix (a): if this find completed the set, permanence is recorded
    // in the same transaction — the gate is open from this moment,
    // whatever happens to the holdings later.
    this.recordGateCompletionIfComplete(spaceId);
    return { status: "awarded", copyId: bound.copyId, anchorKey: bound.anchorKey, rewardAmount: Number(claim.changes ?? 0) > 0 ? rewardAmount : 0, testOnly };
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
   * the player's). Courtesy is not decided here — it is the claim
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
      if (r.status === "empty") return { ok: false, reason: EMPTY_POOL_MESSAGE, kind: "empty-pool" };
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
          // I-2: a legacy-synced holding is a physical copy like any other.
          try {
            this.mintCopyForHolding({ space_id: spaceId, relic_id: id, found_at: nowIso, test_only: 0, held: 0, held_at: null, anchor_key: anchor, copy_id: null, location: "carried" });
          } catch { /* bare handle without the I-2 tables: the next claim backfills it */ }
        }
      }
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
      const world = RELIC_BY_ID.get(relicId)?.world ?? null;
      let toAnchor: string | null = null;
      if (row.copy_id) {
        // Fix (c): placement is chosen from the COPY's own event-chain
        // history — never an anchor this copy has occupied (ruling 2).
        toAnchor = this.chooseReturnAnchor(row.copy_id);
        this.recordEvent(row.copy_id, "returned", { spaceId, world, anchorKey: row.anchor_key, detail: { reason: "release", toAnchor } });
        if (toAnchor) {
          this.h.sqlite.prepare(
            `UPDATE relic_copies SET state = 'placed', world = ?, anchor_key = ?, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
          ).run(world, toAnchor, row.copy_id);
          this.recordEvent(row.copy_id, "placed", { world, anchorKey: toAnchor });
        } else {
          // Every anchor is in this copy's history: it waits in the
          // return pool, visible, until a placement session adds anchors.
          this.h.sqlite.prepare(
            `UPDATE relic_copies SET state = 'return-pool', world = NULL, anchor_key = NULL, holder_kind = NULL, holder_id = NULL, holder_space_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE copy_id = ?`,
          ).run(row.copy_id);
        }
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
        this.recordEvent(copy.copy_id, "brain-deleted", { spaceId, world, anchorKey: copy.anchor_key, detail: { reason: "brain-deleted", counted, npcId: copy.holder_id } });
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

  /**
   * Recent departures read from BOTH records: copy event chains
   * (returned / brain-deleted events, I-2 onward) and the legacy
   * relic_returns rows written before I-2 — a departure written before
   * the copies era stays visible after it. Newest first; the shape is
   * the RelicReturnView the web already renders.
   */
  recentDepartures(spaceId: string, limit = 5): RelicReturnView[] {
    interface Dep { relicId: string; reason: "release" | "brain-deleted"; fromAnchor: string | null; toAnchor: string | null; at: string; ord: number }
    const deps: Dep[] = [];
    try {
      const evs = this.h.sqlite.prepare(
        `SELECT e.kind, e.anchor_key, e.detail, e.created_at, e.id, c.relic_id FROM relic_copy_events e JOIN relic_copies c ON c.copy_id = e.copy_id WHERE e.space_id = ? AND e.kind IN ('returned','brain-deleted') ORDER BY e.id DESC LIMIT ?`,
      ).all(spaceId, limit) as { kind: string; anchor_key: string | null; detail: string | null; created_at: string; id: number; relic_id: string }[];
      for (const e of evs) {
        let toAnchor: string | null = null;
        if (e.kind === "returned" && e.detail) {
          try { toAnchor = (JSON.parse(e.detail) as { toAnchor?: string | null }).toAnchor ?? null; } catch { toAnchor = null; }
        }
        deps.push({ relicId: e.relic_id, reason: e.kind === "brain-deleted" ? "brain-deleted" : "release", fromAnchor: e.anchor_key, toAnchor, at: e.created_at, ord: e.id });
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
    return {
      found: rows.map((r) => r.relic_id),
      held,
      holdings: rows.map((r) => ({
        relicId: r.relic_id, name: RELIC_BY_ID.get(r.relic_id)?.name ?? r.relic_id,
        held: r.held === 1, testOnly: r.test_only === 1, anchorKey: r.anchor_key,
        blessing: RELIC_BLESSINGS[r.relic_id] ?? { status: "cut" as const, giftPlain: "It lends no blessing yet.", costPlain: "No trade-off." },
      })),
      buffs: { ...buffs, riseWindowSetByName: relicName(buffs.riseWindowSetBy), riseWindowOverruledNames: buffs.riseWindowOverruled.map((id) => relicName(id) ?? id) } as RelicsStateView["buffs"],
      gate: this.gateView(spaceId),
      recentDepartures: this.recentDepartures(spaceId),
      isOwnerSpace: isOwnerSpace(spaceId),
      scarcityOff: this.scarcityOff(spaceId),
      currentAnchorByRelic,
    };
  }

  preview(spaceId: string, relicId: string): { refused?: string; buffs: ReturnType<typeof computeRelicBuffs>; heldIds: string[] } {
    const held = this.heldIds(spaceId);
    if (!RELIC_BY_ID.has(relicId)) return { refused: UNKNOWN_RELIC_MESSAGE, buffs: computeRelicBuffs(held), heldIds: held };
    if (!this.foundIds(spaceId).includes(relicId)) return { refused: "You have not found that relic yet.", buffs: computeRelicBuffs(held), heldIds: held };
    if (held.includes(relicId)) return { refused: `You already hold ${RELIC_BY_ID.get(relicId)!.name}.`, buffs: computeRelicBuffs(held), heldIds: held };
    if (held.length >= MAX_HELD_RELICS) return { refused: HOLD_CAP_MESSAGE, buffs: computeRelicBuffs(held), heldIds: held };
    const would = [...held, relicId];
    const buffs = computeRelicBuffs(would);
    return { buffs: { ...buffs, riseWindowSetByName: relicName(buffs.riseWindowSetBy), riseWindowOverruledNames: buffs.riseWindowOverruled.map((id) => relicName(id) ?? id) } as ReturnType<typeof computeRelicBuffs>, heldIds: would };
  }
}
