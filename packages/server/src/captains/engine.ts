import type { DbHandle } from "../db/client.js";
import { NpcRepo, localDateKey } from "../npcs/repo.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import {
  CAPTAIN_ADVANCE_MAX_STEPS,
  CAPTAIN_ADVANCE_STEP_MS,
  CAPTAIN_DEFINITIONS,
  CAPTAIN_MAX_ACTS_PER_DAY,
  CAPTAIN_MAX_SPEAKS_PER_DAY,
  CAPTAIN_START_CREDITS,
  CAPTAIN_START_FUEL,
  CAPTAIN_PUBLIC_WORLDS,
  CAPTAIN_MEETING_IMPORTANCE,
  CAPTAIN_MEETING_IMPORTANCE_FIRST,
  CAPTAIN_SESSION_IMPORTANCE,
  WARP_COST,
  captainDefinition,
  npcDefinition,
  type CaptainId,
  type CaptainQuestionKind,
  type CaptainState,
  type CaptainWorld,
  type ChronicleLine,
  type NpcActKind,
} from "@brain/shared";
import { CaptainRepo, type CaptainStateRow } from "./repo.js";
import { dayPlan, nextVisit, rngFor, zonedTimeMs, type CaptainVisit } from "./seed.js";
import { utilityDecider, type CaptainDecider, type CaptainDecision } from "./decider.js";
import { templateBarkSource, type BarkSource } from "./barks.js";

/**
 * The captain engine (NPC-Player Layer L1 — Presence): lazy
 * fast-forward over the shared NPC framework (design §3). There
 * are NO background timers: a captain lives when someone looks —
 * any read touching captain state advances her from
 * `last_advanced_at` to now in hourly seeded steps (cap 72; beyond
 * that, an honestly-logged summarized jump, §3's "was away").
 *
 * Rules the engine enforces, from the design:
 *  - Fence (§5.1): a captain's act kind must be on HER allow-list
 *    and any world she enters must be a public world. Violation is
 *    refused before anything is written.
 *  - A1 isolation: the engine writes ONLY captain tables and the
 *    shared NPC log. It never touches the player's fuel, credits,
 *    nodes, demand, relics, or brain — her warp burns HER fuel.
 *  - A2 determinism: every step's decisions come from the seeded
 *    plan + the pure decider; same seed and interval, same life.
 *  - A4 budgets + kill switch: per-local-day act/speak caps, and a
 *    stopped captain is total silence (the cursor still moves, so
 *    resuming never backfills the stopped span).
 *  - A5 meetings: recorded in HER memory on your visits; the wipe
 *    makes the next meeting a first meeting again.
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
    default:
      return key;
  }
}

function otherWorld(world: CaptainWorld): CaptainWorld {
  return world === "great-station" ? "scale" : "great-station";
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

export interface CaptainWorldDeps {
  decider?: CaptainDecider;
  barks?: BarkSource;
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
  barkSource: BarkSource;
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
    decider: deps.decider ?? utilityDecider,
    barkSource: deps.barks ?? templateBarkSource,
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
 *  any world involved on the public list. Refusal throws BEFORE
 *  anything is written. */
