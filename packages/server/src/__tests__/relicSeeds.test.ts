import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { buffsForSpace, computeRelicBuffs, seedEffectIdsForSpace } from "../relics/buffs.js";
import { RELIC_BY_ID, RELIC_ANCHOR_POINTS, type RelicTierClass } from "@brain/shared";

/**
 * Relics I-6 acceptance evidence, Seeds (implementation design §4.5,
 * §5.2 step 5, §7 I-6; approved design R2-1/R3-3 + §8.1 #10/#11):
 * disposition is class-specific — a claimed Seed is consumed inside
 * the claim transaction, its permanent effect recorded exactly once
 * (the relic_seed_effects primary key IS the idempotency), a duplicate
 * consumed without effect and without returning to the world, and no
 * owned copy EVER appears in the Hold. computeRelicBuffs gains its
 * second input (the space's recorded Seed effects) shipping with an
 * EMPTY effect map: the plumbing is live, behavior is identical.
 *
 * Fixture: basin-stone is reclassed `seed` for this file only (the
 * shipped registry is untouched; the original value is restored).
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const basinDef = RELIC_BY_ID.get("basin-stone")!;
let basinClass: RelicTierClass | null = null;
beforeAll(() => { basinClass = basinDef.tierClass; basinDef.tierClass = "seed"; });
afterAll(() => { basinDef.tierClass = basinClass; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const BASIN = "basin-stone";
const BASIN_POS = RELIC_ANCHOR_POINTS[BASIN]![0]!.position as unknown as [number, number, number];

interface CopyRowT { copy_id: string; relic_id: string; state: string; anchor_key: string | null; holder_kind: string | null }
const copiesOf = (relicId: string): CopyRowT[] =>
  // Insertion order (rowid), not created_at: two copies minted in the
  // same millisecond share a created_at stamp, and a UUID tiebreak
  // would scramble genesis order nondeterministically.
  handle.sqlite.prepare(`SELECT * FROM relic_copies WHERE relic_id = ? ORDER BY rowid ASC`).all(relicId) as CopyRowT[];
const liveCopies = (relicId: string): CopyRowT[] =>
  copiesOf(relicId).filter((c) => ["placed", "held", "return-pool"].includes(c.state));
const eventsOf = (copyId: string): { kind: string; detail: string | null }[] =>
  handle.sqlite.prepare(`SELECT kind, detail FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`).all(copyId) as { kind: string; detail: string | null }[];
const effectRows = (spaceId: string): { space_id: string; relic_id: string; copy_id: string }[] =>
  handle.sqlite.prepare(`SELECT space_id, relic_id, copy_id FROM relic_seed_effects WHERE space_id = ?`).all(spaceId) as { space_id: string; relic_id: string; copy_id: string }[];

function seedSample(space: string, world: string, pos: readonly number[], agoMs: number): void {
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, 'claim-start', ?)`)
    .run(space, world, pos[0], pos[1], pos[2], new Date(Date.now() - agoMs).toISOString());
}
let claimCounter = 0;
function sampledClaim(space: string, relicId: string, world: string, pos: readonly number[]) {
  seedSample(space, world, pos, 6000);
  return svc().claim(space, relicId, `seed-t-${space}-${++claimCounter}`, pos as [number, number, number], world);
}

describe("Seed disposition — consumed on claim, never in the Hold (§8.1 #11)", () => {
  it("a Seed claim consumes its copy in the claim transaction: effect recorded once, no holding ever, discovery still written", () => {
    const out = store().claimFind("s1", BASIN, "deep-past");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rewardAmount).toBeGreaterThan(0);
    // No owned copy ever exists — the Hold is relic_holdings, and it stays empty.
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 's1'`).get()).toEqual({ n: 0 });
    expect(store().foundIds("s1")).not.toContain(BASIN);
    // The copy exists exactly once, in its terminal state, holder cleared.
    const copies = copiesOf(BASIN);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.state).toBe("consumed");
    expect(copies[0]!.holder_kind).toBeNull();
    // Its chain tells the whole story: genesis → placed → claimed → consumed.
    const kinds = eventsOf(copies[0]!.copy_id).map((e) => e.kind);
    expect(kinds).toEqual(["genesis", "placed", "claimed", "consumed"]);
    const consumed = eventsOf(copies[0]!.copy_id).at(-1)!;
    expect(JSON.parse(consumed.detail ?? "{}")).toMatchObject({ effectRecorded: true });
    // The permanent effect is recorded, naming the very copy that created it.
    expect(effectRows("s1")).toEqual([{ space_id: "s1", relic_id: BASIN, copy_id: copies[0]!.copy_id }]);
    // Personal discovery (the Codex claim, L2) is written like every claim's.
    const codex = handle.sqlite.prepare(`SELECT 1 AS x FROM codex_claims WHERE space_id = 's1' AND reward_key = 'relic-basin-stone'`).get();
    expect(codex).toBeTruthy();
    // The consumed copy is out of the pool for good.
    expect(liveCopies(BASIN)).toHaveLength(0);
  });

  it("the sampled claim path records the disposition on its receipt (seed-consumed)", () => {
    const out = sampledClaim("s2", BASIN, "deep-past", BASIN_POS);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.disposition).toBe("seed-consumed");
    const receipt = handle.sqlite.prepare(`SELECT outcome FROM relic_claim_attempts WHERE space_id = 's2'`).get() as { outcome: string };
    expect(JSON.parse(receipt.outcome)).toMatchObject({ ok: true, disposition: "seed-consumed" });
    expect(effectRows("s2")).toHaveLength(1);
    expect(copiesOf(BASIN).filter((c) => c.state === "consumed")).toHaveLength(1);
  });
});

describe("Duplicate Seed — consumed without effect and without returning (§8.1 #10, R3-3)", () => {
  it("a second claim consumes a second copy: no second effect, no Hold entry, no return to the pool", () => {
    expect(store().claimFind("s1", BASIN, "deep-past").ok).toBe(true);
    const first = copiesOf(BASIN)[0]!;
    const dup = store().claimFind("s1", BASIN, "deep-past");
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.rewardAmount).toBe(0); // discovery already recorded — no second payout
    const copies = copiesOf(BASIN);
    expect(copies).toHaveLength(2);
    expect(copies.every((c) => c.state === "consumed")).toBe(true);
    expect(copies[1]!.copy_id).not.toBe(first.copy_id);
    const dupEvent = eventsOf(copies[1]!.copy_id).at(-1)!;
    expect(dupEvent.kind).toBe("consumed");
    expect(JSON.parse(dupEvent.detail ?? "{}")).toMatchObject({ effectRecorded: false });
    // The effect is still exactly the first copy's, recorded exactly once.
    expect(effectRows("s1")).toEqual([{ space_id: "s1", relic_id: BASIN, copy_id: first.copy_id }]);
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 's1'`).get()).toEqual({ n: 0 });
    expect(liveCopies(BASIN)).toHaveLength(0);
  });

  it("the sampled path names the duplicate honestly (seed-consumed-duplicate)", () => {
    expect(sampledClaim("s3", BASIN, "deep-past", BASIN_POS).ok).toBe(true);
    const dup = sampledClaim("s3", BASIN, "deep-past", BASIN_POS);
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.disposition).toBe("seed-consumed-duplicate");
    expect(effectRows("s3")).toHaveLength(1);
    expect(copiesOf(BASIN).filter((c) => c.state === "consumed")).toHaveLength(2);
  });

  it("seed effects are per-space: another brain's consumption is its own record", () => {
    expect(store().claimFind("sA", BASIN, "deep-past").ok).toBe(true);
    expect(store().claimFind("sB", BASIN, "deep-past").ok).toBe(true);
    expect(effectRows("sA")).toHaveLength(1);
    expect(effectRows("sB")).toHaveLength(1);
    expect(effectRows("sA")[0]!.copy_id).not.toBe(effectRows("sB")[0]!.copy_id);
    expect(seedEffectIdsForSpace(handle, "sA")).toEqual([BASIN]);
    expect(seedEffectIdsForSpace(handle, "sB")).toEqual([BASIN]);
    expect(seedEffectIdsForSpace(handle, "sC")).toEqual([]);
  });
});

describe("computeRelicBuffs second input — plumbing live, effect map empty (§4.5)", () => {
  it("the second input flows through buffsForSpace and changes nothing while the Seed-effect map is empty", () => {
    // Identical with no second input, an empty one, or a recorded id:
    // no effect VALUES exist yet (the worksheet owns them), so a Seed
    // id contributes nothing — the seam is live, behavior is identical.
    const held = ["harbor-nail", "thread-of-many"];
    expect(computeRelicBuffs(held, [])).toEqual(computeRelicBuffs(held));
    expect(computeRelicBuffs(held, [BASIN])).toEqual(computeRelicBuffs(held));
    // A recorded effect row reaches computeRelicBuffs via buffsForSpace:
    // hold the Nail (its held effect is real), record a Seed effect for
    // the same definition directly — the buffs must NOT double or drift.
    expect(store().claimFind("s9", "harbor-nail", "great-station").ok).toBe(true);
    expect(store().hold("s9", "harbor-nail").ok).toBe(true);
    const before = buffsForSpace(handle, "s9");
    handle.sqlite.prepare(`INSERT INTO relic_seed_effects (space_id, relic_id, copy_id) VALUES ('s9', 'harbor-nail', 'rc_fixture')`).run();
    expect(seedEffectIdsForSpace(handle, "s9")).toEqual(["harbor-nail"]);
    expect(buffsForSpace(handle, "s9")).toEqual(before);
    expect(buffsForSpace(handle, "s9")).toEqual(computeRelicBuffs(["harbor-nail"], ["harbor-nail"]));
  });
});
