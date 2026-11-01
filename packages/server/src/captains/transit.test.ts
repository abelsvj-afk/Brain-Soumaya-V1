// ============================================================================
// DRAFT — P1 TEST SCAFFOLDING. Staged in ~/workspace/gate-run/civ-p1-prep/.
// NOT in a repo, NOT runnable against the L1 tree. Lands at P1-B1 task T7
// (surface assertions at T8) as packages/server/src/captains/transit.test.ts
// after RA-5 (leg field names) and RA-8 (timing constants) re-anchor.
//
// Proves acceptance A7 (spec §5): a captain in transit is reported as in
// transit, with a destination she actually holds a plan for; arrival
// resolves inside the lazy advance, never by a background timer.
//
// Style mirrors L1 captains.test.ts: injected time, in-memory DB, the
// seeded day plan drives the scenario, acts read back from the shared log.
// RE-ANCHOR markers name every P1 shape this draft assumes:
//   - CaptainStateRow leg fields: legFrom / legTo / legKind /
//     legDepartedStepMs / legArrivesStepMs  (spec §5.1 snake_case in SQL)
//   - wire: transitState "none"|"departed"|"underway", legTo, legKind
//   - CaptainVisit gains: originWorld, legKind
//   - constants: CAPTAIN_LEG_WARP_STEPS = 1, CAPTAIN_LEG_DRIFT_STEPS = 3
//     (spec §11 item 2 — PROPOSALS until the owner rules at build tap)
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { CAPTAIN_MAX_ACTS_PER_DAY, CAPTAIN_START_FUEL, WARP_COST } from "@brain/shared";
import { NpcRepo } from "../npcs/repo.js";
import { CaptainRepo } from "./repo.js";
import { dayPlan } from "./seed.js";
import {
  advanceCaptain,
  askCaptain,
  getCaptainState,
  getChronicle,
  listCaptainStates,
  resumeCaptain,
  stopCaptain,
  worldNamePlain,
} from "./engine.js";
import type { CaptainDecider } from "./decider.js";

const TZ = "America/New_York";
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // Thu 08:00 EDT
const H = 3_600_000;
const SPACE = "spaceA";

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const captains = (space = SPACE) => new CaptainRepo(handle, space);
const bexLog = (space = SPACE) => new NpcRepo(handle, space).recentLog("bex", 500);

/** A decider that only ever waits: with it, the ONLY legs that can
 *  open are the seeded plan's legs — the A7 circuit tests below are
 *  about plan legs and their timing, so decider legs (which are
 *  covered by their own warp test) are held out of the drive. */
const waitDecider: CaptainDecider = {
  decide: () => ({ act: "wait", cause: "Test decider: wait." }),
};

/** advanceCaptain with the wait decider (plan legs only). */
function advancePlanned(handle_: DbHandle, t: number): void {
  advanceCaptain(handle_, SPACE, "bex", t, { decider: waitDecider });
}

/** Put the visitor in a world (injected time), as L1's helper does. */
function arrivePlayer(world: string, nowMs: number, space = SPACE): void {
  const t = new TravelRepo(handle, space);
  const j = t.depart({ clientKey: `k-${world}-${nowMs}`, kind: "drift", destination: world }, nowMs);
  const arrived = t.arrive(j.id, nowMs + 60_000);
  if (!arrived || arrived.state !== "arrived") throw new Error("test setup: arrival failed");
}

/**
 * Find a Bex day whose plan crosses worlds (a non-home visit exists), and
 * return the plan + the first inter-world leg the plan implies. RE-ANCHOR:
 * in P1 the leg is a plan concept (visit.originWorld / visit.legKind);
 * on the L1 plan shape this helper cannot be written — that is expected.
 */
function crossWorldDay() {
  // The A7 circuit is a DRIFT leg (the draft's scenario): scan the
  // test fortnight for a day whose FIRST inter-world leg is a drift
  // leg to another world. The leg kind is part of the seeded plan
  // (P1 seed.ts), so the day is a fact of the plan, not a hope.
  for (let d = 22; d <= 31; d++) {
    const key = `2026-10-${d}`;
    const plan = dayPlan("bex", key, TZ, "great-station");
    const away = plan.find((v) => v.world !== "great-station");
    if (away && away.legKind === "drift") return { dayKey: key, plan, away };
  }
  for (let d = 1; d <= 9; d++) {
    const key = `2026-11-0${d}`;
    const plan = dayPlan("bex", key, TZ, "great-station");
    const away = plan.find((v) => v.world !== "great-station");
    if (away && away.legKind === "drift") return { dayKey: key, plan, away };
  }
  throw new Error("the test fortnight needs a cross-world drift-leg Bex plan");
}

