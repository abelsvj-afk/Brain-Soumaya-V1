import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import {
  EconomyRepo,
  FUEL_START,
  FUEL_CAP,
  EARN_MEMORY,
  WARP_COST,
  EARN_JOURNEY_COMPLETE,
  EARN_JOURNEY_DRIFT,
} from "../economy.js";

/**
 * P2-1 (Worlds Phase 2): the warp-spend fuel primitive.
 * Journey-bonus constants are covered here as ECONOMICS invariants only —
 * crediting itself is implemented in P2-4 against the P2-2 journey ledger.
 * Regen behavior is covered by features.test.ts and is untouched by P2-1.
 */
let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("warp spend primitive", () => {
  it("debits exactly WARP_COST from a fresh balance", () => {
    const econ = new EconomyRepo(handle, "warpA");
    expect(econ.spendWarp()).toBe(true);
    expect(econ.get()).toBe(FUEL_START - WARP_COST);
  });

  it("refuses when the balance can't cover a warp — and changes nothing", () => {
    const econ = new EconomyRepo(handle, "warpB");
    expect(econ.spend(FUEL_START - WARP_COST + 1)).toBe(true); // leaves WARP_COST - 1
    expect(econ.get()).toBe(WARP_COST - 1);
    expect(econ.canWarp()).toBe(false);
    expect(econ.spendWarp()).toBe(false);
    expect(econ.get()).toBe(WARP_COST - 1); // untouched on refusal
  });

  it("never drives the balance negative across repeated warps", () => {
    const econ = new EconomyRepo(handle, "warpC");
    let spent = 0;
    while (econ.spendWarp()) spent++;
    expect(spent).toBe(Math.floor(FUEL_START / WARP_COST));
    expect(econ.get()).toBe(FUEL_START - spent * WARP_COST);
    expect(econ.get()).toBeGreaterThanOrEqual(0);
  });

  it("canWarp tracks the balance across earning and spending", () => {
    const econ = new EconomyRepo(handle, "warpD");
    expect(econ.canWarp()).toBe(true); // FUEL_START covers a warp
    econ.spendWarp();
    econ.spendWarp();
    expect(econ.canWarp()).toBe(false); // 5 left — not enough
    econ.add(EARN_MEMORY);
    expect(econ.canWarp()).toBe(true); // a captured memory funds the next warp
  });

  it("earnings still saturate at the cap with the travel constants present", () => {
    const econ = new EconomyRepo(handle, "warpE");
    econ.add(10_000);
    expect(econ.get()).toBe(FUEL_CAP);
  });

  it("toFuel exposes warpCost from the shared constants", () => {
    const econ = new EconomyRepo(handle, "warpF");
    expect(econ.toFuel().warpCost).toBe(WARP_COST);
    expect(econ.toFuel().capacity).toBe(FUEL_CAP);
  });
});

describe("journey-bonus economics (D-33 invariants)", () => {
  it("one captured memory funds a warp with change", () => {
    expect(WARP_COST).toBeLessThan(EARN_MEMORY);
  });

  it("a warp can never net positive — journeys rebate, they don't farm", () => {
    expect(EARN_JOURNEY_COMPLETE).toBeLessThan(WARP_COST);
  });

  it("the drift bonus is the smaller patience reward", () => {
    expect(EARN_JOURNEY_DRIFT).toBeGreaterThan(0);
    expect(EARN_JOURNEY_DRIFT).toBeLessThan(EARN_JOURNEY_COMPLETE);
  });
});
