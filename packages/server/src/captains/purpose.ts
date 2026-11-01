import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NpcRepo } from "../npcs/repo.js";
import { checkNpcEternityGate } from "../npcs/gate.js";
import {
  CAPTAIN_FIND_IMPORTANCE,
  CAPTAIN_GATE_IMPORTANCE,
  CAPTAIN_MEMORY_KEEP_IMPORTANCE,
  CAPTAIN_MEMORY_RETENTION,
  CAPTAIN_PHASE_LOCKED_VERBS,
  CAPTAIN_REFLECTION_TRIGGER,
  CAPTAIN_ROUTINE_IMPORTANCE,
  CAPTAIN_SEARCH_FIND_PROBABILITY,
  CAPTAIN_TRAVEL_WORLDS,
  NPC_GATE_KEY_RELIC,
  RELICS,
  captainDefinition,
  type CaptainDefinition,
  type CaptainGateView,
  type CaptainId,
  type CaptainLegKind,
  type CaptainMemoryEntry,
  type CaptainPlanView,
  type CaptainWorld,
  type NpcActKind,
} from "@brain/shared";
import { CaptainRepo, type CaptainStateRow } from "./repo.js";
import { rngFor } from "./seed.js";
import {
  GATE_GOAL_ID,
  GATE_GOAL_TEXT,
  planForGoal,
  type CaptainWorldState,
  type PlannedStep,
} from "./planner.js";

/**
 * P2 — Purpose & the Long Arc (spec §§2–7): the seeker's systems.
 *
 * What lives here, by the spec's ownership table (§2):
 *  - C3's plan STORE (the planner itself is planner.ts): immutable
 *    versions, supersedes/mismatch links, per-step expected/observed.
 *  - C4 the simulated brain + the deed acts that execute ONLY on it.
 *  - C5 the simulated commission board (her namespace only).
 *  - C7 the Search Act under limited knowledge, C8 her holdings via
 *    the NPC-scoped supply (ruling D-POOL, below), C9 her gate
 *    record via the one B-01 composition check.
 *  - C11 the completed memory stream (provenance, scored retrieval,
 *    reflection-lite, retention), C13 her stirring record, C14 her
 *    knowledge store.
 *
 * D-POOL (coordinator ruling, binding): captain finds draw on an
 * NPC-SCOPED SUPPLY. A find writes ONLY her row in the framework's
 * NPC holdings table — it never binds a copy in the player's relic
 * pool, never decrements the player's claimableSupply, never
 * quiets a player stirring, and never consults player state at
 * all. The unified-pool NPC claim path built for the harbor loop
 * is deliberately NOT used here: it does all of those things.
 * Which relic a find yields is a function of her scoped supply
 * alone: the first relic of the searched world (registry order)
 * she does not already hold. A Seed-class find is consumed, never
 * held — the player's own disposition, mirrored.
 *
 * The C4 wall: nothing in this module reads or writes a real
 * brain's tables (nodes / edges / review cards / journeys / inbox
 * of any space). Her deeds, her board's generation, and her
 * retrieval run on captain-namespaced tables only — enforced by
 * the byte-identical real-brain snapshots in the test suites.
 *
 * Phase-lock (P2-B1.9): the P3 economy verbs are refused here and
 * in the engine fence with a PHASE_LOCKED cause. This module never
 * imports the G1 economy code and never writes its tables — and
 * NEVER routes a captain through the player's economy service:
 * its dormant "npc" actor kind would execute against the player's
 * cargo, credits, and demand (prep finding S-P3-3). Her Credits
 * live only on her own state row's ledger, moved only by her
 * board's payments (§6.4 of the spec).
 */

export class PurposeError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

/** A purpose captain is one whose allow-list carries the P2 kinds
 *  (in P2: Veyra alone — data-driven, so a later increment widens
 *  by definition, not by code). */
export function isPurposeCaptain(def: CaptainDefinition): boolean {
  return (def.allowList as readonly string[]).includes("deed");
}

/**
 * The narrow fence admission helper (build-brief ruling
 * D-FENCE-SHAPE): kind admission for P2 acts, in one place — the
 * phase-lock first (its cause is distinct by design), then her
 * allow-list, then the D-1 travel set for any world involved. The
 * engine's own fence applies the same rules inside the advance;
 * this helper is what the P2 executors and the phase-lock proofs
 * call. Pure: it proposes nothing and writes nothing.
 */
export function admitPurposeAct(def: CaptainDefinition, kind: string, world?: CaptainWorld | string): void {
  if (CAPTAIN_PHASE_LOCKED_VERBS.includes(kind)) {
    throw new PurposeError(
      "PHASE_LOCKED",
      403,
      `"${kind}" is locked until P3 — the economy verbs open with the Waking Market, not in P2.`,
    );
  }
  if (!(def.allowList as readonly string[]).includes(kind)) {
    throw new PurposeError(
      "FENCE_REFUSAL",
      403,
      `${def.name} may not "${kind}" — it is not on the captain allow-list.`,
    );
  }
  if (world !== undefined && !(CAPTAIN_TRAVEL_WORLDS as readonly string[]).includes(world)) {
    throw new PurposeError("FENCE_REFUSAL", 403, `${world} is not a world a captain may enter.`);
  }
}

/** The production search draw: the seeded discipline of seed.ts,
 *  keyed by captain + stirring + attempt, so the same life replays
 *  identically (A2) and no wall clock or Math.random enters a step. */
export function searchDrawFor(captainId: CaptainId, stirringId: number, attempt: number): number {
  return rngFor(captainId, "search", stirringId, attempt)();
}

/** The executor surface the engine supplies inside its advance
 *  transaction (and tests supply over the same repos): P2 acts are
 *  admitted, executed, and logged atomically with the advance
 *  (Architecture §7.2) — this module never opens its own. */
export interface PurposeExec {
  /** A budgeted, fence-admitted act into the shared log; null
   *  when the day's budget is spent (the day ends quietly). */
  logAct(kind: NpcActKind, act: string, cause: string, nowMs: number): { id: number } | null;
  /** Bookkeeping into the shared log (plan versions, mismatches,
   *  board events): fence-admitted, never budget-blocked — a spent
   *  budget must not strand a plan mid-supersession. */
  logBookkeeping(kind: NpcActKind, act: string, cause: string, nowMs: number): { id: number };
  /** Open a leg on the captain state (the engine's leg machinery:
   *  departure line, fuel at departure, arrival inside the
   *  advance). False when a spent budget kept her home. */
  openLeg(to: CaptainWorld, kind: CaptainLegKind, cause: string, nowMs: number): boolean;
  /** Her live state row. */
  state(): CaptainStateRow;
  /** Scripted search outcomes for tests; production omits it and
   *  the seeded draw decides. */
  searchDraw?: (captainId: CaptainId, stirringId: number) => number;
}

// --- row shapes ---

export interface PlanRow {
  id: number;
  captainId: CaptainId;
  goalId: string;
  goalText: string;
  version: number;
  supersedesId: number | null;
  mismatchId: number | null;
  state: string;
  createdLogId: number | null;
  createdAt: string;
}

export interface PlanStepRow {
  id: number;
  planId: number;
  stepIndex: number;
  kind: string;
  label: string;
  params: Record<string, unknown>;
  expected: string;
  observed: string | null;
  observedLogId: number | null;
  state: string;
}

export interface MismatchRow {
  id: number;
  planId: number;
  stepId: number;
  expected: string;
  observed: string;
  expectedLogId: number | null;
  observedLogId: number | null;
  cause: string;
  createdAt: string;
}

export interface StirringRow {
  id: number;
  captainId: CaptainId;
  world: CaptainWorld;
  sourceLogId: number | null;
  state: string;
  outcome: string | null;
  relicId: string | null;
  attempts: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SimNodeRow {
  id: string;
  theme: string;
  title: string;
  pointsTo: CaptainWorld;
  ageDays: number;
  due: number;
  reviews: number;
  resurfaces: number;
  tended: number;
}

export interface SimJourneyStep {
  kind: "travel" | "deed";
  world?: CaptainWorld;
  deed?: "tend" | "resurface" | "review" | "link";
  label: string;
}

export interface CommissionStep {
  kind: "travel" | "review" | "link" | "inbox" | "deed";
  label: string;
  world?: CaptainWorld;
  nodeId?: string;
  deed?: "tend" | "resurface" | "review" | "link";
}

export interface CommissionRow {
  id: number;
  captainId: CaptainId;
  kind: string;
  state: string;
  steps: CommissionStep[];
  currentStep: number;
  payment: number;
  createdLogId: number | null;
  completedLogId: number | null;
  createdAt: string;
}

export interface KnowledgeRow {
  id: number;
  claim: string;
  provenance: string;
  confidence: string;
  originLogId: number | null;
  supersededBy: number | null;
  createdAt: string;
}

export interface GateDecisionRow {
  id: number;
  decision: "open" | "unmet";
  holdingIds: string[];
  missing: string | null;
  logId: number | null;
  createdAt: string;
}

export type DeedKind = "tend" | "resurface" | "review" | "link";

interface PlanDbRow {
  id: number; goal_id: string; goal_text: string; version: number;
  supersedes_id: number | null; mismatch_id: number | null; state: string;
  created_log_id: number | null; created_at: string;
}
interface StepDbRow {
  id: number; plan_id: number; step_index: number; kind: string; label: string;
  params: string; expected: string; observed: string | null;
  observed_log_id: number | null; state: string;
}
interface StirringDbRow {
  id: number; world: string; source_log_id: number | null; state: string;
  outcome: string | null; relic_id: string | null; attempts: number;
  created_at: string; resolved_at: string | null;
}
interface NodeDbRow {
  id: string; theme: string; title: string; points_to: string; age_days: number;
  due: number; reviews: number; resurfaces: number; tended: number;
}
interface CommissionDbRow {
  id: number; kind: string; state: string; steps: string; current_step: number;
  payment: number; created_log_id: number | null; completed_log_id: number | null;
  created_at: string;
}

/** All of the seeker's own stores, one class over one space. */
export class PurposeStore {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  private captains(): CaptainRepo {
    return new CaptainRepo(this.h, this.spaceId);
  }
  private npc(): NpcRepo {
    return new NpcRepo(this.h, this.spaceId);
  }