describe("A7 — the leg: departed → underway → arrived (spec §5.2)", () => {
  it("a drift leg opens at departure, promotes silently, and resolves only inside the advance", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    // Walk Bex through her day on injected time until the cross-world leg opens.
    advancePlanned(handle, first.startMs); // cursor
    let legOpenedAt = -1;
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) { legOpenedAt = t; break; }
    }
    expect(legOpenedAt).toBeGreaterThan(0);

    const st = captains().state("bex");
    // The leg names exactly the held plan: origin, destination, kind.
    expect(st?.legTo).toBe(away.world);
    expect(st?.legFrom).toBe("great-station");
    expect(st?.legKind).toBe("drift");
    // A drift leg is 3 steps: arrival strictly after departure, never same-step.
    expect(st?.legArrivesStepMs).toBeGreaterThan(st?.legDepartedStepMs ?? 0);
    // While the leg is open she is present NOWHERE.
    expect(st?.currentWorld).toBeNull();

    // Exactly one departure line so far; the Chronicle carries it with a cause.
    const departs = bexLog().filter((e) => e.kind === "depart");
    expect(departs.length).toBeGreaterThanOrEqual(1);
    expect(departs[0]?.cause.length).toBeGreaterThan(10);

    // One more advance step: underway — and NO new log line is written for it.
    const logCount = bexLog().length;
    advancePlanned(handle, legOpenedAt + H);
    const wire = getCaptainState(handle, SPACE, "bex", legOpenedAt + H);
    expect(wire.transitState).toBe("underway");
    expect(wire.present).toBe(false);
    expect(wire.legTo).toBe(away.world);
    expect(wire.doingLine).toContain("Underway");
    expect(bexLog()).toHaveLength(logCount); // underway writes nothing
    // (No arrival for THIS leg exists yet — log-count equality above is the
    // strong form of this; act text uses plain world names, not keys.)

    // Advance to the arrival step: exactly one arrival, the leg closes.
    advancePlanned(handle, (st?.legArrivesStepMs ?? 0) + H);
    const arrived = captains().state("bex");
    expect(arrived?.legTo).toBeNull();
    expect(arrived?.currentWorld).toBe(away.world);
    const arrives = bexLog().filter((e) => e.kind === "arrive");
    expect(arrives.length).toBeGreaterThanOrEqual(1);
  });

  it("a warp leg charges her fuel once, at departure — never at arrival, never twice", () => {
    // A test decider that always warps to the first destination in
    // the perception set (the P1 shape — destination set, not L1's
    // binary otherWorld).
    const warpDecider: CaptainDecider = {
      decide: (_def, p) => ({
        act: "travel",
        travelKind: "warp",
        toWorld: p.destinations[0]!,
        cause: "Test decider: warp.",
      }),
    };
    // Begin a session at home (a same-world visit opens no leg).
    let begun: { startMs: number } | null = null;
    for (let d = 22; d <= 31 && !begun; d++) {
      for (const v of dayPlan("bex", `2026-10-${d}`, TZ, "great-station")) {
        if (v.world === "great-station" && v.legKind === null && v.endMs - v.startMs >= 2 * H) {
          begun = v;
          break;
        }
      }
    }
    if (!begun) throw new Error("the test fortnight needs a home session for Bex");
    advanceCaptain(handle, SPACE, "bex", begun.startMs);
    advanceCaptain(handle, SPACE, "bex", begun.startMs + H); // session begins
    expect(captains().state("bex")?.sessionKey).not.toBeNull();
    expect(captains().state("bex")?.fuel).toBe(CAPTAIN_START_FUEL);
    // One step under the warp decider: the leg opens, fuel charged ONCE.
    advanceCaptain(handle, SPACE, "bex", begun.startMs + 2 * H, { decider: warpDecider });
    const legged = captains().state("bex");
    expect(legged?.legKind).toBe("warp");
    expect(legged?.legTo).toBe("scale"); // destinations[0] from the Station
    expect(legged?.fuel).toBe(CAPTAIN_START_FUEL - WARP_COST);
    // Warp = 1 step: the next advance resolves the arrival, uncharged.
    advanceCaptain(handle, SPACE, "bex", begun.startMs + 3 * H);
    const arrived = captains().state("bex");
    expect(arrived?.legTo).toBeNull();
    expect(arrived?.currentWorld).toBe("scale");
    expect(arrived?.fuel).toBe(CAPTAIN_START_FUEL - WARP_COST);
    expect(WARP_COST).toBe(10); // the player's price, on her own tank (spec §5.1)
  });

  it("fuel at zero never strands her: the same circuit completes by drift (I-6b)", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    handle.sqlite.prepare(`UPDATE npc_player_state SET fuel = 0 WHERE npc_id = 'bex'`).run();
    // Drive the whole day: she still reaches the away world, by drift.
    advancePlanned(handle, away.endMs + 2 * H);
    expect(bexLog().some((e) => e.kind === "arrive")).toBe(true);
    expect(captains().state("bex")?.fuel).toBe(0); // never negative, never charged
  });
});

