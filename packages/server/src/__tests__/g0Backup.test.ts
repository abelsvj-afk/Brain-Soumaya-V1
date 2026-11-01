/**
 * G0 increment B1 — snapshot + manifest + local verification.
 * Maps to G0-AC-01 (consistent snapshot, never a raw WAL copy),
 * G0-AC-02 (snapshot passes SQLite integrity checks), G0-AC-04
 * (critical-table counts match the manifest; wiped-DB guard).
 * Inventory input: B0 pinned inventory v1.1 (anchor 6c115b4d) as bumped
 * to v2 by this increment (see backup/inventory.ts header).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "../db/client.js";
import { EMBED_DIM } from "../db/vec.js";
import {
  runBackupAttempt,
  listBackupAttempts,
  listVerifiedBackups,
} from "../backup/service.js";
import { verifySnapshotFile } from "../backup/manifest.js";
import {
  BACKUP_TABLE_INVENTORY,
  INCLUDED_TABLES,
  MUST_BE_NONEMPTY_TABLES,
} from "../backup/inventory.js";

let handle: DbHandle;
let dir: string;

function seedMinimalBrain(h: DbHandle): void {
  h.sqlite
    .prepare(
      `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
       VALUES ('space-test', 'Test Brain', 'tester', 'h', 's')`,
    )
    .run();
  h.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content)
       VALUES ('space-test', 'A memory', 'note', 'something worth keeping')`,
    )
    .run();
}

/**
 * A minimal WORKING brain: one honest row in every MUST-BE-NONEMPTY
 * table of inventory v5 (26 tables), each inserted through the real
 * schema (vec0 rows carry a real 384-dim embedding blob; FTS rows are
 * real index rows keyed by their entity's rowid). The three tables v5
 * reclassified to MAY-BE-EMPTY (episodes_fts, vec_episodes, fin_expense)
 * deliberately stay empty — under v5 that is a legitimate state, and
 * the enforcement tests below pin that it verifies.
 */
