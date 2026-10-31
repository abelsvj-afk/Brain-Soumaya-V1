import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { RelicExchangeService } from "../relics/exchange.js";
import {
  buffsForSpace, computeRelicBuffs, seedEffectIdsForSpace,
  RELIC_EFFECTS, RELIC_SEED_EFFECTS,
} from "../relics/buffs.js";
import { NpcRepo } from "../npcs/repo.js";
import { checkNpcEternityGate } from "../npcs/gate.js";
import {
  RELICS, RELIC_BY_ID, RELIC_BLESSINGS, RELIC_ANCHOR_POINTS,
  RELIC_COPY_LIMITS, FUEL_REGEN_FLOOR_PER_HOUR,
} from "@brain/shared";

/**
 * Relics tier implementation (O-R5 ruled 2026-10-30; decisions doc
 * `Soumaya-Relics-Tier-Decisions-2026-10-30.md`): the full class map
 * goes live — 4 Keystones, 3 Seeds, 8 Legacies — with the two ruled
 * Seed effects, the dead held entries removed, the one-time atomic
 * conversion of pre-existing Seed holdings, the item-7 pinning
 * (location never gates buffs), and the NPC dispositions pinned
 * against the REAL registry (no fixture reclassing anywhere in this
 * file — that is the point of it).
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const xchg = () => new RelicExchangeService(handle);

interface CopyRowT { copy_id: string; relic_id: string; state: string; anchor_key: string | null; holder_kind: string | null; holder_id: string | null }
const copiesOf = (relicId: string): CopyRowT[] =>
  handle.sqlite.prepare(`SELECT * FROM relic_copies WHERE relic_id = ? ORDER BY rowid ASC`).all(relicId) as CopyRowT[];
const eventsOf = (copyId: string): { kind: string; detail: string | null }[] =>
  handle.sqlite.prepare(`SELECT kind, detail FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`).all(copyId) as { kind: string; detail: string | null }[];
const effectRows = (spaceId: string): { space_id: string; relic_id: string; copy_id: string }[] =>
  handle.sqlite.prepare(`SELECT space_id, relic_id, copy_id FROM relic_seed_effects WHERE space_id = ? ORDER BY relic_id ASC`).all(spaceId) as { space_id: string; relic_id: string; copy_id: string }[];

function scopeFor(relicId: string, spaceId: string): string | null {
  return RELIC_COPY_LIMITS[relicId]?.scarcityClass === "private" ? spaceId : null;
}

/** A PRE-TIER volume's state, written raw: an owned copy of a relic
 *  bound to a holding, exactly as the I-2 backfill left it. No store
 *  calls — nothing may trigger the migration before the test does. */
function giveOwnedCopy(spaceId: string, relicId: string, opts: { held?: boolean; location?: string } = {}): string {
  const def = RELIC_BY_ID.get(relicId)!;
  const anchor = RELIC_ANCHOR_POINTS[relicId]![0]!.anchorKey;
  const copyId = `rc_pretier_${spaceId}_${relicId}`;
  handle.sqlite.prepare(
    `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'held', NULL, NULL, 'space', ?, ?, ?, 0)`,
  ).run(copyId, relicId, spaceId, spaceId, scopeFor(relicId, spaceId));
  handle.sqlite.prepare(
    `INSERT INTO relic_copy_events (copy_id, kind, space_id, world, anchor_key, detail) VALUES (?, 'genesis', ?, ?, ?, ?)`,
  ).run(copyId, spaceId, def.world, anchor, JSON.stringify({ backfill: true }));
  handle.sqlite.prepare(
    `INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key, copy_id, location) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 0, ?, ?, ?, ?, ?)`,
  ).run(spaceId, relicId, opts.held ? 1 : 0, opts.held ? "2026-10-01T00:00:00.000Z" : null, anchor, copyId, opts.location ?? "carried");
  handle.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(spaceId, `relic-${relicId}`);
  return copyId;
}

