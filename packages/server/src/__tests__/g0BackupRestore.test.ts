/**
 * G0 increment B4 — restore procedure + drill support.
 * Maps to G0-AC-06 (flipped-byte / tampered-manifest corruption is
 * rejected before restore), G0-AC-07 (drill retrieves the backup from
 * the external copy with the Fly volume treated as unavailable),
 * G0-AC-08 (restored app passes schema / known-space / memory-count
 * checks — the unit-level half; galaxy-render and cited-chat are
 * exercised against the scratch app in the drill), G0-AC-10 (a failed
 * restore cannot modify the target or leave it pointing at a partial
 * restore), G0-AC-13 (restore records identify backup, operator, time,
 * verification outcome), G0-AC-14 (the runbook documents required
 * secrets by NAME only), plus K4 / B0 amendment C tier 3: critical-
 * record identity (same RECORDS, not merely same counts) and ledger
 * reconciliation (travel derivation, fuel balances, finance totals
 * recomputed from the restored records).
 *
 * All store traffic runs against an in-memory fake — the gate needs no
 * live R2. The drill against the real bucket is an ops run, recorded
 * in the PR body, not a unit test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { randomBytes } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { createDb, type DbHandle } from "../db/client.js";
import { EMBED_DIM } from "../db/vec.js";
import { runOffVolumeBackup } from "../backup/offvolume.js";
import { verifySnapshotFile, sha256File } from "../backup/manifest.js";
import {
  InMemoryBackupStore,
  manifestObjectKey,
  snapshotObjectKey,
  type BackupObjectStore,
} from "../backup/store.js";
import {
  appendRestoreRecord,
  readBackupIndex,
  recoverLatestGood,
  writeBackupIndex,
  type BackupIndex,
  type BackupRestoreRecord,
} from "../backup/index.js";
import { INCLUDED_TABLES } from "../backup/inventory.js";
import {
  CRITICAL_RECORD_TABLES,
  digestCriticalRecords,
  openSnapshotReadonly,
  summarizeLedgers,
} from "../backup/reconcile.js";
import { buildRestorePreflight, runRestore } from "../backup/restore.js";

const TEST_KEY = Buffer.alloc(32, 0x42);

/** A minimal WORKING brain (every MUST table honestly seeded, the
 * g0Backup.test.ts fixture pattern) PLUS the record classes tier 3
 * reconciles: travel ledger + events, a fuel balance, finance
 * history, relic holdings, codex discoveries, notification dedup. */
function seedWorkingBrain(h: DbHandle): void {
  const s = h.sqlite;
  const vec = Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer);
  s.prepare(
    `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
     VALUES ('space-test', 'Test Brain', 'tester', 'h', 's')`,
  ).run();
  s.prepare(`INSERT INTO settings (key, value) VALUES ('seed', '1')`).run();
  s.prepare(`INSERT INTO space_meta (space_id, fuel) VALUES ('space-test', 137.5)`).run();
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
  s.prepare(`INSERT INTO fin_income (space_id, date, net_cents) VALUES ('space-test', '2026-01-01', 4200)`).run();
  s.prepare(`INSERT INTO fin_expense (space_id, date, amount_cents, merchant) VALUES ('space-test', '2026-01-02', 1299, 'seed shop')`).run();
  const bill = s
    .prepare(`INSERT INTO fin_bill (space_id, name, anchor_date) VALUES ('space-test', 'seed bill', '2026-01-01')`)
    .run();
  s.prepare(`INSERT INTO fin_bill_occurrence (space_id, bill_id, due_date) VALUES ('space-test', ?, '2026-01-01')`).run(Number(bill.lastInsertRowid));
  s.prepare(`INSERT INTO fin_paystub (space_id, net_cents) VALUES ('space-test', 100)`).run();
  // Travel ledger: one completed warp, home → great-station, with its
  // append-only event chain (the current world derives from this).
  s.prepare(
    `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged,
       created_at, cancel_deadline, departed_at, arrived_at, ended_at, bonus_amount, bonus_reason)
     VALUES ('journey-seed-1', 'space-test', 'ck-1', 'warp', 'home', 'great-station', 'arrived', 10,
       '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z', '2026-01-01T00:03:00Z',
       '2026-01-01T00:03:00Z', 5, 'first arrival')`,
  ).run();
  for (const [type, at] of [
    ["departure_armed", "2026-01-01T00:00:00Z"],
    ["departed", "2026-01-01T00:02:00Z"],
    ["arrived", "2026-01-01T00:03:00Z"],
  ] as const) {
    s.prepare(
      `INSERT INTO travel_journey_events (journey_id, space_id, type, created_at) VALUES ('journey-seed-1', 'space-test', ?, ?)`,
    ).run(type, at);
  }
  s.prepare(
    `INSERT INTO npc_relic_holdings (npc_id, space_id, relic_id, found_in_world)
     VALUES ('npc-1', 'space-test', 'relic-seed', 'great-station')`,
  ).run();
  s.prepare(
    `INSERT INTO codex_discoveries (space_id, key, title) VALUES ('space-test', 'seed-discovery', 'Seed Discovery')`,
  ).run();
  s.prepare(
    `INSERT INTO notification_outbox (notif_key, space_id, tool, occurrence_id, message, status, deliver_after)
     VALUES ('seed-notif', 'space-test', 'digest', 'occ-1', 'seed message', 'sent', '2026-01-01T00:00:00Z')`,
  ).run();
  s.prepare(
    `INSERT INTO notification_cap_claims (space_id, local_day, channel, delivery_key, state)
     VALUES ('space-test', '2026-01-01', 'push', 'seed-delivery', 'sent')`,
  ).run();
}

