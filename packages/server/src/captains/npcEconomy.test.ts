import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition, HOLD_CAPACITY, postedPrice } from "@brain/shared";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { CaptainRepo } from "./repo.js";
import { NpcEconomy } from "./npcEconomy.js";

/**
 * P3 — the NPC economy service (test outlines §§2–3, E/M series):
 * the shadow supply + NPC demand pool, priced ONLY by G1's shared
 * postedPrice(), walled off from the player's instance by
 * construction. Service-level: presence is set on her state row
 * directly; the advance-level proofs live in
 * npcEconomyAdvance.test.ts.
 */
const SPACE = "spaceA";
const SPACE_B = "spaceB";
const T0 = Date.parse("2026-10-22T12:00:00.000Z");
const H = 3_600_000;
const DAY = 24 * H;

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

function place(id: "bex" | "junia" | "veyra", world: string | null, space = SPACE): void {
  const repo = new CaptainRepo(handle, space);
  repo.ensureState(captainDefinition(id)!, T0);
  repo.update(id, {
    currentWorld: world as never,
    sessionKey: world ? `s-${id}` : null,
    sessionWorld: world as never,
    sessionStartedAt: world ? new Date(T0).toISOString() : null,
    sessionEndsAt: world ? new Date(T0 + 8 * H).toISOString() : null,
  });
}

const econ = (id: "bex" | "junia" | "veyra", space = SPACE) => new NpcEconomy(handle, space, id);
const credits = (id: string, space = SPACE) => new CaptainRepo(handle, space).state(id as never)?.credits;

function playerTablesSnapshot(space = SPACE): string {
  const tables = [
    "game_credits", "game_cargo", "game_storage", "game_ledger", "game_action_results",
    "game_resource_nodes", "game_periods", "game_demand", "game_dock_state",
  ];
  return tables
    .map((t) => {
      const rows = handle.sqlite.prepare(`SELECT * FROM ${t} WHERE space_id = ? ORDER BY 1,2,3`).all(space);
      return `${t}:${JSON.stringify(rows)}`;
    })
    .join("\n");
}

