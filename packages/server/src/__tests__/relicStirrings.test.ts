import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { RelicStirringService, type StirringRow } from "../relics/stirrings.js";
import { NpcRepo } from "../npcs/repo.js";
import { runNpcTick } from "../npcs/loop.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { NotificationsRepo } from "../repositories/notifications.repo.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { RELIC_ANCHOR_POINTS, RELIC_STIRRING_WINDOW_MS, NPC_TICK_MIN_INTERVAL_MS } from "@brain/shared";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Relics I-5 acceptance evidence (implementation design §4.6, §5.4,
 * §5.5, §6 fix (d), §7 I-5; approved design §3/§4.1 + §8.1 #6/#7):
 * stirrings arrive, and the pool becomes ONE pool. A stirring promises
 * a specific placed copy; the NPC claim runs through the same claim
 * core as the player's, with the last-copy courtesy decided INSIDE
 * the award transaction; expiry is honest state, evaluated in
 * transactions and at read time — never a sweeper, never a fabrication.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const stir = () => new RelicStirringService(handle);
const NAIL = RELIC_ANCHOR_POINTS["harbor-nail"]![0]!;
const NAIL_POS = NAIL.position as unknown as [number, number, number];
const WITNESS = RELIC_ANCHOR_POINTS["witness-without-a-name"]![0]!;
const WITNESS_POS = WITNESS.position as unknown as [number, number, number];

let claimCounter = 0;
/** A claim-start sample exactly as the server's table holds it (tests simulate elapsed SERVER time by the stamp). */
function seedSample(space: string, world: string, pos: readonly number[], agoMs: number): void {
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, 'claim-start', ?)`)
    .run(space, world, pos[0], pos[1], pos[2], new Date(Date.now() - agoMs).toISOString());
}
/** The full sampled player claim (I-4 protocol): a dwell-backed claim-start, then the claim. */
function sampledClaim(space: string, relicId: string, world: string, pos: readonly number[]) {
  seedSample(space, world, pos, 6000);
  return svc().claim(space, relicId, `t-${space}-${relicId}-${++claimCounter}`, pos as [number, number, number], world);
}
/** Take n copies of a relic out of the pool via store-level finds from n distinct spaces. */
function fill(relicId: string, n: number, world: string): void {
  for (let i = 0; i < n; i++) {
    expect(store().claimFind(`fill-${relicId}-${i}`, relicId, world).ok).toBe(true);
  }
}
const stirringById = (id: number): StirringRow =>
  handle.sqlite.prepare(`SELECT * FROM relic_stirrings WHERE id = ?`).get(id) as StirringRow;
const copyRow = (copyId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_copies WHERE copy_id = ?`).get(copyId) as
    { state: string; holder_kind: string | null; holder_id: string | null; anchor_key: string | null } | undefined;