  // --- C3: the plan store (immutable versions) ---

  createPlan(
    captainId: CaptainId,
    goalId: string,
    goalText: string,
    steps: PlannedStep[],
    supersedesId: number | null,
    mismatchId: number | null,
    nowMs: number,
    createdLogId: number | null,
  ): PlanRow {
    const versions = this.planVersionsOf(captainId, goalId);
    const version = versions.length + 1;
    const state = steps.length === 0 ? "unplanned" : "active";
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_plans (npc_id, space_id, goal_id, goal_text, version, supersedes_id, mismatch_id, state, created_log_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, goalId, goalText, version, supersedesId, mismatchId, state, createdLogId, new Date(nowMs).toISOString());
    const id = Number(res.lastInsertRowid);
    steps.forEach((s, i) => this.insertStep(id, captainId, i, s));
    return this.planById(id)!;
  }

  private insertStep(planId: number, captainId: CaptainId, index: number, s: PlannedStep): void {
    this.h.sqlite
      .prepare(
        `INSERT INTO npc_plan_steps (plan_id, npc_id, space_id, step_index, kind, label, params, expected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        planId,
        captainId,
        this.spaceId,
        index,
        s.kind,
        s.label,
        JSON.stringify({ world: s.world ?? null, deed: s.deed ?? null, branch: s.branch }),
        s.expected,
      );
  }

  appendStep(planId: number, captainId: CaptainId, s: PlannedStep): PlanStepRow {
    const existing = this.stepsOf(planId);
    this.insertStep(planId, captainId, existing.length, s);
    return this.stepsOf(planId)[existing.length]!;
  }

  planById(id: number): PlanRow | null {
    const r = this.h.sqlite
      .prepare(`SELECT * FROM npc_plans WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as (PlanDbRow & { npc_id: string }) | undefined;
    return r ? this.toPlan(r) : null;
  }

  private toPlan(r: PlanDbRow & { npc_id: string }): PlanRow {
    return {
      id: r.id,
      captainId: r.npc_id as CaptainId,
      goalId: r.goal_id,
      goalText: r.goal_text,
      version: r.version,
      supersedesId: r.supersedes_id,
      mismatchId: r.mismatch_id,
      state: r.state,
      createdLogId: r.created_log_id,
      createdAt: r.created_at,
    };
  }

  planVersionsOf(captainId: CaptainId, goalId: string): PlanRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_plans WHERE space_id = ? AND npc_id = ? AND goal_id = ? ORDER BY version ASC`)
      .all(this.spaceId, captainId, goalId) as (PlanDbRow & { npc_id: string })[];
    return rows.map((r) => this.toPlan(r));
  }

  activePlan(captainId: CaptainId): PlanRow | null {
    const r = this.h.sqlite
      .prepare(
        `SELECT * FROM npc_plans WHERE space_id = ? AND npc_id = ? AND state IN ('active', 'unplanned') ORDER BY id DESC LIMIT 1`,
      )
      .get(this.spaceId, captainId) as (PlanDbRow & { npc_id: string }) | undefined;
    return r ? this.toPlan(r) : null;
  }

  stepsOf(planId: number): PlanStepRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_plan_steps WHERE space_id = ? AND plan_id = ? ORDER BY step_index ASC`)
      .all(this.spaceId, planId) as StepDbRow[];
    return rows.map((r) => ({
      id: r.id,
      planId: r.plan_id,
      stepIndex: r.step_index,
      kind: r.kind,
      label: r.label,
      params: JSON.parse(r.params) as Record<string, unknown>,
      expected: r.expected,
      observed: r.observed,
      observedLogId: r.observed_log_id,
      state: r.state,
    }));
  }

  /** A step closes exactly once, with the outcome the act's log
   *  event recorded — never from belief or narration (§5.1). A
   *  second completion throws: completion is a lifecycle fact, not
   *  an edit, and the expected string never moves at all. */
  completeStep(stepId: number, observed: string, observedLogId: number | null, nowMs: number): void {
    void nowMs;
    const res = this.h.sqlite
      .prepare(
        `UPDATE npc_plan_steps SET state = 'completed', observed = ?, observed_log_id = ?
         WHERE space_id = ? AND id = ? AND state = 'open'`,
      )
      .run(observed, observedLogId, this.spaceId, stepId);
    if (res.changes === 0) {
      throw new PurposeError("PLAN_STEP_CLOSED", 409, "That plan step is already closed — a stored step closes exactly once.");
    }
  }

  failStep(stepId: number, observed: string, observedLogId: number | null): void {
    this.h.sqlite
      .prepare(
        `UPDATE npc_plan_steps SET state = 'failed', observed = ?, observed_log_id = ?
         WHERE space_id = ? AND id = ? AND state = 'open'`,
      )
      .run(observed, observedLogId, this.spaceId, stepId);
  }

  closePlan(planId: number, state: string): void {
    this.h.sqlite
      .prepare(`UPDATE npc_plans SET state = ? WHERE space_id = ? AND id = ?`)
      .run(state, this.spaceId, planId);
  }

  /** Supersede: v(n) is closed as superseded — its steps are NOT
   *  touched — and v(n+1) is inserted under the same goal id,
   *  linked to its predecessor and to the mismatch that caused it. */
  supersedePlan(
    captainId: CaptainId,
    planId: number,
    mismatchId: number | null,
    steps: PlannedStep[],
    nowMs: number,
    createdLogId: number | null,
  ): PlanRow {
    const old = this.planById(planId);
    if (!old) throw new PurposeError("UNKNOWN_PLAN", 404, "There is no such plan to supersede.");
    this.closePlan(planId, "superseded");
    return this.createPlan(captainId, old.goalId, old.goalText, steps, planId, mismatchId, nowMs, createdLogId);
  }

  recordMismatch(
    captainId: CaptainId,
    planId: number,
    stepId: number,
    expected: string,
    observed: string,
    expectedLogId: number | null,
    observedLogId: number | null,
    cause: string,
    nowMs: number,
  ): MismatchRow {
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_mismatches (npc_id, space_id, plan_id, step_id, expected, observed, expected_log_id, observed_log_id, cause, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, planId, stepId, expected, observed, expectedLogId, observedLogId, cause, new Date(nowMs).toISOString());
    return {
      id: Number(res.lastInsertRowid),
      planId, stepId, expected, observed, expectedLogId, observedLogId, cause,
      createdAt: new Date(nowMs).toISOString(),
    };
  }

