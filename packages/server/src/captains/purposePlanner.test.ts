import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import {
  GATE_GOAL_ID,
  GATE_GOAL_TEXT,
  P3_PLAN_ACTIONS,
  P2_PLAN_ACTIONS,
  planForGoal,
  type CaptainWorldState,
} from "./planner.js";
import { PurposeStore } from "./purpose.js";

/**
 * P2-B1.1 / B1.8 — the plan store + GOAP planner (spec §4/§5,
 * outlines §5 P-1..P-3 and §2 R-1..R-9).
 *
 * A stored plan is a prediction: every step carries its `expected`,
 * versions are immutable, a contradiction supersedes (never edits),
 * and the goal id survives every replan.
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

const store = () => new PurposeStore(handle, SPACE);

function seedVeyra(nowMs = T0): void {
  const def = captainDefinition("veyra")!;
  new CaptainRepo(handle, SPACE).ensureState(def, nowMs);
}

const baseState: CaptainWorldState = {
  world: "great-station",
  stirrings: ["great-station"],
  holdings: 1,
  hasWitness: false,
  gateOpen: false,
  dueDeed: true,
  oldNode: true,
  linkable: true,
  deedRaisesAt: "scale",
  fuel: 30,
  priorNoFinds: 0,
};

describe("P2 planner — the action set and the plan it builds (B1.1)", () => {
  it("the planner's action set is exactly the spec §4 unlocked catalog — no locked verb, depth ≤ 6 shapes", () => {
    const kinds = P2_PLAN_ACTIONS.map((a) => a.kind);
    expect(kinds).toEqual([
      "warp",
      "drift",
      "go-home",
      "search",
      "tend",
      "resurface",
      "review",
      "link",
      "take-commission",
      "complete-commission-step",
      "gate-check",
      "attempt-gate-passage",
      "talk-greet",
      "wait",
    ]);
    // P3 re-scope: the formerly phase-locked economy verbs are
    // unlocked in the P3 action set (P3_PLAN_ACTIONS = the P2 set
    // + gather/sell/refine) and remain absent from the P2 set.
    const p3Kinds = P3_PLAN_ACTIONS.map((a) => a.kind);
    expect(p3Kinds).toEqual([...kinds, "gather", "sell", "refine"]);
    for (const verb of ["gather", "sell", "refine"]) expect(kinds).not.toContain(verb);
  });

  it("P-1: a scripted goal produces a plan whose every step carries an expected outcome", () => {
    const draft = planForGoal(baseState, GATE_GOAL_ID);
    expect("steps" in draft).toBe(true);
    if (!("steps" in draft)) return;
    expect(draft.steps.length).toBeGreaterThan(0);
    expect(draft.steps.length).toBeLessThanOrEqual(6);
    for (const s of draft.steps) expect(s.expected.length).toBeGreaterThan(0);
    // The arc's v1 shape: search the Station stirring, then the gate check.
    expect(draft.steps[0]?.kind).toBe("search");
    expect(draft.steps[0]?.expected).toBe("a find at Great Station");
    expect(draft.steps[draft.steps.length - 1]?.kind).toBe("gate-check");
  });

  it("P-3/R-9: an unreachable goal is stored as unplanned — the planner fabricates no step", () => {
    // No stirring anywhere and no deed can raise one: search is
    // unreachable, so the gate goal cannot be planned within depth.
    const draft = planForGoal(
      { ...baseState, stirrings: [], dueDeed: false, oldNode: false, linkable: false, deedRaisesAt: null, holdings: 0 },
      GATE_GOAL_ID,
    );
    expect("unplanned" in draft).toBe(true);
    if ("unplanned" in draft) expect(draft.unplanned).toContain("no route within depth");
  });

  it("a plan toward a stirring in another world routes a travel leg first (player chart, her tank)", () => {
    const draft = planForGoal({ ...baseState, world: "great-station", stirrings: ["scale"] }, GATE_GOAL_ID);
    expect("steps" in draft).toBe(true);
    if (!("steps" in draft)) return;
    const travel = draft.steps.find((s) => s.kind === "warp" || s.kind === "drift" || s.kind === "go-home");
    expect(travel).toBeDefined();
    expect(travel?.world).toBe("scale");
    const searchIdx = draft.steps.findIndex((s) => s.kind === "search");
    expect(searchIdx).toBeGreaterThan(draft.steps.indexOf(travel!));
  });
});

describe("P2 plan store — versioning, mismatch, immutability (B1.1/B1.8)", () => {
  it("P-2/R-1: a forced contradiction supersedes v1 — v1 byte-unchanged, v2 under the same goal id, mismatch verbatim", () => {
    seedVeyra();
    const s = store();
    const draft = planForGoal(baseState, GATE_GOAL_ID);
    if (!("steps" in draft)) throw new Error("expected a plan");
    const v1 = s.createPlan("veyra", GATE_GOAL_ID, GATE_GOAL_TEXT, draft.steps, null, null, T0, null);
    const v1StepsBytes = JSON.stringify(s.stepsOf(v1.id));

    const step = s.stepsOf(v1.id)[0]!;
    const mismatch = s.recordMismatch(
      "veyra",
      v1.id,
      step.id,
      step.expected,
      "found nothing",
      111,
      222,
      "expected a find at Great Station, found nothing — replanning",
      T0 + H,
    );
    const draft2 = planForGoal({ ...baseState, stirrings: [] }, GATE_GOAL_ID);
    const v2 = s.supersedePlan("veyra", v1.id, mismatch.id, "steps" in draft2 ? draft2.steps : [], T0 + H, null);

    const v1After = s.planById(v1.id)!;
    expect(v1After.state).toBe("superseded");
    expect(v1After.supersedesId).toBeNull();
    // v1's STEPS and their expected strings are byte-unchanged.
    expect(JSON.stringify(s.stepsOf(v1.id))).toBe(v1StepsBytes);
    expect(s.stepsOf(v1.id)[0]?.expected).toBe("a find at Great Station");
    expect(v2.goalId).toBe(GATE_GOAL_ID);
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(v1.id);
    expect(v2.mismatchId).toBe(mismatch.id);
    expect(s.activePlan("veyra")?.id).toBe(v2.id);
    const mm = s.mismatchesOf("veyra");
    expect(mm).toHaveLength(1);
    expect(mm[0]?.expected).toBe("a find at Great Station");
    expect(mm[0]?.observed).toBe("found nothing");
    expect(mm[0]?.cause).toContain("expected a find at Great Station, found nothing");
  });

  it("R-3: completion is not a replan — a matched step closes in the same version, no mismatch", () => {
    seedVeyra();
    const s = store();
    const draft = planForGoal(baseState, GATE_GOAL_ID);
    if (!("steps" in draft)) throw new Error("expected a plan");
    const v1 = s.createPlan("veyra", GATE_GOAL_ID, GATE_GOAL_TEXT, draft.steps, null, null, T0, null);
    const step = s.stepsOf(v1.id)[0]!;
    s.completeStep(step.id, "a find at Great Station", 999, T0 + H);
    const after = s.stepsOf(v1.id)[0]!;
    expect(after.state).toBe("completed");
    expect(after.observed).toBe("a find at Great Station");
    expect(after.observedLogId).toBe(999);
    expect(s.planById(v1.id)?.state).toBe("active");
    expect(s.mismatchesOf("veyra")).toHaveLength(0);
    expect(s.planVersionsOf("veyra", GATE_GOAL_ID)).toHaveLength(1);
  });

  it("R-7: a stored version's steps cannot be edited in place through the store's public surface", () => {
    seedVeyra();
    const s = store();
    const draft = planForGoal(baseState, GATE_GOAL_ID);
    if (!("steps" in draft)) throw new Error("expected a plan");
    const v1 = s.createPlan("veyra", GATE_GOAL_ID, GATE_GOAL_TEXT, draft.steps, null, null, T0, null);
    const before = JSON.stringify(s.stepsOf(v1.id));
    // Every public mutation the store offers targets lifecycle, not
    // content: completing writes observed once; a second completion
    // is refused, and expected never moves.
    const step = s.stepsOf(v1.id)[0]!;
    s.completeStep(step.id, "found nothing", 5, T0 + H);
    expect(() => s.completeStep(step.id, "a find at Great Station", 6, T0 + 2 * H)).toThrow();
    const after = s.stepsOf(v1.id);
    expect(after[0]?.expected).toBe(JSON.parse(before)[0].expected);
    expect(after[0]?.observed).toBe("found nothing");
  });

  it("R-8: a goal change is its own record — a new goal never inherits the old goal's versions", () => {
    seedVeyra();
    const s = store();
    const draft = planForGoal(baseState, GATE_GOAL_ID);
    if (!("steps" in draft)) throw new Error("expected a plan");
    const v1 = s.createPlan("veyra", GATE_GOAL_ID, GATE_GOAL_TEXT, draft.steps, null, null, T0, null);
    s.closePlan(v1.id, "closed-goal-change");
    const other = s.createPlan("veyra", "tend-the-brain", "keep her brain tended", [], null, null, T0 + H, null);
    expect(other.goalId).toBe("tend-the-brain");
    expect(other.version).toBe(1);
    expect(s.planVersionsOf("veyra", GATE_GOAL_ID)).toHaveLength(1);
    expect(s.activePlan("veyra")?.goalId).toBe("tend-the-brain");
    expect(s.planById(v1.id)?.state).toBe("closed-goal-change");
  });
});
