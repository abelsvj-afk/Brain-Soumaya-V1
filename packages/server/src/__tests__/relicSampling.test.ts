import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { buffsForSpace } from "../relics/buffs.js";
import { EconomyRepo } from "../economy.js";
import { SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { RELIC_ANCHOR_POINTS, RELIC_SCAN_WIDEN_COST } from "@brain/shared";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Relics I-4 acceptance evidence (implementation design §4.7, §5.2, §5.3,
 * §7 I-4; approved design §4.2 + §8.1 #2/#3/#4/#5/#8): the hunt's core
 * loop becomes enforceable. Presence is proven from position samples the
 * SERVER stamps on receipt; dwell is the difference of server receipt
 * times; the claim is one atomic transaction that pays its own reward
 * and writes its own receipt; speed plausibility is measured, recorded,
 * and — per owner ruling 3 — OBSERVE-ONLY in this increment (the deploy
 * branch has no client flight model to calibrate enforcement against).
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const NAIL = RELIC_ANCHOR_POINTS["harbor-nail"]![0]!; // [210, 38, 0] lower-rim
const NAIL_B = RELIC_ANCHOR_POINTS["harbor-nail"]![1]!; // rim-seam-2, ~183 away
const NAIL_POS = NAIL.position as unknown as [number, number, number];
const NAIL_B_POS = NAIL_B.position as unknown as [number, number, number];

/** A sample exactly as the server's table holds it, with a chosen receipt time (tests simulate elapsed SERVER time by the stamp, never by a client-reported duration). */
function seedSample(space: string, world: string, pos: readonly number[], kind: string, agoMs: number): void {
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(space, world, pos[0], pos[1], pos[2], kind, new Date(Date.now() - agoMs).toISOString());
}
const dwellStart = (space: string, pos: readonly number[] = NAIL_POS, agoMs = 6000) =>
  seedSample(space, "great-station", pos, "claim-start", agoMs);

const attemptRow = (space: string, claimId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_claim_attempts WHERE space_id = ? AND attempt_key = ?`).get(space, claimId) as
    { relic_id: string; copy_id: string | null; outcome: string } | undefined;
const layerRows = (space: string, relicId: string) =>
  handle.sqlite.prepare(`SELECT * FROM relic_codex_layers WHERE space_id = ? AND relic_id = ?`).all(space, relicId) as { layer: string; source: string }[];

describe("schema (I-4, both places + census)", () => {
  it("relic_position_samples + relic_claim_attempts + relic_codex_layers + relic_first_discoveries exist with the designed columns and join the space census", () => {
    const cols = (t: string) => (handle.sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("relic_position_samples")).toEqual(expect.arrayContaining(["id", "space_id", "world", "x", "y", "z", "kind", "received_at"]));
    expect(cols("relic_claim_attempts")).toEqual(expect.arrayContaining(["space_id", "attempt_key", "relic_id", "copy_id", "outcome", "created_at"]));
    expect(cols("relic_codex_layers")).toEqual(expect.arrayContaining(["space_id", "relic_id", "layer", "thread_id", "source", "unlocked_at"]));
    expect(cols("relic_first_discoveries")).toEqual(expect.arrayContaining(["scope", "relic_id", "copy_id", "space_id", "world", "anchor_key", "discovered_at"]));
    for (const t of ["relic_position_samples", "relic_claim_attempts", "relic_codex_layers", "relic_first_discoveries"]) {
      expect(SPACE_SCOPED_TABLES).toContain(t);
    }
  });
});

describe("samples + L1 arrival (§5.2 step 1, §4.4)", () => {
  it("a claim-start sample inside an anchor's radius is accepted and writes the L1 unlock (source='arrival'), once", () => {
    expect(layerRows("s1", "harbor-nail")).toEqual([]);
    const out = svc().recordSample("s1", "great-station", NAIL_POS, "claim-start");
    expect(out.ok).toBe(true);
    expect(out.relicIds).toContain("harbor-nail");
    const rows = layerRows("s1", "harbor-nail");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ layer: "L1", source: "arrival" });
    const again = svc().recordSample("s1", "great-station", NAIL_POS, "claim-start");
    expect(again.ok).toBe(true);
    expect(layerRows("s1", "harbor-nail")).toHaveLength(1); // insert-or-ignore: monotonic, never duplicated
  });

  it("radius boundary: a sample exactly at the radius is inside; just beyond it is refused plainly", () => {
    const atEdge: [number, number, number] = [NAIL_POS[0] + 30, NAIL_POS[1], NAIL_POS[2]];
    expect(svc().recordSample("s1", "great-station", atEdge, "claim-start").ok).toBe(true);
    const beyond: [number, number, number] = [NAIL_POS[0] + 31, NAIL_POS[1], NAIL_POS[2]];
    const out = svc().recordSample("s1", "great-station", beyond, "claim-start");
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
  });

  it("samples prune to the most recent 20 per (space, world)", () => {
    for (let i = 0; i < 25; i++) svc().recordSample("s1", "great-station", NAIL_POS, "claim-start");
    const n = (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_position_samples WHERE space_id = 's1' AND world = 'great-station'`).get() as { n: number }).n;
    expect(n).toBe(20);
  });
});

