import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import {
  NPC_TICK_MIN_INTERVAL_MS,
  npcDefinition,
  type NpcActKind,
  type NpcDefinition,
  type NpcId,
  type NpcLogEntry,
  type NpcQuestionKind,
  type NpcState,
} from "@brain/shared";
import { NpcRepo, localDateKey } from "./repo.js";
import { checkNpcEternityGate } from "./gate.js";
import { decide, exploreOutcome, perceive } from "./harbor.js";
import { decideEternity, perceiveEternity } from "./eternity.js";
import { spaceTimezone } from "../agent/notify/policy.js";

/**
 * The autonomy loop (design note §2): Perceive → Decide → Act → Log.
 * Every autonomous NPC runs this same loop, visibly and auditably,
 * on its own schedule — never continuously. The loop is bounded: one
 * autonomous tick per NPC at most every NPC_TICK_MIN_INTERVAL_MS, and
 * every act counts against the owner-set daily budgets.
 *
 * The fence (note §3) is enforced HERE, in one place, before any act
 * executes:
 * - the act's kind must be on the acting NPC's allow-list (anything
 *   else is not a tool — it cannot happen);
 * - the act's world must be the NPC's own world (an NPC's tools end
 *   at its world's edge);
 * - the act must fit the day's budgets (an NPC that would exceed one
 *   waits — and when the budget is spent, the tick logs nothing more);
 * - a stopped NPC does nothing at all — the kill switch silences it
 *   entirely, including its waits.
 * There is no brain-write capability anywhere in this module: the
 * only tables it touches are the npc_* tables and the read-only
 * travel/fuel views the perception needs. A structural act cannot be
 * constructed — no structural kind exists in the shared vocabulary —
 * and the propose→decide rail (§17) is a Phase 4 build; until it
 * exists, no NPC can propose structure at all.
 *
 * Ticks are LAZY: the loop runs when the client reads an NPC (or asks
 * it a question), never on a timer. A question always gets an answer
 * attempt — the throttle binds autonomous ticks only.
 */

export class NpcError extends Error {
  constructor(
    readonly code: "UNKNOWN_NPC" | "NPC_STOPPED" | "NPC_BUDGET_EXHAUSTED" | "NPC_FENCE_REFUSED",
    message: string,
  ) {
    super(message);
    this.name = "NpcError";
  }
}

export interface TickResult {
  /** Whether the tick performed (and logged) an act. */
  acted: boolean;
  /** The logged entry, when one was written. */
  entry: NpcLogEntry | null;
  /** Why no act happened, in plain words (throttled / stopped /
   *  budget spent) — null when the tick acted. */
  reason: string | null;
  /** Machine-readable form of `reason`, for callers that branch on it. */
  reasonCode: "throttled" | "stopped" | "budget" | null;
}

/** The fence, as a pure check — testable without a database. */
export function checkFence(def: NpcDefinition, kind: NpcActKind, world: string): void {
  if (!def.allowList.includes(kind)) {
    throw new NpcError(
      "NPC_FENCE_REFUSED",
      `${def.name} cannot ${kind} — that act is not on its allow-list.`,
    );
  }
  if (world !== def.world) {
    throw new NpcError(
      "NPC_FENCE_REFUSED",
      `${def.name} belongs to ${def.world} and cannot act in ${world}.`,
    );
  }
}

function requireDefinition(npcId: string): NpcDefinition {
  const def = npcDefinition(npcId);
  if (!def) throw new NpcError("UNKNOWN_NPC", `No NPC with id "${npcId}" exists.`);
  return def;
}

export function getNpcState(h: DbHandle, spaceId: string, npcId: string, nowMs: number = Date.now()): NpcState {
  const def = requireDefinition(npcId);
  const repo = new NpcRepo(h, spaceId);
  const st = repo.state(def.id);
  const holdings = repo.holdings(def.id);
  const gate = checkNpcEternityGate(holdings, repo.gateOpen(def.id));
  return {
    id: def.id,
    name: def.name,
    job: def.job,
    world: def.world,
    stopped: st.stopped,
    actsToday: repo.actsToday(def.id, nowMs),
    speaksToday: repo.speaksToday(def.id, nowMs),
    gateOpen: gate.open,
    relicsHeld: holdings.length,
    recentLog: repo.recentLog(def.id),
  };
}

/**
 * One tick of the loop for one NPC. `question` asks the NPC something
 * (a speak, answered from live state); without one the tick is
 * autonomous — the policy decides. The log write and the state
 * markers commit in ONE transaction: an act is never half-recorded.
 */
