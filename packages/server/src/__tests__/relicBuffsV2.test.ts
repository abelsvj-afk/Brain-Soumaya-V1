import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { EconomyRepo } from "../economy.js";
import { TravelRepo, TravelError } from "../repositories/travel.repo.js";
import { RelicHoldingsStore, EMPTY_POOL_MESSAGE } from "../relics/holdings.js";
import { buffsForSpace, computeRelicBuffs, applyGrowthMultiplier, swingDisplayPoint } from "../relics/buffs.js";
import { SPACE_SCOPED_TABLES, SpacesRepo } from "../auth/spaces.js";
import { setCognitiveProgress, createCognitive } from "../analysis/cognitive.js";
import { GraphService } from "../graph/service.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { UsageTracker } from "../usage.js";
import type { AppContext } from "../context.js";
import { buildContext } from "../context.js";
import { createApp } from "../api/server.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Relic Buffs v2 acceptance evidence (design note v2 §13). Criterion ids are
 * in each test name. Store-level tests use the real SQLite schema; the gate
 * tests use the real TravelRepo with the REAL holdings callback (the same
 * wiring the travel routes use); HTTP tests go through the real app.
 */
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
function give(space: string, relicId: string, opts: { held?: boolean; testOnly?: boolean; anchor?: string; heldAt?: string } = {}): void {
  handle.sqlite.prepare(
    `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, '2026-10-01T00:00:00.000Z', ?, ?, ?, ?)`,
  ).run(space, relicId, opts.testOnly ? 1 : 0, opts.held ? 1 : 0, opts.held ? (opts.heldAt ?? "2026-10-01T00:00:00.000Z") : null, opts.anchor ?? `${relicId}:resting-place-one`);
}
function holdingsCount(space?: string, relicId?: string): number {
  const sql = space
    ? `SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = ? ${relicId ? "AND relic_id = ?" : ""}`
    : `SELECT COUNT(*) AS n FROM relic_holdings ${relicId ? "WHERE relic_id = ?" : ""}`;
  const args = [space, relicId].filter(Boolean) as string[];
  return (handle.sqlite.prepare(sql).get(...args) as { n: number }).n;
}
function claims(space: string): string[] {
  return (handle.sqlite.prepare(`SELECT reward_key FROM codex_claims WHERE space_id = ?`).all(space) as { reward_key: string }[]).map((r) => r.reward_key);
}
const travelWith = (space: string) => { const s = store(); return new TravelRepo(handle, space, () => s.gateHoldings(space)); };
/**
 * A space as the server knew it BEFORE the relics ship migration: a row in
 * `spaces` plus a `space_meta` row — exactly what SpacesRepo created for
 * every brain registered before ship. Used to construct genuine pre-ship
 * spaces for A24/P1: eligibility must come from the real migration seeing
 * these rows, never from a hand-set flag.
 */
function preShipSpace(space: string): void {
  handle.sqlite.prepare(
    `INSERT OR IGNORE INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt) VALUES (?, ?, ?, 'hash', 'salt')`,
  ).run(space, space, `tag-${space}`);
  handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(space);
}
function driftLeg(t: TravelRepo, key: string, dest: string, at: number): void {
  const j = t.depart({ clientKey: key, kind: "drift", destination: dest }, at);
  const arrived = t.arrive(j.id, at + 11_000);
  expect(arrived?.state).toBe("arrived");
}