/** The same pre-tier state for an NPC resident's holding. */
function giveNpcOwnedCopy(spaceId: string, npcId: string, relicId: string): string {
  const def = RELIC_BY_ID.get(relicId)!;
  const copyId = `rc_pretier_npc_${npcId}_${relicId}`;
  handle.sqlite.prepare(
    `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, ?, 'held', NULL, NULL, 'npc', ?, ?, ?, 0)`,
  ).run(copyId, relicId, npcId, spaceId, scopeFor(relicId, spaceId));
  handle.sqlite.prepare(
    `INSERT INTO relic_copy_events (copy_id, kind, space_id, world, anchor_key, detail) VALUES (?, 'genesis', ?, ?, ?, ?)`,
  ).run(copyId, spaceId, def.world, RELIC_ANCHOR_POINTS[relicId]![0]!.anchorKey, JSON.stringify({ backfill: true, npc: true }));
  handle.sqlite.prepare(
    `INSERT OR IGNORE INTO npc_relic_holdings (npc_id, space_id, relic_id, found_at, found_in_world) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', ?)`,
  ).run(npcId, spaceId, relicId, def.world);
  return copyId;
}

describe("the ruled class map — all fifteen, none unassigned", () => {
  it("matches the decisions table exactly, in registry order", () => {
    expect(RELICS.map((r) => `${r.id}:${r.tierClass}`)).toEqual([
      "harbor-nail:keystone",
      "mooring-ring:seed",
      "dawn-leaf:seed",
      "witness-seed:keystone",
      "first-light-shard:legacy",
      "basin-stone:legacy",
      "lantern-of-keeping:legacy",
      "witness-without-a-name:keystone",
      "hearth-ember:legacy",
      "thread-of-many:keystone",
      "star-hanger:legacy",
      "sunward-compass:legacy",
      "stillness-seal:seed",
      "unopened-fold:legacy",
      "unnumbered-fragment:legacy",
    ]);
    // The name trap, ruled: class follows nature, not name — the
    // relic NAMED Witness Seed is a Keystone, and no relic with
    // "Seed" in its name is in the Seed class.
    expect(RELIC_BY_ID.get("witness-seed")!.tierClass).toBe("keystone");
  });
});

describe("Seed effects — the ruled values, and only those", () => {
  it("the seed map carries exactly the two authored effects; Dawn Leaf's absence is debt D-1", () => {
    expect(Object.keys(RELIC_SEED_EFFECTS).sort()).toEqual(["mooring-ring", "stillness-seal"]);
    // The Ring: the per-journey half ONLY — no driftCapDelta rides
    // into the permanent form (the decisions doc's balance ruling).
    expect(RELIC_SEED_EFFECTS["mooring-ring"]).toEqual({ driftDelta: 1 });
    expect(RELIC_SEED_EFFECTS["stillness-seal"]).toEqual({ fuelRegenDelta: 0.5 });
    expect("dawn-leaf" in RELIC_SEED_EFFECTS).toBe(false);
  });

  it("the Ring's permanent arithmetic: drift pays 4, the daily cap stays 2 — the ruled ceiling is 8, not 12", () => {
    const b = computeRelicBuffs([], ["mooring-ring"]);
    expect(b.driftBonus).toBe(4);
    expect(b.driftDailyCap).toBe(2);
  });

  it("the Seal's permanent arithmetic: regen 4.0/hr (base 3.5 + 0.5), and NO permanent review cost", () => {
    const b = computeRelicBuffs([], ["stillness-seal"]);
    expect(b.fuelRegenPerHour).toBe(4.0);
    expect(b.reviewEarn).toBe(3); // the held form's −1 was the price of HOLDING; consumption ends holding
  });

  it("fuelRegenDelta is ADDITIVE over a held set-point, never a set-point itself (the ruled formula)", () => {
    // No held relic ships a regen set-point any more (the Seal's held
    // entry is gone), so the composition is pinned with a fixture
    // set-point on a neutral relic — restored immediately after.
    const fx = RELIC_EFFECTS as unknown as Record<string, { fuelRegenSet?: number }>;
    fx["basin-stone"] = { fuelRegenSet: 5.0 };
    try {
      expect(computeRelicBuffs(["basin-stone"], []).fuelRegenPerHour).toBe(5.0);
      expect(computeRelicBuffs(["basin-stone"], ["stillness-seal"]).fuelRegenPerHour).toBe(5.5);
      expect(computeRelicBuffs([], ["stillness-seal"]).fuelRegenPerHour).toBe(4.0);
    } finally { delete fx["basin-stone"]; }
  });

  it("the composed regen still respects the floor", () => {
    const fx = RELIC_SEED_EFFECTS as unknown as Record<string, { fuelRegenDelta?: number }>;
    fx["dawn-leaf"] = { fuelRegenDelta: -99 };
    try {
      expect(computeRelicBuffs([], ["dawn-leaf"]).fuelRegenPerHour).toBe(FUEL_REGEN_FLOOR_PER_HOUR);
    } finally { delete fx["dawn-leaf"]; }
  });

  it("the dead held entries are gone: a 'held' Seed id contributes nothing from the held map", () => {
    expect("mooring-ring" in RELIC_EFFECTS).toBe(false);
    expect("stillness-seal" in RELIC_EFFECTS).toBe(false);
    expect(computeRelicBuffs(["mooring-ring"])).toEqual(computeRelicBuffs([]));
    expect(computeRelicBuffs(["stillness-seal"])).toEqual(computeRelicBuffs([]));
  });

  it("blessing copy is honest for the three Seeds: permanent language, no holding fiction, Dawn Leaf plainly owed", () => {
    const ring = RELIC_BLESSINGS["mooring-ring"]!;
    expect(ring.giftPlain).toMatch(/permanent/i);
    expect(ring.giftPlain).not.toMatch(/while you hold/i);
    const seal = RELIC_BLESSINGS["stillness-seal"]!;
    expect(seal.giftPlain).toMatch(/permanent/i);
    expect(seal.giftPlain).not.toMatch(/while you hold/i);
    expect(seal.costPlain).toBe("No trade-off."); // the held −1 does NOT become permanent
    const leaf = RELIC_BLESSINGS["dawn-leaf"]!;
    expect(leaf.status).toBe("cut");
    expect(leaf.giftPlain).toMatch(/no blessing yet/i);
  });
});

