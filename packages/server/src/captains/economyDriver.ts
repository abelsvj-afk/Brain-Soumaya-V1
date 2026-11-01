import type { DbHandle } from "../db/client.js";
import {
  CAPTAIN_MAX_ACTS_PER_DAY,
  CAPTAIN_ROUTINE_IMPORTANCE,
  GAME_GOOD_LABELS,
  captainDefinition,
  captainSavingsTarget,
  type CaptainDefinition,
  type CaptainId,
  type CaptainLegKind,
  type CaptainWorld,
  type GameGood,
} from "@brain/shared";
import { CaptainRepo, type CaptainStateRow } from "./repo.js";
import { PurposeStore, type PlanRow, type PlanStepRow, type PurposeExec } from "./purpose.js";
import {
  ECONOMY_COMPONENT_GOAL_ID,
  ECONOMY_SAVINGS_GOAL_ID,
  planForGoal,
  type CaptainWorldState,
} from "./planner.js";
import { NpcEconomy } from "./npcEconomy.js";
import { recordPremiumTaken } from "./affinity.js";

/**
 * P3 — the economy driver (T5): Ambition gets its instrument for
 * the captains whose lives are not already plan-driven by P2's
 * purpose arc. For a non-purpose economy captain (Bex, Junia) a
 * decision point runs her stored ECONOMY plan — built by the same
 * GOAP planner, stored in the same immutable plan store, followed
 * step by step inside the advance transaction, replanned on
 * mismatch exactly like the seeker's plans (expected vs observed,
 * supersede, never edit). Her standing order: hold a Component
 * (the refine chain made visible), then save toward her savings
 * goal (R6).
 *
 * The seeker is deliberately NOT plan-driven here: her long arc
 * owns her plans (P2), and her economy acts arrive as decider
 * decisions when her purpose driver declines a point — one
 * captain, one plan store discipline, no competing plans.
 *
 * Execution always re-reads state through the NPC economy service
 * (beliefs plan; state executes). A partial sale is an observed
 * outcome: the premium portion lands, the remainder rides to the
 * Exchange within the same act, and the price contradiction is a
 * mismatch + replan — never a silent destination swap.
 */

export const ECONOMY_GOAL_IDS: readonly string[] = [ECONOMY_COMPONENT_GOAL_ID, ECONOMY_SAVINGS_GOAL_ID];

export function isEconomyCaptain(def: CaptainDefinition): boolean {
  return (def.allowList as readonly string[]).includes("gather");
}

const GOAL_TEXT: Record<string, string> = {
  [ECONOMY_COMPONENT_GOAL_ID]: "hold a Component of her own refining",
};

function goalTextFor(goalId: string, def: CaptainDefinition): string {
  if (goalId === ECONOMY_SAVINGS_GOAL_ID) return `save for ${def.savingsGoalLabel}`;
  return GOAL_TEXT[goalId] ?? goalId;
}

/** Her world-state for the economy planner: her own stores only —
 *  cargo and Credits from the NPC instance, shadow supply from the
 *  pool view, never a real brain, never the player's rows. */
export function economyWorldState(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  state: CaptainStateRow,
  nowMs: number,
): CaptainWorldState {
  const def = captainDefinition(captainId)!;
  const svc = new NpcEconomy(h, spaceId, captainId);
  const cargo: Partial<Record<GameGood, number>> = {};
  for (const c of svc.cargo()) cargo[c.good] = c.qty;
  const nodeGoods = [...new Set(svc.nodes(nowMs).filter((n) => n.remaining > 0).map((n) => n.good))];
  return {
    world: state.currentWorld ?? state.homeWorld,
    stirrings: [],
    holdings: 0,
    hasWitness: false,
    gateOpen: false,
    dueDeed: false,
    oldNode: false,
    linkable: false,
    deedRaisesAt: null,
    fuel: state.fuel,
    priorNoFinds: 0,
    homeWorld: state.homeWorld,
    cargo,
    credits: Math.round(state.credits),
    nodeGoods,
    savingsGoalCredits: captainSavingsTarget(def, Math.round(state.credits)),
  };
}

function logPlanBuilt(exec: PurposeExec, plan: PlanRow, steps: PlanStepRow[], cause: string, nowMs: number): void {
  const stepText = steps.map((s) => s.label).join(" → ");
  exec.logBookkeeping(
    "plan",
    `Plan v${plan.version} for "${plan.goalText}": ${stepText || "no route within depth — unplanned"}.`,
    cause,
    nowMs,
  );
}

function budgetSpent(h: DbHandle, spaceId: string, captainId: CaptainId, nowMs: number): boolean {
  return new CaptainRepo(h, spaceId).actsToday(captainId, nowMs) >= CAPTAIN_MAX_ACTS_PER_DAY;
}

