import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import * as shared from "@brain/shared";
import { captainDefinition } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { P3_PLAN_ACTIONS, planForGoal, type CaptainWorldState } from "./planner.js";
import { PurposeError, admitPurposeAct, isPurposeCaptain } from "./purpose.js";
import { NpcEconomy } from "./npcEconomy.js";

/**
 * P3-B1 T1 — the phase-lock INVERTED (was P2-B1.9). Through P2,
 * gather/sell/refine were refused with a PHASE_LOCKED cause and
 * absent from the planner's action set; this suite is that suite
 * rewritten for the Waking Market: (a) the lock's historical form
 * is gone — no PHASE_LOCKED refusal exists anywhere; (b) the verbs
 * are admitted ONLY for captains on the P3 economy allow-list
 * (R5: the captains active at P3 — Bex, Junia, Veyra) and ONLY
 * execute through the NPC-pool service (a forged act naming a
 * PLAYER pool target is refused — the player node id resolves to
 * nothing in the shadow supply); (c) every other fence behavior
 * is unchanged, including the Eternity fuzz and the no-death
 * catalog.
 */
const SPACE = "spaceA";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
  new CaptainRepo(handle, SPACE).ensureState(captainDefinition("veyra")!, T0);
});
afterEach(() => {
  handle.sqlite.close();
});

describe("P3 unlock (T1) — the phase lock is gone", () => {
  it("(a) the historical lock is gone: no PHASE_LOCKED refusal, no lock constant, no lock list in the planner", () => {
    expect((shared as Record<string, unknown>).CAPTAIN_PHASE_LOCKED_VERBS).toBeUndefined();
    for (const id of ["bex", "junia", "veyra"] as const) {
      const def = captainDefinition(id)!;
      for (const verb of ["gather", "sell", "refine"]) {
        expect(() => admitPurposeAct(def, verb), `${id}:${verb}`).not.toThrow();
      }
    }
    const kinds = P3_PLAN_ACTIONS.map((a) => a.kind) as string[];
    for (const verb of ["gather", "sell", "refine"]) expect(kinds).toContain(verb);
  });

  it("(b) the verbs sit on the economy allow-list ONLY for the P3-active captains — inactive definitions are refused plainly", () => {
    for (const id of ["dain", "hollis", "sorrel", "yara", "felix"] as const) {
      const def = captainDefinition(id)!;
      let caught: unknown = null;
      try {
        admitPurposeAct(def, "gather");
      } catch (e) {
        caught = e;
      }
      expect(caught, id).toBeInstanceOf(PurposeError);
      expect((caught as PurposeError).code).toBe("FENCE_REFUSAL");
    }
    // The economy list is a SEPARATE named constant (R5), composed
    // into the active definitions — Junia's P1 F25 wording survives
    // re-scoped: she still has no "tend" kind, for anyone.
    expect(shared.CAPTAIN_ECONOMY_ALLOW_LIST).toEqual(["gather", "sell", "refine"]);
    expect(captainDefinition("junia")?.allowList).not.toContain("tend" as never);
    expect(captainDefinition("junia")?.allowList).toContain("gather" as never);
  });

  it("(b2) a goal only an economy verb could reach now PLANS (it was 'unplanned' through P2)", () => {
    const state: CaptainWorldState = {
      world: "scale",
      stirrings: [],
      holdings: 0,
      hasWitness: false,
      gateOpen: false,
      dueDeed: false,
      oldNode: false,
      linkable: false,
      deedRaisesAt: null,
      fuel: 30,
      priorNoFinds: 0,
      cargo: {},
      credits: 120,
      nodeGoods: ["ore", "salvage"],
      savingsGoalCredits: 300,
    };
    const draft = planForGoal(state, "hold-component");
    expect("steps" in draft).toBe(true);
  });

  it("(b3) a forged act naming a PLAYER pool target is refused: the player's node id resolves to nothing in the shadow supply", () => {
    const repo = new CaptainRepo(handle, SPACE);
    repo.update("veyra", {
      currentWorld: "scale", sessionKey: "s", sessionWorld: "scale",
      sessionStartedAt: new Date(T0).toISOString(), sessionEndsAt: new Date(T0 + 8 * 3_600_000).toISOString(),
    });
    const e = new NpcEconomy(handle, SPACE, "veyra");
    // "belt-1" is the PLAYER pool's node id shape; the shadow nodes are the pool's own.
    const forged = e.gather("belt-1", "veyra:forged", T0, 1);
    expect(forged.ok).toBe(false);
    const shadow = e.nodes(T0);
    expect(shadow.length).toBeGreaterThan(0);
    expect(shadow.map((n) => n.nodeId)).not.toContain("belt-1");
  });

  it("(c) the rest of the fence is unchanged: a merely-unlisted kind still refuses as FENCE_REFUSAL", () => {
    const veyra = captainDefinition("veyra")!;
    let caught: unknown = null;
    try {
      admitPurposeAct(veyra, "summon-ship");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PurposeError);
    expect((caught as PurposeError).code).toBe("FENCE_REFUSAL");
    for (const kind of ["deed", "search", "plan", "commission", "gate-check"]) {
      expect(() => admitPurposeAct(veyra, kind)).not.toThrow();
    }
    expect(isPurposeCaptain(veyra)).toBe(true);
    expect(isPurposeCaptain(captainDefinition("bex")!)).toBe(false);
  });

  it("source scan — the captains module imports no player economy service and writes no player table (S-P3-3, X-1)", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    for (const file of ["purpose.ts", "planner.ts", "engine.ts", "npcEconomy.ts", "economyDriver.ts", "director.ts", "affinity.ts"]) {
      const src = readFileSync(`${here}${file}`, "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/GameEconomy/);
      expect(code, file).not.toMatch(/from\s+["'][^"']*game\/economy/);
      expect(code, file).not.toMatch(/(?<![a-z_])game_(credits|cargo|storage|ledger|action_results|resource_nodes|periods|demand|dock_state)\b/);
    }
  });

  it("invariant 10 — Eternity fuzz: act/goal forms referencing Eternity outside the gate path fail admission", () => {
    const veyra = captainDefinition("veyra")!;
    let caught: unknown = null;
    try {
      admitPurposeAct(veyra, "travel", "eternity" as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PurposeError);
    expect((caught as PurposeError).code).toBe("FENCE_REFUSAL");
    // An economy act aimed at Eternity is refused the same way.
    let caught2: unknown = null;
    try {
      admitPurposeAct(veyra, "gather", "eternity" as never);
    } catch (e) {
      caught2 = e;
    }
    expect(caught2).toBeInstanceOf(PurposeError);
    expect((caught2 as PurposeError).code).toBe("FENCE_REFUSAL");
    expect(() => admitPurposeAct(veyra, "gate-check")).not.toThrow();
    expect(() => admitPurposeAct(veyra, "gate-passage")).not.toThrow();
  });

  it("invariant 5 — no death is representable: the P3 catalog and act kinds contain no death state, verb, or event", () => {
    const kinds = P3_PLAN_ACTIONS.map((a) => a.kind).join(" ");
    expect(kinds).not.toMatch(/die|death|kill|destroy|attack|harm/);
    const veyra = captainDefinition("veyra")!;
    expect(veyra.allowList.join(" ")).not.toMatch(/die|death|kill|destroy|attack|harm/);
  });
});