  mismatchesOf(captainId: CaptainId): MismatchRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, plan_id, step_id, expected, observed, expected_log_id, observed_log_id, cause, created_at
         FROM npc_mismatches WHERE space_id = ? AND npc_id = ? ORDER BY id ASC`,
      )
      .all(this.spaceId, captainId) as {
      id: number; plan_id: number; step_id: number; expected: string; observed: string;
      expected_log_id: number | null; observed_log_id: number | null; cause: string; created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id, planId: r.plan_id, stepId: r.step_id, expected: r.expected, observed: r.observed,
      expectedLogId: r.expected_log_id, observedLogId: r.observed_log_id, cause: r.cause, createdAt: r.created_at,
    }));
  }

  // --- C13: her stirring record (never the player's table) ---

  /** Raise a stirring on HER record. One active stirring per world
   *  on her record, as on the player's service: an already-active
   *  stirring at that world is returned unchanged. */
  raiseStirring(captainId: CaptainId, world: CaptainWorld, sourceLogId: number | null, nowMs: number): StirringRow {
    const existing = this.stirringAt(captainId, world);
    if (existing) return existing;
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_stirrings (npc_id, space_id, world, source_log_id, state, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(captainId, this.spaceId, world, sourceLogId, new Date(nowMs).toISOString());
    return this.stirringById(Number(res.lastInsertRowid))!;
  }

  stirringAt(captainId: CaptainId, world: CaptainWorld): StirringRow | null {
    const r = this.h.sqlite
      .prepare(
        `SELECT * FROM npc_stirrings WHERE space_id = ? AND npc_id = ? AND world = ? AND state = 'active' ORDER BY id DESC LIMIT 1`,
      )
      .get(this.spaceId, captainId, world) as StirringDbRow | undefined;
    return r ? this.toStirring(captainId, r) : null;
  }

  stirringById(id: number): StirringRow | null {
    const r = this.h.sqlite
      .prepare(`SELECT * FROM npc_stirrings WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as (StirringDbRow & { npc_id: string }) | undefined;
    return r ? this.toStirring(r.npc_id as CaptainId, r) : null;
  }

  private toStirring(captainId: CaptainId, r: StirringDbRow): StirringRow {
    return {
      id: r.id, captainId, world: r.world as CaptainWorld, sourceLogId: r.source_log_id,
      state: r.state, outcome: r.outcome, relicId: r.relic_id, attempts: r.attempts,
      createdAt: r.created_at, resolvedAt: r.resolved_at,
    };
  }

  activeStirrings(captainId: CaptainId): StirringRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_stirrings WHERE space_id = ? AND npc_id = ? AND state = 'active' ORDER BY id ASC`)
      .all(this.spaceId, captainId) as StirringDbRow[];
    return rows.map((r) => this.toStirring(captainId, r));
  }

  resolveStirring(id: number, outcome: "find" | "no-find", relicId: string | null, nowMs: number): void {
    this.h.sqlite
      .prepare(
        `UPDATE npc_stirrings SET state = 'resolved', outcome = ?, relic_id = ?, resolved_at = ? WHERE space_id = ? AND id = ?`,
      )
      .run(outcome, relicId, new Date(nowMs).toISOString(), this.spaceId, id);
  }

  bumpStirringAttempt(id: number): void {
    this.h.sqlite
      .prepare(`UPDATE npc_stirrings SET attempts = attempts + 1 WHERE space_id = ? AND id = ?`)
      .run(this.spaceId, id);
  }

  /** Searches on the gate goal that came back no-find, over her
   *  whole record (the planner's priorNoFinds input). */
  noFindCount(captainId: CaptainId): number {
    const row = this.h.sqlite
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN state = 'resolved' AND outcome = 'no-find' THEN 1 ELSE 0 END), 0) AS resolved,
                COALESCE(SUM(attempts), 0) AS attempts
         FROM npc_stirrings WHERE space_id = ? AND npc_id = ?`,
      )
      .get(this.spaceId, captainId) as { resolved: number; attempts: number };
    return row.resolved + row.attempts;
  }

  // --- C14: her knowledge store (beliefs — may be wrong) ---

  addKnowledge(
    captainId: CaptainId,
    claim: string,
    provenance: string,
    confidence: string,
    originLogId: number | null,
    nowMs: number,
  ): KnowledgeRow {
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_knowledge (npc_id, space_id, claim, provenance, confidence, origin_log_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, claim, provenance, confidence, originLogId, new Date(nowMs).toISOString());
    return {
      id: Number(res.lastInsertRowid), claim, provenance, confidence, originLogId,
      supersededBy: null, createdAt: new Date(nowMs).toISOString(),
    };
  }

  knowledgeOf(captainId: CaptainId): KnowledgeRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, claim, provenance, confidence, origin_log_id, superseded_by, created_at
         FROM npc_knowledge WHERE space_id = ? AND npc_id = ? ORDER BY id ASC`,
      )
      .all(this.spaceId, captainId) as {
      id: number; claim: string; provenance: string; confidence: string;
      origin_log_id: number | null; superseded_by: number | null; created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id, claim: r.claim, provenance: r.provenance, confidence: r.confidence,
      originLogId: r.origin_log_id, supersededBy: r.superseded_by, createdAt: r.created_at,
    }));
  }

  // --- C4: the simulated brain ---

  /** The production seed (~24 nodes, themes per archetype, age
   *  spread incl. ≥1-year-old nodes, due cards, journey steps,
   *  inbox) — a pure function of the captain id, seeded lazily at
   *  first P2 touch. Idempotent. */
  ensureSimBrain(captainId: CaptainId): void {
    const existing = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_sim_nodes WHERE space_id = ? AND npc_id = ?`)
      .get(this.spaceId, captainId) as { c: number };
    if (existing.c > 0) return;
    const def = captainDefinition(captainId);
    const themes =
      def?.id === "veyra"
        ? ["voyages", "the search", "people", "work"]
        : ["work", "people", "the search", "voyages"];
    const pointsCycle: CaptainWorld[] = ["scale", "great-station", "great-station", "scale"];
    const rng = rngFor(captainId, "sim-brain");
    const nodes: Parameters<PurposeStore["seedSimBrainFixture"]>[1] = [];
    for (let i = 0; i < 24; i++) {
      const theme = themes[i % themes.length]!;
      // Age spread: a seeded mix from days to over two years, with
      // several nodes past a year so Resurface is always possible.
      const ageDays = i < 5 ? 400 + Math.floor(rng() * 400) : 10 + Math.floor(rng() * 350);
      nodes.push({
        id: `sim-${i + 1}`,
        theme,
        title: `${theme === "voyages" ? "A voyage" : theme === "the search" ? "A bearing" : theme === "people" ? "A face" : "A task"} half-remembered, no. ${i + 1}`,
        pointsTo: pointsCycle[i % pointsCycle.length]!,
        ageDays,
        due: i === 0 ? 1 : 0,
      });
    }
    this.seedSimBrainFixture(
      captainId,
      nodes,
      [
        { kind: "travel", world: "scale", label: "travel to Scale" },
        { kind: "deed", deed: "review", label: "review a due card" },
        { kind: "travel", world: "great-station", label: "travel to the Great Station" },
        { kind: "deed", deed: "link", label: "link two nodes" },
      ],
      ["A note she has not answered.", "A second note, older."],
    );
  }

  /** Test-harness seeding (D-VEYRA-SEED): replaces her sim brain
   *  with the fixture's nodes/journey/inbox. Production reaches the
   *  brain only through ensureSimBrain. */
  seedSimBrainFixture(
    captainId: CaptainId,
    nodes: { id: string; theme: string; title: string; pointsTo: CaptainWorld; ageDays: number; due: number }[],
    journeySteps: SimJourneyStep[] = [],
    inbox: string[] = [],
  ): void {
    const del = (t: string) =>
      this.h.sqlite.prepare(`DELETE FROM ${t} WHERE space_id = ? AND npc_id = ?`).run(this.spaceId, captainId);
    del("npc_sim_nodes");
    del("npc_sim_edges");
    del("npc_sim_journey");
    del("npc_sim_inbox");
    const ins = this.h.sqlite.prepare(
      `INSERT INTO npc_sim_nodes (id, npc_id, space_id, theme, title, points_to, age_days, due)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const n of nodes) ins.run(n.id, captainId, this.spaceId, n.theme, n.title, n.pointsTo, n.ageDays, n.due);
    this.h.sqlite
      .prepare(`INSERT INTO npc_sim_journey (npc_id, space_id, step_index, progress, steps) VALUES (?, ?, 0, 0, ?)`)
      .run(captainId, this.spaceId, JSON.stringify(journeySteps));
    const insInbox = this.h.sqlite.prepare(
      `INSERT INTO npc_sim_inbox (npc_id, space_id, text) VALUES (?, ?, ?)`,
    );
    for (const text of inbox) insInbox.run(captainId, this.spaceId, text);
  }

  simNodes(captainId: CaptainId): SimNodeRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_sim_nodes WHERE space_id = ? AND npc_id = ? ORDER BY rowid ASC`)
      .all(this.spaceId, captainId) as NodeDbRow[];
    return rows.map((r) => ({
      id: r.id, theme: r.theme, title: r.title, pointsTo: r.points_to as CaptainWorld,
      ageDays: r.age_days, due: r.due, reviews: r.reviews, resurfaces: r.resurfaces, tended: r.tended,
    }));
  }

  simNode(captainId: CaptainId, nodeId: string): SimNodeRow | null {
    return this.simNodes(captainId).find((n) => n.id === nodeId) ?? null;
  }

  patchSimNode(captainId: CaptainId, nodeId: string, patch: Partial<SimNodeRow>): void {
    const cur = this.simNode(captainId, nodeId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.h.sqlite
      .prepare(
        `UPDATE npc_sim_nodes SET due = ?, reviews = ?, resurfaces = ?, tended = ?
         WHERE space_id = ? AND npc_id = ? AND id = ?`,
      )
      .run(next.due, next.reviews, next.resurfaces, next.tended, this.spaceId, captainId, nodeId);
  }

  simEdges(captainId: CaptainId): { a: string; b: string }[] {
    return this.h.sqlite
      .prepare(`SELECT a, b FROM npc_sim_edges WHERE space_id = ? AND npc_id = ? ORDER BY a, b`)
      .all(this.spaceId, captainId) as { a: string; b: string }[];
  }

  addSimEdge(captainId: CaptainId, a: string, b: string): void {
    const [x, y] = a < b ? [a, b] : [b, a];
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO npc_sim_edges (npc_id, space_id, a, b) VALUES (?, ?, ?, ?)`)
      .run(captainId, this.spaceId, x, y);
  }

  /** The first unlinked pair of her nodes, if one exists. */
  linkablePair(captainId: CaptainId): { a: SimNodeRow; b: SimNodeRow } | null {
    const nodes = this.simNodes(captainId);
    const edges = new Set(this.simEdges(captainId).map((e) => `${e.a}|${e.b}`));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (!edges.has(key)) return { a, b };
      }
    }
    return null;
  }

  journeyOf(captainId: CaptainId): { stepIndex: number; progress: number; steps: SimJourneyStep[] } {
    const r = this.h.sqlite
      .prepare(`SELECT step_index, progress, steps FROM npc_sim_journey WHERE space_id = ? AND npc_id = ?`)
      .get(this.spaceId, captainId) as { step_index: number; progress: number; steps: string } | undefined;
    if (!r) return { stepIndex: 0, progress: 0, steps: [] };
    return { stepIndex: r.step_index, progress: r.progress, steps: JSON.parse(r.steps) as SimJourneyStep[] };
  }

  advanceJourney(captainId: CaptainId): void {
    this.h.sqlite
      .prepare(
        `UPDATE npc_sim_journey SET step_index = step_index + 1, progress = progress + 1 WHERE space_id = ? AND npc_id = ?`,
      )
      .run(this.spaceId, captainId);
  }

  bumpJourneyProgress(captainId: CaptainId): void {
    this.h.sqlite
      .prepare(`UPDATE npc_sim_journey SET progress = progress + 1 WHERE space_id = ? AND npc_id = ?`)
      .run(this.spaceId, captainId);
  }

  inboxDepth(captainId: CaptainId): number {
    const r = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_sim_inbox WHERE space_id = ? AND npc_id = ? AND processed = 0`)
      .get(this.spaceId, captainId) as { c: number };
    return r.c;
  }

  processInbox(captainId: CaptainId): void {
    this.h.sqlite
      .prepare(`UPDATE npc_sim_inbox SET processed = 1 WHERE space_id = ? AND npc_id = ? AND processed = 0`)
      .run(this.spaceId, captainId);
  }

  // --- C5: her commission board ---

  commissionsOf(captainId: CaptainId): CommissionRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_commissions WHERE space_id = ? AND npc_id = ? ORDER BY id ASC`)
      .all(this.spaceId, captainId) as (CommissionDbRow & { npc_id: string })[];
    return rows.map((r) => this.toCommission(r));
  }

  commissionById(id: number): CommissionRow | null {
    const r = this.h.sqlite
      .prepare(`SELECT * FROM npc_commissions WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as (CommissionDbRow & { npc_id: string }) | undefined;
    return r ? this.toCommission(r) : null;
  }

  private toCommission(r: CommissionDbRow & { npc_id: string }): CommissionRow {
    return {
      id: r.id, captainId: r.npc_id as CaptainId, kind: r.kind, state: r.state,
      steps: JSON.parse(r.steps) as CommissionStep[], currentStep: r.current_step,
      payment: r.payment, createdLogId: r.created_log_id, completedLogId: r.completed_log_id,
      createdAt: r.created_at,
    };
  }

  createCommission(captainId: CaptainId, kind: string, steps: CommissionStep[], nowMs: number): CommissionRow {
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_commissions (npc_id, space_id, kind, state, steps, created_at, updated_at)
         VALUES (?, ?, ?, 'offered', ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, kind, JSON.stringify(steps), new Date(nowMs).toISOString(), new Date(nowMs).toISOString());
    return this.commissionById(Number(res.lastInsertRowid))!;
  }

  patchCommission(id: number, patch: Partial<CommissionRow>, nowMs: number): void {
    const cur = this.commissionById(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.h.sqlite
      .prepare(
        `UPDATE npc_commissions SET state = ?, steps = ?, current_step = ?, payment = ?, created_log_id = ?, completed_log_id = ?, updated_at = ?
         WHERE space_id = ? AND id = ?`,
      )
      .run(
        next.state, JSON.stringify(next.steps), next.currentStep, next.payment,
        next.createdLogId, next.completedLogId, new Date(nowMs).toISOString(), this.spaceId, id,
      );
  }

  completedCommissionCount(captainId: CaptainId): number {
    const r = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM npc_commissions WHERE space_id = ? AND npc_id = ? AND state = 'completed'`)
      .get(this.spaceId, captainId) as { c: number };
    return r.c;
  }

  // --- C9: gate decision records (beside the npc_gate permanence) ---

  recordGateDecision(
    captainId: CaptainId,
    decision: "open" | "unmet",
    holdingIds: string[],
    missing: string | null,
    logId: number | null,
    nowMs: number,
  ): GateDecisionRow {
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_gate_decisions (npc_id, space_id, decision, holding_ids, missing, log_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(captainId, this.spaceId, decision, JSON.stringify(holdingIds), missing, logId, new Date(nowMs).toISOString());
    return {
      id: Number(res.lastInsertRowid), decision, holdingIds, missing, logId,
      createdAt: new Date(nowMs).toISOString(),
    };
  }

  gateDecisionsOf(captainId: CaptainId): GateDecisionRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM npc_gate_decisions WHERE space_id = ? AND npc_id = ? ORDER BY id ASC`)
      .all(this.spaceId, captainId) as {
      id: number; decision: string; holding_ids: string; missing: string | null;
      log_id: number | null; created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id, decision: r.decision as "open" | "unmet",
      holdingIds: JSON.parse(r.holding_ids) as string[], missing: r.missing,
      logId: r.log_id, createdAt: r.created_at,
    }));
  }

  latestGateDecision(captainId: CaptainId): GateDecisionRow | null {
    const all = this.gateDecisionsOf(captainId);
    return all[all.length - 1] ?? null;
  }

  // --- C11: the completed memory stream ---

  /** A P2 stream entry: full provenance (origin log event, source,
   *  experienced flag), retention enforced, on her stream only. */
  writePurposeMemory(
    captainId: CaptainId,
    kind: CaptainMemoryEntry["kind"],
    text: string,
    importance: number,
    tags: string[],
    originLogId: number | null,
    nowMs: number,
  ): CaptainMemoryEntry {
    const entry = this.captains().addMemory(captainId, kind, text, importance, tags, nowMs, {
      originLogId,
      source: "firsthand",
      experienced: true,
    });
    this.enforceRetention(captainId);
    return entry;
  }

  /** Retention (spec §6.2): newest 500 + every importance ≥ 8. */
  enforceRetention(captainId: CaptainId): void {
    this.h.sqlite
      .prepare(
        `DELETE FROM npc_player_memory
         WHERE space_id = ? AND npc_id = ? AND importance < ?
           AND id NOT IN (
             SELECT id FROM npc_player_memory
             WHERE space_id = ? AND npc_id = ? ORDER BY id DESC LIMIT ?
           )`,
      )
      .run(this.spaceId, captainId, CAPTAIN_MEMORY_KEEP_IMPORTANCE, this.spaceId, captainId, CAPTAIN_MEMORY_RETENTION);
  }

  /** Reflection-lite (spec §6.2): at the importance trigger, a
   *  template summary of HER OWN acts — counts from the log (the
   *  authoritative record), never lore, beliefs, or anyone else. */
  maybeReflect(captainId: CaptainId, nowMs: number): CaptainMemoryEntry | null {
    const repo = this.captains();
    const entries = repo.memory(captainId, undefined, 100_000);
    const lastSummary = [...entries].reverse().find((e) => e.kind === "summary");
    const since = lastSummary ? entries.filter((e) => e.id > lastSummary.id) : entries;
    const sum = since.reduce((a, e) => a + e.importance, 0);
    if (sum < CAPTAIN_REFLECTION_TRIGGER) return null;
    const log = this.npc().recentLog(captainId, 100_000);
    const searches = log.filter((e) => e.kind === "search").length;
    const finds = log.filter((e) => e.kind === "search" && e.act.startsWith("Found")).length;
    const held = this.npc().holdings(captainId).length;
    const decision = this.latestGateDecision(captainId);
    const gateLine = decision
      ? decision.decision === "open"
        ? "the gate stands open for her"
        : `the gate still closed — missing ${decision.missing ?? "what the shape requires"}`
      : "the gate question not yet asked";
    const text =
      `Reflection: ${searches} searches made, ${finds} of them finds; ${held} relics held from her own pool; ${gateLine}.`;
    return repo.addMemory(captainId, "summary", text, 5, ["reflection"], nowMs, {
      originLogId: null,
      source: "firsthand",
      experienced: true,
    });
  }

  // --- C5 event wiring: completion is by real acts only ---

  /** An act of hers really executed (its log event landed): open
   *  commissions advance/complete from it, offered commissions
   *  whose target resolved another way close as superseded, and
   *  her sim journey advances when the act is its current step.
   *  Narration, plan membership, and other captains' acts are
   *  filtered by the caller passing HER events only — and this
   *  method double-checks the captain key on every row it touches. */
  onActEvent(
    captainId: CaptainId,
    event: { kind: string; world?: CaptainWorld | null; logId: number; deed?: DeedKind | null; nodeId?: string | null },
    nowMs: number,
  ): void {
    const matches = (step: CommissionStep): boolean => {
      if (step.kind === "travel") return event.kind === "arrive" && event.world === step.world;
      if (step.kind === "review") return event.deed === "review" && (!step.nodeId || event.nodeId === step.nodeId);
      if (step.kind === "link") return event.deed === "link";
      if (step.kind === "inbox") return event.deed === "tend";
      if (step.kind === "deed") return event.deed === step.deed;
      return false;
    };

    let journeyAdvancedByCommission = false;
    for (const c of this.commissionsOf(captainId)) {
      if (c.state === "open") {
        const step = c.steps[c.currentStep];
        if (step && matches(step)) {
          const isFinal = c.currentStep + 1 >= c.steps.length;
          if (c.kind === "journey") {
            this.advanceJourney(captainId);
            journeyAdvancedByCommission = true;
          }
          if (step.kind === "inbox") this.processInbox(captainId);
          if (!isFinal) {
            this.patchCommission(c.id, { currentStep: c.currentStep + 1 }, nowMs);
          } else {
            // Final step: the board pays on HER NPC ledger only,
            // under the diminishing anti-farm shape — the n-th
            // completion pays max(0, 12 − 2n), so a trivial loop
            // is worth nothing by the seventh completion (§6.4).
            const prior = this.completedCommissionCount(captainId);
            const payment = Math.max(0, 12 - 2 * prior);
            this.patchCommission(
              c.id,
              { state: "completed", currentStep: c.currentStep + 1, payment, completedLogId: event.logId },
              nowMs,
            );
            if (payment > 0) {
              const repo = this.captains();
              const st = repo.state(captainId);
              if (st) repo.update(captainId, { credits: st.credits + payment });
            }
            this.npc().appendLog(
              captainId,
              "commission",
              payment > 0
                ? `Completed a commission (${c.kind}) — paid ${payment} Credits on her own ledger.`
                : `Completed a commission (${c.kind}) — no further payment; the board's shape diminishes repeat work to nothing.`,
              "The commission's final step completed from the underlying act's log event — completion is by real acts only.",
              nowMs,
            );
          }
        }
      } else if (c.state === "offered") {
        const step = c.steps[c.currentStep];
        if (step && matches(step)) {
          this.patchCommission(c.id, { state: "superseded" }, nowMs);
          this.npc().appendLog(
            captainId,
            "commission",
            "A commission offer closed as superseded — its work was done another way.",
            "Expiry is by events, not decay: the underlying state resolved outside the commission, so the offer closed with its cause logged.",
            nowMs,
          );
        }
      }
    }

    // Her sim journey advances on its own acts too (the board
    // observes the journey; the journey is C4 state, not board
    // state) — once per event, whichever path advanced it.
    if (!journeyAdvancedByCommission) {
      const journey = this.journeyOf(captainId);
      const step = journey.steps[journey.stepIndex];
      if (step) {
        const hit =
          (step.kind === "travel" && event.kind === "arrive" && event.world === step.world) ||
          (step.kind === "deed" && event.deed === step.deed);
        if (hit) this.advanceJourney(captainId);
      }
    }
  }
}

