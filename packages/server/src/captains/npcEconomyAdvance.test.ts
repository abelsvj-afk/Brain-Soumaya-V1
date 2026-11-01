import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, postedPrice, type CaptainId } from "@brain/shared";
import { GameEconomy } from "../game/economy.js";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import { advanceCaptain, getCaptainState } from "./engine.js";
import { NpcEconomy } from "./npcEconomy.js";
import type { CaptainDecider, CaptainDecision } from "./decider.js";

/**
 * P3 — economy acts INSIDE the advance (test outlines §1, §4 C-1,
 * §6 X-1/X-2/X-4/X-5, §7 A2-E). Scripted deciders drive the acts;
 * the player snapshot is the full G1 instance + brain + fuel,
 * hashed at every checkpoint (A1 at economy scale).
 */
const TZ = "America/New_York";
const SPACE = "spaceA";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const H = 3_600_000;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

function snapshotPlayer(space = SPACE): string {
  // Warm G1's lazy genesis seeding first: the player's economy seeds
  // itself on first read (the engine's travel-state read triggers it
  // exactly as the player's own first read would). The invariant is
  // that captain acts change nothing AFTER that genesis.
  new GameEconomy(handle, space, { now: () => T0 }).getState();
  const parts: string[] = [];
  for (const t of [
    "game_credits", "game_cargo", "game_storage", "game_ledger", "game_action_results",
    "game_resource_nodes", "game_periods", "game_demand", "game_dock_state",
    "nodes", "edges", "relic_holdings", "relic_stirrings",
  ]) {
    const exists = handle.sqlite.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    if (!exists) continue;
    const rows = handle.sqlite.prepare(`SELECT * FROM ${t} WHERE space_id = ? ORDER BY 1,2,3`).all(space);
    parts.push(`${t}:${JSON.stringify(rows)}`);
  }
  const meta = handle.sqlite.prepare(`SELECT * FROM space_meta WHERE space_id = ?`).all(space);
  parts.push(`space_meta:${JSON.stringify(meta)}`);
  const guide = new GameEconomy(handle, space, { now: () => T0 }).buyersGuide();
  parts.push(`guide:${JSON.stringify(guide)}`);
  return parts.join("\n");
}

/** Seed a live session directly (the C-1 fixture pattern): the
 *  captain is mid-visit at `world` for [startMs, startMs + hours].
 *  dayPlan visits run 1–3h — too short for a four-act session — so
 *  the long Station sessions these tests need are seeded, and
 *  advance() steps them exactly like cadence visits. */
function seedSession(captainId: CaptainId, world: "great-station" | "scale", startMs: number, hours: number): void {
  const repo = new CaptainRepo(handle, SPACE);
  repo.ensureState(captainDefinition(captainId)!, startMs);
  repo.update(captainId, {
    currentWorld: world,
    sessionKey: `seed-${captainId}-${startMs}`,
    sessionWorld: world,
    sessionStartedAt: new Date(startMs).toISOString(),
    sessionEndsAt: new Date(startMs + hours * H).toISOString(),
  });
}

/** A decider that plays a fixed script of decisions, then waits. */
function scripted(script: CaptainDecision[]): CaptainDecider {
  let i = 0;
  return {
    decide: () => script[i++] ?? { act: "wait", cause: "The script is done — waiting." },
  };
}