describe("P3 NPC economy service — genesis + money loop (E-4, E-6)", () => {
  it("genesis: first touch writes exactly one opening row anchored at her live balance (R4)", () => {
    place("bex", "great-station");
    const e = econ("bex");
    e.ensureGenesis(T0);
    e.ensureGenesis(T0 + H);
    const rows = e.ledger(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("opening");
    expect(rows[0]!.creditsDelta).toBe(0);
    expect(rows[0]!.balanceAfter).toBe(120);
    expect(e.reconcile().ok).toBe(true);
  });

  it("E-4: gather → sell at the Foundry premium — cargo, credits, demand, ledger agree to the unit", () => {
    place("bex", "scale");
    const e = econ("bex");
    const before = playerTablesSnapshot();
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    const g = e.gather(belt.nodeId, "bex:1:gather", T0, 5);
    expect(g).toMatchObject({ ok: true, good: "ore", gathered: 5 });
    expect(e.cargo()).toEqual([{ good: "ore", qty: 5 }]);
    expect(e.nodes(T0).find((n) => n.nodeId === belt.nodeId)!.remaining).toBe(belt.remaining - 5);

    place("bex", "great-station");
    const s = e.sell("station-foundry", "ore", 5, "bex:2:sell", T0 + H);
    expect(s).toMatchObject({ ok: true, accepted: 5, declined: 0, unitPrice: 6, totalCredits: 30 });
    expect(credits("bex")).toBe(150);
    expect(e.cargo()).toEqual([]);
    expect(e.demandRemaining("station-foundry", "ore", T0 + H)).toBe(35);
    expect(e.reconcile().ok).toBe(true);
    expect(playerTablesSnapshot()).toBe(before);
  });

  it("E-5 floor: with every premium exhausted she can still sell at the Exchange at base", () => {
    place("bex", "great-station");
    const e = econ("bex");
    // Drain the NPC Foundry ore premium (cap 40, R1) via cargo seeded by gathers.
    const belts = e.nodes(T0).filter((n) => n.kind === "belt");
    place("bex", "scale");
    e.gather(belts[0]!.nodeId, "k1", T0, 20);
    place("bex", "great-station");
    expect(e.sell("station-foundry", "ore", 20, "k2", T0)).toMatchObject({ accepted: 20 });
    place("bex", "scale");
    e.gather(belts[1]!.nodeId, "k3", T0, 20);
    place("bex", "great-station");
    expect(e.sell("station-foundry", "ore", 20, "k4", T0)).toMatchObject({ accepted: 20 });
    expect(e.demandRemaining("station-foundry", "ore", T0)).toBe(0);
    place("bex", "scale");
    e.gather(belts[2]!.nodeId, "k5", T0, 3);
    place("bex", "great-station");
    const refused = e.sell("station-foundry", "ore", 3, "k6", T0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("demand_exhausted");
    const floor = e.sell("station-exchange", "ore", 3, "k7", T0);
    expect(floor).toMatchObject({ ok: true, accepted: 3, unitPrice: postedPrice("station-exchange", "ore") });
  });

  it("M-2: partial premium sale — 4 of 10 at premium, 6 declined and retained, cap exact", () => {
    place("veyra", "great-station");
    const e = econ("veyra");
    const belts = e.nodes(T0).filter((n) => n.kind === "belt");
    place("veyra", "scale");
    e.gather(belts[0]!.nodeId, "v1", T0, 20);
    place("veyra", "great-station");
    e.sell("station-foundry", "ore", 16, "v2", T0); // used 16, remaining 24
    place("veyra", "scale");
    e.gather(belts[1]!.nodeId, "v3", T0, 20);
    place("veyra", "great-station");
    e.sell("station-foundry", "ore", 20, "v4", T0); // used 36, remaining 4
    expect(e.demandRemaining("station-foundry", "ore", T0)).toBe(4);
    place("veyra", "scale");
    e.gather(belts[2]!.nodeId, "v5", T0, 10);
    place("veyra", "great-station");
    const s = e.sell("station-foundry", "ore", 10, "v6", T0);
    expect(s).toMatchObject({ ok: true, accepted: 4, declined: 6, unitPrice: 6 });
    expect(e.cargo()).toEqual([{ good: "ore", qty: 6 }]);
    expect(e.demandRemaining("station-foundry", "ore", T0)).toBe(0);
    const used = handle.sqlite
      .prepare(`SELECT used FROM npc_game_demand WHERE space_id = ? AND buyer_id = 'station-foundry' AND good_id = 'ore'`)
      .get(SPACE) as { used: number };
    expect(used.used).toBe(40); // cap exact, never beyond (invariant 7)
  });

  it("refine R-1 + R-2: inputs from hold only, fee burned in her ledger, output in hold (R3)", () => {
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    const wreck = e.nodes(T0).find((n) => n.kind === "wreck")!;
    const signal = e.nodes(T0).find((n) => n.kind === "signal")!;
    e.gather(belt.nodeId, "r1", T0, 3);
    e.gather(wreck.nodeId, "r2", T0, 4);
    e.gather(signal.nodeId, "r3", T0, 3);
    place("bex", "great-station");
    const before = credits("bex");
    const r = e.refine("R-1", 1, "r4", T0);
    expect(r).toMatchObject({ ok: true, output: "component", feeCharged: 5 });
    expect(e.cargo()).toEqual([
      { good: "component", qty: 1 },
      { good: "data", qty: 3 },
      { good: "salvage", qty: 2 },
    ]);
    expect(credits("bex")).toBe(before! - 5);
    const r2 = e.refine("R-2", 1, "r5", T0);
    expect(r2).toMatchObject({ ok: true, output: "circuit", feeCharged: 8 });
    expect(e.cargo()).toEqual([
      { good: "circuit", qty: 1 },
      { good: "component", qty: 1 },
    ]);
    expect(e.reconcile().ok).toBe(true);
    // Her fuel never moved — refining is Credits-only (O-1 behavioral).
    expect(new CaptainRepo(handle, SPACE).state("bex")?.fuel).toBe(60);
  });

  it("refine refuses fee-or-nothing: an unpayable fee consumes no inputs", () => {
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    const wreck = e.nodes(T0).find((n) => n.kind === "wreck")!;
    e.gather(belt.nodeId, "f1", T0, 3);
    e.gather(wreck.nodeId, "f2", T0, 2);
    handle.sqlite.prepare(`UPDATE npc_player_state SET credits = 4 WHERE space_id = ? AND npc_id = 'bex'`).run(SPACE);
    // Genesis after the fixture credit change would anchor wrongly; the
    // opening row must already exist — it does (gathers wrote it).
    place("bex", "great-station");
    const r = e.refine("R-1", 1, "f3", T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("insufficient_credits");
    expect(e.cargo()).toEqual([
      { good: "ore", qty: 3 },
      { good: "salvage", qty: 2 },
    ]);
  });
});

describe("P3 NPC economy service — presence, validation, supply (M-1, M-5, M-6, E-8)", () => {
  it("M-6: sell/refine refused away from the Station; gather refused in transit — zero writes", () => {
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    e.gather(belt.nodeId, "p1", T0, 4);
    const cargoBefore = JSON.stringify(e.cargo());
    const s = e.sell("station-exchange", "ore", 1, "p2", T0);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toBe("not_present");
    const r = e.refine("R-1", 1, "p3", T0);
    expect(r.ok).toBe(false);
    // In transit: an open leg refuses every verb.
    new CaptainRepo(handle, SPACE).update("bex", { legTo: "great-station" as never, legKind: "drift" });
    const g = e.gather(belt.nodeId, "p4", T0, 1);
    expect(g.ok).toBe(false);
    expect(JSON.stringify(e.cargo())).toBe(cargoBefore);
  });

  it("M-5: a gather credits exactly the hold's free space and leaves the rest in the node", () => {
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    const g1 = e.gather(belt.nodeId, "h1", T0); // fill: 20 ore
    expect(g1).toMatchObject({ ok: true, gathered: HOLD_CAPACITY });
    expect(e.holdUsed()).toBe(HOLD_CAPACITY);
    const signal = e.nodes(T0).find((n) => n.kind === "signal")!;
    const g2 = e.gather(signal.nodeId, "h2", T0);
    expect(g2.ok).toBe(false);
    if (!g2.ok) expect(g2.error).toBe("hold_full");
    expect(e.nodes(T0).find((n) => n.nodeId === signal.nodeId)!.remaining).toBe(15);
  });

  it("M-1: shadow renewal at the local-day boundary refills belt/signal, rotates wrecks, never touches cargo", () => {
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    e.gather(belt.nodeId, "n1", T0, 7);
    const wrecksBefore = e.nodes(T0).filter((n) => n.kind === "wreck").map((n) => n.nodeId);
    const next = e.nodes(T0 + DAY);
    expect(next.find((n) => n.nodeId === belt.nodeId)!.remaining).toBe(belt.capacity);
    const wrecksAfter = next.filter((n) => n.kind === "wreck").map((n) => n.nodeId);
    expect(wrecksAfter).not.toEqual(wrecksBefore);
    expect(e.cargo()).toEqual([{ good: "ore", qty: 7 }]);
  });

  it("E-8/X-3: forged quantities, buyers, goods, recipes and PLAYER node ids are refused with zero writes", () => {
    place("bex", "great-station");
    const e = econ("bex");
    const before = playerTablesSnapshot();
    for (const bad of [-1, 0, 1.5, Number.NaN]) {
      expect(e.sell("station-exchange", "ore", bad, `x${bad}`, T0).ok).toBe(false);
    }
    expect(e.sell("invented-buyer" as never, "ore", 1, "xb", T0).ok).toBe(false);
    expect(e.sell("station-exchange", "unobtanium" as never, 1, "xg", T0).ok).toBe(false);
    expect(e.refine("R-99" as never, 1, "xr", T0).ok).toBe(false);
    // A player-pool node id resolves to nothing in the shadow supply.
    expect(e.gather("belt-1", "xn", T0, 1).ok).toBe(false);
    expect(e.ledger(50).filter((r) => r.kind !== "opening")).toEqual([]);
    expect(playerTablesSnapshot()).toBe(before);
  });

  it("E-3 price truth: a seeded fuzz of sales credits exactly postedPrice × accepted", () => {
    place("junia", "scale");
    const e = econ("junia");
    const nodes = e.nodes(T0);
    for (const n of nodes) e.gather(n.nodeId, `fz-${n.nodeId}`, T0, 2);
    place("junia", "great-station");
    let expected = 120;
    const buyers = ["station-exchange", "station-foundry", "salvage-yard", "archive-broker", "fleet-quartermaster"] as const;
    for (const b of buyers) {
      for (const good of ["ore", "salvage", "data"] as const) {
        const price = postedPrice(b, good);
        const held = e.cargo().find((c) => c.good === good)?.qty ?? 0;
        if (!price || held === 0) continue;
        const res = e.sell(b, good, held, `fz-${b}-${good}`, T0);
        if (res.ok) expected += res.accepted * price;
        expect(credits("junia")).toBe(expected);
      }
    }
    expect(e.reconcile().ok).toBe(true);
  });
});

describe("P3 NPC economy — isolation (C-4, C-5) + census", () => {
  it("C-5: one captain's economy day leaves the others' cargo/ledger/balance byte-identical", () => {
    place("bex", "scale");
    place("veyra", "great-station");
    place("junia", "growing-place");
    const veyraBefore = JSON.stringify({ cargo: econ("veyra").cargo(), ledger: econ("veyra").ledger(50), credits: credits("veyra") });
    const juniaBefore = JSON.stringify({ cargo: econ("junia").cargo(), ledger: econ("junia").ledger(50), credits: credits("junia") });
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    e.gather(belt.nodeId, "c1", T0, 6);
    place("bex", "great-station");
    e.sell("station-foundry", "ore", 6, "c2", T0);
    expect(JSON.stringify({ cargo: econ("veyra").cargo(), ledger: econ("veyra").ledger(50), credits: credits("veyra") })).toBe(veyraBefore);
    expect(JSON.stringify({ cargo: econ("junia").cargo(), ledger: econ("junia").ledger(50), credits: credits("junia") })).toBe(juniaBefore);
  });

  it("C-4: heavy economy activity in space A leaves space B's NPC economy byte-identical", () => {
    place("bex", "scale", SPACE_B);
    const bBefore = JSON.stringify({
      cargo: econ("bex", SPACE_B).cargo(),
      nodes: econ("bex", SPACE_B).nodes(T0),
      ledger: econ("bex", SPACE_B).ledger(50),
    });
    place("bex", "scale");
    const e = econ("bex");
    const belt = e.nodes(T0).find((n) => n.kind === "belt")!;
    e.gather(belt.nodeId, "s1", T0, 10);
    place("bex", "great-station");
    e.sell("station-foundry", "ore", 10, "s2", T0);
    const bAfter = JSON.stringify({
      cargo: econ("bex", SPACE_B).cargo(),
      nodes: econ("bex", SPACE_B).nodes(T0),
      ledger: econ("bex", SPACE_B).ledger(50),
    });
    expect(bAfter).toBe(bBefore);
  });

  it("census: every P3 table exists in the schema AND is listed for brain-deletion", () => {
    const names = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      "npc_game_cargo", "npc_game_nodes", "npc_game_periods", "npc_game_demand",
      "npc_game_ledger", "npc_affinity", "npc_director_state",
    ]) {
      expect(names, t).toContain(t);
      expect(SPACE_SCOPED_TABLES, `SPACE_SCOPED_TABLES missing ${t}`).toContain(t);
    }
  });
});
