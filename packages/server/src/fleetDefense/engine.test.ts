import { describe, it, expect } from "vitest";
import {
  composeWave,
  FLEET_DEFENSE_DEFENDERS,
  FLEET_DEFENSE_INVADER_SHIPS,
  type FleetDefenseInvader,
} from "@brain/shared";
import { advanceTick, autonomousLane, outcomeLine } from "./engine.js";

/**
 * Fleet defense — the engine (design note §4, C2–C5).
 * Pure board math, no database, no clock. Every assertion runs
 * against a composed wave, so the tuning is exact:
 * - C2: losing costs nothing — the engine never touches a release
 *   or a brain fact (the service test proves the mapping);
 * - C4: invaders and defenders are distinct by hull kit;
 * - the approach length gives exactly two spare rounds at every
 *   size (small 5 steps / 3 ships, steady 6 / 4, big 7 / 5).
 */

function invader(lane: number, distance: number, key = "bob"): FleetDefenseInvader {
  return { lane, distance, shipKey: key, shipUrl: `/${key}.glb`, shipName: `Quaternius ${key}`, dispersed: false };
}

describe("composeWave", () => {
  it("scales the fleet with the release size — 3 / 4 / 5, one wave", () => {
    expect(composeWave("small")).toHaveLength(3);
    expect(composeWave("steady")).toHaveLength(4);
    expect(composeWave("big")).toHaveLength(5);
  });

  it("gives a bigger fleet a longer approach — two spare rounds at every size", () => {
    expect(composeWave("small").map((i) => i.distance)).toEqual([5, 5, 5]);
    expect(composeWave("steady").map((i) => i.distance)).toEqual([6, 6, 6, 6]);
    expect(composeWave("big").map((i) => i.distance)).toEqual([7, 7, 7, 7, 7]);
  });

  it("spreads invaders across the three lanes, round-robin", () => {
    expect(composeWave("small").map((i) => i.lane)).toEqual([1, 2, 3]);
    expect(composeWave("big").map((i) => i.lane)).toEqual([1, 2, 3, 1, 2]);
  });

  it("uses distinct Quaternius hulls, none of them a defender hull (C4)", () => {
    const defenderKeys = new Set(FLEET_DEFENSE_DEFENDERS.map((d) => d.key));
    for (const size of ["small", "steady", "big"] as const) {
      const keys = composeWave(size).map((i) => i.shipKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) {
        expect(defenderKeys.has(k)).toBe(false);
        expect(FLEET_DEFENSE_INVADER_SHIPS.some((s) => s.key === k)).toBe(true);
      }
    }
  });
});

describe("autonomousLane", () => {
  it("fires at the lane whose live invader is closest to the charge", () => {
    const board = [invader(1, 4), invader(2, 2), invader(3, 3)];
    expect(autonomousLane(board)).toBe(2);
  });

  it("breaks ties to the lowest lane, and ignores dispersed invaders", () => {
    const board = [invader(1, 2), invader(2, 2), { ...invader(3, 1), dispersed: true }];
    expect(autonomousLane(board)).toBe(1);
  });
});

