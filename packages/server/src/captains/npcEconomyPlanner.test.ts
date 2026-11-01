import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, type CaptainWorld } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import {
  ECONOMY_COMPONENT_GOAL_ID,
  ECONOMY_SAVINGS_GOAL_ID,
  P3_PLAN_ACTIONS,
  planForGoal,
  type CaptainWorldState,
} from "./planner.js";
import { PurposeStore, type PurposeExec } from "./purpose.js";
import { NpcEconomy } from "./npcEconomy.js";
import { runEconomyDecisionPoint } from "./economyDriver.js";
import { utilityDecider, type CaptainPerception } from "./decider.js";

/**
 * P3 — planner + decider integration (T1/T5, D-1/D-2): the three
 * verbs join the GOAP catalog; a Component goal plans
 * gather → … → travel → refine; Ambition is instrumented in the
 * utility decider; the economy driver stores and follows the plan
 * for a non-purpose captain (Bex) end to end.
 */
const SPACE = "spaceA";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const H = 3_600_000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const baseState: CaptainWorldState = {
  world: "great-station",
  stirrings: [],
  holdings: 0,
  hasWitness: false,
  gateOpen: false,
  dueDeed: false,
  oldNode: false,
  linkable: false,
  deedRaisesAt: null,
  fuel: 60,
  priorNoFinds: 0,
};

describe("T1/T5 planner — the unlocked catalog", () => {
  it("the P3 action set is exactly P2's unlocked set plus gather/sell/refine", () => {
    const kinds = P3_PLAN_ACTIONS.map((a) => a.kind);
    for (const verb of ["gather", "sell", "refine"]) expect(kinds).toContain(verb);
    expect(kinds).toHaveLength(17);
  });

  it("a Component goal from an empty hold plans gather → gather → travel → refine, every step with an expected", () => {
    const draft = planForGoal(
      { ...baseState, world: "scale", cargo: {}, credits: 120, nodeGoods: ["ore", "salvage", "data"], savingsGoalCredits: 300 },
      ECONOMY_COMPONENT_GOAL_ID,
    );
    expect("steps" in draft).toBe(true);
    if (!("steps" in draft)) return;
    const kinds = draft.steps.map((s) => s.kind);
    expect(kinds.filter((k) => k === "gather")).toHaveLength(2);
    expect(kinds).toContain("refine");
    expect(kinds.indexOf("refine")).toBeGreaterThan(kinds.lastIndexOf("gather"));
    expect(draft.steps.length).toBeLessThanOrEqual(6);
    for (const s of draft.steps) expect(s.expected.length).toBeGreaterThan(0);
    const refine = draft.steps.find((s) => s.kind === "refine")!;
    expect(refine.recipeId).toBe("R-1");
  });

  it("a savings goal at the Station with a laden hold plans a sale", () => {
    const draft = planForGoal(
      { ...baseState, world: "great-station", cargo: { ore: 10 }, credits: 120, nodeGoods: ["ore"], savingsGoalCredits: 130 },
      ECONOMY_SAVINGS_GOAL_ID,
    );
    expect("steps" in draft).toBe(true);
    if (!("steps" in draft)) return;
    expect(draft.steps.map((s) => s.kind)).toContain("sell");
  });

  it("an economy goal with no supply and no cargo is honestly unplanned — no route within depth", () => {
    const draft = planForGoal(
      { ...baseState, cargo: {}, credits: 120, nodeGoods: [], savingsGoalCredits: 300 },
      ECONOMY_COMPONENT_GOAL_ID,
    );
    expect("unplanned" in draft).toBe(true);
  });
});