describe("Seed consumption with the REAL classes (player paths)", () => {
  it("a Mooring Ring claim consumes its copy, records the effect, and the space's buffs gain the permanent form", () => {
    const out = store().claimFind("s1", "mooring-ring", "great-station");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.disposition).toBe("seed-consumed");
    expect(store().foundIds("s1")).not.toContain("mooring-ring");
    const copies = copiesOf("mooring-ring");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.state).toBe("consumed");
    expect(effectRows("s1")).toEqual([{ space_id: "s1", relic_id: "mooring-ring", copy_id: copies[0]!.copy_id }]);
    const b = buffsForSpace(handle, "s1");
    expect(b.driftBonus).toBe(4);
    expect(b.driftDailyCap).toBe(2);
    // Personal discovery stands (the Codex claim), as every claim's does.
    expect(handle.sqlite.prepare(`SELECT 1 AS x FROM codex_claims WHERE space_id = 's1' AND reward_key = 'relic-mooring-ring'`).get()).toBeTruthy();
  });

  it("a duplicate Ring consumes without effect (R3-3, real class)", () => {
    expect(store().claimFind("s1", "mooring-ring", "great-station").ok).toBe(true);
    const dup = store().claimFind("s1", "mooring-ring", "great-station");
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.disposition).toBe("seed-consumed-duplicate");
    expect(copiesOf("mooring-ring").filter((c) => c.state === "consumed")).toHaveLength(2);
    expect(effectRows("s1")).toHaveLength(1);
  });

  it("a Dawn Leaf claim records its consumption with an honestly EMPTY effect — and lights up the day D-1 is authored, with no migration", () => {
    const out = store().claimFind("s1", "dawn-leaf", "growing-place");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.disposition).toBe("seed-consumed");
    expect(effectRows("s1")).toEqual([{ space_id: "s1", relic_id: "dawn-leaf", copy_id: copiesOf("dawn-leaf")[0]!.copy_id }]);
    // Nothing is granted today: buffs are exactly the base buffs,
    // and the read model shows the discovery without inventing a gift.
    expect(buffsForSpace(handle, "s1")).toEqual(computeRelicBuffs([]));
    const st = store().state("s1");
    expect(st.holdings.map((h) => h.relicId)).not.toContain("dawn-leaf");
    expect(st.codex!.find((c) => c.relicId === "dawn-leaf")!.discovered).toBe(true);
    // D-1 self-healing, pinned: author the value into the live map
    // and the ALREADY-RECORDED consumption contributes it — no
    // re-claim, no migration, nobody re-finds anything.
    const fx = RELIC_SEED_EFFECTS as unknown as Record<string, { discoveryDelta?: number }>;
    fx["dawn-leaf"] = { discoveryDelta: 1 };
    try {
      expect(buffsForSpace(handle, "s1").discoveryEarn).toBe(5);
      expect(seedEffectIdsForSpace(handle, "s1")).toEqual(["dawn-leaf"]);
    } finally { delete fx["dawn-leaf"]; }
    expect(buffsForSpace(handle, "s1").discoveryEarn).toBe(4);
  });

  it("the sampled claim path names the Ring's disposition on its receipt", () => {
    const pos = RELIC_ANCHOR_POINTS["mooring-ring"]![0]!.position as unknown as [number, number, number];
    handle.sqlite.prepare(
      `INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES ('s2', 'great-station', ?, ?, ?, 'claim-start', ?)`,
    ).run(pos[0], pos[1], pos[2], new Date(Date.now() - 6000).toISOString());
    const out = svc().claim("s2", "mooring-ring", "tier-sampled-1", pos, "great-station");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.disposition).toBe("seed-consumed");
    expect(effectRows("s2")).toHaveLength(1);
  });
});