describe("advanceTick", () => {
  it("a helm hit disperses the nearest invader in the lane and the rest advance", () => {
    const board = [invader(1, 5), invader(1, 3, "challenger"), invader(2, 5)];
    const r = advanceTick(board, { mode: "helm", lane: 1 });
    expect(r.status).toBe("active");
    expect(r.laneFired).toBe(1);
    const lane1 = r.invaders.filter((i) => i.lane === 1);
    expect(lane1.find((i) => i.shipKey === "challenger")?.dispersed).toBe(true);
    expect(lane1.find((i) => i.shipKey === "bob")?.distance).toBe(4);
    expect(r.invaders.find((i) => i.lane === 2)?.distance).toBe(4);
    expect(r.line).toMatch(/dispersed the Quaternius challenger/);
  });

  it("a shot down an empty lane flies wide and the fleet still advances", () => {
    const board = [invader(1, 5), invader(2, 5)];
    const r = advanceTick(board, { mode: "helm", lane: 3 });
    expect(r.status).toBe("active");
    expect(r.invaders.every((i) => !i.dispersed)).toBe(true);
    expect(r.invaders.map((i) => i.distance)).toEqual([4, 4]);
    expect(r.line).toMatch(/flew wide/);
  });

  it("Soumaya on her own fires at the closest invader (autonomous)", () => {
    const board = [invader(1, 4), invader(2, 2), invader(3, 3)];
    const r = advanceTick(board, { mode: "autonomous" });
    expect(r.laneFired).toBe(2);
    expect(r.invaders.find((i) => i.lane === 2)?.dispersed).toBe(true);
    expect(r.line).toMatch(/^Soumaya fired/);
  });

  it("wins when the last invader is dispersed — even on the last step", () => {
    // Three invaders, all three steps out; the helm disperses one
    // per tick and the last falls on tick 3 while standing one step
    // from the charge — dispersed before it can advance.
    let board = [invader(1, 3), invader(2, 3), invader(3, 3)];
    let r = advanceTick(board, { mode: "helm", lane: 1 });
    expect(r.status).toBe("active");
    board = r.invaders;
    r = advanceTick(board, { mode: "helm", lane: 2 });
    expect(r.status).toBe("active");
    r = advanceTick(r.invaders, { mode: "helm", lane: 3 });
    expect(r.status).toBe("won");
    expect(r.line).toMatch(/charge is cleared/);
  });

  it("loses when an invader reaches the charge — the breach names the ship", () => {
    const board = [invader(1, 1), invader(2, 3, "challenger")];
    const r = advanceTick(board, { mode: "helm", lane: 2 });
    expect(r.status).toBe("lost");
    expect(r.line).toMatch(/reached the charge/);
    expect(r.line).toMatch(/nothing is lost/);
  });

  it("a REAL-defense loss line never names a practice fleet; a practice loss does", () => {
    // Regression: the shared engine serves the server's real defense
    // (practice flag off) as well as the Scale practice round, so an
    // unconditional "practice fleet" loss line leaked into real
    // defenses via lastLine + the tick log. Both breach shapes are
    // covered: a hit plus a breach, and a shot flown wide plus a
    // breach. The wording must name the exact fleet, not merely
    // contain "nothing is lost".
    const hitAndBreach = [invader(1, 1), invader(2, 3, "challenger")];
    const wideAndBreach = [invader(1, 1)];
    for (const board of [hitAndBreach, wideAndBreach]) {
      const real = advanceTick(board, { mode: "helm", lane: 2 });
      expect(real.status).toBe("lost");
      expect(real.line).toMatch(/The fleet disperses — nothing is lost\./);
      expect(real.line).not.toMatch(/practice fleet/);
      const practice = advanceTick(board, { mode: "helm", lane: 2 }, { practice: true });
      expect(practice.status).toBe("lost");
      expect(practice.line).toMatch(/The practice fleet disperses — nothing is lost\./);
    }
  });

  it("two missed rounds still win a small defense; three lose it", () => {
    // Small wave, 5 steps, 3 ships. Fire lane 1 three times: the
    // first shot disperses that lane's ship, the next two fly wide
    // (two real misses). The two ships left stand 2 steps out; one
    // hit per tick wins on tick 5 with the last ship dispersed first.
    const ticks = [1, 1, 1, 2, 3];
    let board = composeWave("small");
    ticks.forEach((lane, i) => {
      const r = advanceTick(board, { mode: "helm", lane });
      board = r.invaders;
      if (i < ticks.length - 1) expect(r.status).toBe("active");
      else expect(r.status).toBe("won");
    });
    expect(board.every((i) => i.dispersed)).toBe(true);

    // Same wave, one more wide shot: the fourth tick cannot save it
    // — the last ship reaches the charge on tick 5.
    const losing = [1, 1, 1, 1, 2];
    board = composeWave("small");
    losing.forEach((lane, i) => {
      const r = advanceTick(board, { mode: "helm", lane });
      board = r.invaders;
      if (i < losing.length - 1) expect(r.status).toBe("active");
      else expect(r.status).toBe("lost");
    });
  });

  it("two missed rounds still win a big defense; the tuning holds at 5 ships", () => {
    // Big wave, 7 steps, 5 ships. Lane 3 twice: the first shot takes
    // the dispatcher, the second flies wide (one real miss). Then one
    // hit per tick — lanes 1, 2, 3, 1, 2 — but lane 3 is already
    // empty, so that shot is the second miss. The last ship falls on
    // tick 7, one step from the charge.
    const ticks = [3, 3, 1, 2, 3, 1, 2];
    let board = composeWave("big");
    ticks.forEach((lane, i) => {
      const r = advanceTick(board, { mode: "helm", lane });
      board = r.invaders;
      if (i < ticks.length - 1) expect(r.status).toBe("active");
      else expect(r.status).toBe("won");
    });
    expect(board.every((i) => i.dispersed)).toBe(true);
  });
});

describe("outcomeLine", () => {
  it("a win names the release and the day; a loss names the retry, never a penalty", () => {
    expect(outcomeLine("won", "the old argument")).toMatch(/the fleet dispersed and the charge was let go — the old argument/);
    expect(outcomeLine("lost", "the old argument")).toMatch(/can be tried again later\. Nothing was lost/);
  });
});
