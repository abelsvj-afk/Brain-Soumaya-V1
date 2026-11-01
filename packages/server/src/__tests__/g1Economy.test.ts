import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { GameEconomy } from "../game/economy.js";
import { EconomyRepo } from "../economy.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import {
  BASE_PRICES,
  PREMIUM_PRICES,
  RECIPES,
  HOLD_CAPACITY,
  FUEL_START,
  postedPrice,
  type GameGood,
} from "@brain/shared";

/**
 * G1 "The Hold" economy — requirements v0.2.1 acceptance criteria
 * G1-AC-01..19, the sign-off condition C1 inherited TX-AC instantiations
 * (TX-AC-01/03/04/05/07/12/13/14/15 by name), and the O-1 wall.
 * TX-AC-06/09/10/11 are not-applicable to G1 operations per condition
 * C3 (they bind at G2/G3); the invariants behind them bind in full.
 *
 * Every test runs against a fresh in-memory DB at the deploy tip's
 * schema (bootstrap + migrateSchema both create the game_* tables).
 */

let handle: DbHandle;
let keySeq = 0;
const key = (label: string) => `${label}-${++keySeq}`;

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

function econ(spaceId: string, opts: { now?: () => number; beforeCommit?: (a: string) => void } = {}): GameEconomy {
  return new GameEconomy(handle, spaceId, opts);
}

/** Give a space cargo of a good by gathering from its richest node. */
function gatherAll(e: GameEconomy, kind: "belt" | "signal" | "wreck"): { nodeId: string; gathered: number } {
  const st = e.getState();
  const node = st.nodes.find((n) => n.kind === kind && n.remaining > 0);
  if (!node) throw new Error(`no ${kind} node with supply`);
  const r = e.gather({ nodeId: node.nodeId, idempotencyKey: key("gather") });
  if (!r.ok) throw new Error(`gather failed: ${r.error}`);
  return { nodeId: node.nodeId, gathered: r.gathered };
}

function setTimezone(spaceId: string, tz: string): void {
  handle.sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, timezone) VALUES (?, ?)
       ON CONFLICT(space_id) DO UPDATE SET timezone = excluded.timezone`,
    )
    .run(spaceId, tz);
}

function gameRows(spaceId: string, table: string): number {
  const r = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE space_id = ?`).get(spaceId) as { c: number };
  return r.c;
}

function demandRows(spaceId: string): Array<{ period_start_ms: number; buyer_id: string; good_id: string; used: number }> {
  return handle.sqlite
    .prepare(`SELECT period_start_ms, buyer_id, good_id, used FROM game_demand WHERE space_id = ? ORDER BY period_start_ms, buyer_id`)
    .all(spaceId) as Array<{ period_start_ms: number; buyer_id: string; good_id: string; used: number }>;
}

/* ------------------------------------------------------------------ */
/* O-1 WALL — Credits ↔ Fuel NEVER convert (dedicated)                 */
/* ------------------------------------------------------------------ */

