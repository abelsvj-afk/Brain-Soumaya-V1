import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import {
  CAPTAIN_SEARCH_FIND_PROBABILITY,
  captainDefinition,
  type CaptainId,
  type CaptainWorld,
  type NpcActKind,
} from "@brain/shared";
import { CaptainRepo } from "./repo.js";
import { NpcRepo } from "../npcs/repo.js";
import { checkNpcEternityGate } from "../npcs/gate.js";
import {
  PurposeStore,
  executeGateCheck,
  executeSearchAct,
  searchDrawFor,
  type PurposeExec,
  attemptGatePassage,
  PurposeError,
} from "./purpose.js";

/**
 * P2-B1.6 / B1.7 — search under limited knowledge + NPC holdings
 * and the gate record, under ruling D-POOL (NPC-SCOPED SUPPLY):
 * a captain find never decrements the player's claimableSupply,
 * never quiets a player stirring, never binds a copy promised to
 * the player. Outlines §4 P-1..P-8 and §5 S-1/G-1 are the acceptance.
 */
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

const store = () => new PurposeStore(handle, SPACE);
const captains = () => new CaptainRepo(handle, SPACE);
const npc = () => new NpcRepo(handle, SPACE);

function seedVeyra(nowMs = T0): void {
  const def = captainDefinition("veyra")!;
  captains().ensureState(def, nowMs);
  captains().update("veyra", { currentWorld: "great-station" });
}

function testExec(draw = 0.1): PurposeExec {
  const log = new NpcRepo(handle, SPACE);
  return {
    logAct: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    logBookkeeping: (kind: NpcActKind, act: string, cause: string, nowMs: number) =>
      log.appendLog("veyra", kind, act, cause, nowMs),
    openLeg: () => false,
    state: () => captains().state("veyra")!,
    searchDraw: (_id: CaptainId, _s: number) => draw,
  };
}

/** The player-side relic universe, snapshotted whole: copies,
 *  stirrings, holdings, gate — the D-POOL byte-identity set. */
function playerRelicSnapshot(): string {
  const one = (sql: string) => handle.sqlite.prepare(sql).all(SPACE);
  const copies = handle.sqlite
    .prepare(`SELECT * FROM relic_copies WHERE scope_space_id = ? OR holder_space_id = ? ORDER BY rowid`)
    .all(SPACE, SPACE);
  return JSON.stringify({
    copies,
    stirrings: one(`SELECT * FROM relic_stirrings WHERE space_id = ? ORDER BY rowid`),
    holdings: one(`SELECT * FROM relic_holdings WHERE space_id = ? ORDER BY rowid`),
    gate: one(`SELECT * FROM relic_gate_opened WHERE space_id = ? ORDER BY rowid`),
    codex: one(`SELECT * FROM relic_codex_layers WHERE space_id = ? ORDER BY rowid`),
  });
}