describe("schema (I-5, both places + census)", () => {
  it("relic_stirrings exists with the designed columns (incl. the promised copy), joins the census, and its one-open index is partial-unique", () => {
    const cols = (handle.sqlite.prepare(`PRAGMA table_info(relic_stirrings)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "id", "space_id", "relic_id", "copy_id", "source", "chart_exchange_id",
      "issued_at", "open_until", "state", "resolved_at", "resolved_reason",
    ]));
    expect(SPACE_SCOPED_TABLES).toContain("relic_stirrings");
    const idx = handle.sqlite.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'relic_stirrings_one_open_idx'`,
    ).get() as { sql: string } | undefined;
    expect(idx?.sql).toContain("UNIQUE");
    expect(idx?.sql).toContain("state = 'open'");
  });

  it("the one-open rule binds at the database level: a second open stirring for the same (space, relic) cannot be inserted", () => {
    const s = stir().issue("s1", "harbor-nail", "ambient");
    expect(s).not.toBeNull();
    expect(() => handle.sqlite.prepare(
      `INSERT INTO relic_stirrings (space_id, relic_id, copy_id, source, open_until) VALUES ('s1', 'harbor-nail', 'rc-x', 'ambient', '2999-01-01T00:00:00.000Z')`,
    ).run()).toThrow();
  });

  it("the window constant is the owner's ruling: seven days", () => {
    expect(RELIC_STIRRING_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const s = stir().issue("s1", "harbor-nail", "ambient")!;
    const span = Date.parse(s.open_until) - Date.parse(s.issued_at);
    expect(Math.abs(span - RELIC_STIRRING_WINDOW_MS)).toBeLessThan(10_000);
  });
});

describe("issuance (§4.6, §5.4): eligibility, the promised copy, L0, inbox", () => {
  it("issues for an undiscovered, anchored relic with pool availability — binding a real placed copy, writing L0, and delivering a non-expiring inbox entry", () => {
    const s = stir().issue("s1", "harbor-nail", "ambient");
    expect(s).not.toBeNull();
    expect(s!.state).toBe("open");
    expect(s!.source).toBe("ambient");
    // The promised copy is real: placed, in the world, at a registry anchor.
    const copy = copyRow(s!.copy_id);
    expect(copy?.state).toBe("placed");
    expect(copy?.anchor_key).toBe(NAIL.anchorKey);
    expect(store().poolCount("harbor-nail")).toBe(1);
    // L0 unlock at issuance (source='stirring').
    const layers = handle.sqlite.prepare(
      `SELECT * FROM relic_codex_layers WHERE space_id = 's1' AND relic_id = 'harbor-nail'`,
    ).all() as { layer: string; source: string }[];
    expect(layers).toEqual([expect.objectContaining({ layer: "L0", source: "stirring" })]);
    // Inbox delivery: identity only, dedupe-keyed to the stirring.
    const inbox = new NotificationsRepo(handle, "s1").list();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.source).toBe("relic-stirring");
    expect(inbox[0]!.dedupeKey).toBe(`stirring:${s!.id}`);
    expect(inbox[0]!.text).toContain("Harbor Nail");
  });

  it("refuses honestly: undiscoverable relics, already-discovered relics, a second open stirring, and an exhausted pool all issue nothing", () => {
    expect(stir().issue("s1", "unnumbered-fragment", "ambient")).toBeNull(); // discoverable: false
    store().claimFind("s2", "harbor-nail", "great-station");
    expect(stir().issue("s2", "harbor-nail", "ambient")).toBeNull(); // already discovered in s2
    const first = stir().issue("s3", "harbor-nail", "ambient");
    expect(first).not.toBeNull();
    expect(stir().issue("s3", "harbor-nail", "ambient")).toBeNull(); // one open per (space, relic)
    fill("mooring-ring", 7, "great-station");
    expect(stir().issue("s4", "mooring-ring", "ambient")).toBeNull(); // pool exhausted — nothing to promise
    expect(new NotificationsRepo(handle, "s4").list()).toHaveLength(0);
  });

  it("the ambient cap is one open stirring per (space, world); chart stirrings are exempt from the cap but never from eligibility", () => {
    const a = stir().evaluateAmbientForWorld("s1", "great-station");
    expect(a?.relic_id).toBe("harbor-nail"); // registry order: the first eligible relic of the world
    expect(stir().evaluateAmbientForWorld("s1", "great-station")).toBeNull(); // cap: one ambient open in the world
    // Chart: exempt from the ambient cap — a second relic may be charted while the ambient is open.
    const chart = stir().issue("s1", "mooring-ring", "chart", { chartExchangeId: 42 });
    expect(chart).not.toBeNull();
    expect(chart!.source).toBe("chart");
    expect(chart!.chart_exchange_id).toBe(42);
    // …but never from eligibility: one-open per (space, relic) binds chart too, and discovery bars it.
    expect(stir().issue("s1", "mooring-ring", "chart", { chartExchangeId: 43 })).toBeNull();
    store().claimFind("s2", "harbor-nail", "great-station");
    expect(stir().issue("s2", "harbor-nail", "chart", { chartExchangeId: 44 })).toBeNull();
  });

  it("after an ambient stirring resolves, the world evaluation moves to the next eligible relic", () => {
    const a = stir().evaluateAmbientForWorld("s1", "great-station")!;
    const claim = sampledClaim("s1", "harbor-nail", "great-station", NAIL_POS);
    expect(claim.ok).toBe(true);
    expect(stirringById(a.id).state).toBe("claimed");
    const next = stir().evaluateAmbientForWorld("s1", "great-station");
    expect(next?.relic_id).toBe("mooring-ring");
  });
});

describe("the stirring → claim loop (§8.1: a claim via a stirring awards exactly the stirred copy)", () => {
  it("the claim at the stirred copy's anchor awards that copy, and the stirring resolves claimed in the same transaction", () => {
    const s = stir().issue("s1", "harbor-nail", "ambient")!;
    const anchor = RELIC_ANCHOR_POINTS["harbor-nail"]!.find((a) => a.anchorKey === copyRow(s.copy_id)?.anchor_key)!;
    const result = sampledClaim("s1", "harbor-nail", "great-station", anchor.position);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.copyId).toBe(s.copy_id);
    const after = stirringById(s.id);
    expect(after.state).toBe("claimed");
    expect(after.resolved_reason).toBe("claimed");
    expect(after.resolved_at).not.toBeNull();
  });

  it("honest resolution: a faster hunter takes the very copy a stirring promised — the stirring resolves quiet AT that award, never a substitute, never silent", () => {
    const s = stir().issue("s1", "witness-without-a-name", "ambient")!;
    // A faster hunter takes the very copy s1 was promised. The promise
    // is exact (approved design §3; exact-copy follow-up): s1's
    // stirring resolves quiet inside THAT award's transaction —
    // reason 'copy-claimed'. (This test previously asserted the I-5
    // supply-based resolution — the stirring stayed open until the
    // pool emptied — which the follow-up replaces.)
    const faster = sampledClaim("s2", "witness-without-a-name", "deep-past", WITNESS_POS);
    expect(faster.ok).toBe(true);
    if (faster.ok) expect(faster.copyId).toBe(s.copy_id);
    const after = stirringById(s.id);
    expect(after.state).toBe("quiet");
    expect(after.resolved_reason).toBe("copy-claimed");
    // The pool still fills honestly for everyone else (3/3), and the
    // resolution does not move again.
    expect(sampledClaim("s3", "witness-without-a-name", "deep-past", WITNESS_POS).ok).toBe(true);
    expect(sampledClaim("s4", "witness-without-a-name", "deep-past", WITNESS_POS).ok).toBe(true);
    expect(stirringById(s.id).state).toBe("quiet");
    expect(stirringById(s.id).resolved_reason).toBe("copy-claimed");
  });
});