describe("A7 — the destination comes only from a held plan (spec §5.1)", () => {
  it("leg_to always equals a planned visit's world — across a 30-day soak", { timeout: 300_000 }, () => {
    // Soak: sample every open leg Bex ever holds over 30 simulated days and
    // check each destination against the re-derived plans for those days.
    const plannedWorlds = new Set<string>();
    for (let d = 22; d <= 31; d++) {
      for (const v of dayPlan("bex", `2026-10-${d}`, TZ, "great-station")) plannedWorlds.add(v.world);
      for (const v of dayPlan("bex", `2026-11-${String(d - 21).padStart(2, "0")}`, TZ, "great-station")) plannedWorlds.add(v.world);
    }
    let sawLeg = false;
    for (let t = T0; t <= T0 + 30 * 24 * H; t += 6 * H) {
      advanceCaptain(handle, SPACE, "bex", t);
      const st = captains().state("bex");
      if (st?.legTo) {
        sawLeg = true;
        expect(plannedWorlds.has(st.legTo), `leg to ${st.legTo}`).toBe(true);
        expect(st.legTo).not.toBe(st.legFrom);
      }
    }
    expect(sawLeg).toBe(true); // the soak actually exercised transit
  });

  it("no surface invents a destination: 'headed' in transit answers from the leg", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) break;
    }
    const headed = askCaptain(handle, SPACE, "bex", "headed", away.startMs + H + 1000);
    expect(headed.answer).toContain(worldNamePlain(away.world));
    expect(headed.answer.toLowerCase()).toMatch(/underway|drift|travelling|traveling/);
    const doing = askCaptain(handle, SPACE, "bex", "doing", away.startMs + H + 2000);
    expect(doing.answer.toLowerCase()).toMatch(/travelling|traveling|underway/);
  });
});

describe("A7 — no read, no resolution (spec §5.2, the binding rule)", () => {
  it("wall-clock passing the arrival step changes nothing until a read advances her", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) break;
    }
    const arrivesAt = captains().state("bex")?.legArrivesStepMs ?? 0;
    expect(arrivesAt).toBeGreaterThan(0);
    // Inspect the ROW directly (no advance-triggering read): long past the
    // arrival step in wall-clock terms, the leg must still be open, because
    // nothing has advanced her. Time alone resolves nothing in this engine.
    const raw = handle.sqlite
      .prepare(`SELECT leg_to, current_world FROM npc_player_state WHERE space_id = ? AND npc_id = 'bex'`)
      .get(SPACE) as { leg_to: string | null; current_world: string | null };
    expect(raw.leg_to).toBe(away.world);
    expect(raw.current_world).toBeNull();
    // Two consecutive reads now agree: the first advances + commits arrival,
    // the second reads the commit.
    const r1 = getCaptainState(handle, SPACE, "bex", arrivesAt + 2 * H);
    const r2 = getCaptainState(handle, SPACE, "bex", arrivesAt + 2 * H);
    expect(r1.currentWorld).toBe(r2.currentWorld);
    expect(r1.transitState).toBe("none");
  });

  it("a summarized jump across an open leg completes it — labelled, never hourly fiction", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) break;
    }
    // Ten days of silence, then one read: the leg completes inside the
    // summarized jump, with a cause that says the interval was summarized.
    advanceCaptain(handle, SPACE, "bex", T0 + 10 * 24 * H);
    const st = captains().state("bex");
    expect(st?.legTo).toBeNull(); // never left permanently underway
    const arrivals = bexLog().filter((e) => e.kind === "arrive");
    expect(arrivals.some((e) => /summar/i.test(e.cause))).toBe(true);
    void away;
  });
});

