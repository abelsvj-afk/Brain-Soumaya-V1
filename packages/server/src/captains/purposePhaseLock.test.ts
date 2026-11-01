import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition } from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { GATE_GOAL_ID, P2_PLAN_ACTIONS, planForGoal, type CaptainWorldState } from "./planner.js";
import { PurposeError, admitPurposeAct, isPurposeCaptain } from "./purpose.js";

/**
 * P2-B1.9 — phase-lock enforcement (spec §4 + build brief §4):
 * Gather / Sell / Refine stay P3-locked and INERT in P2. Direct and
 * planner-mediated attempts are refused with a PHASE-LOCK cause,
 * distinct from a plain not-on-allow-list refusal; the captains
 * module never touches G1 (no import, no game_* write, and never —
 * per prep finding S-P3-3 — a route through GameEconomy, whose
 * "npc" actor kind would execute against the player's state).
 * Plus the §8 invariant audits: Eternity fuzz, no-death catalog.
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

describe("P2 phase-lock (B1.9)", () => {
  it("L-1: forged raw gather/sell/refine acts are refused with the PHASE-LOCK cause — distinct from not-on-allow-list", () => {
    const veyra = captainDefinition("veyra")!;
    for (const verb of ["gather", "sell", "refine"]) {
      let caught: unknown = null;
      try {
        admitPurposeAct(veyra, verb);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PurposeError);
      expect((caught as PurposeError).code).toBe("PHASE_LOCKED");
      expect((caught as PurposeError).message).toContain("P3");
    }
    // A merely-unlisted kind refuses differently — the gate can tell
    // "locked until P3" from "never allowed".
    let caught: unknown = null;
    try {
      admitPurposeAct(veyra, "summon-ship");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PurposeError);
    expect((caught as PurposeError).code).toBe("FENCE_REFUSAL");
  });

  it("L-1b: the lock binds every captain, not just the seeker — and her real P2 kinds ARE admitted", () => {
    const bex = captainDefinition("bex")!;
    expect(() => admitPurposeAct(bex, "gather")).toThrowError(/PHASE_LOCKED|locked until P3/);
    const veyra = captainDefinition("veyra")!;
    for (const kind of ["deed", "search", "plan", "commission", "gate-check"]) {
      expect(() => admitPurposeAct(veyra, kind)).not.toThrow();
    }
    // Bex holds no P2 kinds: a deed from her is a plain refusal.
    expect(() => admitPurposeAct(bex, "deed")).toThrowError(/not on the captain allow-list/);
    expect(isPurposeCaptain(veyra)).toBe(true);
    expect(isPurposeCaptain(bex)).toBe(false);
  });

  it("L-2: a goal only a locked verb could satisfy plans as unplanned — never with a locked step", () => {
    const state: CaptainWorldState = {
      world: "great-station",
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
    };
    const draft = planForGoal(state, GATE_GOAL_ID);
    expect("unplanned" in draft).toBe(true);
    const kinds = P2_PLAN_ACTIONS.map((a) => a.kind) as string[];
    for (const locked of ["gather", "sell", "refine"]) expect(kinds).not.toContain(locked);
  });

  it("L-3: source scan — the captains module imports no G1 economy code and writes no game_* table", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    for (const file of ["purpose.ts", "planner.ts", "engine.ts"]) {
      const src = readFileSync(`${here}${file}`, "utf8");
      expect(src).not.toMatch(/game\/economy|gameEconomy/);
      expect(src).not.toMatch(/GameEconomy/);
      expect(src).not.toMatch(/INSERT INTO game_|UPDATE game_|DELETE FROM game_/);
    }
  });

  it("invariant 10 — Eternity fuzz: act/goal forms referencing Eternity outside the gate path fail admission", () => {
    const veyra = captainDefinition("veyra")!;
    // Travel to Eternity's world is not in the travel set — refused.
    let caught: unknown = null;
    try {
      admitPurposeAct(veyra, "travel", "eternity" as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PurposeError);
    expect((caught as PurposeError).code).toBe("FENCE_REFUSAL");
    // The gate kinds are the ONLY Eternity-adjacent admissions.
    expect(() => admitPurposeAct(veyra, "gate-check")).not.toThrow();
    expect(() => admitPurposeAct(veyra, "gate-passage")).not.toThrow();
  });

  it("invariant 5 — no death is representable: the P2 catalog and act kinds contain no death state, verb, or event", () => {
    const kinds = P2_PLAN_ACTIONS.map((a) => a.kind).join(" ");
    expect(kinds).not.toMatch(/die|death|kill|destroy|attack|harm/);
    const veyra = captainDefinition("veyra")!;
    expect(veyra.allowList.join(" ")).not.toMatch(/die|death|kill|destroy|attack|harm/);
  });
});