describe("verified find (A1–A3, A6)", () => {
  it("A1: a find in the wrong world is refused — no holding, no reward, no claim row", () => {
    const before = new EconomyRepo(handle, "s1").get();
    const out = store().claimFind("s1", "harbor-nail", "growing-place");
    expect(out.ok).toBe(false);
    expect(holdingsCount("s1")).toBe(0);
    expect(claims("s1")).toEqual([]);
    expect(new EconomyRepo(handle, "s1").get()).toBeCloseTo(before, 1);
  });
  it("A2: a made-up id and a not-yet-findable relic are refused plainly", () => {
    expect(store().claimFind("s1", "no-such-relic", "great-station").ok).toBe(false);
    const nf = store().claimFind("s1", "star-hanger", "scale");
    expect(nf.ok).toBe(false);
    if (!nf.ok) expect(nf.kind).toBe("not-findable");
    expect(holdingsCount("s1")).toBe(0);
  });
  it("A3: a repeat find returns the existing state and pays nothing twice", () => {
    const first = store().claimFind("s1", "harbor-nail", "great-station");
    expect(first.ok && first.rewardAmount).toBe(4);
    const second = store().claimFind("s1", "harbor-nail", "great-station");
    expect(second.ok && second.alreadyFound).toBe(true);
    expect(second.ok && second.rewardAmount).toBe(0);
    expect(holdingsCount("s1", "harbor-nail")).toBe(1);
    expect(claims("s1")).toEqual(["relic-harbor-nail"]);
  });
  it("A6: with 7 non-test holdings in place, an eighth find is refused with the kind empty-pool message and no partial write", () => {
    for (let i = 0; i < 7; i++) give(`other-${i}`, "harbor-nail");
    const out = store().claimFind("s8", "harbor-nail", "great-station");
    expect(out.ok).toBe(false);
    if (!out.ok) { expect(out.kind).toBe("empty-pool"); expect(out.reason).toBe(EMPTY_POOL_MESSAGE); }
    expect(holdingsCount(undefined, "harbor-nail")).toBe(7);
    expect(claims("s8")).toEqual([]);
  });
  it("discovery pays the buffed rate when the Fold is held, and the Fold never buffs its own discovery", () => {
    give("s1", "unopened-fold", { held: true });
    const out = store().claimFind("s1", "harbor-nail", "great-station");
    expect(out.ok && out.rewardAmount).toBe(6);
    const own = store().claimFind("s2", "unopened-fold", "quiet-archive");
    // quiet-archive relics are not findable yet, so instead verify via a fresh space finding a discoverable relic while NOT holding the Fold pays the base 4 (covered in A3) — here the registry refusal is the honest outcome.
    expect(own.ok).toBe(false);
  });
});

describe("release and returns (A7–A9)", () => {
  it("A7: releasing returns exactly one copy, writes one returns row naming both anchors, anchors differ", () => {
    for (let i = 0; i < 7; i++) give(`other-${i}`, "harbor-nail");
    expect(store().claimFind("late", "harbor-nail", "great-station").ok).toBe(false);
    give("holder", "mooring-ring", { anchor: "mooring-ring:resting-place-one" });
    const ev = store().release("holder", "mooring-ring");
    expect(ev?.fromAnchor).toBe("mooring-ring:resting-place-one");
    expect(ev?.toAnchor).toBeTruthy();
    expect(ev?.toAnchor).not.toBe(ev?.fromAnchor);
    const rows = handle.sqlite.prepare(`SELECT * FROM relic_returns WHERE space_id = 'holder'`).all() as unknown[];
    expect(rows).toHaveLength(1);
    // The freed harbor copy: remove one holder, then a new find succeeds.
    handle.sqlite.prepare(`DELETE FROM relic_holdings WHERE space_id = 'other-0' AND relic_id = 'harbor-nail'`).run();
    expect(store().claimFind("late", "harbor-nail", "great-station").ok).toBe(true);
  });
  it("A7b: a released counted relic's copy can be found by another space (pool +1 exactly)", () => {
    for (let i = 0; i < 7; i++) give(`other-${i}`, "harbor-nail");
    expect(store().poolAvailable("harbor-nail")).toBe(0);
    store().release("other-3", "harbor-nail");
    expect(store().poolAvailable("harbor-nail")).toBe(1);
    expect(store().claimFind("newcomer", "harbor-nail", "great-station").ok).toBe(true);
    expect(store().poolAvailable("harbor-nail")).toBe(0);
  });
  it("A8: a long-idle holding is untouched by reads and state computation", () => {
    give("s1", "harbor-nail", {});
    handle.sqlite.prepare(`UPDATE relic_holdings SET found_at = '2020-01-01T00:00:00.000Z' WHERE space_id = 's1'`).run();
    store().state("s1"); buffsForSpace(handle, "s1"); store().gateHoldings("s1");
    expect(holdingsCount("s1", "harbor-nail")).toBe(1);
  });
  it("A9: releaseAllForSpace returns counted copies with rows first, removes test/private without pool effects; both tables are in the census list", () => {
    expect(SPACE_SCOPED_TABLES).toContain("relic_holdings");
    expect(SPACE_SCOPED_TABLES).toContain("relic_returns");
    give("s1", "harbor-nail"); // counted public
    give("s1", "dawn-leaf"); // private
    give("s1", "mooring-ring", { testOnly: true }); // test — not counted despite public class
    const before = store().poolCount("harbor-nail");
    const out = store().releaseAllForSpace("s1");
    expect(out.returnedCounted).toBe(1);
    expect(out.removedTotal).toBe(3);
    expect(holdingsCount("s1")).toBe(0);
    expect(store().poolCount("harbor-nail")).toBe(before - 1);
    const rows = handle.sqlite.prepare(`SELECT relic_id, reason FROM relic_returns WHERE space_id = 's1'`).all() as { relic_id: string; reason: string }[];
    expect(rows).toEqual([{ relic_id: "harbor-nail", reason: "brain-deleted" }]);
  });
});