let handle: DbHandle;
let dir: string;
let targetDir: string;

beforeEach(() => {
  handle = createDb(":memory:");
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b4-src-"));
  targetDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b4-tgt-"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
});

/** One promoted backup of the seeded brain, enforcement ON. */
async function makePromotedBackup(store: BackupObjectStore) {
  seedWorkingBrain(handle);
  const res = await runOffVolumeBackup(handle, {
    dir,
    store,
    key: TEST_KEY,
    appCommit: "test-commit",
    enforceMustNonempty: true,
  });
  if (!res.ok) throw new Error(`fixture backup failed at ${res.failureStage}: ${res.failureDetail}`);
  return res;
}

describe("G0 B4 restore — happy path (G0-AC-07, G0-AC-08)", () => {
  it("G0-AC-07: restores latest-good from the store alone, source volume gone", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    // The Fly volume is treated as unavailable: the source brain's
    // local snapshot directory is destroyed and the restore never
    // receives the source handle — only the store and the target
    // path. (The handle stays open-but-untouched until afterEach;
    // the restore has no reference to it by construction.)
    fs.rmSync(dir, { recursive: true, force: true });

    const targetDbPath = nodePath.join(targetDir, "brain.db");
    const res = await runRestore({
      store,
      key: TEST_KEY,
      targetDbPath,
      operator: "test-operator",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.backupId).toBe(backup.attempt.id);
    expect(res.record.operator).toBe("test-operator");
    expect(res.record.outcome).toBe("restored");
    expect(res.record.failureStage).toBeNull();
    expect(res.indexRecordWritten).toBe(true);
    expect(fs.existsSync(targetDbPath)).toBe(true);
    // The target directory holds exactly the restored brain — no
    // staging file or sidecar litter from the swap.
    expect(fs.readdirSync(targetDir)).toEqual(["brain.db"]);
    // All three reconciliation tiers pass, reported separately.
    expect(res.reconciliation.tier1ManifestCounts.ok).toBe(true);
    expect(res.reconciliation.tier1ManifestCounts.countsChecked).toBe(INCLUDED_TABLES.length);
    expect(res.reconciliation.tier2StructuralIntegrity.ok).toBe(true);
    expect(res.reconciliation.tier2StructuralIntegrity.integrity).toBe("ok");
    expect(res.reconciliation.tier3CriticalRecords.ok).toBe(true);
    for (const t of res.reconciliation.tier3CriticalRecords.tables) {
      expect(t.digestsEqual).toBe(true);
      expect(t.installedRows).toBe(t.stagedRows);
    }
    expect(res.reconciliation.tier3CriticalRecords.ledgers.ok).toBe(true);
    // The record landed in the off-volume index (G0-AC-13).
    const index = await readBackupIndex(store);
    expect(index.latestGoodId).toBe(backup.attempt.id);
    expect(index.restoreLog).toHaveLength(1);
    expect(index.restoreLog?.[0]?.restoreId).toBe(res.record.restoreId);
    // No key material anywhere in the record.
    expect(JSON.stringify(res.record)).not.toContain(TEST_KEY.toString("base64"));
    expect(JSON.stringify(res.record)).not.toContain(TEST_KEY.toString("hex"));
  });

  it("G0-AC-08 (unit level): the restored database opens as a working brain — schema, known space, memory count", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const targetDbPath = nodePath.join(targetDir, "brain.db");
    const res = await runRestore({ store, key: TEST_KEY, targetDbPath, operator: "test-operator" });
    expect(res.ok).toBe(true);

    // The artifact AS INSTALLED passes the full standalone verification
    // (checked before any app open: createDb legitimately mutates its
    // database at boot — WAL, bootstrap — which is the app running,
    // not restore drift).
    const v = verifySnapshotFile(targetDbPath, backup.manifest, { enforceMustNonempty: true });
    expect(v.ok).toBe(true);

    const restored = createDb(targetDbPath);
    try {
      // Required schema objects exist and match the recorded schema version.
      expect(restored.sqlite.pragma("user_version", { simple: true })).toBe(backup.manifest.schemaVersion);
      const present = new Set(
        (restored.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map((r) => r.name),
      );
      for (const t of INCLUDED_TABLES) expect(present.has(t)).toBe(true);
      // A known space loads.
      const space = restored.sqlite
        .prepare(`SELECT name FROM spaces WHERE id = 'space-test'`)
        .get() as { name: string } | undefined;
      expect(space?.name).toBe("Test Brain");
      // Memory count matches the manifest.
      const nodes = restored.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes`).get() as { n: number };
      expect(nodes.n).toBe(backup.manifest.tableCounts["nodes"]);
    } finally {
      restored.sqlite.close();
    }
  });

  it("restores a SPECIFIED backup id, not latest-good", async () => {
    const store = new InMemoryBackupStore();
    const first = await makePromotedBackup(store);
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES ('space-test', 'Second', 'note', 'later')`)
      .run();
    const second = await runOffVolumeBackup(handle, {
      dir,
      store,
      key: TEST_KEY,
      enforceMustNonempty: true,
    });
    if (!second.ok) throw new Error("second fixture backup failed");
    expect((await recoverLatestGood(store))?.entry.backupId).toBe(second.attempt.id);

    const targetDbPath = nodePath.join(targetDir, "brain.db");
    const res = await runRestore({ store, key: TEST_KEY, targetDbPath, operator: "op", backupId: first.attempt.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.backupId).toBe(first.attempt.id);
    const raw = new BetterSqlite3(targetDbPath, { readonly: true });
    try {
      const nodes = raw.prepare(`SELECT COUNT(*) AS n FROM nodes`).get() as { n: number };
      expect(nodes.n).toBe(first.manifest.tableCounts["nodes"]);
    } finally {
      raw.close();
    }
  });

  it("a successful restore over an existing brain keeps a pre-restore safety copy (spec §7)", async () => {
    const store = new InMemoryBackupStore();
    await makePromotedBackup(store);
    // The target already holds a DIFFERENT brain.
    const targetDbPath = nodePath.join(targetDir, "brain.db");
    const existing = createDb(targetDbPath);
    existing.sqlite
      .prepare(
        `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
         VALUES ('space-old', 'Old Brain', 'old', 'h', 's')`,
      )
      .run();
    existing.sqlite.close();

    const res = await runRestore({ store, key: TEST_KEY, targetDbPath, operator: "op" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.safetyCopyPath).not.toBeNull();
    expect(fs.existsSync(res.safetyCopyPath!)).toBe(true);
    const safety = new BetterSqlite3(res.safetyCopyPath!, { readonly: true });
    try {
      const old = safety.prepare(`SELECT COUNT(*) AS n FROM spaces WHERE id = 'space-old'`).get() as { n: number };
      expect(old.n).toBe(1);
    } finally {
      safety.close();
    }
    const restored = new BetterSqlite3(targetDbPath, { readonly: true });
    try {
      const now = restored.prepare(`SELECT COUNT(*) AS n FROM spaces WHERE id = 'space-test'`).get() as { n: number };
      expect(now.n).toBe(1);
    } finally {
      restored.close();
    }
  });
});

describe("G0 B4 restore — corruption is rejected before install (G0-AC-06, G0-AC-10)", () => {
  /** A pre-existing target brain whose bytes must survive any failed restore. */
  function makeExistingTarget(): { path: string; sha: string } {
    const p = nodePath.join(targetDir, "brain.db");
    const existing = createDb(p);
    existing.sqlite
      .prepare(
        `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
         VALUES ('space-old', 'Old Brain', 'old', 'h', 's')`,
      )
      .run();
    existing.sqlite.close();
    // Remove WAL sidecars so the byte comparison is of the DB file alone.
    return { path: p, sha: sha256File(p) };
  }

  function expectTargetUntouched(p: string, sha: string) {
    expect(sha256File(p)).toBe(sha);
    // No staging file is left behind in the target directory.
    const leftovers = fs.readdirSync(targetDir).filter((f) => f.includes("restore-staging"));
    expect(leftovers).toEqual([]);
  }

  it("G0-AC-06: a flipped byte in the stored ciphertext fails the restore; the target is untouched", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const target = makeExistingTarget();
    const flipping: BackupObjectStore = {
      putObject: (k, b) => store.putObject(k, b),
      deleteObject: (k) => store.deleteObject(k),
      listObjects: (p) => store.listObjects(p),
      getObject: async (k) => {
        const found = await store.getObject(k);
        if (found && k === snapshotObjectKey(backup.attempt.id)) {
          const bad = Buffer.from(found);
          bad[10] = (bad[10] ?? 0) ^ 0xff;
          return bad;
        }
        return found;
      },
    };
    const res = await runRestore({ store: flipping, key: TEST_KEY, targetDbPath: target.path, operator: "op" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(["download", "decrypt"]).toContain(res.failureStage);
    expect(res.record.outcome).toBe("failed");
    expectTargetUntouched(target.path, target.sha);
    // Latest-good never moved; the failure itself is on record.
    const index = await readBackupIndex(store);
    expect(index.latestGoodId).toBe(backup.attempt.id);
    expect(index.restoreLog?.some((r) => r.outcome === "failed")).toBe(true);
  });

  it("G0-AC-06: a tampered manifest (table counts) fails at verify; the target is untouched", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const target = makeExistingTarget();
    const tampering: BackupObjectStore = {
      putObject: (k, b) => store.putObject(k, b),
      deleteObject: (k) => store.deleteObject(k),
      listObjects: (p) => store.listObjects(p),
      getObject: async (k) => {
        const found = await store.getObject(k);
        if (found && k === manifestObjectKey(backup.attempt.id)) {
          const parsed = JSON.parse(found.toString("utf8")) as { tableCounts: Record<string, number> };
          parsed.tableCounts["spaces"] = 999;
          return Buffer.from(JSON.stringify(parsed), "utf8");
        }
        return found;
      },
    };
    const res = await runRestore({ store: tampering, key: TEST_KEY, targetDbPath: target.path, operator: "op" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("verify");
    expect(res.failureDetail).toMatch(/spaces/);
    expectTargetUntouched(target.path, target.sha);
  });

  it("G0-AC-06: a tampered manifest (snapshot hash) fails before install; the target is untouched", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const target = makeExistingTarget();
    const tampering: BackupObjectStore = {
      putObject: (k, b) => store.putObject(k, b),
      deleteObject: (k) => store.deleteObject(k),
      listObjects: (p) => store.listObjects(p),
      getObject: async (k) => {
        const found = await store.getObject(k);
        if (found && k === manifestObjectKey(backup.attempt.id)) {
          const parsed = JSON.parse(found.toString("utf8")) as { snapshotSha256: string };
          parsed.snapshotSha256 = "0".repeat(64);
          return Buffer.from(JSON.stringify(parsed), "utf8");
        }
        return found;
      },
    };
    const res = await runRestore({ store: tampering, key: TEST_KEY, targetDbPath: target.path, operator: "op" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("decrypt");
    expectTargetUntouched(target.path, target.sha);
  });

  it("fail-closed: a missing or wrong key fails at decrypt and installs nothing (G0-AC-10)", async () => {
    const store = new InMemoryBackupStore();
    await makePromotedBackup(store);
    const targetDbPath = nodePath.join(targetDir, "brain.db");

    const missing = await runRestore({ store, key: null, targetDbPath, operator: "op" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failureStage).toBe("decrypt");
      expect(missing.failureDetail).toMatch(/BACKUP_ENCRYPTION_KEY/);
    }
    expect(fs.existsSync(targetDbPath)).toBe(false);

    const wrong = await runRestore({ store, key: randomBytes(32), targetDbPath, operator: "op" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.failureStage).toBe("decrypt");
    expect(fs.existsSync(targetDbPath)).toBe(false);
  });

  it("restore refuses a backup whose index entry is not promoted", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const index = await readBackupIndex(store);
    const demoted: BackupIndex = {
      ...index,
      latestGoodId: null,
      entries: index.entries.map((e) => (e.backupId === backup.attempt.id ? { ...e, state: "uploaded" as const } : e)),
    };
    await writeBackupIndex(store, demoted);
    const res = await runRestore({
      store,
      key: TEST_KEY,
      targetDbPath: nodePath.join(targetDir, "brain.db"),
      operator: "op",
      backupId: backup.attempt.id,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failureStage).toBe("select");
    expect(fs.existsSync(nodePath.join(targetDir, "brain.db"))).toBe(false);
  });

  it("restore with no promoted backup at all fails at select, installing nothing", async () => {
    const store = new InMemoryBackupStore();
    const res = await runRestore({
      store,
      key: TEST_KEY,
      targetDbPath: nodePath.join(targetDir, "brain.db"),
      operator: "op",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failureStage).toBe("select");
  });
});

describe("G0 B4 reconciliation — tier 3 identity + ledgers (K4, amendment C)", () => {
  it("the critical-record set is a subset of the backup inventory", () => {
    for (const t of CRITICAL_RECORD_TABLES) expect(INCLUDED_TABLES).toContain(t);
    expect(CRITICAL_RECORD_TABLES).toContain("travel_journeys");
    expect(CRITICAL_RECORD_TABLES).toContain("travel_journey_events");
    expect(CRITICAL_RECORD_TABLES).toContain("space_meta");
    expect(CRITICAL_RECORD_TABLES).toContain("npc_relic_holdings");
    expect(CRITICAL_RECORD_TABLES).toContain("notification_cap_claims");
  });

  it("digests bind RECORDS, not counts: same count, different records ⇒ different digest", () => {
    const a = createDb(nodePath.join(dir, "a.db"));
    const b = createDb(nodePath.join(dir, "b.db"));
    try {
      seedWorkingBrain(a);
      seedWorkingBrain(b);
      // Same row COUNT in travel_journeys, a different RECORD.
      b.sqlite
        .prepare(`UPDATE travel_journeys SET destination = 'deep-past' WHERE id = 'journey-seed-1'`)
        .run();
      const da = digestCriticalRecords(a.sqlite);
      const db = digestCriticalRecords(b.sqlite);
      const ta = da.find((d) => d.table === "travel_journeys")!;
      const tb = db.find((d) => d.table === "travel_journeys")!;
      expect(ta.rowCount).toBe(tb.rowCount);
      expect(ta.digest).not.toBe(tb.digest);
      // Untouched tables keep identical digests. (travel_journey_events:
      // every value in the fixture is explicit. Tables whose rows carry
      // wall-clock DEFAULT timestamps — space_meta, fin_* — can differ
      // across two separately-seeded databases; tier 3's real use is
      // staged-vs-installed copies of the SAME database, where the
      // bytes, timestamps included, are identical by construction.)
      expect(da.find((d) => d.table === "travel_journey_events")!.digest).toBe(
        db.find((d) => d.table === "travel_journey_events")!.digest,
      );
    } finally {
      a.sqlite.close();
      b.sqlite.close();
    }
  });

  it("ledger summary recomputes travel derivation, fuel balance, and finance totals from the records", () => {
    seedWorkingBrain(handle);
    const summary = summarizeLedgers(handle.sqlite);
    expect(summary.eventChainViolations).toEqual([]);
    expect(summary.travel).toEqual([
      { spaceId: "space-test", currentWorld: "great-station", journeys: 1, events: 3, fuelCharged: 10, bonusPaid: 5 },
    ]);
    expect(summary.fuel).toEqual([{ spaceId: "space-test", fuel: 137.5 }]);
    expect(summary.finance).toEqual([
      { spaceId: "space-test", incomeCount: 1, incomeNetCents: 4200, expenseCount: 1, expenseCents: 1299 },
    ]);
  });

  it("a journey whose state has no supporting event is a ledger violation", () => {
    seedWorkingBrain(handle);
    handle.sqlite
      .prepare(
        `INSERT INTO travel_journeys (id, space_id, client_key, kind, origin, destination, state, fuel_charged,
           created_at, cancel_deadline)
         VALUES ('journey-broken', 'space-test', 'ck-2', 'drift', 'home', 'quiet-archive', 'arrived', 0,
           '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z')`,
      )
      .run();
    const summary = summarizeLedgers(handle.sqlite);
    expect(summary.eventChainViolations.some((v) => v.includes("journey-broken"))).toBe(true);
  });

  it("digests read a snapshot file standalone (readonly open, vec loaded)", () => {
    const p = nodePath.join(dir, "snap.db");
    const h = createDb(p);
    seedWorkingBrain(h);
    h.sqlite.close();
    const sqlite = openSnapshotReadonly(p);
    try {
      const digests = digestCriticalRecords(sqlite);
      expect(digests.find((d) => d.table === "travel_journeys")?.rowCount).toBe(1);
      expect(digests.find((d) => d.table === "fin_income")?.rowCount).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

describe("G0 B4 restore records in the index (G0-AC-13)", () => {
  it("a pre-B4 index (no restoreLog) still reads, and appends preserve entries + latest-good", async () => {
    const store = new InMemoryBackupStore();
    const legacy: BackupIndex = {
      version: 1,
      latestGoodId: "some-backup",
      entries: [
        {
          backupId: "some-backup",
          createdAt: "2026-10-31T03:30:00.000Z",
          tier: "daily",
          pinned: false,
          state: "promoted",
          failureStage: null,
          failureDetail: null,
          snapshotKey: "backups/some-backup/snapshot.enc",
          manifestKey: "backups/some-backup/manifest.json",
          ciphertextSha256: "0".repeat(64),
          promotedAt: "2026-10-31T03:31:00.000Z",
          prunedAt: null,
        },
      ],
      pruneLog: [],
    };
    await store.putObject("backup-index.json", Buffer.from(JSON.stringify(legacy), "utf8"));
    const read = await readBackupIndex(store);
    expect(read.restoreLog).toEqual([]);
    const record: BackupRestoreRecord = {
      restoreId: "restore-1",
      backupId: "some-backup",
      operator: "op",
      target: "/data/brain.db",
      startedAt: "2026-10-31T12:00:00.000Z",
      finishedAt: "2026-10-31T12:00:05.000Z",
      outcome: "restored",
      failureStage: null,
      failureDetail: null,
      verification: { countsChecked: 114, integrity: "ok", foreignKeyViolations: 0 },
      reconciliation: { tier1Ok: true, tier2Ok: true, tier3Ok: true },
    };
    await appendRestoreRecord(store, record);
    const after = await readBackupIndex(store);
    expect(after.latestGoodId).toBe("some-backup");
    expect(after.entries).toHaveLength(1);
    expect(after.restoreLog).toEqual([record]);
  });
});

describe("G0 B4 preflight — store-alone recovery facts for the operator", () => {
  it("reports latest-good + manifest facts and key PRESENCE only — never the key", async () => {
    const store = new InMemoryBackupStore();
    const backup = await makePromotedBackup(store);
    const withKey = await buildRestorePreflight(store, {
      BACKUP_ENCRYPTION_KEY: TEST_KEY.toString("base64"),
    });
    expect(withKey.latestGoodId).toBe(backup.attempt.id);
    expect(withKey.manifest?.backupId).toBe(backup.attempt.id);
    expect(withKey.manifest?.ciphertextSha256).toBe(backup.manifest.encryption!.ciphertextSha256);
    expect(withKey.keyStatus).toBe("present");
    expect(JSON.stringify(withKey)).not.toContain(TEST_KEY.toString("base64"));

    const without = await buildRestorePreflight(store, {});
    expect(without.keyStatus).toBe("missing_or_malformed");
    expect(without.latestGoodId).toBe(backup.attempt.id);
  });
});

describe("G0 B4 runbook (G0-AC-14)", () => {
  it("the runbook names every required secret — and carries no secret value", () => {
    const runbookPath = nodePath.resolve(
      nodePath.dirname(new URL(import.meta.url).pathname),
      "../../../../docs/G0_BACKUP_RESTORE_RUNBOOK.md",
    );
    const text = fs.readFileSync(runbookPath, "utf8");
    for (const name of [
      "BACKUP_ENCRYPTION_KEY",
      "BACKUP_R2_ENDPOINT",
      "BACKUP_R2_BUCKET",
      "BACKUP_R2_ACCESS_KEY_ID",
      "BACKUP_R2_SECRET_ACCESS_KEY",
    ]) {
      expect(text).toContain(name);
    }
    expect(text).not.toContain(TEST_KEY.toString("base64"));
    expect(text).not.toContain(TEST_KEY.toString("hex"));
  });
});
