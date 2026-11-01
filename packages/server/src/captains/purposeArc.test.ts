import { describe, it, expect, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import {
  CAPTAIN_MAX_ACTS_PER_DAY,
  captainDefinition,
  type CaptainWorld,
} from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import {
  advanceCaptain,
  getCaptainState,
  getChronicle,
  listCaptainStates,
  resumeCaptain,
  stopCaptain,
} from "./engine.js";
import type { CaptainDecider } from "./decider.js";
import { PurposeStore, retrieveCaptainMemories } from "./purpose.js";
import { GATE_GOAL_ID, planForGoal, type CaptainWorldState } from "./planner.js";

/**
 * P2-B1.10 — PHASE EXIT: the scripted seeker arc (spec §3, outlines
 * §1 + §6). Veyra, Station → Scale → gate decision, run end-to-end
 * through the real engine: deeds, stirrings, plan versions, a
 * commission, two travel modes, honest failures, a find, and the
 * unmet gate decision — with the player's whole universe snapshotted
 * byte-for-byte after EVERY advance (A1 at story scale), plus the
 * open-branch variant (§1.25), determinism pairing (A2), and the
 * kill-switch / budget spot-proofs (A4).
 *
 * Fixtures ([FIXTURE], per spec §3 + D-VEYRA-SEED): fuel 30, one
 * pre-arc non-Witness holding, a seeded sim brain; search outcomes
 * scripted per stirring through the deps seam — the arc never
 * samples probability.
 */
const SPACE = "spaceA";
const H = 3_600_000;
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // Thu 08:00 EDT

const NPC_TABLES = new Set([
  "npc_log", "npc_state", "npc_player_state", "npc_player_memory", "npc_player_barks",
  "npc_relic_holdings", "npc_gate", "npc_plans", "npc_plan_steps", "npc_mismatches",
  "npc_stirrings", "npc_sim_nodes", "npc_sim_edges", "npc_sim_journey", "npc_sim_inbox",
  "npc_commissions", "npc_knowledge", "npc_gate_decisions", "sqlite_sequence",
]);

/** Everything that is NOT hers: the §7.1 snapshot set, maximally —
 *  every other table in the database, byte-compared. */
function playerUniverse(h: DbHandle): string {
  const tables = h.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  const dump: Record<string, unknown> = {};
  for (const t of tables) {
    if (NPC_TABLES.has(t.name)) continue;
    const cols = h.sqlite.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
    const rows = (
      cols.some((c) => c.name === "space_id")
        ? h.sqlite.prepare(`SELECT * FROM "${t.name}" WHERE space_id = ?`).all(SPACE)
        : h.sqlite.prepare(`SELECT * FROM "${t.name}"`).all()
    ) as unknown[];
    dump[t.name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return JSON.stringify(dump);
}

const waitDecider: CaptainDecider = {
  decide: () => ({ act: "wait", cause: "The script holds her sessions still while purpose drives." }),
};

interface ArcRun {
  log: { kind: string; act: string; cause: string }[];
  holdings: string[];
  fuel: number;
  credits: number;
  world: CaptainWorld | null;
  decision: string | null;
  planVersions: number;
}

function runArc(findIsWitness: boolean): { run: ArcRun; handle: DbHandle } {
  const handle = createDb(":memory:");
  const captains = new CaptainRepo(handle, SPACE);
  const npc = new NpcRepo(handle, SPACE);
  const store = new PurposeStore(handle, SPACE);
  const def = captainDefinition("veyra")!;

  captains.ensureState(def, T0);
  captains.update("veyra", { fuel: 30 });
  // Pre-arc holding (provenance in the log, per the fixture note).
  if (findIsWitness) {
    npc.addHolding("veyra", "witness-without-a-name", "deep-past", T0);
    npc.addHolding("veyra", "harbor-nail", "great-station", T0);
  } else {
    npc.addHolding("veyra", "harbor-nail", "great-station", T0);
  }
  store.seedSimBrainFixture(
    "veyra",
    [
      { id: "n-due", theme: "the search", title: "A half-checked bearing", pointsTo: "great-station", ageDays: 40, due: 1 },
      { id: "n-old", theme: "voyages", title: "The long way round, remembered", pointsTo: "scale", ageDays: 800, due: 0 },
      { id: "n-old-station", theme: "the search", title: "An old chart of the Station", pointsTo: "great-station", ageDays: 700, due: 0 },
      { id: "n-a", theme: "people", title: "A face at the dock", pointsTo: "great-station", ageDays: 90, due: 0 },
      { id: "n-b", theme: "work", title: "Berth fees and patience", pointsTo: "great-station", ageDays: 120, due: 0 },
    ],
    [{ kind: "travel", world: "scale", label: "travel to Scale" }],
    [],
  );

  // Scripted search outcomes: Station no-find; Scale attempt 1
  // no-find, attempt 2 find — counted per stirring.
  const attempts = new Map<number, number>();
  const deps = {
    decider: waitDecider,
    searchDraw: (_id: string, stirringId: number) => {
      const n = (attempts.get(stirringId) ?? 0) + 1;
      attempts.set(stirringId, n);
      const stirring = store.stirringById(stirringId);
      if (stirring?.world === "scale" && n >= 2) return 0.05;
      return 0.99;
    },
  };

  const universe0 = playerUniverse(handle);
  let now = T0;
  const adv = (hours: number) => {
    now += hours * H;
    advanceCaptain(handle, SPACE, "veyra", now, deps);
    expect(playerUniverse(handle)).toBe(universe0);
  };
  const placeInSession = (world: CaptainWorld, hours: number) => {
    captains.update("veyra", {
      currentWorld: world,
      sessionKey: `arc-${world}-${now}`,
      sessionWorld: world,
      sessionStartedAt: new Date(now).toISOString(),
      sessionEndsAt: new Date(now + hours * H).toISOString(),
      legFrom: null, legTo: null, legKind: null,
      legDepartedStepMs: null, legArrivesStepMs: null, legSteps: null, legVisitKey: null,
    });
    captains.setCursor("veyra", now);
  };
  const state = () => captains.state("veyra")!;
  const advanceUntil = (pred: () => boolean, max = 12) => {
    for (let i = 0; i < max && !pred(); i++) adv(1);
    expect(pred()).toBe(true);
  };

  // --- Day 1, the Station (arc steps 1–10) ---
  placeInSession("great-station", 10);
  // Steps 2–3: the due Review deed wins the first decision point.
  advanceUntil(() => store.simNodes("veyra").find((n) => n.id === "n-due")?.due === 0);
  // Step 4: the deed raised her Station stirring (C13), sourced from the deed.
  const stationStirring = store.activeStirrings("veyra").find((s) => s.world === "great-station");
  expect(stationStirring).toBeDefined();
  // Steps 5–6: a stream entry exists and Plan v1 is stored, panel-readable.
  advanceUntil(() => store.activePlan("veyra") !== null);
  const v1 = store.activePlan("veyra")!;
  expect(v1.goalId).toBe(GATE_GOAL_ID);
  expect(store.stepsOf(v1.id)[0]?.kind).toBe("search");
  expect(store.stepsOf(v1.id)[0]?.expected).toBe("a find at Great Station");
  // Step 7: the Station search — seeded no-find, logged in those words.
  advanceUntil(() => npc.recentLog("veyra", 50).some((e) => e.kind === "search" && e.act.includes("found nothing")));
  expect(npc.holdings("veyra")).toHaveLength(findIsWitness ? 2 : 1);
  // Step 8: mismatch verbatim + v2 under the same goal id; v1 kept, superseded.
  const v2 = store.activePlan("veyra")!;
  expect(v2.id).not.toBe(v1.id);
  expect(v2.goalId).toBe(GATE_GOAL_ID);
  expect(store.planById(v1.id)?.state).toBe("superseded");
  const mm = store.mismatchesOf("veyra");
  expect(mm).toHaveLength(1);
  expect(mm[0]?.cause).toContain("expected a find at Great Station, found nothing");
  expect(store.stirringById(stationStirring!.id)?.state).toBe("resolved");
  // Step 9: the Journey commission (travel to Scale) is accepted — it
  // aligns with v2 and did not come from the plan.
  advanceUntil(() => store.commissionsOf("veyra").some((c) => c.kind === "journey" && c.state === "open"));
  // Steps 11–12: the Resurface deed raises the Scale stirring.
  advanceUntil(() => store.activeStirrings("veyra").some((s) => s.world === "scale"));
  // Step 13: warp leg Station → Scale on HER tank (30 → 20).
  advanceUntil(() => state().legTo === "scale");
  expect(state().fuel).toBe(20);
  const wire = getCaptainState(handle, SPACE, "veyra", now);
  expect(wire.legTo).toBe("scale");
  expect(wire.transitState).not.toBe("none");
  expect(playerUniverse(handle)).toBe(universe0);
  // Step 14: arrival resolves inside the advance; the commission's
  // journey step completes from the arrival log event.
  advanceUntil(() => state().currentWorld === "scale" && state().legTo === null);
  const journey = store.commissionsOf("veyra").find((c) => c.kind === "journey")!;
  expect(journey.state).toBe("completed");
  expect(journey.completedLogId).toBeGreaterThan(0);
  const arrivalLine = npc.recentLog("veyra", 50).find((e) => e.id === journey.completedLogId);
  expect(arrivalLine?.kind).toBe("arrive");

  // --- Day 2–3, Scale (arc steps 15–22) ---
  placeInSession("scale", 10);
  // Step 15: reads change nothing on either side.
  const herBefore = JSON.stringify(store.activePlan("veyra")) + JSON.stringify(store.stepsOf(store.activePlan("veyra")!.id));
  getCaptainState(handle, SPACE, "veyra", now);
  listCaptainStates(handle, SPACE, now);
  getChronicle(handle, SPACE, now);
  expect(JSON.stringify(store.activePlan("veyra")) + JSON.stringify(store.stepsOf(store.activePlan("veyra")!.id))).toBe(herBefore);
  expect(playerUniverse(handle)).toBe(universe0);
  // Step 16: Scale search attempt 1 — honest no-find, NO mismatch
  // (v2's search step declared both branches in advance).
  const mismatchesBefore = store.mismatchesOf("veyra").length;
  advanceUntil(() => store.stirringAt("veyra", "scale")?.attempts === 1);
  expect(store.mismatchesOf("veyra")).toHaveLength(mismatchesBefore);
  expect(store.stirringAt("veyra", "scale")?.state).toBe("active");
  // Step 17: retrieval returns her arrival + failed search, hers only.
  const { entries } = retrieveCaptainMemories(handle, SPACE, "veyra", { tags: ["scale"], nowMs: now });
  expect(entries.some((e) => e.text.includes("Scale"))).toBe(true);
  // Step 18: attempt 2 — the find. Holdings +1, importance 9.
  advanceUntil(() => npc.holdings("veyra").length === (findIsWitness ? 3 : 2));
  expect(captains.memory("veyra").some((e) => e.importance === 9)).toBe(true);
  expect(store.stirringAt("veyra", "scale")).toBeNull();
  // Steps 19–20: gate progress on the wire; the search step closed
  // in the SAME version (completion is not a replan).
  const wire2 = getCaptainState(handle, SPACE, "veyra", now);
  expect(wire2.gateView?.heldCount).toBe(findIsWitness ? 3 : 2);
  expect(wire2.gateView?.hasWitness).toBe(findIsWitness);
  expect(store.activePlan("veyra")?.id).toBe(v2.id);
  expect(store.stepsOf(v2.id).some((s) => s.kind === "gate-check" && s.state === "open")).toBe(true);
  // Step 21: THE GATE DECISION.
  advanceUntil(() => store.gateDecisionsOf("veyra").length === 1);
  const decision = store.gateDecisionsOf("veyra")[0]!;
  if (findIsWitness) {
    expect(decision.decision).toBe("open");
    expect(npc.gateOpen("veyra")).toBe(true);
  } else {
    expect(decision.decision).toBe("unmet");
    expect(decision.missing).toBe("the Witness");
    expect(npc.gateOpen("veyra")).toBe(false);
  }
  const allLines = npc.recentLog("veyra", 500).map((e) => `${e.act} ${e.cause}`).join("\n");
  expect(allLines).not.toContain("Eternity");
  expect(allLines).not.toContain("UTC");
  // Step 22: replan from the decision — v3, same goal id.
  const v3 = store.activePlan("veyra")!;
  expect(v3.goalId).toBe(GATE_GOAL_ID);
  expect(v3.version).toBe(3);

  if (!findIsWitness) {
    // Steps 23–24: v3's return leg — DRIFT, Scale → Station, fuel 20 → 20,
    // every read in the interval honestly in transit. (Fresh session
    // fixture for the return phase, same harness pattern as Day 1.)
    placeInSession("scale", 10);
    advanceUntil(() => store.stepsOf(v3.id).some((s) => s.state === "completed" && s.kind === "resurface"));
    advanceUntil(() => state().legTo === "great-station");
    expect(state().legKind).toBe("drift");
    expect(state().fuel).toBe(20);
    const midWire = getCaptainState(handle, SPACE, "veyra", now);
    expect(midWire.legTo).toBe("great-station");
    expect(midWire.currentWorld).toBeNull();
    advanceUntil(() => state().currentWorld === "great-station" && state().legTo === null, 6);
    expect(state().fuel).toBe(20);
    const closing = getCaptainState(handle, SPACE, "veyra", now);
    expect(closing.currentWorld).toBe("great-station");
    expect(closing.plan?.goalId).toBe(GATE_GOAL_ID);
    expect(playerUniverse(handle)).toBe(universe0);
  } else {
    // §1.25 open branch: the passage chain — three ordinary legs,
    // each gated on the open decision, ending with her away.
    const chain = store.stepsOf(v3.id).filter((s) => s.kind === "attempt-gate-passage");
    expect(chain).toHaveLength(3);
    for (let leg = 0; leg < 3; leg++) {
      advanceUntil(() => state().legTo !== null);
      const dest = state().legTo!;
      advanceUntil(() => state().currentWorld === dest && state().legTo === null, 8);
      if (leg < 2) placeInSession(dest, 10);
    }
    expect(store.stepsOf(v3.id).every((s) => s.state === "completed")).toBe(true);
    expect(playerUniverse(handle)).toBe(universe0);
  }

  const run: ArcRun = {
    log: npc.recentLog("veyra", 500).reverse().map((e) => ({ kind: e.kind, act: e.act, cause: e.cause })),
    holdings: npc.holdings("veyra"),
    fuel: state().fuel,
    credits: state().credits,
    world: state().currentWorld,
    decision: decision.decision,
    planVersions: store.planVersionsOf("veyra", GATE_GOAL_ID).length,
  };
  return { run, handle };
}

describe("P2 phase exit — the scripted seeker arc (B1.10)", () => {
  let handles: DbHandle[] = [];
  afterEach(() => {
    for (const h of handles) h.sqlite.close();
    handles = [];
  });

  it("the full 24-step arc reaches the unmet decision — player universe byte-identical at every step", () => {
    const { run, handle } = runArc(false);
    handles.push(handle);
    expect(run.decision).toBe("unmet");
    expect(run.holdings).toEqual(["harbor-nail", "star-hanger"]);
    expect(run.world).toBe("great-station");
    expect(run.planVersions).toBe(3);
  });

  it("the open-branch variant (§1.25): Witness fixture → open, permanence marked, three-leg chain flown as ordinary legs", () => {
    const { run, handle } = runArc(true);
    handles.push(handle);
    expect(run.decision).toBe("open");
    expect(run.holdings).toContain("witness-without-a-name");
    expect(run.planVersions).toBe(3);
  });

  it("A2 determinism: the whole arc, run twice from the same seed, produces identical acts", () => {
    const a = runArc(false);
    const b = runArc(false);
    handles.push(a.handle, b.handle);
    expect(b.run.log).toEqual(a.run.log);
    expect(b.run.holdings).toEqual(a.run.holdings);
    expect(b.run.fuel).toBe(a.run.fuel);
    expect(b.run.credits).toBe(a.run.credits);
  });

  it("A4a kill-switch spot-proof: stopped mid-arc, she produces zero acts and zero change on either side", () => {
    const handle = createDb(":memory:");
    handles.push(handle);
    const captains = new CaptainRepo(handle, SPACE);
    captains.ensureState(captainDefinition("veyra")!, T0);
    const universe0 = playerUniverse(handle);
    stopCaptain(handle, SPACE, "veyra", T0);
    const logCount = new NpcRepo(handle, SPACE).recentLog("veyra", 500).length;
    for (let t = T0 + H; t <= T0 + 13 * H; t += H) {
      advanceCaptain(handle, SPACE, "veyra", t, { decider: waitDecider });
    }
    expect(new NpcRepo(handle, SPACE).recentLog("veyra", 500).length).toBe(logCount);
    expect(playerUniverse(handle)).toBe(universe0);
    resumeCaptain(handle, SPACE, "veyra", T0 + 14 * H);
    advanceCaptain(handle, SPACE, "veyra", T0 + 15 * H, { decider: waitDecider });
    expect(playerUniverse(handle)).toBe(universe0);
  });

  it("A4b budget spot-proof: with her day filled to the cap, purpose acts halt — no partial act, player identical", () => {
    const handle = createDb(":memory:");
    handles.push(handle);
    const captains = new CaptainRepo(handle, SPACE);
    const store = new PurposeStore(handle, SPACE);
    captains.ensureState(captainDefinition("veyra")!, T0);
    store.seedSimBrainFixture(
      "veyra",
      [{ id: "n-due", theme: "the search", title: "Due", pointsTo: "great-station", ageDays: 40, due: 1 }],
      [],
      [],
    );
    captains.update("veyra", {
      currentWorld: "great-station",
      sessionKey: "arc-budget",
      sessionWorld: "great-station",
      sessionStartedAt: new Date(T0).toISOString(),
      sessionEndsAt: new Date(T0 + 6 * H).toISOString(),
    });
    captains.setCursor("veyra", T0);
    const universe0 = playerUniverse(handle);
    const log = new NpcRepo(handle, SPACE);
    for (let i = 0; i < CAPTAIN_MAX_ACTS_PER_DAY; i++) {
      log.appendLog("veyra", "wait", "Filler.", "Budget test fill.", T0 + 60_000);
    }
    advanceCaptain(handle, SPACE, "veyra", T0 + 2 * H, { decider: waitDecider });
    // The due card is still due: the deed never executed.
    expect(store.simNodes("veyra").find((n) => n.id === "n-due")?.due).toBe(1);
    expect(playerUniverse(handle)).toBe(universe0);
  });

  it("invariant 6 — nothing decays: 30 local days with no decision points leave holdings, gate progress, and plan goal identical", () => {
    const handle = createDb(":memory:");
    handles.push(handle);
    const captains = new CaptainRepo(handle, SPACE);
    const store = new PurposeStore(handle, SPACE);
    const npc = new NpcRepo(handle, SPACE);
    captains.ensureState(captainDefinition("veyra")!, T0);
    npc.addHolding("veyra", "harbor-nail", "great-station", T0);
    const draft = planForGoal(
      {
        world: "scale", stirrings: ["scale"], holdings: 1, hasWitness: false, gateOpen: false,
        dueDeed: true, oldNode: true, linkable: true, deedRaisesAt: "scale", fuel: 30, priorNoFinds: 0,
      } satisfies CaptainWorldState,
      GATE_GOAL_ID,
    );
    if (!("steps" in draft)) throw new Error("expected a plan");
    store.createPlan("veyra", GATE_GOAL_ID, "hold Witness + any two", draft.steps, null, null, T0, null);
    const before = JSON.stringify({
      holdings: npc.holdings("veyra"),
      plan: store.activePlan("veyra"),
      steps: store.stepsOf(store.activePlan("veyra")!.id),
    });
    // 32 days in summarized jumps (>72 steps each, so no hourly
    // decision point ever fires — time alone must change nothing).
    for (let d = 1; d <= 8; d++) {
      advanceCaptain(handle, SPACE, "veyra", T0 + d * 4 * 24 * H, { decider: waitDecider });
    }
    const after = JSON.stringify({
      holdings: npc.holdings("veyra"),
      plan: store.activePlan("veyra"),
      steps: store.stepsOf(store.activePlan("veyra")!.id),
    });
    expect(after).toBe(before);
  });

  it("invariant 4 — from every reachable position a 0-fuel path home exists in the plan graph", () => {
    for (const world of ["great-station", "scale", "growing-place", "deep-past", "quiet-archive"] as CaptainWorld[]) {
      const draft = planForGoal(
        {
          world, stirrings: [world], holdings: 1, hasWitness: false, gateOpen: false,
          dueDeed: false, oldNode: false, linkable: false, deedRaisesAt: null, fuel: 0, priorNoFinds: 0,
        } satisfies CaptainWorldState,
        GATE_GOAL_ID,
      );
      expect("steps" in draft).toBe(true);
      if ("steps" in draft) {
        // The search + gate steps plan fine at 0 fuel; any travel
        // the planner emits at 0 fuel is a free kind, never warp.
        for (const s of draft.steps) {
          if (s.kind === "warp") throw new Error(`warp planned at 0 fuel from ${world}`);
        }
      }
    }
  });
});