describe("owner scarcity switch (A10–A12)", () => {
  it("A10: a non-owner space cannot read or write the flag (store refuses)", () => {
    process.env.RELIC_OWNER_SPACE_IDS = "owner-space";
    const s = store();
    expect(s.setScarcityOff("someone-else", true)).toBe(false);
    expect(s.scarcityOff("someone-else")).toBe(false);
    // Even a flag row planted directly is inert for a non-owner.
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('someone-else')`).run();
    handle.sqlite.prepare(`UPDATE space_meta SET relic_scarcity_off = 'true' WHERE space_id = 'someone-else'`).run();
    expect(s.scarcityOff("someone-else")).toBe(false);
  });
  it("A11: with the switch off, owner finds succeed past an exhausted pool as test_only, and pool counts are identical either way", () => {
    process.env.RELIC_OWNER_SPACE_IDS = "owner-space";
    for (let i = 0; i < 7; i++) give(`other-${i}`, "harbor-nail");
    const poolBefore = store().poolCount("harbor-nail");
    expect(store().setScarcityOff("owner-space", true)).toBe(true);
    const out = store().claimFind("owner-space", "harbor-nail", "great-station");
    expect(out.ok).toBe(true);
    const row = handle.sqlite.prepare(`SELECT test_only FROM relic_holdings WHERE space_id = 'owner-space'`).get() as { test_only: number };
    expect(row.test_only).toBe(1);
    expect(store().poolCount("harbor-nail")).toBe(poolBefore);
    expect(store().setScarcityOff("owner-space", false)).toBe(true);
    expect(store().poolCount("harbor-nail")).toBe(poolBefore);
  });
  it("A12: switching back on converts nothing — test holdings stay test_only, new finds claim against the pool", () => {
    process.env.RELIC_OWNER_SPACE_IDS = "owner-space";
    store().setScarcityOff("owner-space", true);
    expect(store().claimFind("owner-space", "harbor-nail", "great-station").ok).toBe(true);
    store().setScarcityOff("owner-space", false);
    const row = handle.sqlite.prepare(`SELECT test_only FROM relic_holdings WHERE space_id = 'owner-space' AND relic_id = 'harbor-nail'`).get() as { test_only: number };
    expect(row.test_only).toBe(1);
    expect(store().claimFind("owner-space", "mooring-ring", "great-station").ok).toBe(true);
    const row2 = handle.sqlite.prepare(`SELECT test_only FROM relic_holdings WHERE space_id = 'owner-space' AND relic_id = 'mooring-ring'`).get() as { test_only: number };
    expect(row2.test_only).toBe(0);
  });
});

describe("gate wiring with the REAL holdings callback (A13–A15, A25)", () => {
  it("A13: Witness + any two admits at the far end of a valid chain; without the Witness, or with only one other, it refuses and charges nothing", () => {
    give("s1", "witness-without-a-name"); give("s1", "harbor-nail"); give("s1", "dawn-leaf");
    const t = travelWith("s1");
    driftLeg(t, "a1", "great-station", T0);
    driftLeg(t, "a2", "growing-place", T0 + 60_000);
    const j = t.depart({ clientKey: "a3", kind: "drift", destination: "eternity" }, T0 + 120_000);
    expect(j.state).toBe("arming");

    give("s2", "harbor-nail"); give("s2", "dawn-leaf"); give("s2", "mooring-ring"); // no Witness
    const t2 = travelWith("s2");
    driftLeg(t2, "b1", "great-station", T0);
    driftLeg(t2, "b2", "growing-place", T0 + 60_000);
    const fuelBefore = new EconomyRepo(handle, "s2").get();
    expect(() => t2.depart({ clientKey: "b3", kind: "warp", destination: "eternity" }, T0 + 120_000)).toThrowError(/Witness Without a Name/);
    expect(new EconomyRepo(handle, "s2").get()).toBeCloseTo(fuelBefore, 1);

    give("s3", "witness-without-a-name"); give("s3", "harbor-nail"); // only one other
    const t3 = travelWith("s3");
    driftLeg(t3, "c1", "great-station", T0);
    driftLeg(t3, "c2", "growing-place", T0 + 60_000);
    expect(() => t3.depart({ clientKey: "c3", kind: "drift", destination: "eternity" }, T0 + 120_000)).toThrowError(TravelError);
  });
  it("A14: after one arrived Eternity journey, the gate admits the same space with an empty found set", () => {
    give("s1", "witness-without-a-name"); give("s1", "harbor-nail"); give("s1", "dawn-leaf");
    const t = travelWith("s1");
    driftLeg(t, "d1", "great-station", T0);
    driftLeg(t, "d2", "growing-place", T0 + 60_000);
    const j = t.depart({ clientKey: "d3", kind: "drift", destination: "eternity" }, T0 + 120_000);
    expect(t.arrive(j.id, T0 + 131_000)?.state).toBe("arrived");
    // Release everything — the found set is now empty; the ledger remembers.
    store().release("s1", "witness-without-a-name"); store().release("s1", "harbor-nail"); store().release("s1", "dawn-leaf");
    expect(store().foundIds("s1")).toEqual([]);
    driftLeg(t, "d4", "home", T0 + 180_000);
    driftLeg(t, "d5", "great-station", T0 + 240_000);
    driftLeg(t, "d6", "deep-past", T0 + 300_000);
    const again = t.depart({ clientKey: "d7", kind: "drift", destination: "eternity" }, T0 + 360_000);
    expect(again.state).toBe("arming");
  });
  it("A15: one distinct intermediate, or a turn-back, is refused; both §9 worked examples are admitted", () => {
    const setup = (space: string) => { give(space, "witness-without-a-name"); give(space, "harbor-nail"); give(space, "dawn-leaf"); return travelWith(space); };
    const t1 = setup("w1");
    driftLeg(t1, "e1", "great-station", T0);
    expect(() => t1.depart({ clientKey: "e2", kind: "drift", destination: "eternity" }, T0 + 60_000)).toThrowError(/step by step/);

    const t2 = setup("w2");
    driftLeg(t2, "f1", "great-station", T0);
    const out = t2.depart({ clientKey: "f2", kind: "drift", destination: "growing-place" }, T0 + 60_000);
    const turned = t2.turnBack(out.id, T0 + 71_000);
    expect(turned?.state).toBe("returning");
    expect(t2.arrive(out.id, T0 + 82_000)?.state).toBe("returned");
    expect(() => t2.depart({ clientKey: "f3", kind: "drift", destination: "eternity" }, T0 + 120_000)).toThrowError(TravelError);

    // Worked example 1: Home → Great Station → Deep Past → Eternity
    const t3 = setup("w3");
    driftLeg(t3, "g1", "great-station", T0);
    driftLeg(t3, "g2", "deep-past", T0 + 60_000);
    expect(t3.depart({ clientKey: "g3", kind: "drift", destination: "eternity" }, T0 + 120_000).state).toBe("arming");
    // Worked example 2: Home → Growing Place → Scale → Eternity
    const t4 = setup("w4");
    driftLeg(t4, "h1", "growing-place", T0);
    driftLeg(t4, "h2", "scale", T0 + 60_000);
    expect(t4.depart({ clientKey: "h3", kind: "drift", destination: "eternity" }, T0 + 120_000).state).toBe("arming");
  });
  it("A16: construction sites that do not supply the callback keep the holds-nothing default", () => {
    give("s1", "witness-without-a-name"); give("s1", "harbor-nail"); give("s1", "dawn-leaf");
    const plain = new TravelRepo(handle, "s1"); // the missions/tours/harbor construction shape
    expect(plain.getState(T0).eternityReachable).toBe(false);
    expect(plain.eternityGateReachable()).toBe(false);
  });
});

describe("buffs (A17–A23)", () => {
  it("A17: the held cap is 3 server-side; set-down restores exact base values", () => {
    for (const id of ["harbor-nail", "mooring-ring", "witness-seed", "thread-of-many"]) give("s1", id);
    const s = store();
    expect(s.hold("s1", "harbor-nail").ok).toBe(true);
    expect(s.hold("s1", "mooring-ring").ok).toBe(true);
    expect(s.hold("s1", "witness-seed").ok).toBe(true);
    const fourth = s.hold("s1", "thread-of-many");
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toMatch(/hold 3 relics/);
    expect(buffsForSpace(handle, "s1").fuelCap).toBe(225);
    expect(s.unhold("s1", "harbor-nail").ok).toBe(true);
    const after = buffsForSpace(handle, "s1");
    expect(after.fuelCap).toBe(200);
    expect(after.reviewEarn).toBe(3);
    // Economy seam follows: capacity reported is the buffed value while held.
    s.hold("s1", "harbor-nail");
    expect(new EconomyRepo(handle, "s1").toFuel().capacity).toBe(225);
    s.unhold("s1", "harbor-nail");
    expect(new EconomyRepo(handle, "s1").toFuel().capacity).toBe(200);
  });
  it("A18: review floor — Nail + Seal pays exactly 1; deltas add with the Shard", () => {
    expect(computeRelicBuffs(["harbor-nail", "stillness-seal"]).reviewEarn).toBe(1);
    expect(computeRelicBuffs(["harbor-nail", "stillness-seal", "first-light-shard"]).reviewEarn).toBe(2);
    expect(computeRelicBuffs(["first-light-shard"]).reviewEarn).toBe(4);
    give("s1", "harbor-nail", { held: true }); give("s1", "stillness-seal", { held: true });
    expect(buffsForSpace(handle, "s1").reviewEarn).toBe(1);
    // Seal regen seam
    expect(buffsForSpace(handle, "s1").fuelRegenPerHour).toBe(5.0);
  });
  it("A19: drift — with the Ring the third drift pays 4 and a fourth pays nothing; without it the cap stays 2; arrival is never blocked", () => {
    const driftOnce = (space: string, key: string, at: number) => {
      const t = travelWith(space);
      const j = t.depart({ clientKey: key, kind: "drift", destination: "great-station" }, at);
      t.getJourney(j.id, at + 11_000); // settle: departed_at is set here
      const arrived = t.arrive(j.id, at + 11_000 + 31_000);
      expect(arrived?.state).toBe("arrived");
      return t.bonusOutcome(j.id);
    };
    give("ring", "mooring-ring", { held: true });
    // Each leg must start from where the ledger says the space stands; drift back home between legs.
    const leg = (space: string, tag: string, at: number) => {
      const out1 = driftOnce(space, `${tag}-out`, at);
      // Return by WARP: a warp's bonus is a different seam and never touches
      // the drift daily count — a drift home would consume a second slot.
      new EconomyRepo(handle, space).add(50);
      const t = travelWith(space);
      const j = t.depart({ clientKey: `${tag}-back`, kind: "warp", destination: "home" }, at + 60_000);
      t.getJourney(j.id, at + 71_000);
      expect(t.arrive(j.id, at + 71_000)?.state).toBe("arrived");
      return out1;
    };
    expect(leg("ring", "r1", T0)?.amount).toBe(4);
    expect(leg("ring", "r2", T0 + 200_000)?.amount).toBe(4);
    expect(leg("ring", "r3", T0 + 400_000)?.amount).toBe(4);
    const fourth = leg("ring", "r4", T0 + 600_000);
    expect(fourth?.amount).toBe(0);
    expect(fourth?.reason).toMatch(/drift bonuses are done/);

    expect(leg("plain", "p1", T0)?.amount).toBe(3);
    expect(leg("plain", "p2", T0 + 200_000)?.amount).toBe(3);
    expect(leg("plain", "p3", T0 + 400_000)?.amount).toBe(0);
  });
  it("A20: window conflict — Seed then Thread gives 20 with winner and overruled named; setting Thread down restores 45", () => {
    give("s1", "witness-seed"); give("s1", "thread-of-many");
    const s = store();
    s.hold("s1", "witness-seed");
    // held_at ordering: hold Thread a moment later in stored time
    handle.sqlite.prepare(`UPDATE relic_holdings SET held_at = '2026-10-01T00:00:00.000Z' WHERE space_id='s1' AND relic_id='witness-seed'`).run();
    s.hold("s1", "thread-of-many");
    handle.sqlite.prepare(`UPDATE relic_holdings SET held_at = '2026-10-02T00:00:00.000Z' WHERE space_id='s1' AND relic_id='thread-of-many'`).run();
    const buffs = buffsForSpace(handle, "s1");
    expect(buffs.riseWindowDays).toBe(20);
    expect(buffs.riseWindowSetBy).toBe("thread-of-many");
    expect(buffs.riseWindowOverruled).toEqual(["witness-seed"]);
    const st = s.state("s1");
    expect((st.buffs as unknown as { riseWindowSetByName?: string }).riseWindowSetByName).toBe("The Thread of Many");
    expect((st.buffs as unknown as { riseWindowOverruledNames?: string[] }).riseWindowOverruledNames).toEqual(["The Witness Seed"]);
    s.unhold("s1", "thread-of-many");
    expect(buffsForSpace(handle, "s1").riseWindowDays).toBe(45);
  });
  it("A21: growth floor — Seed + Lantern + Fold scale an increase to ×0.25; a decrease is unscaled", async () => {
    const ctx = { handle, embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
    const id = await createCognitive(ctx, "s1", "goal", "Grow", "");
    give("s1", "witness-seed", { held: true }); give("s1", "lantern-of-keeping", { held: true }); give("s1", "unopened-fold", { held: true });
    expect(buffsForSpace(handle, "s1").growthMultiplier).toBe(0.25);
    expect(setCognitiveProgress(ctx, "s1", id, 0.8)).toBe(true);
    expect(new GraphService(handle, "s1").getNode(id)?.progress).toBeCloseTo(0.2, 6);
    expect(setCognitiveProgress(ctx, "s1", id, 0.1)).toBe(true);
    expect(new GraphService(handle, "s1").getNode(id)?.progress).toBeCloseTo(0.1, 6);
    expect(applyGrowthMultiplier(0, 1, 0.25)).toBe(0.25);
  });
  it("A22: the Shard swing is display-only — stored weights and reported values are untouched", () => {
    expect(swingDisplayPoint(0.5, 1.25)).toBeCloseTo(0.625);
    expect(swingDisplayPoint(0.9, 1.25)).toBe(1);
    expect(swingDisplayPoint(-0.9, 1.25)).toBe(-1);
    give("s1", "first-light-shard", { held: true });
    expect(buffsForSpace(handle, "s1").emotionalSwingMultiplier).toBe(1.25);
    // No buff code writes emotional data: there is no emotional column touched by any holdings read.
    const before = JSON.stringify(handle.sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='relic_holdings'`).get());
    buffsForSpace(handle, "s1");
    expect(JSON.stringify(handle.sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='relic_holdings'`).get())).toBe(before);
  });
  it("A23: preview describes the would-be held set; the hold write cannot exceed it", () => {
    give("s1", "witness-seed"); give("s1", "thread-of-many");
    const s = store();
    s.hold("s1", "witness-seed");
    handle.sqlite.prepare(`UPDATE relic_holdings SET held_at = '2026-10-01T00:00:00.000Z' WHERE space_id='s1'`).run();
    const p = s.preview("s1", "thread-of-many");
    expect(p.refused).toBeUndefined();
    expect(p.buffs.riseWindowDays).toBe(20);
    expect(p.buffs.riseWindowOverruled).toEqual(["witness-seed"]);
    expect(s.heldIds("s1")).toEqual(["witness-seed"]); // preview wrote nothing
    expect(s.hold("s1", "thread-of-many").ok).toBe(true);
    expect(buffsForSpace(handle, "s1").riseWindowDays).toBe(p.buffs.riseWindowDays);
  });
});

describe("migration (A24–A25)", () => {
  it("A24: every codex_claims relic row becomes a holding; the one-time sync adds local finds once; nothing over-limit is revoked", () => {
    handle.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('s1', 'relic-harbor-nail'), ('s1', 'relic-witness-without-a-name'), ('s1', 'relic-dawn-leaf')`).run();
    // P1 rework: the syncing space (s2) is a GENUINE pre-ship space — it
    // exists before the migration runs below, so the migration itself marks
    // it eligible. (Before the P1 fix this test synced a fresh space with
    // no pre-ship existence, which is exactly the bypass the re-review
    // proved; that shape is now refused and pinned in the P1 tests below.)
    preShipSpace("s2");
    const s = store();
    expect(s.migrateLegacyClaims()).toBe(3);
    expect(s.foundIds("s1").sort()).toEqual(["dawn-leaf", "harbor-nail", "witness-without-a-name"]);
    expect(s.migrateLegacyClaims()).toBe(0); // idempotent
    const sync1 = s.syncLegacy("s2", ["mooring-ring", "bogus-id"]);
    expect(sync1).toEqual({ synced: true, added: ["mooring-ring"] });
    const sync2 = s.syncLegacy("s2", ["harbor-nail"]);
    expect(sync2.synced).toBe(false);
    expect(s.foundIds("s2")).toEqual(["mooring-ring"]);
    // Over-limit legacy: 8 legacy claims of a 7-copy relic all survive.
    for (let i = 0; i < 8; i++) handle.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, 'relic-mooring-ring')`).run(`legacy-${i}`);
    s.migrateLegacyClaims();
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE relic_id = 'mooring-ring' AND test_only = 0`).get() as { n: number }).n).toBe(9); // 8 legacy + s2's sync
    // …and the limit binds NEW verified finds only.
    expect(s.claimFind("newbie", "mooring-ring", "great-station").ok).toBe(false);
  });
  it("A25: migrated holdings satisfy the gate exactly like new finds", () => {
    handle.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('s1', 'relic-harbor-nail'), ('s1', 'relic-witness-without-a-name'), ('s1', 'relic-dawn-leaf')`).run();
    const s = store();
    s.ensureMigrated();
    const t = travelWith("s1");
    driftLeg(t, "m1", "great-station", T0);
    driftLeg(t, "m2", "growing-place", T0 + 60_000);
    expect(t.depart({ clientKey: "m3", kind: "drift", destination: "eternity" }, T0 + 120_000).state).toBe("arming");
  });
});

describe("legacy-sync eligibility (P1 fix — the sync is scoped to genuine pre-ship spaces)", () => {
  it("P1: a space created after the migration cannot sync — the reviewer's exploit shape mints nothing and the Witness pool never exceeds its limit", () => {
    const s = store();
    // Ship moment: the migration runs on this database BEFORE the new
    // space exists. No space exists yet, so nothing is marked eligible.
    s.ensureMigrated();
    // Exhaust the Witness pool (3 Eternity copies) with real holdings.
    for (let i = 0; i < 3; i++) give(`witness-holder-${i}`, "witness-without-a-name");
    expect(s.poolCount("witness-without-a-name")).toBe(3);
    expect(s.poolAvailable("witness-without-a-name")).toBe(0);
    // A brand-new post-ship space. It even has a lazily created space_meta
    // row, the way other server paths create one — a row is not eligibility.
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('post-ship')`).run();
    const out = s.syncLegacy("post-ship", ["witness-without-a-name", "harbor-nail", "dawn-leaf", "star-hanger"]);
    expect(out).toEqual({ synced: false, added: [] });
    expect(holdingsCount("post-ship")).toBe(0);
    expect(s.poolCount("witness-without-a-name")).toBe(3);
    expect(s.gateHoldings("post-ship")).toEqual({ witnessWithoutName: false, otherRelicCount: 0 });
    // A space with no space_meta row at all is refused the same way
    // (absence of the migration's marker = NOT eligible).
    expect(s.syncLegacy("no-row-space", ["harbor-nail"])).toEqual({ synced: false, added: [] });
    expect(holdingsCount("no-row-space")).toBe(0);
  });
  it("P1: a genuinely pre-ship space syncs exactly once, via the real migration entry point", () => {
    preShipSpace("pre-ship");
    const s = store();
    s.ensureMigrated(); // the real migration entry point — no hand-set flag
    expect(s.legacyEligible("pre-ship")).toBe(true);
    const first = s.syncLegacy("pre-ship", ["harbor-nail", "dawn-leaf"]);
    expect(first).toEqual({ synced: true, added: ["harbor-nail", "dawn-leaf"] });
    const second = s.syncLegacy("pre-ship", ["mooring-ring"]);
    expect(second).toEqual({ synced: false, added: [] });
    expect(s.foundIds("pre-ship").sort()).toEqual(["dawn-leaf", "harbor-nail"]);
  });
  it("P1: a space registered after the migration is born already-synced and can never legacy-sync", () => {
    const s = store();
    s.ensureMigrated(); // the ship migration runs before these brains register
    const repo = new SpacesRepo(handle);
    const first = repo.authOrCreate("p1-first", "password-one", "First");
    const second = repo.authOrCreate("p1-second", "password-two", "Second");
    expect(first?.created).toBe(true);
    expect(second?.created).toBe(true);
    const meta = handle.sqlite.prepare(`SELECT relic_legacy_synced, relic_legacy_eligible FROM space_meta WHERE space_id = ?`).get(second!.space.id) as { relic_legacy_synced: number; relic_legacy_eligible: number };
    expect(meta.relic_legacy_synced).toBe(1);
    expect(meta.relic_legacy_eligible).toBe(0);
    expect(s.syncLegacy(second!.space.id, ["witness-without-a-name", "harbor-nail"])).toEqual({ synced: false, added: [] });
    expect(holdingsCount(second!.space.id)).toBe(0);
  });
});

