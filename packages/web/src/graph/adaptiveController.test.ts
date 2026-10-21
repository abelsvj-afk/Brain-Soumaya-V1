import { describe, it, expect, beforeEach } from "vitest";
import {
  RUNG_TABLE,
  MAX_RUNG,
  modeRungRange,
  initialState,
  step,
  loadPersistedRung,
  savePersistedRung,
  type AdaptiveState,
  type AdaptiveSample,
} from "./adaptiveController.js";

const FULL_RANGE: [number, number] = [0, MAX_RUNG];

function goodSample(now: number, cameraMoved = true): AdaptiveSample {
  return { workMs: 5, targetMs: 16, cameraMoved, now }; // plenty of headroom
}
function badSample(now: number): AdaptiveSample {
  return { workMs: 30, targetMs: 16, cameraMoved: true, now }; // over budget, but not severely (1.875x)
}
function severeSample(now: number): AdaptiveSample {
  return { workMs: 80, targetMs: 16, cameraMoved: true, now }; // catastrophic (5x) — a real ~1-4fps-against-60fps report
}

/** Drive N good samples spaced 1s apart, honoring the ascend cooldown by default. */
function driveGood(state: AdaptiveState, count: number, startAt: number, range = FULL_RANGE): AdaptiveState {
  let s = state;
  let t = startAt;
  for (let i = 0; i < count; i++) {
    s = step(s, goodSample(t), range);
    t += 1000;
  }
  return s;
}

describe("adaptiveController — RUNG_TABLE", () => {
  it("is monotonically non-decreasing in pixelRatioCap and detail cost", () => {
    const tierCost = { performance: 0, balanced: 1, quality: 2 };
    for (let i = 1; i < RUNG_TABLE.length; i++) {
      const prev = RUNG_TABLE[i - 1]!;
      const cur = RUNG_TABLE[i]!;
      expect(cur.pixelRatioCap).toBeGreaterThanOrEqual(prev.pixelRatioCap);
      expect(tierCost[cur.detailTier]).toBeGreaterThanOrEqual(tierCost[prev.detailTier]);
      // bloom, once on, never turns off going up the ladder
      if (prev.bloom) expect(cur.bloom).toBe(true);
      // heavyScenery is a floor knob (off only at rung 0) — once on, it stays on too
      if (prev.heavyScenery) expect(cur.heavyScenery).toBe(true);
    }
  });

  it("rung 0 is the cheapest possible (performance tier, DPR 1, no bloom, no heavy scenery)", () => {
    expect(RUNG_TABLE[0]).toMatchObject({ pixelRatioCap: 1.0, detailTier: "performance", bloom: false, heavyScenery: false });
  });

  it("every rung above 0 keeps heavyScenery on — it is a last-resort floor lever, not a graduated cost step", () => {
    for (let i = 1; i < RUNG_TABLE.length; i++) {
      expect(RUNG_TABLE[i]!.heavyScenery).toBe(true);
    }
  });

  it("the last rung is quality detail with bloom at its strongest", () => {
    const last = RUNG_TABLE[MAX_RUNG]!;
    expect(last.detailTier).toBe("quality");
    expect(last.bloom).toBe(true);
    expect(last.bloomStrength).toBeGreaterThan(RUNG_TABLE[MAX_RUNG - 1]!.bloomStrength);
  });
});

describe("adaptiveController — modeRungRange", () => {
  it("clamps performance/balanced/quality to their overlapping bands", () => {
    expect(modeRungRange("performance")).toEqual([0, 2]);
    expect(modeRungRange("balanced")).toEqual([2, 5]);
    expect(modeRungRange("quality")).toEqual([5, MAX_RUNG]);
  });
  it("auto gets the full ladder", () => {
    expect(modeRungRange("auto")).toEqual([0, MAX_RUNG]);
  });
});

describe("adaptiveController — step() descend", () => {
  it("descends after 2 consecutive bad windows, not on the first", () => {
    let s = initialState(4, FULL_RANGE);
    s = step(s, badSample(1000), FULL_RANGE);
    expect(s.rung).toBe(4); // one bad window isn't enough
    s = step(s, badSample(2000), FULL_RANGE);
    expect(s.rung).toBe(3); // two in a row -> descend
  });

  it("never descends below the range floor", () => {
    let s = initialState(0, FULL_RANGE);
    s = step(s, badSample(1000), FULL_RANGE);
    s = step(s, badSample(2000), FULL_RANGE);
    expect(s.rung).toBe(0);
  });

  it("reacts immediately with no cooldown between repeated descents", () => {
    let s = initialState(7, FULL_RANGE);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      s = step(s, badSample(t), FULL_RANGE);
      t += 10; // tight spacing — a real stall shouldn't need to wait for a cooldown
    }
    // 6 bad windows, threshold 2 -> should have descended 3 times: 7->6->5->4
    expect(s.rung).toBe(4);
  });
});

