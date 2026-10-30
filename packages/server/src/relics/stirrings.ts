/**
 * Relics I-5 — stirrings (implementation design §4.6/§5.4; approved
 * design §3/§4.1). A stirring is the hunt's invitation: a Codex/Inbox
 * entry that promises ONE specific placed copy of a relic. The row is
 * the record; the inbox notification is just how the player hears
 * about it, and its payload is the clue's IDENTITY only (relic +
 * world) — deed text is content (O-R1), resolved at read, and no lore
 * text ships in this increment.
 *
 * Honesty is structural here:
 * - Issuance requires a copy the pool can actually furnish: one
 *   resting placed in the space's scope is bound, else one is
 *   materialized at issuance, else nothing is issued. A stirring
 *   never promises a copy that does not exist.
 * - Resolution is never silent and never a fabrication: `claimed`
 *   when the relic is claimed, `quiet` ("the trail has gone quiet")
 *   when the pool empties beneath it, when the very copy it
 *   promised is claimed by another, or when that copy is no longer
 *   there to claim (the exact-copy follow-up to I-5), `expired`
 *   when its window ends. Expiry is EVALUATED inside serialized
 *   transactions and at read time (§4.6) — there is no background
 *   sweeper.
 * - One open stirring per (space, relic), enforced by the partial
 *   unique index; at most one open AMBIENT stirring per (space,
 *   world) (owner ruling 4). Chart stirrings are exempt from the
 *   ambient cap, never from eligibility.
 */
