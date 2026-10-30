import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";
import { RELIC_ANCHOR_POINTS } from "@brain/shared";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Relics I-2 acceptance evidence (implementation design §4.2/§4.3, §6
 * fix (c), §7 I-2): relics are physical copies. One append-only event
 * chain per copy is both its provenance and its placement history.
 * Pool counting reads copies; backfill converts existing holdings
 * losslessly and idempotently; a copy never returns to an anchor it
 * has occupied (§8.1 #1 race re-proof + #7 pool-truth half live here).
 */
let handle: DbHandle;
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => { handle.sqlite.close(); delete process.env.RELIC_OWNER_SPACE_IDS; });

const store = () => new RelicHoldingsStore(handle);
const anchorsOf = (relicId: string): string[] => (RELIC_ANCHOR_POINTS[relicId] ?? []).map((a) => a.anchorKey);

/** A holding row exactly as pre-I-2 code wrote it (no copy bound). */
function give(space: string, relicId: string, opts: { testOnly?: boolean; anchor?: string } = {}): void {
  handle.sqlite.prepare(
    `INSERT OR IGNORE INTO relic_holdings (space_id, relic_id, found_at, test_only, held, held_at, anchor_key) VALUES (?, ?, '2026-10-01T00:00:00.000Z', ?, 0, NULL, ?)`,
  ).run(space, relicId, opts.testOnly ? 1 : 0, opts.anchor ?? `${relicId}:resting-place-one`);
}
interface CopyRow { copy_id: string; relic_id: string; state: string; world: string | null; anchor_key: string | null; holder_kind: string | null; holder_id: string | null; holder_space_id: string | null; scope_space_id: string | null; test_only: number; }
const copies = (relicId?: string): CopyRow[] =>
  (handle.sqlite.prepare(`SELECT * FROM relic_copies ${relicId ? "WHERE relic_id = ?" : ""} ORDER BY copy_id`).all(...(relicId ? [relicId] : [])) as CopyRow[]);
interface EventRow { id: number; copy_id: string; kind: string; space_id: string | null; world: string | null; anchor_key: string | null; detail: string | null; }
const eventsFor = (copyId: string): EventRow[] =>
  handle.sqlite.prepare(`SELECT * FROM relic_copy_events WHERE copy_id = ? ORDER BY id ASC`).all(copyId) as EventRow[];
const holdingCopyId = (space: string, relicId: string): string | null =>
  (handle.sqlite.prepare(`SELECT copy_id FROM relic_holdings WHERE space_id = ? AND relic_id = ?`).get(space, relicId) as { copy_id: string | null } | undefined)?.copy_id ?? null;

describe("schema (I-2, both places)", () => {
  it("relic_copies + relic_copy_events exist with the designed columns; relic_holdings gains copy_id + location", () => {
    const copyCols = (handle.sqlite.prepare(`PRAGMA table_info(relic_copies)`).all() as { name: string }[]).map((c) => c.name);
    expect(copyCols).toEqual(expect.arrayContaining(["copy_id", "relic_id", "state", "world", "anchor_key", "holder_kind", "holder_id", "holder_space_id", "scope_space_id", "test_only", "created_at", "updated_at"]));
    const eventCols = (handle.sqlite.prepare(`PRAGMA table_info(relic_copy_events)`).all() as { name: string }[]).map((c) => c.name);
    expect(eventCols).toEqual(expect.arrayContaining(["id", "copy_id", "kind", "space_id", "world", "anchor_key", "detail", "created_at"]));
    const holdingCols = (handle.sqlite.prepare(`PRAGMA table_info(relic_holdings)`).all() as { name: string; dflt_value: string | null }[]);
    const copyId = holdingCols.find((c) => c.name === "copy_id");
    const location = holdingCols.find((c) => c.name === "location");
    expect(copyId, "copy_id column").toBeDefined();
    expect(location, "location column").toBeDefined();
    expect(location!.dflt_value).toContain("carried");
  });
});