describe("T5 decider — Ambition instrumented (D-1)", () => {
  function perception(over: Partial<CaptainPerception> = {}): CaptainPerception {
    return {
      stepStartMs: T0,
      world: "great-station",
      destinations: ["scale"],
      destinationNames: { scale: "Scale" },
      openLeg: null,
      sessionAgeRatio: 0.2,
      stepsLeftInSession: 4,
      fuel: 60,
      playerPresent: false,
      greetedThisVisit: false,
      curiosity: 0.5,
      sociability: 0.4,
      economy: {
        credits: 10,
        savingsGoalCredits: 300,
        savingsGoalLabel: "a cargo of Circuits, bought honest",
        holdUsed: 0,
        holdCapacity: 20,
        cargo: [],
        nodes: [{ nodeId: "npc-belt-1", kind: "belt", good: "ore", remaining: 20 }],
        atStation: true,
        bestSale: null,
        refineOption: null,
        affinities: [],
      },
      ...over,
    };
  }

  it("far from her savings goal with an empty hold, she gathers (Ambition has an instrument now)", () => {
    const bex = captainDefinition("bex")!;
    const d = utilityDecider.decide(bex, perception());
    expect(d.act).toBe("gather");
  });

  it("at her goal with a laden hold at the Station, she sells rather than gathers more", () => {
    const bex = captainDefinition("bex")!;
    const d = utilityDecider.decide(
      bex,
      perception({
        economy: {
          credits: 320,
          savingsGoalCredits: 300,
          savingsGoalLabel: "a cargo of Circuits, bought honest",
          holdUsed: 5,
          holdCapacity: 20,
          cargo: [{ good: "ore", qty: 5 }],
          nodes: [{ nodeId: "npc-belt-1", kind: "belt", good: "ore", remaining: 20 }],
          atStation: true,
          bestSale: { buyerId: "station-foundry", good: "ore", qty: 5, unitPrice: 6 },
          refineOption: null,
          affinities: [],
        },
      }),
    );
    expect(d.act).toBe("sell");
  });
});

describe("T5 driver — Bex's stored economy plan, followed end to end (D-2)", () => {
  function fakeExec(): PurposeExec {
    const repo = new CaptainRepo(handle, SPACE);
    const log = new NpcRepo(handle, SPACE);
    return {
      logAct: (kind, act, cause, ms) => log.appendLog("bex", kind, act, cause, ms),
      logBookkeeping: (kind, act, cause, ms) => log.appendLog("bex", kind, act, cause, ms),
      openLeg: (to) => {
        repo.update("bex", { currentWorld: to, sessionWorld: to });
        return true;
      },
      state: () => repo.state("bex")!,
    };
  }

  it("builds the Component plan, gathers, travels, refines — the goal state lands in her hold", () => {
    const repo = new CaptainRepo(handle, SPACE);
    repo.ensureState(captainDefinition("bex")!, T0);
    repo.update("bex", {
      currentWorld: "scale", sessionKey: "s", sessionWorld: "scale",
      sessionStartedAt: new Date(T0).toISOString(), sessionEndsAt: new Date(T0 + 8 * H).toISOString(),
    });
    const exec = fakeExec();
    const store = new PurposeStore(handle, SPACE);
    // Point 1 builds the plan (bookkeeping); later points follow it.
    expect(runEconomyDecisionPoint(handle, SPACE, "bex", T0, exec)).toBe(true);
    const plans = store.planVersionsOf("bex", ECONOMY_COMPONENT_GOAL_ID);
    expect(plans).toHaveLength(1);
    const steps = store.stepsOf(plans[0]!.id);
    expect(steps.map((s) => s.kind)).toEqual(expect.arrayContaining(["gather", "refine"]));
    let guard = 0;
    while (guard++ < 12) {
      if (!runEconomyDecisionPoint(handle, SPACE, "bex", T0 + guard * H, exec)) break;
      const e = new NpcEconomy(handle, SPACE, "bex");
      if (e.cargo().some((c) => c.good === "component")) break;
    }
    const e = new NpcEconomy(handle, SPACE, "bex");
    expect(e.cargo()).toContainEqual({ good: "component", qty: 1 });
    expect(e.reconcile().ok).toBe(true);
    const after = store.stepsOf(plans[0]!.id);
    expect(after.filter((s) => s.state === "completed").length).toBeGreaterThanOrEqual(4);
    for (const s of after.filter((x) => x.state === "completed")) {
      expect(s.observed).toBeTruthy();
    }
    // The world she planned in is the world she is in: the Station, post-refine.
    expect(repo.state("bex")?.currentWorld).toBe("great-station");
    void (null as unknown as CaptainWorld);
  });
});