describe("expiry: honest state, evaluated at read — the inbox entry survives it", () => {
  it("a stirring past its window resolves expired when read; the delivered inbox entry is not deleted", () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const s = stir().issue("s1", "harbor-nail", "ambient", { nowMs: past })!;
    expect(s.state).toBe("open"); // issued open; expiry is evaluation, not a sweeper
    const read = stir().forSpace("s1");
    expect(read).toHaveLength(1);
    expect(read[0]!.state).toBe("expired");
    expect(read[0]!.resolved_reason).toBe("window-ended");
    expect(read[0]!.resolved_at).not.toBeNull();
    expect(new NotificationsRepo(handle, "s1").list()).toHaveLength(1); // delivery does not expire with the stirring
  });

  it("two-space isolation: one space's stirrings are invisible to another, and expiring one never touches the other", () => {
    const a = stir().issue("space-a", "harbor-nail", "ambient")!;
    const b = stir().issue("space-b", "harbor-nail", "ambient")!;
    expect(a.id).not.toBe(b.id);
    expect(stir().forSpace("space-a").map((r) => r.id)).toEqual([a.id]);
    expect(stir().forSpace("space-b").map((r) => r.id)).toEqual([b.id]);
    // Both promise the same resting copy (the global pool's one placed copy) — the first valid claim wins it.
    expect(b.copy_id).toBe(a.copy_id);
    handle.sqlite.prepare(`UPDATE relic_stirrings SET open_until = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(a.id);
    expect(stir().forSpace("space-a")[0]!.state).toBe("expired");
    expect(stir().forSpace("space-b")[0]!.state).toBe("open");
  });
});

describe("NPC unification (§5.5, fix (d)): one pool, one core", () => {
  it("an NPC claim draws the SAME pool players draw: the count drops for everyone, and the last copy is the last copy for players too", () => {
    expect(store().poolAvailable("harbor-nail")).toBe(7);
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    expect(store().poolCount("harbor-nail")).toBe(1);
    expect(store().poolAvailable("harbor-nail")).toBe(6);
    const copy = copyRow(r.status === "awarded" ? r.copyId : "");
    expect(copy?.holder_kind).toBe("npc");
    expect(copy?.holder_id).toBe("harbor-controller");
    // The read model and the copy agree (same transaction): the NPC subsystem reads its holding.
    expect(new NpcRepo(handle, "npc-space").holdings("harbor-controller")).toEqual(["harbor-nail"]);
    // Six player finds remain; the seventh is refused — the NPC's copy counts.
    fill("harbor-nail", 6, "great-station");
    const refused = store().claimFind("one-too-many", "harbor-nail", "great-station");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe("empty-pool");
  });

  it("the NPC claim writes none of the player records: no holding, no Codex claim, no first discovery, no Fuel", () => {
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 'npc-space'`).get()).toEqual({ n: 0 });
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM codex_claims WHERE space_id = 'npc-space'`).get()).toEqual({ n: 0 });
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_first_discoveries`).get()).toEqual({ n: 0 });
  });

  it("an NPC that already holds a relic is told 'already' by the core and moves on to the next relic it lacks", () => {
    const first = svc().claimForNpc("npc-space", "harbor-controller", "great-station");
    expect(first.status).toBe("awarded");
    if (first.status === "awarded") expect(first.relicId).toBe("harbor-nail");
    const second = svc().claimForNpc("npc-space", "harbor-controller", "great-station");
    expect(second.status).toBe("awarded");
    if (second.status === "awarded") expect(second.relicId).toBe("mooring-ring");
    const third = svc().claimForNpc("npc-space", "harbor-controller", "great-station");
    expect(third.status).toBe("empty"); // nothing left in its world that it lacks
    expect(new NpcRepo(handle, "npc-space").holdings("harbor-controller")).toHaveLength(2);
  });
});

