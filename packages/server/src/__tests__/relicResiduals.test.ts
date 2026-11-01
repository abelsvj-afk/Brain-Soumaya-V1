import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { computeRelicBuffs, seedEffectIdsForSpace, RELIC_SEED_EFFECTS } from "../relics/buffs.js";
import { RELIC_BASE, RELIC_BY_ID, RELIC_ANCHOR_POINTS, type RelicTierClass } from "@brain/shared";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Relics RESIDUALS SWEEP — closure evidence for the recorded P2s the
 * program carried out of its increments (owner directive 2026-10-30):
 *   Item 1 (I-4 P2-A): presence validation lived OUTSIDE the award
 *     transaction — the award could settle on a basis a racing claim
 *     had already pruned or superseded. Presence now validates
 *     inside the same IMMEDIATE transaction as the award.
 *   Item 2 (I-4 P2-B): recordOutcome's read-check-replace ran as
 *     separate autocommit statements — a racing committed receipt
 *     could be deleted and replaced by a non-committed refusal. It
 *     is one immediate transaction now.
 *   Item 3 (I-6 P2-1, latent): the rise-window loop read a Seed
 *     id's window from the HELD-effects map first. Each id now reads
 *     its own class's map. (Fixture: seed-map entries injected into
 *     the empty RELIC_SEED_EFFECTS for these tests only.)
 *   Item 4 (I-6 P2-2, latent): the NPC award core had no Seed
 *     disposition. Proven first in the I-6 fixture style (basin-stone
 *     reclassed `seed` inside this file only); since the tier
 *     rulings landed (2026-10-30) the tests below pin the SAME
 *     disposition against the real Seed class — the Mooring Ring —
 *     with no reclassing anywhere.
 *   Item 6 (I-5 P2-4, cosmetic): NPC brain-deleted events recorded
 *     anchor_key NULL where the player path records the holding's
 *     anchor. The NPC path now reads the copy's claim-event anchor.
 * Item 5 (I-5 P2-3 test gaps) and Item 7 (P2-B) land in
 * relicStirrings.test.ts, where the suites they strengthen live.
 * Item 8 (P2-5) is blocked-with-reason — see the sweep record.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const NAIL = RELIC_ANCHOR_POINTS["harbor-nail"]![0]!;
const NAIL_POS = NAIL.position as unknown as [number, number, number];
const RING = "mooring-ring";

function seedSample(space: string, world: string, pos: readonly number[], agoMs: number): void {
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, 'claim-start', ?)`)
    .run(space, world, pos[0], pos[1], pos[2], new Date(Date.now() - agoMs).toISOString());
}
const dwellStart = (space: string, pos: readonly number[] = NAIL_POS, agoMs = 6000) =>
  seedSample(space, "great-station", pos, agoMs);
const attemptRow = (space: string, claimId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_claim_attempts WHERE space_id = ? AND attempt_key = ?`).get(space, claimId) as
    { relic_id: string; copy_id: string | null; outcome: string } | undefined;