describe("P2 search act (B1.6)", () => {
  it("a find writes her holding through the NPC-scoped supply only — player relic state byte-identical (P-1)", () => {
    seedVeyra();
    const stirring = store().raiseStirring("veyra", "great-station", 42, T0);
    const before = playerRelicSnapshot();
    const out = executeSearchAct(handle, SPACE, "veyra", T0 + H, testExec(0.05), "find-branch");
    expect(out.outcome).toBe("find");
    expect(out.relicId).toBe("harbor-nail"); // first unheld Station relic, registry order
    expect(npc().holdings("veyra")).toEqual(["harbor-nail"]);
    expect(store().stirringById(stirring.id)?.state).toBe("resolved");
    expect(store().stirringById(stirring.id)?.outcome).toBe("find");
    expect(playerRelicSnapshot()).toBe(before);
    // Knowledge + memory carry the find, firsthand and certain.
    const knowledge = store().knowledgeOf("veyra");
    expect(knowledge.some((k) => k.claim.includes("Harbor Nail"))).toBe(true);
    const entry = captains().memory("veyra").find((e) => e.importance === 9);
    expect(entry).toBeDefined();
  });

  it("a no-find is logged in those words, changes no holdings, and resolves a find-branch stirring (arc step 7 shape)", () => {
    seedVeyra();
    store().raiseStirring("veyra", "great-station", 42, T0);
    const out = executeSearchAct(handle, SPACE, "veyra", T0 + H, testExec(0.99), "find-branch");
    expect(out.outcome).toBe("no-find");
    expect(npc().holdings("veyra")).toEqual([]);
    const log = npc().recentLog("veyra", 5);
    expect(log[0]?.act).toContain("found nothing");
    expect(store().activeStirrings("veyra")).toHaveLength(0);
    expect(store().knowledgeOf("veyra").some((k) => k.claim.includes("nothing found"))).toBe(true);
  });

  it("a two-branch search leaves the stirring active after a no-find (arc step 16 shape)", () => {
    seedVeyra();
    captains().update("veyra", { currentWorld: "scale" });
    store().raiseStirring("veyra", "scale", 42, T0);
    const out = executeSearchAct(handle, SPACE, "veyra", T0 + H, testExec(0.99), "two-branch");
    expect(out.outcome).toBe("no-find");
    expect(store().activeStirrings("veyra")).toHaveLength(1);
    expect(store().activeStirrings("veyra")[0]?.attempts).toBe(1);
  });

  it("S-1: the probabilistic path — 100 seeded runs land inside the derived band, and no-find runs change no holdings", () => {
    // D-SEARCH-PROB: p is the named constant derived from the spec's
    // worked arc (1 find across its 3 searches). The band is p ± 0.14.
    expect(CAPTAIN_SEARCH_FIND_PROBABILITY).toBeGreaterThan(0);
    expect(CAPTAIN_SEARCH_FIND_PROBABILITY).toBeLessThan(1);
    seedVeyra();
    captains().update("veyra", { currentWorld: "scale" });
    // The production draw itself, sampled directly: uniform draws
    // keyed by (captain, stirring, attempt) — the fraction below p
    // over a long run of attempts is the probability, by construction.
    let below = 0;
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (searchDrawFor("veyra", 7, attempt) < CAPTAIN_SEARCH_FIND_PROBABILITY) below++;
    }
    expect(below / 1000).toBeGreaterThanOrEqual(CAPTAIN_SEARCH_FIND_PROBABILITY - 0.05);
    expect(below / 1000).toBeLessThanOrEqual(CAPTAIN_SEARCH_FIND_PROBABILITY + 0.05);
    // And end-to-end: 100 searches, each against a fresh stirring
    // (fresh draw key) with her Scale supply reset between runs.
    const log = new NpcRepo(handle, SPACE);
    const prodExec: PurposeExec = {
      logAct: (kind, act, cause, nowMs) => log.appendLog("veyra", kind, act, cause, nowMs),
      logBookkeeping: (kind, act, cause, nowMs) => log.appendLog("veyra", kind, act, cause, nowMs),
      openLeg: () => false,
      state: () => captains().state("veyra")!,
      // no searchDraw: the production rngFor discipline decides
    };
    let finds = 0;
    for (let i = 0; i < 100; i++) {
      handle.sqlite.prepare(`DELETE FROM npc_relic_holdings WHERE space_id = ? AND npc_id = 'veyra'`).run(SPACE);
      handle.sqlite.prepare(`DELETE FROM npc_stirrings WHERE space_id = ? AND npc_id = 'veyra'`).run(SPACE);
      store().raiseStirring("veyra", "scale", 1, T0 + i * H);
      const out = executeSearchAct(handle, SPACE, "veyra", T0 + i * H, prodExec, "find-branch");
      if (out.outcome === "find") finds++;
      else expect(npc().holdings("veyra")).toEqual([]);
    }
    const rate = finds / 100;
    expect(rate).toBeGreaterThanOrEqual(CAPTAIN_SEARCH_FIND_PROBABILITY - 0.14);
    expect(rate).toBeLessThanOrEqual(CAPTAIN_SEARCH_FIND_PROBABILITY + 0.14);
  });

  it("S-1 elsewhere fixture: with her supply at that world exhausted, every search is an honest no-find", () => {
    seedVeyra();
    // She already holds every Scale relic her scoped supply offers.
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    npc().addHolding("veyra", "sunward-compass", "scale", T0);
    npc().addHolding("veyra", "unnumbered-fragment", "scale", T0);
    captains().update("veyra", { currentWorld: "scale" });
    store().raiseStirring("veyra", "scale", 1, T0);
    for (let i = 0; i < 5; i++) {
      const out = executeSearchAct(handle, SPACE, "veyra", T0 + i * H, testExec(0.01), "two-branch");
      expect(out.outcome).toBe("no-find");
    }
    expect(npc().holdings("veyra")).toHaveLength(3);
  });

  it("P-6: a Seed-class find is consumed — no holding row, and the gate does not count it", () => {
    seedVeyra();
    npc().addHolding("veyra", "harbor-nail", "great-station", T0); // first Station relic already hers
    store().raiseStirring("veyra", "great-station", 42, T0);
    const out = executeSearchAct(handle, SPACE, "veyra", T0 + H, testExec(0.05), "find-branch");
    expect(out.outcome).toBe("find");
    expect(out.relicId).toBe("mooring-ring"); // the Seed-class Station relic
    expect(out.consumed).toBe(true);
    expect(npc().holdings("veyra")).toEqual(["harbor-nail"]); // consumed: no new holding
    const gate = checkNpcEternityGate(npc().holdings("veyra"), false);
    expect(gate.othersHeld).toBe(1);
  });

  it("P-2/P-5: a player stirring promising the pool's last copy is never quieted or taken by her find", () => {
    seedVeyra();
    // Player-side fixture: an open player stirring exists. (Raw row:
    // the player service's own issuance is not under test here.)
    handle.sqlite
      .prepare(
        `INSERT INTO relic_stirrings (space_id, relic_id, copy_id, source, open_until, state)
         VALUES (?, ?, ?, 'ambient', ?, 'open')`,
      )
      .run(SPACE, "harbor-nail", "copy-player-1", new Date(T0 + 7 * 24 * H).toISOString());
    const before = playerRelicSnapshot();
    store().raiseStirring("veyra", "great-station", 42, T0);
    const out = executeSearchAct(handle, SPACE, "veyra", T0 + H, testExec(0.05), "find-branch");
    expect(out.outcome).toBe("find");
    // Her find came from the NPC-scoped supply: the player's
    // stirring is still open, promising the same copy, byte-identical.
    expect(playerRelicSnapshot()).toBe(before);
    const stirring = handle.sqlite
      .prepare(`SELECT state, copy_id FROM relic_stirrings WHERE space_id = ?`)
      .get(SPACE) as { state: string; copy_id: string };
    expect(stirring.state).toBe("open");
    expect(stirring.copy_id).toBe("copy-player-1");
  });

  it("P-3: her deed-raised stirring writes no player stirring, no player inbox note, no player Codex layer", () => {
    seedVeyra();
    const before = playerRelicSnapshot();
    store().raiseStirring("veyra", "scale", 7, T0);
    expect(playerRelicSnapshot()).toBe(before);
    const playerStirrings = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM relic_stirrings WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    expect(playerStirrings.c).toBe(0);
  });
});