function seedFullBrain(h: DbHandle): void {
  const s = h.sqlite;
  const vec = Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer);
  s.prepare(
    `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
     VALUES ('space-test', 'Test Brain', 'tester', 'h', 's')`,
  ).run();
  s.prepare(`INSERT INTO settings (key, value) VALUES ('seed', '1')`).run();
  s.prepare(`INSERT INTO space_meta (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO user_persona (space_id, body) VALUES ('space-test', 'test persona')`).run();
  const node = s
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content)
       VALUES ('space-test', 'A memory', 'note', 'something worth keeping')`,
    )
    .run();
  const nodeId = Number(node.lastInsertRowid);
  s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('space-test', ?, ?, 'relates')`).run(nodeId, nodeId);
  const source = s
    .prepare(
      `INSERT INTO sources (space_id, kind, raw_bytes, content_hash, byte_length)
       VALUES ('space-test', 'note', ?, 'seedhash', 4)`,
    )
    .run(Buffer.from("seed"));
  const sourceId = Number(source.lastInsertRowid);
  const schunk = s
    .prepare(
      `INSERT INTO source_chunks (space_id, source_id, ordinal, text, start_offset, end_offset)
       VALUES ('space-test', ?, 0, 'seed text', 0, 9)`,
    )
    .run(sourceId);
  const sourceChunkId = Number(schunk.lastInsertRowid);
  s.prepare(`INSERT INTO sources_fts (rowid, text) VALUES (?, 'seed text')`).run(sourceChunkId);
  s.prepare(`INSERT INTO node_sources (space_id, node_id, source_id, chunk_id) VALUES ('space-test', ?, ?, ?)`).run(nodeId, sourceId, sourceChunkId);
  const doc = s.prepare(`INSERT INTO knowledge_docs (space_id, name) VALUES ('space-test', 'seed doc')`).run();
  const docId = Number(doc.lastInsertRowid);
  const kchunk = s
    .prepare(`INSERT INTO knowledge_chunks (space_id, doc_id, ordinal, content) VALUES ('space-test', ?, 0, 'seed chunk')`)
    .run(docId);
  const knowledgeChunkId = Number(kchunk.lastInsertRowid);
  s.prepare(
    `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
     VALUES ('space-test', 'session', 'seed episode', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
  s.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, 'A memory', 'something worth keeping')`).run(nodeId);
  s.prepare(`INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?)`).run(BigInt(nodeId), vec);
  s.prepare(`INSERT INTO vec_docs (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(knowledgeChunkId), vec);
  s.prepare(`INSERT INTO vec_source_chunks (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(sourceChunkId), vec);
  const profile = s
    .prepare(`INSERT INTO instruction_profiles (space_id, name, body) VALUES ('space-test', 'seed profile', 'be nice')`)
    .run();
  s.prepare(`INSERT INTO vec_profiles (profile_id, embedding) VALUES (?, ?)`).run(BigInt(Number(profile.lastInsertRowid)), vec);
  s.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin)
     VALUES ('space-test', 'belief', 'seed belief', 0.9, '2026-01-01T00:00:00Z', 'stated')`,
  ).run();
  s.prepare(`INSERT INTO daily_logs (space_id, content) VALUES ('space-test', 'seed log')`).run();
  s.prepare(`INSERT INTO fin_account (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_source (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_income (space_id, date) VALUES ('space-test', '2026-01-01')`).run();
  const bill = s
    .prepare(`INSERT INTO fin_bill (space_id, name, anchor_date) VALUES ('space-test', 'seed bill', '2026-01-01')`)
    .run();
  s.prepare(`INSERT INTO fin_bill_occurrence (space_id, bill_id, due_date) VALUES ('space-test', ?, '2026-01-01')`).run(Number(bill.lastInsertRowid));
  s.prepare(`INSERT INTO fin_paystub (space_id, net_cents) VALUES ('space-test', 100)`).run();
}

beforeEach(() => {
  handle = createDb(":memory:");
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b1-"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("G0 B1 inventory", () => {
  it("pins 127 named tables: 126 included + tts_audio_cache excluded", () => {
    const names = Object.keys(BACKUP_TABLE_INVENTORY);
    expect(names.length).toBe(127);
    expect(INCLUDED_TABLES.length).toBe(126);
    expect(INCLUDED_TABLES).not.toContain("tts_audio_cache");
    expect(BACKUP_TABLE_INVENTORY["tts_audio_cache"]).toBe("excluded");
    expect(MUST_BE_NONEMPTY_TABLES.length).toBe(26);
    // v5 reclassifications (owner-authorized 2026-10-30, causes in the
    // inventory header): fin_expense — real expense data lives in the
    // Money Tracker artifact store, never in this table; episodes_fts +
    // vec_episodes — PROVISIONAL, the enrichment worker was never wired
    // so the indexes are empty by construction (restore MUST after a
    // backfill populates them).
    for (const t of ["fin_expense", "episodes_fts", "vec_episodes"]) {
      expect(BACKUP_TABLE_INVENTORY[t]).toBe("may-be-empty");
      expect(MUST_BE_NONEMPTY_TABLES).not.toContain(t);
    }
    // This increment's own lifecycle table.
    expect(BACKUP_TABLE_INVENTORY["backup_attempts"]).toBe("may-be-empty");
    // v4 removals (owner-authorized 2026-10-30) SUPERSEDED by v6: the
    // deploy-line relic tables existed neither on main nor in
    // production, so v4 removed them "until the relics increments land
    // on main" — v6 (below) is that landing.
    // v6 additions (owner-authorized 2026-10-31): the Relics program
    // landed on main — all 12 relic_* tables its union schema creates
    // (cross-checked against the DDL in both schema locations),
    // INCLUDED + MAY-BE-EMPTY: exclusion would silently drop the relic
    // collection from backups; a MUST would break every fresh brain.
    for (const t of [
      "relic_claim_attempts",
      "relic_codex_layers",
      "relic_copies",
      "relic_copy_events",
      "relic_exchange_attempts",
      "relic_first_discoveries",
      "relic_gate_opened",
      "relic_holdings",
      "relic_position_samples",
      "relic_returns",
      "relic_seed_effects",
      "relic_stirrings",
    ]) {
      expect(BACKUP_TABLE_INVENTORY[t]).toBe("may-be-empty");
      expect(INCLUDED_TABLES).toContain(t);
    }
    // v4 addition: daily_quests — production carries the table (3 rows)
    // though main's schema never created it; its DDL is now reconciled
    // into both schema locations, mirroring production's definition.
    expect(BACKUP_TABLE_INVENTORY["daily_quests"]).toBe("may-be-empty");
    // v3 additions (owner-authorized 2026-10-30): post-anchor schema drift
    // on main — story/lore/NPC tables, all MAY-BE-EMPTY.
    for (const t of [
      "society_prefs",
      "story_finds",
      "story_links",
      "story_notes",
      "lore_voices",
      "story_prefs",
      "story_flavor_day",
      "npc_day_script",
    ]) {
      expect(BACKUP_TABLE_INVENTORY[t]).toBe("may-be-empty");
    }
  });
});

describe("G0 B1 snapshot + manifest + local verification", () => {
  it("happy path: CREATED → VERIFIED-LOCAL with a manifest that matches the snapshot file", () => {
    seedMinimalBrain(handle);
    // Fixture brain is legitimately partial (most MUST tables empty):
    // enforcement is preflight-gated in production, so opt out here.
    const res = runBackupAttempt(handle, { dir, appCommit: "test-commit", enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attempt.state).toBe("verified_local");
    expect(res.attempt.failureStage).toBeNull();
    // Manifest basics (spec §1).
    expect(res.manifest.backupId).toBe(res.attempt.id);
    expect(res.manifest.appCommit).toBe("test-commit");
    expect(res.manifest.inventoryVersion).toBe(6);
    expect(typeof res.manifest.schemaVersion).toBe("number");
    // SHA-256 in the manifest is the hash of the actual snapshot file.
    const fileBytes = fs.readFileSync(res.attempt.snapshotPath!);
    const sha = createHash("sha256").update(fileBytes).digest("hex");
    expect(res.manifest.snapshotSha256).toBe(sha);
    expect(res.manifest.snapshotBytes).toBe(fileBytes.length);
    // Per-table counts for every included table; excluded table absent.
    // (126 = inventory v6's included count: 114 at v5 + the 12 relic_*
    // tables the Relics landing added — see the census pin above.)
    expect(Object.keys(res.manifest.tableCounts).length).toBe(126);
    expect(res.manifest.tableCounts["spaces"]).toBe(1);
    expect(res.manifest.tableCounts["nodes"]).toBe(1);
    expect(res.manifest.tableCounts["travel_journeys"]).toBe(0);
    expect(res.manifest.tableCounts["tts_audio_cache"]).toBeUndefined();
    // The attempt is listed as a backup (verified), exactly once.
    expect(listVerifiedBackups(handle).map((a) => a.id)).toEqual([res.attempt.id]);
    expect(listBackupAttempts(handle)).toHaveLength(1);
  });

  it("G0-AC-02: the snapshot standalone passes integrity + foreign-key checks", () => {
    seedMinimalBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const v = verifySnapshotFile(res.attempt.snapshotPath!, res.manifest, { enforceMustNonempty: false });
    expect(v.ok).toBe(true);
    expect(v.integrity).toBe("ok");
    expect(v.foreignKeyViolations).toBe(0);
    expect(v.countsChecked).toBe(126);
  });

  it("G0-AC-04 wiped-DB guard: an empty brain fails verification at the verify stage when enforcement is on", () => {
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("verify");
    expect(res.failureDetail).toMatch(/must-be-nonempty/i);
    // Recorded as an attempt with its failure stage — never as a backup.
    const attempts = listBackupAttempts(handle);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.state).toBe("failed");
    expect(attempts[0]?.failureStage).toBe("verify");
    expect(listVerifiedBackups(handle)).toHaveLength(0);
  });

  it("guard is a switch: with enforcement off, the same empty brain verifies (preflight gates enforcement, not the build)", () => {
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
  });

  it("bucketed assertion: an unrecognized application table fails loudly at the manifest stage, naming the table", () => {
    seedMinimalBrain(handle);
    handle.sqlite.exec(`CREATE TABLE rogue_uninventoried (id INTEGER)`);
    const res = runBackupAttempt(handle, { dir });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("manifest");
    expect(res.failureDetail).toContain("rogue_uninventoried");
    expect(listVerifiedBackups(handle)).toHaveLength(0);
    expect(listBackupAttempts(handle)[0]?.state).toBe("failed");
  });

  it("bucketed assertion: FTS/vec shadow objects and sqlite internals do not trip the assertion", () => {
    seedMinimalBrain(handle);
    // A fresh brain carries sources_fts/episodes_fts/nodes_fts + vec_*
    // virtual tables, each with shadow objects in sqlite_master, plus
    // sqlite_sequence. The happy path above already implies this, but pin
    // it explicitly so a future raw-diff refactor fails this test.
    const shadows = handle.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
           AND (name LIKE '%\\_data' ESCAPE '\\' OR name LIKE '%\\_chunks' ESCAPE '\\'
             OR name = 'sqlite_sequence')`,
      )
      .all() as { name: string }[];
    expect(shadows.length).toBeGreaterThan(0);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
  });

  it("tamper: verifySnapshotFile rejects a manifest whose counts or hash disagree with the file", () => {
    seedMinimalBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const badCounts = {
      ...res.manifest,
      tableCounts: { ...res.manifest.tableCounts, spaces: (res.manifest.tableCounts["spaces"] ?? 0) + 1 },
    };
    const v1 = verifySnapshotFile(res.attempt.snapshotPath!, badCounts, { enforceMustNonempty: false });
    expect(v1.ok).toBe(false);
    expect(v1.failures.join(" ")).toContain("spaces");
    const badHash = { ...res.manifest, snapshotSha256: "0".repeat(64) };
    const v2 = verifySnapshotFile(res.attempt.snapshotPath!, badHash, { enforceMustNonempty: false });
    expect(v2.ok).toBe(false);
    expect(v2.failures.join(" ")).toMatch(/sha-256/i);
  });

  it("G0-AC-01: the snapshot is a real standalone database taken while the source stays usable", () => {
    seedMinimalBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Source still writable after the snapshot (VACUUM INTO, not a file copy
    // of a live WAL db — the source was :memory:, which has no file to copy).
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES ('space-test', 'After', 'note', 'still alive')`)
      .run();
    const count = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes`).get() as { n: number };
    expect(count.n).toBe(2);
    // Snapshot froze the earlier state.
    expect(res.manifest.tableCounts["nodes"]).toBe(1);
    // The attempt row is inserted BEFORE the snapshot, so the manifest
    // counts exactly this one attempt — pin it: if the insert ever moves
    // after the snapshot, manifest and snapshot stay self-consistent and
    // only this assertion notices.
    expect(res.manifest.tableCounts["backup_attempts"]).toBe(1);
  });

  it("bucketed assertion: a rogue table hiding under a virtual-table prefix still fails loudly (review P1)", () => {
    seedMinimalBrain(handle);
    // `vec_nodes_archive` starts with the vec_nodes virtual parent's name —
    // a bare prefix rule would misbucket it as a vec0 shadow object. The
    // real shadow suffixes are a finite set; this name is not one of them.
    handle.sqlite.exec(`CREATE TABLE vec_nodes_archive (id INTEGER)`);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("manifest");
    expect(res.failureDetail).toContain("vec_nodes_archive");
    expect(listVerifiedBackups(handle)).toHaveLength(0);
  });

  it("G0-AC-02: a foreign-key violation inside the snapshot fails verification at the verify stage", () => {
    seedMinimalBrain(handle);
    handle.sqlite.pragma("foreign_keys = OFF");
    handle.sqlite
      .prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('space-test', 999999, 999999, 'orphan')`)
      .run();
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("verify");
    expect(res.failureDetail).toMatch(/foreign_key/i);
    expect(listVerifiedBackups(handle)).toHaveLength(0);
  });

  it("operational failure is recorded, never thrown: an unusable snapshot dir fails the attempt at the snapshot stage", () => {
    seedMinimalBrain(handle);
    const fileDir = nodePath.join(dir, "not-a-dir");
    fs.writeFileSync(fileDir, "occupied");
    const res = runBackupAttempt(handle, { dir: fileDir, enforceMustNonempty: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("snapshot");
    expect(listBackupAttempts(handle)[0]?.state).toBe("failed");
    expect(listBackupAttempts(handle)[0]?.failureStage).toBe("snapshot");
  });

  it("verifySnapshotFile reports a missing or garbage snapshot as a failed verification instead of throwing (B4 flipped-byte readiness)", () => {
    seedMinimalBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const missing = verifySnapshotFile(nodePath.join(dir, "does-not-exist.db"), res.manifest, {
      enforceMustNonempty: false,
    });
    expect(missing.ok).toBe(false);
    expect(missing.failures.length).toBeGreaterThan(0);
    const garbagePath = nodePath.join(dir, "garbage.db");
    fs.writeFileSync(garbagePath, "this is not a sqlite database at all");
    const garbage = verifySnapshotFile(garbagePath, res.manifest, { enforceMustNonempty: false });
    expect(garbage.ok).toBe(false);
    expect(garbage.failures.length).toBeGreaterThan(0);
  });
});

describe("G0 v5 — MUST enforcement on the resolved preflight", () => {
  it("the standard full fixture passes with enforcement ON — including the three v5 tables legitimately empty", () => {
    seedFullBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attempt.state).toBe("verified_local");
    // The three tables v5 reclassified are empty in this fixture, and
    // that is now a legitimate state: the manifest records 0 for them
    // and the guard does not fire.
    expect(res.manifest.tableCounts["episodes_fts"]).toBe(0);
    expect(res.manifest.tableCounts["vec_episodes"]).toBe(0);
    expect(res.manifest.tableCounts["fin_expense"]).toBe(0);
    // Every one of the 26 remaining MUST tables carries its seeded row.
    for (const t of MUST_BE_NONEMPTY_TABLES) {
      expect(res.manifest.tableCounts[t]).toBeGreaterThan(0);
    }
    // The attempt-level default enforces too (no option passed).
    const resDefault = runBackupAttempt(handle, { dir });
    expect(resDefault.ok).toBe(true);
  });

  it("a snapshot with ONE MUST table emptied fails verification naming that table — and only that table", () => {
    seedFullBrain(handle);
    const res = runBackupAttempt(handle, { dir, enforceMustNonempty: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Build a second snapshot artifact that is identical except that
    // `settings` (a MUST table) has been emptied, with a manifest that
    // honestly describes the modified file — so count reconciliation,
    // hash, and integrity all pass and ONLY the wiped-DB guard can fail.
    const emptiedPath = nodePath.join(dir, "emptied-settings.db");
    fs.copyFileSync(res.attempt.snapshotPath!, emptiedPath);
    const raw = new BetterSqlite3(emptiedPath);
    raw.exec(`DELETE FROM settings`);
    raw.close();
    const bytes = fs.readFileSync(emptiedPath);
    const manifest = {
      ...res.manifest,
      snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
      snapshotBytes: bytes.length,
      tableCounts: { ...res.manifest.tableCounts, settings: 0 },
    };
    // Enforcement ON (the verify-level default): fails, naming settings,
    // and the must-be-nonempty failure is the ONLY failure.
    const on = verifySnapshotFile(emptiedPath, manifest);
    expect(on.ok).toBe(false);
    expect(on.failures).toEqual(["must-be-nonempty table is empty in snapshot: settings"]);
    // Enforcement OFF (the legacy explicit opt-out): the same artifact
    // verifies — the switch, not the artifact, decides.
    const off = verifySnapshotFile(emptiedPath, manifest, { enforceMustNonempty: false });
    expect(off.ok).toBe(true);
    expect(off.integrity).toBe("ok");
  });
});