describe("adaptiveController — step() severe-overage fast descend", () => {
  it("drops straight to the range floor on the very first severe sample, no streak required", () => {
    let s = initialState(7, FULL_RANGE);
    s = step(s, severeSample(1000), FULL_RANGE);
    expect(s.rung).toBe(0); // one sample, not two — this is the whole point of the fast path
  });

  it("an ordinary (non-severe) overage still needs 2 consecutive bad windows, unaffected", () => {
    let s = initialState(4, FULL_RANGE);
    s = step(s, badSample(1000), FULL_RANGE); // 1.875x over — not severe
    expect(s.rung).toBe(4);
    s = step(s, badSample(2000), FULL_RANGE);
    expect(s.rung).toBe(3); // ordinary one-rung descend, same as before this fix
  });

  it("treats exactly 2x target as severe (boundary is inclusive)", () => {
    let s = initialState(5, FULL_RANGE);
    s = step(s, { workMs: 32, targetMs: 16, cameraMoved: true, now: 1000 }, FULL_RANGE);
    expect(s.rung).toBe(0);
  });

  it("just under the severe threshold falls back to the ordinary one-rung-per-2-windows ratchet", () => {
    let s = initialState(5, FULL_RANGE);
    s = step(s, { workMs: 31.9, targetMs: 16, cameraMoved: true, now: 1000 }, FULL_RANGE);
    expect(s.rung).toBe(5); // first bad window alone isn't enough under the ordinary path
    s = step(s, { workMs: 31.9, targetMs: 16, cameraMoved: true, now: 2000 }, FULL_RANGE);
    expect(s.rung).toBe(4); // second bad window -> ordinary single-rung descend, not a jump to 0
  });

  it("never descends below the range floor", () => {
    let s = initialState(0, FULL_RANGE);
    s = step(s, severeSample(1000), FULL_RANGE);
    expect(s.rung).toBe(0);
  });

  it("respects a narrowed range's floor, not the global minRung", () => {
    let s = initialState(4, [2, MAX_RUNG]);
    s = step(s, severeSample(1000), [2, MAX_RUNG]);
    expect(s.rung).toBe(2);
  });

  it("counts a severe bail-out shortly after an ascend as a failed ascent, same as the ordinary path", () => {
    let s = initialState(0, FULL_RANGE);
    s = driveGood(s, 5, 0);
    expect(s.rung).toBe(1);
    const t = s.lastChangeAt + 500;
    s = step(s, severeSample(t), FULL_RANGE);
    expect(s.rung).toBe(0);
    expect(s.failedAscents[1]).toBe(1);
  });
});

describe("adaptiveController — step() ascend", () => {
  it("does not ascend before 5 good windows", () => {
    let s = initialState(0, FULL_RANGE);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      s = step(s, goodSample(t), FULL_RANGE);
      t += 1000;
    }
    expect(s.rung).toBe(0);
  });

  it("ascends after 5 good windows, given cooldown + camera motion", () => {
    const s = driveGood(initialState(0, FULL_RANGE), 5, 0);
    expect(s.rung).toBe(1);
  });

  it("does not ascend without any camera motion during the streak (idle frames lie)", () => {
    let s = initialState(0, FULL_RANGE);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      s = step(s, goodSample(t, false), FULL_RANGE); // never moved
      t += 1000;
    }
    expect(s.rung).toBe(0);
  });

  it("does not ascend before the 8s cooldown since the last change", () => {
    let s = initialState(0, FULL_RANGE);
    // First ascend at t=5000 (5 samples 1s apart starting at 1000).
    s = driveGood(s, 5, 1000);
    expect(s.rung).toBe(1);
    const rungAfterFirst = s.rung;
    const timeAfterFirst = s.lastChangeAt;
    // Immediately rack up 5 MORE good windows starting right after — but faster than 8s total.
    let t = timeAfterFirst + 100;
    for (let i = 0; i < 5; i++) {
      s = step(s, goodSample(t), FULL_RANGE);
      t += 100; // 500ms total, well under the 8s cooldown
    }
    expect(s.rung).toBe(rungAfterFirst); // blocked by cooldown
  });

  it("never ascends past the range ceiling", () => {
    let s = initialState(MAX_RUNG, FULL_RANGE);
    s = driveGood(s, 5, 0);
    expect(s.rung).toBe(MAX_RUNG);
  });

  it("climbs the full ladder given sustained headroom over enough time", () => {
    let s = initialState(0, FULL_RANGE);
    let t = 0;
    // Enough 1s-spaced good samples to clear every cooldown window.
    for (let i = 0; i < 200; i++) {
      s = step(s, goodSample(t), FULL_RANGE);
      t += 1000;
    }
    expect(s.rung).toBe(MAX_RUNG);
  });
});