// --- shared derivations ---

function worldName(world: CaptainWorld): string {
  return captainDefinition("veyra") && world === "scale"
    ? "Scale"
    : world === "great-station"
      ? "the Great Station"
      : world;
}

/** Which node a deed verb would touch, by the Duty reading of the
 *  spec: Review first (due work clears), then the oldest
 *  ≥365-day node for Resurface, then any unlinked pair for Link,
 *  then any node for Tend. Shared by the executor (to act) and the
 *  world-state derivation (to plan): the planner must see the same
 *  brain the executor will. */
export function pickDeedNode(
  store: PurposeStore,
  captainId: CaptainId,
  deed: DeedKind,
  currentWorld: CaptainWorld,
): { node: SimNodeRow } | { pair: { a: SimNodeRow; b: SimNodeRow } } | null {
  const nodes = store.simNodes(captainId);
  if (deed === "review") {
    const node = nodes.find((n) => n.due > 0);
    return node ? { node } : null;
  }
  if (deed === "resurface") {
    const old = nodes
      .filter((n) => n.ageDays >= 365)
      .sort((a, b) => b.ageDays - a.ageDays || (a.id < b.id ? -1 : 1));
    const node = old.find((n) => n.pointsTo !== currentWorld) ?? old[0];
    return node ? { node } : null;
  }
  if (deed === "link") {
    const pair = store.linkablePair(captainId);
    return pair ? { pair } : null;
  }
  const node = nodes[0];
  return node ? { node } : null;
}

