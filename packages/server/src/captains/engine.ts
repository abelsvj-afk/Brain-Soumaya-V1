import type { DbHandle } from "../db/client.js";
import { NpcRepo, localDateKey } from "../npcs/repo.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import {
  CAPTAIN_ADVANCE_MAX_STEPS,
  CAPTAIN_ADVANCE_STEP_MS,
  CAPTAIN_DEFINITIONS,
  CAPTAIN_LEG_DRIFT_STEPS,
  CAPTAIN_LEG_WARP_STEPS,
  CAPTAIN_AFFINITY_CONVOY,
  CAPTAIN_AFFINITY_ENCOUNTER,
  CAPTAIN_MAX_ACTS_PER_DAY,
  CAPTAIN_MAX_SPEAKS_PER_DAY,
  CAPTAIN_ROUTINE_IMPORTANCE,
  CAPTAIN_START_CREDITS,
  CAPTAIN_START_FUEL,
  CAPTAIN_TRAVEL_WORLDS,
  GAME_GOOD_LABELS,
  HOLD_CAPACITY,
  RECIPES,
  buyerById,
  captainSavingsTarget,
  postedPrice,
  CAPTAIN_MEETING_IMPORTANCE,
  CAPTAIN_MEETING_IMPORTANCE_FIRST,
  CAPTAIN_SESSION_IMPORTANCE,
  WARP_COST,
  captainDefinition,
  npcDefinition,
  type CaptainId,
  type CaptainLegKind,
  type CaptainQuestionKind,
  type CaptainState,
  type CaptainWorld,
  type ChronicleLine,
  type NpcActKind,
} from "@brain/shared";
import { CaptainRepo, type CaptainStateRow } from "./repo.js";
import { NpcEconomy } from "./npcEconomy.js";
import {
  isEconomyCaptain,
  maybeLogSavingsMilestone,
  onEconomyArrival,
  runEconomyDecisionPoint,
} from "./economyDriver.js";
import { addAffinity, affinitiesOf, affinityLabel, coolAffinities, getAffinity, recordPremiumTaken } from "./affinity.js";
import { evaluateDirector, getDirectorState, laneClosureFor } from "./director.js";
import { PurposeStore } from "./purpose.js";
import type { CaptainEconomyPerception } from "./decider.js";
import { dayPlan, nextVisit, rngFor, zonedTimeMs, type CaptainVisit } from "./seed.js";
import { utilityDecider, type CaptainDecider, type CaptainDecision } from "./decider.js";
import { templateBarkSource, type BarkSource } from "./barks.js";
import {
  captainGateView,
  captainPlanView,
  isPurposeCaptain,
  onPurposeArrival,
  resetCaptainPurpose,
  runPurposeDecisionPoint,
  type PurposeExec,
} from "./purpose.js";

/**
 * The captain engine (NPC-Player Layer L1 — Presence; P1 —
 * Presence, Galaxy-Wide): lazy fast-forward over the shared NPC
 * framework (design §3). There are NO background timers: a captain
 * lives when someone looks — any read touching captain state
 * advances her from `last_advanced_at` to now in hourly seeded
 * steps (cap 72; beyond that, an honestly-logged summarized jump,
 * §3's "was away").
 *
 * Rules the engine enforces, from the design:
 *  - Fence (§5.1): a captain's act kind must be on HER allow-list
 *    and any world she enters must be in the D-1 travel set (P1
 *    spec §4: residence is a separate rule — a state row's home is
 *    its definition's anchor world, written once at creation).
 *    Violation is refused before anything is written.
 *  - A1 isolation: the engine writes ONLY captain tables and the
 *    shared NPC log. It never touches the player's fuel, credits,
 *    nodes, demand, relics, or brain — her warp burns HER fuel.
 *  - A2 determinism: every step's decisions come from the seeded
 *    plan + the pure decider; same seed and interval, same life —
 *    including identical legs (P1).
 *  - A4 budgets + kill switch: per-local-day act/speak caps, and a
 *    stopped captain is total silence (the cursor still moves, so
 *    resuming never backfills the stopped span).
 *  - A5 meetings: recorded in HER memory on your visits; the wipe
 *    makes the next meeting a first meeting again.
 *  - A7 transit honesty (P1 spec §5): inter-world travel is a LEG —
 *    departed → underway → arrived. A leg's destination is only
 *    ever copied from a held plan (the next planned visit, or a
 *    decider travel decision recorded at leg creation). Arrival
 *    resolves ONLY inside this advance's step loop, at/after the
 *    leg's arrival step. Underway writes no log line. A captain
 *    with an open leg is present at NEITHER world: no meeting, no
 *    greet, no ship label. Arrival is never budget-blocked — a
 *    budget must never strand a captain on a lane (§5.4).
 *
 * The harbor controller is untouched by this module — captains
 * share the log, the repo patterns, and the fence vocabulary only.
 */

export class CaptainError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

export function worldNamePlain(key: string): string {
  switch (key) {
    case "great-station":
      return "the Great Station";
    case "scale":
      return "Scale";
    case "growing-place":
      return "the Growing Place";
    case "deep-past":
      return "the Deep Past";
    case "quiet-archive":
      return "the Quiet Archive";
    default:
      return key;
  }
}

/** "in about an hour" / "later today" / "tomorrow" — relative and
 *  space-local, never a clock time and never a UTC anything. */
function whenPlain(tz: string, nowMs: number, atMs: number): string {
  const deltaH = (atMs - nowMs) / 3_600_000;
  const sameDay = localDateKey(tz, nowMs) === localDateKey(tz, atMs);
  if (deltaH <= 0.25) return "any moment now";
  if (deltaH < 1.5) return "within about an hour";
  if (sameDay) return "later today";
  const tomorrowKey = localDateKey(tz, zonedTimeMs(tz, localDateKey(tz, nowMs), 12) + 24 * 3_600_000);
  if (localDateKey(tz, atMs) === tomorrowKey) return "tomorrow";
  return "in a couple of days";
}

/** How a leg kind reads in plain words. */
function legKindPlain(kind: CaptainLegKind): string {
  return kind === "warp" ? "by warp" : kind === "home" ? "on the home route" : "by drift";
}

/** A purpose captain's fallback when the purpose driver declines
 *  a decision point: greet a present visitor once per visit, else
 *  wait. The utility decider's travel/depart choices would fight
 *  her plan — her travel belongs to the planner and the board
 *  (Arch §4.3), never to idle utility. */
export const purposeFallbackDecider: CaptainDecider = {
  decide(def, p) {
    if (p.playerPresent && !p.greetedThisVisit) {
      return { act: "greet", cause: "A visitor is here and unmet this visit — a purpose captain still keeps company." };
    }
    return { act: "wait", cause: `${def.name} waits — the purpose driver holds her course this step.` };
  },
};

export interface CaptainWorldDeps {
  decider?: CaptainDecider;
  barks?: BarkSource;
  /** P2: scripted search outcomes for tests. Production omits it
   *  and the seeded draw discipline (purpose.ts searchDrawFor)
   *  decides — never a wall clock, never Math.random. */
  searchDraw?: (captainId: CaptainId, stirringId: number) => number;
}

interface StepCtx {
  h: DbHandle;
  spaceId: string;
  captainId: CaptainId;
  def: (typeof CAPTAIN_DEFINITIONS)[number];
  captains: CaptainRepo;
  log: NpcRepo;
  travel: TravelRepo;
  tz: string;
  decider: CaptainDecider;
  /** True when the caller injected a decider for this advance: the
   *  injection is the advance's steering authority, and the P3
   *  economy driver yields to it (production callers never inject;
   *  scripted control and tests do). */
  deciderInjected: boolean;
  barkSource: BarkSource;
  searchDraw?: (captainId: CaptainId, stirringId: number) => number;
  state: CaptainStateRow;
  playerWorld: string | null;
  playerEnRoute: boolean;
}

function makeCtx(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  deps: CaptainWorldDeps,
): StepCtx {
  const def = captainDefinition(captainId);
  if (!def) {
    throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  }
  const travelState = new TravelRepo(h, spaceId).getState(nowMs);
  return {
    h,
    spaceId,
    captainId,
    def,
    captains: new CaptainRepo(h, spaceId),
    log: new NpcRepo(h, spaceId),
    travel: new TravelRepo(h, spaceId),
    tz: spaceTimezone(h.sqlite, spaceId),
    decider: deps.decider ?? (isPurposeCaptain(def) ? purposeFallbackDecider : utilityDecider),
    deciderInjected: deps.decider !== undefined,
    barkSource: deps.barks ?? templateBarkSource,
    searchDraw: deps.searchDraw,
    // Placeholder — advance() replaces this with the live row.
    state: null as unknown as CaptainStateRow,
    playerWorld: travelState.currentWorld,
    playerEnRoute: travelState.activeJourney !== null,
  };
}