function rememberOutcome(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  text: string,
  world: CaptainWorld,
  logId: number | null,
  nowMs: number,
): void {
  new CaptainRepo(h, spaceId).addMemory(captainId, "outcome", text, CAPTAIN_ROUTINE_IMPORTANCE, [world], nowMs, {
    originLogId: logId,
  });
}

/** A plan step's outcome contradicted its expectation: record the
 *  mismatch (expected + observed verbatim), fail the step, and
 *  supersede the plan with a fresh draft from the CURRENT state —
 *  the P2 machinery, verbatim in shape (§5). */
function replanFromMismatch(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  plan: PlanRow,
  step: PlanStepRow,
  observed: string,
  observedLogId: number | null,
  nowMs: number,
  exec: PurposeExec,
): void {
  const store = new PurposeStore(h, spaceId);
  const mismatch = store.recordMismatch(
    captainId, plan.id, step.id, step.expected, observed, null, observedLogId,
    "The world contradicted the economy plan's expectation; the plan replans from the contradiction (§5.1).",
    nowMs,
  );
  exec.logBookkeeping(
    "plan",
    `Mismatch on plan v${plan.version}: expected ${step.expected}; observed ${observed}. Replanning.`,
    "The world contradicted the economy plan's expectation; the plan replans from the contradiction (§5.1).",
    nowMs,
  );
  store.failStep(step.id, observed, observedLogId);
  const repo = new CaptainRepo(h, spaceId);
  const state = repo.state(captainId);
  if (!state) return;
  const ws = economyWorldState(h, spaceId, captainId, state, nowMs);
  const draft = planForGoal(ws, plan.goalId);
  const draftSteps = "steps" in draft ? draft.steps : [];
  const next = store.supersedePlan(captainId, plan.id, mismatch.id, draftSteps, nowMs, null);
  logPlanBuilt(exec, next, store.stepsOf(next.id), "A plan is rebuilt from the current world state when the world contradicts it — the goal never changes; only the route does (§5.2).", nowMs);
}