function fenceCheck(ctx: StepCtx, kind: NpcActKind, world?: CaptainWorld): void {
  if (!ctx.def.allowList.includes(kind)) {
    throw new CaptainError(
      "FENCE_REFUSAL",
      403,
      `${ctx.def.name} may not "${kind}" — it is not on her L1 allow-list.`,
    );
  }
  if (world !== undefined && !CAPTAIN_PUBLIC_WORLDS.includes(world)) {
    throw new CaptainError("FENCE_REFUSAL", 403, `${world} is not a public world a captain may enter.`);
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

// --- session boundaries ---

function beginSession(ctx: StepCtx, visit: CaptainVisit, stepMs: number): void {
  const world = visit.world;
  fenceCheck(ctx, "arrive", world);
  const entry = logAct(
    ctx,
    "arrive",
    `Came into ${worldNamePlain(world)} — visit ${visit.index + 1} of ${visit.total} today.`,
    `Her day's rhythm, drawn from her own seeded plan the way a person's day is drawn from habit; no player action caused this.`,
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
    `Started a visit at ${worldNamePlain(world)}.`,
    CAPTAIN_SESSION_IMPORTANCE,
    [world],
    stepMs,
  );
  // One idle bark per day, on the day's first arrival — Chronicle
  // color, grounded in her voice profile, stored with its source.
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

function endSession(ctx: StepCtx, stepMs: number, cause: string): void {
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

// --- one hourly step of a live session ---

function stepSession(ctx: StepCtx, stepStartMs: number, stepEndMs: number): void {
  const st = ctx.state;
  const world = st.currentWorld;
  if (!world || !st.sessionEndsAt || !st.sessionStartedAt) return;
  const sessionEnd = Date.parse(st.sessionEndsAt);
  const sessionStart = Date.parse(st.sessionStartedAt);

  // Meeting first: if the visitor is here, she remembers it — once
  // per visit, in HER stream, whether or not she speaks.
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

  // Drive inputs for this step (perception, design §4.1).
  const sessionAgeRatio = Math.min(1, Math.max(0, (stepStartMs - sessionStart) / Math.max(1, sessionEnd - sessionStart)));
  const stepsLeftInSession = Math.max(1, Math.ceil((sessionEnd - stepStartMs) / CAPTAIN_ADVANCE_STEP_MS));
  const curiosity = 0.3 + rngFor(ctx.captainId, "curiosity", st.sessionKey ?? "")() * 0.5;
  const sociability = present ? 0.85 : 0.4;

  const decision: CaptainDecision = ctx.decider.decide(ctx.def, {
    stepStartMs,
    world,
    otherWorld: otherWorld(world),
    otherWorldName: worldNamePlain(otherWorld(world)),
    sessionAgeRatio,
    stepsLeftInSession,
    fuel: st.fuel,
    playerPresent: present,
    greetedThisVisit: visitKey !== null && st.lastGreetVisitKey === visitKey,
    curiosity,
    sociability,
  });

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
      const to = decision.toWorld;
      fenceCheck(ctx, "travel", to);
      if (decision.travelKind === "warp") {
        if (st.fuel < WARP_COST) {
          logAct(
            ctx,
            "wait",
            `Stayed at ${worldNamePlain(world)}.`,
            `A warp to ${worldNamePlain(to)} costs ${WARP_COST} fuel and she has ${Math.floor(st.fuel)} — her own ledger said no.`,
            stepStartMs,
          );
          return;
        }
        const entry = logAct(
          ctx,
          "travel",
          `Warped to ${worldNamePlain(to)} — ${WARP_COST} fuel of her own, the fast way.`,
          decision.cause,
          stepStartMs,
        );
        if (entry) {
          ctx.captains.update(ctx.captainId, { currentWorld: to, fuel: st.fuel - WARP_COST });
          st.currentWorld = to;
          st.fuel = st.fuel - WARP_COST;
        }
        return;
      }
      const entry = logAct(
        ctx,
        "travel",
        `Drifted to ${worldNamePlain(to)} — the slow way, free.`,
        decision.cause,
        stepStartMs,
      );
      if (entry) {
        ctx.captains.update(ctx.captainId, { currentWorld: to });
        st.currentWorld = to;
      }
      return;
    }
    case "depart": {
      endSession(ctx, stepStartMs, decision.cause);
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
    // Defined, not flying yet (L1: Dain, Veyra): NO state row is
    // ever created for an inactive captain — the display state is
    // synthesized from the definition and the shared defaults.
    return {
      captainId: def.id,
      homeWorld: def.homeWorld,
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
    };
  }
  const captains = new CaptainRepo(h, spaceId);
  const st = captains.ensureState(def, nowMs);

  const tz = spaceTimezone(h.sqlite, spaceId);
  if (st.stopped) {
    // Total silence (design §8.2): no acts, no backfill later —
    // the cursor moves so a resume starts from now, not from the
    // moment she was stopped.
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
    if (steps > CAPTAIN_ADVANCE_MAX_STEPS) {
      // Summarized jump (§3): beyond the cap she "was away" — any
      // live session ended somewhere in the gap, said honestly in
      // one summary line instead of 100 fabricated hourly acts.
      if (ctx.state.currentWorld) {
        endSession(
          ctx,
          fromMs + CAPTAIN_ADVANCE_STEP_MS,
          "The visit ended while you were away — long absences summarize; they do not fabricate an hourly life.",
        );
      }
      logAct(
        ctx,
        "wait",
        "Was away — days passed between your visits here.",
        `${Math.floor((nowMs - fromMs) / 86_400_000)} day(s) passed with no one watching; her life summarized rather than replayed (design §3).`,
        nowMs,
      );
    } else {
      let t = fromMs;
      while (t < nowMs) {
        const stepEnd = Math.min(t + CAPTAIN_ADVANCE_STEP_MS, nowMs);
        stepOnce(ctx, t, stepEnd);
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
  const dayKey = localDateKey(ctx.tz, stepStartMs);
  if (st.sessionKey) {
    const endsAt = st.sessionEndsAt ? Date.parse(st.sessionEndsAt) : 0;
    if (stepStartMs >= endsAt) {
      endSession(
        ctx,
        stepStartMs,
        "The visit's planned hours ran out — her day's rhythm, not restlessness, ended it.",
      );
      return;
    }
    stepSession(ctx, stepStartMs, stepEndMs);
    return;
  }
  // Away: does a planned visit cover this step?
  const plan = dayPlan(ctx.captainId, dayKey, ctx.tz, st.homeWorld);
  const visit = plan.find((v) => stepStartMs >= v.startMs && stepStartMs < v.endMs);
  if (visit) beginSession(ctx, visit, stepStartMs);
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
  let doingLine: string;
  if (!def.active) {
    doingLine = "Not flying yet — her runs begin in a later increment.";
  } else if (st.stopped) {
    doingLine = "Stopped by the owner. She does nothing until resumed.";
  } else if (visiting) {
    doingLine = recent[0]?.act ?? `Visiting ${worldNamePlain(st.currentWorld!)}.`;
  } else {
    const next = nextVisit(st.captainId, nowMs, tz, st.homeWorld);
    doingLine = `Away just now — next visit is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
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
    currentWorld: st.currentWorld,
    sessionState: visiting ? "visiting" : "away",
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
  };
}

// --- asking (design §9, L1 kinds: doing / met / headed) ---

export function askCaptain(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  question: CaptainQuestionKind,
  nowMs: number = Date.now(),
): { answer: string; state: CaptainState } {
  const def = captainDefinition(captainId);
  if (!def) {
    throw new CaptainError("UNKNOWN_CAPTAIN", 404, `There is no captain named "${captainId}".`);
  }
  if (!def.active) {
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — her runs begin in a later increment.`);
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
      `${def.name} has spoken her fill for today (${CAPTAIN_MAX_SPEAKS_PER_DAY} spoken acts). She rests her voice until tomorrow.`,
    );
  }

  const visiting = st.sessionKey !== null && st.currentWorld !== null;
  let answer: string;
  let askedPlain: string;
  if (question === "doing") {
    askedPlain = "what she's doing";
    if (visiting) {
      const recent = log.recentLog(captainId, 1)[0];
      answer =
        `I'm at ${worldNamePlain(st.currentWorld!)} just now. ` +
        (recent ? `Last thing I did: ${recent.act.charAt(0).toLowerCase()}${recent.act.slice(1)} ` : "") +
        `No errands I'm chasing today — in this first stretch I mostly keep company and mind the lanes.`;
    } else {
      const next = nextVisit(captainId, nowMs, tz, st.homeWorld);
      answer = `I'm away from the public worlds just now. My next visit is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
    }
  } else if (question === "met") {
    askedPlain = "whether you've met";
    const meetings = captains.meetings(captainId);
    const first = meetings[0];
    if (!first) {
      answer = `We haven't met — not that I remember, and my memory is the honest kind: every meeting I've had is written down. I'm ${def.name}, a regular here. I keep to the public worlds — the Great Station and Scale — and everything I do gets logged where you can read it. I'm not a person and I won't pretend to be one; I'm one of this world's captains.`;
    } else {
      const lastWorld = first.tags[0] ? worldNamePlain(first.tags[0]) : "the public worlds";
      answer =
        meetings.length === 1
          ? `We have — once. ${first.text} That was our first meeting, and I keep it written down.`
          : `We have — ${meetings.length} times now. The first was at ${lastWorld}; the most recent, ${meetings[meetings.length - 1]?.text.charAt(0).toLowerCase()}${(meetings[meetings.length - 1]?.text ?? "").slice(1)}`;
    }
  } else if (question === "headed") {
    askedPlain = "where she's headed";
    if (visiting) {
      const next = nextVisitAfterSession(captainId, st, nowMs, tz);
      answer = next
        ? `I'm at ${worldNamePlain(st.currentWorld!)} for a while yet. When this visit wraps, my next is ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`
        : `I'm at ${worldNamePlain(st.currentWorld!)} for a while yet — no further visits on today's rhythm after this one.`;
    } else {
      const next = nextVisit(captainId, nowMs, tz, st.homeWorld);
      answer = `Next I'm headed to ${worldNamePlain(next.world)}, ${whenPlain(tz, nowMs, next.startMs)}.`;
    }
  } else {
    throw new CaptainError("INVALID_QUESTION", 400, `"${String(question)}" is not a question she can answer in L1.`);
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
    "The owner stopped her. A stopped captain does nothing: no visits, no greetings, no answers — total silence.",
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
  captains.setCursor(captainId, nowMs);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    "Resumed.",
    "The owner resumed her. Her rhythm picks up from now — the stopped days are not backfilled.",
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
    throw new CaptainError("CAPTAIN_NOT_ACTIVE", 409, `${def.name} isn't flying yet — she holds no meetings to wipe.`);
  }
  const captains = new CaptainRepo(h, spaceId);
  captains.ensureState(def, nowMs);
  captains.wipeMeetings(captainId);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    "Forgot our meetings.",
    "The owner wiped her memory of meeting you — her meeting entries are gone and your next meeting will be a first meeting (design §6.5). Her other memories stay.",
    nowMs,
  );
  return toWireState(h, spaceId, captains.state(captainId)!, nowMs);
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