/** Is the visitor standing in `world` right now (settled, not in
 *  transit between worlds)? */
function playerPresentIn(ctx: StepCtx, world: CaptainWorld): boolean {
  return !ctx.playerEnRoute && ctx.playerWorld === world;
}

/** The visitor's current visit identity in a world: their latest
 *  arrived journey there, or a stay key when the ledger has none
 *  (a pre-travel-ledger save). One greeting/meeting per visit. */
function playerVisitKey(ctx: StepCtx, world: CaptainWorld, nowMs: number): string {
  const row = ctx.h.sqlite
    .prepare(
      `SELECT id FROM travel_journeys
       WHERE space_id = ? AND state = 'arrived' AND destination = ?
       ORDER BY arrived_at DESC, rowid DESC LIMIT 1`,
    )
    .get(ctx.spaceId, world) as { id: string } | undefined;
  if (row) return row.id;
  return `stay:${world}:${localDateKey(ctx.tz, nowMs)}`;
}

/** The fence (§5.1), captain edition: kind on HER allow-list, and
 *  any world involved in the D-1 travel set. Refusal throws BEFORE
 *  anything is written. (`people`, seam worlds, Eternity, and any
 *  private world are refused here by absence from the travel set —
 *  for residence, travel, and anchor alike, spec §4.) */
function fenceCheck(ctx: StepCtx, kind: NpcActKind, world?: CaptainWorld): void {
  // P3 (T1): the economy verbs' phase lock is gone — admission is
  // the allow-list alone, which carries gather/sell/refine for
  // exactly the captains R5 names, via the separate economy list.
  if (!ctx.def.allowList.includes(kind)) {
    throw new CaptainError(
      "FENCE_REFUSAL",
      403,
      `${ctx.def.name} may not "${kind}" — it is not on the captain allow-list.`,
    );
  }
  if (world !== undefined && !CAPTAIN_TRAVEL_WORLDS.includes(world)) {
    throw new CaptainError("FENCE_REFUSAL", 403, `${world} is not a world a captain may enter.`);
  }
}

/** One act through the fence into the shared log, under the day's
 *  budgets. Returns the log entry, or null when a budget is spent
 *  (budgets end the day quietly — §8.2, never an error mid-life). */
function logAct(
  ctx: StepCtx,
  kind: NpcActKind,
  act: string,
  cause: string,
  nowMs: number,
): { id: number } | null {
  fenceCheck(ctx, kind);
  if (ctx.captains.actsToday(ctx.captainId, nowMs) >= CAPTAIN_MAX_ACTS_PER_DAY) return null;
  const isSpeak = kind === "speak" || kind === "greet";
  if (isSpeak && ctx.captains.speaksToday(ctx.captainId, nowMs) >= CAPTAIN_MAX_SPEAKS_PER_DAY) return null;
  return ctx.log.appendLog(ctx.captainId, kind, act, cause, nowMs);
}

/** Leg/arrival writes are state completion, not discretionary acts
 *  (§5.4): they go through the fence and into the log, but they are
 *  NEVER budget-blocked — a spent budget must not strand a captain
 *  on a lane. The act still counts toward the day's totals once
 *  written (the counts read the log), exactly as L1 counted every
 *  act; what changes is only that a full budget cannot veto it. */
function logActUnbudgeted(
  ctx: StepCtx,
  kind: NpcActKind,
  act: string,
  cause: string,
  nowMs: number,
): { id: number } {
  fenceCheck(ctx, kind);
  return ctx.log.appendLog(ctx.captainId, kind, act, cause, nowMs);
}

// --- sessions and legs ---

/** Begin the session for a planned visit whose start this step has
 *  reached and whose leg (if any) has already been travelled: the
 *  captain is AT the visit's world (resting there, or just arrived
 *  by the arrival path below). Writes the arrive line + the session
 *  stream entry; a homecoming arrival names the anchor (A8-2/A8-4)
 *  and says so in the stream. */
function beginSession(
  ctx: StepCtx,
  visit: CaptainVisit,
  stepMs: number,
  arrivedByLeg: boolean,
): void {
  const world = visit.world;
  fenceCheck(ctx, "arrive", world);
  const homecoming = world === ctx.state.homeWorld;
  // A leg's arrival is state completion — never budget-blocked
  // (§5.4). A session beginning from rest is an ordinary act and
  // keeps L1's budgeted logging.
  const entry = arrivedByLeg
    ? logActUnbudgeted(
    ctx,
    "arrive",
    homecoming
      ? `Came home to ${ctx.state.homeAnchorLabel} — visit ${visit.index + 1} of ${visit.total} today.`
      : `Came into ${worldNamePlain(world)} — visit ${visit.index + 1} of ${visit.total} today.`,
    arrivedByLeg
      ? `The leg's arrival step was reached inside this advance; the arrival was resolved there and nowhere else (A7).`
      : `The day's rhythm, drawn from the captain's own seeded plan the way a person's day is drawn from habit; no player action caused this.`,
      stepMs,
    )
    : logAct(
        ctx,
        "arrive",
        homecoming
          ? `Came home to ${ctx.state.homeAnchorLabel} — visit ${visit.index + 1} of ${visit.total} today.`
          : `Came into ${worldNamePlain(world)} — visit ${visit.index + 1} of ${visit.total} today.`,
        `The day's rhythm, drawn from the captain's own seeded plan the way a person's day is drawn from habit; no player action caused this.`,
        stepMs,
      );
  ctx.captains.update(ctx.captainId, {
    currentWorld: world,
    sessionKey: visit.sessionKey,
    sessionWorld: world,
    sessionStartedAt: new Date(visit.startMs).toISOString(),
    sessionEndsAt: new Date(visit.endMs).toISOString(),
  });
  ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  ctx.captains.addMemory(
    ctx.captainId,
    "session",
    homecoming
      ? `Came home to ${ctx.state.homeAnchorLabel} at ${worldNamePlain(world)}.`
      : `Started a visit at ${worldNamePlain(world)}.`,
    CAPTAIN_SESSION_IMPORTANCE,
    [world],
    stepMs,
  );
  // P3 (T7): a Station encounter — two captains live in a session
  // at the Great Station at once warm the pair by the ruled step,
  // at most once per pair per local day (the row tracks the day).
  if (world === "great-station") {
    const dayKey = localDateKey(ctx.tz, stepMs);
    for (const other of CAPTAIN_DEFINITIONS) {
      if (!other.active || other.id === ctx.captainId) continue;
      const os = ctx.captains.state(other.id);
      if (os && os.currentWorld === "great-station" && os.sessionKey !== null && !os.stopped) {
        addAffinity(ctx.h, ctx.spaceId, ctx.captainId, other.id, CAPTAIN_AFFINITY_ENCOUNTER, stepMs, {
          encounterDay: dayKey,
        });
      }
    }
  }
  // One idle bark per day, on the day's first arrival — Chronicle
  // color, grounded in the voice profile, stored with its source.
  const dayKey = localDateKey(ctx.tz, stepMs);
  if (entry && !ctx.captains.hasBarkForDay(ctx.captainId, dayKey, "idle")) {
    const line = ctx.barkSource.idle({
      def: ctx.def,
      world,
      worldName: worldNamePlain(world),
      dayKey,
      occasionKey: visit.sessionKey,
    });
    if (line) ctx.captains.addBark(ctx.captainId, dayKey, "idle", line, [entry.id], stepMs);
  }
}

/** End the live session WITHOUT an onward leg (rest): the depart
 *  line and the session stream entry, then she rests where she is —
 *  at her current world in fiction, away from any session in fact —
 *  until the next planned visit's leg departs. */
function endSessionToRest(ctx: StepCtx, stepMs: number, cause: string): void {
  const world = ctx.state.currentWorld;
  if (!world) return;
  logAct(ctx, "depart", `Left ${worldNamePlain(world)} — that visit's done.`, cause, stepMs);
  ctx.captains.addMemory(
    ctx.captainId,
    "session",
    `Finished a visit at ${worldNamePlain(world)}.`,
    CAPTAIN_SESSION_IMPORTANCE,
    [world],
    stepMs,
  );
  ctx.captains.update(ctx.captainId, {
    currentWorld: null,
    sessionKey: null,
    sessionWorld: null,
    sessionStartedAt: null,
    sessionEndsAt: null,
  });
  ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
}

/** Open a leg (the departure transaction, spec §5.2): departure log
 *  line + session stream entry where a session is ending + leg
 *  fields set + warp fuel charged — atomically, inside the caller's
 *  advance transaction. `to` is copied from a held plan: the next
 *  planned visit (plan legs) or a decider travel decision recorded
 *  at this moment (decider legs). No other code path writes legTo —
 *  that single rule is A7 made structural.
 *
 *  Fuel: warp charges WARP_COST of HER fuel at departure; drift is
 *  free; a leg home by the home route is free. A warp she cannot
 *  afford departs as a drift (never an error, never stranded). */
