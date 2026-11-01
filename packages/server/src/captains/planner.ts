import {
  CAPTAIN_PLAN_WARP_MIN_FUEL,
  CAPTAIN_TRAVEL_WORLDS,
  WARP_COST,
  type CaptainWorld,
} from "@brain/shared";

/**
 * The GOAP planner (P2 spec §4, component C3): a small A*-style
 * search, depth ≤ 6, working forward from the captain's actual
 * world-state to the goal world-state, over the P2 action catalog.
 * Plans are PREDICTIONS: every step stores its `expected` outcome
 * at plan time; execution records `observed` from the act's log
 * event; a contradiction supersedes the version — never edits it
 * (spec §5, enforced by the plan store in purpose.ts).
 *
 * The catalog below is the galaxy-scope catalog of spec §4. The
 * three P3 verbs are carried in P2_LOCKED_ACTIONS — present so the
 * catalog is complete and the phase boundary is unmissable,
 * excluded from the planner's action set, and refused by the fence
 * with a phase-lock cause (P2-B1.9). They have no action entry, no
 * preconditions, no effects: in P2 they cannot be planned, only
 * named as locked.
 *
 * Catalogue rules honored here (spec §4): player-rule parity (the
 * player's chart and prices on her own tank — warp costs WARP_COST
 * of her fuel, drift and the home route are free); no stranded
 * state (drift and go-home are always in the set, so a 0-fuel plan
 * home always exists); no resource creation (fuel is only spent,
 * relics enter only via Search, Credits move only via the board);
 * honesty (a goal unreachable within depth is `unplanned — no
 * route within depth`, with the goal retained — the planner never
 * fabricates a step, e.g. a Search where no stirring of hers
 * exists).
 */

export const GATE_GOAL_ID = "gate-worthy";
export const GATE_GOAL_TEXT = "hold Witness + any two";

/** The planner's action vocabulary (spec §4's fourteen unlocked
 *  actions, grouped exactly as the table groups them). */
export type PlanActionKind =
  | "warp"
  | "drift"
  | "go-home"
  | "search"
  | "tend"
  | "resurface"
  | "review"
  | "link"
  | "take-commission"
  | "complete-commission-step"
  | "gate-check"
  | "attempt-gate-passage"
  | "talk-greet"
  | "wait";

export interface PlannerAction {
  kind: PlanActionKind;
  /** The component that owns the action's execution (spec §2). */
  owner: string;
}

export const P2_PLAN_ACTIONS: readonly PlannerAction[] = [
  { kind: "warp", owner: "C6 Travel" },
  { kind: "drift", owner: "C6 Travel" },
  { kind: "go-home", owner: "C6 Travel" },
  { kind: "search", owner: "C7 Search" },
  { kind: "tend", owner: "C4 Sim Brain" },
  { kind: "resurface", owner: "C4 Sim Brain" },
  { kind: "review", owner: "C4 Sim Brain" },
  { kind: "link", owner: "C4 Sim Brain" },
  { kind: "take-commission", owner: "C5 Sim Board" },
  { kind: "complete-commission-step", owner: "C5 Sim Board" },
  { kind: "gate-check", owner: "C9 Gate Record" },
  { kind: "attempt-gate-passage", owner: "C9 Gate Record → C6 Travel" },
  { kind: "talk-greet", owner: "C11 Memory" },
  { kind: "wait", owner: "C2 Decider / C1 Advance" },
] as const;

/** The P3-locked verbs (spec §4, struck through in the catalog):
 *  listed here so a reviewer can diff code against spec line by
 *  line — and so the fence's phase-lock refusal has one source.
 *  ~~Gather~~ / ~~Sell~~ / ~~Refine~~ — P3, against G1's
 *  instruments, shadow supply, and the NPC demand pool. */
export const P2_LOCKED_ACTIONS: readonly string[] = ["gather", "sell", "refine"] as const;

export const PLAN_MAX_DEPTH = 6;

/** The captain's world-state as the planner sees it — abstracted
 *  from her real stores by the purpose module (never from belief:
 *  C14 knowledge is NOT a planner input; holdings come from C8). */
export interface CaptainWorldState {
  /** The world she is in (a plan never starts from transit). */
  world: CaptainWorld;
  /** Worlds where HER stirring record (C13) holds an active stirring. */
  stirrings: readonly CaptainWorld[];
  /** Relics held in C8 (count). */
  holdings: number;
  hasWitness: boolean;
  /** Her gate permanence (C9) is already open. */
  gateOpen: boolean;
  /** A due review card waits on her sim brain. */
  dueDeed: boolean;
  /** Her sim brain holds a node ≥ 1 year old. */
  oldNode: boolean;
  /** Two linkable nodes exist on her sim brain. */
  linkable: boolean;
  /** The world a deed would raise a stirring at (the deed node's
   *  outward point), or null when no deed can raise one. */
  deedRaisesAt: CaptainWorld | null;
  /** Her own fuel. */
  fuel: number;
  /** Searches on this goal that already came back no-find — a
   *  replanned search step declares BOTH branches in advance
   *  (spec §5.2 rule 4), where the first plan's search was planned
   *  on the find branch. */
  priorNoFinds: number;
  /** Her home anchor world (for go-home legs). */
  homeWorld?: CaptainWorld;
}