describe("scan (§5.3)", () => {
  it("returns band + bearing only — never coordinates, never a distance", () => {
    const out = svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", false);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.band).toBe("Resonant");
    expect(out.bearing).toBe(NAIL.placeName);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/distance|coordinates|position/);
    expect(json).not.toContain("210");
  });

  it("bands coarsen with distance: Near, Warm, Far", () => {
    const near = svc().scan("s1", "harbor-nail", [NAIL_POS[0] + 60, NAIL_POS[1], NAIL_POS[2]], "great-station", false);
    expect(near.ok && near.band).toBe("Near");
    // step past the 3 s cooldown by backdating the scan samples between pulses
    const ageScans = () => handle.sqlite.prepare(`UPDATE relic_position_samples SET received_at = ? WHERE kind = 'scan'`).run(new Date(Date.now() - 4000).toISOString());
    ageScans();
    const warm = svc().scan("s1", "harbor-nail", [NAIL_POS[0] + 150, NAIL_POS[1], NAIL_POS[2]], "great-station", false);
    expect(warm.ok && warm.band).toBe("Warm");
    ageScans();
    const far = svc().scan("s1", "harbor-nail", [NAIL_POS[0] + 400, NAIL_POS[1], NAIL_POS[2]], "great-station", false);
    expect(far.ok && far.band).toBe("Far");
  });

  it("cooldown: a second free pulse inside 3 s is refused (per space+world — samples carry no relic column); widening waives it and charges Fuel", () => {
    expect(svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", false).ok).toBe(true);
    const second = svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", false);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.kind).toBe("cooldown");
    // per-(space, world): a different relic in the same world cools down too (documented I-4 deviation from §5.3's per-relic wording — the §4.7 schema has no relic column on samples)
    const other = svc().scan("s1", "mooring-ring", NAIL_POS, "great-station", false);
    expect(other.ok).toBe(false);
    const balBefore = new EconomyRepo(handle, "s1").get();
    const wide = svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", true);
    expect(wide.ok).toBe(true);
    if (wide.ok) expect(wide.widened).toBe(true);
    const balAfter = new EconomyRepo(handle, "s1").get();
    expect(balBefore - balAfter).toBeCloseTo(RELIC_SCAN_WIDEN_COST, 1);
  });

  it("widened granularity is finer within the same information class (a band, still no numbers)", () => {
    const mid: [number, number, number] = [NAIL_POS[0] + 105, NAIL_POS[1], NAIL_POS[2]]; // between Near (90) and Warm (220)
    const free = svc().scan("s1", "harbor-nail", mid, "great-station", false);
    expect(free.ok && free.band).toBe("Warm");
    const wide = svc().scan("s1", "harbor-nail", mid, "great-station", true);
    expect(wide.ok && wide.band).toBe("Closing");
  });

  it("an unpayable widening still fires the free pulse — refusal is never the outcome of an optional upgrade", () => {
    const eco = new EconomyRepo(handle, "s1");
    eco.spend(eco.get()); // drain to zero
    expect(eco.get()).toBe(0);
    const out = svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", true);
    expect(out.ok).toBe(true);
    if (out.ok) { expect(out.widened).toBe(false); expect(out.band).toBe("Resonant"); }
  });

  it("wrong world and unknown relic are refused; an exhausted pool answers honestly quiet — no fabricated signal", () => {
    const wrong = svc().scan("s1", "harbor-nail", NAIL_POS, "deep-past", false);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.kind).toBe("wrong-world");
    const unknown = svc().scan("s1", "no-such-relic", NAIL_POS, "great-station", false);
    expect(unknown.ok).toBe(false);
    for (let i = 0; i < 7; i++) expect(store().claimFind(`hunter-${i}`, "harbor-nail", "great-station").ok).toBe(true);
    const quiet = svc().scan("latecomer", "harbor-nail", NAIL_POS, "great-station", false);
    expect(quiet.ok).toBe(true);
    if (quiet.ok) { expect(quiet.quiet).toBe(true); expect(quiet.band).toBeNull(); expect(quiet.bearing).toBeNull(); }
  });
});