import {
  RELICS, RELIC_BY_ID, RELIC_ANCHOR_POINTS, RELIC_COPY_LIMITS,
  RELIC_STIRRING_WINDOW_MS, relicCodexKey,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { NotificationsRepo } from "../repositories/notifications.repo.js";
import { RelicHoldingsStore } from "./holdings.js";

export interface StirringRow {
  id: number;
  space_id: string;
  relic_id: string;
  copy_id: string;
  source: string;
  chart_exchange_id: number | null;
  issued_at: string;
  open_until: string;
  state: string;
  resolved_at: string | null;
  resolved_reason: string | null;
}

/** Display words for the worlds a relic can rest in (the inbox line
 *  names the world, as the approved design's stirring does — a world
 *  and a theme, never a location). */
const WORLD_WORDS: Record<string, string> = {
  "great-station": "the Great Station",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  people: "the People",
  scale: "the Scale",
  "quiet-archive": "the Quiet Archive",
};

/** The pool a copy belongs to (mirrors the holdings store's scope rule). */
function scopeFor(relicId: string, spaceId: string): string | null {
  return RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private" ? spaceId : null;
}

export class RelicStirringService {
  private store: RelicHoldingsStore;
  constructor(private h: DbHandle) { this.store = new RelicHoldingsStore(h); }

  /** Join the caller's transaction when one is open (the house
   *  pattern); otherwise run as its own immediate transaction. */
  private run<T>(body: () => T): T {
    if ((this.h.sqlite as { inTransaction?: boolean }).inTransaction) return body();
    return this.h.sqlite.transaction(body).immediate();
  }

  private rowById(id: number): StirringRow | null {
    return (this.h.sqlite.prepare(`SELECT * FROM relic_stirrings WHERE id = ?`).get(id) as StirringRow | undefined) ?? null;
  }

  // ---- expiry: evaluation, never a sweeper (§4.6) --------------------

  private expireWhere(nowMs: number, relicId: string | null): number {
    const nowIso = new Date(nowMs).toISOString();
    const res = relicId === null
      ? this.h.sqlite.prepare(
          `UPDATE relic_stirrings SET state = 'expired', resolved_at = ?, resolved_reason = 'window-ended' WHERE state = 'open' AND open_until <= ?`,
        ).run(nowIso, nowIso)
      : this.h.sqlite.prepare(
          `UPDATE relic_stirrings SET state = 'expired', resolved_at = ?, resolved_reason = 'window-ended' WHERE state = 'open' AND relic_id = ? AND open_until <= ?`,
        ).run(nowIso, relicId, nowIso);
    return Number(res.changes ?? 0);
  }

  /** Resolve every open stirring whose window has ended. */
  evaluateExpiries(nowMs: number = Date.now()): number {
    return this.run(() => this.expireWhere(nowMs, null));
  }

  /** The same evaluation scoped to one relic — run inside claim
   *  transactions, where R2-4 requires an expired stirring to stop
   *  blocking in the same serialization that would have honored it. */
  evaluateExpiriesForRelic(relicId: string, nowMs: number = Date.now()): number {
    return this.run(() => this.expireWhere(nowMs, relicId));
  }

  /** Is any player's stirring for this relic open and unexpired?
   *  (Callers evaluate expiries first.) `onlySpaceId` restricts to
   *  one space's stirrings — the private-pool reading; null reads
   *  across spaces, the global-pool reading the courtesy uses. */
  liveStirringExists(relicId: string, onlySpaceId: string | null): boolean {
    const row = onlySpaceId === null
      ? this.h.sqlite.prepare(`SELECT 1 AS x FROM relic_stirrings WHERE relic_id = ? AND state = 'open'`).get(relicId)
      : this.h.sqlite.prepare(`SELECT 1 AS x FROM relic_stirrings WHERE relic_id = ? AND state = 'open' AND space_id = ?`).get(relicId, onlySpaceId);
    return !!row;
  }

  // ---- issuance (§5.4) ------------------------------------------------

  private issueBody(
    spaceId: string,
    relicId: string,
    source: "ambient" | "chart",
    chartExchangeId: number | null,
    nowMs: number,
  ): StirringRow | null {
    const def = RELIC_BY_ID.get(relicId);
    if (!def || !def.discoverable) return null;
    if ((RELIC_ANCHOR_POINTS[relicId] ?? []).length === 0) return null;
    // Reachability (approved design §4): no stirring may point into
    // Eternity for a space whose gate is not open. (No relic rests in
    // Eternity today; the rule is implemented so a future placement
    // there inherits it rather than bypassing it.)
    if ((def.world as string) === "eternity" && !this.store.gateView(spaceId).open) return null;
    this.evaluateExpiriesForRelic(relicId, nowMs);
    // Personally discovered already — the Codex claim is the record;
    // there is nothing to invite this space toward.
    const discovered = this.h.sqlite.prepare(
      `SELECT 1 AS x FROM codex_claims WHERE space_id = ? AND reward_key = ?`,
    ).get(spaceId, relicCodexKey(relicId));
    if (discovered) return null;
    // One open stirring per (space, relic) — the partial unique index
    // is the backstop; this read keeps the refusal clean.
    const alreadyOpen = this.h.sqlite.prepare(
      `SELECT 1 AS x FROM relic_stirrings WHERE space_id = ? AND relic_id = ? AND state = 'open'`,
    ).get(spaceId, relicId);
    if (alreadyOpen) return null;
    if (source === "ambient") {
      // Ruling 4: at most one open AMBIENT stirring per (space, world).
      const openAmbient = this.h.sqlite.prepare(
        `SELECT relic_id FROM relic_stirrings WHERE space_id = ? AND source = 'ambient' AND state = 'open'`,
      ).all(spaceId) as { relic_id: string }[];
      if (openAmbient.some((r) => RELIC_BY_ID.get(r.relic_id)?.world === def.world)) return null;
    }
    // The promise must be a real copy: bind one resting placed in
    // scope, or materialize one — or do not issue at all.
    const placed = this.store.ensurePlacedCopyInScope(relicId, scopeFor(relicId, spaceId), spaceId);
    if (!placed) return null;
    const openUntil = new Date(nowMs + RELIC_STIRRING_WINDOW_MS).toISOString();
    const res = this.h.sqlite.prepare(
      `INSERT INTO relic_stirrings (space_id, relic_id, copy_id, source, chart_exchange_id, open_until) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(spaceId, relicId, placed.copyId, source, chartExchangeId, openUntil);
    const id = Number(res.lastInsertRowid);
    // L0 unlock at issuance (§4.4's write point, source='stirring').
    this.h.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_codex_layers (space_id, relic_id, layer, thread_id, source) VALUES (?, ?, 'L0', '', 'stirring')`,
    ).run(spaceId, relicId);
    // Delivery: the Commissions inbox, dedupe-keyed to this stirring.
    // The row persists under the inbox's own retention — the delivery
    // does not expire when the stirring's state does.
    new NotificationsRepo(this.h, spaceId).record({
      source: "relic-stirring",
      text: `A stirring — something of the ${def.name} is astir in ${WORLD_WORDS[def.world] ?? def.world}. Your Codex has noted it.`,
      icon: "✦",
      dedupeKey: `stirring:${id}`,
    });
    return this.rowById(id);
  }

  /**
   * Issue a stirring for (space, relic). Returns the stored row, or
   * null when the relic is ineligible for this space right now
   * (undiscoverable, unplaced, already discovered, already stirred,
   * capped, or the pool cannot furnish a copy to promise).
   */
  issue(
    spaceId: string,
    relicId: string,
    source: "ambient" | "chart",
    opts: { chartExchangeId?: number; nowMs?: number } = {},
  ): StirringRow | null {
    return this.run(() => this.issueBody(spaceId, relicId, source, opts.chartExchangeId ?? null, opts.nowMs ?? Date.now()));
  }

  /**
   * The arrival evaluation (§5.4): at most one ambient stirring per
   * (space, world) — the first eligible relic of the world, in
   * registry order. Called from the NPC daily loop for the world the
   * space currently stands in. Pool-change re-eligibility falls out
   * of evaluating afresh each tick: a quiet-resolved (space, relic)
   * whose copy has returned can be stirred again on a later tick;
   * nothing is ever pushed instantly.
   */
  evaluateAmbientForWorld(spaceId: string, world: string, nowMs: number = Date.now()): StirringRow | null {
    return this.run(() => {
      this.evaluateExpiries(nowMs);
      for (const def of RELICS) {
        if (def.world !== world) continue;
        const issued = this.issueBody(spaceId, def.id, "ambient", null, nowMs);
        if (issued) return issued;
      }
      return null;
    });
  }

  // ---- reads (expiry evaluated at read time, §4.6) --------------------

  forSpace(spaceId: string): StirringRow[] {
    return this.run(() => {
      this.evaluateExpiries();
      return this.h.sqlite.prepare(
        `SELECT * FROM relic_stirrings WHERE space_id = ? ORDER BY id ASC`,
      ).all(spaceId) as StirringRow[];
    });
  }

  openFor(spaceId: string, relicId: string): StirringRow | null {
    return this.run(() => {
      this.evaluateExpiriesForRelic(relicId);
      return (this.h.sqlite.prepare(
        `SELECT * FROM relic_stirrings WHERE space_id = ? AND relic_id = ? AND state = 'open'`,
      ).get(spaceId, relicId) as StirringRow | undefined) ?? null;
    });
  }

  // ---- resolution inside the claim transaction (§5.2 step 5) ----------

  /**
   * Resolve stirrings after a PLAYER claim of this relic. THE
   * CALLER OWNS THE TRANSACTION (the claim's award transaction) —
   * this method only writes. The claimer's own open stirring
   * resolves `claimed` on an award; when the pool's claimable
   * supply has reached zero, every remaining open stirring for the
   * relic resolves `quiet` — across spaces for a global pool (they
   * were all hunting the same copies), the claimer's own included
   * when the claim itself found the pool already empty. Private
   * pools have no cross-space others by construction.
   */
  resolveAfterPlayerClaim(spaceId: string, relicId: string, awarded: boolean): void {
    this.evaluateExpiriesForRelic(relicId);
    const nowIso = new Date().toISOString();
    if (awarded) {
      this.h.sqlite.prepare(
        `UPDATE relic_stirrings SET state = 'claimed', resolved_at = ?, resolved_reason = 'claimed' WHERE space_id = ? AND relic_id = ? AND state = 'open'`,
      ).run(nowIso, spaceId, relicId);
    }
    const limit = RELIC_COPY_LIMITS[relicId]?.limit ?? null;
    if (limit !== null) {
      if (this.store.claimableSupply(relicId, null) === 0) {
        this.h.sqlite.prepare(
          `UPDATE relic_stirrings SET state = 'quiet', resolved_at = ?, resolved_reason = 'pool-emptied' WHERE relic_id = ? AND state = 'open'`,
        ).run(nowIso, relicId);
      }
    } else if (!awarded) {
      // Private class: the only pool at stake is the claimer's own scope.
      if (this.store.claimableSupply(relicId, spaceId) === 0) {
        this.h.sqlite.prepare(
          `UPDATE relic_stirrings SET state = 'quiet', resolved_at = ?, resolved_reason = 'pool-emptied' WHERE space_id = ? AND relic_id = ? AND state = 'open'`,
        ).run(nowIso, spaceId, relicId);
      }
    }
  }

  /** Quiet every open stirring promising one copy. THE CALLER OWNS
   *  THE TRANSACTION (the award transaction) — this method only
   *  writes, like resolveAfterPlayerClaim. `exceptSpaceId` spares
   *  one space's stirring (the claimer's own, which resolves
   *  `claimed` by the (space, relic) update); null spares none. */
  private quietByCopy(copyId: string, exceptSpaceId: string | null, reason: string): void {
    const nowIso = new Date().toISOString();
    if (exceptSpaceId === null) {
      this.h.sqlite.prepare(
        `UPDATE relic_stirrings SET state = 'quiet', resolved_at = ?, resolved_reason = ? WHERE copy_id = ? AND state = 'open'`,
      ).run(nowIso, reason, copyId);
    } else {
      this.h.sqlite.prepare(
        `UPDATE relic_stirrings SET state = 'quiet', resolved_at = ?, resolved_reason = ? WHERE copy_id = ? AND state = 'open' AND space_id != ?`,
      ).run(nowIso, reason, copyId, exceptSpaceId);
    }
  }

  /**
   * The exact-copy promise (approved design §3, follow-up to I-5):
   * a copy can be promised to several spaces at once (the global
   * pool's one resting copy is every hunter's trail), so the moment
   * ANY claim — player or NPC — awards it, every OTHER space's open
   * stirring for that copy resolves `quiet`: the trail they were
   * following has ended, honestly and at the moment it ended, not
   * whenever the pool later happens to empty.
   */
  resolveCopyClaimed(copyId: string, claimerSpaceId: string | null): void {
    this.quietByCopy(copyId, claimerSpaceId, "copy-claimed");
  }

  /**
   * The promised copy is no longer placed when its holder comes to
   * claim (held by another through a path that carried no stirring
   * resolution, waiting in the return pool, or gone): every open
   * stirring promising it resolves `quiet` at that claim attempt —
   * the promise is over for everyone it was made to.
   */
  resolveCopyGone(copyId: string): void {
    this.quietByCopy(copyId, null, "copy-gone");
  }
}