/** The planner's view of her world, computed from the single
 *  sources of truth: holdings (NPC rangeset), gate (npc_gate),
 *  stirrings (C13), the sim brain (C4), the board (C5), her state
 *  row (fuel/home/position). Never from another captain's rows and
 *  never from the player's brain or pool — the P-5 isolation
 *  property depends on this list being exactly these tables. */
export function worldStateFor(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  state: CaptainStateRow,
): CaptainWorldState {
  const store = new PurposeStore(h, spaceId);
  const npc = new NpcRepo(h, spaceId);
  store.ensureSimBrain(captainId);
  const holdings = npc.holdings(captainId);
  const nodes = store.simNodes(captainId);
  const currentWorld = state.currentWorld ?? state.homeWorld;
  const duePick = pickDeedNode(store, captainId, "review", currentWorld);
  const oldPick = pickDeedNode(store, captainId, "resurface", currentWorld);
  const deedTarget =
    (duePick && "node" in duePick ? duePick.node.pointsTo : null) ??
    (oldPick && "node" in oldPick ? oldPick.node.pointsTo : null) ??
    nodes[0]?.pointsTo ??
    null;
  return {
    world: currentWorld,
    stirrings: store.activeStirrings(captainId).map((s) => s.world),
    holdings: holdings.length,
    hasWitness: holdings.includes(NPC_GATE_KEY_RELIC),
    gateOpen: npc.gateOpen(captainId),
    dueDeed: nodes.some((n) => n.due > 0),
    oldNode: nodes.some((n) => n.ageDays >= 365),
    linkable: store.linkablePair(captainId) !== null,
    deedRaisesAt: deedTarget,
    fuel: state.fuel,
    priorNoFinds: store.noFindCount(captainId),
    homeWorld: state.homeWorld,
  };
}

// --- the deed acts (C4 + C13) ---

export interface DeedResult {
  logId: number;
  nodeId: string;
  stirring: StirringRow | null;
}

/** Execute one of her four Duty verbs on her simulated brain.
 *  The state write, the stirring raise, the memory, and any board
 *  completion all ride the act's own log event (one transaction —
 *  the caller's). The order matters: the budgeted act lands first,
 *  so a spent budget changes nothing at all. */
export function executeDeedAct(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  deed: DeedKind,
  nowMs: number,
  exec: PurposeExec,
): DeedResult | { blocked: string } {
  const def = captainDefinition(captainId);
  if (!def) return { blocked: "unknown captain" };
  admitPurposeAct(def, "deed");
  const store = new PurposeStore(h, spaceId);
  store.ensureSimBrain(captainId);
  const state = exec.state();
  const currentWorld = state.currentWorld ?? state.homeWorld;
  const pick = pickDeedNode(store, captainId, deed, currentWorld);
  if (!pick) return { blocked: `no ${deed} work on her simulated brain right now` };

  let act: string;
  let nodeId: string;
  let pointsTo: CaptainWorld;
  if ("pair" in pick) {
    act = `Linked two of her own nodes — "${pick.pair.a.title}" and "${pick.pair.b.title}".`;
    nodeId = pick.pair.a.id;
    pointsTo = pick.pair.a.pointsTo;
  } else {
    nodeId = pick.node.id;
    pointsTo = pick.node.pointsTo;
    act =
      deed === "review"
        ? `Reviewed a due card on her own brain — "${pick.node.title}".`
        : deed === "resurface"
          ? `Resurfaced an old memory of her own — "${pick.node.title}", ${pick.node.ageDays} days old.`
          : `Tended her own brain — "${pick.node.title}".`;
  }
  const cause =
    "Her Duty verb runs on her simulated brain by design — a captain's deeds and stirrings live in her own namespace and never touch a real brain.";
  const entry = exec.logAct("deed", act, cause, nowMs);
  if (!entry) return { blocked: "the day's act budget is spent" };

  if ("pair" in pick) {
    store.addSimEdge(captainId, pick.pair.a.id, pick.pair.b.id);
  } else if (deed === "review") {
    store.patchSimNode(captainId, nodeId, { due: 0, reviews: pick.node.reviews + 1 });
  } else if (deed === "resurface") {
    store.patchSimNode(captainId, nodeId, { resurfaces: pick.node.resurfaces + 1 });
  } else if (deed === "tend") {
    store.patchSimNode(captainId, nodeId, { tended: pick.node.tended + 1 });
    store.bumpJourneyProgress(captainId);
  }

  // A deed may raise a stirring (C13): the node points at a world;
  // if she has no active stirring for that world, the deed raises
  // one, sourced to this deed's log event.
  const had = store.stirringAt(captainId, pointsTo) !== null;
  const stirring = store.raiseStirring(captainId, pointsTo, entry.id, nowMs);
  store.writePurposeMemory(
    captainId,
    "outcome",
    had
      ? `${act} A stirring for ${worldName(pointsTo)} already stood on her record.`
      : `${act} It raised a stirring for ${worldName(pointsTo)} on her record.`,
    CAPTAIN_ROUTINE_IMPORTANCE,
    [currentWorld, deed],
    entry.id,
    nowMs,
  );
  store.onActEvent(captainId, { kind: "deed", logId: entry.id, deed, nodeId }, nowMs);
  return { logId: entry.id, nodeId, stirring };
}

// --- the Search Act (C7 + C8) ---