function followEconomyStep(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  plan: PlanRow,
  step: PlanStepRow,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  const def = captainDefinition(captainId)!;
  const store = new PurposeStore(h, spaceId);
  const svc = new NpcEconomy(h, spaceId, captainId);
  const state = exec.state();
  const world = state.currentWorld ?? state.homeWorld;
  const stepKey = `${captainId}:${nowMs}:${step.kind}:${step.id}`;
  const cause = `Ambition — the stored plan's next step toward "${plan.goalText}".`;

  if (step.kind === "gather") {
    if (budgetSpent(h, spaceId, captainId, nowMs)) return true; // the day ends quietly; the step stays open
    const good = (step.params.good as GameGood | null) ?? "ore";
    const kind = good === "ore" ? "belt" : good === "data" ? "signal" : "wreck";
    const node = svc.nodes(nowMs).find((n) => n.kind === kind && n.remaining > 0);
    if (!node) {
      replanFromMismatch(h, spaceId, captainId, plan, step, `the shadow ${kind} supply is worked out for today`, null, nowMs, exec);
      return true;
    }
    const qty = typeof step.params.qty === "number" ? (step.params.qty as number) : undefined;
    const out = svc.gather(node.nodeId, stepKey, nowMs, qty);
    if (!out.ok) {
      replanFromMismatch(h, spaceId, captainId, plan, step, out.message, null, nowMs, exec);
      return true;
    }
    const entry = exec.logAct("gather", `Gathered ${out.gathered} ${GAME_GOOD_LABELS[out.good]} from a ${kind} site in the shadow supply.`, cause, nowMs);
    if (!entry) return true;
    store.completeStep(step.id, `gathered ${out.gathered} ${GAME_GOOD_LABELS[out.good]}`, entry.id, nowMs);
    rememberOutcome(h, spaceId, captainId, `Gathered ${out.gathered} ${GAME_GOOD_LABELS[out.good]} toward "${plan.goalText}".`, world, entry.id, nowMs);
    return true;
  }

  if (step.kind === "warp" || step.kind === "drift" || step.kind === "go-home") {
    const to = step.params.world as CaptainWorld | null;
    if (!to) return true;
    if (to === world) {
      store.completeStep(step.id, `already at ${to}`, null, nowMs);
      return true;
    }
    const legKind: CaptainLegKind = step.kind === "go-home" ? "home" : step.kind;
    exec.openLeg(to, legKind, cause, nowMs);
    return true; // arrival completes the step (onEconomyArrival)
  }

  if (step.kind === "refine") {
    if (budgetSpent(h, spaceId, captainId, nowMs)) return true;
    const recipeId = (step.params.recipeId as string | null) ?? "R-1";
    const out = svc.refine(recipeId, 1, stepKey, nowMs);
    if (!out.ok) {
      replanFromMismatch(h, spaceId, captainId, plan, step, out.message, null, nowMs, exec);
      return true;
    }
    const entry = exec.logAct(
      "refine",
      `Refined ${recipeId} at the Station refinery — a ${GAME_GOOD_LABELS[out.output]} came out; the ${out.feeCharged}-Credit fee is burned.`,
      cause,
      nowMs,
    );
    if (!entry) return true;
    store.completeStep(step.id, `refined ${recipeId} into 1 ${GAME_GOOD_LABELS[out.output]}`, entry.id, nowMs);
    rememberOutcome(h, spaceId, captainId, `Refined a ${GAME_GOOD_LABELS[out.output]} at the Station.`, world, entry.id, nowMs);
    return true;
  }

  if (step.kind === "sell") {
    if (budgetSpent(h, spaceId, captainId, nowMs)) return true;
    const good = (step.params.good as GameGood | null) ?? "ore";
    const plannedQty = typeof step.params.qty === "number" ? (step.params.qty as number) : 0;
    const held = svc.cargo().find((c) => c.good === good)?.qty ?? 0;
    const qty = Math.min(plannedQty > 0 ? plannedQty : held, held);
    if (qty <= 0) {
      replanFromMismatch(h, spaceId, captainId, plan, step, `the hold carries no ${GAME_GOOD_LABELS[good]} to sell`, null, nowMs, exec);
      return true;
    }
    const plannedBuyer = (step.params.buyerId as string | null) ?? "station-exchange";
    const before = svc.credits();
    const first = svc.sell(plannedBuyer as never, good, qty, stepKey, nowMs);
    if (!first.ok && first.error !== "demand_exhausted") {
      replanFromMismatch(h, spaceId, captainId, plan, step, first.message, null, nowMs, exec);
      return true;
    }
    let accepted = 0;
    let total = 0;
    let splitNote = "";
    if (first.ok) {
      accepted += first.accepted;
      total += first.totalCredits;
      if (first.declined > 0) {
        // The remainder rides to the Exchange within the same act —
        // the floor is hers too (Architecture §7.4).
        const rest = svc.sell("station-exchange", good, first.declined, `${stepKey}:floor`, nowMs);
        if (rest.ok) {
          accepted += rest.accepted;
          total += rest.totalCredits;
          splitNote = ` (${first.accepted} at the premium, ${rest.accepted} at the Exchange's base — the premium demand was spent)`;
        }
      }
      if (first.demandRemaining === 0 && first.accepted > 0) {
        recordPremiumTaken(h, spaceId, captainId, plannedBuyer, good, nowMs);
      }
    } else {
      // Premium demand was already gone when she arrived: the whole
      // lot rides to the Exchange, and the plan learns from it.
      const rest = svc.sell("station-exchange", good, qty, `${stepKey}:floor`, nowMs);
      if (!rest.ok) {
        replanFromMismatch(h, spaceId, captainId, plan, step, rest.message, null, nowMs, exec);
        return true;
      }
      accepted = rest.accepted;
      total = rest.totalCredits;
      splitNote = " (the premium demand was already spent — the lot went at the Exchange's base)";
    }
    const entry = exec.logAct(
      "sell",
      `Sold ${accepted} ${GAME_GOOD_LABELS[good]} for ${total} Credits${splitNote}.`,
      cause,
      nowMs,
    );
    if (!entry) return true;
    const observed = `sold ${accepted} ${GAME_GOOD_LABELS[good]} for ${total} Credits${splitNote}`;
    store.addKnowledge(
      captainId,
      `The ${buyerPlainName(plannedBuyer)} sale of ${GAME_GOOD_LABELS[good]} landed ${total} Credits for ${accepted} units${splitNote ? " — premium demand there was spent" : ""}.`,
      "firsthand",
      "seen-at-execution",
      entry.id,
      nowMs,
    );
    rememberOutcome(h, spaceId, captainId, `Sold ${accepted} ${GAME_GOOD_LABELS[good]} for ${total} Credits.`, world, entry.id, nowMs);
    if (splitNote) {
      replanFromMismatch(h, spaceId, captainId, plan, step, observed, entry.id, nowMs, exec);
      return true;
    }
    store.completeStep(step.id, observed, entry.id, nowMs);
    maybeLogSavingsMilestone(h, spaceId, captainId, before, svc.credits(), exec, nowMs);
    return true;
  }

  // Any other step kind is not an economy step; close it honestly
  // rather than blocking the plan forever.
  store.completeStep(step.id, "handled by the economy driver's standing order", null, nowMs);
  return true;
}

