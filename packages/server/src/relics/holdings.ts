/**
 * Relic holdings store (design note v2 §§5–9). Reads the LANDED shared
 * registry — there is no second registry. Scarcity is a limit checked inside
 * the claim transaction; holdings never expire and are never removed by any
 * read/sweep path. Release and brain deletion are the only ways a copy leaves.
 */
import {
  RELICS, RELIC_BY_ID, RELIC_BLESSINGS, RELIC_COPY_LIMITS, MAX_HELD_RELICS,
  firstRelicAnchor, nextRelicAnchor, relicCodexKey, eternityGateOpen,
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

export interface HoldingRow { space_id: string; relic_id: string; found_at: string; test_only: number; held: number; held_at: string | null; anchor_key: string; }
export type FindResult =
  | { ok: true; alreadyFound: boolean; rewardAmount: number; claimKey: string }
  | { ok: false; reason: string; kind: "unknown" | "not-findable" | "wrong-world" | "empty-pool" };

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
    try { this.migrateLegacyClaims(); migratedHandles.add(this.h.sqlite as object); } catch { /* tables may not exist in a bare unit handle */ }
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
  poolCount(relicId: string): number {
    const row = this.h.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE relic_id = ? AND test_only = 0`).get(relicId) as { n: number };
    return row.n;
  }
  poolAvailable(relicId: string): number | null {
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    if (limit === null) return null;
    return limit - this.poolCount(relicId);
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
  currentAnchorFor(relicId: string): string {
    const ret = this.h.sqlite.prepare(`SELECT to_anchor FROM relic_returns WHERE relic_id = ? AND to_anchor IS NOT NULL ORDER BY id DESC LIMIT 1`).get(relicId) as { to_anchor: string } | undefined;
    if (ret?.to_anchor) return ret.to_anchor;
    return firstRelicAnchor(relicId);
  }

  /**
   * The verified find (§7). Presence is derived by the caller (the travel
   * ledger's current world) and passed in; identity, idempotency, scarcity,
   * the holding write and the claim row all happen inside ONE immediate
   * transaction, so two simultaneous claims for the final copy cannot both win.
   */
  claimFind(spaceId: string, relicId: string, currentWorld: string, anchorKey?: string): FindResult {
    const def = RELIC_BY_ID.get(relicId);
    if (!def) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE, kind: "unknown" };
    if (!def.discoverable) return { ok: false, reason: NOT_FINDABLE_MESSAGE, kind: "not-findable" };
    if (currentWorld !== def.world) return { ok: false, reason: WRONG_WORLD_MESSAGE, kind: "wrong-world" };
    const run = this.h.sqlite.transaction((): FindResult => {
      const existing = this.h.sqlite.prepare(`SELECT relic_id FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(spaceId, relicId);
      const claimKey = relicCodexKey(relicId);
      if (existing) return { ok: true, alreadyFound: true, rewardAmount: 0, claimKey };
      const testOnly = this.scarcityOff(spaceId);
      if (!testOnly) {
        const avail = this.poolAvailable(relicId);
        if (avail !== null && avail <= 0) return { ok: false, reason: EMPTY_POOL_MESSAGE, kind: "empty-pool" };
      }
      // Buffed discovery rate from the held set BEFORE this find — a relic's
      // own buff never applies to its own discovery (it is not held yet).
      const rewardAmount = buffsForSpace(this.h, spaceId).discoveryEarn;
      const anchor = anchorKey ? anchorKey : this.currentAnchorFor(relicId);
      const nowIso = new Date().toISOString();
      this.h.sqlite.prepare(
        `INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, ?, ?, 0, NULL, ?)`,
      ).run(spaceId, relicId, nowIso, testOnly ? 1 : 0, anchor);
      const claim = this.h.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, claimKey);
      return { ok: true, alreadyFound: false, rewardAmount: Number(claim.changes ?? 0) > 0 ? rewardAmount : 0, claimKey };
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
        const res = this.h.sqlite.prepare(
          `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, ?, 0, 0, NULL, ?)`,
        ).run(spaceId, id, nowIso, this.currentAnchorFor(id));
        if (Number(res.changes ?? 0) > 0) {
          added.push(id);
          this.h.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, relicCodexKey(id));
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
    this.h.sqlite.prepare(`UPDATE relic_holdings SET held = 1, held_at = ? WHERE space_id = ? AND relic_id = ?`).run(new Date().toISOString(), spaceId, relicId);
    return { ok: true };
  }
  unhold(spaceId: string, relicId: string): { ok: boolean; reason?: string } {
    if (!RELIC_BY_ID.has(relicId)) return { ok: false, reason: UNKNOWN_RELIC_MESSAGE };
    this.h.sqlite.prepare(`UPDATE relic_holdings SET held = 0, held_at = NULL WHERE space_id = ? AND relic_id = ?`).run(spaceId, relicId);
    return { ok: true };
  }

  release(spaceId: string, relicId: string): RelicReturnView | null {
    const run = this.h.sqlite.transaction((): RelicReturnView | null => {
      const row = this.h.sqlite.prepare(`SELECT * FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(spaceId, relicId) as HoldingRow | undefined;
      if (!row) return null;
      const toAnchor = nextRelicAnchor(relicId, row.anchor_key);
      this.h.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).run(spaceId, relicId);
      this.h.sqlite.prepare(
        `INSERT INTO relic_returns (space_id, relic_id, reason, from_anchor, to_anchor, created_at) VALUES (?, ?, 'release', ?, ?, ?)`,
      ).run(spaceId, relicId, row.anchor_key, toAnchor, new Date().toISOString());
      return { relicId, name: RELIC_BY_ID.get(relicId)?.name ?? relicId, reason: "release" as const, fromAnchor: row.anchor_key, toAnchor };
    });
    return run.immediate();
  }

  /** Brain deletion contract (§6): counted copies return (rows written here, before any space-row deletion); test/private copies vanish with no pool effect and no return row. */
  releaseAllForSpace(spaceId: string): { returnedCounted: number; removedTotal: number } {
    const body = () => {
      const rows = this.rows(spaceId);
      let returnedCounted = 0;
      const nowIso = new Date().toISOString();
      for (const row of rows) {
        const counted = (RELIC_COPY_LIMITS[row.relic_id]?.limit ?? null) !== null && row.test_only === 0;
        if (counted) {
          const toAnchor = nextRelicAnchor(row.relic_id, row.anchor_key);
          this.h.sqlite.prepare(
            `INSERT INTO relic_returns (space_id, relic_id, reason, from_anchor, to_anchor, created_at) VALUES (?, ?, 'brain-deleted', ?, ?, ?)`,
          ).run(spaceId, row.relic_id, row.anchor_key, toAnchor, nowIso);
          returnedCounted++;
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

  recentDepartures(spaceId: string, limit = 5): RelicReturnView[] {
    const rows = this.h.sqlite.prepare(`SELECT * FROM relic_returns WHERE space_id = ? ORDER BY id DESC LIMIT ?`).all(spaceId, limit) as
      { relic_id: string; reason: string; from_anchor: string | null; to_anchor: string | null }[];
    return rows.map((r) => ({
      relicId: r.relic_id, name: RELIC_BY_ID.get(r.relic_id)?.name ?? r.relic_id,
      reason: r.reason === "brain-deleted" ? "brain-deleted" as const : "release" as const,
      fromAnchor: r.from_anchor, toAnchor: r.to_anchor,
    }));
  }

  gateView(spaceId: string): RelicGateView {
    let openedBefore = false;
    try {
      const row = this.h.sqlite.prepare(`SELECT COUNT(*) AS n FROM travel_journeys WHERE space_id = ? AND destination = 'eternity' AND state = 'arrived'`).get(spaceId) as { n: number };
      openedBefore = row.n > 0;
    } catch { openedBefore = false; }
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
