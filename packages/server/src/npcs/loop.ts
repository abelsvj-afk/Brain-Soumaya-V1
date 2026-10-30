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
import { spaceTimezone } from "../agent/notify/policy.js";
import { RELIC_BY_ID } from "@brain/shared";
import { RelicClaimService } from "../relics/claims.js";
import { RelicStirringService } from "../relics/stirrings.js";

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
 * Relics I-5 widened exactly one lane, deliberately: the explore act
 * now attempts a real relic claim through the unified claim core
 * (relics/claims.ts — one copy pool shared with players, the
 * last-copy courtesy inside the same transaction), and every tick
 * evaluates stirring issuance for the world the space stands in
 * (relics/stirrings.ts). Those writes touch only relic, npc_* and
 * inbox records — brain content (nodes/edges) stays read-only to
 * this module, and the loop's brain-purity test still proves ticks
 * leave it byte-identical.
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
  if (!question && st.lastTickAt && nowMs - Date.parse(st.lastTickAt) < NPC_TICK_MIN_INTERVAL_MS) {
    return {
      acted: false,
      entry: null,
      reason: `${def.name} already looked in on things recently — it waits its turn.`,
      reasonCode: "throttled",
    };
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
    if (!repo.budgetAllows(def.id, kind, nowMs)) {
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
      // Relics I-5 (§5.5): the explore is a REAL find attempt through
      // the unified claim core — the same pool, the same award, the
      // last-copy courtesy inside this transaction. A find names what
      // was found; a deferral or an empty pool logs as finding
      // nothing, which is the courtesy's designed invisibility (the
      // NPC simply waits, and its world stays honest).
      const claim = new RelicClaimService(h).claimForNpc(spaceId, def.id, def.world);
      if (claim.status === "awarded") {
        const foundName = RELIC_BY_ID.get(claim.relicId)?.name ?? claim.relicId;
        entry = repo.appendLog(def.id, "explore", `Looked for a way onward in my own world — and found the ${foundName} resting here.`, decision.cause, nowMs);
        // The find may have completed this NPC's gate set: the gate
        // record is marked in this same tick, not left for the next.
        const holdingsNow = repo.holdings(def.id);
        if (checkNpcEternityGate(holdingsNow, repo.gateOpen(def.id)).open && !repo.gateOpen(def.id)) {
          repo.markGateOpen(def.id, nowMs);
        }
      } else {
        entry = repo.appendLog(def.id, "explore", exploreOutcome(p), decision.cause, nowMs);
      }
      const tz = spaceTimezone(h.sqlite, spaceId);
      repo.markExploreDay(def.id, localDateKey(tz, nowMs));
    } else {
      entry = repo.appendLog(def.id, "wait", "Waited.", decision.cause, nowMs);
    }
    // Relics I-5 (§5.4): stirring issuance is evaluated inside the
    // daily loop, for the world the space currently stands in —
    // arrival there is what makes the world reachable to the space.
    // At most one ambient stirring per (space, world); the evaluation
    // is inert when one is already open, when the pool cannot
    // furnish a copy to promise, or when nothing there is
    // undiscovered by this space.
    new RelicStirringService(h).evaluateAmbientForWorld(spaceId, p.currentWorld, nowMs);
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