describe("last-copy courtesy (§4.1/R2-4, §8.1 #6): inside the transaction, or it is not the rule", () => {
  /** Pool at supply exactly 1: six copies held by six hunters, the seventh minted placed by sP's stirring. */
  function setupLastCopy() {
    fill("harbor-nail", 6, "great-station");
    const s = stir().issue("sP", "harbor-nail", "ambient")!;
    expect(store().poolCount("harbor-nail")).toBe(7);
    // Isolate the NPC's candidate set to harbor-nail: it already holds the ring.
    new NpcRepo(handle, "npc-space").addHolding("harbor-controller", "mooring-ring", "great-station");
    return s;
  }

  it("an NPC claim is refused by courtesy while a player's stirring is open over the last copy — and the player then claims it", () => {
    const s = setupLastCopy();
    const deferred = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(deferred.status).toBe("deferred");
    // The deferral wrote nothing: no NPC copy, no pool movement, the stirring untouched.
    expect(new NpcRepo(handle, "npc-space").holdings("harbor-controller")).toEqual(["mooring-ring"]);
    expect(store().poolCount("harbor-nail")).toBe(7);
    expect(stirringById(s.id).state).toBe("open");
    // Player claims are never deferred by courtesy: sP takes the very copy it was promised.
    const claim = sampledClaim("sP", "harbor-nail", "great-station", NAIL_POS);
    expect(claim.ok).toBe(true);
    if (claim.ok) expect(claim.copyId).toBe(s.copy_id);
    expect(stirringById(s.id).state).toBe("claimed");
    // And now the pool is simply empty for the NPC — an honest 'empty', no longer a courtesy question.
    const after = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(after.status).toBe("empty");
  });

  it("at supply 2 the NPC hunts freely under an open stirring — courtesy guards only the LAST copy", () => {
    fill("harbor-nail", 5, "great-station");
    const s = stir().issue("sP", "harbor-nail", "ambient")!; // mints the 6th copy placed; supply = 1 resting + 1 room = 2
    new NpcRepo(handle, "npc-space").addHolding("harbor-controller", "mooring-ring", "great-station");
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    if (r.status === "awarded") expect(r.copyId).toBe(s.copy_id); // the resting copy is the one bound
    // The NPC took the very copy sP's stirring promised: the promise
    // is exact (§3), so the stirring resolves quiet at this award,
    // even though the pool did not empty. (This previously asserted
    // the I-5 supply-based resolution — the stirring stayed "open" —
    // which the exact-copy follow-up replaces.)
    expect(stirringById(s.id).state).toBe("quiet");
    expect(stirringById(s.id).resolved_reason).toBe("copy-claimed");
  });

  it("an EXPIRED stirring does not block: expiry is evaluated inside the NPC transaction (R2-4), and the NPC takes the copy", () => {
    fill("harbor-nail", 6, "great-station");
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const s = stir().issue("sP", "harbor-nail", "ambient", { nowMs: past })!;
    new NpcRepo(handle, "npc-space").addHolding("harbor-controller", "mooring-ring", "great-station");
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    const after = stirringById(s.id);
    expect(after.state).toBe("expired");
    expect(after.resolved_reason).toBe("window-ended");
  });
});

