import { createHash } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDayBoundsForDate, localDayInZone } from "../lib/time.js";
import {
  BELT_NODE_COUNT,
  BELT_NODE_YIELD,
  GAME_GOOD_LABELS,
  HOLD_CAPACITY,
  NODE_KIND_GOOD,
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
  type CaptainId,
  type GameBuyerId,
  type GameGood,
  type GameNodeKind,
} from "@brain/shared";
import { CaptainRepo } from "./repo.js";

/**
 * P3 — the NPC economy service (Economy & the Waking Market).
 *
 * A SIBLING of the player's economy service, never a caller of it
 * (prep finding S-P3-3: the player service's dormant "npc" actor
 * kind would execute against the PLAYER's cargo, credits, and
 * demand — so no captain act may ever route through it, directly
 * or via its routes). This service writes ONLY the NPC instance:
 * five tables keyed by (space, captain) or (space) — her cargo
 * (npc_game_cargo), the shadow supply (npc_game_nodes), the NPC
 * pool's own stored periods (npc_game_periods, R12), the NPC
 * demand pool (npc_game_demand), and her append-only economy
 * ledger (npc_game_ledger). It shares with the player's instance
 * exactly what the design says it shares: G1's constants and the
 * postedPrice() function itself (Layer §7.1 — the prices ARE
 * G1's, unchanged).
 *
 * Transaction discipline: the service opens NO transaction of its
 * own. It is constructed per (space, captain) inside the caller's
 * advance transaction, so an economy mutation, the captain's
 * balance, the log append, and the memory entry commit — or roll
 * back — together (Architecture §7.2). Its idempotency is the
 * advance's: the cursor commits with the acts, and every ledger
 * row carries the decision-point step key that produced it.
 *
 * Her Credits live where they always have: npc_player_state. The
 * ledger opens with a genesis `opening` row per captain at her
 * first P3 touch (R4) — delta 0, balance_after = her live balance
 * then — because her balance predates any ledger (P2's board
 * payments moved it with only log acts as their record). From that
 * row forward the reconciliation invariant is exact.
 *
 * Presence (R13/R11, §5d of the recon): sell/refine require her
 * present at the Great Station — currentWorld 'great-station', no
 * open leg, not stopped; gather requires her present in a travel
 * world with no open leg. Shadow nodes are world-less, mirroring
 * the player's gather.
 */

export type NpcEconomyErrorCode =
  | "unknown_node"
  | "node_empty"
  | "hold_full"
  | "unknown_buyer"
  | "buyer_does_not_buy"
  | "insufficient_cargo"
  | "demand_exhausted"
  | "unknown_recipe"
  | "insufficient_inputs"
  | "insufficient_credits"
  | "invalid_quantity"
  | "not_present"
  | "in_transit"
  | "captain_stopped";

export interface NpcFailure {
  ok: false;
  error: NpcEconomyErrorCode;
  message: string;
}

export interface NpcNodeView {
  nodeId: string;
  kind: GameNodeKind;
  good: GameGood;
  capacity: number;
  remaining: number;
}

export interface NpcLedgerRow {
  id: number;
  kind: string;
  good: GameGood | null;
  qtyDelta: number;
  creditsDelta: number;
  balanceAfter: number;
  buyerId: string | null;
  unitPrice: number | null;
  recipeId: string | null;
  nodeId: string | null;
  stepKey: string;
  createdAt: string;
}

interface Period {
  startMs: number;
  endMs: number;
}

function validQty(qty: unknown): qty is number {
  return typeof qty === "number" && Number.isInteger(qty) && qty > 0;
}

/** Shadow wreck yields: seeded like the player's — but keyed with
 *  the NPC pool's own prefix, so the two rotations can NEVER
 *  correlate (the pools' independence is in the fixtures). */
function npcWreckYield(spaceId: string, periodStartMs: number, idx: number): number {
  const h = createHash("sha256").update(`npc-wreck:${spaceId}:${periodStartMs}:${idx}`).digest();
  const span = WRECK_YIELD_MAX - WRECK_YIELD_MIN + 1;
  return WRECK_YIELD_MIN + (h.readUInt32BE(0) % span);
}