describe("P3 advance integration — the waking market (§1 scenario, scripted)", () => {
  it("gather → refine → sell inside one Station session; player snapshot byte-identical at every step", () => {
    seedSession("bex", "great-station", T0, 16);
    const snap0 = snapshotPlayer();
    // Her own standing orders drive the session (T5 driver), one
    // decision point per advance step: plan the Component, gather
    // ore + salvage from the world-less shadow nodes, refine at the
    // Station — then the savings plan gathers and sells Data, and
    // finally sells the Component itself.
    for (let s = 1; s <= 15; s++) {
      advanceCaptain(handle, SPACE, "bex", T0 + s * H);
      expect(snapshotPlayer()).toBe(snap0);
    }
    const e = new NpcEconomy(handle, SPACE, "bex");
    // The session's full arc (hourly decision points): Component
    // plan -> gather ore -> gather salvage -> refine (115) ->
    // savings plan -> gather 15 Data -> sell 15 Data at the
    // Observatory premium -> sell the Component at the Foundry
    // premium (355: her 300 mark is FUNDED, the target re-aims to
    // 600) -> a fresh Component plan opens and gathers ore again.
    const expectedCredits =
      115 + 15 * postedPrice("archive-broker", "data")! + postedPrice("station-foundry", "component")!;
    expect(expectedCredits).toBe(355);
    expect(new CaptainRepo(handle, SPACE).state("bex")?.credits).toBe(expectedCredits);
    expect(e.cargo()).toEqual([{ good: "ore", qty: 3 }]);
    expect(e.reconcile().ok).toBe(true);
    const log = new NpcRepo(handle, SPACE).recentLog("bex", 50);
    const kinds = log.map((x) => x.kind);
    expect(kinds).toContain("gather");
    expect(kinds).toContain("refine");
    expect(kinds).toContain("sell");
    // Visible cargo on the wire (T9): the next cycle's ore rides in
    // her hold, and the funded goal re-aimed at the doubled mark.
    const wire = getCaptainState(handle, SPACE, "bex", T0 + 15 * H);
    expect(wire.cargo).toEqual([{ good: "ore", qty: 3 }]);
    expect(wire.holdUsed).toBe(3);
    expect(wire.holdCapacity).toBe(20);
    expect(wire.credits).toBe(expectedCredits);
    expect(wire.savingsGoal).toEqual({ label: "a cargo of Circuits, bought honest", target: 600, distance: 245 });
  });

  it("C-1: captain and player sell the same good at the same buyer in one day — each settles from its OWN pool, in both orders", () => {
    for (const order of ["captain-first", "player-first"] as const) {
      const h2 = createDb(":memory:");
      try {
        const space = `space-${order}`;
        // Captain side: Bex holds 10 ore in the NPC pool.
        const repo = new CaptainRepo(h2, space);
        repo.ensureState(captainDefinition("bex")!, T0);
        repo.update("bex", {
          currentWorld: "scale", sessionKey: "s", sessionWorld: "scale",
          sessionStartedAt: new Date(T0).toISOString(), sessionEndsAt: new Date(T0 + 8 * H).toISOString(),
        });
        const npc = new NpcEconomy(h2, space, "bex");
        const belt = npc.nodes(T0).find((n) => n.kind === "belt")!;
        npc.gather(belt.nodeId, `${order}:g`, T0, 10);
        repo.update("bex", { currentWorld: "great-station", sessionWorld: "great-station" });
        // Player side: gather 10 ore from the PLAYER's belt, dock, sell.
        const player = new GameEconomy(h2, space, { now: () => T0 });
        const pNode = player.getState().nodes.find((n) => n.kind === "belt")!;
        const pg = player.gather({ nodeId: pNode.nodeId, idempotencyKey: `${order}:pg` });
        expect(pg.ok).toBe(true);
        player.dock();
        const captainSell = () => npc.sell("station-foundry", "ore", 10, `${order}:cs`, T0);
        const playerSell = () => player.sell({ buyerId: "station-foundry", good: "ore", qty: 10, idempotencyKey: `${order}:ps` });
        if (order === "captain-first") {
          expect(captainSell()).toMatchObject({ ok: true, accepted: 10, totalCredits: 60 });
          expect(playerSell()).toMatchObject({ ok: true });
        } else {
          expect(playerSell()).toMatchObject({ ok: true });
          expect(captainSell()).toMatchObject({ ok: true, accepted: 10, totalCredits: 60 });
        }
        // Each pool shows exactly its own side's consumption.
        const pDemand = h2.sqlite.prepare(`SELECT used FROM game_demand WHERE space_id = ? AND buyer_id='station-foundry' AND good_id='ore'`).get(space) as { used: number };
        const nDemand = h2.sqlite.prepare(`SELECT used FROM npc_game_demand WHERE space_id = ? AND buyer_id='station-foundry' AND good_id='ore'`).get(space) as { used: number };
        expect(pDemand.used).toBe(10);
        expect(nDemand.used).toBe(10);
        expect(player.getState().credits).toBe(60);
        expect(repo.state("bex")?.credits).toBe(180);
      } finally {
        h2.sqlite.close();
      }
    }
  });

  it("X-4 atomicity: a fault mid-advance rolls back the economy act, the log, and the cursor — the retry executes exactly once", () => {
    seedSession("bex", "great-station", T0, 10);
    // Fault at the log layer, on the third append inside the advance
    // (plan-built line, first gather, then BOOM on the second
    // gather's log write — mid-economy-work, inside the transaction).
    const original = NpcRepo.prototype.appendLog;
    let appends = 0;
    NpcRepo.prototype.appendLog = function (...args: Parameters<NpcRepo["appendLog"]>) {
      appends++;
      if (appends === 3) throw new Error("injected fault inside the advance");
      return original.apply(this, args);
    };
    try {
      expect(() => advanceCaptain(handle, SPACE, "bex", T0 + 5 * H)).toThrow(/injected fault/);
    } finally {
      NpcRepo.prototype.appendLog = original;
    }
    const e = new NpcEconomy(handle, SPACE, "bex");
    expect(e.cargo()).toEqual([]);
    expect(e.ledger(50)).toEqual([]);
    const st = new CaptainRepo(handle, SPACE).state("bex");
    expect(st?.lastAdvancedAt ?? null).toBe(new Date(T0).toISOString());
    // Retry healthy: the driver's work executes exactly once — one
    // plan, two gathers (ore, then salvage), one refine, no
    // duplicates from the rolled-back attempt.
    advanceCaptain(handle, SPACE, "bex", T0 + 5 * H);
    expect(e.cargo()).toEqual([{ good: "component", qty: 1 }]);
    expect(e.ledger(50).filter((r) => r.kind === "gather")).toHaveLength(2);
    expect(e.ledger(50).filter((r) => r.kind === "refine_output")).toHaveLength(1);
    expect(e.ledger(50).filter((r) => r.kind === "opening")).toHaveLength(1);
  });

  it("X-5 replay: re-invoking the same advance window produces zero new acts and zero duplicate ledger rows", () => {
    seedSession("bex", "great-station", T0, 10);
    advanceCaptain(handle, SPACE, "bex", T0 + 2 * H);
    const e = new NpcEconomy(handle, SPACE, "bex");
    const ledgerCount = e.ledger(100).length;
    expect(e.cargo()).toEqual([{ good: "ore", qty: 3 }]);
    advanceCaptain(handle, SPACE, "bex", T0 + 2 * H);
    advanceCaptain(handle, SPACE, "bex", T0 + H);
    expect(e.ledger(100)).toHaveLength(ledgerCount);
    expect(e.cargo()).toEqual([{ good: "ore", qty: 3 }]);
  });

  it("A2-E determinism: two fresh DBs, same read sequence with economy acts interleaved — byte-identical NPC economy + player snapshot", () => {
    const run = (): string => {
      const h2 = createDb(":memory:");
      try {
        const repo2 = new CaptainRepo(h2, SPACE);
        repo2.ensureState(captainDefinition("bex")!, T0);
        repo2.update("bex", {
          currentWorld: "great-station",
          sessionKey: "seed-bex-a2",
          sessionWorld: "great-station",
          sessionStartedAt: new Date(T0).toISOString(),
          sessionEndsAt: new Date(T0 + 10 * H).toISOString(),
              });
        const v = { startMs: T0 };
        const decider = scripted([
          { act: "gather", nodeKind: "belt", qty: 6, cause: "Ambition: ore." },
          { act: "sell", buyerId: "station-foundry", good: "ore", qty: 6, cause: "Ambition: the premium." },
          { act: "gather", nodeKind: "signal", qty: 3, cause: "Curiosity: data sells too." },
        ]);
        const parts: string[] = [];
        for (let s = 1; s <= 5; s += 2) {
          advanceCaptain(h2, SPACE, "bex", v.startMs + s * H, { decider });
          // Interleave player G1 reads in the sequence.
          const guide = new GameEconomy(h2, SPACE, { now: () => T0 }).buyersGuide();
          parts.push(JSON.stringify(guide));
          const wire = getCaptainState(h2, SPACE, "bex", v.startMs + s * H);
          parts.push(JSON.stringify(wire.cargo));
        }
        const e = new NpcEconomy(h2, SPACE, "bex");
        parts.push(JSON.stringify(e.ledger(100)));
        parts.push(JSON.stringify(e.nodes(v.startMs)));
        parts.push(JSON.stringify(new NpcRepo(h2, SPACE).recentLog("bex", 100)));
        const rows = h2.sqlite.prepare(`SELECT * FROM game_demand WHERE space_id = ?`).all(SPACE);
        parts.push(JSON.stringify(rows));
        return parts.join("\n");
      } finally {
        h2.sqlite.close();
      }
    };
    expect(run()).toBe(run());
  });
});