describe("the loop (§5.5): explore becomes a real attempt; issuance rides the daily loop", () => {
  // The simulated clock anchors to REAL today at local noon: stirring
  // expiry is also evaluated at read time against the real clock, so a
  // fixed past date would make every issued window honestly elapsed.
  const nowD = new Date();
  const T0 = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate(), 12, 0, 0).getTime();

  it("the daily throttle binds finds: at most one successful NPC find per space-local day", () => {
    const first = runNpcTick(handle, "loop-space", "harbor-controller", T0);
    expect(first.entry?.kind).toBe("explore");
    expect(first.entry?.act).toContain("Harbor Nail"); // a find, named — no longer the fixed string
    expect(new NpcRepo(handle, "loop-space").holdings("harbor-controller")).toEqual(["harbor-nail"]);
    const second = runNpcTick(handle, "loop-space", "harbor-controller", T0 + NPC_TICK_MIN_INTERVAL_MS + 1000);
    expect(second.entry?.kind).toBe("wait"); // today's explore is spent — no second attempt
    expect(new NpcRepo(handle, "loop-space").holdings("harbor-controller")).toEqual(["harbor-nail"]);
    const nextDay = runNpcTick(handle, "loop-space", "harbor-controller", T0 + 25 * 60 * 60 * 1000);
    expect(nextDay.entry?.kind).toBe("explore");
    expect(new NpcRepo(handle, "loop-space").holdings("harbor-controller")).toEqual(["harbor-nail", "mooring-ring"]);
    const npcCopies = handle.sqlite.prepare(
      `SELECT COUNT(*) AS n FROM relic_copies WHERE holder_kind = 'npc' AND holder_space_id = 'loop-space'`,
    ).get() as { n: number };
    expect(npcCopies.n).toBe(2);
  });

  it("arrival in a world evaluates issuance for the arrived space — one ambient stirring, delivered once", () => {
    const travel = new TravelRepo(handle, "arrival-space");
    const j = travel.depart({ clientKey: "i5-arrival", kind: "drift", destination: "great-station" }, T0);
    expect(travel.arrive(j.id, T0 + 60_000)?.state).toBe("arrived");
    const welcome = runNpcTick(handle, "arrival-space", "harbor-controller", T0 + 120_000);
    expect(welcome.entry?.kind).toBe("speak");
    const rows = stir().forSpace("arrival-space");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relic_id: "harbor-nail", source: "ambient", state: "open" });
    expect(new NotificationsRepo(handle, "arrival-space").list()).toHaveLength(1);
    // The next tick explores — and the controller binds the very copy its own brain was stirred toward
    // (supply is plentiful: courtesy guards only a pool's LAST copy under a live stirring).
    const explore = runNpcTick(handle, "arrival-space", "harbor-controller", T0 + 120_000 + NPC_TICK_MIN_INTERVAL_MS + 1000);
    expect(explore.entry?.kind).toBe("explore");
    expect(new NpcRepo(handle, "arrival-space").holdings("harbor-controller")).toEqual(["harbor-nail"]);
    const held = handle.sqlite.prepare(
      `SELECT copy_id FROM relic_copies WHERE holder_kind = 'npc' AND holder_space_id = 'arrival-space'`,
    ).get() as { copy_id: string };
    expect(held.copy_id).toBe(rows[0]!.copy_id);
    // The NPC took the very copy the brain's stirring promised: the
    // promise is exact (§3), so that stirring resolves quiet
    // ('copy-claimed') inside the award — and the SAME tick's
    // issuance evaluation (the loop evaluates after the act) finds
    // the world's ambient slot free and the relic still undiscovered
    // by the space itself, so a NEW stirring issues toward a new
    // copy (§5.4 re-eligibility). (This previously asserted exactly
    // one row — true only while the first stirring never resolved,
    // the I-5 supply-based behavior the follow-up replaces.)
    const after = stir().forSpace("arrival-space");
    expect(after).toHaveLength(2);
    expect(after[0]!.id).toBe(rows[0]!.id);
    expect(after[0]!.state).toBe("quiet");
    expect(after[0]!.resolved_reason).toBe("copy-claimed");
    expect(after[1]!.state).toBe("open");
    expect(after[1]!.relic_id).toBe("harbor-nail");
    expect(after[1]!.copy_id).not.toBe(rows[0]!.copy_id);
  });
});