function openLeg(
  ctx: StepCtx,
  args: {
    from: CaptainWorld;
    to: CaptainWorld;
    kind: CaptainLegKind;
    steps: number;
    visitKey: string | null;
    cause: string;
    endLiveSession: boolean;
  },
  stepMs: number,
): boolean {
  fenceCheck(ctx, "depart", args.from);
  fenceCheck(ctx, "travel", args.to);
  const st = ctx.state;
  let kind = args.kind;
  let steps = args.steps;
  let fuel = st.fuel;
  // P3 (R10): a Director lane closure refuses the WARP on its pair
  // — the leg departs as a drift instead (drift and the home route
  // always remain; nobody is stranded), with the closure cause
  // logged once the leg is open.
  let closureNote: { from: CaptainWorld; to: CaptainWorld } | null = null;
  if (kind === "warp") {
    const closure = laneClosureFor(ctx.h, ctx.spaceId, localDateKey(ctx.tz, stepMs));
    if (closure && closure.from === args.from && closure.to === args.to) {
      kind = "drift";
      steps = CAPTAIN_LEG_DRIFT_STEPS;
      closureNote = closure;
    }
  }
  if (kind === "warp") {
    if (fuel < WARP_COST) {
      kind = "drift";
      steps = CAPTAIN_LEG_DRIFT_STEPS;
    } else {
      fuel = fuel - WARP_COST;
    }
  }
  const homecoming = args.to === st.homeWorld;
  // The departure is a discretionary act: a spent budget ends the
  // day quietly and the leg simply never opens (the captain rests).
  // Only ARRIVAL is budget-proof (§5.4) — a budget must never strand
  // a captain mid-leg, but it may keep her home.
  const entry = logAct(
    ctx,
    "depart",
    `Left ${worldNamePlain(args.from)} — bound for ${worldNamePlain(args.to)} ${legKindPlain(kind)}.`,
    args.cause,
    stepMs,
  );
  if (!entry) return false;
  if (args.endLiveSession) {
    ctx.captains.addMemory(
      ctx.captainId,
      "session",
      homecoming || args.from === st.homeWorld
        ? `Left ${worldNamePlain(args.from)} — bound for ${worldNamePlain(args.to)}.`
        : `Finished a visit at ${worldNamePlain(args.from)}.`,
      CAPTAIN_SESSION_IMPORTANCE,
      [args.from],
      stepMs,
    );
  } else if (args.from === st.homeWorld) {
    // Departures from the anchor world are stream events too (T9):
    // A8-2 reads the circuit out of this stream.
    ctx.captains.addMemory(
      ctx.captainId,
      "session",
      `Left home — ${ctx.state.homeAnchorLabel} at ${worldNamePlain(args.from)} — bound for ${worldNamePlain(args.to)}.`,
      CAPTAIN_SESSION_IMPORTANCE,
      [args.from],
      stepMs,
    );
  }
  ctx.captains.update(ctx.captainId, {
    currentWorld: null,
    sessionKey: null,
    sessionWorld: null,
    sessionStartedAt: null,
    sessionEndsAt: null,
    fuel,
    legFrom: args.from,
    legTo: args.to,
    legKind: kind,
    legDepartedStepMs: stepMs,
    legArrivesStepMs: stepMs + steps * CAPTAIN_ADVANCE_STEP_MS,
    legSteps: steps,
    legVisitKey: args.visitKey,
  });
  ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  if (closureNote) {
    logActUnbudgeted(
      ctx,
      "travel",
      `The warp lane from ${worldNamePlain(closureNote.from)} to ${worldNamePlain(closureNote.to)} is closed today — drifting instead.`,
      "Director: the lane closure holds until the day boundary; drift and the home route stay open, and nobody is stranded.",
      stepMs,
    );
  }
  // P3 (T7): convoy co-travel — another captain's open leg on the
  // same ordered pair means they fly it together; the pair warms
  // by the ruled step.
  for (const other of CAPTAIN_DEFINITIONS) {
    if (!other.active || other.id === ctx.captainId) continue;
    const os = ctx.captains.state(other.id);
    if (os && os.legTo === args.to && os.legFrom === args.from) {
      addAffinity(ctx.h, ctx.spaceId, ctx.captainId, other.id, CAPTAIN_AFFINITY_CONVOY, stepMs);
    }
  }
  return true;
}

/** Resolve the open leg's arrival: ONLY called from inside the
 *  advance's step loop, in a step whose start is at/after the leg's
 *  arrival step (spec §5.2 — the binding A7 rule). Clears the leg,
 *  places her at legTo, and opens the planned visit's session when
 *  one was recorded (or the plan still offers it). */
function resolveArrival(ctx: StepCtx, stepMs: number, summarized: boolean): void {
  const st = ctx.state;
  const to = st.legTo;
  if (!to) return;
  const visit = findLegVisit(ctx, st, stepMs);
  ctx.captains.update(ctx.captainId, {
    legFrom: null,
    legTo: null,
    legKind: null,
    legDepartedStepMs: null,
    legArrivesStepMs: null,
    legSteps: null,
    legVisitKey: null,
    currentWorld: to,
  });
  ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  if (visit && stepMs < visit.endMs) {
    beginSession(ctx, visit, stepMs, true);
    if (summarized) {
      // The beginSession line names the plan; the summarized truth
      // rides the summary line the caller writes (advanceCaptain).
      void 0;
    }
  } else {
    // Arrived outside a planned session (a decider leg, or the
    // planned visit already ended while she travelled): she rests
    // at the destination until the next planned leg.
    const homecoming = to === ctx.state.homeWorld;
    logActUnbudgeted(
      ctx,
      "arrive",
      homecoming
        ? `Came home to ${ctx.state.homeAnchorLabel}.`
        : `Came into ${worldNamePlain(to)}.`,
      summarized
        ? `The leg finished while you were away — long absences summarize; they do not fabricate an hourly life.`
        : `The leg's arrival step was reached inside this advance; the arrival was resolved there and nowhere else (A7).`,
      stepMs,
    );
    ctx.captains.addMemory(
      ctx.captainId,
      "session",
      homecoming
        ? `Came home to ${ctx.state.homeAnchorLabel} at ${worldNamePlain(to)}.`
        : `Started a visit at ${worldNamePlain(to)}.`,
      CAPTAIN_SESSION_IMPORTANCE,
      [to],
      stepMs,
    );
    ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  }
  if (isPurposeCaptain(ctx.def)) {
    // Her arrival is an act event like any other (Arch §4.3): it
    // closes the plan step the leg served and completes her open
    // board step — keyed to the arrival's own log event.
    const arrival = ctx.log.recentLog(ctx.captainId, 5).find((e) => e.kind === "arrive");
    onPurposeArrival(ctx.h, ctx.spaceId, ctx.captainId, to, arrival?.id ?? null, stepMs);
    ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  }
  if (isEconomyCaptain(ctx.def)) {
    const arrival = ctx.log.recentLog(ctx.captainId, 5).find((e) => e.kind === "arrive");
    onEconomyArrival(ctx.h, ctx.spaceId, ctx.captainId, to, arrival?.id ?? null, stepMs);
    ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
  }
}

/** The planned visit an open leg is travelling to: the recorded
 *  session key when the leg came from a plan, else the plan visit
 *  at the destination covering the arrival step, if any. */
function findLegVisit(ctx: StepCtx, st: CaptainStateRow, stepMs: number): CaptainVisit | null {
  const to = st.legTo;
  if (!to) return null;
  const dayKey = localDateKey(ctx.tz, stepMs);
  const plan = dayPlan(ctx.captainId, dayKey, ctx.tz, st.homeWorld);
  if (st.legVisitKey) {
    const v = plan.find((x) => x.sessionKey === st.legVisitKey && x.world === to);
    if (v) return v;
  }
  return plan.find((x) => x.world === to && stepMs >= x.startMs && stepMs < x.endMs) ?? null;
}

// --- P2: the purpose driver's executor surface ---

/** The PurposeExec the engine hands the P2 driver inside a step:
 *  budgeted acts and bookkeeping through this module's own fence +
 *  budget functions (never around them), legs through the leg
 *  machinery (departure line, fuel at departure, arrival resolved
 *  in the step loop per A7), live state by reference (openLeg
 *  refreshes ctx.state in place). */