export type SearchResult =
  | { outcome: "find" | "no-find"; relicId?: string; consumed?: boolean; logId: number; stirringId: number; blocked?: undefined }
  | { blocked: string; outcome?: undefined; relicId?: undefined; consumed?: undefined; logId?: undefined; stirringId?: undefined };

/** Search the world her active stirring names. C7 limited
 *  knowledge: the outcome is a pure function of her scoped supply
 *  (the world's relics she does not hold) and the seeded draw —
 *  no other table is consulted, so no player state, no other
 *  captain's state, and no geography elsewhere can move it
 *  (proven by the S-1 elsewhere fixture). A find writes ONLY her
 *  NPC holdings row (D-POOL) and resolves HER stirring. */
export function executeSearchAct(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
  branch: "find-branch" | "two-branch" = "two-branch",
): SearchResult {
  const def = captainDefinition(captainId);
  if (!def) return { blocked: "unknown captain" };
  admitPurposeAct(def, "search");
  const store = new PurposeStore(h, spaceId);
  const npc = new NpcRepo(h, spaceId);
  const state = exec.state();
  const world = state.currentWorld ?? state.homeWorld;
  const stirring = store.stirringAt(captainId, world);
  if (!stirring) return { blocked: "no active stirring names this world" };

  const held = npc.holdings(captainId);
  const supply = RELICS.filter((r) => r.world === world && !held.includes(r.id));
  const draw = exec.searchDraw?.(captainId, stirring.id) ?? searchDrawFor(captainId, stirring.id, stirring.attempts);
  const willFind = supply.length > 0 && draw < CAPTAIN_SEARCH_FIND_PROBABILITY;
  const relic = willFind ? supply[0]! : null;
  const consumed = relic?.tierClass === "seed";

  const act = relic
    ? consumed
      ? `Found ${relic.name} at ${worldName(world)} — a Seed; it was consumed in the finding, as Seeds are.`
      : `Found ${relic.name} at ${worldName(world)} — it joins her own holdings.`
    : `Searched ${worldName(world)} for the stirring and found nothing.`;
  const cause =
    "A search reads only her NPC-scoped supply and the seeded draw — never the player's pool, stirrings, or promised copies (ruling D-POOL).";
  const entry = exec.logAct("search", act, cause, nowMs);
  if (!entry) return { blocked: "the day's act budget is spent" };

  if (relic) {
    if (!consumed) npc.addHolding(captainId, relic.id, world, nowMs);
    store.resolveStirring(stirring.id, "find", relic.id, nowMs);
    store.addKnowledge(
      captainId,
      `Found ${relic.name} at ${worldName(world)}.`,
      "firsthand",
      "certain",
      entry.id,
      nowMs,
    );
    store.writePurposeMemory(
      captainId, "outcome", act, CAPTAIN_FIND_IMPORTANCE, [world, "search", "find"], entry.id, nowMs,
    );
    store.maybeReflect(captainId, nowMs);
    return { outcome: "find", relicId: relic.id, consumed, logId: entry.id, stirringId: stirring.id };
  }

  store.addKnowledge(
    captainId,
    `Searched ${worldName(world)} for a stirring and nothing found (attempt ${stirring.attempts + 1}).`,
    "firsthand",
    "certain",
    entry.id,
    nowMs,
  );
  store.writePurposeMemory(
    captainId, "outcome", act, CAPTAIN_ROUTINE_IMPORTANCE, [world, "search"], entry.id, nowMs,
  );
  if (branch === "find-branch") {
    store.resolveStirring(stirring.id, "no-find", null, nowMs);
  } else {
    store.bumpStirringAttempt(stirring.id);
  }
  return { outcome: "no-find", logId: entry.id, stirringId: stirring.id };
}

// --- the gate check (C9) ---

/** Ask the gate question from HER holdings, via the one B-01
 *  composition rule. An open decision marks the durable npc_gate
 *  row (permanent, per P1); the decision itself is recorded either
 *  way, with its missing computed by the same rule. */
export function executeGateCheck(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
): GateDecisionRow {
  const def = captainDefinition(captainId);
  if (!def) throw new PurposeError("UNKNOWN_CAPTAIN", 404, "unknown captain");
  admitPurposeAct(def, "gate-check");
  const store = new PurposeStore(h, spaceId);
  const npc = new NpcRepo(h, spaceId);
  const holdingIds = npc.holdings(captainId);
  const alreadyOpen = npc.gateOpen(captainId);
  const check = checkNpcEternityGate(holdingIds, alreadyOpen);
  const missing = check.open
    ? null
    : !check.hasKey
      ? "the Witness"
      : check.othersNeeded === 1
        ? "one more relic"
        : `${check.othersNeeded} more relics`;
  const act = check.open
    ? "Asked the gate question — the answer is open: she holds the Witness and two others, all from her own pool."
    : `Asked the gate question — unmet: missing ${missing}.`;
  const cause =
    "The gate rule is the player's own composition rule — the Witness plus any two — computed from her holdings and nothing else.";
  const entry = exec.logAct("gate-check", act, cause, nowMs);
  if (!entry) throw new PurposeError("BUDGET", 429, "The day's act budget is spent; the gate question waits.");
  if (check.open && !alreadyOpen) npc.markGateOpen(captainId);
  const decision = store.recordGateDecision(captainId, check.open ? "open" : "unmet", holdingIds, missing, entry.id, nowMs);
  store.writePurposeMemory(
    captainId, "milestone", act, CAPTAIN_GATE_IMPORTANCE, ["gate"], entry.id, nowMs,
  );
  return decision;
}

/** Attempt passage on an already-open decision. Passage is
 *  refused outright when her decision is not open — the fence is
 *  the gate record itself, checked before any leg machinery. */
export function attemptGatePassage(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  to: CaptainWorld,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  const def = captainDefinition(captainId);
  if (!def) throw new PurposeError("UNKNOWN_CAPTAIN", 404, "unknown captain");
  admitPurposeAct(def, "gate-passage", to);
  const npc = new NpcRepo(h, spaceId);
  if (!npc.gateOpen(captainId)) {
    throw new PurposeError("FENCE_REFUSAL", 403, "Gate passage refused — her gate decision is not open.");
  }
  const state = exec.state();
  const kind: CaptainLegKind = state.fuel >= 30 ? "warp" : "drift";
  return exec.openLeg(
    to,
    kind,
    "Passage, attempted only because her own gate decision stands open — the record, not a belief, is what lets her travel.",
    nowMs,
  );
}

// --- the board: generation + acceptance (C5) ---

/** The board's generation reads HER simulated brain and HER state:
 *  the next uncompleted journey step, due review cards, unlinked
 *  pairs, inbox depth — priority journey → review → link → inbox.
 *  An outstanding offered or open commission is returned as-is, so
 *  generation is idempotent (one live commission at a time). */
export function generateCommissionOffer(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
): CommissionRow | null {
  const store = new PurposeStore(h, spaceId);
  store.ensureSimBrain(captainId);
  const existing = store.commissionsOf(captainId).find((c) => c.state === "offered" || c.state === "open");
  if (existing) return existing;
  const state = new CaptainRepo(h, spaceId).state(captainId);
  if (!state) return null;

  const journey = store.journeyOf(captainId);
  const remaining = journey.steps.slice(journey.stepIndex);
  const nextJourney = remaining[0];
  if (nextJourney && nextJourney.kind === "travel" && nextJourney.world && nextJourney.world !== state.currentWorld) {
    const steps: CommissionStep[] = remaining.map((s) =>
      s.kind === "travel"
        ? { kind: "travel", world: s.world, label: s.label }
        : { kind: "deed", deed: s.deed, label: s.label },
    );
    return store.createCommission(captainId, "journey", steps, nowMs);
  }
  const dueNode = store.simNodes(captainId).find((n) => n.due > 0);
  if (dueNode) {
    return store.createCommission(
      captainId,
      "review",
      [{ kind: "review", nodeId: dueNode.id, label: `Review the due card "${dueNode.title}"` }],
      nowMs,
    );
  }
  const pair = store.linkablePair(captainId);
  if (pair) {
    return store.createCommission(
      captainId,
      "link",
      [{ kind: "link", label: `Link "${pair.a.title}" and "${pair.b.title}"` }],
      nowMs,
    );
  }
  const depth = store.inboxDepth(captainId);
  if (depth > 0) {
    return store.createCommission(
      captainId,
      "inbox",
      [{ kind: "inbox", label: `Clear ${depth} unprocessed inbox item(s) by tending her brain` }],
      nowMs,
    );
  }
  return null;
}

export function acceptCommission(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  commissionId: number,
  nowMs: number,
  exec: PurposeExec,
): CommissionRow | null {
  const def = captainDefinition(captainId);
  if (!def) return null;
  admitPurposeAct(def, "commission");
  const store = new PurposeStore(h, spaceId);
  const row = store.commissionById(commissionId);
  if (!row || row.captainId !== captainId || row.state !== "offered") return null;
  const entry = exec.logAct(
    "commission",
    `Took a commission: ${row.steps[0]?.label ?? row.kind}.`,
    "Decision points accept a commission when its work aligns with the active plan — the board never interrupts a plan's next step.",
    nowMs,
  );
  if (!entry) return null;
  store.patchCommission(commissionId, { state: "open", createdLogId: entry.id }, nowMs);
  return store.commissionById(commissionId);
}