describe("backfill (I-2 §4.2)", () => {
  it("converts existing holdings to copies losslessly: pool counts identical, every holding bound, genesis per copy", () => {
    give("s1", "harbor-nail"); give("s2", "harbor-nail"); give("s3", "harbor-nail");
    give("s1", "dawn-leaf"); give("s2", "dawn-leaf");
    give("s1", "witness-without-a-name");
    give("s9", "mooring-ring", { testOnly: true });
    for (const [s, r] of [["s1", "harbor-nail"], ["s1", "dawn-leaf"], ["s1", "witness-without-a-name"]] as const) {
      handle.sqlite.prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`).run(s, `relic-${r}`);
    }
    // Pre-change truth: the holdings-based counts the old poolCount read.
    const oldCount = (relicId: string) => (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE relic_id = ? AND test_only = 0`).get(relicId) as { n: number }).n;
    const before = Object.fromEntries(["harbor-nail", "dawn-leaf", "witness-without-a-name", "mooring-ring"].map((id) => [id, oldCount(id)]));
    const claimsBefore = (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM codex_claims`).get() as { n: number }).n;

    store().ensureMigrated();

    expect(store().poolCount("harbor-nail")).toBe(before["harbor-nail"]);
    expect(store().poolCount("witness-without-a-name")).toBe(before["witness-without-a-name"]);
    const all = copies();
    expect(all).toHaveLength(7); // 6 counted holdings + the test-only one
    for (const row of handle.sqlite.prepare(`SELECT copy_id, location FROM relic_holdings`).all() as { copy_id: string | null; location: string }[]) {
      expect(row.copy_id, "every holding is bound to a copy").toBeTruthy();
      expect(row.location).toBe("carried");
    }
    for (const c of all) {
      expect(c.state).toBe("held");
      expect(eventsFor(c.copy_id).map((e) => e.kind)).toEqual(["genesis"]);
    }
    // Private-class copies are scoped to their brain; global-pool copies are unscoped.
    expect(copies("dawn-leaf").every((c) => c.scope_space_id !== null)).toBe(true);
    expect(copies("harbor-nail").every((c) => c.scope_space_id === null)).toBe(true);
    // Discovery records are not touched by the conversion.
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM codex_claims`).get() as { n: number }).n).toBe(claimsBefore);
  });

  it("is idempotent: a second backfill mints nothing and writes no new events", () => {
    give("s1", "harbor-nail"); give("s2", "dawn-leaf");
    const first = store().backfillCopies();
    expect(first.minted).toBe(2);
    const copiesAfter = copies().length;
    const eventsAfter = (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copy_events`).get() as { n: number }).n;
    const second = store().backfillCopies();
    expect(second.minted).toBe(0);
    expect(second.npcMinted).toBe(0);
    expect(copies()).toHaveLength(copiesAfter);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copy_events`).get() as { n: number }).n).toBe(eventsAfter);
  });

  it("mints copies for NPC holdings too, and reports the pre-flight count", () => {
    handle.sqlite.prepare(`INSERT INTO npc_relic_holdings (npc_id, space_id, relic_id, found_in_world) VALUES ('npc-1', 's1', 'harbor-nail', 'great-station'), ('npc-1', 's1', 'mooring-ring', 'great-station')`).run();
    const stats = store().backfillCopies();
    expect(stats.npcRows).toBe(2);
    expect(stats.npcMinted).toBe(2);
    const npcCopies = copies().filter((c) => c.holder_kind === "npc");
    expect(npcCopies).toHaveLength(2);
    expect(npcCopies.every((c) => c.holder_id === "npc-1" && c.holder_space_id === "s1" && c.state === "held")).toBe(true);
    expect(store().backfillCopies().npcMinted).toBe(0);
  });
});

describe("claims bind copies (I-2)", () => {
  it("a find materializes a placed copy and binds it: state, holder, and the genesis→placed→claimed chain", () => {
    const out = store().claimFind("s1", "harbor-nail", "great-station");
    expect(out.ok).toBe(true);
    const copyId = holdingCopyId("s1", "harbor-nail");
    expect(copyId).toBeTruthy();
    const copy = copies("harbor-nail").find((c) => c.copy_id === copyId)!;
    expect(copy.state).toBe("held");
    expect(copy.holder_kind).toBe("space");
    expect(copy.holder_id).toBe("s1");
    expect(copy.world).toBeNull(); // placement lives in the event chain while held
    const evs = eventsFor(copyId!);
    expect(evs.map((e) => e.kind)).toEqual(["genesis", "placed", "claimed"]);
    expect(evs[1]!.anchor_key).toBe(anchorsOf("harbor-nail")[0]);
    expect(evs[2]!.space_id).toBe("s1");
    expect(store().poolCount("harbor-nail")).toBe(1);
    expect(store().poolAvailable("harbor-nail")).toBe(6);
  });

  it("a second space's find binds a different copy, never the held one", () => {
    store().claimFind("s1", "harbor-nail", "great-station");
    store().claimFind("s2", "harbor-nail", "great-station");
    const a = holdingCopyId("s1", "harbor-nail");
    const b = holdingCopyId("s2", "harbor-nail");
    expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(a).not.toBe(b);
    expect(copies("harbor-nail")).toHaveLength(2);
  });

  it("pool truth (#7 half): placed copies count and are re-bound, never duplicated past the limit", () => {
    for (let i = 0; i < 7; i++) expect(store().claimFind(`p-${i}`, "harbor-nail", "great-station").ok).toBe(true);
    expect(store().poolAvailable("harbor-nail")).toBe(0);
    const eighth = store().claimFind("p-8", "harbor-nail", "great-station");
    expect(eighth.ok).toBe(false);
    if (!eighth.ok) expect(eighth.kind).toBe("empty-pool");
    // Everyone sets theirs down: the copies rest placed, still counted.
    for (let i = 0; i < 7; i++) store().release(`p-${i}`, "harbor-nail");
    expect(copies("harbor-nail")).toHaveLength(7);
    expect(store().poolAvailable("harbor-nail")).toBe(0);
    // A new finder binds one of the resting copies — the pool mints nothing new.
    expect(store().claimFind("p-8", "harbor-nail", "great-station").ok).toBe(true);
    expect(copies("harbor-nail")).toHaveLength(7);
  });
});

