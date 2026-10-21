import { describe, it, expect } from "vitest";
import { decideTubeSync, tubeSyncMinIntervalMs, TUBE_HARD_EPS, TUBE_NEAR_EPS } from "./tubeSync.js";

/**
 * Galaxy fluidity (2026-10-21): the tube-sync policy that replaced
 * Graph3D's inline near/far decision in `linkPositionUpdateCb`. The stakes
 * are asymmetric: syncing too often is the S1 per-frame cost problem; syncing
 * too rarely (or never) is frozen/misaligned tubes. These tests pin both
 * directions — the budget (rate gate, shard backstops) AND the correctness
 * floor (first build always, hard-drift always, bounded staleness always).
 */

const HARD2 = TUBE_HARD_EPS * TUBE_HARD_EPS;
const NEAR2 = TUBE_NEAR_EPS * TUBE_NEAR_EPS;

describe("tubeSyncMinIntervalMs", () => {
  it("derives the interval from the cap with renderRateCap's slack", () => {
    expect(tubeSyncMinIntervalMs(30)).toBeCloseTo(1000 / 30 - 1.5);
    expect(tubeSyncMinIntervalMs(45)).toBeCloseTo(1000 / 45 - 1.5);
    expect(tubeSyncMinIntervalMs(60)).toBeCloseTo(1000 / 60 - 1.5);
  });

  it("bogus caps never gate (interval 0)", () => {
    expect(tubeSyncMinIntervalMs(0)).toBe(0);
    expect(tubeSyncMinIntervalMs(-30)).toBe(0);
    expect(tubeSyncMinIntervalMs(Number.NaN)).toBe(0);
    expect(tubeSyncMinIntervalMs(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("decideTubeSync — correctness floor", () => {
  it("never synced → sync, both tiers", () => {
    for (const tier of ["near", "far"] as const) {
      expect(decideTubeSync({ tier, driftSq: null, nowMs: 1000, lastSyncMs: null, shardKey: 1, fpsCap: 30 })).toBe(true);
      expect(decideTubeSync({ tier, driftSq: 0, nowMs: 1000, lastSyncMs: null, shardKey: 1, fpsCap: 30 })).toBe(true);
      expect(decideTubeSync({ tier, driftSq: null, nowMs: 1000, lastSyncMs: 500, shardKey: 1, fpsCap: 30 })).toBe(true);
    }
  });

  it("hard drift syncs immediately in both tiers, even inside the rate window", () => {
    for (const tier of ["near", "far"] as const) {
      expect(
        decideTubeSync({ tier, driftSq: HARD2 + 0.01, nowMs: 1001, lastSyncMs: 1000, shardKey: 1, fpsCap: 30 }),
      ).toBe(true);
    }
  });

  it("drift exactly at the hard epsilon is NOT an emergency (strict >)", () => {
    // Falls through to the ordinary rules: far tier, slot mismatch → skip.
    expect(
      decideTubeSync({ tier: "far", driftSq: HARD2, nowMs: 100_000, lastSyncMs: 0, shardKey: 1, fpsCap: 60 }),
    ).toBe(Math.floor(100_000 / 100) % 6 === 1 % 6);
  });
});

describe("decideTubeSync — rate gate", () => {
  it("near drift-band sync is held until one displayed-frame interval passes", () => {
    const base = { tier: "near" as const, driftSq: NEAR2 + 0.001, shardKey: 1, fpsCap: 30 };
    expect(decideTubeSync({ ...base, nowMs: 1010, lastSyncMs: 1000 })).toBe(false); // 10ms < 31.83ms
    expect(decideTubeSync({ ...base, nowMs: 1040, lastSyncMs: 1000 })).toBe(true); // 40ms > 31.83ms
  });

  it("a bogus cap disables the gate entirely", () => {
    for (const fpsCap of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        decideTubeSync({ tier: "near", driftSq: NEAR2 + 0.001, nowMs: 1000, lastSyncMs: 1000, shardKey: 1, fpsCap }),
      ).toBe(true);
    }
  });

  it("zero drift inside the rate window skips in both tiers", () => {
    for (const tier of ["near", "far"] as const) {
      expect(decideTubeSync({ tier, driftSq: 0, nowMs: 1005, lastSyncMs: 1000, shardKey: 1, fpsCap: 60 })).toBe(false);
    }
  });
});

describe("decideTubeSync — shard backstops bound staleness", () => {
  it("near: zero drift still syncs within ~150ms (slot guarantee survives the rate gate)", () => {
    // Simulate native frames at 120 Hz from a sync at t=0, cap 60.
    let lastSyncMs = 0;
    let firstSyncAt: number | null = null;
    for (let t = 8.33; t <= 1000; t += 8.33) {
      if (decideTubeSync({ tier: "near", driftSq: 0, nowMs: t, lastSyncMs, shardKey: 5, fpsCap: 60 })) {
        firstSyncAt = t;
        break;
      }
    }
    expect(firstSyncAt).not.toBeNull();
    expect(firstSyncAt!).toBeLessThanOrEqual(150);
  });

  it("far: zero drift syncs on the link's slot and only there (gate open)", () => {
    // key 4 → slot floor(now/100) % 6 === 4 → now in [400, 500).
    expect(decideTubeSync({ tier: "far", driftSq: 0, nowMs: 450, lastSyncMs: 0, shardKey: 4, fpsCap: 60 })).toBe(true);
    expect(decideTubeSync({ tier: "far", driftSq: 0, nowMs: 350, lastSyncMs: 0, shardKey: 4, fpsCap: 60 })).toBe(false);
  });

  it("far: a rate-gated slot still lands a sync inside the same 100ms window", () => {
    // Synced 5ms before the window opens (cap 30 → 31.83ms interval): the
    // first in-window frames are gated, but a sync must land before the
    // window closes — the backstop guarantee the module doc states.
    const key = 2; // slot: floor(now/100) % 6 === 2 → window [200, 300)
    let syncedAt: number | null = null;
    for (let t = 200; t < 300; t += 8.33) {
      if (decideTubeSync({ tier: "far", driftSq: 0, nowMs: t, lastSyncMs: 195, shardKey: key, fpsCap: 30 })) {
        syncedAt = t;
        break;
      }
    }
    expect(syncedAt).not.toBeNull();
  });

  it("shard keys are taken by absolute value, matching the legacy inline rule", () => {
    const at = { tier: "far" as const, driftSq: 0, nowMs: 450, lastSyncMs: 0, fpsCap: 60 };
    expect(decideTubeSync({ ...at, shardKey: -4 })).toBe(decideTubeSync({ ...at, shardKey: 4 }));
  });
});

describe("decideTubeSync — far-tier parity with the legacy inline rule", () => {
  // The pre-fluidity Graph3D far branch, transcribed: with a snapshot
  // present, sync iff either endpoint drifted beyond 0.12, or the 6×100ms
  // time-shard slot matches. (driftSq here is the max over endpoints, which
  // is equivalent for the threshold test.) Parity is asserted with the rate
  // gate OPEN (lastSync far in the past): the gate is the one deliberate,
  // separately-tested deviation.
  const legacyFar = (driftSq: number, nowMs: number, shardKey: number): boolean => {
    if (driftSq > HARD2) return true;
    return Math.floor(nowMs / 100) % 6 === Math.abs(Number(shardKey) || 0) % 6;
  };

  it("matches the legacy rule across a drift × time × key grid", () => {
    const drifts = [0, 0.0025, 0.014, HARD2, HARD2 + 0.001, 0.25];
    const nows = [0, 99, 100, 250, 599, 600, 1234, 60_000];
    const keys = [0, 1, 5, 6, 13, -3, 941];
    for (const driftSq of drifts) {
      for (const nowMs of nows) {
        for (const shardKey of keys) {
          const got = decideTubeSync({
            tier: "far",
            driftSq,
            nowMs,
            lastSyncMs: nowMs - 10_000,
            shardKey,
            fpsCap: 30,
          });
          expect(got).toBe(legacyFar(driftSq, nowMs, shardKey));
        }
      }
    }
  });
});

describe("decideTubeSync — near tier shape", () => {
  it("sub-band drift with no slot match skips (the budget the fix exists for)", () => {
    // key 5 → near slot floor(now/50) % 3 === 2; now=10 → slot 0 → no match.
    expect(
      decideTubeSync({ tier: "near", driftSq: NEAR2 / 2, nowMs: 10, lastSyncMs: 0, shardKey: 5, fpsCap: 120 }),
    ).toBe(false);
  });

  it("the SAME sub-band state in the far tier follows the far slot rule", () => {
    // key 5 → far slot floor(now/100) % 6 === 5; now=550 → floor 5 → match.
    expect(
      decideTubeSync({ tier: "far", driftSq: NEAR2 / 2, nowMs: 550, lastSyncMs: 0, shardKey: 5, fpsCap: 120 }),
    ).toBe(true);
  });
});