const copiesOf = (relicId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_copies WHERE relic_id = ? ORDER BY rowid ASC`).all(relicId) as
    { copy_id: string; state: string; holder_kind: string | null }[];
const eventsOf = (copyId: string) =>
  handle.sqlite.prepare(`SELECT kind, anchor_key, detail FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`).all(copyId) as
    { kind: string; anchor_key: string | null; detail: string | null }[];
const effectRows = (spaceId: string) =>
  handle.sqlite.prepare(`SELECT space_id, relic_id, copy_id FROM relic_seed_effects WHERE space_id = ?`).all(spaceId) as
    { space_id: string; relic_id: string; copy_id: string }[];

describe("Item 1 — presence is validated inside the award transaction (I-4 P2-A)", () => {
  it("atomicity: when the award throws mid-claim, the claim leaves NOTHING behind — no claim-end sample, no receipt, no holding", () => {
    dwellStart("s1");
    // Sabotage the award's holding insert: the claim must fail as
    // one unit. Before the closure, the claim-end sample was
    // stamped OUTSIDE the transaction and survived the rollback —
    // evidence of a claim that never settled, written by a code
    // path that had already decided nothing else would persist.
    handle.sqlite.exec(`CREATE TRIGGER relic_residuals_sabotage BEFORE INSERT ON relic_holdings BEGIN SELECT RAISE(ABORT, 'sabotage'); END`);
    expect(() => svc().claim("s1", "harbor-nail", "atomic-1", NAIL_POS, "great-station")).toThrow();
    handle.sqlite.exec(`DROP TRIGGER relic_residuals_sabotage`);
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_position_samples WHERE space_id = 's1' AND kind = 'claim-end'`).get()).toEqual({ n: 0 });
    expect(attemptRow("s1", "atomic-1")).toBeUndefined();
    expect(store().foundIds("s1")).toEqual([]);
    // The claim-start the hunter earned before the claim is untouched.
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_position_samples WHERE space_id = 's1' AND kind = 'claim-start'`).get()).toEqual({ n: 1 });
  });

  it("parity: a no-presence refusal still leaves exactly the records it always left — the claim-end sample and a non-committed receipt", () => {
    const out = svc().claim("s1", "harbor-nail", "np-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("no-presence");
    expect(handle.sqlite.prepare(`SELECT kind FROM relic_position_samples WHERE space_id = 's1'`).all()).toEqual([{ kind: "claim-end" }]);
    expect(JSON.parse(attemptRow("s1", "np-1")!.outcome)).toMatchObject({ ok: false, kind: "no-presence", committed: false });
    expect(store().foundIds("s1")).toEqual([]);
  });

  it("parity: a valid claim's receipt is committed with its plausibility verdict, and a replay returns it untouched", () => {
    dwellStart("s1");
    const out = svc().claim("s1", "harbor-nail", "ok-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(true);
    const outcome = JSON.parse(attemptRow("s1", "ok-1")!.outcome) as { committed?: boolean; plausibility?: { enforced: boolean } };
    expect(outcome.committed).toBe(true);
    expect(outcome.plausibility).toMatchObject({ enforced: false });
    expect(svc().claim("s1", "harbor-nail", "ok-1", NAIL_POS, "great-station")).toMatchObject({ ok: true, replayed: true });
  });
});

describe("Item 2 — recordOutcome is transactional with the claim it records (I-4 P2-B)", () => {
  type RecordOutcome = (spaceId: string, claimId: string, relicId: string, outcome: Record<string, unknown>) => { committed?: boolean };
  const recordOutcome = () => (svc() as unknown as { recordOutcome: RecordOutcome }).recordOutcome.bind(svc());

  it("a committed receipt is never replaced by a later non-committed recording, and another relic's row is never recorded over", () => {
    const rec = recordOutcome();
    rec("s1", "k1", "harbor-nail", { ok: true, alreadyFound: false, awarded: true, copyId: "rc_x", committed: true });
    const after = rec("s1", "k1", "harbor-nail", { ok: false, kind: "wrong-world", reason: "x", committed: false });
    expect(after.committed).toBe(true);
    expect(JSON.parse(attemptRow("s1", "k1")!.outcome)).toMatchObject({ ok: true, committed: true });
    const cross = rec("s1", "k1", "mooring-ring", { ok: false, kind: "wrong-world", reason: "x", committed: false });
    expect(cross.committed).toBe(false);
    expect(attemptRow("s1", "k1")!.relic_id).toBe("harbor-nail");
  });

  it("a non-committed row still yields to the newer outcome — the replace semantics are unchanged, only serialized", () => {
    const rec = recordOutcome();
    rec("s1", "k2", "harbor-nail", { ok: false, kind: "wrong-world", reason: "first", committed: false });
    rec("s1", "k2", "harbor-nail", { ok: false, kind: "no-presence", reason: "second", committed: false });
    expect(JSON.parse(attemptRow("s1", "k2")!.outcome)).toMatchObject({ ok: false, kind: "no-presence", reason: "second", committed: false });
  });
});

describe("Item 3 — the rise window reads each id's window from its own class's map (I-6 P2-1)", () => {
  const seedMap = RELIC_SEED_EFFECTS as unknown as Record<string, { riseWindowDays?: number }>;
  afterEach(() => { delete seedMap["witness-seed"]; delete seedMap["harbor-nail"]; delete seedMap["thread-of-many"]; });

  it("a Seed id's window comes from the SEED map — not from the held map's entry for the same relic", () => {
    // witness-seed carries a held-map window (45) today; the day its
    // Seed effect is authored with its own window, the Seed window
    // is the one that must win for a consumed Seed.
    seedMap["witness-seed"] = { riseWindowDays: 99 };
    const b = computeRelicBuffs([], ["witness-seed"]);
    expect(b.riseWindowDays).toBe(99);
    expect(b.riseWindowSetBy).toBe("witness-seed");
  });

  it("a held id's window still comes from the HELD map — and never falls back into the seed map", () => {
    expect(computeRelicBuffs(["witness-seed"], []).riseWindowDays).toBe(45);
    seedMap["harbor-nail"] = { riseWindowDays: 77 };
    expect(computeRelicBuffs(["harbor-nail"], []).riseWindowDays).toBe(RELIC_BASE.riseWindowDays);
  });

  it("cross-class ordering still names the winner and the overruled", () => {
    seedMap["thread-of-many"] = { riseWindowDays: 12 };
    const b = computeRelicBuffs(["witness-seed"], ["thread-of-many"]);
    expect(b.riseWindowDays).toBe(12);
    expect(b.riseWindowSetBy).toBe("thread-of-many");
    expect(b.riseWindowOverruled).toEqual(["witness-seed"]);
  });
});

describe("Items 4 + 6 — the NPC core's class disposition and records (I-6 P2-2, I-5 P2-4)", () => {
  // Tier implementation (2026-10-30): no fixture reclassing — the
  // Mooring Ring IS a Seed in the shipped registry now, and the NPC
  // disposition is pinned against the real class assignment.

  it("an NPC claim on a Seed-class relic consumes the copy: effect recorded against the NPC's space, nothing held anywhere", () => {
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", RING);
    expect(r.status).toBe("awarded"); // the find is the claim service's answer; the disposition happened inside the award
    if (r.status !== "awarded") return;
    const copies = copiesOf(RING);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.state).toBe("consumed");
    expect(copies[0]!.copy_id).toBe(r.copyId);
    expect(copies[0]!.holder_kind).toBeNull();
    // The chain tells the same story a player's Seed claim tells,
    // with the claiming NPC named on the consumption.
    expect(eventsOf(r.copyId).map((e) => e.kind)).toEqual(["genesis", "placed", "claimed", "consumed"]);
    expect(JSON.parse(eventsOf(r.copyId).at(-1)!.detail ?? "{}")).toMatchObject({ effectRecorded: true, npcId: "harbor-controller" });
    // No holding — for the NPC (read model) or the space (player Hold).
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM npc_relic_holdings WHERE space_id = 'npc-space'`).get()).toEqual({ n: 0 });
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 'npc-space'`).get()).toEqual({ n: 0 });
    // The effect is recorded against the NPC's space — the space the
    // consumption happened in, the player core's own key.
    expect(effectRows("npc-space")).toEqual([{ space_id: "npc-space", relic_id: RING, copy_id: r.copyId }]);
    expect(seedEffectIdsForSpace(handle, "npc-space")).toEqual([RING]);
  });

  it("the award core names the disposition, and a duplicate NPC Seed claim consumes without effect (R3-3 parity)", () => {
    const run = handle.sqlite.transaction(() => store().awardCopyForNpcInTransaction("npc-space", "npc-1", RING));
    const first = run.immediate();
    expect(first.status).toBe("seed-consumed");
    const second = handle.sqlite.transaction(() => store().awardCopyForNpcInTransaction("npc-space", "npc-2", RING)).immediate();
    expect(second.status).toBe("seed-consumed");
    if (second.status === "seed-consumed") expect(second.duplicate).toBe(true);
    expect(copiesOf(RING).filter((c) => c.state === "consumed")).toHaveLength(2);
    expect(effectRows("npc-space")).toHaveLength(1);
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM npc_relic_holdings WHERE space_id = 'npc-space'`).get()).toEqual({ n: 0 });
  });

  it("an NPC-held copy's brain-deleted event records the anchor it was claimed at — the player path's record, aligned", () => {
    const r = svc().claimForNpc("brain", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    if (r.status !== "awarded") return;
    const claimed = eventsOf(r.copyId).find((e) => e.kind === "claimed")!;
    expect(claimed.anchor_key).toBeTruthy();
    store().releaseAllForSpace("brain");
    // Before the alignment this event carried anchor_key NULL: the
    // held copy row keeps no anchor (binding clears it), and the
    // NPC path read the row. The claim event kept it all along.
    const deleted = eventsOf(r.copyId).find((e) => e.kind === "brain-deleted")!;
    expect(deleted.anchor_key).toBe(claimed.anchor_key);
    const copy = copiesOf("harbor-nail").find((c) => c.copy_id === r.copyId)!;
    expect(copy.state).not.toBe("held");
    expect(copy.holder_kind).toBeNull();
  });
});

