/**
 * G0 increment B2 — encryption, off-volume upload, verified-stored,
 * promotion, retention. Maps to G0-AC-03 (manifest hash matches the
 * snapshot retrieved from off-volume storage), G0-AC-05 (manifest +
 * index recoverable independently of the Fly volume), G0-AC-09 (a
 * failed attempt never replaces latest-good), G0-AC-12 (retention
 * cannot auto-delete pinned goldens).
 *
 * All store traffic runs against an in-memory fake — the gate needs no
 * live R2 (credentials are an owner-side Cloudflare step; the S3 client
 * itself is unit-tested below against a stubbed fetch).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { createHash, randomBytes } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import { createDb, type DbHandle } from "../db/client.js";
import { listBackupAttempts } from "../backup/service.js";
import { verifySnapshotFile } from "../backup/manifest.js";
import {
  listPromotedBackups,
  retrieveSnapshotPlaintext,
  runOffVolumeBackup,
} from "../backup/offvolume.js";
import {
  decryptBuffer,
  encryptBuffer,
  loadBackupEncryptionKey,
  sha256Buffer,
} from "../backup/encryption.js";
import {
  InMemoryBackupStore,
  S3BackupStore,
  loadS3StoreConfig,
  manifestObjectKey,
  snapshotObjectKey,
  type BackupObjectStore,
} from "../backup/store.js";
import {
  readBackupIndex,
  recoverLatestGood,
  writeBackupIndex,
  type BackupIndex,
  type BackupIndexEntry,
} from "../backup/index.js";
import { executeRetention, planRetention } from "../backup/retention.js";

const TEST_KEY = Buffer.alloc(32, 0x42);

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

beforeEach(() => {
  handle = createDb(":memory:");
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b2-"));
});

afterEach(() => {
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("G0 B2 encryption primitives", () => {
  it("key loading fails closed: unset, malformed, or wrong-length keys yield null", () => {
    expect(loadBackupEncryptionKey({})).toBeNull();
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: "" })).toBeNull();
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: "not-a-key" })).toBeNull();
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })).toBeNull();
    const b64 = loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: TEST_KEY.toString("base64") });
    expect(b64).not.toBeNull();
    expect(b64!.length).toBe(32);
    expect(b64!.equals(TEST_KEY)).toBe(true);
    const hex = loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: TEST_KEY.toString("hex") });
    expect(hex!.equals(TEST_KEY)).toBe(true);
    // Strict canonical form (review P2): Node's base64 decoder ignores
    // characters outside the alphabet, so a corrupted secret spliced
    // with one would leniently decode to the same 32 bytes. It must be
    // rejected here — not discovered as a wrong key at restore time.
    const good = TEST_KEY.toString("base64");
    const spliced = `${good.slice(0, 10)}!${good.slice(10)}`;
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: spliced })).toBeNull();
    const splitLine = `${good.slice(0, 20)}\n${good.slice(20)}`;
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: splitLine })).toBeNull();
  });

  it("encrypt/decrypt round-trips, with a fresh nonce per backup", () => {
    const plaintext = Buffer.from("the whole brain, supposedly");
    const a = encryptBuffer(plaintext, TEST_KEY);
    const b = encryptBuffer(plaintext, TEST_KEY);
    expect(a.record.algorithm).toBe("aes-256-gcm");
    expect(a.record.nonce).not.toBe(b.record.nonce);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.record.ciphertextSha256).toBe(sha256Buffer(a.ciphertext));
    expect(a.record.ciphertextBytes).toBe(a.ciphertext.length);
    expect(decryptBuffer(a.ciphertext, TEST_KEY, a.record.nonce).equals(plaintext)).toBe(true);
  });

  it("an empty plaintext encrypts to a tag-only object and decrypts back (review P2)", () => {
    const { ciphertext, record } = encryptBuffer(Buffer.alloc(0), TEST_KEY);
    expect(ciphertext.length).toBe(16);
    expect(decryptBuffer(ciphertext, TEST_KEY, record.nonce).length).toBe(0);
  });

  it("tampered ciphertext and wrong keys are rejected by GCM authentication", () => {
    const { ciphertext, record } = encryptBuffer(Buffer.from("precious"), TEST_KEY);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptBuffer(tampered, TEST_KEY, record.nonce)).toThrow();
    expect(() => decryptBuffer(ciphertext, randomBytes(32), record.nonce)).toThrow();
  });
});

describe("G0 B2 off-volume lifecycle", () => {
  it("G0-AC-03 round trip: snapshot → encrypt → store → re-download → decrypt is byte-identical and manifest-verified", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const res = await runOffVolumeBackup(handle, {
      dir,
      store,
      key: TEST_KEY,
      appCommit: "test-commit",
      enforceMustNonempty: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attempt.state).toBe("promoted");
    expect(res.attempt.promotedAt).not.toBeNull();
    // Manifest carries the encryption record — and never key material.
    expect(res.manifest.encryption?.algorithm).toBe("aes-256-gcm");
    expect(res.manifest.encryption?.nonce).toBeTruthy();
    expect(JSON.stringify(res.manifest)).not.toContain(TEST_KEY.toString("base64"));
    // The store holds exactly the three objects, nothing in plaintext.
    expect(store.keys()).toEqual([
      "backup-index.json",
      manifestObjectKey(res.attempt.id),
      snapshotObjectKey(res.attempt.id),
    ]);
    const storedCiphertext = await store.getObject(snapshotObjectKey(res.attempt.id));
    const localPlaintext = fs.readFileSync(res.attempt.snapshotPath!);
    expect(storedCiphertext!.equals(localPlaintext)).toBe(false);
    // The stored ciphertext re-hashes to the manifest (VERIFIED-STORED's check).
    expect(sha256Buffer(storedCiphertext!)).toBe(res.manifest.encryption!.ciphertextSha256);
    // Full retrieval: hash chain + decrypt + plaintext hash (G0-AC-03).
    const plaintext = await retrieveSnapshotPlaintext(store, res.manifest, TEST_KEY);
    expect(plaintext.equals(localPlaintext)).toBe(true);
    expect(sha256Buffer(plaintext)).toBe(res.manifest.snapshotSha256);
    // And the decrypted snapshot is a real, verifiable brain snapshot.
    const restoredPath = nodePath.join(dir, "restored.db");
    fs.writeFileSync(restoredPath, plaintext);
    const v = verifySnapshotFile(restoredPath, res.manifest, { enforceMustNonempty: false });
    expect(v.ok).toBe(true);
    expect(v.integrity).toBe("ok");
    expect(listPromotedBackups(handle).map((a) => a.id)).toEqual([res.attempt.id]);
  });

  it("G0-AC-05: latest-good recovery needs the store alone — no application database", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const first = await runOffVolumeBackup(handle, { dir, store, key: TEST_KEY, enforceMustNonempty: false });
    const second = await runOffVolumeBackup(handle, { dir, store, key: TEST_KEY, enforceMustNonempty: false });
    expect(first.ok && second.ok).toBe(true);
    // recoverLatestGood takes ONLY the store — recovery by construction
    // cannot touch the Fly volume's database.
    const recovered = await recoverLatestGood(store);
    expect(recovered).not.toBeNull();
    expect(recovered!.entry.backupId).toBe(second.ok ? second.attempt.id : "");
    expect(recovered!.entry.state).toBe("promoted");
    expect(recovered!.manifest.snapshotSha256).toBe(second.ok ? second.manifest.snapshotSha256 : "");
    const plaintext = await retrieveSnapshotPlaintext(store, recovered!.manifest, TEST_KEY);
    expect(createHash("sha256").update(plaintext).digest("hex")).toBe(recovered!.manifest.snapshotSha256);
    // A fresh store has no latest-good; a corrupt index fails loudly.
    expect(await recoverLatestGood(new InMemoryBackupStore())).toBeNull();
    const corrupt = new InMemoryBackupStore();
    await corrupt.putObject("backup-index.json", Buffer.from("{not json"));
    await expect(readBackupIndex(corrupt)).rejects.toThrow(/corrupt/i);
  });

  it("fail-closed: with no encryption key the attempt fails at encrypt and NOTHING reaches the store", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const res = await runOffVolumeBackup(handle, {
      dir,
      store,
      key: null, // the BACKUP_ENCRYPTION_KEY-not-set case
      enforceMustNonempty: false,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("encrypt");
    expect(res.failureDetail).toMatch(/BACKUP_ENCRYPTION_KEY/);
    // No plaintext fallback exists: the store is completely empty.
    expect(store.keys()).toEqual([]);
    const attempts = listBackupAttempts(handle);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.state).toBe("failed");
    expect(attempts[0]?.failureStage).toBe("encrypt");
    expect(listPromotedBackups(handle)).toHaveLength(0);
  });

  it("G0-AC-09: a stored copy that fails re-verification is a failed attempt — latest-good is untouched", async () => {
    seedMinimalBrain(handle);
    const inner = new InMemoryBackupStore();
    const good = await runOffVolumeBackup(handle, { dir, store: inner, key: TEST_KEY, enforceMustNonempty: false });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // A store whose reads of the ciphertext come back corrupted.
    const corrupting: BackupObjectStore = {
      putObject: (k, b) => inner.putObject(k, b),
      deleteObject: (k) => inner.deleteObject(k),
      listObjects: (p) => inner.listObjects(p),
      getObject: async (k) => {
        const found = await inner.getObject(k);
        if (found && k.endsWith("snapshot.enc")) {
          const bad = Buffer.from(found);
          bad[0] = (bad[0] ?? 0) ^ 0xff;
          return bad;
        }
        return found;
      },
    };
    const bad = await runOffVolumeBackup(handle, { dir, store: corrupting, key: TEST_KEY, enforceMustNonempty: false });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.failureStage).toBe("verify_stored");
    const index = await readBackupIndex(inner);
    expect(index.latestGoodId).toBe(good.attempt.id);
    expect(index.entries.find((e) => e.backupId === good.attempt.id)?.state).toBe("promoted");
    expect(index.entries.find((e) => e.backupId === bad.attempt.id)?.state).toBe("failed");
    expect(listPromotedBackups(handle).map((a) => a.id)).toEqual([good.attempt.id]);
  });

  it("G0-AC-09: a stored manifest altered in ANY field (not just the hash fields) fails verify_stored (review P2)", async () => {
    seedMinimalBrain(handle);
    const inner = new InMemoryBackupStore();
    const tampering: BackupObjectStore = {
      putObject: (k, b) => inner.putObject(k, b),
      deleteObject: (k) => inner.deleteObject(k),
      listObjects: (p) => inner.listObjects(p),
      getObject: async (k) => {
        const found = await inner.getObject(k);
        if (found && k.endsWith("manifest.json")) {
          const parsed = JSON.parse(found.toString("utf8")) as { tableCounts: Record<string, number> };
          parsed.tableCounts["spaces"] = 999; // backupId + both hashes stay valid
          return Buffer.from(JSON.stringify(parsed), "utf8");
        }
        return found;
      },
    };
    const res = await runOffVolumeBackup(handle, { dir, store: tampering, key: TEST_KEY, enforceMustNonempty: false });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failureStage).toBe("verify_stored");
    expect(await recoverLatestGood(inner)).toBeNull();
  });

  it("promote-stage failure AFTER the index write never leaves the failed attempt as latest-good (review P1)", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const good = await runOffVolumeBackup(handle, { dir, store, key: TEST_KEY, enforceMustNonempty: false });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    // A handle whose sqlite throws on exactly the promote-stage local
    // update — the failure that lands BETWEEN the promote index write
    // (latestGoodId already moved) and the local row update.
    const realSqlite = handle.sqlite;
    const proxied = new Proxy(realSqlite, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("state = 'promoted', promoted_at")) {
              throw new Error("simulated local-update failure after the promote write");
            }
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const evilHandle = { sqlite: proxied } as unknown as DbHandle;
    const bad = await runOffVolumeBackup(evilHandle, { dir, store, key: TEST_KEY, enforceMustNonempty: false });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.failureStage).toBe("promote");
    // The pointer was restored to the previous latest-good, and the
    // failed attempt's entry is recorded as failed — recovery returns
    // the GOOD backup, not the failed one, not a corruption throw.
    const index = await readBackupIndex(store);
    expect(index.latestGoodId).toBe(good.attempt.id);
    expect(index.entries.find((e) => e.backupId === bad.attempt.id)?.state).toBe("failed");
    const recovered = await recoverLatestGood(store);
    expect(recovered?.entry.backupId).toBe(good.attempt.id);
    expect(listBackupAttempts(handle).find((a) => a.id === bad.attempt.id)?.state).toBe("failed");
  });

  it("G0-AC-09: an upload failure is a failed attempt at the upload stage — latest-good is untouched", async () => {
    seedMinimalBrain(handle);
    const inner = new InMemoryBackupStore();
    const good = await runOffVolumeBackup(handle, { dir, store: inner, key: TEST_KEY, enforceMustNonempty: false });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const failing: BackupObjectStore = {
      putObject: async (k, b) => {
        if (k.endsWith("snapshot.enc")) throw new Error("simulated store outage");
        return inner.putObject(k, b);
      },
      deleteObject: (k) => inner.deleteObject(k),
      listObjects: (p) => inner.listObjects(p),
      getObject: (k) => inner.getObject(k),
    };
    const bad = await runOffVolumeBackup(handle, { dir, store: failing, key: TEST_KEY, enforceMustNonempty: false });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.failureStage).toBe("upload");
    const index = await readBackupIndex(inner);
    expect(index.latestGoodId).toBe(good.attempt.id);
    expect(listPromotedBackups(handle).map((a) => a.id)).toEqual([good.attempt.id]);
  });

  it("the key is read from BACKUP_ENCRYPTION_KEY when no override is passed", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const prev = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY.toString("base64");
    try {
      const res = await runOffVolumeBackup(handle, { dir, store, enforceMustNonempty: false });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const plaintext = await retrieveSnapshotPlaintext(store, res.manifest, TEST_KEY);
      expect(sha256Buffer(plaintext)).toBe(res.manifest.snapshotSha256);
    } finally {
      if (prev === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = prev;
    }
  });

  it("interleaved runs: a backup promoted mid-run is never erased by another run's stage writes (review P1)", async () => {
    seedMinimalBrain(handle);
    const inner = new InMemoryBackupStore();
    let interfered = false;
    const holder: { b: Awaited<ReturnType<typeof runOffVolumeBackup>> | null } = { b: null };
    // The moment run A has written its 'uploaded' index entry, run B
    // executes to completion against the same store. A's later stages
    // must build on the CURRENT index — writing back A's stale copy
    // would silently erase B's promoted entry and its latest-good turn.
    const wrapper: BackupObjectStore = {
      putObject: async (k, b) => {
        await inner.putObject(k, b);
        if (!interfered && k === "backup-index.json") {
          const parsed = JSON.parse(b.toString("utf8")) as BackupIndex;
          if (parsed.entries.some((e) => e.state === "uploaded")) {
            interfered = true;
            holder.b = await runOffVolumeBackup(handle, {
              dir,
              store: inner,
              key: TEST_KEY,
              enforceMustNonempty: false,
            });
          }
        }
      },
      getObject: (k) => inner.getObject(k),
      deleteObject: (k) => inner.deleteObject(k),
      listObjects: (p) => inner.listObjects(p),
    };
    const a = await runOffVolumeBackup(handle, { dir, store: wrapper, key: TEST_KEY, enforceMustNonempty: false });
    const backupB = holder.b;
    expect(a.ok).toBe(true);
    expect(backupB?.ok).toBe(true);
    if (!a.ok || !backupB || !backupB.ok) return;
    const index = await readBackupIndex(inner);
    const ids = index.entries.map((e) => e.backupId);
    expect(ids).toContain(a.attempt.id);
    expect(ids).toContain(backupB.attempt.id);
    // B's promotion survived A's verify + promote stages.
    expect(index.entries.find((e) => e.backupId === backupB.attempt.id)?.state).toBe("promoted");
    // A promoted last, so the pointer is legitimately A's.
    expect(index.latestGoodId).toBe(a.attempt.id);
    expect(listPromotedBackups(handle).map((x) => x.id).sort()).toEqual([a.attempt.id, backupB.attempt.id].sort());
  });

  it("a golden run is pinned in both the attempt row and the index entry", async () => {
    seedMinimalBrain(handle);
    const store = new InMemoryBackupStore();
    const res = await runOffVolumeBackup(handle, {
      dir,
      store,
      key: TEST_KEY,
      tier: "golden",
      enforceMustNonempty: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.attempt.tier).toBe("golden");
    expect(res.attempt.pinned).toBe(true);
    const index = await readBackupIndex(store);
    const entry = index.entries.find((e) => e.backupId === res.attempt.id);
    expect(entry?.tier).toBe("golden");
    expect(entry?.pinned).toBe(true);
  });
});

describe("G0 B2 schema: backup_attempts bookkeeping columns", () => {
  it("a B1-era table (no tier/pinned/promoted_at) is upgraded in place by migrateSchema, rows intact", async () => {
    // Build a file DB carrying ONLY the B1 shape of backup_attempts,
    // the way a pre-B2 production volume looks.
    const dbPath = nodePath.join(dir, "legacy.db");
    const raw = new BetterSqlite3(dbPath);
    raw.exec(`
      CREATE TABLE backup_attempts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        state TEXT NOT NULL DEFAULT 'created',
        failure_stage TEXT,
        failure_detail TEXT,
        snapshot_path TEXT,
        snapshot_sha256 TEXT,
        snapshot_bytes INTEGER,
        manifest_json TEXT,
        finished_at TEXT
      );
      INSERT INTO backup_attempts (id, state) VALUES ('legacy-attempt', 'verified_local');
    `);
    raw.close();
    const upgraded = createDb(dbPath);
    try {
      const cols = upgraded.sqlite
        .prepare(`PRAGMA table_info(backup_attempts)`)
        .all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("tier");
      expect(names).toContain("pinned");
      expect(names).toContain("promoted_at");
      const rows = listBackupAttempts(upgraded);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("legacy-attempt");
      expect(rows[0]?.tier).toBe("daily");
      expect(rows[0]?.pinned).toBe(false);
      expect(rows[0]?.promotedAt).toBeNull();
    } finally {
      upgraded.sqlite.close();
    }
  });
});

describe("G0 B2 index integrity: corruption is loud, never masked (review P1)", () => {
  const seededHandles = new WeakSet<DbHandle>();
  async function promotedFixture() {
    if (!seededHandles.has(handle)) {
      seedMinimalBrain(handle);
      seededHandles.add(handle);
    }
    const store = new InMemoryBackupStore();
    const res = await runOffVolumeBackup(handle, { dir, store, key: TEST_KEY, enforceMustNonempty: false });
    if (!res.ok) throw new Error("fixture backup failed");
    return { store, res };
  }

  async function rewriteIndex(store: InMemoryBackupStore, mutate: (idx: Record<string, unknown>) => void) {
    const raw = await store.getObject("backup-index.json");
    const parsed = JSON.parse(raw!.toString("utf8")) as Record<string, unknown>;
    mutate(parsed);
    await store.putObject("backup-index.json", Buffer.from(JSON.stringify(parsed), "utf8"));
  }

  it("a non-string latestGoodId is corruption — never coerced to 'no backups'", async () => {
    const { store } = await promotedFixture();
    await rewriteIndex(store, (idx) => {
      idx["latestGoodId"] = 42;
    });
    await expect(readBackupIndex(store)).rejects.toThrow(/corrupt/);
    await expect(recoverLatestGood(store)).rejects.toThrow(/corrupt/);
  });

  it("a malformed entry (null, or missing its object keys) is corruption", async () => {
    const { store } = await promotedFixture();
    await rewriteIndex(store, (idx) => {
      idx["entries"] = [null];
    });
    await expect(readBackupIndex(store)).rejects.toThrow(/corrupt/);
    const { store: store2, res } = await promotedFixture();
    await rewriteIndex(store2, (idx) => {
      const entries = idx["entries"] as Record<string, unknown>[];
      delete entries[0]!["manifestKey"];
    });
    await expect(readBackupIndex(store2)).rejects.toThrow(/corrupt/);
    expect(res.ok).toBe(true);
  });

  it("latest-good naming a failed or pruned entry is corruption, not a backup", async () => {
    const { store } = await promotedFixture();
    await rewriteIndex(store, (idx) => {
      (idx["entries"] as Record<string, unknown>[])[0]!["state"] = "failed";
    });
    await expect(recoverLatestGood(store)).rejects.toThrow(/not "promoted"/);
    const { store: store2 } = await promotedFixture();
    await rewriteIndex(store2, (idx) => {
      (idx["entries"] as Record<string, unknown>[])[0]!["state"] = "pruned";
    });
    await expect(recoverLatestGood(store2)).rejects.toThrow(/not "promoted"/);
  });

  it("index/manifest ciphertext-hash disagreement is corruption", async () => {
    const { store } = await promotedFixture();
    await rewriteIndex(store, (idx) => {
      (idx["entries"] as Record<string, unknown>[])[0]!["ciphertextSha256"] = "0".repeat(64);
    });
    await expect(recoverLatestGood(store)).rejects.toThrow(/ciphertext hash mismatch/);
  });
});

// ── Retention (G0-AC-12) ──────────────────────────────────────────────

function makeEntry(partial: Partial<BackupIndexEntry> & { backupId: string }): BackupIndexEntry {
  return {
    createdAt: "2026-10-01T03:30:00.000Z",
    tier: "daily",
    pinned: false,
    state: "promoted",
    failureStage: null,
    failureDetail: null,
    snapshotKey: snapshotObjectKey(partial.backupId),
    manifestKey: manifestObjectKey(partial.backupId),
    ciphertextSha256: "0".repeat(64),
    promotedAt: "2026-10-01T03:31:00.000Z",
    prunedAt: null,
    ...partial,
  };
}

function dayStamp(day: number): string {
  return `2026-09-${String(day).padStart(2, "0")}T03:30:00.000Z`;
}

async function seedStoreWithEntries(entries: BackupIndexEntry[], latestGoodId: string | null) {
  const store = new InMemoryBackupStore();
  for (const e of entries) {
    if (e.state === "promoted") {
      await store.putObject(e.snapshotKey, Buffer.from(`ciphertext-${e.backupId}`));
      await store.putObject(e.manifestKey, Buffer.from(`manifest-${e.backupId}`));
    }
  }
  const index: BackupIndex = { version: 1, latestGoodId, entries, pruneLog: [] };
  await writeBackupIndex(store, index);
  return { store, index };
}

describe("G0 B2 retention (G0-AC-12)", () => {
  const daily = Array.from({ length: 16 }, (_, i) =>
    makeEntry({ backupId: `daily-${i + 1}`, tier: "daily", createdAt: dayStamp(i + 1) }),
  );
  const weekly = Array.from({ length: 10 }, (_, i) =>
    makeEntry({ backupId: `weekly-${i + 1}`, tier: "weekly", createdAt: dayStamp(i + 1) }),
  );
  const goldens = [1, 2, 3].map((i) =>
    makeEntry({
      backupId: `golden-${i}`,
      tier: "golden",
      pinned: true,
      createdAt: `2026-08-0${i}T03:30:00.000Z`, // oldest of all — protection must not care
    }),
  );
  const all = [...daily, ...weekly, ...goldens];
  const index: BackupIndex = { version: 1, latestGoodId: "daily-16", entries: all, pruneLog: [] };

  it("the plan prunes exactly the overflow: 2 daily + 2 weekly, never goldens, never latest-good", () => {
    const plan = planRetention(index);
    expect(plan.prune.map((e) => e.backupId).sort()).toEqual(["daily-1", "daily-2", "weekly-1", "weekly-2"]);
    expect(plan.keep.map((e) => e.backupId)).toContain("daily-16"); // latest-good
    for (const g of goldens) expect(plan.keep.map((e) => e.backupId)).toContain(g.backupId);
  });

  it("latest-good is protected even when it falls outside the keep window", () => {
    const stale: BackupIndex = { ...index, latestGoodId: "daily-1" };
    const plan = planRetention(stale);
    expect(plan.prune.map((e) => e.backupId).sort()).toEqual(["daily-2", "weekly-1", "weekly-2"]);
    expect(plan.keep.map((e) => e.backupId)).toContain("daily-1");
  });

  it("dry-run lists exactly what a prune WOULD remove and changes nothing", async () => {
    const { store, index: seeded } = await seedStoreWithEntries(all, "daily-16");
    const before = store.keys();
    const res = await executeRetention(store, seeded, { dryRun: true, now: "2026-10-30T00:00:00.000Z" });
    expect(res.planned.map((e) => e.backupId).sort()).toEqual(["daily-1", "daily-2", "weekly-1", "weekly-2"]);
    expect(res.pruned).toEqual([]);
    expect(store.keys()).toEqual(before);
    const after = await readBackupIndex(store);
    expect(after.pruneLog).toEqual([]);
    expect(after.latestGoodId).toBe("daily-16");
  });

  it("a real prune deletes only the planned objects and records every removal", async () => {
    const { store, index: seeded } = await seedStoreWithEntries(all, "daily-16");
    // Local attempt rows for the prunable + one golden, to see the marking.
    for (const id of ["daily-1", "daily-2", "weekly-1", "weekly-2", "golden-1"]) {
      handle.sqlite
        .prepare(`INSERT INTO backup_attempts (id, created_at, state) VALUES (?, '2026-09-01T03:30:00.000Z', 'promoted')`)
        .run(id);
    }
    const res = await executeRetention(store, seeded, { now: "2026-10-30T00:00:00.000Z", handle });
    expect(res.pruned.map((r) => r.backupId).sort()).toEqual(["daily-1", "daily-2", "weekly-1", "weekly-2"]);
    for (const r of res.pruned) expect(r.reason).toMatch(/retention/);
    const keys = store.keys();
    for (const id of ["daily-1", "daily-2", "weekly-1", "weekly-2"]) {
      expect(keys).not.toContain(snapshotObjectKey(id));
      expect(keys).not.toContain(manifestObjectKey(id));
    }
    // Golden + latest-good objects survive untouched.
    expect(keys).toContain(snapshotObjectKey("golden-1"));
    expect(keys).toContain(snapshotObjectKey("daily-16"));
    const after = await readBackupIndex(store);
    expect(after.latestGoodId).toBe("daily-16");
    expect(after.pruneLog).toHaveLength(4);
    expect(after.entries.find((e) => e.backupId === "daily-1")?.state).toBe("pruned");
    expect(after.entries.find((e) => e.backupId === "golden-1")?.state).toBe("promoted");
    const rows = listBackupAttempts(handle);
    expect(rows.find((a) => a.id === "daily-1")?.state).toBe("pruned");
    expect(rows.find((a) => a.id === "golden-1")?.state).toBe("promoted");
  });

  it("a crash mid-prune never leaves the index advertising deleted objects (review P2)", async () => {
    const { store, index: seeded } = await seedStoreWithEntries(all, "daily-16");
    // Deletes succeed for the first pruned entry, then the store dies.
    const crashing: BackupObjectStore = {
      putObject: (k, b) => store.putObject(k, b),
      getObject: (k) => store.getObject(k),
      listObjects: (p) => store.listObjects(p),
      deleteObject: async (k) => {
        if (k.includes("daily-1")) throw new Error("simulated crash during prune");
        return store.deleteObject(k);
      },
    };
    await expect(
      executeRetention(crashing, seeded, { now: "2026-10-30T00:00:00.000Z" }),
    ).rejects.toThrow(/simulated crash/);
    const after = await readBackupIndex(store);
    // Both entries the run reached were marked + recorded BEFORE any
    // delete was attempted on them.
    expect(after.entries.find((e) => e.backupId === "daily-2")?.state).toBe("pruned");
    expect(after.entries.find((e) => e.backupId === "daily-1")?.state).toBe("pruned");
    expect(after.pruneLog.map((r) => r.backupId)).toEqual(["daily-2", "daily-1"]);
    // The invariant that matters: every entry still advertised as a
    // good backup has BOTH of its objects present in the store.
    const keys = store.keys();
    for (const e of after.entries.filter((x) => x.state === "promoted")) {
      expect(keys).toContain(e.snapshotKey);
      expect(keys).toContain(e.manifestKey);
    }
    expect(after.latestGoodId).toBe("daily-16");
  });
});

// ── S3 transport (unit, stubbed fetch — no network) ───────────────────

describe("G0 B2 S3-compatible store", () => {
  it("config loads only when fully specified; region defaults to auto", () => {
    expect(loadS3StoreConfig({})).toBeNull();
    expect(loadS3StoreConfig({ BACKUP_R2_ENDPOINT: "https://x.example", BACKUP_R2_BUCKET: "b" })).toBeNull();
    const cfg = loadS3StoreConfig({
      BACKUP_R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com/",
      BACKUP_R2_BUCKET: "brain-backups",
      BACKUP_R2_ACCESS_KEY_ID: "kid",
      BACKUP_R2_SECRET_ACCESS_KEY: "secret",
    });
    expect(cfg).toEqual({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "brain-backups",
      accessKeyId: "kid",
      secretAccessKey: "secret",
      region: "auto",
    });
  });

  it("signs requests with SigV4 and maps 404 to null", async () => {
    const store = new S3BackupStore({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "brain-backups",
      accessKeyId: "kid",
      secretAccessKey: "secret",
      region: "auto",
    });
    const seen: { url: string; method: string; auth: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: { method?: string; headers?: Record<string, string> }) => {
        seen.push({
          url: String(url),
          method: init.method ?? "GET",
          auth: init.headers?.["Authorization"] ?? "",
        });
        if (init.method === "GET" && String(url).includes("missing")) {
          return new Response("not found", { status: 404 });
        }
        if (init.method === "GET") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        return new Response("", { status: 200 });
      }),
    );
    await store.putObject("backups/abc/snapshot.enc", Buffer.from("ciphertext"));
    expect(seen[0]?.url).toBe("https://acct.r2.cloudflarestorage.com/brain-backups/backups/abc/snapshot.enc");
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=kid\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-length;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(await store.getObject("backups/abc/snapshot.enc")).toEqual(Buffer.from([1, 2, 3]));
    expect(await store.getObject("backups/missing/snapshot.enc")).toBeNull();
  });

  it("listObjects parses ListObjectsV2 XML", async () => {
    const store = new S3BackupStore({
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "brain-backups",
      accessKeyId: "kid",
      secretAccessKey: "secret",
      region: "auto",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><Contents><Key>backups/a/manifest.json</Key></Contents><Contents><Key>backups/a/snapshot.enc</Key></Contents></ListBucketResult>`,
          { status: 200 },
        ),
      ),
    );
    expect(await store.listObjects("backups/")).toEqual(["backups/a/manifest.json", "backups/a/snapshot.enc"]);
  });
});