export interface PlannedStep {
  kind: PlanActionKind;
  label: string;
  /** The world-state this step assumes on completion — stored at
   *  plan time, immutable thereafter (spec §5.1). */
  expected: string;
  /** Destination for travel / passage steps. */
  world?: CaptainWorld;
  /** The deed verb for deed steps. */
  deed?: "tend" | "resurface" | "review" | "link";
  /** Search steps declare their branch handling in advance
   *  (spec §5.2 rule 4). */
  branch: "find-branch" | "two-branch";
}

export type PlanDraft = { steps: PlannedStep[] } | { unplanned: string };

interface SearchState {
  at: CaptainWorld;
  stirrings: readonly CaptainWorld[];
  holdings: number;
  decided: boolean;
  /** Searches executed on THIS plan — the goal predicate below
   *  reads it: a plan exists to make progress, not to re-ask a
   *  question she just asked. */
  searches: number;
}

const keyOf = (s: SearchState): string =>
  `${s.at}|${[...s.stirrings].sort().join(",")}|${s.holdings}|${s.decided ? 1 : 0}|${s.searches}`;

/** The goal, stated exactly (spec §3/§4): a gate DECISION reached
 *  by a plan that made progress — she holds the shape's count
 *  (any two, the gate-check's own composition does the rest), and
 *  either she already holds the Witness or this plan searched at
 *  least once (and, when a live stirring stood at plan time, the
 *  plan pursued it rather than asking around it). */
function isGoal(s: SearchState, input: CaptainWorldState): boolean {
  if (!s.decided || s.holdings < 2) return false;
  if (!input.hasWitness && s.searches < 1) return false;
  if (input.stirrings.length > 0 && s.searches < 1) return false;
  return true;
}

function worldPlain(w: CaptainWorld): string {
  switch (w) {
    case "great-station":
      return "Great Station";
    case "scale":
      return "Scale";
    case "growing-place":
      return "the Growing Place";
    case "deep-past":
      return "the Deep Past";
    case "quiet-archive":
      return "the Quiet Archive";
  }
}

/** Which deed the planner reaches for, in Duty order: a due card
 *  first, then the old node's resurface, then a link, then a tend. */
function deedKindOf(state: CaptainWorldState): PlannedStep["deed"] | null {
  if (state.dueDeed) return "review";
  if (state.oldNode) return "resurface";
  if (state.linkable) return "link";
  // A tend needs no special precondition beyond owning a sim brain.
  return "tend";
}

/** Successors of an abstract state under the catalog, with the
 *  step each action would store. Costs are uniform (1 per step):
 *  depth is the scarce resource the spec caps. */