describe("claim (§5.2) — the honest claim", () => {
  it("happy path: dwell from receipt times → one atomic award — holding, copy event, discovery, first-discovery, reward paid inside, receipt written", () => {
    const balBefore = new EconomyRepo(handle, "s1").get();
    dwellStart("s1");
    const out = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.alreadyFound).toBe(false);
    expect(out.awarded).toBe(true);
    expect(out.replayed).toBe(false);
    expect(store().foundIds("s1")).toEqual(["harbor-nail"]);
    const balAfter = new EconomyRepo(handle, "s1").get();
    expect(balAfter).toBeGreaterThan(balBefore); // the discovery reward moved with the claim, not after it
    const copyId = out.copyId!;
    const claimed = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copy_events WHERE copy_id = ? AND kind = 'claimed'`).get(copyId) as { n: number };
    expect(claimed.n).toBe(1);
    const first = handle.sqlite.prepare(`SELECT * FROM relic_first_discoveries WHERE relic_id = 'harbor-nail'`).all() as { scope: string; space_id: string; anchor_key: string }[];
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ scope: "public", space_id: "s1", anchor_key: NAIL.anchorKey });
    const receipt = attemptRow("s1", "claim-1");
    expect(receipt?.copy_id).toBe(copyId);
    expect(JSON.parse(receipt!.outcome)).toMatchObject({ ok: true, awarded: true });
  });

  it("#2 replay: the same claimId returns the recorded outcome verbatim — no second copy, no second payment", () => {
    dwellStart("s1");
    const first = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(first.ok).toBe(true);
    const balAfterFirst = new EconomyRepo(handle, "s1").get();
    const replay = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(replay.ok).toBe(true);
    if (replay.ok) { expect(replay.replayed).toBe(true); expect(replay.copyId).toBe(first.ok ? first.copyId : null); }
    expect(new EconomyRepo(handle, "s1").get()).toBeCloseTo(balAfterFirst, 5);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE space_id = 's1'`).get() as { n: number }).n).toBe(1);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copy_events WHERE kind = 'claimed'`).get() as { n: number }).n).toBe(1);
  });

  it("a fresh claimId from a space that already found it answers already-found — no dwell demanded, nothing paid", () => {
    dwellStart("s1");
    expect(svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station").ok).toBe(true);
    const bal = new EconomyRepo(handle, "s1").get();
    const again = svc().claim("s1", "harbor-nail", "claim-2", NAIL_POS, "great-station");
    expect(again.ok).toBe(true);
    if (again.ok) { expect(again.alreadyFound).toBe(true); expect(again.awarded).toBe(false); }
    expect(new EconomyRepo(handle, "s1").get()).toBeCloseTo(bal, 5);
  });

  it("#5 forged dwell: 4 s of receipt time is not the 5 s dwell — and a client-reported duration changes nothing", () => {
    dwellStart("s1", NAIL_POS, 4000);
    const out = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("no-presence");
    expect(store().foundIds("s1")).toEqual([]);
    // the failed attempt is itself recorded, honestly
    expect(JSON.parse(attemptRow("s1", "claim-1")!.outcome)).toMatchObject({ ok: false, kind: "no-presence" });
  });

  it("#5 staleness: a dwell that ended minutes ago is not presence (freshness bound)", () => {
    dwellStart("s1", NAIL_POS, 300_000);
    const out = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("no-presence");
  });

  it("#4 forged position: claim-end outside the anchor's radius is rejected; start at one anchor, end at another is rejected; no samples at all is rejected", () => {
    dwellStart("s1");
    const farEnd = svc().claim("s1", "harbor-nail", "claim-1", [NAIL_POS[0] + 100, NAIL_POS[1], NAIL_POS[2]], "great-station");
    expect(farEnd.ok).toBe(false);
    if (!farEnd.ok) expect(farEnd.kind).toBe("no-presence");
    dwellStart("s2");
    const otherAnchor = svc().claim("s2", "harbor-nail", "claim-1", NAIL_B_POS, "great-station");
    expect(otherAnchor.ok).toBe(false);
    if (!otherAnchor.ok) expect(otherAnchor.kind).toBe("no-presence");
    const bare = svc().claim("s3", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.kind).toBe("no-presence");
  });

  it("wrong world is refused before presence is even read, and recorded", () => {
    dwellStart("s1");
    const out = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "deep-past");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("wrong-world");
    expect(JSON.parse(attemptRow("s1", "claim-1")!.outcome)).toMatchObject({ ok: false, kind: "wrong-world" });
  });

  it("plausibility is OBSERVE-ONLY (ruling 3): an impossible hop is recorded on the attempt — the claim itself still lands on radius + dwell", () => {
    seedSample("s1", "great-station", [3000, 38, 0], "scan", 7000); // ~2790 units away, 1 s before the dwell start
    dwellStart("s1", NAIL_POS, 6000);
    const out = svc().claim("s1", "harbor-nail", "claim-1", NAIL_POS, "great-station");
    expect(out.ok).toBe(true);
    const outcome = JSON.parse(attemptRow("s1", "claim-1")!.outcome) as { plausibility?: { enforced: boolean; wouldReject: boolean; maxSpeed: number; cap: number } };
    expect(outcome.plausibility).toMatchObject({ enforced: false, wouldReject: true });
    expect(outcome.plausibility!.maxSpeed).toBeGreaterThan(outcome.plausibility!.cap);
    // and the honest-path claim records a clean plausibility verdict
    dwellStart("s2");
    expect(svc().claim("s2", "harbor-nail", "claim-1", NAIL_POS, "great-station").ok).toBe(true);
    const clean = JSON.parse(attemptRow("s2", "claim-1")!.outcome) as { plausibility?: { wouldReject: boolean } };
    expect(clean.plausibility?.wouldReject).toBe(false);
  });

  it("#8 cross-space: another space's samples validate nothing, and receipts are scoped to their own space", () => {
    dwellStart("space-a");
    expect(svc().claim("space-a", "harbor-nail", "shared-id", NAIL_POS, "great-station").ok).toBe(true);
    // space-b has no samples of its own: space-a's dwell does not attach to it
    const forged = svc().claim("space-b", "harbor-nail", "shared-id", NAIL_POS, "great-station");
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.kind).toBe("no-presence");
    expect(store().foundIds("space-b")).toEqual([]);
    // space-b's own attempt row exists under its own space; space-a's receipt is untouched
    expect(JSON.parse(attemptRow("space-b", "shared-id")!.outcome)).toMatchObject({ ok: false });
    expect(JSON.parse(attemptRow("space-a", "shared-id")!.outcome)).toMatchObject({ ok: true });
    const sampleCount = (s: string) => (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_position_samples WHERE space_id = ?`).get(s) as { n: number }).n;
    expect(sampleCount("space-a")).toBeGreaterThan(0);
    expect(sampleCount("space-b")).toBe(1); // only its own claim-end sample
  });

  it("first-discovery is first-writer-wins", () => {
    dwellStart("s1");
    expect(svc().claim("s1", "harbor-nail", "c1", NAIL_POS, "great-station").ok).toBe(true);
    dwellStart("s2");
    expect(svc().claim("s2", "harbor-nail", "c2", NAIL_POS, "great-station").ok).toBe(true);
    const rows = handle.sqlite.prepare(`SELECT * FROM relic_first_discoveries WHERE relic_id = 'harbor-nail'`).all() as { space_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.space_id).toBe("s1");
  });
});