describe("the new Keystones — release refused, holdings untouched", () => {
  const CASES: [string, string][] = [
    ["harbor-nail", "great-station"],
    ["witness-seed", "growing-place"],
    ["thread-of-many", "people"],
  ];
  for (const [relicId, world] of CASES) {
    it(`${relicId}: claim, then release is refused as a keystone and the holding stays exactly as it was`, () => {
      expect(store().claimFind("s1", relicId, world).ok).toBe(true);
      const out = store().release("s1", relicId);
      if (!out || out.ok) throw new Error("expected a keystone refusal");
      expect(out.reason).toMatch(/keystone/i);
      expect(store().foundIds("s1")).toContain(relicId);
      expect(copiesOf(relicId).find((c) => c.holder_id === "s1")!.state).toBe("held");
    });
  }
});

describe("the new Legacies — exchange eligibility is real, and every option stays honest", () => {
  const CLAIMABLE: [string, string][] = [
    ["first-light-shard", "deep-past"],
    ["basin-stone", "deep-past"],
    ["lantern-of-keeping", "deep-past"],
    ["hearth-ember", "people"],
  ];
  for (const [relicId, world] of CLAIMABLE) {
    it(`${relicId}: the read model offers the exchange — eligible, lore honestly empty, Credits not offered`, () => {
      expect(store().claimFind("s1", relicId, world).ok).toBe(true);
      const view = store().state("s1").holdings.find((h) => h.relicId === relicId)!;
      expect(view.tierClass).toBe("legacy");
      expect(view.exchange).toEqual({ eligible: true, loreThreadIds: [], creditsOffered: false, creditsValue: null });
    });
  }

  it("a new Legacy exchanges end-to-end for a chart: holding ends, copy returns by its own history, stirring is issued", () => {
    expect(store().claimFind("s1", "basin-stone", "deep-past").ok).toBe(true);
    const lore = xchg().exchange("s1", { relicId: "basin-stone", option: "lore", attemptKey: "tx-lore" }, "great-station");
    expect(lore).toEqual({ ok: false, reason: expect.any(String), kind: "lore-unavailable" });
    const credits = xchg().exchange("s1", { relicId: "basin-stone", option: "credits", attemptKey: "tx-credits" }, "great-station");
    expect(credits).toEqual({ ok: false, reason: expect.any(String), kind: "credits-not-offered" });
    // The refusals spent nothing: the Legacy is still held.
    expect(store().foundIds("s1")).toContain("basin-stone");
    const out = xchg().exchange("s1", { relicId: "basin-stone", option: "chart", chartTargetRelicId: "dawn-leaf", attemptKey: "tx-chart" }, "great-station");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.returnState).toBe("placed");
      expect(out.returnAnchor).toBe(RELIC_ANCHOR_POINTS["basin-stone"]![1]!.anchorKey);
      expect(out.chartStirringId).not.toBeNull();
    }
    expect(store().foundIds("s1")).not.toContain("basin-stone");
    const stirring = handle.sqlite.prepare(`SELECT relic_id, state FROM relic_stirrings WHERE space_id = 's1'`).get() as { relic_id: string; state: string };
    expect(stirring).toEqual({ relic_id: "dawn-leaf", state: "open" });
  });

  it("a Keystone refuses the exchange by class; a Seed holding (constructible only by direct insert) refuses by class too", () => {
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    const k = xchg().exchange("s1", { relicId: "harbor-nail", option: "chart", chartTargetRelicId: "dawn-leaf", attemptKey: "tx-k" }, "great-station");
    expect(k.ok).toBe(false);
    if (!k.ok) { expect(k.kind).toBe("class"); expect(k.reason).toMatch(/keystone/i); }
    giveOwnedCopy("s2", "mooring-ring");
    const s = xchg().exchange("s2", { relicId: "mooring-ring", option: "chart", chartTargetRelicId: "dawn-leaf", attemptKey: "tx-s" }, "great-station");
    expect(s.ok).toBe(false);
    if (!s.ok) { expect(s.kind).toBe("class"); expect(s.reason).toMatch(/seed/i); }
  });
});