// --- C11 retrieval: salience-scored, traced (read-only) ---

export interface RetrievalTrace {
  entryId: number;
  score: number;
  recency: number;
  importance: number;
  relevance: number;
}

/** Scored retrieval over HER stream: score = α·recency + β·(imp/10)
 *  + γ·(tag overlap), recency = 0.995^(age in hours). The seeker
 *  weights relevance highest — she is looking for what bears on
 *  her current bearing. The trace is returned with the entries so
 *  the ranking is inspectable, not magical. Read-only. */
export function retrieveCaptainMemories(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  context: { tags: string[]; nowMs: number; limit?: number },
): { entries: CaptainMemoryEntry[]; trace: RetrievalTrace[] } {
  const def = captainDefinition(captainId);
  const weights = def?.role === "Seeker" ? { a: 0.25, b: 0.3, g: 0.45 } : { a: 0.4, b: 0.35, g: 0.25 };
  const all = new CaptainRepo(h, spaceId).memory(captainId, undefined, 100_000);
  const tags = new Set(context.tags);
  const scored = all.map((entry) => {
    const ageHours = Math.max(0, (context.nowMs - new Date(entry.createdAt).getTime()) / 3_600_000);
    const recency = Math.pow(0.995, ageHours);
    const importance = entry.importance / 10;
    const overlap = entry.tags.filter((t) => tags.has(t)).length;
    const relevance = tags.size === 0 ? 0 : overlap / tags.size;
    const score = weights.a * recency + weights.b * importance + weights.g * relevance;
    return { entry, trace: { entryId: entry.id, score, recency, importance, relevance } };
  });
  scored.sort((x, y) => y.trace.score - x.trace.score || y.entry.id - x.entry.id);
  const limit = context.limit ?? 10;
  const top = scored.slice(0, limit);
  return { entries: top.map((s) => s.entry), trace: top.map((s) => s.trace) };
}

// --- wire views (Arch §5.1 derived lines) ---

export function captainPlanView(h: DbHandle, spaceId: string, captainId: CaptainId): CaptainPlanView | null {
  const store = new PurposeStore(h, spaceId);
  const plan = store.activePlan(captainId);
  if (!plan) return null;
  return {
    goalId: plan.goalId,
    goalText: plan.goalText,
    version: plan.version,
    state: plan.state,
    steps: store.stepsOf(plan.id).map((s) => ({
      kind: s.kind,
      label: s.label,
      expected: s.expected,
      state: s.state as CaptainPlanView["steps"][number]["state"],
      observed: s.observed,
    })),
  };
}

export function captainGateView(h: DbHandle, spaceId: string, captainId: CaptainId): CaptainGateView {
  const npc = new NpcRepo(h, spaceId);
  const holdings = npc.holdings(captainId);
  const gateIsOpen = npc.gateOpen(captainId);
  const check = checkNpcEternityGate(holdings, gateIsOpen);
  const store = new PurposeStore(h, spaceId);
  const latest = store.latestGateDecision(captainId);
  const line = check.open
    ? "The gate stands open for her — the Witness and two others, all from her own pool."
    : check.hasKey
      ? `${holdings.length} of the gate's shape held; ${check.othersNeeded === 1 ? "one more relic is" : `${check.othersNeeded} more relics are`} still needed.`
      : `${holdings.length} of the gate's shape held; the Witness is missing.`;
  return {
    heldCount: holdings.length,
    hasWitness: check.hasKey,
    decision: latest?.decision ?? null,
    missing: latest?.missing ?? (check.open ? null : check.hasKey ? "more relics" : "the Witness"),
    line,
  };
}

// --- reset (§6.2: the same lifecycle as the player's) ---

const P2_CAPTAIN_TABLES = [
  "npc_plans",
  "npc_plan_steps",
  "npc_mismatches",
  "npc_stirrings",
  "npc_sim_nodes",
  "npc_sim_edges",
  "npc_sim_journey",
  "npc_sim_inbox",
  "npc_commissions",
  "npc_knowledge",
  "npc_gate_decisions",
] as const;

/** The targeted reset: wipes ONLY her rows across the framework's
 *  tables and the P2 stores, then logs the reset on the shared log
 *  (the log itself is history and survives — the reset line marks
 *  the fresh start). */
export function resetCaptainPurpose(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
): void {
  for (const t of P2_CAPTAIN_TABLES) {
    h.sqlite.prepare(`DELETE FROM ${t} WHERE space_id = ? AND npc_id = ?`).run(spaceId, captainId);
  }
  h.sqlite
    .prepare(`DELETE FROM npc_player_memory WHERE space_id = ? AND npc_id = ?`)
    .run(spaceId, captainId);
  h.sqlite
    .prepare(`DELETE FROM npc_player_barks WHERE space_id = ? AND npc_id = ?`)
    .run(spaceId, captainId);
  h.sqlite
    .prepare(`DELETE FROM npc_relic_holdings WHERE space_id = ? AND npc_id = ?`)
    .run(spaceId, captainId);
  h.sqlite.prepare(`DELETE FROM npc_gate WHERE space_id = ? AND npc_id = ?`).run(spaceId, captainId);
  h.sqlite
    .prepare(`DELETE FROM npc_player_state WHERE space_id = ? AND npc_id = ?`)
    .run(spaceId, captainId);
  const def = captainDefinition(captainId);
  new NpcRepo(h, spaceId).appendLog(
    captainId,
    "wait",
    `Reset ${def?.name ?? captainId} entirely.`,
    "The owner reset this captain: her P2 stores, holdings, gate record, memory, and state were wiped; her next advance starts her fresh — the same lifecycle as a player's brain reset (§6.2).",
    nowMs,
  );
}

// --- arrivals (called from the engine's resolveArrival) ---

/** An arrival closes the plan step the leg was serving, completes
 *  her open board step through the act-event rule, and advances
 *  her sim journey — all keyed to the arrival's log event. */
export function onPurposeArrival(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  world: CaptainWorld,
  arrivalLogId: number | null,
  nowMs: number,
): void {
  const store = new PurposeStore(h, spaceId);
  const plan = store.activePlan(captainId);
  if (plan && plan.state === "active") {
    const steps = store.stepsOf(plan.id);
    const next = steps.find((s) => s.state === "open");
    if (
      next &&
      (next.kind === "warp" || next.kind === "drift" || next.kind === "go-home" || next.kind === "attempt-gate-passage") &&
      (next.params.world as string | null) === world
    ) {
      store.completeStep(next.id, `arrival at ${worldName(world)}`, arrivalLogId, nowMs);
      const after = store.stepsOf(plan.id);
      if (after.every((s) => s.state !== "open")) {
        store.closePlan(plan.id, plan.goalId === GATE_GOAL_ID && after.some((s) => s.kind === "attempt-gate-passage") ? "completed" : "completed-travel");
      }
    }
  }
  store.onActEvent(captainId, { kind: "arrive", world, logId: arrivalLogId ?? 0 }, nowMs);
}

// --- the decision-point driver (Arch §4.3 rule order) ---

function logPlanBuilt(
  exec: PurposeExec,
  plan: PlanRow,
  steps: PlanStepRow[],
  cause: string,
  nowMs: number,
): void {
  const stepText = steps.map((s) => s.label).join(" → ");
  exec.logBookkeeping(
    "plan",
    `Plan v${plan.version} for "${plan.goalText}": ${stepText || "no route within depth — unplanned"}.`,
    cause,
    nowMs,
  );
}

/** Build (or rebuild) her plan for the gate goal from the current
 *  world state. Returns the plan row, or null when she has no
 *  reason to plan (no stirring, no holdings, gate already open
 *  with passage complete elsewhere). */
function buildPlan(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
  supersedesId: number | null,
  mismatchId: number | null,
  force = false,
): PlanRow | null {
  const store = new PurposeStore(h, spaceId);
  const state = exec.state();
  const ws = worldStateFor(h, spaceId, captainId, state);
  // The standing cause is a live stirring (or an open gate awaiting
  // its passage chain). `force` is the gate-decision chain (§5.2):
  // a decision was just recorded, so the next version is built
  // from the decision itself — its route will open with a deed
  // that raises the next stirring.
  if (!force && ws.stirrings.length === 0 && !ws.gateOpen) return null;
  const draft = planForGoal(ws, GATE_GOAL_ID);
  const draftSteps = "steps" in draft ? draft.steps : [];
  const plan = store.createPlan(
    captainId,
    GATE_GOAL_ID,
    GATE_GOAL_TEXT,
    draftSteps,
    supersedesId,
    mismatchId,
    nowMs,
    null,
  );
  logPlanBuilt(
    exec,
    plan,
    store.stepsOf(plan.id),
    supersedesId
      ? "A plan is rebuilt from the current world state when the world contradicts it — the goal never changes; only the route does (§5.2)."
      : "Her active stirring and holdings give the standing goal a route; the planner searched her world state for the shortest one.",
    nowMs,
  );
  return plan;
}