describe("fix (c) — per-copy placement history", () => {
  it("one copy cycles through its anchors without ever revisiting one, then waits honestly in return-pool", () => {
    const set = anchorsOf("basin-stone");
    expect(set.length).toBeGreaterThanOrEqual(3);
    const seen: string[] = [];
    let copyId: string | null = null;
    for (let cycle = 0; cycle < set.length; cycle++) {
      const out = store().claimFind("s1", "basin-stone", "deep-past");
      expect(out.ok).toBe(true);
      const bound = holdingCopyId("s1", "basin-stone");
      if (copyId === null) copyId = bound;
      expect(bound, "the same physical copy is re-found").toBe(copyId);
      const foundAt = (handle.sqlite.prepare(`SELECT anchor_key FROM relic_holdings WHERE space_id = 's1' AND relic_id = 'basin-stone'`).get() as { anchor_key: string }).anchor_key;
      expect(seen).not.toContain(foundAt);
      seen.push(foundAt);
      const relOut = store().release("s1", "basin-stone");
      const view = relOut?.ok ? relOut.event : null; // I-3: release() returns a discriminated result
      expect(view).not.toBeNull();
      if (cycle < set.length - 1) {
        expect(view!.toAnchor).toBe(set[cycle + 1]);
      } else {
        // History exhausted: the copy waits in return-pool rather than
        // being placed somewhere it has already been (ruling 2).
        expect(view!.toAnchor).toBeNull();
        expect(copies("basin-stone").find((c) => c.copy_id === copyId)!.state).toBe("return-pool");
      }
    }
    expect(seen).toEqual(set); // registry order, each exactly once
    // relic_returns stops receiving new rows from this increment on.
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_returns`).get() as { n: number }).n).toBe(0);
  });

  it("a resting copy's anchor is never handed to a sibling copy", () => {
    store().claimFind("s1", "harbor-nail", "great-station");
    const firstOut = store().release("s1", "harbor-nail");
    const first = firstOut?.ok ? firstOut.event : null; // I-3: discriminated release result
    expect(first!.toAnchor).toBe(anchorsOf("harbor-nail")[1]);
    // A fresh copy materializes while the first rests at anchors[1]:
    // it must not materialize on top of its sibling.
    store().claimFind("s2", "harbor-nail", "great-station");
    const evs = eventsFor(holdingCopyId("s2", "harbor-nail")!);
    expect(evs.find((e) => e.kind === "placed")!.anchor_key).toBe(anchorsOf("harbor-nail")[0]);
    // And its own return skips both its history and the sibling's rest.
    const secondOut = store().release("s2", "harbor-nail");
    const second = secondOut?.ok ? secondOut.event : null; // I-3: discriminated release result
    expect(second!.toAnchor).toBe(anchorsOf("harbor-nail")[2]);
  });
});

describe("two-space isolation (D-05)", () => {
  it("private copies are scoped: another space's find mints its own copy and cannot touch the first", () => {
    store().claimFind("sA", "dawn-leaf", "growing-place");
    const copyA = holdingCopyId("sA", "dawn-leaf");
    store().claimFind("sB", "dawn-leaf", "growing-place");
    const copyB = holdingCopyId("sB", "dawn-leaf");
    expect(copyA).toBeTruthy(); expect(copyB).toBeTruthy(); expect(copyA).not.toBe(copyB);
    expect(copies("dawn-leaf").find((c) => c.copy_id === copyA)!.scope_space_id).toBe("sA");
    expect(copies("dawn-leaf").find((c) => c.copy_id === copyB)!.scope_space_id).toBe("sB");
    // B sets its copy down and finds it again — A's copy never moves.
    store().release("sB", "dawn-leaf");
    expect(store().claimFind("sB", "dawn-leaf", "growing-place").ok).toBe(true);
    expect(holdingCopyId("sB", "dawn-leaf")).toBe(copyB);
    const a = copies("dawn-leaf").find((c) => c.copy_id === copyA)!;
    expect(a.state).toBe("held"); expect(a.holder_id).toBe("sA");
  });

  it("a space cannot release a copy it does not hold; its departures list shows only its own events", () => {
    store().claimFind("sA", "harbor-nail", "great-station");
    expect(store().release("sB", "harbor-nail")).toBeNull();
    expect(copies("harbor-nail").find((c) => c.holder_id === "sA")!.state).toBe("held");
    store().release("sA", "harbor-nail");
    expect(store().recentDepartures("sB")).toEqual([]);
    const deps = store().recentDepartures("sA");
    expect(deps).toHaveLength(1);
    expect(deps[0]!.relicId).toBe("harbor-nail");
    expect(deps[0]!.reason).toBe("release");
    expect(deps[0]!.fromAnchor).toBe(anchorsOf("harbor-nail")[0]);
    expect(deps[0]!.toAnchor).toBe(anchorsOf("harbor-nail")[1]);
  });

  it("legacy relic_returns rows still show alongside copy-event departures", () => {
    handle.sqlite.prepare(`INSERT INTO relic_returns (space_id, relic_id, reason, from_anchor, to_anchor, created_at) VALUES ('s1', 'mooring-ring', 'release', 'mooring-ring:resting-place-one', 'mooring-ring:resting-place-two', '2026-10-01T00:00:00.000Z')`).run();
    store().claimFind("s1", "harbor-nail", "great-station");
    store().release("s1", "harbor-nail");
    const deps = store().recentDepartures("s1");
    expect(deps.map((d) => d.relicId)).toEqual(["harbor-nail", "mooring-ring"]);
  });
});

describe("brain deletion over copies", () => {
  it("counted copies return through placement history; test/private copies are deleted with the space, their events remain", () => {
    store().claimFind("s1", "harbor-nail", "great-station");
    store().claimFind("s1", "dawn-leaf", "growing-place");
    give("s1", "mooring-ring", { testOnly: true });
    store().backfillCopies();
    const nailCopy = holdingCopyId("s1", "harbor-nail")!;
    const leafCopy = holdingCopyId("s1", "dawn-leaf")!;
    const ringCopy = holdingCopyId("s1", "mooring-ring")!;
    const out = store().releaseAllForSpace("s1");
    expect(out.returnedCounted).toBe(1);
    expect(out.removedTotal).toBe(3);
    const nail = copies("harbor-nail").find((c) => c.copy_id === nailCopy)!;
    expect(nail.state).toBe("placed");
    expect(nail.anchor_key).toBe(anchorsOf("harbor-nail")[1]);
    expect(eventsFor(nailCopy).map((e) => e.kind)).toContain("brain-deleted");
    expect(copies().find((c) => c.copy_id === leafCopy)).toBeUndefined();
    expect(copies().find((c) => c.copy_id === ringCopy)).toBeUndefined();
    expect(eventsFor(leafCopy).map((e) => e.kind)).toContain("brain-deleted");
    expect(store().poolCount("harbor-nail")).toBe(1); // the returned copy still counts
  });
});

describe("RACE — two simultaneous claims for the final copy (§8.1 #1, re-proven on copies)", () => {
  it("exactly one winner; the pool ends at exactly the limit in copies, not just holdings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relic-copies-race-"));
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
          const child = fileURLToPath(new URL("./relicRaceChild.mts", import.meta.url));
          execFile(process.execPath, [cli, child, dbPath, spaceId, "harbor-nail", "great-station", goFile, readyFile], (err, stdout) => {
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
      const s2 = new RelicHoldingsStore(h2);
      expect(s2.poolCount("harbor-nail")).toBe(7);
      expect((h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_copies WHERE relic_id = 'harbor-nail'`).get() as { n: number }).n).toBe(7);
      expect((h2.sqlite.prepare(`SELECT COUNT(*) AS n FROM relic_holdings WHERE relic_id = 'harbor-nail' AND copy_id IS NULL`).get() as { n: number }).n).toBe(0);
      h2.sqlite.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