function purposeExec(ctx: StepCtx): PurposeExec {
  return {
    logAct: (kind, act, cause, ms) => logAct(ctx, kind, act, cause, ms),
    // "plan" lines are the two drivers' own bookkeeping narration
    // (plan built / mismatch / milestone) — never a world act the
    // captain performs — so they are logged unfenced: P2 carried
    // "plan" on the purpose allow-list, but P3's economy captains
    // hold no plan verb (R5 keeps their list to real acts), and
    // their plans still deserve their Chronicle lines. Every other
    // bookkeeping kind keeps the fence.
    logBookkeeping: (kind, act, cause, ms) =>
      kind === "plan" ? ctx.log.appendLog(ctx.captainId, kind, act, cause, ms) : logActUnbudgeted(ctx, kind, act, cause, ms),
    openLeg: (to, kind, cause, ms) => {
      const from = ctx.state.currentWorld;
      if (!from) return false;
      return openLeg(
        ctx,
        {
          from,
          to,
          kind,
          steps: kind === "warp" ? CAPTAIN_LEG_WARP_STEPS : CAPTAIN_LEG_DRIFT_STEPS,
          visitKey: null,
          cause,
          endLiveSession: true,
        },
        ms,
      );
    },
    state: () => ctx.state,
    searchDraw: ctx.searchDraw,
  };
}

// --- P3: economy perception + decider-driven economy acts ---

/** Her market perception for this step (T5): her own facts (hold,
 *  balance, savings distance), the posted prices, the NPC pool's
 *  remaining demand as the service's guide view reports it, and
 *  her affinities. Belief-shaped — execution re-reads state. */
function buildEconomyPerception(ctx: StepCtx, world: CaptainWorld, stepStartMs: number): CaptainEconomyPerception {
  const svc = new NpcEconomy(ctx.h, ctx.spaceId, ctx.captainId);
  const st = ctx.state;
  const cargo = svc.cargoReadOnly();
  const credits = Math.round(st.credits);
  const target = captainSavingsTarget(ctx.def, credits);
  let bestSale: CaptainEconomyPerception["bestSale"] = null;
  if (world === "great-station") {
    for (const c of cargo) {
      for (const buyerId of ["station-foundry", "salvage-yard", "archive-broker", "fleet-quartermaster", "station-exchange"] as const) {
        const price = postedPrice(buyerId, c.good);
        if (price === null) continue;
        const remaining = svc.demandRemaining(buyerId, c.good, stepStartMs);
        const qty = Math.min(c.qty, remaining ?? c.qty);
        if (qty <= 0) continue;
        if (!bestSale || qty * price > bestSale.qty * bestSale.unitPrice) {
          bestSale = { buyerId, good: c.good, qty, unitPrice: price };
        }
      }
    }
  }
  const refineRecipe = RECIPES.find(
    (r) =>
      credits >= r.feeCredits &&
      Object.entries(r.inputs).every(([g, n]) => (cargo.find((c) => c.good === g)?.qty ?? 0) >= (n as number)),
  );
  return {
    credits,
    savingsGoalCredits: target,
    savingsGoalLabel: ctx.def.savingsGoalLabel,
    holdUsed: cargo.reduce((sum, c) => sum + c.qty, 0),
    holdCapacity: HOLD_CAPACITY,
    cargo,
    nodes: svc
      .nodes(stepStartMs)
      .filter((n) => n.remaining > 0)
      .map((n) => ({ nodeId: n.nodeId, kind: n.kind, good: n.good, remaining: n.remaining })),
    atStation: world === "great-station",
    bestSale,
    refineOption: refineRecipe ? { recipeId: refineRecipe.id, output: refineRecipe.output, fee: refineRecipe.feeCredits } : null,
    affinities: affinitiesOf(ctx.h, ctx.spaceId, ctx.captainId),
  };
}

/** Execute a decider-chosen economy act inside this step — through
 *  the fence + budgets (logAct), the NPC service, the memory
 *  rubric, and her knowledge store, atomically with the advance.
 *  A refusal is an honest log line, never a partial write (the
 *  service refuses before it writes). */
function executeEconomyDecision(
  ctx: StepCtx,
  decision: Extract<CaptainDecision, { act: "gather" | "sell" | "refine" }>,
  stepStartMs: number,
): void {
  const world = ctx.state.currentWorld ?? ctx.state.homeWorld;
  if (ctx.captains.actsToday(ctx.captainId, stepStartMs) >= CAPTAIN_MAX_ACTS_PER_DAY) return;
  const svc = new NpcEconomy(ctx.h, ctx.spaceId, ctx.captainId);
  const stepKey = `${ctx.captainId}:${stepStartMs}:${decision.act}`;
  const store = new PurposeStore(ctx.h, ctx.spaceId);

  if (decision.act === "gather") {
    const nodes = svc.nodes(stepStartMs);
    const node =
      (decision.nodeId ? nodes.find((n) => n.nodeId === decision.nodeId) : undefined) ??
      (decision.nodeKind ? nodes.find((n) => n.kind === decision.nodeKind && n.remaining > 0) : undefined) ??
      nodes.find((n) => n.remaining > 0);
    if (!node) {
      logAct(ctx, "gather", "Gathering came to nothing: the shadow supply is worked out for today.", decision.cause, stepStartMs);
      return;
    }
    const out = svc.gather(node.nodeId, stepKey, stepStartMs, decision.qty);
    if (!out.ok) {
      logAct(ctx, "gather", `Gathering came to nothing: ${out.message}`, decision.cause, stepStartMs);
      return;
    }
    const entry = logAct(
      ctx,
      "gather",
      `Gathered ${out.gathered} ${GAME_GOOD_LABELS[out.good]} from a ${node.kind} site in the shadow supply.`,
      decision.cause,
      stepStartMs,
    );
    if (entry) {
      ctx.captains.addMemory(
        ctx.captainId, "outcome",
        `Gathered ${out.gathered} ${GAME_GOOD_LABELS[out.good]} from the shadow supply.`,
        CAPTAIN_ROUTINE_IMPORTANCE, [world], stepStartMs, { originLogId: entry.id },
      );
    }
    return;
  }

  if (decision.act === "sell") {
    const before = svc.credits();
    const out = svc.sell(decision.buyerId, decision.good, decision.qty, stepKey, stepStartMs);
    if (!out.ok) {
      logAct(ctx, "sell", `The sale came to nothing: ${out.message}`, decision.cause, stepStartMs);
      return;
    }
    const buyerName = buyerById(decision.buyerId)?.name ?? decision.buyerId;
    const entry = logAct(
      ctx,
      "sell",
      `Sold ${out.accepted} ${GAME_GOOD_LABELS[decision.good]} to ${buyerName} at ${out.unitPrice} Credits each${out.declined > 0 ? `; ${out.declined} stayed in her hold — the premium demand was spent` : ""}.`,
      decision.cause,
      stepStartMs,
    );
    if (entry) {
      ctx.captains.addMemory(
        ctx.captainId, "outcome",
        `Sold ${out.accepted} ${GAME_GOOD_LABELS[decision.good]} to ${buyerName} for ${out.totalCredits} Credits.`,
        CAPTAIN_ROUTINE_IMPORTANCE, [world], stepStartMs, { originLogId: entry.id },
      );
      store.addKnowledge(
        ctx.captainId,
        `${buyerName} paid ${out.unitPrice} Credits for ${GAME_GOOD_LABELS[decision.good]}${out.demandRemaining !== null ? `; its pool demand for ${GAME_GOOD_LABELS[decision.good]} then stood at ${out.demandRemaining} remaining` : ""}.`,
        "firsthand", "seen-at-execution", entry.id, stepStartMs,
      );
      if (out.demandRemaining === 0 && out.accepted > 0) {
        recordPremiumTaken(ctx.h, ctx.spaceId, ctx.captainId, decision.buyerId, decision.good, stepStartMs);
      }
      maybeLogSavingsMilestone(ctx.h, ctx.spaceId, ctx.captainId, before, svc.credits(), purposeExec(ctx), stepStartMs);
    }
    return;
  }

  // refine
  const out = svc.refine(decision.recipeId, decision.count, stepKey, stepStartMs);
  if (!out.ok) {
    logAct(ctx, "refine", `The refine came to nothing: ${out.message}`, decision.cause, stepStartMs);
    return;
  }
  const entry = logAct(
    ctx,
    "refine",
    `Refined ${decision.recipeId} at the Station refinery — a ${GAME_GOOD_LABELS[out.output]} came out; the ${out.feeCharged}-Credit fee is burned.`,
    decision.cause,
    stepStartMs,
  );
  if (entry) {
    ctx.captains.addMemory(
      ctx.captainId, "outcome",
      `Refined a ${GAME_GOOD_LABELS[out.output]} at the Station refinery.`,
      CAPTAIN_ROUTINE_IMPORTANCE, [world], stepStartMs, { originLogId: entry.id },
    );
  }
}

// --- one hourly step of a live session ---