/** One purpose decision point (Arch §4.3):
 *   0. the board generates (bookkeeping);
 *   1. a plan is built when she has cause and none is active;
 *   2. an aligned journey commission is accepted (never
 *      interrupting the active plan's destination);
 *   3. the active plan's next open step executes;
 *   4. with no plan, Duty's standing order (review → resurface →
 *      link → tend) raises the next stirring;
 *   5. otherwise decline (false).
 *  Every path logs its own cause; a P2 act elsewhere would be the
 *  C-3 layering smell this ordering exists to prevent. */
export function runPurposeDecisionPoint(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  const def = captainDefinition(captainId);
  if (!def || !isPurposeCaptain(def)) return false;
  const store = new PurposeStore(h, spaceId);
  store.ensureSimBrain(captainId);

  // (0) board generation — bookkeeping; never consumes a point on
  // its own, but an existing offer feeds rule (2).
  generateCommissionOffer(h, spaceId, captainId, nowMs);

  let plan = store.activePlan(captainId);

  // (1) plan-build when she has cause. An unplanned draft is
  // recorded once and NOT rebuilt every point (that would spam
  // versions): only a stirring raised after it was recorded
  // re-opens planning — and free deeds (rule 4) are what raise
  // stirrings, so the loop always has a way forward.
  if (!plan) {
    const built = buildPlan(h, spaceId, captainId, nowMs, exec, null, null);
    if (built) return true; // the build spent this point (a "plan" act)
  } else if (plan.state === "unplanned") {
    const fresh = store.activeStirrings(captainId).some((st) => st.createdAt > plan!.createdAt);
    if (fresh) {
      store.closePlan(plan.id, "superseded");
      const built = buildPlan(h, spaceId, captainId, nowMs, exec, plan.id, null);
      if (built) return true;
    }
  }

  plan = store.activePlan(captainId);

  // (2) accept an aligned journey commission: it aligns when its
  // travel destination is the active plan's next travel step's
  // destination. Due-work commissions never pre-empt a plan.
  const offered = store.commissionsOf(captainId).find((c) => c.state === "offered");
  if (offered && offered.kind === "journey") {
    const travelStep = offered.steps[offered.currentStep];
    const planSteps = plan && plan.state === "active" ? store.stepsOf(plan.id) : [];
    const planTravel = planSteps.find(
      (s) => s.state === "open" && (s.kind === "warp" || s.kind === "drift" || s.kind === "go-home"),
    );
    const dueDeeds = planSteps.some((s) => s.state === "open" && s.kind !== "warp" && s.kind !== "drift" && s.kind !== "go-home");
    void dueDeeds;
    if (planTravel && travelStep?.world && (planTravel.params.world as string | null) === travelStep.world) {
      const accepted = acceptCommission(h, spaceId, captainId, offered.id, nowMs, exec);
      if (accepted) return true;
    }
  }

  // (3) follow the active plan's next open step.
  if (plan && plan.state === "active") {
    const steps = store.stepsOf(plan.id);
    const next = steps.find((s) => s.state === "open");
    if (!next) {
      store.closePlan(plan.id, "completed");
      return true;
    }
    return followPlanStep(h, spaceId, captainId, plan, next, nowMs, exec);
  }

  // (4) no plan: Duty's standing order.
  return runFreeDeed(h, spaceId, captainId, nowMs, exec);
}

function runFreeDeed(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  for (const deed of ["review", "resurface", "link", "tend"] as DeedKind[]) {
    const out = executeDeedAct(h, spaceId, captainId, deed, nowMs, exec);
    if (!("blocked" in out)) return true;
  }
  return false;
}

function followPlanStep(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  plan: PlanRow,
  step: PlanStepRow,
  nowMs: number,
  exec: PurposeExec,
): boolean {
  const store = new PurposeStore(h, spaceId);
  const state = exec.state();
  const currentWorld = state.currentWorld ?? state.homeWorld;
  const kind = step.kind;

  if (kind === "tend" || kind === "resurface" || kind === "review" || kind === "link") {
    const deed = (step.params.deed as DeedKind | null) ?? (kind as DeedKind);
    const out = executeDeedAct(h, spaceId, captainId, deed, nowMs, exec);
    if ("blocked" in out) {
      // R-5: the plan expected this deed to be executable; the
      // world says otherwise — a mismatch, a replan, both logged.
      replanFromMismatch(
        h, spaceId, captainId, plan, step,
        step.expected,
        `the deed could not run — ${out.blocked}`,
        null, null,
        "The world contradicted the plan's expectation; the plan replans from the contradiction (§5.1).",
        nowMs, exec,
      );
      return true;
    }
    store.completeStep(step.id, `the ${deed} deed executed on her simulated brain`, out.logId, nowMs);
    return true;
  }

  if (kind === "search") {
    const stirring = store.stirringAt(captainId, currentWorld);
    if (!stirring) {
      replanFromMismatch(
        h, spaceId, captainId, plan, step,
        step.expected,
        "no active stirring names this world — it resolved another way",
        null, null,
        "The stirring the search depended on is gone; the plan replans from the current world.",
        nowMs, exec,
      );
      return true;
    }
    const branch = (step.params.branch as "find-branch" | "two-branch" | undefined) ?? "two-branch";
    const out = executeSearchAct(h, spaceId, captainId, nowMs, exec, branch);
    if ("blocked" in out) return true; // budget spent: the day ends quietly, the plan waits
    if (out.outcome === "find") {
      store.completeStep(step.id, `a find at ${worldName(currentWorld)}`, out.logId, nowMs);
      return true;
    }
    if (branch === "find-branch") {
      replanFromMismatch(
        h, spaceId, captainId, plan, step,
        step.expected,
        `searched ${worldName(currentWorld)} and found nothing`,
        null, out.logId,
        `expected ${step.expected}, found nothing — a find-branch search came back empty: the plan's assumption was wrong, so the plan supersedes itself with a two-branch search (§4.4).`,
        nowMs, exec,
      );
      return true;
    }
    // Two-branch no-find: the step stays open by design; the
    // attempt is already on the stirring record.
    return true;
  }

  if (kind === "warp" || kind === "drift" || kind === "go-home") {
    const to = step.params.world as CaptainWorld | null;
    if (!to) return true;
    if (to === currentWorld) {
      store.completeStep(step.id, `already at ${worldName(to)}`, null, nowMs);
      return true;
    }
    const legKind: CaptainLegKind = kind === "go-home" ? "home" : kind;
    const opened = exec.openLeg(
      to,
      legKind,
      `The plan's next step is travel to ${worldName(to)} — the leg rides P1's leg model, never the player's journey service.`,
      nowMs,
    );
    return true || opened;
  }

  if (kind === "gate-check") {
    const out = executeGateCheck(h, spaceId, captainId, nowMs, exec);
    store.completeStep(
      step.id,
      out.decision === "open" ? "the gate answered open" : `the gate answered unmet — missing ${out.missing}`,
      out.logId,
      nowMs,
    );
    store.closePlan(plan.id, out.decision === "open" ? "completed-open" : "completed-unmet");
    // The same goal continues: passage steps when open, a fresh
    // route when unmet — the chain of versions is the readable
    // record of the long arc (§5.2).
    const next = buildPlan(h, spaceId, captainId, nowMs, exec, plan.id, null, true);
    void next;
    return true;
  }

  if (kind === "attempt-gate-passage") {
    const to = step.params.world as CaptainWorld | null;
    if (!to) return true;
    if (to === currentWorld) {
      store.completeStep(step.id, `already at ${worldName(to)}`, null, nowMs);
      const after = store.stepsOf(plan.id);
      if (after.every((s) => s.state !== "open")) store.closePlan(plan.id, "completed");
      return true;
    }
    attemptGatePassage(h, spaceId, captainId, to, nowMs, exec);
    return true;
  }

  // take-commission / complete-commission-step steps are board
  // bookkeeping handled by rules (0)/(2); a plan step of those
  // kinds never blocks the arc.
  store.completeStep(step.id, "handled by the board's own rules", null, nowMs);
  return true;
}

/** The R-5/R-7 replan path: record the mismatch (expected +
 *  observed from OUTSIDE the planner), close the old version as
 *  superseded, and insert v(n+1) under the same goal id, built
 *  from the CURRENT world state. */
function replanFromMismatch(
  h: DbHandle,
  spaceId: string,
  captainId: CaptainId,
  plan: PlanRow,
  step: PlanStepRow,
  expected: string,
  observed: string,
  expectedLogId: number | null,
  observedLogId: number | null,
  cause: string,
  nowMs: number,
  exec: PurposeExec,
): void {
  const store = new PurposeStore(h, spaceId);
  const mismatch = store.recordMismatch(
    captainId, plan.id, step.id, expected, observed, expectedLogId, observedLogId, cause, nowMs,
  );
  exec.logBookkeeping(
    "plan",
    `Mismatch on plan v${plan.version}: expected ${expected}; observed ${observed}. Replanning.`,
    cause,
    nowMs,
  );
  store.failStep(step.id, observed, observedLogId);
  const state = exec.state();
  const ws = worldStateFor(h, spaceId, captainId, state);
  const draft = planForGoal(ws, plan.goalId);
  const draftSteps = "steps" in draft ? draft.steps : [];
  const next = store.supersedePlan(captainId, plan.id, mismatch.id, draftSteps, nowMs, null);
  logPlanBuilt(exec, next, store.stepsOf(next.id), cause, nowMs);
}
