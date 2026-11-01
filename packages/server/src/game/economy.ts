import { createHash } from "node:crypto";
import {
  BASE_PRICES,
  BELT_NODE_COUNT,
  BELT_NODE_YIELD,
  BUYERS,
  CREDITS_START,
  GAME_GOODS,
  HOLD_CAPACITY,
  NODE_KIND_GOOD,
  RECIPES,
  SIGNAL_NODE_COUNT,
  SIGNAL_NODE_YIELD,
  WRECKS_PER_DAY,
  WRECK_YIELD_MAX,
  WRECK_YIELD_MIN,
  buyerById,
  isGameBuyerId,
  isGameGood,
  postedPrice,
  recipeById,
  type GameBuyerId,
  type GameGood,
  type GameNodeKind,
} from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { getPreferences, DEFAULT_PREFS } from "../agent/notify/policy.js";
import { localDayBoundsForDate, localDayInZone } from "../lib/time.js";

/**
 * G1 "The Hold" — the Credits economy service (requirements v0.2.1,
 * signed off 2026-10-29 with conditions C1–C3; architecture invariants
 * I-1..I-11 from the D-02/D-05 note apply to every rule here).
 *
 * go out → gather → haul home → sell or refine → get paid in Credits.
 *
 * O-1 WALL: Credits are a SEPARATE ledger beside Fuel. This module never
 * reads or writes `space_meta.fuel`, never imports the fuel EconomyRepo,
 * and exposes no conversion in either direction. Fuel stays travel
 * energy only.
 *
 * Every mutating action runs the architecture's one shape:
 *   validate against CURRENT server state → ONE BEGIN IMMEDIATE
 *   transaction (re-check preconditions → mutate holdings → append
 *   ledger rows → store the result under the idempotency key) → COMMIT
 *   all of it, or ROLLBACK none of it (I-2). A retry returns the stored
 *   result and changes nothing (I-3); the same key with different
 *   arguments is rejected. Prices, yields, and outcomes are computed
 *   server-side only — a request carries intent and arguments, never a
 *   price or a balance (I-1, I-5). Guests can never mutate (TX-AC-13).
 */

export type GameActorKind = "owner" | "guest" | "npc" | "system";

export interface GameEconomyOptions {
  /** Server clock seam (tests travel across day boundaries with it).
   *  Server time is the only time (I-8); clients never supply it. */
  now?: () => number;
  /**
   * Failure-injection seam (TX-AC-01 crash-point tests): called INSIDE
   * the transaction, after all mutations and ledger writes, just before
   * commit. If it throws, the transaction rolls back — no half-moved
   * sale, no payment without cargo movement, no stored result — and a
   * retry with the same idempotency key executes cleanly, once.
   */
  beforeCommit?: (action: string) => void;
}

export type GameActionError =
  | "guest_cannot_mutate"
  | "idempotency_key_required"
  | "idempotency_key_misuse"
  | "invalid_quantity"
  | "invalid_good"
  | "invalid_buyer"
  | "invalid_recipe"
  | "invalid_node"
  | "unknown_node"
  | "node_empty"
  | "hold_full"
  | "not_docked"
  | "buyer_does_not_buy"
  | "demand_exhausted"
  | "insufficient_cargo"
  | "insufficient_storage"
  | "insufficient_inputs"
  | "insufficient_credits";

export interface GameFailure {
  ok: false;
  error: GameActionError;
  message: string;
}

export interface GatherResult {
  ok: true;
  action: "gather";
  nodeId: string;
  good: GameGood;
  /** Units actually gathered (may be less than the node's remainder when
   *  the hold fills — §4: the result states both numbers plainly). */
  gathered: number;
  /** Units left in the node after this gather. Nothing is silently voided. */
  leftInNode: number;
  cargoQty: number;
  holdUsed: number;
  holdCapacity: number;
  replayed: boolean;
}

export interface SellResult {
  ok: true;
  action: "sell";
  buyerId: GameBuyerId;
  good: GameGood;
  offered: number;
  /** Units the buyer purchased (premium-capped per §5/R3). */
  accepted: number;
  /** Units explicitly declined — they stay in cargo (R3). */
  declined: number;
  /** The unit price actually applied (G1-AC-11): the server's posted
   *  price at commit time, by construction the posted price. */
  unitPrice: number;
  totalCredits: number;
  creditsBalance: number;
  /** Premium demand left for this (buyer, good) in the current period;
   *  null for the Exchange (unlimited floor). */
  demandRemaining: number | null;
  replayed: boolean;
}

export interface RefineResult {
  ok: true;
  action: "refine";
  recipeId: string;
  output: GameGood;
  outputQty: number;
  /** Inputs consumed, per good (storage first, then cargo — both are at
   *  the Station while docked). */
  inputsConsumed: Partial<Record<GameGood, number>>;
  feeCredits: number;
  creditsBalance: number;
  replayed: boolean;
}

export interface TransferResult {
  ok: true;
  action: "transfer";
  direction: "to-storage" | "to-cargo";
  good: GameGood;
  qty: number;
  cargoQty: number;
  storageQty: number;
  replayed: boolean;
}

export type GameActionResult = GatherResult | SellResult | RefineResult | TransferResult;