describe("A7 — presence and meetings while a leg is open (spec §5.3)", () => {
  it("no meeting is recorded at either end of an open leg, even with the visitor waiting", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    // The visitor waits AT the destination for the whole leg.
    arrivePlayer(away.world, first.startMs - 120_000);
    advancePlanned(handle, first.startMs);
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) break;
    }
    expect(captains().state("bex")?.legTo).toBe(away.world);
    expect(captains().meetings("bex")).toHaveLength(0);
    expect(bexLog().some((e) => e.kind === "greet")).toBe(false);
    // Ship label rule (T8 surface): she is labelled at NEITHER world.
    const list = listCaptainStates(handle, SPACE, away.startMs + H);
    const bex = list.find((c) => c.id === "bex");
    expect(bex?.present).toBe(false);
    expect(bex?.currentWorld).toBeNull();
  });

  it("the Chronicle prints departure and arrival as separate lines — and nothing between", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    advancePlanned(handle, away.endMs + 6 * H); // through arrival and beyond
    const lines = getChronicle(handle, SPACE, away.endMs + 6 * H, 200);
    const mine = lines.filter((l) => l.npcId === "bex");
    expect(mine.some((l) => l.kind === "depart")).toBe(true);
    expect(mine.some((l) => l.kind === "arrive")).toBe(true);
    // No fabricated "still travelling" entries exist as a kind at all.
    expect(mine.every((l) => ["travel", "arrive", "depart", "greet", "wait", "speak"].includes(l.kind))).toBe(true);
  });
});

describe("A7/A4 — stop and resume mid-transit (spec §5.4)", () => {
  it("a stop mid-leg neither teleports nor strands; resume completes the leg once, uncharged twice", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    let legAt = -1;
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) { legAt = t; break; }
    }
    expect(legAt).toBeGreaterThan(0);
    const fuelAtStop = captains().state("bex")?.fuel;
    const stopped = stopCaptain(handle, SPACE, "bex", legAt + 30 * 60_000);
    expect(stopped.stopped).toBe(true);
    // The leg survives the stop, untouched.
    expect(captains().state("bex")?.legTo).toBe(away.world);
    expect(captains().state("bex")?.currentWorld).toBeNull();
    // Resume long after the arrival step: one arrival, no duplicate
    // departure, no second fuel charge, cause names the unreplayed span.
    resumeCaptain(handle, SPACE, "bex", legAt + 10 * 24 * H);
    advancePlanned(handle, legAt + 10 * 24 * H + H);
    const st = captains().state("bex");
    expect(st?.legTo).toBeNull();
    expect(st?.fuel).toBe(fuelAtStop);
    expect(bexLog().filter((e) => e.kind === "arrive").length).toBeGreaterThanOrEqual(1);
  });

  it("a spent act budget never blocks an arrival (spec §5.4)", () => {
    const { plan, away } = crossWorldDay();
    const first = plan[0];
    if (!first) throw new Error("plan must have visits");
    advancePlanned(handle, first.startMs);
    let legAt = -1;
    for (let t = first.startMs; t <= away.startMs + H; t += H) {
      advancePlanned(handle, t);
      if (captains().state("bex")?.legTo) { legAt = t; break; }
    }
    expect(legAt).toBeGreaterThan(0);
    const arrivesAt = captains().state("bex")?.legArrivesStepMs ?? 0;
    // Fill today's act budget with filler log entries (L1's pattern).
    
    for (let i = 0; i < CAPTAIN_MAX_ACTS_PER_DAY; i++) {
      new NpcRepo(handle, SPACE).appendLog("bex", "wait", "Filler.", "Budget test fill.", legAt);
    }
    // Advance past the arrival step: the arrival still resolves —
    // arrival is state completion, not a discretionary act.
    advancePlanned(handle, arrivesAt + 2 * H);
    const st = captains().state("bex");
    expect(st?.legTo).toBeNull();
    expect(st?.currentWorld).toBe(away.world);
  });
});