describe("brain deletion: NPC-held copies leave with the brain (the exit I-2 deferred to unification)", () => {
  it("counted NPC copies return through their chains; the brain's private NPC copies are deleted with it", () => {
    const r = svc().claimForNpc("del-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    const nailCopy = r.status === "awarded" ? r.copyId : "";
    const genesis = handle.sqlite.prepare(
      `SELECT anchor_key FROM relic_copy_events WHERE copy_id = ? AND kind = 'genesis'`,
    ).get(nailCopy) as { anchor_key: string };
    // A private copy held by the same NPC (seeded the legacy way, converted by the backfill).
    new NpcRepo(handle, "del-space").addHolding("harbor-controller", "dawn-leaf", "growing-place");
    store().backfillCopies();
    const dawn = handle.sqlite.prepare(
      `SELECT copy_id FROM relic_copies WHERE holder_kind = 'npc' AND holder_space_id = 'del-space' AND relic_id = 'dawn-leaf'`,
    ).get() as { copy_id: string };
    expect(dawn).toBeTruthy();

    const out = store().releaseAllForSpace("del-space");
    expect(out.returnedCounted).toBeGreaterThanOrEqual(1);
    const nailAfter = copyRow(nailCopy);
    expect(nailAfter?.state === "placed" || nailAfter?.state === "return-pool").toBe(true);
    if (nailAfter?.state === "placed") expect(nailAfter.anchor_key).not.toBe(genesis.anchor_key); // never the same place twice
    expect(copyRow(dawn.copy_id)).toBeUndefined(); // private scope dies with its brain
    const kinds = handle.sqlite.prepare(
      `SELECT kind FROM relic_copy_events WHERE copy_id IN (?, ?) AND kind = 'brain-deleted'`,
    ).all(nailCopy, dawn.copy_id) as { kind: string }[];
    expect(kinds).toHaveLength(2);
  });
});

describe("P2-1 regression (I-5 review): courtesy supply reads backfill first — the dormant-volume edge", () => {
  /** A holding row exactly as pre-I-2 code wrote it (no copy bound): the
   *  dormant volume's truth — holdings exist, relic_copies does not know
   *  them yet, and NO relic read may have touched the volume since I-2. */
  function giveUnconverted(space: string, relicId: string): void {
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 0, 0, NULL, ?)`,
    ).run(space, relicId, `${relicId}:resting-place-one`);
  }
  const copiesOf = (relicId: string): number =>
    (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = ?`).get(relicId) as { n: number }).n;

  it("claimableSupply reports the converted truth on a dormant volume (the poolCount pattern)", () => {
    // Six of harbor-nail's seven copies are held on a pre-I-2 volume that
    // no relic read has touched since I-2: holdings exist, copies do not.
    for (let i = 0; i < 6; i++) giveUnconverted(`dormant-${i}`, "harbor-nail");
    expect(copiesOf("harbor-nail")).toBe(0);
    // The FIRST supply read must convert before it counts: six live
    // copies, none resting placed → supply = 0 resting + 1 room = 1.
    // (Pre-fix this read copies only and reported 7.)
    expect(store().claimableSupply("harbor-nail", null)).toBe(1);
    expect(copiesOf("harbor-nail")).toBe(6);
  });

  it("the last-copy courtesy engages on a dormant volume: the NPC is refused the true last copy under a live player stirring", () => {
    for (let i = 0; i < 6; i++) giveUnconverted(`dormant-${i}`, "harbor-nail");
    expect(copiesOf("harbor-nail")).toBe(0);
    // sP's stirring issuance furnishes the seventh copy placed — against
    // the CONVERTED pool (pre-fix it materialized against an empty read).
    const s = stir().issue("sP", "harbor-nail", "ambient")!;
    expect(s.state).toBe("open");
    // Isolate the NPC's candidate set to harbor-nail, as in the courtesy suite.
    new NpcRepo(handle, "npc-space").addHolding("harbor-controller", "mooring-ring", "great-station");
    // claimForNpc's courtesy read is the first supply read after issuance:
    // supply is truly 1 and the stirring is live → the NPC defers.
    // (Pre-fix the read saw 1 placed + 0 live and reported 7 — the NPC
    // took the copy the stirring had promised sP.)
    const deferred = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(deferred.status).toBe("deferred");
    expect(new NpcRepo(handle, "npc-space").holdings("harbor-controller")).toEqual(["mooring-ring"]);
    expect(store().poolCount("harbor-nail")).toBe(7);
    expect(stirringById(s.id).state).toBe("open");
    // …and the player the stirring promised still takes that very copy.
    const claim = sampledClaim("sP", "harbor-nail", "great-station", NAIL_POS);
    expect(claim.ok).toBe(true);
    if (claim.ok) expect(claim.copyId).toBe(s.copy_id);
    expect(stirringById(s.id).state).toBe("claimed");
  });

  it("ensurePlacedCopyInScope converts first too: issuance on a fully-held dormant volume promises nothing", () => {
    // All seven copies held, unconverted — there is nothing to promise.
    for (let i = 0; i < 7; i++) giveUnconverted(`dormant-${i}`, "harbor-nail");
    expect(store().ensurePlacedCopyInScope("harbor-nail", null, "sP")).toBeNull();
    expect(copiesOf("harbor-nail")).toBe(7); // the converted truth — and no eighth copy minted over the limit
  });
});