describe("O-1 wall — Credits and Fuel never convert", () => {
  it("the G1 service contains no fuel code path (source scan, comments stripped)", () => {
    const src = readFileSync(fileURLToPath(new URL("../game/economy.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/space_meta/);
    expect(code).not.toMatch(/EconomyRepo/);
    expect(code).not.toMatch(/FUEL_/);
    expect(code.toLowerCase()).not.toContain("fuel");
    const shared = readFileSync(
      fileURLToPath(new URL("../../../shared/src/gameEconomy.ts", import.meta.url)),
      "utf8",
    );
    const sharedCode = shared.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(sharedCode.toLowerCase()).not.toContain("fuel");
  });

  it("a full G1 loop never moves the fuel balance, in either direction", () => {
    const space = "wall-a";
    const fuel = new EconomyRepo(handle, space);
    expect(fuel.get()).toBe(FUEL_START);
    const e = econ(space);
    gatherAll(e, "belt");
    e.dock();
    const sale = e.sell({ buyerId: "station-exchange", good: "ore", qty: 5, idempotencyKey: key("sell") });
    expect(sale.ok).toBe(true);
    expect(e.creditsBalance()).toBe(20);
    // Fuel exactly untouched by earning Credits.
    expect(fuel.get()).toBe(FUEL_START);
    // Spending Fuel (travel energy) never touches Credits or goods.
    expect(fuel.spend(10)).toBe(true);
    expect(fuel.get()).toBe(FUEL_START - 10);
    expect(e.creditsBalance()).toBe(20);
    expect(e.getState().cargo.ore).toBe(15);
  });

  it("no G1 result, recipe, or price carries a fuel-denominated field", () => {
    const e = econ("wall-b");
    for (const recipe of RECIPES) {
      expect(Object.keys(recipe)).not.toContain("feeFuel");
      expect(typeof recipe.feeCredits).toBe("number");
    }
    gatherAll(e, "belt");
    e.dock();
    const sale = e.sell({ buyerId: "station-foundry", good: "ore", qty: 2, idempotencyKey: key("sell") });
    expect(sale.ok).toBe(true);
    if (sale.ok) {
      expect(Object.keys(sale).join(",")).not.toMatch(/fuel/i);
      expect(sale.unitPrice).toBe(6); // Credits, posted premium
    }
    const state = e.getState();
    expect(Object.keys(state).join(",")).not.toMatch(/fuel/i);
  });
});

/* ------------------------------------------------------------------ */
/* The loop — G1-AC-01, G1-AC-09                                       */
/* ------------------------------------------------------------------ */

describe("the money loop", () => {
  it("G1-AC-01 full loop: gather → dock → sell, cargo/credits/ledger exact", () => {
    const e = econ("loop");
    const g = gatherAll(e, "belt");
    expect(g.gathered).toBe(20);
    e.dock();
    const sale = e.sell({ buyerId: "station-foundry", good: "ore", qty: 12, idempotencyKey: key("sell") });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;
    expect(sale.unitPrice).toBe(6);
    expect(sale.totalCredits).toBe(72); // §6: 12 × 6 at the Foundry
    expect(sale.accepted).toBe(12);
    expect(sale.declined).toBe(0);
    const st = e.getState();
    expect(st.cargo.ore).toBe(8);
    expect(st.credits).toBe(72);
    const rows = handle.sqlite
      .prepare(`SELECT kind, good_id, qty_delta, credits_delta, unit_price FROM game_ledger WHERE space_id = ? ORDER BY id`)
      .all("loop") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "sale", good_id: "ore", qty_delta: -12, credits_delta: 72, unit_price: 6 });
  });

  it("G1-AC-09 no soft-lock: a fresh space's first Credits action is a raw sale", () => {
    const e = econ("fresh");
    expect(e.creditsBalance()).toBe(0);
    gatherAll(e, "belt");
    e.dock();
    const sale = e.sell({ buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: key("sell") });
    expect(sale.ok).toBe(true);
    if (sale.ok) expect(sale.totalCredits).toBe(BASE_PRICES.ore);
    expect(e.creditsBalance()).toBe(BASE_PRICES.ore);
  });

  it("§6 worked example: refine beats raw — cash proceeds after fees 200 vs raw 96 on the priced loop", () => {
    // The §6 figures, reproduced through the service: 12 Ore + 8 Salvage
    // → 4 Components (fees 20) → sell at Quartermaster 55 = 220.
    const e = econ("worked");
    // Stock storage with exactly 12 ore + 8 salvage via direct server-side
    // setup of a second space is not possible; build it by gathering:
    gatherAll(e, "belt"); // 20 ore in cargo
    e.dock();
    // Park 12 ore in storage, sell the other 8 raw later is not the path —
    // instead: move all 20 to storage, then work from storage.
    const t = e.transfer({ direction: "to-storage", good: "ore", qty: 20, idempotencyKey: key("tr") });
    expect(t.ok).toBe(true);
    // Salvage: gather wrecks until storage holds >= 8 (yields are 4..10).
    let salvage = 0;
    for (let i = 0; i < 3 && salvage < 8; i++) {
      const g = gatherAll(e, "wreck");
      salvage += g.gathered;
      const tr = e.transfer({ direction: "to-storage", good: "salvage", qty: g.gathered, idempotencyKey: key("tr") });
      expect(tr.ok).toBe(true);
    }
    expect(salvage).toBeGreaterThanOrEqual(8);
    // Seed credits for fees via a raw ore sale from a fresh belt haul:
    gatherAll(e, "belt");
    const seed = e.sell({ buyerId: "station-exchange", good: "ore", qty: 20, idempotencyKey: key("sell") });
    expect(seed.ok).toBe(true);
    const before = e.creditsBalance();
    // Refine exactly 4 Components from storage: 12 ore + 8 salvage, fees 20.
    handle.sqlite
      .prepare(`UPDATE game_storage SET qty = 12 WHERE space_id = ? AND good_id = 'ore'`)
      .run("worked");
    handle.sqlite
      .prepare(`UPDATE game_storage SET qty = 8 WHERE space_id = ? AND good_id = 'salvage'`)
      .run("worked");
    // (storage quantities normalized to the §6 inputs — the loop above
    // proved the gather/transfer path that fills storage.)
    const r = e.refine({ recipeId: "R-1", count: 4, idempotencyKey: key("refine") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feeCredits).toBe(20);
    expect(r.outputQty).toBe(4);
    const mv = e.transfer({ direction: "to-cargo", good: "component", qty: 4, idempotencyKey: key("tr") });
    expect(mv.ok).toBe(true);
    const sale = e.sell({ buyerId: "fleet-quartermaster", good: "component", qty: 4, idempotencyKey: key("sell") });
    expect(sale.ok).toBe(true);
    if (!sale.ok) return;
    expect(sale.totalCredits).toBe(220);
    // Cash proceeds after fees for the refine leg: 220 - 20 = 200 (§6),
    // vs the raw-sale alternative for the same inputs: 12×4 + 8×6 = 96.
    expect(sale.totalCredits - r.feeCredits).toBe(200);
    expect(12 * BASE_PRICES.ore + 8 * BASE_PRICES.salvage).toBe(96);
    expect(e.creditsBalance()).toBe(before - 20 + 220);
  });
});

/* ------------------------------------------------------------------ */
/* Buyers — G1-AC-02, 03, 11, 12, 13, 19                               */
/* ------------------------------------------------------------------ */

describe("buyers, prices, and premium demand", () => {
  it("G1-AC-02 guaranteed route: every good has a guide buyer and the Exchange buys each at base", () => {
    const e = econ("guide");
    const guide = e.buyersGuide();
    for (const good of ["ore", "salvage", "data", "component", "circuit"] as GameGood[]) {
      const entries = guide.entries.filter((x) => x.good === good);
      expect(entries.length, `guide lists a buyer for ${good}`).toBeGreaterThan(0);
      const ex = entries.find((x) => x.buyerId === "station-exchange");
      expect(ex?.unitPrice).toBe(BASE_PRICES[good]);
      expect(ex?.demandRemaining).toBeNull(); // unlimited floor
    }
    e.dock();
    // Exchange actually buys each gathered good at base.
    for (const [kind, good] of [["belt", "ore"], ["signal", "data"], ["wreck", "salvage"]] as const) {
      const g = gatherAll(e, kind);
      const s = e.sell({ buyerId: "station-exchange", good, qty: Math.min(2, g.gathered), idempotencyKey: key("sell") });
      expect(s.ok).toBe(true);
      if (s.ok) expect(s.unitPrice).toBe(BASE_PRICES[good]);
    }
  });

  it("G1-AC-12 guide accuracy: guide prices and remaining demand equal server state", () => {
    const e = econ("guide2");
    gatherAll(e, "belt");
    e.dock();
    const s = e.sell({ buyerId: "station-foundry", good: "ore", qty: 7, idempotencyKey: key("sell") });
    expect(s.ok).toBe(true);
    const guide = e.buyersGuide();
    for (const entry of guide.entries) {
      expect(entry.unitPrice).toBe(postedPrice(entry.buyerId, entry.good));
      if (entry.demandCap !== null) {
        const used = demandRows("guide2").find(
          (d) => d.buyer_id === entry.buyerId && d.good_id === entry.good && d.period_start_ms === guide.period.periodStartMs,
        )?.used ?? 0;
        expect(entry.demandRemaining).toBe(entry.demandCap - used);
      }
    }
    const foundryOre = guide.entries.find((x) => x.buyerId === "station-foundry" && x.good === "ore");
    expect(foundryOre?.demandRemaining).toBe(33); // 40 cap - 7 sold
  });

  it("G1-AC-11 price truth: every sale states the server's posted price at commit", () => {
    const e = econ("truth");
    e.dock();
    const cases: Array<["belt" | "signal" | "wreck", GameGood, string]> = [
      ["belt", "ore", "station-foundry"],
      ["signal", "data", "archive-broker"],
      ["wreck", "salvage", "salvage-yard"],
    ];
    for (const [kind, good, buyer] of cases) {
      gatherAll(e, kind);
      const s = e.sell({ buyerId: buyer, good, qty: 1, idempotencyKey: key("sell") });
      expect(s.ok).toBe(true);
      if (s.ok) expect(s.unitPrice).toBe(postedPrice(buyer as never, good));
    }
  });

  it("G1-AC-03 premium cap: exhaustion declines cleanly, Exchange still buys, demand resets next local day", () => {
    let now = Date.parse("2026-10-29T12:00:00Z"); // Thu Oct 29, 08:00 in America/New_York
    const e = econ("caps", { now: () => now });
    e.dock();
    // Burn the Foundry's 40-unit ore demand with two full holds.
    gatherAll(e, "belt");
    let s = e.sell({ buyerId: "station-foundry", good: "ore", qty: 20, idempotencyKey: key("sell") });
    expect(s.ok && s.accepted).toBe(20);
    gatherAll(e, "belt");
    s = e.sell({ buyerId: "station-foundry", good: "ore", qty: 20, idempotencyKey: key("sell") });
    expect(s.ok && s.accepted).toBe(20);
    gatherAll(e, "belt");
    const declined = e.sell({ buyerId: "station-foundry", good: "ore", qty: 1, idempotencyKey: key("sell") });
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.error).toBe("demand_exhausted");
    // The floor still buys the same unit at base.
    const floor = e.sell({ buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: key("sell") });
    expect(floor.ok).toBe(true);
    if (floor.ok) expect(floor.unitPrice).toBe(BASE_PRICES.ore);
    // Next local day: premium demand is back.
    now += 24 * 3_600_000;
    gatherAll(e, "belt");
    const again = e.sell({ buyerId: "station-foundry", good: "ore", qty: 1, idempotencyKey: key("sell") });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.unitPrice).toBe(6);
  });

  it("G1-AC-19 partial premium sale: 10 offered vs 4 remaining → 4 paid + 6 retained, one transaction", () => {
    const e = econ("partial");
    e.dock();
    // Consume 36 of the Foundry's 40 ore demand.
    gatherAll(e, "belt");
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 20, idempotencyKey: key("sell") });
    gatherAll(e, "belt");
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 16, idempotencyKey: key("sell") });
    gatherAll(e, "belt");
    const ledgerBefore = gameRows("partial", "game_ledger");
    const saleKey = key("sell");
    const s = e.sell({ buyerId: "station-foundry", good: "ore", qty: 10, idempotencyKey: saleKey });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.accepted).toBe(4);
    expect(s.declined).toBe(6);
    expect(s.unitPrice).toBe(6);
    expect(s.totalCredits).toBe(24);
    expect(s.demandRemaining).toBe(0);
    expect(e.getState().cargo.ore).toBe(16); // 20 - 4 sold; the 6 declined never left
    expect(gameRows("partial", "game_ledger")).toBe(ledgerBefore + 1); // exactly one sale row
    // Retry returns the stored split; nothing duplicates.
    const retry = e.sell({ buyerId: "station-foundry", good: "ore", qty: 10, idempotencyKey: saleKey });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.replayed).toBe(true);
      expect(retry.accepted).toBe(4);
      expect(retry.declined).toBe(6);
    }
    expect(e.getState().cargo.ore).toBe(16);
    expect(gameRows("partial", "game_ledger")).toBe(ledgerBefore + 1);
    // The declined 6 can still go to the Exchange as a separate action.
    const rest = e.sell({ buyerId: "station-exchange", good: "ore", qty: 6, idempotencyKey: key("sell") });
    expect(rest.ok).toBe(true);
  });

  it("G1-AC-13 premium race: competing sales never exceed the cap; total consumption equals the cap", () => {
    const e = econ("race");
    e.dock();
    gatherAll(e, "belt");
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 20, idempotencyKey: key("sell") });
    gatherAll(e, "belt");
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 16, idempotencyKey: key("sell") });
    // 4 units of demand remain; two sales of 10 compete for them.
    gatherAll(e, "belt");
    const a = e.sell({ buyerId: "station-foundry", good: "ore", qty: 10, idempotencyKey: key("sell-a") });
    const b = e.sell({ buyerId: "station-foundry", good: "ore", qty: 10, idempotencyKey: key("sell-b") });
    const acceptedTotal = (a.ok ? a.accepted : 0) + (b.ok ? b.accepted : 0);
    expect(acceptedTotal).toBe(4);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.accepted).toBe(4);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("demand_exhausted");
    const used = demandRows("race").filter((d) => d.buyer_id === "station-foundry" && d.good_id === "ore");
    expect(used.reduce((sum, d) => sum + d.used, 0)).toBe(40); // exactly the cap
  });

  it("specialized buyers decline goods outside their list; the Exchange route stays open", () => {
    const e = econ("decline");
    gatherAll(e, "signal");
    e.dock();
    const s = e.sell({ buyerId: "station-foundry", good: "data", qty: 1, idempotencyKey: key("sell") });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toBe("buyer_does_not_buy");
    expect(e.getState().cargo.data).toBe(15); // unchanged
    expect(e.creditsBalance()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Refining — G1-AC-04, G1-AC-05                                       */
/* ------------------------------------------------------------------ */

describe("refining", () => {
  it("G1-AC-04 refine atomicity: insufficient fee consumes and produces NOTHING", () => {
    const e = econ("refine-poor");
    gatherAll(e, "wreck"); // salvage first, so the belt gather still has hold room
    gatherAll(e, "belt");
    e.dock();
    expect(e.creditsBalance()).toBe(0); // cannot pay the 5-Credit fee
    const cargoBefore = e.getState().cargo;
    const ledgerBefore = gameRows("refine-poor", "game_ledger");
    const r = e.refine({ recipeId: "R-1", idempotencyKey: key("refine") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("insufficient_credits");
    expect(e.getState().cargo).toEqual(cargoBefore);
    expect(e.getState().storage.component).toBe(0);
    expect(gameRows("refine-poor", "game_ledger")).toBe(ledgerBefore);
  });

  it("G1-AC-04 successful refine: inputs, fee, and output match the recipe in one ledger-verifiable transaction", () => {
    const e = econ("refine-ok");
    gatherAll(e, "belt");
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 5, idempotencyKey: key("sell") }); // 20 credits
    gatherAll(e, "wreck");
    const cargoBefore = e.getState().cargo;
    const r = e.refine({ recipeId: "R-1", idempotencyKey: key("refine") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inputsConsumed).toEqual({ ore: 3, salvage: 2 });
    expect(r.feeCredits).toBe(5);
    expect(e.creditsBalance()).toBe(15);
    const st = e.getState();
    expect(st.cargo.ore).toBe(cargoBefore.ore - 3);
    expect(st.cargo.salvage).toBe(cargoBefore.salvage - 2);
    expect(st.storage.component).toBe(1);
    const rows = handle.sqlite
      .prepare(`SELECT kind, good_id, qty_delta, credits_delta, recipe_id FROM game_ledger WHERE space_id = ? AND recipe_id = 'R-1' ORDER BY id`)
      .all("refine-ok") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3); // 2 inputs + 1 output, one transaction
    expect(rows.reduce((sum, x) => sum + (x.credits_delta as number), 0)).toBe(-5);
  });

  it("refine with insufficient inputs consumes nothing (fee untouched)", () => {
    const e = econ("refine-short");
    gatherAll(e, "belt");
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 5, idempotencyKey: key("sell") });
    const r = e.refine({ recipeId: "R-2", idempotencyKey: key("refine") }); // needs salvage + data, holds none
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("insufficient_inputs");
    expect(e.creditsBalance()).toBe(20);
    expect(e.getState().storage.circuit).toBe(0);
  });

  it("G1-AC-05 margin: refining and selling at base always returns more than the raw-sale value of the inputs plus the fee", () => {
    for (const recipe of RECIPES) {
      const rawValue = Object.entries(recipe.inputs).reduce(
        (sum, [g, n]) => sum + BASE_PRICES[g as GameGood] * (n ?? 0),
        0,
      );
      // The §9 value-add check, over the constants table itself:
      // output base price strictly exceeds raw input value + fee.
      expect(BASE_PRICES[recipe.output], `${recipe.id} margin`).toBeGreaterThan(rawValue + recipe.feeCredits);
    }
    // §9 spot figures: Component 24 + 5 → 40 (+11); Circuit 36 + 8 → 60 (+16).
    expect(BASE_PRICES.component - (24 + 5)).toBe(11);
    expect(BASE_PRICES.circuit - (36 + 8)).toBe(16);
  });
});

/* ------------------------------------------------------------------ */
/* Cargo, storage, location — G1-AC-06, G1-AC-07, G1-AC-18             */
/* ------------------------------------------------------------------ */

describe("cargo, storage, and location", () => {
  it("G1-AC-06 full hold: 3 free units into a 15-unit node credits exactly 3 and leaves 12", () => {
    const e = econ("fullhold");
    gatherAll(e, "belt"); // hold full: 20 ore
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 3, idempotencyKey: key("sell") }); // 17 used, 3 free
    const r = e.gather({ nodeId: "signal-1", idempotencyKey: key("gather") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gathered).toBe(3);
    expect(r.leftInNode).toBe(12);
    expect(r.holdUsed).toBe(HOLD_CAPACITY);
    const node = e.getState().nodes.find((n) => n.nodeId === "signal-1");
    expect(node?.remaining).toBe(12); // the remainder STAYS in the node
  });

  it("G1-AC-07 location: transfers, sales, and refining are refused when not docked; storage unchanged", () => {
    const e = econ("nowhere");
    gatherAll(e, "belt");
    expect(e.isDocked()).toBe(false);
    const t = e.transfer({ direction: "to-storage", good: "ore", qty: 5, idempotencyKey: key("tr") });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error).toBe("not_docked");
    const s = e.sell({ buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: key("sell") });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toBe("not_docked");
    const r = e.refine({ recipeId: "R-1", idempotencyKey: key("refine") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_docked");
    expect(e.getState().storage.ore).toBe(0);
    expect(e.getState().cargo.ore).toBe(20);
    // Dock, and the same transfer succeeds.
    e.dock();
    const ok = e.transfer({ direction: "to-storage", good: "ore", qty: 5, idempotencyKey: key("tr") });
    expect(ok.ok).toBe(true);
    expect(e.getState().storage.ore).toBe(5);
  });

  it("to-cargo transfer that would overflow the hold is refused whole", () => {
    const e = econ("overflow");
    gatherAll(e, "belt");
    e.dock();
    e.transfer({ direction: "to-storage", good: "ore", qty: 20, idempotencyKey: key("tr") });
    gatherAll(e, "signal"); // 15 data in hold
    const t = e.transfer({ direction: "to-cargo", good: "ore", qty: 6, idempotencyKey: key("tr") });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.error).toBe("hold_full");
    expect(e.getState().storage.ore).toBe(20);
    expect(e.getState().cargo.ore).toBe(0);
  });

  it("G1-AC-18 foreign-id storage: another space's node id resolves to nothing here; both spaces unchanged", () => {
    const a = econ("space-a");
    const b = econ("space-b");
    // A node that exists ONLY in space B (direct server-side setup,
    // stamped with B's current period so B's own rotation keeps it).
    const bPeriod = b.getState().period.periodStartMs;
    handle.sqlite
      .prepare(
        `INSERT INTO game_resource_nodes (space_id, node_id, kind, good_id, capacity, remaining, period_start_ms)
         VALUES ('space-b', 'b-only-wreck', 'wreck', 'salvage', 7, 7, ?)`,
      )
      .run(bPeriod);
    gatherAll(a, "belt");
    a.dock();
    const beforeA = a.getState();
    const g = a.gather({ nodeId: "b-only-wreck", idempotencyKey: key("gather") });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toBe("unknown_node");
    expect(a.getState().cargo).toEqual(beforeA.cargo);
    const bNode = handle.sqlite
      .prepare(`SELECT remaining FROM game_resource_nodes WHERE space_id = 'space-b' AND node_id = 'b-only-wreck'`)
      .get() as { remaining: number };
    expect(bNode.remaining).toBe(7); // B untouched
    expect(b.creditsBalance()).toBe(0);
    // And B's own gather on its own node works — the id was never A's.
    const gb = b.gather({ nodeId: "b-only-wreck", idempotencyKey: key("gather") });
    expect(gb.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Supply — G1-AC-08                                                   */
/* ------------------------------------------------------------------ */

describe("supply, respawn, and rotation", () => {
  it("G1-AC-08 belt/signal nodes read empty after depletion and full after the local day boundary; wrecks rotate with fresh ids", () => {
    let now = Date.parse("2026-10-29T12:00:00Z");
    const e = econ("supply", { now: () => now });
    const day1 = e.getState();
    const belt = day1.nodes.find((n) => n.nodeId === "belt-1");
    expect(belt?.remaining).toBe(20);
    const wreckIdsDay1 = day1.nodes.filter((n) => n.kind === "wreck").map((n) => n.nodeId);
    expect(wreckIdsDay1.length).toBeGreaterThan(0);
    gatherAll(e, "belt");
    const depleted = e.getState().nodes.find((n) => n.nodeId === "belt-1");
    expect(depleted?.remaining).toBe(0);
    const again = e.gather({ nodeId: "belt-1", idempotencyKey: key("gather") });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("node_empty");
    // Next local day.
    now += 24 * 3_600_000;
    const day2 = e.getState();
    expect(day2.nodes.find((n) => n.nodeId === "belt-1")?.remaining).toBe(20);
    expect(day2.nodes.find((n) => n.nodeId === "signal-1")?.remaining).toBe(15);
    const wreckIdsDay2 = day2.nodes.filter((n) => n.kind === "wreck").map((n) => n.nodeId);
    expect(wreckIdsDay2.length).toBe(wreckIdsDay1.length);
    for (const id of wreckIdsDay2) expect(wreckIdsDay1).not.toContain(id); // no duplicate site ids across days
    for (const n of day2.nodes.filter((x) => x.kind === "wreck")) {
      expect(n.remaining).toBeGreaterThanOrEqual(4);
      expect(n.remaining).toBeLessThanOrEqual(10);
    }
    // Rotation never touches holdings (I-10 / G1-R4): day-1's cargo is intact.
    expect(day2.cargo.ore).toBe(20);
  });
});

/* ------------------------------------------------------------------ */
/* Day boundaries & timezone — G1-AC-15, G1-AC-16                      */
/* ------------------------------------------------------------------ */

describe("periods: day boundary and timezone changes", () => {
  it("G1-AC-15 a sale at the period's last instant and one at its first next instant land in exactly one period each", () => {
    const t0 = Date.parse("2026-10-29T12:00:00Z");
    let now = t0;
    const e = econ("boundary", { now: () => now });
    e.dock();
    const period = e.getState().period;
    gatherAll(e, "belt");
    now = period.periodEndMs - 1000; // last second of the period
    const s1 = e.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: key("sell") });
    expect(s1.ok).toBe(true);
    gatherAll(e, "belt");
    now = period.periodEndMs; // first instant of the NEXT period
    const s2 = e.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: key("sell") });
    expect(s2.ok).toBe(true);
    const rows = demandRows("boundary");
    expect(rows).toHaveLength(2); // exactly one demand row per period — neither double-counted nor lost
    expect(rows.map((r) => r.period_start_ms).sort()).toEqual(
      [period.periodStartMs, period.periodEndMs].sort(),
    );
    expect(rows.every((r) => r.used === 5)).toBe(true);
    // Supply followed the same boundary: the belt refilled exactly once.
    expect(e.getState().period.periodStartMs).toBe(period.periodEndMs);
  });

  it("G1-AC-16 changing the space's timezone does NOT reset the active period's demand or node supply", () => {
    const now = Date.parse("2026-10-29T12:00:00Z");
    const space = "tzchange";
    setTimezone(space, "America/New_York");
    const e = econ(space, { now: () => now });
    e.dock();
    const opened = e.getState().period;
    expect(opened.timezone).toBe("America/New_York");
    gatherAll(e, "belt");
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 6, idempotencyKey: key("sell") });
    const beltBefore = e.getState().nodes.find((n) => n.nodeId === "belt-1")?.remaining;
    expect(beltBefore).toBe(0); // depleted by the gather above — a refill would show 20
    // The owner changes the space's timezone mid-period.
    setTimezone(space, "Pacific/Kiritimati");
    const after = e.getState();
    expect(after.period.periodStartMs).toBe(opened.periodStartMs); // the ACTIVE period is untouched
    expect(after.period.periodEndMs).toBe(opened.periodEndMs);
    expect(after.period.timezone).toBe("America/New_York"); // stored at open; change applies next period
    const guide = e.buyersGuide();
    const foundryOre = guide.entries.find((x) => x.buyerId === "station-foundry" && x.good === "ore");
    expect(foundryOre?.demandRemaining).toBe(34); // 40 - 6: not refreshed
    expect(after.nodes.find((n) => n.nodeId === "belt-1")?.remaining).toBe(beltBefore); // supply not reset
    expect(demandRows(space)).toHaveLength(1); // no duplicate period rows
  });

  it("periods are computed in the SPACE's timezone, not UTC (no UTC day boundaries)", () => {
    // 2026-10-30T02:30:00Z is Oct 29 in New York (22:30 EDT) but Oct 30 in UTC.
    const now = Date.parse("2026-10-30T02:30:00Z");
    const space = "ny-space";
    setTimezone(space, "America/New_York");
    const e = econ(space, { now: () => now });
    expect(e.getState().period.localDate).toBe("2026-10-29");
    const space2 = "kiritimati-space";
    setTimezone(space2, "Pacific/Kiritimati");
    const e2 = econ(space2, { now: () => now });
    expect(e2.getState().period.localDate).toBe("2026-10-30"); // UTC+14: already Oct 30 there
  });
});