export interface GamePeriod {
  periodStartMs: number;
  periodEndMs: number;
  /** The period's local calendar date in the timezone that opened it. */
  localDate: string;
  timezone: string;
}

export interface GameNodeView {
  nodeId: string;
  kind: GameNodeKind;
  good: GameGood;
  capacity: number;
  remaining: number;
}

export interface BuyersGuideEntry {
  buyerId: GameBuyerId;
  name: string;
  location: string;
  good: GameGood;
  /** Posted price for this (buyer, good) — server state, never client copy. */
  unitPrice: number;
  /** Premium demand remaining this period; null = unlimited (Exchange). */
  demandRemaining: number | null;
  demandCap: number | null;
}

export interface GameStateView {
  credits: number;
  cargo: Record<GameGood, number>;
  storage: Record<GameGood, number>;
  holdUsed: number;
  holdCapacity: number;
  docked: boolean;
  period: GamePeriod;
  nodes: GameNodeView[];
}

/** Per-action quantity cap (I-7): integer amounts only, bounded so an
 *  absurd quantity is rejected at validation, not merely by balance. */
export const GAME_ACTION_QTY_CAP = 1_000_000;

function fail(error: GameActionError, message: string): GameFailure {
  return { ok: false, error, message };
}

function validQty(qty: unknown): qty is number {
  return (
    typeof qty === "number" &&
    Number.isInteger(qty) &&
    qty > 0 &&
    qty <= GAME_ACTION_QTY_CAP &&
    Number.isSafeInteger(qty)
  );
}