describe("RACE — the unified core under two processes (§8.1 #1, both claimer kinds)", () => {
  function runRaceChild(dbPath: string, mode: string, spaceId: string, goFile: string, readyFile: string): Promise<{ ok: boolean; status?: string; copyId?: string }> {
    return new Promise((resolve, reject) => {
      const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
      const child = fileURLToPath(new URL("./relicStirringRaceChild.mts", import.meta.url));
      const args = [cli, child, dbPath, mode, spaceId, goFile, readyFile];
      if (mode === "player") args.push(JSON.stringify(NAIL_POS));
      execFile(process.execPath, args, (err, stdout) => {
        if (err) return reject(err);
        const last = stdout.trim().split("\n").pop() ?? "";
        try { resolve(JSON.parse(last)); } catch { reject(new Error(`unparseable child output: ${stdout}`)); }
      });
    });
  }

  async function racePair(modeA: string, spaceA: string, modeB: string, spaceB: string) {
    const dir = mkdtempSync(join(tmpdir(), "relic-i5-race-"));
    const dbPath = join(dir, "brain.db");
    try {
      const h = createDb(dbPath);
      const s = new RelicHoldingsStore(h);
      for (let i = 0; i < 6; i++) expect(s.claimFind(`seed-${i}`, "harbor-nail", "great-station").ok).toBe(true);
      expect(s.poolAvailable("harbor-nail")).toBe(1);
      h.sqlite.close();
      const tag = Math.random().toString(36).slice(2);
      const goFile = join(dir, `go-${tag}`); const ready1 = join(dir, `ready-${tag}-1`); const ready2 = join(dir, `ready-${tag}-2`);
      const p1 = runRaceChild(dbPath, modeA, spaceA, goFile, ready1);
      const p2 = runRaceChild(dbPath, modeB, spaceB, goFile, ready2);
      const deadline = Date.now() + 20_000;
      while (!(existsSync(ready1) && existsSync(ready2))) {
        if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
        await new Promise((r) => setTimeout(r, 25));
      }
      writeFileSync(goFile, "go");
      const results = await Promise.all([p1, p2]);
      const h2 = createDb(dbPath);
      const pool = new RelicHoldingsStore(h2).poolCount("harbor-nail");
      const held = h2.sqlite.prepare(
        `SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'harbor-nail' AND state = 'held'`,
      ).get() as { n: number };
      h2.sqlite.close();
      return { results, pool, held: held.n };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  it("NPC vs NPC: exactly one controller takes the last copy; the loser is honestly refused", async () => {
    const { results, pool, held } = await racePair("npc", "npc-a", "npc", "npc-b");
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)[0]!.status).toBe("empty");
    expect(pool).toBe(7);
    expect(held).toBe(7); // six seeds + exactly one race winner
  }, 60_000);

  it("NPC vs player: the same core, the same last copy — exactly one winner across kinds", async () => {
    const { results, pool, held } = await racePair("npc", "npc-a", "player", "player-b");
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(pool).toBe(7);
    expect(held).toBe(7);
  }, 60_000);
});
