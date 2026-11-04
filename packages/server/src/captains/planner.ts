import {
  CAPTAIN_PLAN_WARP_MIN_FUEL,
  CAPTAIN_TRAVEL_WORLDS,
  GAME_GOOD_LABELS,
  HOLD_CAPACITY,
  RECIPES,
  WARP_COST,
  postedPrice,
  type CaptainWorld,
  type GameBuyerId,
  type GameGood,
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
 * three economy verbs (Gather / Sell / Refine) were P3-locked
 * through P2 (P2-B1.9); P3 unlocks them — they join the action set
 * as P3_PLAN_ACTIONS with the Layer §5.2 catalog's preconditions
 * and effects, planning against the NPC pools only (shadow supply
 * + NPC demand pool, priced by G1's postedPrice()).
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
 *  actions, grouped exactly as the table groups them — plus, from
 *  P3, the three economy verbs the Waking Market unlocks). */
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
  | "wait"
  | "gather"
  | "sell"
  | "refine";

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

/** The P3 action set: P2's unlocked catalog plus exactly the
 *  three economy verbs (T1's done-test — the enumeration is the
 *  P2 set + gather/sell/refine, nothing else). The verbs plan
 *  against G1's instruments, the shadow supply, and the NPC
 *  demand pool. */
export const P3_PLAN_ACTIONS: readonly PlannerAction[] = [
  ...P2_PLAN_ACTIONS,
  { kind: "gather", owner: "L3 NPC Economy (shadow supply)" },
  { kind: "sell", owner: "L3 NPC Economy (NPC demand pool)" },
  { kind: "refine", owner: "L3 NPC Economy (Station refinery)" },
] as const;

/** The P3 economy goals the planner knows. */
export const ECONOMY_COMPONENT_GOAL_ID = "hold-component";
export const ECONOMY_SAVINGS_GOAL_ID = "savings-goal";

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
  /** P3: her hold, per good (the NPC pool's cargo — planner truth
   *  from her own store, exactly like holdings). */
  cargo?: Partial<Record<GameGood, number>>;
  /** P3: her Credits balance (her own ledger). */
  credits?: number;
  /** P3: gathered goods with shadow supply remaining somewhere in
   *  the pool right now (gather itself is world-less, R11). */
  nodeGoods?: readonly GameGood[];
  /** P3: her current savings target (R6, doubling per completion). */
  savingsGoalCredits?: number;
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
  /** P3: the good an economy step works with. */
  good?: GameGood;
  /** P3: the count an economy step plans to move. */
  qty?: number;
  /** P3: the recipe a refine step runs. */
  recipeId?: string;
  /** P3: the buyer a sell step plans to sell to (execution
   *  re-prices and re-checks demand — a stale pick becomes a
   *  partial sale and a mismatch, never a silent swap). */
  buyerId?: GameBuyerId;
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

/* ------------------------------------------------------------------ */
/* P3: the economy goals (Layer §5.2 catalog rows, un-struck)          */
/* ------------------------------------------------------------------ */

interface EconState {
  at: CaptainWorld;
  cargo: Partial<Record<GameGood, number>>;
  credits: number;
}

const econKey = (s: EconState, goalCap: number): string =>
  `${s.at}|${Object.entries(s.cargo).filter(([, q]) => (q ?? 0) > 0).sort().map(([g, q]) => `${g}:${q}`).join(",")}|${Math.min(s.credits, goalCap)}`;

const holdOf = (cargo: Partial<Record<GameGood, number>>): number =>
  Object.values(cargo).reduce((sum, q) => sum + (q ?? 0), 0);

/** The best posted price a good can plan on (execution re-prices
 *  and re-checks the NPC pool's demand — the plan is a prediction,
 *  priced from G1's own postedPrice()). */
function bestBuyerFor(good: GameGood): { buyerId: GameBuyerId; price: number } {
  let best: { buyerId: GameBuyerId; price: number } = { buyerId: "station-exchange", price: postedPrice("station-exchange", good) ?? 0 };
  for (const b of ["station-foundry", "salvage-yard", "archive-broker", "fleet-quartermaster"] as GameBuyerId[]) {
    const p = postedPrice(b, good);
    if (p !== null && p > best.price) best = { buyerId: b, price: p };
  }
  return best;
}

function econSuccessors(
  s: EconState,
  input: CaptainWorldState,
  goalId: string,
): { next: EconState; step: PlannedStep }[] {
  const out: { next: EconState; step: PlannedStep }[] = [];
  const home = input.homeWorld ?? input.world;
  const hold = holdOf(s.cargo);
  const space = HOLD_CAPACITY - hold;
  const nodeGoods = input.nodeGoods ?? [];

  // Gather (shadow supply; world-less, R11): at a present world,
  //  shadow node with remaining > 0, hold space → +goods, 1 act.
  //  For the Component goal the plan gathers what R-1 needs; for a
  //  savings goal it fills toward a saleable load.
  for (const good of nodeGoods) {
    let qty = 0;
    if (goalId === ECONOMY_COMPONENT_GOAL_ID) {
      const need = good === "ore" ? 3 : good === "salvage" ? 2 : 0;
      qty = Math.min(Math.max(0, need - (s.cargo[good] ?? 0)), space);
    } else {
      qty = Math.min(10, space);
    }
    if (qty <= 0) continue;
    const cargo = { ...s.cargo, [good]: (s.cargo[good] ?? 0) + qty };
    out.push({
      next: { ...s, cargo },
      step: {
        kind: "gather",
        label: `Gather ${qty} ${GAME_GOOD_LABELS[good]} from the shadow supply`,
        expected: `${qty} ${GAME_GOOD_LABELS[good]} in her hold`,
        good,
        qty,
        branch: "find-branch",
      },
    });
  }

  // Travel to the Station (sell/refine are Station services): the
  // ordinary leg kinds — warp when her tank is comfortable, the
  // home route home, drift otherwise. Drift and home are free, so
  // a 0-fuel route to the market always exists.
  if (s.at !== "great-station") {
    const isHome = home === "great-station";
    const kind: PlanActionKind =
      input.fuel >= CAPTAIN_PLAN_WARP_MIN_FUEL ? "warp" : isHome ? "go-home" : "drift";
    out.push({
      next: { ...s, at: "great-station" },
      step: {
        kind,
        label:
          kind === "warp"
            ? `Warp to the Great Station (−${WARP_COST} of her own fuel; drift was free and available)`
            : isHome
              ? "Go home — the home route to the Great Station"
              : "Drift to the Great Station (free — the market keeps)",
        expected: "arrival at the Great Station",
        world: "great-station",
        branch: "find-branch",
      },
    });
  }

  if (s.at === "great-station") {
    // Refine (R-1/R-2 exactly): inputs in hold, Credits ≥ fee →
    //  inputs consumed, +output, fee burned in her ledger.
    for (const recipe of RECIPES) {
      const inputs = Object.entries(recipe.inputs) as [GameGood, number][];
      if (!inputs.every(([g, n]) => (s.cargo[g] ?? 0) >= n)) continue;
      if (s.credits < recipe.feeCredits) continue;
      const cargo = { ...s.cargo };
      for (const [g, n] of inputs) cargo[g] = (cargo[g] ?? 0) - n;
      cargo[recipe.output] = (cargo[recipe.output] ?? 0) + 1;
      out.push({
        next: { ...s, cargo, credits: s.credits - recipe.feeCredits },
        step: {
          kind: "refine",
          label: `Refine ${recipe.id} — ${inputs.map(([g, n]) => `${n} ${GAME_GOOD_LABELS[g]}`).join(" + ")} → ${GAME_GOOD_LABELS[recipe.output]} (fee ${recipe.feeCredits} Credits)`,
          expected: `1 ${GAME_GOOD_LABELS[recipe.output]} in her hold`,
          recipeId: recipe.id,
          branch: "find-branch",
        },
      });
    }
    // Sell: present at Station, cargo ≥ qty → −goods, +Credits at
    //  the posted price, NPC-pool demand consumed (execution
    //  re-checks the pool; a partial sale is an observed outcome,
    //  not a planning error).
    for (const good of Object.keys(s.cargo) as GameGood[]) {
      const qty = s.cargo[good] ?? 0;
      if (qty <= 0) continue;
      const { buyerId, price } = bestBuyerFor(good);
      const cargo = { ...s.cargo, [good]: 0 };
      out.push({
        next: { ...s, cargo, credits: s.credits + qty * price },
        step: {
          kind: "sell",
          label: `Sell ${qty} ${GAME_GOOD_LABELS[good]} at the posted price`,
          expected: `${qty * price} Credits from the sale`,
          good,
          qty,
          buyerId,
          branch: "find-branch",
        },
      });
    }
  }
  return out;
}

/** Plan an economy goal: breadth by depth ≤ PLAN_MAX_DEPTH, the
 *  same honesty rule — no route within depth is `unplanned`, the
 *  goal retained, no step fabricated. */
export function planEconomyGoal(state: CaptainWorldState, goalId: string): PlanDraft {
  const start: EconState = {
    at: state.world,
    cargo: { ...(state.cargo ?? {}) },
    credits: state.credits ?? 0,
  };
  const goalCap = goalId === ECONOMY_SAVINGS_GOAL_ID ? (state.savingsGoalCredits ?? Number.POSITIVE_INFINITY) : 10_000;
  const isGoal = (s: EconState): boolean =>
    goalId === ECONOMY_COMPONENT_GOAL_ID
      ? (s.cargo.component ?? 0) >= 1
      : s.credits >= (state.savingsGoalCredits ?? Number.POSITIVE_INFINITY);
  if (isGoal(start)) return { steps: [] };
  const seen = new Map<string, number>([[econKey(start, goalCap), 0]]);
  let frontier: { s: EconState; steps: PlannedStep[] }[] = [{ s: start, steps: [] }];
  while (frontier.length > 0) {
    const nextFrontier: typeof frontier = [];
    for (const node of frontier) {
      if (node.steps.length >= PLAN_MAX_DEPTH) continue;
      for (const { next, step } of econSuccessors(node.s, state, goalId)) {
        const steps = [...node.steps, step];
        if (isGoal(next)) return { steps };
        const k = econKey(next, goalCap);
        if (seen.has(k) && seen.get(k)! <= steps.length) continue;
        seen.set(k, steps.length);
        nextFrontier.push({ s: next, steps });
      }
    }
    frontier = nextFrontier;
  }
  return { unplanned: "unplanned — no route within depth" };
}

/**
 * Plan toward `goalId` from the captain's actual state. The gate
 * goal (B-01: hold Witness + any two, then a recorded decision) is
 * P2's one goal; when her gate already stands open, the goal's
 * plan is the passage chain — three ordinary legs, gated on the
 * open decision (spec §3.2). P3 adds the two economy goals above.
 */
export function planForGoal(state: CaptainWorldState, goalId: string): PlanDraft {
  if (goalId === ECONOMY_COMPONENT_GOAL_ID || goalId === ECONOMY_SAVINGS_GOAL_ID) {
    return planEconomyGoal(state, goalId);
  }
  if (goalId !== GATE_GOAL_ID) {
    return { unplanned: `no route within depth — "${goalId}" is not a goal the planner knows` };
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