describe("review fixes (I-4 independent review, P1-1 / P1-2 / receipt semantics)", () => {
  it("P1-1: a claimId spent on one relic cannot replay its award for another — key conflict refused, original receipt untouched", () => {
    dwellStart("s1");
    expect(svc().claim("s1", "harbor-nail", "shared-key", NAIL_POS, "great-station").ok).toBe(true);
    const cross = svc().claim("s1", "mooring-ring", "shared-key", NAIL_POS, "great-station");
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.kind).toBe("malformed");
    expect(store().foundIds("s1")).toEqual(["harbor-nail"]);
    // the original claim still replays its own outcome verbatim
    const replay = svc().claim("s1", "harbor-nail", "shared-key", NAIL_POS, "great-station");
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.replayed).toBe(true);
    expect(JSON.parse(attemptRow("s1", "shared-key")!.outcome)).toMatchObject({ ok: true, awarded: true });
  });

  it("receipt semantics: a recorded REFUSAL does not trap the claimId — fix the mistake, retry the same key, land", () => {
    const refused = svc().claim("s1", "harbor-nail", "retry-key", NAIL_POS, "deep-past");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe("wrong-world");
    // the refusal IS recorded (outcome + reason), just not replayable
    expect(JSON.parse(attemptRow("s1", "retry-key")!.outcome)).toMatchObject({ ok: false, kind: "wrong-world" });
    dwellStart("s1");
    const landed = svc().claim("s1", "harbor-nail", "retry-key", NAIL_POS, "great-station");
    expect(landed.ok).toBe(true);
    // and now the key replays the committed outcome
    const replay = svc().claim("s1", "harbor-nail", "retry-key", NAIL_POS, "great-station");
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.replayed).toBe(true);
  });

  /** Place the pool deterministically: 6 held copies + 1 copy resting at rim-seam-2 — pool full, nothing can materialize. */
  function fullPoolCopyAtB(): void {
    for (let i = 0; i < 6; i++) {
      handle.sqlite.prepare(
        `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES (?, 'harbor-nail', 'held', NULL, NULL, 'space', ?, ?, NULL, 0)`,
      ).run(`rc-held-${i}`, `holder-${i}`, `holder-${i}`);
    }
    handle.sqlite.prepare(
      `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES ('rc-resting', 'harbor-nail', 'placed', 'great-station', ?, NULL, NULL, NULL, NULL, 0)`,
    ).run(NAIL_B.anchorKey);
  }

  it("P1-2: with a full pool, the scan senses the RESTING copy — no Resonant signal at an empty anchor", () => {
    fullPoolCopyAtB();
    expect(store().poolCount("harbor-nail")).toBe(7);
    const atEmpty = svc().scan("s1", "harbor-nail", NAIL_POS, "great-station", false);
    expect(atEmpty.ok).toBe(true);
    if (atEmpty.ok) {
      expect(atEmpty.band).not.toBe("Resonant");
      expect(atEmpty.bearing).toBe(NAIL_B.placeName); // the signal points at the copy that actually rests
    }
    const atResting = svc().scan("s2", "harbor-nail", NAIL_B_POS, "great-station", false);
    expect(atResting.ok).toBe(true);
    if (atResting.ok) { expect(atResting.band).toBe("Resonant"); expect(atResting.bearing).toBe(NAIL_B.placeName); }
  });

  it("P1-2: with a full pool, settling beside an EMPTY anchor is refused — beside the resting copy it is accepted", () => {
    fullPoolCopyAtB();
    expect(svc().recordSample("s1", "great-station", NAIL_POS, "claim-start").ok).toBe(false);
    expect(svc().recordSample("s1", "great-station", NAIL_B_POS, "claim-start").ok).toBe(true);
  });

  it("first-discovery: a test-only claim (owner scarcity switch) never writes the world record", () => {
    process.env.RELIC_OWNER_SPACE_IDS = "owner-space";
    expect(store().setScarcityOff("owner-space", true)).toBe(true);
    const ring = RELIC_ANCHOR_POINTS["mooring-ring"]![0]!;
    seedSample("owner-space", "great-station", ring.position, "claim-start", 6000);
    const out = svc().claim("owner-space", "mooring-ring", "tc-1", ring.position as unknown as [number, number, number], "great-station");
    expect(out.ok).toBe(true);
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_first_discoveries WHERE relic_id = 'mooring-ring'`).get() as { n: number }).toMatchObject({ n: 0 });
  });

  it("claim-end radius boundary: ending the dwell exactly at the radius lands; one unit beyond refuses", () => {
    dwellStart("s1");
    const atEdge = svc().claim("s1", "harbor-nail", "edge-1", [NAIL_POS[0] + 30, NAIL_POS[1], NAIL_POS[2]], "great-station");
    expect(atEdge.ok).toBe(true);
    dwellStart("s2");
    const beyond = svc().claim("s2", "harbor-nail", "edge-2", [NAIL_POS[0] + 31, NAIL_POS[1], NAIL_POS[2]], "great-station");
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.kind).toBe("no-presence");
  });
});

describe("RACE — two sampled claims for the final copy (§8.1 #1 on the sampling path)", () => {
  it("exactly one winner; the loser gets the honest empty-pool outcome, recorded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-sampling-race-"));
    const dbPath = join(dir, "brain.db");
    try {
      const h = createDb(dbPath);
      const s = new RelicHoldingsStore(h);
      for (let i = 0; i < 6; i++) expect(s.claimFind(`seed-${i}`, "harbor-nail", "great-station").ok).toBe(true);
      expect(s.poolAvailable("harbor-nail")).toBe(1);
      h.sqlite.close();

      const runChild = (spaceId: string, goFile: string, readyFile: string): Promise<{ ok: boolean; kind?: string }> =>
        new Promise((resolve, reject) => {
          const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
          const child = fileURLToPath(new URL("./relicSamplingRaceChild.mts", import.meta.url));
          execFile(process.execPath, [cli, child, dbPath, spaceId, "harbor-nail", "great-station", JSON.stringify(NAIL_POS), goFile, readyFile], (err, stdout) => {
            if (err) return reject(err);
            const last = stdout.trim().split("\n").pop() ?? "";
            try { resolve(JSON.parse(last)); } catch { reject(new Error(`unparseable child output: ${stdout}`)); }
          });
        });
      const tag = Math.random().toString(36).slice(2);
      const goFile = join(dir, `go-${tag}`); const ready1 = join(dir, `ready-${tag}-1`); const ready2 = join(dir, `ready-${tag}-2`);
      const p1 = runChild("racer-1", goFile, ready1);
      const p2 = runChild("racer-2", goFile, ready2);
      const deadline = Date.now() + 20_000;
      while (!(existsSync(ready1) && existsSync(ready2))) {
        if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
        await new Promise((r) => setTimeout(r, 25));
      }
      writeFileSync(goFile, "go");
      const [r1, r2] = await Promise.all([p1, p2]);
      expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
      expect([r1, r2].filter((r) => !r.ok)[0]!.kind).toBe("empty-pool");

      const h2 = createDb(dbPath);
      expect(new RelicHoldingsStore(h2).poolCount("harbor-nail")).toBe(7);
      const attempts = h2.sqlite.prepare(`SELECT outcome FROM relic_claim_attempts WHERE attempt_key LIKE 'race-%'`).all() as { outcome: string }[];
      expect(attempts).toHaveLength(2);
      expect(attempts.map((a) => JSON.parse(a.outcome).ok).sort()).toEqual([false, true]);
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

describe("re-review round 2 (I-4): binding at every receipt site, private placed copies, quiet cooldown, finite speeds", () => {
  const DAWN = RELIC_ANCHOR_POINTS["dawn-leaf"]!;
  const ROOTS = DAWN.find((a) => a.anchorKey === "dawn-leaf:witness-roots")!;
  const TERRACE = DAWN.find((a) => a.anchorKey === "dawn-leaf:terrace-five")!;
  const ROOTS_POS = ROOTS.position as unknown as [number, number, number];
  const TERRACE_POS = TERRACE.position as unknown as [number, number, number];
  const seedDawnPlaced = (space: string) => handle.sqlite.prepare(
    `INSERT INTO relic_copies (copy_id, relic_id, state, world, anchor_key, holder_kind, holder_id, holder_space_id, scope_space_id, test_only) VALUES ('rc-dawn-resting', 'dawn-leaf', 'placed', 'growing-place', 'dawn-leaf:terrace-five', NULL, NULL, NULL, ?, 0)`,
  ).run(space);

  it("P1-B: a private copy resting placed in scope blocks materialization — scan senses only its anchor, the claim binds THAT copy", () => {
    seedDawnPlaced("s1");
    // Scan standing at the EMPTY anchor must not fabricate Resonant there:
    // the only senseable anchor is the resting copy's.
    const scanRoots = svc().scan("s1", "dawn-leaf", ROOTS_POS, "growing-place", false);
    expect(scanRoots.ok).toBe(true);
    if (scanRoots.ok) { expect(scanRoots.bearing).toBe(TERRACE.placeName); expect(scanRoots.band).not.toBe("Resonant"); }
    // Settling at the empty anchor is not a settling moment.
    expect(svc().recordSample("s1", "growing-place", ROOTS_POS, "claim-start").ok).toBe(false);
    // A dwell + claim at the empty anchor honestly empties — no duplicate minted.
    seedSample("s1", "growing-place", ROOTS_POS, "claim-start", 6000);
    const atRoots = svc().claim("s1", "dawn-leaf", "dawn-roots", ROOTS_POS, "growing-place");
    expect(atRoots.ok).toBe(false);
    if (!atRoots.ok) expect(atRoots.kind).toBe("empty-pool");
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'dawn-leaf' AND scope_space_id = 's1'`).get() as { n: number }).toEqual({ n: 1 });
    // At the resting anchor the claim binds the SAME copy — scope still holds exactly one.
    seedSample("s1", "growing-place", TERRACE_POS, "claim-start", 6000);
    const atTerrace = svc().claim("s1", "dawn-leaf", "dawn-terrace", TERRACE_POS, "growing-place");
    expect(atTerrace.ok).toBe(true);
    if (atTerrace.ok) expect(atTerrace.copyId).toBe("rc-dawn-resting");
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'dawn-leaf' AND scope_space_id = 's1'`).get() as { n: number }).toEqual({ n: 1 });
  });

  it("P2-2: the scan cooldown binds quiet pulses too — a refused pulse stores nothing and charges nothing", () => {
    for (let i = 0; i < 7; i++) expect(store().claimFind(`hunter-${i}`, "harbor-nail", "great-station").ok).toBe(true);
    const first = svc().scan("latecomer", "harbor-nail", NAIL_POS, "great-station", false);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.quiet).toBe(true);
    const second = svc().scan("latecomer", "harbor-nail", NAIL_POS, "great-station", false);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.kind).toBe("cooldown");
    const scanRows = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_position_samples WHERE space_id = 'latecomer' AND kind = 'scan'`).get() as { n: number };
    expect(scanRows.n).toBe(1);
    // After the cooldown the quiet answer returns; a widened quiet pulse still costs nothing.
    handle.sqlite.prepare(`UPDATE relic_position_samples SET received_at = ? WHERE space_id = 'latecomer'`).run(new Date(Date.now() - 4000).toISOString());
    const balBefore = new EconomyRepo(handle, "latecomer").get();
    const wide = svc().scan("latecomer", "harbor-nail", NAIL_POS, "great-station", true);
    expect(wide.ok).toBe(true);
    if (wide.ok) { expect(wide.quiet).toBe(true); expect(wide.widened).toBe(false); }
    expect(new EconomyRepo(handle, "latecomer").get()).toBe(balBefore);
  });

  it("P2-3: plausibility maxSpeed is always a finite number on the receipt, even for same-millisecond legs", () => {
    const stamp = new Date(Date.now() - 6000).toISOString();
    // A far scan and the claim-start share one millisecond stamp: the leg
    // between them has dt=0 over a positive distance — unbounded speed.
    handle.sqlite.prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES ('s1', 'great-station', ?, ?, ?, 'scan', ?)`).run(NAIL_POS[0] + 400, NAIL_POS[1], NAIL_POS[2], stamp);
    handle.sqlite.prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES ('s1', 'great-station', ?, ?, ?, 'claim-start', ?)`).run(NAIL_POS[0], NAIL_POS[1], NAIL_POS[2], stamp);
    const r = svc().claim("s1", "harbor-nail", "speed-null", NAIL_POS, "great-station");
    expect(r.ok).toBe(true);
    const row = attemptRow("s1", "speed-null");
    const outcome = JSON.parse(row!.outcome) as { plausibility: { maxSpeed: unknown } };
    expect(typeof outcome.plausibility.maxSpeed).toBe("number");
    expect(Number.isFinite(outcome.plausibility.maxSpeed as number)).toBe(true);
  });

  it("P1-A: two processes racing one claim key across two relics — the loser is refused, never handed the winner's award", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-xrelic-race-"));
    const dbPath = join(dir, "brain.db");
    try {
      const h = createDb(dbPath); h.sqlite.close();
      const RING_POS = RELIC_ANCHOR_POINTS["mooring-ring"]![0]!.position as unknown as [number, number, number];
      const runChild = (relicId: string, pos: readonly number[], goFile: string, readyFile: string): Promise<{ ok: boolean; awarded?: boolean; replayed?: boolean; copyId?: string | null; kind?: string }> =>
        new Promise((resolve, reject) => {
          const cli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
          const child = fileURLToPath(new URL("./relicSamplingRaceChild.mts", import.meta.url));
          execFile(process.execPath, [cli, child, dbPath, "s1", relicId, "great-station", JSON.stringify(pos), goFile, readyFile, "shared-key"], (err, stdout) => {
            if (err) return reject(err);
            const last = stdout.trim().split("\n").pop() ?? "";
            try { resolve(JSON.parse(last)); } catch { reject(new Error(`unparseable child output: ${stdout}`)); }
          });
        });
      const tag = Math.random().toString(36).slice(2);
      const goFile = join(dir, `go-${tag}`); const ready1 = join(dir, `ready-${tag}-1`); const ready2 = join(dir, `ready-${tag}-2`);
      const p1 = runChild("harbor-nail", NAIL_POS, goFile, ready1);
      const p2 = runChild("mooring-ring", RING_POS, goFile, ready2);
      const deadline = Date.now() + 20_000;
      while (!(existsSync(ready1) && existsSync(ready2))) {
        if (Date.now() > deadline) throw new Error("race children did not reach the barrier in time");
        await new Promise((r) => setTimeout(r, 25));
      }
      writeFileSync(goFile, "go");
      const results = await Promise.all([p1, p2]);
      const winners = results.filter((r) => r.ok && r.awarded);
      expect(winners).toHaveLength(1);
      const loser = results.find((r) => !(r.ok && r.awarded))!;
      expect(loser.ok).toBe(false);
      expect(loser.kind).toBe("malformed");
      const h2 = createDb(dbPath);
      // Exactly one COMMITTED award exists across the race — the
      // atomicity P1-A proves: one attempt row under the shared key,
      // naming the winner's relic. What the award left behind follows
      // the winner's tier class (tier implementation, PR #150): the
      // Nail is a Keystone and is HELD; the Ring is a Seed — a won
      // claim is consumed, never held: no holding, exactly one
      // recorded seed consumption, the copy consumed, its permanent
      // effect live. (This test's pre-tier shape asserted a holding
      // either way and failed whenever the Ring won the race.)
      const winnerIdx = results.findIndex((r) => r.ok && r.awarded);
      const winnerId = winnerIdx === 0 ? "harbor-nail" : "mooring-ring";
      const winnerCopyId = results[winnerIdx]!.copyId!;
      const rows = h2.sqlite.prepare(`SELECT relic_id FROM relic_claim_attempts WHERE space_id = 's1' AND attempt_key = 'shared-key'`).all() as { relic_id: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.relic_id).toBe(winnerId);
      const held = h2.sqlite.prepare(`SELECT relic_id FROM relic_holdings WHERE space_id = 's1'`).all() as { relic_id: string }[];
      const seedEffects = h2.sqlite.prepare(`SELECT relic_id, copy_id FROM relic_seed_effects WHERE space_id = 's1'`).all() as { relic_id: string; copy_id: string }[];
      const copyState = (h2.sqlite.prepare(`SELECT state FROM relic_copies WHERE copy_id = ?`).get(winnerCopyId) as { state: string }).state;
      if (winnerId === "harbor-nail") {
        expect(held.map((r) => r.relic_id)).toEqual(["harbor-nail"]);
        expect(seedEffects).toEqual([]);
        expect(copyState).toBe("held");
      } else {
        expect(held).toEqual([]);
        expect(seedEffects).toEqual([{ relic_id: "mooring-ring", copy_id: winnerCopyId }]);
        expect(copyState).toBe("consumed");
        // The Seed's permanent effect is present — drift pays +1 —
        // and the held form's daily-cap raise did NOT become
        // permanent (the tier ruling: the cap stays 2, ceiling 8/day).
        const buffs = buffsForSpace(h2, "s1");
        expect(buffs.driftBonus).toBe(4);
        expect(buffs.driftDailyCap).toBe(2);
      }
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});