describe("the holdings migration — pre-existing Seed holdings convert once, atomically, truthfully", () => {
  it("held and merely-owned Seed holdings convert; a Keystone holding is untouched; provenance tells the truth", () => {
    const ringCopy = giveOwnedCopy("mig", "mooring-ring", { held: true, location: "carried" });
    const leafCopy = giveOwnedCopy("mig", "dawn-leaf", { held: false, location: "station" });
    giveOwnedCopy("mig", "harbor-nail", { held: true });
    store().ensureMigrated();
    // Only the Keystone remains in the Hold.
    expect(store().rows("mig").map((r) => r.relic_id)).toEqual(["harbor-nail"]);
    // Both consumptions are recorded against the space, naming the very copies.
    expect(effectRows("mig")).toEqual([
      { space_id: "mig", relic_id: "dawn-leaf", copy_id: leafCopy },
      { space_id: "mig", relic_id: "mooring-ring", copy_id: ringCopy },
    ]);
    // The copies are in their terminal state, holders cleared; the Nail's copy still rests held.
    expect(copiesOf("mooring-ring")[0]!.state).toBe("consumed");
    expect(copiesOf("mooring-ring")[0]!.holder_kind).toBeNull();
    expect(copiesOf("dawn-leaf")[0]!.state).toBe("consumed");
    expect(copiesOf("harbor-nail")[0]!.state).toBe("held");
    // Provenance: genesis, then the tier-migration consumption (the
    // schema's `consumed` kind, its detail naming the migration) —
    // NOT dressed up as a claim (no 'claimed' event on the chain).
    const kinds = eventsOf(ringCopy).map((e) => e.kind);
    expect(kinds).toEqual(["genesis", "consumed"]);
    const conv = eventsOf(ringCopy).at(-1)!;
    expect(JSON.parse(conv.detail ?? "{}")).toMatchObject({ reason: "tier-migration", effectRecorded: true });
    // Discovery survives conversion: the personal record is the Codex claim, untouched.
    expect(store().state("mig").codex!.find((c) => c.relicId === "mooring-ring")!.discovered).toBe(true);
  });

  it("the converted Ring holder's arithmetic is exactly the ruled trade: permanence + drift 4, the held cap half gone, the slot returned", () => {
    giveOwnedCopy("mig", "mooring-ring", { held: true });
    store().ensureMigrated();
    const b = buffsForSpace(handle, "mig");
    expect(b.driftBonus).toBe(4); // 3 + the permanent +1
    expect(b.driftDailyCap).toBe(2); // NOT 3: the daily-cap half was the held form's, and it is not carried
    expect(store().heldIds("mig")).toEqual([]); // the held slot is returned — the effect needs no slot
    // Permanence, not a toggle: hold and set down other relics; the drift gift does not move.
    expect(store().claimFind("mig", "basin-stone", "deep-past").ok).toBe(true);
    expect(store().hold("mig", "basin-stone").ok).toBe(true);
    expect(buffsForSpace(handle, "mig").driftBonus).toBe(4);
    expect(store().unhold("mig", "basin-stone").ok).toBe(true);
    expect(buffsForSpace(handle, "mig").driftBonus).toBe(4);
  });

  it("a converted Dawn Leaf banks its record with an empty effect — nothing granted, nothing lost", () => {
    giveOwnedCopy("mig", "dawn-leaf", { held: true });
    store().ensureMigrated();
    expect(effectRows("mig")).toHaveLength(1);
    expect(buffsForSpace(handle, "mig")).toEqual(computeRelicBuffs([]));
  });

  it("conversion is idempotent — a second pass, and a fresh handle on the same file, convert nothing more", () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-tier-mig-"));
    const dbPath = join(dir, "brain.db");
    try {
      const h1 = createDb(dbPath);
      const s1 = new RelicHoldingsStore(h1);
      // Raw pre-tier state on the file handle.
      const keep = handle; void keep;
      const raw = h1.sqlite;
      raw.prepare(`INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES ('rc_x', 'mooring-ring', 'held', NULL, NULL, 'space', 'mig', 'mig', NULL, 0)`).run();
      raw.prepare(`INSERT INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key, copy_id, location) VALUES ('mig', 'mooring-ring', '2026-10-01T00:00:00.000Z', 0, 1, '2026-10-01T00:00:00.000Z', 'mooring-ring:harbor-road', 'rc_x', 'carried')`).run();
      s1.ensureMigrated();
      expect(s1.convertSeedHoldings()).toBe(0); // second pass over the same handle's data
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM relic_seed_effects`).get()).toEqual({ n: 1 });
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM relic_copy_events WHERE copy_id = 'rc_x' AND kind = 'consumed'`).get()).toEqual({ n: 1 });
      h1.sqlite.close();
      // A fresh handle (a restart) re-runs the whole migration family: nothing re-converts.
      const h2 = createDb(dbPath);
      new RelicHoldingsStore(h2).ensureMigrated();
      expect(h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_seed_effects`).get()).toEqual({ n: 1 });
      expect(h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'mooring-ring'`).get()).toEqual({ n: 1 });
      expect(h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings`).get()).toEqual({ n: 0 });
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("gate permanence is recorded BEFORE the conversion can drop the found set below completion", () => {
    giveOwnedCopy("mig", "witness-without-a-name", { held: false });
    giveOwnedCopy("mig", "mooring-ring", { held: true });
    giveOwnedCopy("mig", "harbor-nail", { held: false });
    store().ensureMigrated();
    // The Ring is gone from the found set (witness + nail = one other
    // relic — below B-01 on its face), yet the gate stands open: its
    // completion was recorded inside the conversion, from the set as
    // it stood the moment before.
    expect(store().foundIds("mig")).toEqual(["witness-without-a-name", "harbor-nail"]);
    expect(store().gateOpenedRecorded("mig")).toBe(true);
    expect(store().gateView("mig").open).toBe(true);
  });

  it("an NPC resident's Seed holding converts too — same class rule, effect against the NPC's space, the NPC named on the event", () => {
    const copyId = giveNpcOwnedCopy("npcspace", "harbor-controller", "mooring-ring");
    store().ensureMigrated();
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM npc_relic_holdings WHERE space_id = 'npcspace'`).get()).toEqual({ n: 0 });
    expect(copiesOf("mooring-ring")[0]!.state).toBe("consumed");
    expect(effectRows("npcspace")).toEqual([{ space_id: "npcspace", relic_id: "mooring-ring", copy_id: copyId }]);
    const conv = eventsOf(copyId).at(-1)!;
    expect(conv.kind).toBe("consumed");
    expect(JSON.parse(conv.detail ?? "{}")).toMatchObject({ reason: "tier-migration", effectRecorded: true, npcId: "harbor-controller" });
  });

  it("placed pool copies are untouched — only OWNED copies convert", () => {
    // A Ring copy resting in the world (no holder), plus another space's owned one.
    handle.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES ('rc_resting', 'mooring-ring', 'placed', 'great-station', 'mooring-ring:road-2', NULL, NULL, NULL, NULL, 0)`,
    ).run();
    handle.sqlite.prepare(
      `INSERT INTO relic_copy_events (copy_id, kind, space_id, world, anchor_key, detail) VALUES ('rc_resting', 'placed', NULL, 'great-station', 'mooring-ring:road-2', NULL)`,
    ).run();
    giveOwnedCopy("mig", "mooring-ring", { held: false });
    store().ensureMigrated();
    const resting = copiesOf("mooring-ring").find((c) => c.copy_id === "rc_resting")!;
    expect(resting.state).toBe("placed");
    expect(resting.anchor_key).toBe("mooring-ring:road-2");
    expect(eventsOf("rc_resting").map((e) => e.kind)).toEqual(["placed"]);
  });

  it("the legacy claims migration no longer resurrects a Seed holding from a bare Codex claim", () => {
    // A Seed's Codex claim is a DISCOVERY record (every claim writes
    // one, consumed Seeds included) — it must never become a holding
    // on a later handle, or each restart would mint-and-consume a
    // phantom copy. A Legacy's claim keeps its §8 behavior.
    handle.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('ghost', 'relic-dawn-leaf')`).run();
    handle.sqlite.prepare(`INSERT INTO codex_claims (space_id, reward_key) VALUES ('ghost', 'relic-basin-stone')`).run();
    store().ensureMigrated();
    expect(store().foundIds("ghost")).toEqual(["basin-stone"]);
    expect(effectRows("ghost")).toEqual([]);
    expect(copiesOf("dawn-leaf")).toHaveLength(0);
  });

  it("a legacy sync that reports a Seed find converts it in the same transaction — the find banks as a consumption", () => {
    // §8 eligibility: the space exists before the ship migration runs.
    handle.sqlite.prepare(`INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt) VALUES ('old', 'Old', 'old-tag', 'h', 's')`).run();
    store().ensureMigrated();
    const out = store().syncLegacy("old", ["dawn-leaf"]);
    expect(out.synced).toBe(true);
    expect(out.added).toEqual(["dawn-leaf"]);
    expect(store().foundIds("old")).toEqual([]);
    expect(effectRows("old")).toHaveLength(1);
    expect(copiesOf("dawn-leaf")[0]!.state).toBe("consumed");
    const conv = eventsOf(copiesOf("dawn-leaf")[0]!.copy_id).find((e) => e.kind === "consumed")!;
    expect(JSON.parse(conv.detail ?? "{}")).toMatchObject({ reason: "tier-migration", effectRecorded: true });
  });
});