describe("P3 trap guards — S-P3-3 (X-1 source scan, X-2 behavioral)", () => {
  it("X-1: no file under captains/ imports the player economy service or references a player game_* table", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(`${here}${f}`, "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/from\s+["'][^"']*game\/economy/);
      expect(code, f).not.toMatch(/GameEconomy/);
      expect(code, f).not.toMatch(/gameEconomyRoutes/);
      // Player tables only — npc_game_* is the NPC instance and is fine.
      expect(code, f).not.toMatch(/(?<![a-z_])game_(credits|cargo|storage|ledger|action_results|resource_nodes|periods|demand|dock_state)\b/);
    }
  });

  it("X-2 behavioral: a full scripted economy day records ZERO writes to any player game_* table", () => {
    seedSession("bex", "great-station", T0, 10);
    const decider = scripted([
      { act: "gather", nodeKind: "belt", qty: 8, cause: "Ambition." },
      { act: "sell", buyerId: "station-foundry", good: "ore", qty: 8, cause: "Ambition." },
      { act: "gather", nodeKind: "wreck", qty: 2, cause: "Ambition." },
      { act: "gather", nodeKind: "belt", qty: 3, cause: "Ambition." },
      { act: "refine", recipeId: "R-1", count: 1, cause: "Ambition." },
    ]);
    for (let s = 1; s <= 9; s += 2) advanceCaptain(handle, SPACE, "bex", T0 + s * H, { decider });
    for (const t of ["game_credits", "game_cargo", "game_storage", "game_ledger", "game_action_results", "game_resource_nodes", "game_periods", "game_demand", "game_dock_state"]) {
      const c = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE space_id = ?`).get(SPACE) as { c: number };
      expect(c.c, t).toBe(0);
    }
    // Non-vacuity: the NPC side really did the work.
    const e = new NpcEconomy(handle, SPACE, "bex");
    expect(e.ledger(100).some((r) => r.kind === "sale")).toBe(true);
    expect(e.ledger(100).some((r) => r.kind === "refine_output")).toBe(true);
  });

  it("E-1 O-1 source scan: the NPC economy module contains no fuel identifier (comments stripped)", () => {
    const src = readFileSync(fileURLToPath(new URL("./npcEconomy.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code.toLowerCase()).not.toContain("fuel");
  });
});