describe("P2 gate record (B1.7)", () => {
  it("G-1: the two-non-Witness fixture records unmet — missing the Witness — citing exactly her holding ids", () => {
    seedVeyra();
    npc().addHolding("veyra", "harbor-nail", "great-station", T0);
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    const decision = executeGateCheck(handle, SPACE, "veyra", T0 + H, testExec());
    expect(decision.decision).toBe("unmet");
    expect(decision.missing).toBe("the Witness");
    expect([...decision.holdingIds].sort()).toEqual(["harbor-nail", "star-hanger"]);
    expect(npc().gateOpen("veyra")).toBe(false);
    const log = npc().recentLog("veyra", 5);
    expect(log[0]?.act).toContain("unmet");
    expect(log[0]?.act).toContain("Witness");
    expect(log[0]?.act).not.toContain("Eternity");
  });

  it("G-1: the Witness fixture records open, marks permanence in the same act, citing the three ids", () => {
    seedVeyra();
    npc().addHolding("veyra", "witness-without-a-name", "deep-past", T0);
    npc().addHolding("veyra", "harbor-nail", "great-station", T0);
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    const decision = executeGateCheck(handle, SPACE, "veyra", T0 + H, testExec());
    expect(decision.decision).toBe("open");
    expect(decision.holdingIds).toHaveLength(3);
    expect(npc().gateOpen("veyra")).toBe(true);
  });

  it("G-1 negative: a false belief in her knowledge store cannot move the decision — it reads holdings only", () => {
    seedVeyra();
    npc().addHolding("veyra", "harbor-nail", "great-station", T0);
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    store().addKnowledge("veyra", "I hold the Witness Without a Name.", "told", "likely", null, T0);
    const decision = executeGateCheck(handle, SPACE, "veyra", T0 + H, testExec());
    expect(decision.decision).toBe("unmet");
    expect(decision.missing).toBe("the Witness");
  });

  it("gate passage is refused outright while her decision is not open — the negative control", () => {
    seedVeyra();
    // She holds two non-Witness relics and has never asked: passage
    // must refuse BEFORE any leg machinery runs.
    npc().addHolding("veyra", "harbor-nail", "great-station", T0);
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    let opened = false;
    const exec = testExec();
    exec.openLeg = () => {
      opened = true;
      return true;
    };
    expect(() => attemptGatePassage(handle, SPACE, "veyra", "scale", T0 + H, exec)).toThrowError(PurposeError);
    expect(opened).toBe(false);
    expect(npc().recentLog("veyra", 5).some((e) => e.kind === "depart")).toBe(false);
  });

  it("P-7: her gate outcomes never touch the player's gate record — in either direction", () => {
    seedVeyra();
    npc().addHolding("veyra", "witness-without-a-name", "deep-past", T0);
    npc().addHolding("veyra", "harbor-nail", "great-station", T0);
    npc().addHolding("veyra", "star-hanger", "scale", T0);
    const before = playerRelicSnapshot();
    executeGateCheck(handle, SPACE, "veyra", T0 + H, testExec());
    expect(npc().gateOpen("veyra")).toBe(true);
    expect(playerRelicSnapshot()).toBe(before);
  });
});