/* ------------------------------------------------------------------ */
/* Mint report & price history — G1-AC-10, G1-AC-17                    */
/* ------------------------------------------------------------------ */

describe("ledger-derived reports", () => {
  it("G1-AC-10 Credits minted per day is derivable from the ledger alone", () => {
    const e = econ("mint");
    gatherAll(e, "belt");
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 5, idempotencyKey: key("sell") }); // +20
    e.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: key("sell") }); // +30
    const report = e.mintedPerDay();
    const totalMinted = report.reduce((s, d) => s + d.mintedCredits, 0);
    expect(totalMinted).toBe(50);
    // Independent derivation straight from ledger rows:
    const row = handle.sqlite
      .prepare(`SELECT COALESCE(SUM(credits_delta), 0) AS m FROM game_ledger WHERE space_id = ? AND kind = 'sale' AND credits_delta > 0`)
      .get("mint") as { m: number };
    expect(totalMinted).toBe(row.m);
    expect(report.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true);
  });

  it("G1-AC-17 a price change affects only future transactions; prior ledger entries are byte-identical", () => {
    const e = econ("constants");
    gatherAll(e, "belt");
    e.dock();
    const s1 = e.sell({ buyerId: "station-foundry", good: "ore", qty: 2, idempotencyKey: key("sell") });
    expect(s1.ok && s1.unitPrice).toBe(6);
    const ledgerBefore = JSON.stringify(
      handle.sqlite.prepare(`SELECT * FROM game_ledger WHERE space_id = ? ORDER BY id`).all("constants"),
    );
    // Retune the posted premium (the constants file doing its job, §8):
    const premium = PREMIUM_PRICES["station-foundry"]!;
    const original = premium.ore;
    premium.ore = 99;
    try {
      const s2 = e.sell({ buyerId: "station-foundry", good: "ore", qty: 2, idempotencyKey: key("sell") });
      expect(s2.ok && s2.unitPrice).toBe(99); // future transactions use the new price
    } finally {
      premium.ore = original;
    }
    const rowsAfter = handle.sqlite
      .prepare(`SELECT * FROM game_ledger WHERE space_id = ? ORDER BY id`)
      .all("constants") as Array<Record<string, unknown>>;
    const priorRows = rowsAfter.slice(0, JSON.parse(ledgerBefore).length);
    expect(JSON.stringify(priorRows)).toBe(ledgerBefore); // byte-identical
    expect(priorRows[1]?.unit_price).toBe(6);
  });
});