function stepSession(ctx: StepCtx, stepStartMs: number, stepEndMs: number): void {
  const st = ctx.state;
  const world = st.currentWorld;
  if (!world || !st.sessionEndsAt || !st.sessionStartedAt) return;
  const sessionEnd = Date.parse(st.sessionEndsAt);
  const sessionStart = Date.parse(st.sessionStartedAt);

  // Meeting first: if the visitor is here, she remembers it — once
  // per visit, in HER stream, whether or not she speaks. (A leg is
  // never open inside a live session, so the §5.3 presence rule —
  // no meeting while a leg is open — holds by construction here.)
  const present = playerPresentIn(ctx, world);
  let visitKey: string | null = null;
  if (present) {
    visitKey = playerVisitKey(ctx, world, stepStartMs);
    if (st.lastMeetingVisitKey !== visitKey) {
      const prior = ctx.captains.meetings(ctx.captainId).length;
      ctx.captains.addMemory(
        ctx.captainId,
        "meeting",
        prior === 0
          ? `Met the steward for the first time at ${worldNamePlain(world)}.`
          : `Met the steward again at ${worldNamePlain(world)}.`,
        prior === 0 ? CAPTAIN_MEETING_IMPORTANCE_FIRST : CAPTAIN_MEETING_IMPORTANCE,
        [world, "steward"],
        stepStartMs,
      );
      ctx.captains.update(ctx.captainId, { lastMeetingVisitKey: visitKey });
      st.lastMeetingVisitKey = visitKey;
    }
  }

  // P2 decision points (Arch §4.3): a purpose captain's step is
  // driven by her plan, her board, and her Duty — the generic
  // decider only ever sees the points the driver declines (and for
  // her the default decider is the plan-coherent fallback above).
  if (isPurposeCaptain(ctx.def)) {
    if (runPurposeDecisionPoint(ctx.h, ctx.spaceId, ctx.captainId, stepStartMs, purposeExec(ctx))) {
      ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
      return;
    }
  }

  // P3 (T5): a non-purpose economy captain's point runs her stored
  // economy plan first — Ambition's standing instrument. When the
  // driver declines (no plan business), the ordinary decider runs
  // with the economy perception below. Two yields, both principled:
  // an injected decider is this advance's steering authority, and a
  // pending greeting comes first — a captain greets a present
  // visitor before she does market work.
  const greetPending = present && visitKey !== null && st.lastGreetVisitKey !== visitKey;
  if (!ctx.deciderInjected && !greetPending && isEconomyCaptain(ctx.def) && !isPurposeCaptain(ctx.def)) {
    if (runEconomyDecisionPoint(ctx.h, ctx.spaceId, ctx.captainId, stepStartMs, purposeExec(ctx))) {
      ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
      return;
    }
  }

  // Drive inputs for this step (perception, design §4.1).
  const sessionAgeRatio = Math.min(1, Math.max(0, (stepStartMs - sessionStart) / Math.max(1, sessionEnd - sessionStart)));
  const stepsLeftInSession = Math.max(1, Math.ceil((sessionEnd - stepStartMs) / CAPTAIN_ADVANCE_STEP_MS));
  const curiosity = 0.3 + rngFor(ctx.captainId, "curiosity", st.sessionKey ?? "")() * 0.5;
  const sociability = present ? 0.85 : 0.4;

  const destinations = CAPTAIN_TRAVEL_WORLDS.filter((w) => w !== world);
  const perception = {
    stepStartMs,
    world,
    destinations,
    destinationNames: Object.fromEntries(destinations.map((w) => [w, worldNamePlain(w)])),
    openLeg: null,
    sessionAgeRatio,
    stepsLeftInSession,
    fuel: st.fuel,
    playerPresent: present,
    greetedThisVisit: visitKey !== null && st.lastGreetVisitKey === visitKey,
    curiosity,
    sociability,
    ...(isEconomyCaptain(ctx.def)
      ? { economy: buildEconomyPerception(ctx, world, stepStartMs) }
      : {}),
  };
  // A purpose captain's fallback is greet/wait only — but her
  // ECONOMY acts are ordinary utility business, so a declined
  // purpose point consults the utility decider with the economy
  // perception. Its travel/depart impulses are then refused below:
  // her travel belongs to her planner, never to idle utility.
  const decision: CaptainDecision =
    isPurposeCaptain(ctx.def) && isEconomyCaptain(ctx.def)
      ? utilityDecider.decide(ctx.def, perception)
      : ctx.decider.decide(ctx.def, perception);
  if (isPurposeCaptain(ctx.def) && (decision.act === "travel" || decision.act === "depart")) {
    logAct(ctx, "wait", `Stayed at ${worldNamePlain(world)}, watching the lanes.`, "The purpose driver holds her course this step — her travel belongs to her plan.", stepStartMs);
    return;
  }

  switch (decision.act) {
    case "greet": {
      if (!present || !visitKey) {
        // The decider is swappable; the engine, not the decider,
        // owns the facts. A greet with nobody here becomes a wait.
        logAct(ctx, "wait", `Stayed at ${worldNamePlain(world)}, watching the lanes.`, "There was no one here to greet.", stepStartMs);
        return;
      }
      const dayKey = localDateKey(ctx.tz, stepStartMs);
      const line = ctx.barkSource.greeting({
        def: ctx.def,
        world,
        worldName: worldNamePlain(world),
        dayKey,
        occasionKey: visitKey,
      });
      const entry = logAct(ctx, "greet", line || ctx.def.voice.sampleLine, decision.cause, stepStartMs);
      if (entry) {
        ctx.captains.update(ctx.captainId, { lastGreetVisitKey: visitKey });
        st.lastGreetVisitKey = visitKey;
        if (line) ctx.captains.addBark(ctx.captainId, dayKey, "greeting", line, [entry.id], stepStartMs);
      }
      return;
    }
    case "travel": {
      // A decider travel decision becomes a LEG (spec §5.2): the
      // destination is recorded at leg creation — a travel decision
      // the decider made at a decision point inside a live session
      // is one of the two held-plan sources A7 allows.
      const to = decision.toWorld;
      fenceCheck(ctx, "travel", to);
      if (to === world) {
        logAct(ctx, "wait", `Stayed at ${worldNamePlain(world)}.`, "The chosen destination was the world already occupied — staying put instead.", stepStartMs);
        return;
      }
      if (decision.travelKind === "warp" && st.fuel < WARP_COST) {
        logAct(
          ctx,
          "wait",
          `Stayed at ${worldNamePlain(world)}.`,
          `A warp to ${worldNamePlain(to)} costs ${WARP_COST} fuel and the captain's own ledger holds ${Math.floor(st.fuel)} — the ledger said no.`,
          stepStartMs,
        );
        return;
      }
      const isHome = to === st.homeWorld;
      void openLeg(
        ctx,
        {
          from: world,
          to,
          kind: isHome ? "home" : decision.travelKind,
          steps:
            decision.travelKind === "warp" ? CAPTAIN_LEG_WARP_STEPS : CAPTAIN_LEG_DRIFT_STEPS,
          visitKey: null,
          cause: decision.cause,
          endLiveSession: true,
        },
        stepStartMs,
      );
      return;
    }
    case "depart": {
      endSessionToRest(ctx, stepStartMs, decision.cause);
      return;
    }
    case "gather":
    case "sell":
    case "refine": {
      executeEconomyDecision(ctx, decision, stepStartMs);
      ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
      return;
    }
    case "wait": {
      const variants = [
        `Stayed at ${worldNamePlain(world)}, watching the lanes.`,
        `Waited at ${worldNamePlain(world)} — docked, unhurried.`,
        `Stayed put at ${worldNamePlain(world)} a while.`,
      ];
      const idx = Math.floor(rngFor(ctx.captainId, "waitline", stepStartMs)() * variants.length) % variants.length;
      logAct(ctx, "wait", variants[idx] ?? variants[0]!, decision.cause, stepStartMs);
      return;
    }
  }
  void stepEndMs;
}

// --- the advance itself ---