describe("HTTP contract (I-4): sample / scan / found — anchorKey is gone from the contract", () => {
  let ctx: AppContext; let server: Server; let base: string;
  async function auth(tag: string): Promise<string> {
    const res = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: tag, passcode: "secret123", name: tag }) });
    return ((await res.json()) as { id: string }).id;
  }
  async function call(method: string, path: string, space: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": space }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  }
  function standIn(space: string, world: string): void {
    ctx.handle.sqlite.prepare(
      `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged, created_at, cancel_deadline) VALUES (?, ?, ?, 'drift', 'home', ?, 'arrived', 0, '2026-10-22T12:00:00.000Z', '2026-10-22T12:00:10.000Z')`,
    ).run(`stand-${space}-${world}`, space, `stand-${space}-${world}`, world);
  }
  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  it("anchorKey alone authorizes nothing; samples + dwell + claimId claim — and a bogus anchorKey in the body is ignored, the server derives the anchor", async () => {
    const space = await auth("relic-i4-http");
    standIn(space, "great-station");
    // No samples exist: even a CORRECT anchorKey cannot substitute for presence.
    const forged = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail", claimId: "h1", position: NAIL_POS, anchorKey: NAIL.anchorKey, dwellMs: 999_999 });
    expect(forged.status).toBe(400);
    expect(forged.body.state.found).toEqual([]);
    // Settle: the sample endpoint stamps on receipt; the test then ages the stamp to a completed dwell.
    const sampled = await call("POST", "/api/relics/sample", space, { position: NAIL_POS, kind: "claim-start" });
    expect(sampled.status).toBe(200);
    expect(sampled.body.ok).toBe(true);
    ctx.handle.sqlite.prepare(`UPDATE relic_position_samples SET received_at = ? WHERE space_id = ? AND kind = 'claim-start'`).run(new Date(Date.now() - 6000).toISOString(), space);
    // A WRONG anchorKey rides along and is ignored — the server derives the anchor from the samples.
    const found = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail", claimId: "h2", position: NAIL_POS, anchorKey: "harbor-nail:not-a-real-anchor" });
    expect(found.status).toBe(200);
    expect(found.body.state.found).toEqual(["harbor-nail"]);
    // #3 disconnect recovery is a re-read: the truth is simply there.
    const state = await call("GET", "/api/relics", space);
    expect(state.body.found).toEqual(["harbor-nail"]);
    // #2 replay over HTTP: same claimId, recorded outcome, still one find.
    const replay = await call("POST", "/api/relics/found", space, { relicId: "harbor-nail", claimId: "h2", position: NAIL_POS });
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyFound).toBe(false);
    expect(replay.body.state.found).toEqual(["harbor-nail"]);
  });

  it("scan over HTTP returns band + bearing and no coordinates; sample refuses a position near no anchor", async () => {
    const space = await auth("relic-i4-scan");
    standIn(space, "great-station");
    const scan = await call("POST", "/api/relics/scan", space, { relicId: "harbor-nail", position: NAIL_POS });
    expect(scan.status).toBe(200);
    expect(scan.body.band).toBe("Resonant");
    expect(scan.body.bearing).toBe(NAIL.placeName);
    expect(JSON.stringify(scan.body)).not.toMatch(/distance|coordinates/);
    const nowhere = await call("POST", "/api/relics/sample", space, { position: [5000, 0, 0], kind: "claim-start" });
    expect(nowhere.status).toBe(400);
  });
});
