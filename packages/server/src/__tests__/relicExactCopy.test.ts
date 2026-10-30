import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RelicClaimService } from "../relics/claims.js";
import { RelicStirringService, type StirringRow } from "../relics/stirrings.js";
import { NpcRepo } from "../npcs/repo.js";
import { RELIC_ANCHOR_POINTS } from "@brain/shared";

/**
 * Relics follow-up — the stirring's promise becomes exact (approved
 * design §3; I-5 review P2-2; owner delegation 2026-10-30 adopting
 * King's recommendation to ENFORCE). I-5 bound a stirring to a
 * specific placed copy at issuance but resolved it supply-based at
 * claim time. This suite proves claim time now honors the promise:
 * a stirred claim awards exactly the stirred copy or nothing; a
 * promised copy taken by anyone quiets every other stirring that
 * promised it, inside the award transaction; and the P2-A rider —
 * the scan's private-class read converts first (the P2-1 pattern),
 * so a dormant volume's unconverted private holding can no longer
 * make the scan signal anchors the award core would refuse.
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const svc = () => new RelicClaimService(handle);
const stir = () => new RelicStirringService(handle);
const NAIL = RELIC_ANCHOR_POINTS["harbor-nail"]![0]!;
const NAIL_POS = NAIL.position as unknown as [number, number, number];
const NAIL2 = RELIC_ANCHOR_POINTS["harbor-nail"]![1]!;
const NAIL2_POS = NAIL2.position as unknown as [number, number, number];
const WITNESS = RELIC_ANCHOR_POINTS["witness-without-a-name"]![0]!;
const WITNESS_POS = WITNESS.position as unknown as [number, number, number];
const DAWN = RELIC_ANCHOR_POINTS["dawn-leaf"]![0]!;
const DAWN_POS = DAWN.position as unknown as [number, number, number];

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
const attemptOutcome = (space: string, key: string) => {
  const row = handle.sqlite.prepare(
    `SELECT outcome FROM relic_claim_attempts WHERE space_id = ? AND attempt_key = ?`,
  ).get(space, key) as { outcome: string } | undefined;
  return row ? (JSON.parse(row.outcome) as { ok: boolean; committed?: boolean; kind?: string; reason?: string }) : null;
};

describe("the exact-copy promise at claim time (approved design §3)", () => {
  it("(a) a claim through a stirring at the stirred copy's own anchor awards exactly that copy", () => {
    const s = stir().issue("s1", "harbor-nail", "ambient")!;
    expect(copyRow(s.copy_id)?.anchor_key).toBe(NAIL.anchorKey);
    const result = sampledClaim("s1", "harbor-nail", "great-station", NAIL_POS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.copyId).toBe(s.copy_id);
    expect(stirringById(s.id).state).toBe("claimed");
  });

  it("(b) a claim through a stirring at a DIFFERENT anchor: no award, no substitute, the stirring stays open, the receipt is honest", () => {
    const s = stir().issue("s1", "harbor-nail", "ambient")!;
    expect(copyRow(s.copy_id)?.anchor_key).toBe(NAIL.anchorKey); // the promise rests at the FIRST anchor
    seedSample("s1", "great-station", NAIL2_POS, 6000);
    const refused = svc().claim("s1", "harbor-nail", "key-b", NAIL2_POS, "great-station");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("Your stirring does not rest here — the copy it promised waits at its own place, and no other copy will be given in its stead.");
    // No award, no substitute bound or minted: the pool and the promise are exactly as they were.
    expect(store().foundIds("s1")).not.toContain("harbor-nail");
    expect(store().poolCount("harbor-nail")).toBe(1);
    expect(copyRow(s.copy_id)?.state).toBe("placed");
    expect(copyRow(s.copy_id)?.holder_id).toBeNull();
    // The stirring stays OPEN — the copy exists elsewhere; the trail still leads somewhere.
    const after = stirringById(s.id);
    expect(after.state).toBe("open");
    expect(after.resolved_at).toBeNull();
    // The receipt is honest and NON-committed: a fixable mistake never burns the claim key.
    const outcome = attemptOutcome("s1", "key-b");
    expect(outcome?.ok).toBe(false);
    expect(outcome?.committed).toBe(false);
    // The same key, retried at the promise's own place, lands the very copy.
    seedSample("s1", "great-station", NAIL_POS, 6000);
    const landed = svc().claim("s1", "harbor-nail", "key-b", NAIL_POS, "great-station");
    expect(landed.ok).toBe(true);
    if (landed.ok) expect(landed.copyId).toBe(s.copy_id);
    expect(stirringById(s.id).state).toBe("claimed");
  });

  it("(c1) a stirred copy taken first by another player resolves the holder's stirring quiet AT the award (cross-space)", () => {
    const s = stir().issue("sA", "witness-without-a-name", "ambient")!;
    const winner = sampledClaim("sB", "witness-without-a-name", "deep-past", WITNESS_POS);
    expect(winner.ok).toBe(true);
    if (winner.ok) expect(winner.copyId).toBe(s.copy_id);
    const after = stirringById(s.id);
    expect(after.state).toBe("quiet");
    expect(after.resolved_reason).toBe("copy-claimed");
    expect(after.resolved_at).not.toBeNull();
  });

  it("(c2) the stirred copy gone without an award-path resolution: the holder's claim under it quiets the stirring and makes NO award", () => {
    const s = stir().issue("sC", "witness-without-a-name", "ambient")!;
    // The promised copy leaves placed state through the store-level find,
    // which by I-5's design carries no stirring hooks — the stirring is
    // still open when its holder comes to claim.
    expect(store().claimFind("sD", "witness-without-a-name", "deep-past").ok).toBe(true);
    expect(copyRow(s.copy_id)?.state).toBe("held");
    expect(stirringById(s.id).state).toBe("open");
    const result = sampledClaim("sC", "witness-without-a-name", "deep-past", WITNESS_POS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("The trail has gone quiet — the copy your stirring promised is no longer there to claim.");
    // No award under the stirring — and no substitute minted, though the pool has room.
    expect(store().foundIds("sC")).not.toContain("witness-without-a-name");
    expect(store().poolCount("witness-without-a-name")).toBe(1);
    const after = stirringById(s.id);
    expect(after.state).toBe("quiet");
    expect(after.resolved_reason).toBe("copy-gone");
  });

  it("(d) two spaces stirred toward the same global-pool copy: the first claim wins it, the other stirring goes quiet, the loser is never handed a substitute", () => {
    const a = stir().issue("sA", "witness-without-a-name", "ambient")!;
    const b = stir().issue("sB", "witness-without-a-name", "ambient")!;
    expect(b.copy_id).toBe(a.copy_id); // one resting copy, two promises (the global pool's nature)
    const win = sampledClaim("sA", "witness-without-a-name", "deep-past", WITNESS_POS);
    expect(win.ok).toBe(true);
    if (win.ok) expect(win.copyId).toBe(a.copy_id);
    expect(stirringById(a.id).state).toBe("claimed");
    expect(stirringById(b.id).state).toBe("quiet");
    expect(stirringById(b.id).resolved_reason).toBe("copy-claimed");
    // The pool fills without sB; sB's own attempt then finds the honest empty pool — no copy is ever sB's.
    expect(sampledClaim("s3", "witness-without-a-name", "deep-past", WITNESS_POS).ok).toBe(true);
    expect(sampledClaim("s4", "witness-without-a-name", "deep-past", WITNESS_POS).ok).toBe(true);
    const loser = sampledClaim("sB", "witness-without-a-name", "deep-past", WITNESS_POS);
    expect(loser.ok).toBe(false);
    expect(store().foundIds("sB")).not.toContain("witness-without-a-name");
    const sBCopies = handle.sqlite.prepare(
      `SELECT COUNT(*) AS n FROM relic_copies WHERE holder_space_id = 'sB' AND relic_id = 'witness-without-a-name'`,
    ).get() as { n: number };
    expect(sBCopies.n).toBe(0);
  });

  it("(f) an NPC's legitimate award of a stirred copy at supply > 1 resolves the player's stirring quiet", () => {
    fill("harbor-nail", 5, "great-station");
    const s = stir().issue("sP", "harbor-nail", "ambient")!; // mints the 6th copy placed; supply 2 — courtesy does not bind
    new NpcRepo(handle, "npc-space").addHolding("harbor-controller", "mooring-ring", "great-station");
    const r = svc().claimForNpc("npc-space", "harbor-controller", "great-station", "harbor-nail");
    expect(r.status).toBe("awarded");
    if (r.status === "awarded") expect(r.copyId).toBe(s.copy_id); // the NPC took the very copy sP was promised
    const after = stirringById(s.id);
    expect(after.state).toBe("quiet");
    expect(after.resolved_reason).toBe("copy-claimed");
  });
});

describe("P2-A rider: the scan's private-class read converts first", () => {
  /** A holding row exactly as pre-I-2 code wrote it (no copy bound). */
  function giveUnconverted(space: string, relicId: string): void {
    handle.sqlite.prepare(
      `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, '2026-10-01T00:00:00.000Z', 0, 0, NULL, ?)`,
    ).run(space, relicId, `${relicId}:resting-place-one`);
  }

  it("(g) on a dormant volume with an unconverted PRIVATE holding, the scan no longer signals anchors the award core would refuse", () => {
    giveUnconverted("dormant-s", "dawn-leaf"); // the private class: this space's one copy, already held
    const copies = () =>
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'dawn-leaf'`).get() as { n: number }).n;
    expect(copies()).toBe(0); // no relic read has touched the volume — the holding is unconverted
    const scan = svc().scan("dormant-s", "dawn-leaf", DAWN_POS, "growing-place", false);
    expect(scan.ok).toBe(true);
    // Pre-fix the private branch counted copies only (0 live) and treated
    // the relic as materializable: the scan answered Resonant at an empty
    // anchor while the award core — which converts first — would refuse.
    // Post-fix the read converts first: the held copy is the scope's one
    // copy, nothing rests placed, and the pulse honestly answers quiet.
    if (scan.ok) {
      expect(scan.quiet).toBe(true);
      expect(scan.band).toBeNull();
    }
    expect(copies()).toBe(1); // the scan's own read performed the conversion
    const converted = handle.sqlite.prepare(
      `SELECT state, scope_space_id FROM relic_copies WHERE relic_id = 'dawn-leaf'`,
    ).get() as { state: string; scope_space_id: string | null };
    expect(converted.state).toBe("held");
    expect(converted.scope_space_id).toBe("dormant-s");
  });
});