export function advanceCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
  deps: CaptainWorldDeps = {},
): CaptainStateRow {
  const def = captainDefinition(captainId);
  if (!def) {
    throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  }
  if (!def.active) {
    // Defined, not flying yet: NO state row is ever created for an
    // inactive captain — the display state is synthesized from the
    // definition and the shared defaults.
    return {
      captainId: def.id,
      homeWorld: def.homeWorld,
      homeAnchorKind: def.homeAnchor.kind,
      homeAnchorLabel: def.homeAnchor.label,
      currentWorld: null,
      sessionKey: null,
      sessionWorld: null,
      sessionStartedAt: null,
      sessionEndsAt: null,
      lastMeetingVisitKey: null,
      lastGreetVisitKey: null,
      fuel: CAPTAIN_START_FUEL,
      credits: CAPTAIN_START_CREDITS,
      stopped: false,
      lastAdvancedAt: null,
      legFrom: null,
      legTo: null,
      legKind: null,
      legDepartedStepMs: null,
      legArrivesStepMs: null,
      legSteps: null,
      legVisitKey: null,
    };
  }
  const captains = new CaptainRepo(h, spaceId);
  const st = captains.ensureState(def, nowMs);

  const tz = spaceTimezone(h.sqlite, spaceId);
  if (st.stopped) {
    // Total silence (design §8.2): no acts, no backfill later —
    // the cursor moves so a resume starts from now, not from the
    // moment of the stop. An open leg STAYS open across a stop
    // (§5.4): no teleport, no arrival, no re-charge.
    if (st.lastAdvancedAt === null || Date.parse(st.lastAdvancedAt) < nowMs) {
      captains.setCursor(captainId, nowMs);
    }
    return captains.state(captainId) ?? st;
  }

  const fromMs = st.lastAdvancedAt ? Date.parse(st.lastAdvancedAt) : nowMs;
  if (nowMs <= fromMs) return st;
  const steps = Math.floor((nowMs - fromMs) / CAPTAIN_ADVANCE_STEP_MS);
  if (steps <= 0) return st;

  const ctx = makeCtx(h, spaceId, captainId, nowMs, deps);
  ctx.state = st;

  h.sqlite.exec("BEGIN");
  try {
    // P3 first touch (R4): an economy captain's genesis ledger row
    // is written inside her first advance's transaction, anchored
    // at her then-live balance.
    if (isEconomyCaptain(def)) {
      new NpcEconomy(h, spaceId, captainId).ensureGenesis(fromMs);
    }
    // P3 (R7): affinity cooling at her local-day rollover — an
    // explicit advance step, never a timer.
    const fromDay = localDateKey(tz, fromMs);
    const nowDay = localDateKey(tz, nowMs);
    if (fromDay !== nowDay) {
      const elapsedDays = Math.round(
        (Date.parse(`${nowDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000,
      );
      if (elapsedDays > 0) coolAffinities(h, spaceId, captainId, elapsedDays, nowMs);
    }
    if (steps > CAPTAIN_ADVANCE_MAX_STEPS) {
      // Summarized jump (§3): beyond the cap the interval is not
      // replayed hour by hour; it is summarized honestly. An open
      // leg COMPLETES inside the jump (§5.2): the arrival is logged
      // with a cause that says the interval was summarized, and she
      // is placed per the day plan at the landing instant — never
      // left permanently underway, never shown an invented voyage.
      if (ctx.state.legTo) {
        const legTo = ctx.state.legTo;
        ctx.captains.update(captainId, {
          legFrom: null,
          legTo: null,
          legKind: null,
          legDepartedStepMs: null,
          legArrivesStepMs: null,
          legSteps: null,
          legVisitKey: null,
          currentWorld: legTo,
          sessionKey: null,
          sessionWorld: null,
          sessionStartedAt: null,
          sessionEndsAt: null,
        });
        ctx.state = captains.state(captainId) ?? ctx.state;
        const homecoming = legTo === ctx.state.homeWorld;
        const arrivalEntry = logActUnbudgeted(
          ctx,
          "arrive",
          homecoming
            ? `Came home to ${ctx.state.homeAnchorLabel}.`
            : `Came into ${worldNamePlain(legTo)}.`,
          "The leg finished while you were away — long absences summarize; they do not fabricate an hourly life.",
          nowMs,
        );
        if (isPurposeCaptain(ctx.def)) {
          onPurposeArrival(ctx.h, ctx.spaceId, ctx.captainId, legTo, arrivalEntry.id, nowMs);
          ctx.state = captains.state(captainId) ?? ctx.state;
        }
        if (isEconomyCaptain(ctx.def)) {
          onEconomyArrival(ctx.h, ctx.spaceId, ctx.captainId, legTo, arrivalEntry.id, nowMs);
          ctx.state = captains.state(captainId) ?? ctx.state;
        }
        ctx.captains.addMemory(
          ctx.captainId,
          "session",
          homecoming
            ? `Came home to ${ctx.state.homeAnchorLabel} at ${worldNamePlain(legTo)}.`
            : `Started a visit at ${worldNamePlain(legTo)}.`,
          CAPTAIN_SESSION_IMPORTANCE,
          [legTo],
          nowMs,
        );
        ctx.state = captains.state(captainId) ?? ctx.state;
      } else if (ctx.state.currentWorld) {
        endSessionToRest(
          ctx,
          fromMs + CAPTAIN_ADVANCE_STEP_MS,
          "The visit ended while you were away — long absences summarize; they do not fabricate an hourly life.",
        );
      }
      logAct(
        ctx,
        "wait",
        "Was away — days passed between your visits here.",
        `${Math.floor((nowMs - fromMs) / 86_400_000)} day(s) passed with no one watching; the captain's life summarized rather than replayed (design §3).`,
        nowMs,
      );
    } else {
      let t = fromMs;
      while (t < nowMs) {
        const stepEnd = Math.min(t + CAPTAIN_ADVANCE_STEP_MS, nowMs);
        stepOnce(ctx, t, stepEnd);
        // P3 (T8): Director-lite evaluates once per stepped step,
        // only while the visitor is present in a public world —
        // its incidents are log records inside this transaction.
        if (
          ctx.playerWorld !== null &&
          !ctx.playerEnRoute &&
          (CAPTAIN_TRAVEL_WORLDS as readonly string[]).includes(ctx.playerWorld)
        ) {
          const incident = evaluateDirector(ctx.h, ctx.spaceId, t, {
            presentWorld: ctx.playerWorld as CaptainWorld,
            captainId,
          });
          if (incident) {
            logActUnbudgeted(ctx, incident.actKind, incident.act, incident.cause, t);
            ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
          }
        }
        t = stepEnd;
      }
    }
    captains.setCursor(captainId, nowMs);
    h.sqlite.exec("COMMIT");
  } catch (e) {
    h.sqlite.exec("ROLLBACK");
    throw e;
  }
  return captains.state(captainId) ?? st;
}

function stepOnce(ctx: StepCtx, stepStartMs: number, stepEndMs: number): void {
  const st = ctx.state;
  // 1) An open leg resolves FIRST in its arrival step — arrival is
  //    state completion, ordered before any new departure (§5.2).
  if (st.legTo) {
    if (st.legArrivesStepMs !== null && stepStartMs >= st.legArrivesStepMs) {
      resolveArrival(ctx, stepStartMs, false);
    }
    // Whether just arrived (a session may now be live — handled by
    // the branches below on the NEXT step) or still underway, this
    // step writes nothing further for the leg: underway promotion
    // is silent by rule.
    return;
  }
  // 2) A live session: it ends at its planned end (departing onward
  //    when the plan chains a next visit in another world), else it
  //    steps.
  if (st.sessionKey) {
    const endsAt = st.sessionEndsAt ? Date.parse(st.sessionEndsAt) : 0;
    if (stepStartMs >= endsAt) {
      endSessionPlanned(ctx, stepStartMs);
      return;
    }
    stepSession(ctx, stepStartMs, stepEndMs);
    return;
  }
  // 3) At rest: the plan's next visit governs. A visit whose start
  //    this step has reached opens its leg (inter-world) or its
  //    session (same world she rests at / first visit at home).
  const dayKey = localDateKey(ctx.tz, stepStartMs);
  const plan = dayPlan(ctx.captainId, dayKey, ctx.tz, st.homeWorld);
  const visit = plan.find((v) => stepStartMs >= v.startMs && stepStartMs < v.endMs);
  if (!visit) return;
  const restWorld = st.currentWorld ?? st.homeWorld;
  if (visit.world === restWorld) {
    // Same world she is resting at (in fiction): the visit begins
    // in place. currentWorld tracks the fiction so later legs
    // depart from the right origin.
    ctx.captains.update(ctx.captainId, { currentWorld: visit.world });
    ctx.state = ctx.captains.state(ctx.captainId) ?? ctx.state;
    beginSession(ctx, visit, stepStartMs, false);
    return;
  }
  // The plan's chain assumed she rested at the previous visit's
  // world; a decider leg may have left her elsewhere. The held plan
  // still names the destination — the leg kind is recomputed from
  // where she actually rests (home route home, drift otherwise).
  const kind: CaptainLegKind =
    visit.legKind ?? (visit.world === st.homeWorld ? "home" : "drift");
  const steps = visit.legKind !== null ? visit.legSteps : CAPTAIN_LEG_DRIFT_STEPS;
  void openLeg(
    ctx,
    {
      from: restWorld,
      to: visit.world,
      kind,
      steps,
      visitKey: visit.sessionKey,
      cause:
        visit.world === st.homeWorld
          ? `The day's seeded plan brings the captain home — the home route is always free.`
          : `The day's seeded plan names this visit; the leg's destination is copied from that held plan (A7).`,
      endLiveSession: false,
    },
    stepStartMs,
  );
}

/** A live session reached its planned end: if the plan chains a
 *  next visit (today or tomorrow) in another world, she departs on
 *  that visit's leg; if the next visit is here, the session simply
 *  rolls into it at its start; otherwise she departs to rest. */
function endSessionPlanned(ctx: StepCtx, stepStartMs: number): void {
  const st = ctx.state;
  const world = st.currentWorld;
  if (!world) return;
  const next = nextVisit(ctx.captainId, stepStartMs, ctx.tz, st.homeWorld);
  if (next.world !== world && stepStartMs >= next.startMs - 0 && next.startMs <= stepStartMs) {
    // The next visit has already begun elsewhere — depart on its leg.
    const opened = openLeg(
      ctx,
      {
        from: world,
        to: next.world,
        kind: next.legKind ?? "drift",
        steps: next.legSteps > 0 ? next.legSteps : CAPTAIN_LEG_DRIFT_STEPS,
        visitKey: next.sessionKey,
        cause: `The visit's planned hours ran out, and the day's seeded plan names the next visit — the leg's destination is copied from that held plan (A7).`,
        endLiveSession: true,
      },
      stepStartMs,
    );
    if (opened) return;
  }
  if (next.world !== world && next.legKind !== null && next.startMs <= stepStartMs + CAPTAIN_ADVANCE_STEP_MS) {
    // Next visit starts within the coming step in another world:
    // depart now on its leg so travel time is real, not free.
    const opened = openLeg(
      ctx,
      {
        from: world,
        to: next.world,
        kind: next.legKind,
        steps: next.legSteps,
        visitKey: next.sessionKey,
        cause: `The visit's planned hours ran out, and the day's seeded plan names the next visit — the leg's destination is copied from that held plan (A7).`,
        endLiveSession: true,
      },
      stepStartMs,
    );
    if (opened) return;
  }
  endSessionToRest(
    ctx,
    stepStartMs,
    "The visit's planned hours ran out — the day's rhythm, not restlessness, ended it.",
  );
}

/** Advance every ACTIVE captain (registry order). Inactive captains
 *  get no cursor, no state churn — they are not flying yet. */
export function advanceAllCaptains(
  h: DbHandle,
  spaceId: string,
  nowMs: number = Date.now(),
  deps: CaptainWorldDeps = {},
): void {
  for (const def of CAPTAIN_DEFINITIONS) {
    if (def.active) advanceCaptain(h, spaceId, def.id, nowMs, deps);
  }
}

// --- reads (each read advances first: lazy, never a timer) ---

export function getCaptainState(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
): CaptainState {
  const def = captainDefinition(captainId);
  if (!def) {
    throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  }
  const st = advanceCaptain(h, spaceId, captainId, nowMs, {});
  return toWireState(h, spaceId, st, nowMs);
}

export function listCaptainStates(
  h: DbHandle,
  spaceId: string,
  nowMs: number = Date.now(),
): CaptainState[] {
  advanceAllCaptains(h, spaceId, nowMs, {});
  return CAPTAIN_DEFINITIONS.map((def) => {
    // Active captains have rows by now (the advance ensured them);
    // inactive ones advance to a synthetic row — never persisted.
    const st = advanceCaptain(h, spaceId, def.id, nowMs, {});
    return toWireState(h, spaceId, st, nowMs);
  });
}

function toWireState(h: DbHandle, spaceId: string, st: CaptainStateRow, nowMs: number): CaptainState {
  const def = captainDefinition(st.captainId);
  if (!def) throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${st.captainId}".`);
  const captains = new CaptainRepo(h, spaceId);
  const log = new NpcRepo(h, spaceId);
  const tz = spaceTimezone(h.sqlite, spaceId);
  const recent = log.recentLog(st.captainId, 20);
  const meetings = captains.meetings(st.captainId);
  const visiting = st.sessionKey !== null && st.currentWorld !== null;
  // Transit state (§5.3): a leg open at the last processed step is
  // "departed" in its departure step and "underway" once a later
  // step has been processed. The cursor (lastAdvancedAt) is the
  // last processed instant — a leg whose departure step is the
  // cursor's step is still in its departure step.
  let transitState: CaptainState["transitState"] = "none";
  if (st.legTo && st.legDepartedStepMs !== null) {
    const cursorMs = st.lastAdvancedAt ? Date.parse(st.lastAdvancedAt) : nowMs;
    transitState =
      cursorMs > st.legDepartedStepMs + CAPTAIN_ADVANCE_STEP_MS ? "underway" : "departed";
  }
  let doingLine: string;
  if (!def.active) {
    doingLine = "Not flying yet — runs begin in a later increment.";
  } else if (st.stopped) {
    doingLine = "Stopped by the owner. Nothing happens until resumed.";
  } else if (st.legTo) {
    const dueMs = st.legArrivesStepMs ?? nowMs;
    if (transitState === "departed") {
      doingLine = `Departed ${worldNamePlain(st.legFrom ?? st.homeWorld)} — underway to ${worldNamePlain(st.legTo)} ${legKindPlain(st.legKind ?? "drift")}, due ${whenPlain(tz, nowMs, dueMs)}.`;
    } else {
      doingLine = `Underway to ${worldNamePlain(st.legTo)} — ${st.legKind ?? "drift"}, due ${whenPlain(tz, nowMs, dueMs)}. Last seen at ${worldNamePlain(st.legFrom ?? st.homeWorld)}.`;
    }
  } else if (visiting) {
    doingLine = recent[0]?.act ?? `Visiting ${worldNamePlain(st.currentWorld!)}.`;
  } else {
    const next = nextVisit(st.captainId, nowMs, tz, st.homeWorld);
    doingLine = `Home at ${st.homeAnchorLabel} — next visit is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
  }
  return {
    id: def.id,
    name: def.name,
    role: def.role,
    pronouns: def.pronouns,
    ageBand: def.ageBand,
    personality: def.personality,
    traits: [...def.traits],
    active: def.active,
    present: def.active && visiting && !st.stopped,
    homeWorld: def.homeWorld,
    homeAnchor: st.homeAnchorLabel,
    currentWorld: st.currentWorld,
    sessionState: visiting ? "visiting" : "away",
    transitState,
    legTo: st.legTo,
    legKind: st.legKind,
    doingLine,
    fuel: st.fuel,
    credits: st.credits,
    stopped: st.stopped,
    actsToday: captains.actsToday(st.captainId, nowMs),
    speaksToday: captains.speaksToday(st.captainId, nowMs),
    meetingsRemembered: meetings.length,
    firstMetAt: meetings[0]?.createdAt ?? null,
    recentLog: recent,
    barks: captains.barksForDay(st.captainId, localDateKey(tz, nowMs)),
    ...(isPurposeCaptain(def)
      ? {
          relicsHeld: log.holdings(st.captainId),
          plan: captainPlanView(h, spaceId, st.captainId),
          gateView: captainGateView(h, spaceId, st.captainId),
        }
      : {}),
    // P3 (T9): visible cargo + her savings goal + her affinities,
    // read from the NPC pool (advance-first, like every read here).
    ...(isEconomyCaptain(def) && def.active
      ? (() => {
          const svc = new NpcEconomy(h, spaceId, st.captainId);
          const cargo = svc.cargoReadOnly();
          const credits = Math.round(st.credits);
          const target = captainSavingsTarget(def, credits);
          return {
            cargo,
            holdUsed: cargo.reduce((sum, c) => sum + c.qty, 0),
            holdCapacity: HOLD_CAPACITY,
            savingsGoal: { label: def.savingsGoalLabel, target, distance: Math.max(0, target - credits) },
            affinities: affinitiesOf(h, spaceId, st.captainId),
            ...(isPurposeCaptain(def) ? {} : { plan: captainPlanView(h, spaceId, st.captainId) }),
          };
        })()
      : {}),
    directorEnabled: getDirectorState(h, spaceId).enabled,
  };
}

// --- asking (design §9, L1 kinds: doing / met / headed) ---

export function askCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  question: CaptainQuestionKind,
  nowMs: number = Date.now(),
  aboutCaptainId?: CaptainId,
): { answer: string; state: CaptainState } {
  const def = captainDefinition(captainId);
  if (!def) {
    throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  }
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — runs begin in a later increment.`);
  }
  const st = advanceCaptain(h, spaceId, captainId, nowMs, {});
  if (st.stopped) {
    throw new CaptainError("CAPTAIN_STOPPED", 409, `${def.name} is stopped. A stopped captain hears and says nothing.`);
  }
  const captains = new CaptainRepo(h, spaceId);
  const log = new NpcRepo(h, spaceId);
  const tz = spaceTimezone(h.sqlite, spaceId);
  if (captains.speaksToday(captainId, nowMs) >= CAPTAIN_MAX_SPEAKS_PER_DAY) {
    throw new CaptainError(
      "BUDGET_EXHAUSTED",
      429,
      `${def.name} has spoken the day's fill (${CAPTAIN_MAX_SPEAKS_PER_DAY} spoken acts). The voice rests until tomorrow.`,
    );
  }

  const visiting = st.sessionKey !== null && st.currentWorld !== null;
  const inTransit = st.legTo !== null;
  let answer: string;
  let askedPlain: string;
  if (question === "doing") {
    askedPlain = "what the captain is doing";
    if (inTransit) {
      answer = `I'm travelling — left ${worldNamePlain(st.legFrom ?? st.homeWorld)}, bound for ${worldNamePlain(st.legTo!)} ${legKindPlain(st.legKind ?? "drift")}. I'll be in ${whenPlain(tz, nowMs, st.legArrivesStepMs ?? nowMs)}.`;
    } else if (visiting) {
      const recent = log.recentLog(captainId, 1)[0];
      answer =
        `I'm at ${worldNamePlain(st.currentWorld!)} just now. ` +
        (recent ? `Last thing I did: ${recent.act.charAt(0).toLowerCase()}${recent.act.slice(1)} ` : "") +
        `No errands I'm chasing today — in this first stretch I mostly keep company and mind the lanes.`;
    } else {
      const next = nextVisit(captainId, nowMs, tz, st.homeWorld);
      answer = `I'm away from the public worlds just now. My next visit is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
    }
  } else if (question === "about") {
    askedPlain = "what the captain thinks of another captain";
    const other = aboutCaptainId ? captainDefinition(aboutCaptainId) : undefined;
    if (!other || other.id === captainId) {
      throw new CaptainError(
        "INVALID_QUESTION",
        400,
        `"Tell me about [captain]" needs another captain's name — that is the question this kind answers (P3).`,
      );
    }
    const value = getAffinity(h, spaceId, captainId, other.id);
    answer =
      `My honest read on ${other.name}? ${affinityLabel(value).replace(/^a captain/, "A captain")} — ` +
      `that is my opinion of them, from market and road events between us as they were written down: premium sales contested, tows flown, convoys shared, dockside meetings. ` +
      `It colours where I trade and whose company I seek. It is not a verdict, and it touches nobody's business but ours.`;
  } else if (question === "met") {
    askedPlain = "whether you've met";
    const meetings = captains.meetings(captainId);
    const first = meetings[0];
    if (!first) {
      answer = `We haven't met — not that I remember, and my memory is the honest kind: every meeting I've had is written down. I'm ${def.name}, a regular here. I keep to the public worlds — the Great Station, Scale, the Growing Place, the Deep Past, and the Quiet Archive — and everything I do gets logged where you can read it. I'm not a person and I won't pretend to be one; I'm one of this world's captains.`;
    } else {
      const lastWorld = first.tags[0] ? worldNamePlain(first.tags[0]) : "the public worlds";
      answer =
        meetings.length === 1
          ? `We have — once. ${first.text} That was our first meeting, and I keep it written down.`
          : `We have — ${meetings.length} times now. The first was at ${lastWorld}; the most recent, ${meetings[meetings.length - 1]?.text.charAt(0).toLowerCase()}${(meetings[meetings.length - 1]?.text ?? "").slice(1)}`;
    }
  } else if (question === "headed") {
    askedPlain = "where the captain is headed";
    if (inTransit) {
      // Answered from the leg, not the plan (§5.3): the destination
      // is the one recorded at departure from a held plan.
      answer = `I just left ${worldNamePlain(st.legFrom ?? st.homeWorld)}. I'm for ${worldNamePlain(st.legTo!)}, ${st.legKind === "warp" ? "warping" : "drifting"} — I'll be in ${whenPlain(tz, nowMs, st.legArrivesStepMs ?? nowMs)}.`;
    } else if (visiting) {
      const next = nextVisitAfterSession(captainId, st, nowMs, tz);
      answer = next
        ? `I'm at ${worldNamePlain(st.currentWorld!)} for a while yet. When this visit wraps, my next is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`
        : `I'm at ${worldNamePlain(st.currentWorld!)} for a while yet — no further visits on today's rhythm after this one.`;
    } else {
      const next = nextVisit(captainId, nowMs, tz, st.homeWorld);
      answer = `Next I'm headed to ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
    }
  } else {
    throw new CaptainError("INVALID_QUESTION", 400, `"${String(question)}" is not a question a captain can answer yet.`);
  }

  log.appendLog(captainId, "speak", answer, `You asked ${askedPlain}.`, nowMs);
  return { answer, state: toWireState(h, spaceId, captains.state(captainId) ?? st, nowMs) };
}

/** The first planned visit starting after the live session ends. */
function nextVisitAfterSession(
  captainId: CaptainId,
  st: CaptainStateRow,
  nowMs: number,
  tz: string,
): (CaptainVisit & { dayKey: string }) | null {
  const endsAt = st.sessionEndsAt ? Date.parse(st.sessionEndsAt) : nowMs;
  const dayKey = localDateKey(tz, endsAt);
  for (const v of dayPlan(captainId, dayKey, tz, st.homeWorld)) {
    if (v.startMs >= endsAt) return { ...v, dayKey };
  }
  const next = nextVisit(captainId, endsAt + 1, tz, st.homeWorld);
  return next.startMs >= endsAt ? next : null;
}

// --- owner controls (design §8.2/§6.5), logged as owner acts ---

export function stopCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
): CaptainState {
  const def = captainDefinition(captainId);
  if (!def) throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — there is nothing to stop.`);
  }
  const captains = new CaptainRepo(h, spaceId);
  captains.ensureState(def, nowMs);
  captains.setStopped(captainId, true);
  captains.setCursor(captainId, nowMs);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    "Stopped.",
    "The owner stopped this captain. A stopped captain does nothing: no visits, no greetings, no answers — total silence.",
    nowMs,
  );
  return toWireState(h, spaceId, captains.state(captainId)!, nowMs);
}