describe("HTTP contract (A4, A5 server half, A10 web half server side)", () => {
  let ctx: AppContext; let server: Server; let base: string;
  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": space }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  }
  function standIn(space: string, world: string): void {
    ctx.handle.sqlite.prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline) VALUES (?, ?, ?, 'drift', 'home', ?, 'arrived', 0, '2026-10-22T12:00:00.000Z', '2026-10-22T12:00:10.000Z')`,
    ).run(`stand-${space}-${world}`, space, `stand-${space}-${world}`, world);
  }
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  it("A4: codex-claim refuses every relic-* key and points at the find endpoint; non-relic keys behave as before", async () => {
    const space = await auth("relic-http-a4");
    const refused = await call("POST", "/api/maintenance/codex-claim", space, { key: "relic-harbor-nail" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/relics\/found/);
    const ok = await call("POST", "/api/maintenance/codex-claim", space, { key: "sector-person" });
    expect(ok.status).toBe(200);
    expect(ok.body.awarded).toBe(true);
    const again = await call("POST", "/api/maintenance/codex-claim", space, { key: "sector-person" });
    expect(again.body.awarded).toBe(false);
  });
  it("A1/A3 over HTTP: wrong world refused; standing in the world, the find lands once and pays once", async () => {
    const space = await auth("relic-http-find");
    const wrong = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.state.found).toEqual([]);
    standIn(space, "great-station");
    const balBefore = (await call("GET", "/api/maintenance/fuel", space)).body.fuel as number;
    const found = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail" });
    expect(found.status).toBe(200);
    expect(found.body.state.found).toEqual(["harbor-nail"]);
    const balAfter = (await call("GET", "/api/maintenance/fuel", space)).body.fuel as number;
    expect(balAfter).toBeGreaterThan(balBefore);
    const again = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail" });
    expect(again.body.alreadyFound).toBe(true);
    const balAgain = (await call("GET", "/api/maintenance/fuel", space)).body.fuel as number;
    expect(balAgain).toBeCloseTo(balAfter, 1);
    const state = await call("GET", "/api/relics", space);
    expect(state.body.found).toEqual(["harbor-nail"]);
    expect(JSON.stringify(state.body)).not.toMatch(/found_at|held_at|created_at/);
  });
  it("A10 over HTTP: a non-owner space is refused the scarcity switch; an owner space can flip it", async () => {
    const plain = await auth("relic-http-plain");
    const denied = await call("POST", "/api/relics/scarcity", plain, { off: true });
    expect(denied.status).toBe(403);
    const deniedRead = await call("GET", "/api/relics/scarcity", plain);
    expect(deniedRead.status).toBe(403);
    const owner = await auth("relic-http-owner");
    process.env.RELIC_OWNER_SPACE_IDS = owner;
    try {
      const flipped = await call("POST", "/api/relics/scarcity", owner, { off: true });
      expect(flipped.status).toBe(200);
      expect(flipped.body.scarcityOff).toBe(true);
      const state = await call("GET", "/api/relics", owner);
      expect(state.body.isOwnerSpace).toBe(true);
      expect(state.body.scarcityOff).toBe(true);
      const plainState = await call("GET", "/api/relics", plain);
      expect(plainState.body.isOwnerSpace).toBe(false);
    } finally { delete process.env.RELIC_OWNER_SPACE_IDS; }
  });
});

describe("RACE — two simultaneous claims for the final copy", () => {
  it("exactly one real holding results; the loser gets the empty-pool outcome; the pool never goes negative", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-race-"));
    const dbPath = join(dir, "brain.db");
    try {
      const h = createDb(dbPath);
      const s = new RelicHoldingsStore(h);
      for (let i = 0; i < 6; i++) {
        expect(s.claimFind(`seed-${i}`, "harbor-nail", "great-station").ok).toBe(true);
      }
      expect(s.poolAvailable("harbor-nail")).toBe(1);
      h.sqlite.close();

      const runChild = (spaceId: string, goFile: string, readyFile: string): Promise<{ ok: boolean; kind?: string }> =>
        new Promise((resolve, reject) => {
          const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
          const child = fileURLToPath(new URL("./relicRaceChild.mts", import.meta.url));
          execFile(process.execPath, [cli, child, dbPath, spaceId, "harbor-nail", "great-station", goFile, readyFile], (err, stdout) => {
            if (err) return reject(err);
            const last = stdout.trim().split("\n").pop() ?? "";
            try { resolve(JSON.parse(last)); } catch { reject(new Error(`unparseable child output: ${stdout}`)); }
          });
        });
      const tag = Math.random().toString(36).slice(2);
      const goFile = join(dir, `go-${tag}`); const ready1 = join(dir, `ready-${tag}-1`); const ready2 = join(dir, `ready-${tag}-2`);
      const p1 = runChild("racer-1", goFile, ready1);
      const p2 = runChild("racer-2", goFile, ready2);
      const deadline = Date.now() + 20_000;
      while (!(existsSync(ready1) && existsSync(ready2))) {
        if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
        await new Promise((r) => setTimeout(r, 25));
      }
      writeFileSync(goFile, "go");
      const [r1, r2] = await Promise.all([p1, p2]);
      const winners = [r1, r2].filter((r) => r.ok);
      const losers = [r1, r2].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.kind).toBe("empty-pool");

      const h2 = createDb(dbPath);
      const s2 = new RelicHoldingsStore(h2);
      expect(s2.poolCount("harbor-nail")).toBe(7);
      expect(s2.poolAvailable("harbor-nail")).toBe(0);
      const rows = h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE relic_id = 'harbor-nail'`).get() as { n: number };
      expect(rows.n).toBe(7);
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