/* ------------------------------------------------------------------ */
/* C1 inherited TX-AC instantiations                                   */
/* ------------------------------------------------------------------ */

describe("C1 inherited architecture tests, instantiated for G1", () => {
  it("TX-AC-01 crash-point: a failure injected mid-sale rolls back EVERYTHING; the retry commits exactly once", () => {
    const space = "crash-sale";
    let armed = true;
    const crashing = econ(space, {
      beforeCommit: (action) => {
        if (armed && action === "sell") throw new Error("simulated crash before commit");
      },
    });
    gatherAll(crashing, "belt");
    crashing.dock();
    const cargoBefore = crashing.getState().cargo;
    expect(() =>
      crashing.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: "crash-key" }),
    ).toThrow("simulated crash");
    // Nothing half-moved: cargo, credits, demand, ledger, stored result.
    expect(crashing.getState().cargo).toEqual(cargoBefore);
    expect(crashing.creditsBalance()).toBe(0);
    expect(demandRows(space)).toHaveLength(0);
    expect(gameRows(space, "game_ledger")).toBe(1); // only the gather row
    expect(gameRows(space, "game_action_results")).toBe(1); // only the gather result
    armed = false;
    const retry = crashing.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: "crash-key" });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.totalCredits).toBe(30);
    expect(crashing.creditsBalance()).toBe(30);
    expect(demandRows(space)[0]?.used).toBe(5);
  });

  it("TX-AC-01 crash-point: the same all-or-nothing holds for gather, refine, and transfer", () => {
    const space = "crash-all";
    let armedFor: string | null = null;
    const e = econ(space, {
      beforeCommit: (action) => {
        if (armedFor === action) throw new Error("simulated crash");
      },
    });
    // gather
    armedFor = "gather";
    expect(() => e.gather({ nodeId: "belt-1", idempotencyKey: "ck-gather" })).toThrow();
    expect(e.getState().cargo.ore).toBe(0);
    expect(e.getState().nodes.find((n) => n.nodeId === "belt-1")?.remaining).toBe(20);
    armedFor = null;
    expect(e.gather({ nodeId: "belt-1", idempotencyKey: "ck-gather" }).ok).toBe(true);
    // transfer
    e.dock();
    armedFor = "transfer";
    expect(() =>
      e.transfer({ direction: "to-storage", good: "ore", qty: 4, idempotencyKey: "ck-transfer" }),
    ).toThrow();
    expect(e.getState().storage.ore).toBe(0);
    expect(e.getState().cargo.ore).toBe(20);
    armedFor = null;
    expect(e.transfer({ direction: "to-storage", good: "ore", qty: 4, idempotencyKey: "ck-transfer" }).ok).toBe(true);
    // refine (fund the fee first, then crash the refine)
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 3, idempotencyKey: key("sell") });
    gatherAll(e, "wreck");
    const cargoBefore = e.getState().cargo;
    const creditsBefore = e.creditsBalance();
    armedFor = "refine";
    expect(() => e.refine({ recipeId: "R-1", idempotencyKey: "ck-refine" })).toThrow();
    expect(e.getState().cargo).toEqual(cargoBefore);
    expect(e.creditsBalance()).toBe(creditsBefore);
    expect(e.getState().storage.component).toBe(0);
    armedFor = null;
    expect(e.refine({ recipeId: "R-1", idempotencyKey: "ck-refine" }).ok).toBe(true);
    expect(e.getState().storage.component).toBe(1);
  });

  it("TX-AC-02 / G1-AC-14 replay: the same request ×10 commits exactly once; all responses identical", () => {
    const e = econ("replay");
    gatherAll(e, "belt");
    e.dock();
    const results = Array.from({ length: 10 }, () =>
      e.sell({ buyerId: "station-foundry", good: "ore", qty: 5, idempotencyKey: "replay-key" }),
    );
    const first = results[0];
    expect(first?.ok).toBe(true);
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok && first?.ok) {
        expect(r.accepted).toBe(first.accepted);
        expect(r.totalCredits).toBe(first.totalCredits);
        expect(r.unitPrice).toBe(first.unitPrice);
      }
    }
    expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.replayed)).toHaveLength(9);
    expect(e.creditsBalance()).toBe(30); // paid once
    expect(demandRows("replay")[0]?.used).toBe(5); // demand consumed once
    expect(gameRows("replay", "game_ledger")).toBe(2); // gather + ONE sale
  });

  it("TX-AC-03 key misuse: same key with different arguments is rejected and changes nothing", () => {
    const e = econ("misuse");
    gatherAll(e, "belt");
    e.dock();
    const ok = e.sell({ buyerId: "station-exchange", good: "ore", qty: 4, idempotencyKey: "shared-key" });
    expect(ok.ok).toBe(true);
    const snapshot = e.getState();
    const bad = e.sell({ buyerId: "station-exchange", good: "ore", qty: 9, idempotencyKey: "shared-key" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("idempotency_key_misuse");
    expect(e.getState().cargo).toEqual(snapshot.cargo);
    expect(e.creditsBalance()).toBe(snapshot.credits);
    // A missing key is refused outright.
    const noKey = e.sell({ buyerId: "station-exchange", good: "ore", qty: 1 });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error).toBe("idempotency_key_required");
  });

  it("TX-AC-05 last-unit race: concurrent gathers on a node with 1 unit yield exactly 1 success", () => {
    const e = econ("lastunit");
    e.getState(); // seed nodes
    handle.sqlite
      .prepare(`UPDATE game_resource_nodes SET remaining = 1 WHERE space_id = ? AND node_id = 'belt-1'`)
      .run("lastunit");
    const a = e.gather({ nodeId: "belt-1", idempotencyKey: key("g-a") });
    const b = e.gather({ nodeId: "belt-1", idempotencyKey: key("g-b") });
    const successes = [a, b].filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    if (successes[0]?.ok) expect(successes[0].gathered).toBe(1);
    const node = handle.sqlite
      .prepare(`SELECT remaining FROM game_resource_nodes WHERE space_id = 'lastunit' AND node_id = 'belt-1'`)
      .get() as { remaining: number };
    expect(node.remaining).toBe(0); // never negative
    expect(e.getState().cargo.ore).toBe(1);
  });

  it("TX-AC-07 negative/overflow: bad quantities are rejected at validation AND at the database constraint", () => {
    const e = econ("amounts");
    gatherAll(e, "belt");
    e.dock();
    for (const qty of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001, "5", null]) {
      const s = e.sell({ buyerId: "station-exchange", good: "ore", qty, idempotencyKey: key("sell") });
      expect(s.ok, `qty=${String(qty)}`).toBe(false);
      if (!s.ok) expect(s.error).toBe("invalid_quantity");
    }
    expect(e.getState().cargo.ore).toBe(20);
    expect(e.creditsBalance()).toBe(0);
    // Database level: a negative cargo row cannot exist even if code is wrong.
    expect(() =>
      handle.sqlite.prepare(`INSERT INTO game_cargo (space_id, good_id, qty) VALUES ('amounts', 'ore', -3)`).run(),
    ).toThrow();
    expect(() =>
      handle.sqlite
        .prepare(`INSERT INTO game_credits (space_id, balance) VALUES ('amounts-negative', -1)`)
        .run(),
    ).toThrow();
  });

  it("TX-AC-12 ledger reconciliation: after a randomized fuzz, balances recomputed from the ledger match stored state", () => {
    const e = econ("fuzz");
    // Deterministic PRNG so the fuzz is reproducible.
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const kinds = ["belt", "signal", "wreck"] as const;
    for (let i = 0; i < 200; i++) {
      const pick = rnd();
      if (pick < 0.35) {
        e.gather({ nodeId: e.getState().nodes[Math.floor(rnd() * 8)]?.nodeId ?? "belt-1", idempotencyKey: key("fz") });
      } else if (pick < 0.5) {
        if (!e.isDocked()) e.dock();
        else e.undock();
      } else if (pick < 0.7) {
        const good = (["ore", "salvage", "data", "component", "circuit"] as GameGood[])[Math.floor(rnd() * 5)]!;
        const buyer = ["station-exchange", "station-foundry", "salvage-yard", "archive-broker", "fleet-quartermaster"][Math.floor(rnd() * 5)]!;
        e.sell({ buyerId: buyer, good, qty: 1 + Math.floor(rnd() * 5), idempotencyKey: key("fz") });
      } else if (pick < 0.85) {
        const good = (["ore", "salvage", "data"] as GameGood[])[Math.floor(rnd() * 3)]!;
        e.transfer({
          direction: rnd() < 0.5 ? "to-storage" : "to-cargo",
          good,
          qty: 1 + Math.floor(rnd() * 4),
          idempotencyKey: key("fz"),
        });
      } else {
        e.refine({ recipeId: rnd() < 0.5 ? "R-1" : "R-2", idempotencyKey: key("fz") });
      }
      void kinds;
    }
    const rec = e.reconcile();
    expect(rec.discrepancies).toEqual([]);
    expect(rec.ok).toBe(true);
    expect(rec.credits.stored).toBe(rec.credits.computed);
    // A corrupted balance is DETECTED and reported, not silently corrected.
    handle.sqlite.prepare(`UPDATE game_credits SET balance = balance + 7 WHERE space_id = 'fuzz'`).run();
    const corrupt = e.reconcile();
    expect(corrupt.ok).toBe(false);
    expect(corrupt.discrepancies.join(" ")).toContain("credits");
    expect(e.creditsBalance()).toBe(rec.credits.stored + 7); // left as-is for investigation
  });

  it("TX-AC-13 guest: a guest actor cannot execute ANY mutating game action", () => {
    const e = econ("hosted");
    gatherAll(e, "belt");
    e.dock();
    const before = e.getState();
    const attempts = [
      e.gather({ nodeId: "belt-2", idempotencyKey: key("g"), actorKind: "guest" }),
      e.sell({ buyerId: "station-exchange", good: "ore", qty: 1, idempotencyKey: key("s"), actorKind: "guest" }),
      e.refine({ recipeId: "R-1", idempotencyKey: key("r"), actorKind: "guest" }),
      e.transfer({ direction: "to-storage", good: "ore", qty: 1, idempotencyKey: key("t"), actorKind: "guest" }),
      e.dock("guest"),
      e.undock("guest"),
    ];
    for (const a of attempts) {
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.error).toBe("guest_cannot_mutate");
    }
    const after = e.getState();
    expect(after.cargo).toEqual(before.cargo);
    expect(after.storage).toEqual(before.storage);
    expect(after.credits).toBe(before.credits);
    expect(after.docked).toBe(true);
  });

  it("TX-AC-14 test-pool isolation (dormant-era instantiation): one space's mint/demand data never enters another space's reports", () => {
    const a = econ("pool-a");
    const b = econ("pool-b");
    gatherAll(a, "belt");
    a.dock();
    a.sell({ buyerId: "station-exchange", good: "ore", qty: 5, idempotencyKey: key("sell") });
    expect(b.mintedPerDay()).toEqual([]);
    expect(b.creditsBalance()).toBe(0);
    expect(b.buyersGuide().entries.every((x) => x.demandRemaining === null || x.demandRemaining === x.demandCap)).toBe(true);
    expect(a.mintedPerDay().reduce((s, d) => s + d.mintedCredits, 0)).toBe(20);
  });

  it("TX-AC-15 ledger privacy: ledger and reconciliation outputs contain no memory content", () => {
    const marker = "MARKER-PRIVATE-MEMORY-7f3a";
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES ('privacy', 'secret', 'note', ?)`)
      .run(marker);
    const e = econ("privacy");
    gatherAll(e, "belt");
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 2, idempotencyKey: key("sell") });
    const ledgerJson = JSON.stringify(e.ledger(1000));
    expect(ledgerJson).not.toContain(marker);
    expect(JSON.stringify(e.reconcile())).not.toContain(marker);
    expect(JSON.stringify(e.mintedPerDay())).not.toContain(marker);
  });

  it("census: every game_* table exists in the schema AND is listed for brain-deletion (SPACE_SCOPED_TABLES)", () => {
    const tables = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'game_%' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "game_action_results",
      "game_cargo",
      "game_credits",
      "game_demand",
      "game_dock_state",
      "game_ledger",
      "game_periods",
      "game_resource_nodes",
      "game_storage",
    ]);
    for (const t of tables) {
      expect(SPACE_SCOPED_TABLES, `SPACE_SCOPED_TABLES missing ${t.name}`).toContain(t.name);
    }
  });

  it("fuel economy regression guard: G1 activity leaves the existing fuel repo semantics intact", () => {
    const fuel = new EconomyRepo(handle, "regress");
    const start = fuel.get();
    const e = econ("regress");
    gatherAll(e, "belt");
    e.dock();
    e.sell({ buyerId: "station-exchange", good: "ore", qty: 20, idempotencyKey: key("sell") });
    expect(fuel.get()).toBe(start);
    expect(fuel.spend(5)).toBe(true);
    expect(fuel.get()).toBe(start - 5);
    expect(e.creditsBalance()).toBe(80);
  });
});