export function resumeCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
): CaptainState {
  const def = captainDefinition(captainId);
  if (!def) throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — there is nothing to resume.`);
  }
  const captains = new CaptainRepo(h, spaceId);
  captains.ensureState(def, nowMs);
  captains.setStopped(captainId, false);
  // The cursor restarts at resume: the stopped span is not replayed.
  // An open leg survives the stop (§5.4); its arrival step has
  // passed by now in the usual case, so the first advance after
  // resume resolves it in its first step — logged as an arrival,
  // never duplicated, never re-charged.
  captains.setCursor(captainId, nowMs);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    "Resumed.",
    "The owner resumed this captain. The rhythm picks up from now — the stopped days are not backfilled.",
    nowMs,
  );
  return toWireState(h, spaceId, captains.state(captainId)!, nowMs);
}

export function wipeCaptainMeetings(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
): CaptainState {
  const def = captainDefinition(captainId);
  if (!def) throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — no meetings are held to wipe.`);
  }
  const captains = new CaptainRepo(h, spaceId);
  captains.ensureState(def, nowMs);
  captains.wipeMeetings(captainId);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    "Forgot our meetings.",
    "The owner wiped this captain's memory of meeting you — the meeting entries are gone and your next meeting will be a first meeting (design §6.5). Other memories stay.",
    nowMs,
  );
  return toWireState(h, spaceId, captains.state(captainId)!, nowMs);
}