export function runNpcTick(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  npcId: string,
  nowMs: number = Date.now(),
  question: NpcQuestionKind | null = null,
): TickResult {
  const def = requireDefinition(npcId);
  const repo = new NpcRepo(h, spaceId);
  const st = repo.state(def.id);

  // The kill switch (note §3): a stopped NPC does nothing — no act,
  // no wait, no log line. The stop itself was logged when the owner
  // stopped it (see stopNpc), so the silence is visible, not hidden.
  if (st.stopped) {
    return {
      acted: false,
      entry: null,
      reason: `${def.name} is stopped — the owner stopped it, so it does nothing.`,
      reasonCode: "stopped",
    };
  }

  // The throttle binds autonomous ticks only: a question always gets
  // an answer attempt, a tick that only watches the world waits its turn.
  if (!question && st.lastTickAt && nowMs - Date.parse(st.lastTickAt) < (def.tickIntervalMs ?? NPC_TICK_MIN_INTERVAL_MS)) {
    return {
      acted: false,
      entry: null,
      reason: `${def.name} already looked in on things recently — it waits its turn.`,
      reasonCode: "throttled",
    };
  }

  // Eternity (roster #4) runs the same loop with his own policy: aggregates only, no questions, own budgets.
  if (def.id === "eternity") {
    const runEternity = h.sqlite.transaction((): TickResult => {
      const p = perceiveEternity(h, spaceId, nowMs, repo.actsToday(def.id, nowMs));
      const d = decideEternity(p);
      checkFence(def, d.act, def.world);
      if (!repo.budgetAllows(def.id, d.act, nowMs, def)) {
        return {
          acted: false,
          entry: null,
          reason: `${def.name} has acted enough for today — he waits until tomorrow.`,
          reasonCode: "budget",
        };
      }
      const entry =
        d.act === "gesture"
          ? repo.appendLog(def.id, "gesture", d.gesture, d.cause, nowMs)
          : d.act === "reorder-light"
            ? repo.appendLog(def.id, "reorder-light", "reorder-the-heavens", d.cause, nowMs)
            : repo.appendLog(def.id, "wait", "Waited.", d.cause, nowMs);
      repo.markTick(def.id, nowMs);
      return { acted: true, entry, reason: null, reasonCode: null };
    });
    return runEternity.immediate();
  }

  const run = h.sqlite.transaction((): TickResult => {
    // Perceive + Decide are pure functions of the ledger — the only
    // writes in this transaction are the log entry and the state
    // markers below.
    const p = perceive(h, spaceId, nowMs);
    // The NPC side of B-01: once the gate's condition is met for this
    // NPC it stays open for it — mark it the first time the check passes.
    if (p.gate.open && !repo.gateOpen(def.id)) repo.markGateOpen(def.id, nowMs);
    const decision = decide(p, question);
    const kind: NpcActKind = decision.act === "speak" ? "speak" : decision.act;
    checkFence(def, kind, def.world);
    // Budgets are owner-set, not model-set: an NPC that would exceed
    // one waits — and when the day's budget is spent, the tick writes
    // nothing more (the state still reports the spent budget).
    if (!repo.budgetAllows(def.id, kind, nowMs, def)) {
      return {
        acted: false,
        entry: null,
        reason: `${def.name} has used today's allowance — it waits until tomorrow.`,
        reasonCode: "budget",
      };
    }
    let entry: NpcLogEntry;
    if (decision.act === "speak") {
      entry = repo.appendLog(def.id, "speak", decision.text, decision.cause, nowMs);
      if (decision.welcomeJourneyId) repo.markWelcome(def.id, decision.welcomeJourneyId);
    } else if (decision.act === "explore") {
      entry = repo.appendLog(def.id, "explore", exploreOutcome(p), decision.cause, nowMs);
      const tz = spaceTimezone(h.sqlite, spaceId);
      repo.markExploreDay(def.id, localDateKey(tz, nowMs));
    } else {
      entry = repo.appendLog(def.id, "wait", "Waited.", decision.cause, nowMs);
    }
    repo.markTick(def.id, nowMs);
    return { acted: true, entry, reason: null, reasonCode: null };
  });
  return run.immediate();
}

/** Ask an NPC a question. A question is a speak: it counts against
 *  the speak budget, and a stopped NPC answers nothing. */
export function askNpc(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  npcId: string,
  question: NpcQuestionKind,
  nowMs: number = Date.now(),
): TickResult {
  const def = requireDefinition(npcId);
  if (def.id === "eternity") {
    // He is not asked or summoned (eternity-world-design-note §8): he acts when he acts.
    throw new NpcError("NPC_FENCE_REFUSED", "He is not asked — Eternity acts only when he chooses to.");
  }
  if (new NpcRepo(h, spaceId).state(def.id).stopped) {
    throw new NpcError("NPC_STOPPED", `${def.name} is stopped — it answers nothing while stopped.`);
  }
  const result = runNpcTick(h, spaceId, npcId, nowMs, question);
  if (!result.acted && result.reasonCode === "budget") {
    throw new NpcError("NPC_BUDGET_EXHAUSTED", `${def.name} has used today's allowance — it will answer again tomorrow.`);
  }
  return result;
}

/** Stop an NPC (the kill switch). The stop itself is logged as an
 *  owner act, so the silence afterwards is visible, not hidden. */
export function stopNpc(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  npcId: string,
  nowMs: number = Date.now(),
): NpcState {
  const def = requireDefinition(npcId);
  const repo = new NpcRepo(h, spaceId);
  const run = h.sqlite.transaction(() => {
    repo.setStopped(def.id, true);
    repo.appendLog(def.id, "wait", "Stopped.", "The owner stopped it — a stopped NPC does nothing.", nowMs);
  });
  run.immediate();
  return getNpcState(h, spaceId, npcId, nowMs);
}

/** Resume a stopped NPC. The resume is logged the same way. */
export function resumeNpc(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  npcId: string,
  nowMs: number = Date.now(),
): NpcState {
  const def = requireDefinition(npcId);
  const repo = new NpcRepo(h, spaceId);
  const run = h.sqlite.transaction(() => {
    repo.setStopped(def.id, false);
    repo.appendLog(def.id, "wait", "Resumed.", "The owner started it again.", nowMs);
  });
  run.immediate();
  return getNpcState(h, spaceId, npcId, nowMs);
}

export type { NpcId };