describe("§9 item 7, pinned — location NEVER gates buffs", () => {
  it("a held relic lends identically carried, stored at the Station, and carried again — with a Seed effect in the mix", () => {
    expect(store().claimFind("s1", "mooring-ring", "great-station").ok).toBe(true); // consumed: drift +1 permanent
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    expect(store().hold("s1", "harbor-nail").ok).toBe(true);
    const carried = buffsForSpace(handle, "s1");
    expect(carried.driftBonus).toBe(4);
    expect(store().setLocation("s1", "harbor-nail", "station").ok).toBe(true);
    expect(store().state("s1").holdings.find((h) => h.relicId === "harbor-nail")!.location).toBe("station");
    expect(buffsForSpace(handle, "s1")).toEqual(carried);
    expect(store().setLocation("s1", "harbor-nail", "carried").ok).toBe(true);
    expect(buffsForSpace(handle, "s1")).toEqual(carried);
  });
});

describe("NPC dispositions against the real classes", () => {
  it("an NPC claiming a Mooring Ring consumes it: effect against the NPC's space, nothing held (the residuals disposition, real class)", () => {
    const r = svc().claimForNpc("npcspace", "harbor-controller", "great-station", "mooring-ring");
    expect(r.status).toBe("awarded");
    if (r.status !== "awarded") return;
    const copies = copiesOf("mooring-ring");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.state).toBe("consumed");
    expect(eventsOf(r.copyId).map((e) => e.kind)).toEqual(["genesis", "placed", "claimed", "consumed"]);
    expect(JSON.parse(eventsOf(r.copyId).at(-1)!.detail ?? "{}")).toMatchObject({ effectRecorded: true, npcId: "harbor-controller" });
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM npc_relic_holdings WHERE space_id = 'npcspace'`).get()).toEqual({ n: 0 });
    expect(effectRows("npcspace")).toEqual([{ space_id: "npcspace", relic_id: "mooring-ring", copy_id: r.copyId }]);
  });

  it("gate parity: a consumed Seed advances NEITHER gate — the NPC's 'two others' and the player's found set count owned relics only", () => {
    // NPC side: Witness + a consumed Ring leaves the gate shut; two
    // OWNED others open it. The NPC gate is the NPC's own B-01
    // journey (npc_gate) — it opens Eternity for no one else, and
    // its rule is the player's rule: the found/owned set counts,
    // consumptions never land in it — on either side.
    const tx = <T,>(fn: () => T): T => handle.sqlite.transaction(fn).immediate();
    expect(tx(() => store().awardCopyForNpcInTransaction("npcspace", "harbor-controller", "witness-without-a-name")).status).toBe("awarded");
    expect(tx(() => store().awardCopyForNpcInTransaction("npcspace", "harbor-controller", "mooring-ring")).status).toBe("seed-consumed");
    expect(tx(() => store().awardCopyForNpcInTransaction("npcspace", "harbor-controller", "harbor-nail")).status).toBe("awarded");
    const repo = new NpcRepo(handle, "npcspace");
    expect([...repo.holdings("harbor-controller")].sort()).toEqual(["harbor-nail", "witness-without-a-name"]);
    expect(checkNpcEternityGate(repo.holdings("harbor-controller"), false).open).toBe(false);
    expect(tx(() => store().awardCopyForNpcInTransaction("npcspace", "harbor-controller", "thread-of-many")).status).toBe("awarded");
    expect(checkNpcEternityGate(repo.holdings("harbor-controller"), false).open).toBe(true);
    // Player mirror: the same three finds leave the player's gate
    // shut (the Ring never lands in the found set), and the fourth
    // find — a second owned other — opens it.
    expect(store().claimFind("p1", "witness-without-a-name", "deep-past").ok).toBe(true);
    expect(store().claimFind("p1", "mooring-ring", "great-station").ok).toBe(true);
    expect(store().claimFind("p1", "harbor-nail", "great-station").ok).toBe(true);
    expect(store().gateView("p1").open).toBe(false);
    expect(store().claimFind("p1", "thread-of-many", "people").ok).toBe(true);
    expect(store().gateView("p1").open).toBe(true);
  });
});

describe("review F-1: the hold preview reads the same buffs as every other surface", () => {
  it("recorded Seed gifts show in the preview — the Seal's 4.0 regen and the Ring's drift 4 — on the success branch and the refusal branches alike", () => {
    expect(store().claimFind("s1", "harbor-nail", "great-station").ok).toBe(true);
    // Recorded consumptions, inserted directly (the Seal's world is
    // unbuilt, so no live claim can write its row yet — the same
    // fixture form as the A18 rewrite in relicBuffsV2).
    handle.sqlite.prepare(`INSERT INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES ('s1', 'stillness-seal', 'rc_fixture_seal'), ('s1', 'mooring-ring', 'rc_fixture_ring')`).run();
    const p = store().preview("s1", "harbor-nail");
    expect(p.refused).toBeUndefined();
    expect(p.buffs.fuelRegenPerHour).toBe(4.0);
    expect(p.buffs.driftBonus).toBe(4);
    const refused = store().preview("s1", "bogus-relic");
    expect(refused.refused).toBeTruthy();
    expect(refused.buffs.fuelRegenPerHour).toBe(4.0);
    expect(refused.buffs.driftBonus).toBe(4);
  });
});
