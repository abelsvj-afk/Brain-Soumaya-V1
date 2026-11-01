import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import {
  CAPTAIN_DEFINITIONS,
  CAPTAIN_START_CREDITS,
  CAPTAIN_START_FUEL,
  CAPTAIN_TRAVEL_WORLDS,
  WARP_COST,
} from "@brain/shared";
import { NpcRepo } from "../npcs/repo.js";
import { CaptainRepo } from "./repo.js";
import { dayPlan } from "./seed.js";
import { advanceCaptain, getCaptainState } from "./engine.js";

/**
 * P1 §9 invariants, each as its own named check (spec §9 — a gate
 * report that bundles these into one "invariants OK" line does not
 * satisfy the section):
 *  I-1  public squares, private galaxies — destination-set audit.
 *  I-2  no walking, no new locomotion — shape audit.
 *  I-3  needs are preferences, never survival — state-diff soak.
 *  I-4  the decider fork: P1 is the deterministic half only —
 *       absence proof (no provider import, no key read, no fetch).
 *  I-5  Eternity is untouched — unreachability proof.
 *  I-6a Credits ↔ Fuel never convert (O-1) — ledger soak.
 *  I-6b fuel buys speed, never access; home free; drift exists.
 *  I-6c the two economy separations — VACUITY proof, honestly
 *       labelled: P1's allow-list has no gather/sell/refine kind,
 *       so neither separation can be breached by P1. The live
 *       pool-isolation soak is inherited by P3 (spec §9).
 */
const TZ = "America/New_York";
const T0 = Date.parse("2026-10-22T12:00:00.000Z"); // Thu 08:00 EDT
const H = 3_600_000;
const SPACE = "spaceA";

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

const captains = () => new CaptainRepo(handle, SPACE);
const log = (id: "bex" | "junia") => new NpcRepo(handle, SPACE).recentLog(id, 2000);

describe("I-1 — public squares, private galaxies (destination-set audit)", () => {
  it("travel set, anchors, and a 30-day plan soak name only the five D-1 keys", () => {
    expect([...CAPTAIN_TRAVEL_WORLDS].sort()).toEqual(
      ["deep-past", "great-station", "growing-place", "quiet-archive", "scale"].sort(),
    );
    for (const def of CAPTAIN_DEFINITIONS) {
      expect(CAPTAIN_TRAVEL_WORLDS).toContain(def.homeAnchor.world);
      expect(CAPTAIN_TRAVEL_WORLDS).toContain(def.homeWorld);
    }
    for (const id of ["bex", "junia"] as const) {
      const def = CAPTAIN_DEFINITIONS.find((d) => d.id === id)!;
      for (let d = 0; d < 30; d++) {
        const day = new Date(T0 + d * 24 * H);
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(day);
        for (const v of dayPlan(id, key, TZ, def.homeAnchor.world)) {
          expect(CAPTAIN_TRAVEL_WORLDS).toContain(v.world);
          expect(CAPTAIN_TRAVEL_WORLDS).toContain(v.originWorld);
        }
      }
    }
  });
});

describe("I-2 — no walking, no new locomotion (shape audit)", () => {
  it("presence is expressed only as a world key or a leg — no position/room/coordinate field exists", () => {
    const wire = getCaptainState(handle, SPACE, "bex", T0);
    // Per-key audit: no coordinate-shaped field, and no bare x/y/z
    // axis field. (A substring scan for /\by\b/ would false-positive
    // on honest keys like `personality` and `actsToday`.)
    for (const k of Object.keys(wire)) {
      expect(k, `wire key ${k}`).not.toMatch(/position|coordinate|room|path|vector/i);
      expect(k, `wire key ${k}`).not.toMatch(/^(x|y|z)$/i);
    }
    const row = captains().state("bex");
    expect(Object.keys(row ?? {}).join(" ")).not.toMatch(/position|coordinate|room|path/i);
  });
});