function argsHash(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

/** Deterministic per-(space, period, index) wreck yield in
 *  [WRECK_YIELD_MIN, WRECK_YIELD_MAX] — rotation regenerates the same set
 *  if it is ever re-derived for the same period, never a new roll. */
function wreckYield(spaceId: string, periodStartMs: number, idx: number): number {
  const h = createHash("sha256").update(`wreck:${spaceId}:${periodStartMs}:${idx}`).digest();
  const n = h.readUInt32BE(0);
  return WRECK_YIELD_MIN + (n % (WRECK_YIELD_MAX - WRECK_YIELD_MIN + 1));
}

interface PeriodRow {
  period_start_ms: number;
  period_end_ms: number;
  local_date: string;
  timezone: string;
}

interface NodeRow {
  node_id: string;
  kind: GameNodeKind;
  good_id: GameGood;
  capacity: number;
  remaining: number;
  period_start_ms: number;
}

export class GameEconomy {
  private readonly nowFn: () => number;
  private readonly beforeCommit?: (action: string) => void;

  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
    opts: GameEconomyOptions = {},
  ) {
    this.nowFn = opts.now ?? (() => Date.now());
    this.beforeCommit = opts.beforeCommit;
  }

  /* ------------------------------------------------------------ *
   * Small state helpers (all space-scoped; called inside txns).  *
   * ------------------------------------------------------------ */

  private spaceTimezone(): string {
    try {
      return getPreferences(this.h.sqlite, this.spaceId).timezone;
    } catch {
      return DEFAULT_PREFS.timezone;
    }
  }

  private ensureCreditsRow(): void {
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO game_credits (space_id, balance) VALUES (?, ?)`)
      .run(this.spaceId, CREDITS_START);
  }

  /** The committed Credits balance. Credits ONLY — the fuel balance
   *  lives in an entirely different store and is never read here
   *  (O-1 wall). */
  creditsBalance(): number {
    this.ensureCreditsRow();
    const row = this.h.sqlite
      .prepare(`SELECT balance FROM game_credits WHERE space_id = ?`)
      .get(this.spaceId) as { balance: number } | undefined;
    return row?.balance ?? CREDITS_START;
  }

  private setCredits(balance: number): void {
    this.ensureCreditsRow();
    this.h.sqlite
      .prepare(
        `UPDATE game_credits SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE space_id = ?`,
      )
      .run(balance, this.spaceId);
  }

  private cargoQty(good: GameGood): number {
    const row = this.h.sqlite
      .prepare(`SELECT qty FROM game_cargo WHERE space_id = ? AND good_id = ?`)
      .get(this.spaceId, good) as { qty: number } | undefined;
    return row?.qty ?? 0;
  }

  private storageQty(good: GameGood): number {
    const row = this.h.sqlite
      .prepare(`SELECT qty FROM game_storage WHERE space_id = ? AND good_id = ?`)
      .get(this.spaceId, good) as { qty: number } | undefined;
    return row?.qty ?? 0;
  }

  /**
   * Apply a signed delta to a goods row. Update-first, insert on miss:
   * the natural UPSERT form (INSERT … ON CONFLICT DO UPDATE SET qty =
   * qty + excluded.qty) cannot carry a negative delta — SQLite checks
   * the proposed row's CHECK (qty >= 0) BEFORE conflict resolution, so
   * every debit would fail. Here a debit against a missing row reaches
   * the INSERT with its negative value and the CHECK fires loudly, and
   * a debit that overdraws an existing row fails its UPDATE the same
   * way — the constraint stays the backstop (I-7), never a formality.
   */
  private addTo(table: "game_cargo" | "game_storage", good: GameGood, delta: number): void {
    const upd = this.h.sqlite
      .prepare(`UPDATE ${table} SET qty = qty + ? WHERE space_id = ? AND good_id = ?`)
      .run(delta, this.spaceId, good);
    if (upd.changes === 0) {
      this.h.sqlite
        .prepare(`INSERT INTO ${table} (space_id, good_id, qty) VALUES (?, ?, ?)`)
        .run(this.spaceId, good, delta);
    }
  }

  private addCargo(good: GameGood, delta: number): void {
    this.addTo("game_cargo", good, delta);
  }

  private addStorage(good: GameGood, delta: number): void {
    this.addTo("game_storage", good, delta);
  }

  private holdUsed(): number {
    const row = this.h.sqlite
      .prepare(`SELECT COALESCE(SUM(qty), 0) AS used FROM game_cargo WHERE space_id = ?`)
      .get(this.spaceId) as { used: number };
    return row.used;
  }

  private goodsMap(table: "game_cargo" | "game_storage"): Record<GameGood, number> {
    const out = Object.fromEntries(GAME_GOODS.map((g) => [g, 0])) as Record<GameGood, number>;
    const rows = this.h.sqlite
      .prepare(`SELECT good_id, qty FROM ${table} WHERE space_id = ?`)
      .all(this.spaceId) as Array<{ good_id: GameGood; qty: number }>;
    for (const r of rows) if (isGameGood(r.good_id)) out[r.good_id] = r.qty;
    return out;
  }

  isDocked(): boolean {
    const row = this.h.sqlite
      .prepare(`SELECT docked FROM game_dock_state WHERE space_id = ?`)
      .get(this.spaceId) as { docked: number } | undefined;
    return row?.docked === 1;
  }

  private appendLedger(entry: {
    kind: string;
    good?: GameGood | null;
    qtyDelta?: number;
    creditsDelta?: number;
    balanceAfter: number;
    buyerId?: string | null;
    unitPrice?: number | null;
    recipeId?: string | null;
    nodeId?: string | null;
    idempotencyKey?: string | null;
    actorKind: GameActorKind;
  }): void {
    this.h.sqlite
      .prepare(
        `INSERT INTO game_ledger
           (space_id, kind, good_id, qty_delta, credits_delta, balance_after,
            buyer_id, unit_price, recipe_id, node_id, idempotency_key, actor_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.spaceId,
        entry.kind,
        entry.good ?? null,
        entry.qtyDelta ?? 0,
        entry.creditsDelta ?? 0,
        entry.balanceAfter,
        entry.buyerId ?? null,
        entry.unitPrice ?? null,
        entry.recipeId ?? null,
        entry.nodeId ?? null,
        entry.idempotencyKey ?? null,
        entry.actorKind,
      );
  }

  /* ------------------------------------------------------------ *
   * Periods (§5/R2) and node supply (§7).                        *
   * ------------------------------------------------------------ */

  /**
   * The space's current demand/supply period. When a period opens, its
   * start and end instants are computed from the timezone THEN in effect
   * and STORED with the period (game_periods). A later timezone change
   * never reopens, extends, or shortens the active period — it applies
   * from the next period onward (G1-AC-16).
   */
  private currentPeriod(nowMs: number): GamePeriod {
    const row = this.h.sqlite
      .prepare(
        `SELECT period_start_ms, period_end_ms, local_date, timezone FROM game_periods
          WHERE space_id = ? AND period_start_ms <= ? AND period_end_ms > ?
          ORDER BY period_start_ms DESC LIMIT 1`,
      )
      .get(this.spaceId, nowMs, nowMs) as PeriodRow | undefined;
    if (row) {
      return {
        periodStartMs: row.period_start_ms,
        periodEndMs: row.period_end_ms,
        localDate: row.local_date,
        timezone: row.timezone,
      };
    }
    const tz = this.spaceTimezone();
    const localDate = localDayInZone(nowMs, tz);
    const { startMs, endMs } = localDayBoundsForDate(localDate, tz);
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO game_periods (space_id, period_start_ms, period_end_ms, local_date, timezone)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(this.spaceId, startMs, endMs, localDate, tz);
    return { periodStartMs: startMs, periodEndMs: endMs, localDate, timezone: tz };
  }

  /**
   * Bring node supply into the current period (lazy, server-run — I-5):
   * belt/signal nodes refill to full at the period boundary; wreck sites
   * ROTATE — yesterday's uncollected wrecks are replaced by a fresh set
   * with new site ids. Rotation touches only uncollected node supply,
   * never a holding (I-10, G1-R4).
   */
  private syncNodes(period: GamePeriod): void {
    const s = this.h.sqlite;
    for (let i = 1; i <= BELT_NODE_COUNT; i++) {
      s.prepare(
        `INSERT OR IGNORE INTO game_resource_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES (?, ?, 'belt', ?, ?, ?, ?)`,
      ).run(this.spaceId, `belt-${i}`, NODE_KIND_GOOD.belt, BELT_NODE_YIELD, BELT_NODE_YIELD, period.periodStartMs);
    }
    for (let i = 1; i <= SIGNAL_NODE_COUNT; i++) {
      s.prepare(
        `INSERT OR IGNORE INTO game_resource_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES (?, ?, 'signal', ?, ?, ?, ?)`,
      ).run(this.spaceId, `signal-${i}`, NODE_KIND_GOOD.signal, SIGNAL_NODE_YIELD, SIGNAL_NODE_YIELD, period.periodStartMs);
    }
    // Renewable refill: any belt/signal row from an older period tops back up.
    s.prepare(
      `UPDATE game_resource_nodes SET remaining = capacity, period_start_ms = ?
        WHERE space_id = ? AND kind IN ('belt','signal') AND period_start_ms != ?`,
    ).run(period.periodStartMs, this.spaceId, period.periodStartMs);
    // Wreck rotation: drop prior periods' uncollected sites, seed this
    // period's fresh set (deterministic yields — re-deriving is stable).
    s.prepare(
      `DELETE FROM game_resource_nodes WHERE space_id = ? AND kind = 'wreck' AND period_start_ms != ?`,
    ).run(this.spaceId, period.periodStartMs);
    const existing = s
      .prepare(
        `SELECT COUNT(*) AS c FROM game_resource_nodes WHERE space_id = ? AND kind = 'wreck' AND period_start_ms = ?`,
      )
      .get(this.spaceId, period.periodStartMs) as { c: number };
    if (existing.c === 0) {
      for (let i = 1; i <= WRECKS_PER_DAY; i++) {
        const yieldQty = wreckYield(this.spaceId, period.periodStartMs, i);
        s.prepare(
          `INSERT INTO game_resource_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
           VALUES (?, ?, 'wreck', ?, ?, ?, ?)`,
        ).run(
          this.spaceId,
          `wreck-${period.periodStartMs}-${i}`,
          NODE_KIND_GOOD.wreck,
          yieldQty,
          yieldQty,
          period.periodStartMs,
        );
      }
    }
  }

  private listNodes(): GameNodeView[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT node_id, kind, good_id, capacity, remaining, period_start_ms
           FROM game_resource_nodes WHERE space_id = ? ORDER BY node_id`,
      )
      .all(this.spaceId) as NodeRow[];
    return rows.map((r) => ({
      nodeId: r.node_id,
      kind: r.kind,
      good: r.good_id,
      capacity: r.capacity,
      remaining: r.remaining,
    }));
  }

  private demandUsed(period: GamePeriod, buyerId: GameBuyerId, good: GameGood): number {
    const row = this.h.sqlite
      .prepare(
        `SELECT used FROM game_demand WHERE space_id = ? AND period_start_ms = ? AND buyer_id = ? AND good_id = ?`,
      )
      .get(this.spaceId, period.periodStartMs, buyerId, good) as { used: number } | undefined;
    return row?.used ?? 0;
  }

  private demandRemaining(period: GamePeriod, buyerId: GameBuyerId, good: GameGood): number | null {
    const buyer = buyerById(buyerId);
    if (!buyer || buyer.dailyDemandCap === null) return null;
    return Math.max(0, buyer.dailyDemandCap - this.demandUsed(period, buyerId, good));
  }

  /* ------------------------------------------------------------ *
   * The idempotent transaction shell (I-2, I-3).                 *
   * ------------------------------------------------------------ */

  private runAction<T extends GameActionResult>(
    action: string,
    idempotencyKey: string | undefined,
    args: unknown,
    actorKind: GameActorKind,
    fn: () => T | GameFailure,
  ): T | GameFailure {
    if (actorKind === "guest") {
      return fail("guest_cannot_mutate", "Guests can look and talk, never trade — this action changes nothing.");
    }
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 200) {
      return fail("idempotency_key_required", "Every economy action needs a client-generated idempotency key.");
    }
    const hash = argsHash(args);
    const run = this.h.sqlite.transaction((): T | GameFailure => {
      const existing = this.h.sqlite
        .prepare(
          `SELECT args_hash, result_json FROM game_action_results
            WHERE space_id = ? AND action = ? AND idempotency_key = ?`,
        )
        .get(this.spaceId, action, idempotencyKey) as { args_hash: string; result_json: string } | undefined;
      if (existing) {
        if (existing.args_hash !== hash) {
          // TX-AC-03: same key, different arguments — reject, change nothing.
          throw new IdempotencyMisuse();
        }
        const stored = JSON.parse(existing.result_json) as T;
        return { ...stored, replayed: true };
      }
      const result = fn();
      if (!result.ok) return result; // a refusal commits nothing and stores nothing
      this.beforeCommit?.(action); // TX-AC-01 crash-point seam: a throw here rolls EVERYTHING back
      this.h.sqlite
        .prepare(
          `INSERT INTO game_action_results (space_id, action, idempotency_key, args_hash, result_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(this.spaceId, action, idempotencyKey, hash, JSON.stringify(result));
      return result;
    });
    try {
      return run.immediate();
    } catch (e) {
      if (e instanceof IdempotencyMisuse) {
        return fail(
          "idempotency_key_misuse",
          "This idempotency key was already used with different arguments — the original transaction stands; nothing changed.",
        );
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------ *
   * Dock state (station services require docked — §3/§4/§5).     *
   * ------------------------------------------------------------ */

  dock(actorKind: GameActorKind = "owner"): { ok: true; docked: true } | GameFailure {
    if (actorKind === "guest") {
      return fail("guest_cannot_mutate", "Guests can look and talk, never trade — this action changes nothing.");
    }
    this.h.sqlite
      .prepare(
        `INSERT INTO game_dock_state (space_id, docked) VALUES (?, 1)
         ON CONFLICT(space_id) DO UPDATE SET docked = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(this.spaceId);
    return { ok: true, docked: true };
  }

  undock(actorKind: GameActorKind = "owner"): { ok: true; docked: false } | GameFailure {
    if (actorKind === "guest") {
      return fail("guest_cannot_mutate", "Guests can look and talk, never trade — this action changes nothing.");
    }
    this.h.sqlite
      .prepare(
        `INSERT INTO game_dock_state (space_id, docked) VALUES (?, 0)
         ON CONFLICT(space_id) DO UPDATE SET docked = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(this.spaceId);
    return { ok: true, docked: false };
  }

  private requireDocked(): GameFailure | null {
    return this.isDocked()
      ? null
      : fail("not_docked", "This is a Station service — dock at the Great Station first.");
  }

  /* ------------------------------------------------------------ *
   * Actions.                                                     *
   * ------------------------------------------------------------ */

  /**
   * Gather from a resource node (§4, §7): fills up to remaining hold
   * capacity; the remainder STAYS in the node and both numbers are
   * reported. The yield is the server's node state — the client asserts
   * nothing (I-5). Concurrent gathers serialize on BEGIN IMMEDIATE and
   * the conditional decrement can never take a node below zero (I-6).
   */
  gather(
    input: { nodeId: unknown; idempotencyKey?: string; actorKind?: GameActorKind },
  ): GatherResult | GameFailure {
    const actorKind = input.actorKind ?? "owner";
    return this.runAction("gather", input.idempotencyKey, { nodeId: input.nodeId }, actorKind, () => {
      if (typeof input.nodeId !== "string" || input.nodeId.length === 0 || input.nodeId.length > 200) {
        return fail("invalid_node", "A gather needs the id of a resource node.");
      }
      const nowMs = this.nowFn();
      const period = this.currentPeriod(nowMs);
      this.syncNodes(period);
      const node = this.h.sqlite
        .prepare(
          `SELECT node_id, kind, good_id, capacity, remaining, period_start_ms
             FROM game_resource_nodes WHERE space_id = ? AND node_id = ?`,
        )
        .get(this.spaceId, input.nodeId) as NodeRow | undefined;
      if (!node) {
        return fail("unknown_node", "No such resource node in this space — nothing gathered.");
      }
      if (node.remaining <= 0) {
        return fail("node_empty", "This node is depleted — it refills at the local day boundary.");
      }
      const used = this.holdUsed();
      const free = HOLD_CAPACITY - used;
      if (free <= 0) {
        return fail("hold_full", `The hold is full (${HOLD_CAPACITY} units) — the node's ${node.remaining} units stay in the node.`);
      }
      const gathered = Math.min(node.remaining, free);
      const upd = this.h.sqlite
        .prepare(
          `UPDATE game_resource_nodes SET remaining = remaining - ?
            WHERE space_id = ? AND node_id = ? AND remaining >= ?`,
        )
        .run(gathered, this.spaceId, node.node_id, gathered);
      if (upd.changes !== 1) {
        return fail("node_empty", "This node was just depleted — nothing gathered.");
      }
      this.addCargo(node.good_id, gathered);
      this.appendLedger({
        kind: "gather",
        good: node.good_id,
        qtyDelta: gathered,
        creditsDelta: 0,
        balanceAfter: this.creditsBalance(),
        nodeId: node.node_id,
        idempotencyKey: input.idempotencyKey ?? null,
        actorKind,
      });
      return {
        ok: true,
        action: "gather",
        nodeId: node.node_id,
        good: node.good_id,
        gathered,
        leftInNode: node.remaining - gathered,
        cargoQty: this.cargoQty(node.good_id),
        holdUsed: used + gathered,
        holdCapacity: HOLD_CAPACITY,
        replayed: false,
      } satisfies GatherResult;
    });
  }

  /**
   * Sell cargo to a Station buyer at the FIXED posted price (§5).
   * Premium buyers pay premium only up to their remaining daily demand:
   * the accepted portion is paid, the declined portion stays in cargo,
   * and both portions are reported (R3). Payment, cargo decrement,
   * demand consumption, and the ledger row commit together or not at
   * all. The Exchange's demand is unlimited — the floor always buys.
   */
  sell(
    input: { buyerId: unknown; good: unknown; qty: unknown; idempotencyKey?: string; actorKind?: GameActorKind },
  ): SellResult | GameFailure {
    const actorKind = input.actorKind ?? "owner";
    return this.runAction(
      "sell",
      input.idempotencyKey,
      { buyerId: input.buyerId, good: input.good, qty: input.qty },
      actorKind,
      () => {
        if (!isGameBuyerId(input.buyerId)) {
          return fail("invalid_buyer", "No such buyer — sales happen at the five Station buyers.");
        }
        if (!isGameGood(input.good)) {
          return fail("invalid_good", "No such good — G1 trades ore, salvage, data, component, circuit.");
        }
        if (!validQty(input.qty)) {
          return fail("invalid_quantity", "Quantity must be a positive integer within the per-action cap.");
        }
        const buyerId = input.buyerId;
        const good = input.good;
        const qty = input.qty;
        const docked = this.requireDocked();
        if (docked) return docked;
        const price = postedPrice(buyerId, good);
        if (price === null) {
          return fail(
            "buyer_does_not_buy",
            `${buyerById(buyerId)?.name ?? buyerId} does not buy ${good} — the Station Exchange buys every good at base price.`,
          );
        }
        const inCargo = this.cargoQty(good);
        if (inCargo < qty) {
          return fail("insufficient_cargo", `The hold carries ${inCargo} ${good} — cannot sell ${qty}. Nothing was sold.`);
        }
        const nowMs = this.nowFn();
        const period = this.currentPeriod(nowMs);
        const buyer = buyerById(buyerId)!;
        let accepted = qty;
        if (buyer.dailyDemandCap !== null) {
          const remaining = this.demandRemaining(period, buyerId, good) ?? 0;
          accepted = Math.min(qty, remaining);
          if (accepted <= 0) {
            return fail(
              "demand_exhausted",
              `${buyer.name}'s premium demand for ${good} is used up for today — the Station Exchange still buys at base price (${BASE_PRICES[good]} Credits).`,
            );
          }
          this.h.sqlite
            .prepare(
              `INSERT INTO game_demand (space_id, period_start_ms, buyer_id, good_id, used) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(space_id, period_start_ms, buyer_id, good_id) DO UPDATE SET used = used + excluded.used`,
            )
            .run(this.spaceId, period.periodStartMs, buyerId, good, accepted);
        }
        const total = accepted * price;
        this.addCargo(good, -accepted);
        const balance = this.creditsBalance() + total;
        this.setCredits(balance);
        this.appendLedger({
          kind: "sale",
          good,
          qtyDelta: -accepted,
          creditsDelta: total,
          balanceAfter: balance,
          buyerId,
          unitPrice: price,
          idempotencyKey: input.idempotencyKey ?? null,
          actorKind,
        });
        return {
          ok: true,
          action: "sell",
          buyerId,
          good,
          offered: qty,
          accepted,
          declined: qty - accepted,
          unitPrice: price,
          totalCredits: total,
          creditsBalance: balance,
          demandRemaining: this.demandRemaining(period, buyerId, good),
          replayed: false,
        } satisfies SellResult;
      },
    );
  }

  /**
   * Refine at the Station refinery (§3): INSTANT, one atomic transaction
   * per refine — inputs consumed and output produced together, fee
   * deducted in the same transaction; if the fee cannot be paid, NOTHING
   * is consumed (G1-AC-04). Recipes are server-side data (shared
   * constants); the client displays them, never defines them.
   */
  refine(
    input: { recipeId: unknown; count?: unknown; idempotencyKey?: string; actorKind?: GameActorKind },
  ): RefineResult | GameFailure {
    const actorKind = input.actorKind ?? "owner";
    const count = input.count === undefined ? 1 : input.count;
    return this.runAction(
      "refine",
      input.idempotencyKey,
      { recipeId: input.recipeId, count },
      actorKind,
      () => {
        if (typeof input.recipeId !== "string" || !recipeById(input.recipeId)) {
          return fail("invalid_recipe", "No such recipe — the refinery runs R-1 (Component) and R-2 (Circuit).");
        }
        if (!validQty(count)) {
          return fail("invalid_quantity", "Refine count must be a positive integer within the per-action cap.");
        }
        const recipe = recipeById(input.recipeId)!;
        const docked = this.requireDocked();
        if (docked) return docked;
        const fee = recipe.feeCredits * count;
        const balance = this.creditsBalance();
        if (balance < fee) {
          return fail(
            "insufficient_credits",
            `The refinery fee is ${fee} Credits and the balance is ${balance} — nothing was consumed and nothing was produced.`,
          );
        }
        // Check every input BEFORE consuming any (storage + cargo combined).
        const consumed: Partial<Record<GameGood, number>> = {};
        for (const [goodKey, perUnit] of Object.entries(recipe.inputs)) {
          const good = goodKey as GameGood;
          const need = (perUnit ?? 0) * count;
          const have = this.storageQty(good) + this.cargoQty(good);
          if (have < need) {
            return fail(
              "insufficient_inputs",
              `Recipe ${recipe.id} needs ${need} ${good} and this space holds ${have} — nothing was consumed.`,
            );
          }
          consumed[good] = need;
        }
        // Consume: storage first, then cargo (both are at the Station
        // while docked). Output lands in Station storage.
        for (const [goodKey, need] of Object.entries(consumed)) {
          const good = goodKey as GameGood;
          const fromStorage = Math.min(this.storageQty(good), need ?? 0);
          const fromCargo = (need ?? 0) - fromStorage;
          if (fromStorage > 0) this.addStorage(good, -fromStorage);
          if (fromCargo > 0) this.addCargo(good, -fromCargo);
        }
        this.addStorage(recipe.output, count);
        const newBalance = balance - fee;
        this.setCredits(newBalance);
        for (const [goodKey, need] of Object.entries(consumed)) {
          this.appendLedger({
            kind: "refine_input",
            good: goodKey as GameGood,
            qtyDelta: -(need ?? 0),
            creditsDelta: 0,
            balanceAfter: newBalance,
            recipeId: recipe.id,
            idempotencyKey: input.idempotencyKey ?? null,
            actorKind,
          });
        }
        this.appendLedger({
          kind: "refine_output",
          good: recipe.output,
          qtyDelta: count,
          creditsDelta: -fee,
          balanceAfter: newBalance,
          recipeId: recipe.id,
          idempotencyKey: input.idempotencyKey ?? null,
          actorKind,
        });
        return {
          ok: true,
          action: "refine",
          recipeId: recipe.id,
          output: recipe.output,
          outputQty: count,
          inputsConsumed: consumed,
          feeCredits: fee,
          creditsBalance: newBalance,
          replayed: false,
        } satisfies RefineResult;
      },
    );
  }

  /**
   * Cargo ↔ Station storage transfer (§4): only while docked at the
   * Great Station (G1-AC-07). Storage is unlimited and never charged
   * rent (I-10); the hold is capped, so a to-cargo transfer that would
   * overflow the hold is refused whole — nothing is silently voided.
   */
  transfer(
    input: {
      direction: unknown;
      good: unknown;
      qty: unknown;
      idempotencyKey?: string;
      actorKind?: GameActorKind;
    },
  ): TransferResult | GameFailure {
    const actorKind = input.actorKind ?? "owner";
    return this.runAction(
      "transfer",
      input.idempotencyKey,
      { direction: input.direction, good: input.good, qty: input.qty },
      actorKind,
      () => {
        if (input.direction !== "to-storage" && input.direction !== "to-cargo") {
          return fail("invalid_quantity", "Direction must be to-storage or to-cargo.");
        }
        if (!isGameGood(input.good)) {
          return fail("invalid_good", "No such good — G1 trades ore, salvage, data, component, circuit.");
        }
        if (!validQty(input.qty)) {
          return fail("invalid_quantity", "Quantity must be a positive integer within the per-action cap.");
        }
        const docked = this.requireDocked();
        if (docked) return docked;
        const good = input.good;
        const qty = input.qty;
        if (input.direction === "to-storage") {
          if (this.cargoQty(good) < qty) {
            return fail("insufficient_cargo", `The hold carries ${this.cargoQty(good)} ${good} — cannot store ${qty}. Nothing moved.`);
          }
          this.addCargo(good, -qty);
          this.addStorage(good, qty);
          this.appendLedger({
            kind: "transfer_to_storage",
            good,
            qtyDelta: qty,
            creditsDelta: 0,
            balanceAfter: this.creditsBalance(),
            idempotencyKey: input.idempotencyKey ?? null,
            actorKind,
          });
        } else {
          if (this.storageQty(good) < qty) {
            return fail("insufficient_storage", `Station storage holds ${this.storageQty(good)} ${good} — cannot load ${qty}. Nothing moved.`);
          }
          const used = this.holdUsed();
          if (used + qty > HOLD_CAPACITY) {
            return fail(
              "hold_full",
              `The hold has ${HOLD_CAPACITY - used} free units — loading ${qty} ${good} would overflow it. Nothing moved.`,
            );
          }
          this.addStorage(good, -qty);
          this.addCargo(good, qty);
          this.appendLedger({
            kind: "transfer_to_cargo",
            good,
            qtyDelta: qty,
            creditsDelta: 0,
            balanceAfter: this.creditsBalance(),
            idempotencyKey: input.idempotencyKey ?? null,
            actorKind,
          });
        }
        return {
          ok: true,
          action: "transfer",
          direction: input.direction,
          good,
          qty,
          cargoQty: this.cargoQty(good),
          storageQty: this.storageQty(good),
          replayed: false,
        } satisfies TransferResult;
      },
    );
  }

  /* ------------------------------------------------------------ *
   * Reads (server state only — the Guide carries no client copy).*
   * ------------------------------------------------------------ */

  /** Full state view: balances, cargo, storage, dock, period, nodes.
   *  Opening the view lazily opens the current period and syncs supply
   *  (server-run maintenance, in one transaction). */
  getState(): GameStateView {
    const run = this.h.sqlite.transaction((): GameStateView => {
      const period = this.currentPeriod(this.nowFn());
      this.syncNodes(period);
      return {
        credits: this.creditsBalance(),
        cargo: this.goodsMap("game_cargo"),
        storage: this.goodsMap("game_storage"),
        holdUsed: this.holdUsed(),
        holdCapacity: HOLD_CAPACITY,
        docked: this.isDocked(),
        period,
        nodes: this.listNodes(),
      };
    });
    return run.immediate();
  }

  /**
   * The Buyer's Guide (§5): every buyer's posted price and remaining
   * premium demand, derived from server state at render time (G1-AC-12).
   * Every good lists at least one buyer — the Exchange's base route is
   * always present (G1-AC-02).
   */
  buyersGuide(): { period: GamePeriod; entries: BuyersGuideEntry[] } {
    const run = this.h.sqlite.transaction(() => {
      const period = this.currentPeriod(this.nowFn());
      this.syncNodes(period);
      const entries: BuyersGuideEntry[] = [];
      for (const buyer of BUYERS) {
        const goods = buyer.buysAll ? GAME_GOODS : buyer.premiumGoods;
        for (const good of goods) {
          const price = postedPrice(buyer.id, good);
          if (price === null) continue;
          entries.push({
            buyerId: buyer.id,
            name: buyer.name,
            location: buyer.location,
            good,
            unitPrice: price,
            demandRemaining: this.demandRemaining(period, buyer.id, good),
            demandCap: buyer.dailyDemandCap,
          });
        }
      }
      return { period, entries };
    });
    return run.immediate();
  }

  /** Recipe display data (§3): the refinery screen shows inputs, fee,
   *  output, and CURRENT sell values before confirming — all from the
   *  server's constants and posted prices. */
  recipesView(): Array<{
    recipeId: string;
    output: GameGood;
    inputs: Partial<Record<GameGood, number>>;
    feeCredits: number;
    outputBasePrice: number;
    inputsRawBaseValue: number;
  }> {
    return RECIPES.map((r) => ({
      recipeId: r.id,
      output: r.output,
      inputs: r.inputs,
      feeCredits: r.feeCredits,
      outputBasePrice: BASE_PRICES[r.output],
      inputsRawBaseValue: Object.entries(r.inputs).reduce(
        (sum, [g, n]) => sum + BASE_PRICES[g as GameGood] * (n ?? 0),
        0,
      ),
    }));
  }

  /**
   * Credits minted per space-local day, derived from the LEDGER ALONE
   * (§8 instrumentation, G1-AC-10): a day's mint is the sum of positive
   * sale credits (NPC buyer purchases are the only faucet); refinery
   * fees are the sink and are reported separately.
   */
  mintedPerDay(): Array<{ day: string; mintedCredits: number; feesBurned: number }> {
    const tz = this.spaceTimezone();
    const rows = this.h.sqlite
      .prepare(`SELECT kind, credits_delta, created_at FROM game_ledger WHERE space_id = ? ORDER BY id`)
      .all(this.spaceId) as Array<{ kind: string; credits_delta: number; created_at: string }>;
    const byDay = new Map<string, { day: string; mintedCredits: number; feesBurned: number }>();
    for (const r of rows) {
      const ms = Date.parse(r.created_at.includes("T") ? r.created_at : `${r.created_at.replace(" ", "T")}Z`);
      if (!Number.isFinite(ms)) continue;
      const day = localDayInZone(ms, tz);
      const bucket = byDay.get(day) ?? { day, mintedCredits: 0, feesBurned: 0 };
      if (r.kind === "sale" && r.credits_delta > 0) bucket.mintedCredits += r.credits_delta;
      if (r.kind === "refine_output" && r.credits_delta < 0) bucket.feesBurned += -r.credits_delta;
      byDay.set(day, bucket);
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  /**
   * Ledger reconciliation (TX-AC-12): recompute the Credits balance and
   * every good's total holdings (cargo + storage) from the append-only
   * ledger and compare with stored state. A mismatch is REPORTED, never
   * silently corrected (§5 of the architecture).
   */
  reconcile(): {
    ok: boolean;
    credits: { stored: number; computed: number };
    goods: Record<GameGood, { stored: number; computed: number }>;
    discrepancies: string[];
  } {
    const rows = this.h.sqlite
      .prepare(`SELECT kind, good_id, qty_delta, credits_delta FROM game_ledger WHERE space_id = ? ORDER BY id`)
      .all(this.spaceId) as Array<{
      kind: string;
      good_id: GameGood | null;
      qty_delta: number;
      credits_delta: number;
    }>;
    let computedCredits = CREDITS_START;
    const computedGoods = Object.fromEntries(GAME_GOODS.map((g) => [g, 0])) as Record<GameGood, number>;
    for (const r of rows) {
      computedCredits += r.credits_delta;
      if (!r.good_id || !isGameGood(r.good_id)) continue;
      // Transfers move goods between cargo and storage — the TOTAL is
      // unchanged, so they contribute 0 to holdings reconciliation.
      if (r.kind === "transfer_to_storage" || r.kind === "transfer_to_cargo") continue;
      computedGoods[r.good_id] += r.qty_delta;
    }
    const storedCredits = this.creditsBalance();
    const cargo = this.goodsMap("game_cargo");
    const storage = this.goodsMap("game_storage");
    const goods = Object.fromEntries(
      GAME_GOODS.map((g) => [g, { stored: cargo[g] + storage[g], computed: computedGoods[g] }]),
    ) as Record<GameGood, { stored: number; computed: number }>;
    const discrepancies: string[] = [];
    if (storedCredits !== computedCredits) {
      discrepancies.push(`credits: stored ${storedCredits} != ledger-computed ${computedCredits}`);
    }
    for (const g of GAME_GOODS) {
      if (goods[g].stored !== goods[g].computed) {
        discrepancies.push(`${g}: stored ${goods[g].stored} != ledger-computed ${goods[g].computed}`);
      }
    }
    return { ok: discrepancies.length === 0, credits: { stored: storedCredits, computed: computedCredits }, goods, discrepancies };
  }

  /** Raw ledger rows for this space (audit/read surfaces; game data
   *  only — the ledger can carry no memory content, TX-AC-15). */
  ledger(limit = 100): Array<Record<string, unknown>> {
    return this.h.sqlite
      .prepare(`SELECT * FROM game_ledger WHERE space_id = ? ORDER BY id DESC LIMIT ?`)
      .all(this.spaceId, Math.min(Math.max(limit, 1), 1000)) as Array<Record<string, unknown>>;
  }
}

class IdempotencyMisuse extends Error {
  constructor() {
    super("idempotency key reused with different arguments");
  }
}