describe("adaptiveController — hysteresis / anti-oscillation", () => {
  it("blocks re-ascending into a rung within 4s of descending from it", () => {
    // Climb to rung 1, then force a descend back to 0.
    let s = driveGood(initialState(0, FULL_RANGE), 5, 0);
    expect(s.rung).toBe(1);
    const descendAt = s.lastChangeAt + 1000;
    s = step(s, badSample(descendAt), FULL_RANGE);
    s = step(s, badSample(descendAt + 10), FULL_RANGE);
    expect(s.rung).toBe(0);
    const descendedAt = s.lastDescendAt;
    // Now rack up good windows again, all within 4s of the descend.
    let t = descendedAt + 100;
    for (let i = 0; i < 5; i++) {
      s = step(s, goodSample(t), FULL_RANGE);
      t += 100;
    }
    expect(s.rung).toBe(0); // blocked by the 4s re-ascend guard (cooldown is also unmet here anyway)
  });

  it("marks a session ceiling after 2 failed ascents into the same rung, and never probes it again", () => {
    let s = initialState(0, FULL_RANGE);
    let t = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Ascend to rung 1.
      s = driveGood(s, 5, t);
      expect(s.rung).toBe(1);
      t = s.lastChangeAt + 500;
      // Immediately fail: 2 bad windows within the "failed ascent" window.
      s = step(s, badSample(t), FULL_RANGE);
      t += 10;
      s = step(s, badSample(t), FULL_RANGE);
      expect(s.rung).toBe(0);
      t += 20000; // clear all cooldowns/re-ascend guards before the next attempt
    }
    expect(s.ceilingRung).toBe(0); // rung 1 failed twice -> ceiling pinned at 0
    // A third, much later attempt must not be able to climb past the ceiling even with
    // abundant good windows.
    s = driveGood(s, 50, t);
    expect(s.rung).toBe(0);
  });

  it("a descend long after an ascend (outside the failed-ascent window) does NOT count as a failure", () => {
    let s = driveGood(initialState(0, FULL_RANGE), 5, 0);
    expect(s.rung).toBe(1);
    const farLater = s.lastChangeAt + 20000; // past FAILED_ASCENT_WINDOW_MS
    s = step(s, badSample(farLater), FULL_RANGE);
    s = step(s, badSample(farLater + 10), FULL_RANGE);
    expect(s.rung).toBe(0);
    expect(s.ceilingRung).toBe(MAX_RUNG); // not penalized — this wasn't a fast bail-out
  });
});

describe("adaptiveController — mode range re-clamping", () => {
  it("clamps an out-of-band rung down when the range narrows (e.g. mode switched)", () => {
    const s = initialState(7, FULL_RANGE);
    const narrowed = step(s, goodSample(0), [0, 2]);
    expect(narrowed.rung).toBeLessThanOrEqual(2);
  });
});