export class NpcEconomy {
  private readonly captains: CaptainRepo;

  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
    private readonly captainId: CaptainId,
  ) {
    this.captains = new CaptainRepo(h, spaceId);
  }

  // --- periods + shadow supply (pool-level; shared per space, R2) ---

  private currentPeriod(nowMs: number): Period {
    const row = this.h.sqlite
      .prepare(
        `SELECT period_start_ms, period_end_ms FROM npc_game_periods
          WHERE space_id = ? AND period_start_ms <= ? AND period_end_ms > ?
          ORDER BY period_start_ms DESC LIMIT 1`,
      )
      .get(this.spaceId, nowMs, nowMs) as { period_start_ms: number; period_end_ms: number } | undefined;
    if (row) return { startMs: row.period_start_ms, endMs: row.period_end_ms };
    const tz = spaceTimezone(this.h.sqlite, this.spaceId);
    const localDate = localDayInZone(nowMs, tz);
    const { startMs, endMs } = localDayBoundsForDate(localDate, tz);
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO npc_game_periods (space_id, period_start_ms, period_end_ms) VALUES (?, ?, ?)`,
      )
      .run(this.spaceId, startMs, endMs);
    return { startMs, endMs };
  }

  /** Bring the shadow supply into the current period: belt/signal
   *  refill to capacity at the boundary; wrecks rotate with fresh
   *  pool-seeded ids. Rotation touches only node supply — never a
   *  holding, in either pool. */
  private syncNodes(period: Period): void {
    const s = this.h.sqlite;
    for (let i = 1; i <= BELT_NODE_COUNT; i++) {
      s.prepare(
        `INSERT OR IGNORE INTO npc_game_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES (?, ?, 'belt', ?, ?, ?, ?)`,
      ).run(this.spaceId, `npc-belt-${i}`, NODE_KIND_GOOD.belt, BELT_NODE_YIELD, BELT_NODE_YIELD, period.startMs);
    }
    for (let i = 1; i <= SIGNAL_NODE_COUNT; i++) {
      s.prepare(
        `INSERT OR IGNORE INTO npc_game_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES (?, ?, 'signal', ?, ?, ?, ?)`,
      ).run(this.spaceId, `npc-signal-${i}`, NODE_KIND_GOOD.signal, SIGNAL_NODE_YIELD, SIGNAL_NODE_YIELD, period.startMs);
    }
    s.prepare(
      `UPDATE npc_game_nodes SET remaining = capacity, period_start_ms = ?
        WHERE space_id = ? AND kind IN ('belt','signal') AND period_start_ms != ?`,
    ).run(period.startMs, this.spaceId, period.startMs);
    s.prepare(
      `DELETE FROM npc_game_nodes WHERE space_id = ? AND kind = 'wreck' AND period_start_ms != ?`,
    ).run(this.spaceId, period.startMs);
    const existing = s
      .prepare(`SELECT COUNT(*) AS c FROM npc_game_nodes WHERE space_id = ? AND kind = 'wreck' AND period_start_ms = ?`)
      .get(this.spaceId, period.startMs) as { c: number };
    if (existing.c === 0) {
      for (let i = 1; i <= WRECKS_PER_DAY; i++) {
        const yieldQty = npcWreckYield(this.spaceId, period.startMs, i);
        s.prepare(
          `INSERT INTO npc_game_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
           VALUES (?, ?, 'wreck', ?, ?, ?, ?)`,
        ).run(this.spaceId, `npc-wreck-${period.startMs}-${i}`, NODE_KIND_GOOD.wreck, yieldQty, yieldQty, period.startMs);
      }
    }
  }

  private ensurePool(nowMs: number): Period {
    const period = this.currentPeriod(nowMs);
    this.syncNodes(period);
    return period;
  }

  nodes(nowMs: number): NpcNodeView[] {
    this.ensurePool(nowMs);
    const rows = this.h.sqlite
      .prepare(
        `SELECT node_id, kind, good_id, capacity, remaining FROM npc_game_nodes
          WHERE space_id = ? ORDER BY node_id`,
      )
      .all(this.spaceId) as { node_id: string; kind: string; good_id: string; capacity: number; remaining: number }[];
    return rows.map((r) => ({
      nodeId: r.node_id,
      kind: r.kind as GameNodeKind,
      good: r.good_id as GameGood,
      capacity: r.capacity,
      remaining: r.remaining,
    }));
  }

  // --- genesis + ledger ---

  /** R4: the lazy genesis row — written once, at her first P3
   *  touch, inside that touch's transaction. */
  ensureGenesis(nowMs: number): void {
    const existing = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_game_ledger WHERE space_id = ? AND npc_id = ?`)
      .get(this.spaceId, this.captainId) as { c: number };
    if (existing.c > 0) return;
    const balance = this.credits();
    this.appendLedger(
      {
        kind: "opening",
        good: null,
        qtyDelta: 0,
        creditsDelta: 0,
        balanceAfter: balance,
        buyerId: null,
        unitPrice: null,
        recipeId: null,
        nodeId: null,
        stepKey: `${this.captainId}:genesis`,
      },
      nowMs,
    );
  }

  private appendLedger(
    e: {
      kind: string;
      good: GameGood | null;
      qtyDelta: number;
      creditsDelta: number;
      balanceAfter: number;
      buyerId: string | null;
      unitPrice: number | null;
      recipeId: string | null;
      nodeId: string | null;
      stepKey: string;
    },
    nowMs: number,
  ): void {
    this.h.sqlite
      .prepare(
        `INSERT INTO npc_game_ledger
           (space_id, npc_id, kind, good_id, qty_delta, credits_delta, balance_after, buyer_id, unit_price, recipe_id, node_id, step_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.spaceId, this.captainId, e.kind, e.good, e.qtyDelta, e.creditsDelta, e.balanceAfter,
        e.buyerId, e.unitPrice, e.recipeId, e.nodeId, e.stepKey, new Date(nowMs).toISOString(),
      );
  }

  ledger(limit = 100): NpcLedgerRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, kind, good_id, qty_delta, credits_delta, balance_after, buyer_id, unit_price, recipe_id, node_id, step_key, created_at
           FROM npc_game_ledger WHERE space_id = ? AND npc_id = ? ORDER BY id ASC LIMIT ?`,
      )
      .all(this.spaceId, this.captainId, limit) as {
      id: number; kind: string; good_id: string | null; qty_delta: number; credits_delta: number;
      balance_after: number; buyer_id: string | null; unit_price: number | null;
      recipe_id: string | null; node_id: string | null; step_key: string; created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      good: (r.good_id as GameGood | null) ?? null,
      qtyDelta: r.qty_delta,
      creditsDelta: r.credits_delta,
      balanceAfter: r.balance_after,
      buyerId: r.buyer_id,
      unitPrice: r.unit_price,
      recipeId: r.recipe_id,
      nodeId: r.node_id,
      stepKey: r.step_key,
      createdAt: r.created_at,
    }));
  }

  /** The reconciliation invariant, anchored at genesis (E-6):
   *  her stored balance == opening.balance_after + Σ credits_delta,
   *  and her stored cargo == Σ qty_delta per good. Detects a
   *  corrupted balance; never corrects one. */
  reconcile(): { ok: boolean; expectedCredits: number; actualCredits: number; cargoOk: boolean } {
    const rows = this.ledger(100_000);
    const opening = rows.find((r) => r.kind === "opening");
    const actual = this.credits();
    if (!opening) return { ok: rows.length === 0 && actual !== undefined, expectedCredits: actual, actualCredits: actual, cargoOk: true };
    const expected = opening.balanceAfter + rows.reduce((sum, r) => sum + r.creditsDelta, 0);
    const derived = new Map<GameGood, number>();
    for (const r of rows) {
      if (r.good) derived.set(r.good, (derived.get(r.good) ?? 0) + r.qtyDelta);
    }
    const stored = new Map(this.cargo().map((c) => [c.good, c.qty]));
    let cargoOk = true;
    for (const good of new Set([...derived.keys(), ...stored.keys()])) {
      if ((derived.get(good) ?? 0) !== (stored.get(good) ?? 0)) cargoOk = false;
    }
    return { ok: expected === actual && cargoOk && Number.isInteger(actual), expectedCredits: expected, actualCredits: actual, cargoOk };
  }

  // --- her hold + balance ---

  credits(): number {
    const st = this.captains.state(this.captainId);
    return st ? Math.round(st.credits) : 0;
  }

  cargo(): { good: GameGood; qty: number }[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT good_id, qty FROM npc_game_cargo WHERE space_id = ? AND npc_id = ? AND qty > 0 ORDER BY good_id ASC`,
      )
      .all(this.spaceId, this.captainId) as { good_id: string; qty: number }[];
    return rows.map((r) => ({ good: r.good_id as GameGood, qty: r.qty }));
  }

  /** Read-only cargo view for wire rendering — no genesis, no pool
   *  sync: a look must not write. */
  cargoReadOnly(): { good: GameGood; qty: number }[] {
    return this.cargo();
  }

  holdUsed(): number {
    return this.cargo().reduce((sum, c) => sum + c.qty, 0);
  }

  private cargoQty(good: GameGood): number {
    const row = this.h.sqlite
      .prepare(`SELECT qty FROM npc_game_cargo WHERE space_id = ? AND npc_id = ? AND good_id = ?`)
      .get(this.spaceId, this.captainId, good) as { qty: number } | undefined;
    return row?.qty ?? 0;
  }

  private addCargo(good: GameGood, delta: number): void {
    // Update-then-insert, not an upsert: SQLite checks an upsert's
    // proposed INSERT row against the CHECK (qty >= 0) before
    // conflict resolution, so a negative delta would fail even
    // when the stored row covers it.
    const res = this.h.sqlite
      .prepare(`UPDATE npc_game_cargo SET qty = qty + ? WHERE space_id = ? AND npc_id = ? AND good_id = ?`)
      .run(delta, this.spaceId, this.captainId, good);
    if (res.changes === 0) {
      this.h.sqlite
        .prepare(`INSERT INTO npc_game_cargo (space_id, npc_id, good_id, qty) VALUES (?, ?, ?, ?)`)
        .run(this.spaceId, this.captainId, good, delta);
    }
  }

  private setCredits(balance: number): void {
    this.captains.update(this.captainId, { credits: balance });
  }

  // --- presence (her state row is the only source — §5d) ---

  private presence(): { world: string | null; stopped: boolean; inTransit: boolean } {
    const st = this.captains.state(this.captainId);
    if (!st) return { world: null, stopped: false, inTransit: false };
    return { world: st.currentWorld, stopped: st.stopped, inTransit: st.legTo !== null };
  }

  private presenceFailure(atStation: boolean): NpcFailure | null {
    const p = this.presence();
    if (p.stopped) return { ok: false, error: "captain_stopped", message: "A stopped captain does no market work." };
    if (p.inTransit) return { ok: false, error: "in_transit", message: "She is underway — no market act is possible mid-leg." };
    if (p.world === null) return { ok: false, error: "not_present", message: "She is away from the public worlds just now." };
    if (atStation && p.world !== "great-station") {
      return {
        ok: false,
        error: "not_present",
        message: "The buyers and the refinery are at the Great Station — she is not there.",
      };
    }
    return null;
  }

  // --- demand (the NPC pool — never the player's) ---

  private demandRow(period: Period, buyerId: GameBuyerId, good: GameGood): { used: number; rush: number } {
    const row = this.h.sqlite
      .prepare(
        `SELECT used, rush_allowance FROM npc_game_demand
          WHERE space_id = ? AND period_start_ms = ? AND buyer_id = ? AND good_id = ?`,
      )
      .get(this.spaceId, period.startMs, buyerId, good) as { used: number; rush_allowance: number } | undefined;
    return { used: row?.used ?? 0, rush: row?.rush_allowance ?? 0 };
  }

  /** Remaining premium demand in the NPC pool for this period, or
   *  null when the buyer is unlimited (the Exchange floor). */
  demandRemaining(buyerId: GameBuyerId, good: GameGood, nowMs: number): number | null {
    const buyer = buyerById(buyerId);
    if (!buyer || buyer.dailyDemandCap === null) return null;
    const period = this.ensurePool(nowMs);
    const { used, rush } = this.demandRow(period, buyerId, good);
    return Math.max(0, buyer.dailyDemandCap + rush - used);
  }

  /** A Director buying rush (R9): additive headroom for the
   *  remainder of this local day, recorded as an allowance on the
   *  demand row — `used` is never rewritten, never negative. */
  addRushAllowance(buyerId: GameBuyerId, good: GameGood, allowance: number, nowMs: number): void {
    const period = this.ensurePool(nowMs);
    this.h.sqlite
      .prepare(
        `INSERT INTO npc_game_demand (space_id, period_start_ms, buyer_id, good_id, used, rush_allowance)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(space_id, period_start_ms, buyer_id, good_id)
         DO UPDATE SET rush_allowance = rush_allowance + excluded.rush_allowance`,
      )
      .run(this.spaceId, period.startMs, buyerId, good, allowance);
  }

  /** Her view of the market: posted prices (G1's own) and the NPC
   *  pool's remaining demand — never the player's figures. */
  buyersGuide(nowMs: number): { buyerId: GameBuyerId; buyerName: string; good: GameGood; price: number; demandRemaining: number | null }[] {
    this.ensurePool(nowMs);
    const out: { buyerId: GameBuyerId; buyerName: string; good: GameGood; price: number; demandRemaining: number | null }[] = [];
    for (const buyerId of ["station-exchange", "station-foundry", "salvage-yard", "archive-broker", "fleet-quartermaster"] as GameBuyerId[]) {
      const buyer = buyerById(buyerId)!;
      for (const good of ["ore", "salvage", "data", "component", "circuit"] as GameGood[]) {
        const price = postedPrice(buyerId, good);
        if (price === null) continue;
        out.push({ buyerId, buyerName: buyer.name, good, price, demandRemaining: this.demandRemaining(buyerId, good, nowMs) });
      }
    }
    return out;
  }

  // --- the three verbs ---

  gather(
    nodeId: string,
    stepKey: string,
    nowMs: number,
    qty?: number,
  ): { ok: true; good: GameGood; gathered: number; leftInNode: number; holdUsed: number } | NpcFailure {
    if (qty !== undefined && !validQty(qty)) {
      return { ok: false, error: "invalid_quantity", message: "A gather names a whole, positive count — or none, to fill the hold." };
    }
    const blocked = this.presenceFailure(false);
    if (blocked) return blocked;
    this.ensurePool(nowMs);
    const node = this.h.sqlite
      .prepare(`SELECT kind, good_id, remaining FROM npc_game_nodes WHERE space_id = ? AND node_id = ?`)
      .get(this.spaceId, nodeId) as { kind: string; good_id: string; remaining: number } | undefined;
    if (!node) {
      return { ok: false, error: "unknown_node", message: "That node is not one of the shadow supply's nodes — her side's supply has its own sites." };
    }
    const good = node.good_id as GameGood;
    if (node.remaining <= 0) {
      return { ok: false, error: "node_empty", message: `That ${node.kind} site is worked out for today — the supply renews at the day boundary.` };
    }
    const holdSpace = HOLD_CAPACITY - this.holdUsed();
    if (holdSpace <= 0) {
      return { ok: false, error: "hold_full", message: `Her hold is full (${HOLD_CAPACITY} units) — nothing more fits until something sells or refines.` };
    }
    this.ensureGenesis(nowMs);
    const gathered = Math.min(qty ?? Number.POSITIVE_INFINITY, node.remaining, holdSpace);
    const res = this.h.sqlite
      .prepare(`UPDATE npc_game_nodes SET remaining = remaining - ? WHERE space_id = ? AND node_id = ? AND remaining >= ?`)
      .run(gathered, this.spaceId, nodeId, gathered);
    if (res.changes !== 1) {
      return { ok: false, error: "node_empty", message: "That site was worked out by another captain first — the shared shadow supply is real." };
    }
    this.addCargo(good, gathered);
    this.appendLedger(
      {
        kind: "gather", good, qtyDelta: gathered, creditsDelta: 0, balanceAfter: this.credits(),
        buyerId: null, unitPrice: null, recipeId: null, nodeId, stepKey,
      },
      nowMs,
    );
    return { ok: true, good, gathered, leftInNode: node.remaining - gathered, holdUsed: this.holdUsed() };
  }

  sell(
    buyerId: GameBuyerId,
    good: GameGood,
    qty: number,
    stepKey: string,
    nowMs: number,
  ): { ok: true; accepted: number; declined: number; unitPrice: number; totalCredits: number; demandRemaining: number | null } | NpcFailure {
    if (!validQty(qty)) {
      return { ok: false, error: "invalid_quantity", message: "A sale names a whole, positive count." };
    }
    if (!isGameBuyerId(buyerId) || !buyerById(buyerId)) {
      return { ok: false, error: "unknown_buyer", message: "That is not one of the Station's five buyers." };
    }
    if (!isGameGood(good)) {
      return { ok: false, error: "insufficient_cargo", message: "That is not a good her hold can carry." };
    }
    const blocked = this.presenceFailure(true);
    if (blocked) return blocked;
    const price = postedPrice(buyerId, good);
    if (price === null) {
      return {
        ok: false,
        error: "buyer_does_not_buy",
        message: `${buyerById(buyerId)!.name} does not buy ${GAME_GOOD_LABELS[good]} — the Station Exchange buys everything at base.`,
      };
    }
    if (this.cargoQty(good) < qty) {
      return { ok: false, error: "insufficient_cargo", message: `She does not hold ${qty} units of ${GAME_GOOD_LABELS[good]}.` };
    }
    const period = this.ensurePool(nowMs);
    const buyer = buyerById(buyerId)!;
    let accepted = qty;
    if (buyer.dailyDemandCap !== null) {
      const { used, rush } = this.demandRow(period, buyerId, good);
      accepted = Math.min(qty, Math.max(0, buyer.dailyDemandCap + rush - used));
    }
    if (accepted <= 0) {
      return {
        ok: false,
        error: "demand_exhausted",
        message: `${buyer.name}'s pool demand for ${GAME_GOOD_LABELS[good]} is used up for today — the Exchange still buys at base.`,
      };
    }
    this.ensureGenesis(nowMs);
    if (buyer.dailyDemandCap !== null) {
      this.h.sqlite
        .prepare(
          `INSERT INTO npc_game_demand (space_id, period_start_ms, buyer_id, good_id, used, rush_allowance)
           VALUES (?, ?, ?, ?, ?, 0)
           ON CONFLICT(space_id, period_start_ms, buyer_id, good_id) DO UPDATE SET used = used + excluded.used`,
        )
        .run(this.spaceId, period.startMs, buyerId, good, accepted);
    }
    this.addCargo(good, -accepted);
    const total = accepted * price;
    const balance = this.credits() + total;
    this.setCredits(balance);
    this.appendLedger(
      {
        kind: "sale", good, qtyDelta: -accepted, creditsDelta: total, balanceAfter: balance,
        buyerId, unitPrice: price, recipeId: null, nodeId: null, stepKey,
      },
      nowMs,
    );
    return {
      ok: true,
      accepted,
      declined: qty - accepted,
      unitPrice: price,
      totalCredits: total,
      demandRemaining: buyer.dailyDemandCap === null ? null : this.demandRemaining(buyerId, good, nowMs),
    };
  }

  refine(
    recipeId: string,
    count: number,
    stepKey: string,
    nowMs: number,
  ): { ok: true; recipeId: string; output: GameGood; count: number; feeCharged: number } | NpcFailure {
    if (!validQty(count)) {
      return { ok: false, error: "invalid_quantity", message: "A refine names a whole, positive count." };
    }
    const recipe = recipeById(recipeId);
    if (!recipe) {
      return { ok: false, error: "unknown_recipe", message: "That is not one of the Station refinery's two recipes." };
    }
    const blocked = this.presenceFailure(true);
    if (blocked) return blocked;
    for (const [good, per] of Object.entries(recipe.inputs) as [GameGood, number][]) {
      if (this.cargoQty(good) < per * count) {
        return {
          ok: false,
          error: "insufficient_inputs",
          message: `Recipe ${recipe.id} wants ${per * count} ${GAME_GOOD_LABELS[good]} in her hold — she holds ${this.cargoQty(good)}.`,
        };
      }
    }
    const fee = recipe.feeCredits * count;
    const balance = this.credits();
    if (balance < fee) {
      return {
        ok: false,
        error: "insufficient_credits",
        message: `The refinery fee is ${fee} Credits and her ledger holds ${balance} — nothing is consumed when the fee cannot be paid.`,
      };
    }
    this.ensureGenesis(nowMs);
    for (const [good, per] of Object.entries(recipe.inputs) as [GameGood, number][]) {
      this.addCargo(good, -per * count);
      this.appendLedger(
        {
          kind: "refine_input", good, qtyDelta: -per * count, creditsDelta: 0, balanceAfter: balance,
          buyerId: null, unitPrice: null, recipeId: recipe.id, nodeId: null, stepKey,
        },
        nowMs,
      );
    }
    this.addCargo(recipe.output, count);
    this.appendLedger(
      {
        kind: "refine_output", good: recipe.output, qtyDelta: count, creditsDelta: 0, balanceAfter: balance,
        buyerId: null, unitPrice: null, recipeId: recipe.id, nodeId: null, stepKey,
      },
      nowMs,
    );
    const after = balance - fee;
    this.setCredits(after);
    this.appendLedger(
      {
        kind: "refine_fee", good: null, qtyDelta: 0, creditsDelta: -fee, balanceAfter: after,
        buyerId: null, unitPrice: null, recipeId: recipe.id, nodeId: null, stepKey,
      },
      nowMs,
    );
    return { ok: true, recipeId: recipe.id, output: recipe.output, count, feeCharged: fee };
  }
}