export function resetCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number = Date.now(),
): CaptainState {
  const def = captainDefinition(captainId);
  if (!def) throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — there is nothing to reset.`);
  }
  // The wipe itself (purpose.ts) removes ONLY her rows and leaves
  // the reset line on the shared log; a fresh state row starts her
  // over, exactly as a player's reset starts a new brain (§6.2).
  resetCaptainPurpose(h, spaceId, captainId, nowMs);
  const captains = new CaptainRepo(h, spaceId);
  const st = captains.ensureState(def, nowMs);
  captains.setCursor(captainId, nowMs);
  return toWireState(h, spaceId, st, nowMs);
}

// --- Chronicle v1 (design §8.1): a read model over the shared log ---

export function getChronicle(
  h: DbHandle,
  spaceId: string,
  nowMs: number = Date.now(),
  limit = 30,
): ChronicleLine[] {
  // Looking at the Chronicle is a read touching captain state:
  // captains advance first so the feed is alive, never replayed.
  advanceAllCaptains(h, spaceId, nowMs, {});
  const harborName = npcDefinition("harbor-controller")?.name ?? "Harbor controller";
  const names = new Map<string, string>([
    ["harbor-controller", harborName],
    ...CAPTAIN_DEFINITIONS.map((d) => [d.id as string, `${d.name} — ${d.role}`] as const),
  ]);
  const ids = ["harbor-controller", ...CAPTAIN_DEFINITIONS.map((d) => d.id)];
  return new CaptainRepo(h, spaceId).chronicle(ids, names, Math.min(100, Math.max(1, limit)));
}