function buyerPlainName(buyerId: string): string {
  switch (buyerId) {
    case "station-exchange": return "Station Exchange";
    case "station-foundry": return "Station Foundry";
    case "salvage-yard": return "Salvage Yard";
    case "archive-broker": return "Archive Broker";
    case "fleet-quartermaster": return "Fleet Quartermaster";
    default: return buyerId;
  }
}

/** R6 completion: crossing a savings target is a logged milestone
 *  that re-aims Ambition at the next multiple — never a finish. */
export function maybeLogSavingsMilestone(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  before: number,
  after: number,
  exec: PurposeExec,
  nowMs: number,
): void {
  const def = captainDefinition(captainId)!;
  const beforeTarget = captainSavingsTarget(def, before);
  const afterTarget = captainSavingsTarget(def, after);
  if (afterTarget <= beforeTarget) return;
  exec.logBookkeeping(
    "plan",
    `Milestone: ${def.name} reached ${beforeTarget} Credits — ${def.savingsGoalLabel} is funded. The next mark is ${afterTarget}.`,
    "R6: a savings goal completed re-aims Ambition at the next multiple — she does not stall at the finish.",
    nowMs,
  );
  new CaptainRepo(h, spaceId).addMemory(
    captainId,
    "milestone",
    `Reached ${beforeTarget} Credits — ${def.savingsGoalLabel} is funded. The next mark is ${afterTarget}.`,
    CAPTAIN_ROUTINE_IMPORTANCE,
    ["savings"],
    nowMs,
  );
}

/**
 * One economy decision point for a non-purpose economy captain.
 * Returns true when the point was spent (a plan built, a step
 * followed, a mismatch replanned); false when she has no economy
 * business this point and the ordinary decider should run.
 */
export function runEconomyDecisionPoint(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  const def = captainDefinition(captainId);
  if (!def || !def.active || !isEconomyCaptain(def)) return false;
  // A spent day ends quietly (L1 budget rule): no plan is built, no
  // step is followed, nothing is logged. Arrival completions stay
  // budget-proof in onEconomyArrival (A7/§5.4) — this gate covers
  // only her discretionary market work.
  if (budgetSpent(h, spaceId, captainId, nowMs)) return true;
  const store = new PurposeStore(h, spaceId);
  let plan = store.activePlan(captainId, ECONOMY_GOAL_IDS);

  if (!plan) {
    const state = exec.state();
    const ws = economyWorldState(h, spaceId, captainId, state, nowMs);
    const cargo = ws.cargo ?? {};
    const goalId = (cargo.component ?? 0) >= 1 ? ECONOMY_SAVINGS_GOAL_ID : ECONOMY_COMPONENT_GOAL_ID;
    const draft = planForGoal(ws, goalId);
    if ("steps" in draft && draft.steps.length === 0) return false; // goal already met — nothing to plan
    const draftSteps = "steps" in draft ? draft.steps : [];
    plan = store.createPlan(captainId, goalId, goalTextFor(goalId, def), draftSteps, null, null, nowMs, null);
    logPlanBuilt(
      exec,
      plan,
      store.stepsOf(plan.id),
      "Ambition has an instrument now (the economy, L3): her standing goal gives the planner a route through the shadow supply and the NPC demand pool.",
      nowMs,
    );
    return true;
  }

  if (plan.state === "unplanned") return false; // recorded once; the decider's single acts carry her until the world changes

  const steps = store.stepsOf(plan.id);
  const next = steps.find((s) => s.state === "open");
  if (!next) {
    store.closePlan(plan.id, "completed");
    return true;
  }
  return followEconomyStep(h, spaceId, captainId, plan, next, nowMs, exec);
}

/** An arrival closes the economy plan's travel step it served —
 *  the economy twin of onPurposeArrival, called from the engine's
 *  arrival paths for economy captains. */
export function onEconomyArrival(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  world: CaptainWorld,
  arrivalLogId: number | null,
  nowMs: number,
): void {
  void nowMs;
  const store = new PurposeStore(h, spaceId);
  const plan = store.activePlan(captainId, ECONOMY_GOAL_IDS);
  if (!plan || plan.state !== "active") return;
  const steps = store.stepsOf(plan.id);
  const next = steps.find((s) => s.state === "open");
  if (
    next &&
    (next.kind === "warp" || next.kind === "drift" || next.kind === "go-home") &&
    (next.params.world as string | null) === world
  ) {
    store.completeStep(next.id, `arrival at ${world}`, arrivalLogId, nowMs);
    const after = store.stepsOf(plan.id);
    if (after.every((s) => s.state !== "open")) store.closePlan(plan.id, "completed");
  }
}