function successors(
  s: SearchState,
  input: CaptainWorldState,
): { next: SearchState; step: PlannedStep }[] {
  const out: { next: SearchState; step: PlannedStep }[] = [];
  const home = input.homeWorld ?? input.world;

  // Deeds (C4): raise a stirring at the deed node's outward world.
  const deed = deedKindOf(input);
  if (deed && input.deedRaisesAt && !s.stirrings.includes(input.deedRaisesAt)) {
    out.push({
      next: { ...s, stirrings: [...s.stirrings, input.deedRaisesAt] },
      step: {
        kind: deed,
        label: `${deed === "review" ? "Review the due card" : deed === "resurface" ? "Resurface an old node" : deed === "link" ? "Link two of her nodes" : "Tend her brain"} — its stirring rises at ${worldPlain(input.deedRaisesAt)}`,
        expected: `a stirring at ${worldPlain(input.deedRaisesAt)}`,
        deed,
        branch: "find-branch",
      },
    });
  }

  // Search (C7): only where HER stirring is active; the plan is
  // written on the find branch (or declares both branches once she
  // has already been refused once on this goal — §5.2 rule 4).
  if (s.stirrings.includes(s.at)) {
    out.push({
      next: {
        ...s,
        stirrings: s.stirrings.filter((w) => w !== s.at),
        holdings: Math.min(3, s.holdings + 1),
        searches: s.searches + 1,
      },
      step: {
        kind: "search",
        label: `Search the ${worldPlain(s.at)} stirring`,
        expected: `a find at ${worldPlain(s.at)}`,
        world: s.at,
        branch: input.priorNoFinds > 0 ? "two-branch" : "find-branch",
      },
    });
  }

  // Travel (C6): to any stirring world she is not already at, on
  // the player's chart and prices. Warp whenever her tank is
  // comfortable (CAPTAIN_PLAN_WARP_MIN_FUEL) — including homeward:
  // the spec's worked arc warps Station → Scale (her home) at
  // fuel 30 and pays for it. Below the threshold the homeward leg
  // rides the home route (go-home) and other legs drift — both
  // free, so at 0 fuel a path home always exists (invariant 4).
  for (const dest of s.stirrings) {
    if (dest === s.at) continue;
    const isHome = dest === home;
    const kind: PlanActionKind =
      input.fuel >= CAPTAIN_PLAN_WARP_MIN_FUEL ? "warp" : isHome ? "go-home" : "drift";
    out.push({
      next: { ...s, at: dest },
      step: {
        kind,
        label:
          kind === "warp"
            ? isHome
              ? `Warp home to ${worldPlain(dest)} (−${WARP_COST} of her own fuel; the home route was free and available)`
              : `Warp to ${worldPlain(dest)} (−${WARP_COST} of her own fuel; drift was free and available)`
            : isHome
              ? `Go home — the home route to ${worldPlain(dest)}`
              : `Drift to ${worldPlain(dest)} (free — she is in no hurry)`,
        expected: `arrival at ${worldPlain(dest)}`,
        world: dest,
        branch: "find-branch",
      },
    });
  }

  // Gate check (C9): the action's own precondition is any
  // holdings at all (spec §4), but planner POLICY asks only when
  // she holds the shape's count (any two) AND the plan has hunted
  // — a search this plan — unless she already holds the gate's
  // full shape (the Witness plus two, three in hand), in which
  // case asking at once is the whole point. Without the hunt
  // clause, a captain one relic short of the shape would ask
  // early, be answered "one more relic", and never hunt — the
  // spec's worked arc (and its Witness variant) both hunt first.
  // The executor stays permissive.
  if (s.holdings >= 2 && !s.decided && (s.searches >= 1 || (input.hasWitness && s.holdings >= 3))) {
    out.push({
      next: { ...s, decided: true },
      step: {
        kind: "gate-check",
        label: "Ask the gate question",
        expected: "a gate decision",
        branch: "find-branch",
      },
    });
  }

  return out;
}

/**
 * Plan toward `goalId` from the captain's actual state. The gate
 * goal (B-01: hold Witness + any two, then a recorded decision) is
 * P2's one goal; when her gate already stands open, the goal's
 * plan is the passage chain — three ordinary legs, gated on the
 * open decision (spec §3.2).
 */
export function planForGoal(state: CaptainWorldState, goalId: string): PlanDraft {
  if (goalId !== GATE_GOAL_ID) {
    return { unplanned: `no route within depth — "${goalId}" is not a goal the P2 planner knows` };
  }
  if (state.gateOpen) {
    // The passage chain: three ordinary legs to three distinct
    // chart worlds, in travel-set order from where she stands.
    const chain = CAPTAIN_TRAVEL_WORLDS.filter((w) => w !== state.world).slice(0, 3);
    return {
      steps: chain.map((w, i) => ({
        kind: "attempt-gate-passage" as const,
        label: `Gate passage, leg ${i + 1} of 3 — travel to ${worldPlain(w)}`,
        expected: `arrival at ${worldPlain(w)}`,
        world: w,
        branch: "find-branch" as const,
      })),
    };
  }

  const start: SearchState = {
    at: state.world,
    stirrings: state.stirrings,
    holdings: state.holdings,
    decided: false,
    searches: 0,
  };
  // A* with a uniform step cost: breadth by depth to the goal
  // predicate (a decision this plan actually worked toward).
  const seen = new Map<string, number>([[keyOf(start), 0]]);
  let frontier: { s: SearchState; steps: PlannedStep[] }[] = [{ s: start, steps: [] }];
  while (frontier.length > 0) {
    const nextFrontier: typeof frontier = [];
    for (const node of frontier) {
      if (isGoal(node.s, state)) return { steps: node.steps };
      if (node.steps.length >= PLAN_MAX_DEPTH) continue;
      for (const { next, step } of successors(node.s, state)) {
        const k = keyOf(next);
        const depth = node.steps.length + 1;
        if (seen.has(k) && seen.get(k)! <= depth) continue;
        seen.set(k, depth);
        nextFrontier.push({ s: next, steps: [...node.steps, step] });
      }
    }
    frontier = nextFrontier;
  }
  return { unplanned: "unplanned — no route within depth" };
}