describe("RACE — recordOutcome under two processes (Item 2): a committed receipt is never clobbered", () => {
  function runChild(dbPath: string, mode: string, spaceId: string, goFile: string, readyFile: string): Promise<{ ok?: boolean; copyId?: string; done?: boolean }> {
    return new Promise((resolve, reject) => {
      const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
      const child = fileURLToPath(new URL("./relicResidualsRaceChild.mts", import.meta.url));
      execFile(process.execPath, [cli, child, dbPath, mode, spaceId, goFile, readyFile, JSON.stringify(NAIL_POS)], (err, stdout) => {
        if (err) return reject(err);
        const last = stdout.trim().split("\n").pop() ?? "";
        try { resolve(JSON.parse(last)); } catch { reject(new Error(`unparseable child output: ${stdout}`)); }
      });
    });
  }

  it("award vs a 400-claim refusal loop on the same key: the final receipt is the committed award, every round", async () => {
    const ROUNDS = 8;
    for (let round = 0; round < ROUNDS; round++) {
      const dir = mkdtempSync(join(tmpdir(), "relic-residuals-race-"));
      const dbPath = join(dir, "brain.db");
      try {
        // The parent creates the schema first (the stirring race's
        // discipline): two children migrating a fresh file at once
        // race the DDL itself, which is not the race under test.
        createDb(dbPath).sqlite.close();
        const tag = Math.random().toString(36).slice(2);
        const goFile = join(dir, `go-${tag}`); const ready1 = join(dir, `ready-${tag}-1`); const ready2 = join(dir, `ready-${tag}-2`);
        const pAward = runChild(dbPath, "award", "race-space", goFile, ready1);
        const pRefuse = runChild(dbPath, "refuse", "race-space", goFile, ready2);
        const deadline = Date.now() + 20_000;
        while (!(existsSync(ready1) && existsSync(ready2))) {
          if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
          await new Promise((r) => setTimeout(r, 25));
        }
        writeFileSync(goFile, "go");
        const [award] = await Promise.all([pAward, pRefuse]);
        expect(award.ok).toBe(true);
        const h2 = createDb(dbPath);
        const row = h2.sqlite.prepare(`SELECT * FROM relic_claim_attempts WHERE space_id = 'race-space' AND attempt_key = 'race-key'`).get() as
          { copy_id: string | null; outcome: string } | undefined;
        expect(row).toBeDefined();
        // The invariant the P2 named: whatever the serialization,
        // the settled record of this key is the COMMITTED award —
        // never a refusal that overwrote it after the fact.
        expect(JSON.parse(row!.outcome)).toMatchObject({ ok: true, committed: true });
        expect(row!.copy_id).toBe(award.copyId);
        expect(h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 'race-space' AND relic_id = 'harbor-nail'`).get()).toEqual({ n: 1 });
        h2.sqlite.close();
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  }, 240_000);
});