describe("adaptiveController — cold-start recovery (Fix C)", () => {
  // Galaxy line-latch Fix C (2026-10-21): a descent within the session's cold-
  // start window is attributed to load turbulence, not sustained capacity —
  // and an idle scene can never produce the motion evidence the ascend gate
  // otherwise demands (the owner stops moving to watch the ship), so a
  // cold-start descent parked the ladder at floor quality for the whole
  // session. The exception admits ONE motionless recovery ascend out of a
  // cold-reached rung; every other rule is unchanged.

  it("a severe cold-start descent marks the rung cold-reached, and motionless good frames climb back out", () => {
    let s = initialState(3, FULL_RANGE);
    s = step(s, severeSample(0), FULL_RANGE); // cold spike -> straight to the floor
    expect(s.rung).toBe(0);
    expect(s.coldDescent).toBe(true);
    expect(s.firstSampleAt).toBe(0);
    // The owner sits still and watches: good frames, zero camera motion.
    for (const t of [2000, 4000, 6000, 8000]) {
      s = step(s, goodSample(t, false), FULL_RANGE);
      expect(s.rung).toBe(0); // streak/cooldown not yet satisfied
    }
    s = step(s, goodSample(10000, false), FULL_RANGE); // streak 5, cooldown met
    expect(s.rung).toBe(1); // recovered WITHOUT any motion evidence
    expect(s.coldDescent).toBe(false); // ...and the exception is spent
  });

  it("an ordinary two-window descent inside the cold window is marked too", () => {
    let s = initialState(4, FULL_RANGE);
    s = step(s, badSample(0), FULL_RANGE);
    s = step(s, badSample(2000), FULL_RANGE);
    expect(s.rung).toBe(3);
    expect(s.coldDescent).toBe(true);
    for (const t of [4000, 6000, 8000, 10000]) {
      s = step(s, goodSample(t, false), FULL_RANGE);
    }
    s = step(s, goodSample(12000, false), FULL_RANGE);
    expect(s.rung).toBe(4); // fully back to the pre-descent rung, motionlessly
    expect(s.coldDescent).toBe(false);
  });

  it("a descent AFTER the cold window gets no exception — motionless frames never ascend, motion still works", () => {
    let s = initialState(3, FULL_RANGE);
    // Sit motionless past the 15s cold window (no descent, no ascend — the
    // motion gate holds throughout, exactly as before Fix C).
    for (let t = 0; t <= 16000; t += 2000) {
      s = step(s, goodSample(t, false), FULL_RANGE);
    }
    expect(s.rung).toBe(3);
    expect(s.firstSampleAt).toBe(0); // anchored at the first sample, never moved
    s = step(s, severeSample(18000), FULL_RANGE); // a REAL mid-session collapse
    expect(s.rung).toBe(0);
    expect(s.coldDescent).toBe(false);
    for (const t of [20000, 22000, 24000, 26000, 28000, 30000, 32000]) {
      s = step(s, goodSample(t, false), FULL_RANGE);
    }
    expect(s.rung).toBe(0); // parked — the gate was NOT loosened generally
    s = step(s, goodSample(34000, true), FULL_RANGE); // motion evidence arrives
    expect(s.rung).toBe(1); // ...and the normal path climbs, as before
  });

  it("the exception is single-shot: after the recovery ascend, the next rung needs motion evidence again", () => {
    let s = initialState(2, FULL_RANGE);
    s = step(s, severeSample(0), FULL_RANGE);
    expect(s.coldDescent).toBe(true);
    for (const t of [2000, 4000, 6000, 8000, 10000]) {
      s = step(s, goodSample(t, false), FULL_RANGE);
    }
    expect(s.rung).toBe(1); // the one motionless recovery
    // Keep sitting still with perfect frames: no second free climb.
    for (const t of [12000, 14000, 16000, 18000, 20000, 22000, 24000]) {
      s = step(s, goodSample(t, false), FULL_RANGE);
    }
    expect(s.rung).toBe(1);
  });
});

describe("adaptiveController — persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips rung + ceiling through localStorage", () => {
    const s = { ...initialState(3, FULL_RANGE), rung: 5, ceilingRung: 6 };
    savePersistedRung(s, "1.0.0");
    const loaded = loadPersistedRung("1.0.0");
    expect(loaded).toEqual({ rung: 5, ceilingRung: 6, appVersion: "1.0.0" });
  });

  it("returns null when nothing is persisted", () => {
    expect(loadPersistedRung("1.0.0")).toBeNull();
  });

  it("invalidates a persisted rung from a different appVersion", () => {
    const s = { ...initialState(3, FULL_RANGE), rung: 5, ceilingRung: 6 };
    savePersistedRung(s, "1.0.0");
    expect(loadPersistedRung("2.0.0")).toBeNull();
  });

  it("ignores corrupt JSON rather than throwing", () => {
    localStorage.setItem("brain.graphics.adaptiveRung", "{not json");
    expect(loadPersistedRung("1.0.0")).toBeNull();
  });
});