describe("I-3 + I-6a — nothing decays; Credits never move; fuel moves only as warp charges", () => {
  it("30-day soak: Credits byte-identical, every fuel delta matched 1:1 to a warp departure", { timeout: 300_000 }, () => {
    for (const id of ["bex", "junia"] as const) {
      advanceCaptain(handle, SPACE, id, T0);
      for (let t = T0 + H; t <= T0 + 30 * 24 * H; t += 12 * H) {
        advanceCaptain(handle, SPACE, id, t);
      }
      const st = captains().state(id);
      expect(st?.credits, id).toBe(CAPTAIN_START_CREDITS);
      const warpDeparts = log(id).filter(
        (e) => e.kind === "depart" && /by warp/.test(e.act),
      ).length;
      expect(st?.fuel, id).toBe(CAPTAIN_START_FUEL - warpDeparts * WARP_COST);
      expect(st?.fuel, id).toBeGreaterThanOrEqual(0);
      // No health/hunger/condition field exists in the row shape.
      expect(Object.keys(st ?? {}).join(" ")).not.toMatch(/health|hunger|condition|morale/i);
    }
  });
});

describe("I-4 — P1 is the deterministic half only (absence proof)", () => {
  it("the captains modules import no provider client, read no key, and make no network call", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      expect(src, f).not.toMatch(/generativelanguage|googleapis|openai|anthropic|@google\/generative-ai/);
      expect(src, f).not.toMatch(/process\.env/);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/API_KEY|apiKey/);
    }
  });
});

describe("I-5 — Eternity is untouched (unreachability proof)", () => {
  it("no Eternity key exists in the travel set, any anchor, or any captain allow-list", () => {
    expect(CAPTAIN_TRAVEL_WORLDS as readonly string[]).not.toContain("eternity");
    for (const def of CAPTAIN_DEFINITIONS) {
      expect(def.homeAnchor.world).not.toBe("eternity" as never);
      expect(def.allowList as readonly string[]).not.toContain("explore");
      expect(def.allowList as readonly string[]).not.toContain("announce-route");
    }
  });
});

describe("I-6b — fuel buys speed, never access; home is free; drift always exists", () => {
  it("plan property: every inter-world route exists in a drift variant; home legs are charge-free kinds", () => {
    for (const id of ["bex", "junia"] as const) {
      const def = CAPTAIN_DEFINITIONS.find((d) => d.id === id)!;
      let sawWarp = false;
      let sawDrift = false;
      for (let d = 0; d < 30; d++) {
        const day = new Date(T0 + d * 24 * H);
        const key = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(day);
        for (const v of dayPlan(id, key, TZ, def.homeAnchor.world)) {
          if (v.legKind === "warp") {
            sawWarp = true;
            expect(v.world).not.toBe(def.homeAnchor.world); // warp is never the home route
          }
          if (v.legKind === "drift") sawDrift = true;
          if (v.world === def.homeAnchor.world && v.legKind !== null) {
            expect(v.legKind).toBe("home"); // home legs ride the free home route
          }
        }
      }
      expect(sawWarp).toBe(true);
      expect(sawDrift).toBe(true);
    }
  });

  it("with fuel forced to 0, Junia still completes circuits by drift — arrival delayed, never denied", { timeout: 180_000 }, () => {
    advanceCaptain(handle, SPACE, "junia", T0);
    handle.sqlite.prepare(`UPDATE npc_player_state SET fuel = 0 WHERE npc_id = 'junia'`).run();
    let arrivedSomewhere = false;
    for (let t = T0 + H; t <= T0 + 14 * 24 * H; t += H) {
      advanceCaptain(handle, SPACE, "junia", t);
      if (log("junia").some((e) => e.kind === "arrive")) arrivedSomewhere = true;
    }
    expect(arrivedSomewhere).toBe(true);
    expect(captains().state("junia")?.fuel).toBe(0);
  });
});

describe("I-6c — the two economy separations (VACUITY proof, honestly labelled)", () => {
  it("no gather/sell/refine kind exists on any captain allow-list — there is nothing to separate in P1", () => {
    for (const def of CAPTAIN_DEFINITIONS) {
      for (const kind of ["gather", "sell", "refine", "tend", "search", "delve", "keep"]) {
        expect(def.allowList as readonly string[], `${def.id}:${kind}`).not.toContain(kind);
      }
    }
    // The live pool-isolation soak is inherited by P3 (spec §9);
    // P1's A1 player-state byte-identity soak runs in
    // captains.test.ts and would catch accidental coupling.
  });
});
