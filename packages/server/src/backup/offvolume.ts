/**
 * G0 backup — off-volume lifecycle (increment B2; G0 spec §5).
 *
 * Continues a B1 attempt past VERIFIED-LOCAL:
 *   VERIFIED-LOCAL → (encrypt) → UPLOADED → VERIFIED-STORED → PROMOTED.
 *
 * Stage rules, per spec §5 + plan §3:
 * - ENCRYPT: AES-256-GCM (see encryption.ts). No key ⇒ the attempt
 *   fails HERE, closed: nothing is uploaded, ever, in plaintext.
 * - UPLOAD: ciphertext object first, manifest object second, index
 *   entry last — the index never points at objects that don't exist.
 * - VERIFIED-STORED: both objects are re-read from the store and the
 *   ciphertext is re-hashed against the manifest (G0-AC-03). A stored
 *   copy that doesn't re-verify is a FAILED ATTEMPT, never promoted.
 * - PROMOTE: one index write moves latestGoodId + entry state
 *   together. Any failure before it leaves the previous latest-good
 *   fully intact (G0-AC-09).
 *
 * The local plaintext snapshot file is left in place (local retention
 * is not B2's scope; the off-volume copy is the backup of record).
 */
import * as fs from "node:fs";
import type { DbHandle } from "../db/client.js";
import {
  listBackupAttempts,
  runBackupAttempt,
  type BackupAttemptRow,
  type BackupFailureStage,
  type BackupTrigger,
} from "./service.js";
import type { BackupManifest } from "./manifest.js";
import {
  decryptBuffer,
  encryptBuffer,
  loadBackupEncryptionKey,
  sha256Buffer,
} from "./encryption.js";
import {
  manifestObjectKey,
  snapshotObjectKey,
  type BackupObjectStore,
} from "./store.js";
import {
  findIndexEntry,
  readBackupIndex,
  upsertIndexEntry,
  writeBackupIndex,
  type BackupIndex,
  type BackupIndexEntry,
  type BackupTier,
} from "./index.js";

/** JSON with object keys sorted recursively — for deep manifest comparison. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface RunOffVolumeOptions {
  /** Directory the local snapshot is written into (B1 stage). */
  dir: string;
  store: BackupObjectStore;
  /**
   * Encryption key override (tests). Undefined ⇒ read from the
   * BACKUP_ENCRYPTION_KEY env var. Explicit null ⇒ simulate the
   * missing-key case: the attempt fails closed at the encrypt stage.
   */
  key?: Buffer | null;
  /** Retention tier; default "daily". "golden" implies pinned. */
  tier?: BackupTier;
  /** Pin against retention; default: tier === "golden". */
  pinned?: boolean;
  /** How this attempt was started (B3); recorded on the row at creation. */
  trigger?: BackupTrigger;
  appCommit?: string;
  /** MUST-BE-NONEMPTY guard enforcement for the B1 stage (see service.ts). */
  enforceMustNonempty?: boolean;
}

export type RunOffVolumeResult =
  | { ok: true; attempt: BackupAttemptRow; manifest: BackupManifest; index: BackupIndex }
  | { ok: false; attempt: BackupAttemptRow; failureStage: BackupFailureStage; failureDetail: string };

/** Backups that completed the full lifecycle and became latest-good at some point. */
export function listPromotedBackups(handle: DbHandle): BackupAttemptRow[] {
  return listBackupAttempts(handle).filter((a) => a.state === "promoted");
}

export async function runOffVolumeBackup(
  handle: DbHandle,
  opts: RunOffVolumeOptions,
): Promise<RunOffVolumeResult> {
  const sqlite = handle.sqlite;
  const tier: BackupTier = opts.tier ?? "daily";
  const pinned = opts.pinned ?? tier === "golden";

  // B1 leg: CREATED → VERIFIED-LOCAL. Its failures are already recorded
  // on the attempt row with their B1 stage; pass them through untouched.
  const local = runBackupAttempt(handle, {
    dir: opts.dir,
    appCommit: opts.appCommit,
    enforceMustNonempty: opts.enforceMustNonempty,
    // B3: trigger/tier/pinned land at creation (a golden is pinned
    // from its first moment); the bookkeeping UPDATE below re-writes
    // the same tier/pinned values and stays as the backstop.
    trigger: opts.trigger,
    tier,
    pinned,
  });
  if (!local.ok) {
    return { ok: false, attempt: local.attempt, failureStage: local.failureStage, failureDetail: local.failureDetail };
  }
  const id = local.attempt.id;
  let manifest: BackupManifest = local.manifest;

  const readAttempt = (): BackupAttemptRow => {
    const rows = listBackupAttempts(handle);
    const row = rows.find((a) => a.id === id);
    if (!row) throw new Error(`backup attempt row vanished mid-run: ${id}`);
    return row;
  };

  // Record a B2-stage failure on the attempt row; when the attempt
  // already has an off-volume index entry, mirror the failure there
  // (best-effort: the local row is the authoritative attempt record,
  // and a store that just failed may fail this write too).
  // POINTER SAFETY (review P1): if this attempt had already been made
  // latest-good — possible when the promote index write landed but the
  // local row update then threw — the mirror must ALSO restore
  // latestGoodId to the newest remaining promoted entry (or null). A
  // failed attempt never remains latest-good (G0-AC-09).
  const fail = async (stage: BackupFailureStage, detail: string): Promise<RunOffVolumeResult> => {
    sqlite
      .prepare(
        `UPDATE backup_attempts SET state = 'failed', failure_stage = ?, failure_detail = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(stage, detail, new Date().toISOString(), id);
    try {
      const index = await readBackupIndex(opts.store);
      const entry = findIndexEntry(index, id);
      if (entry) {
        let next = upsertIndexEntry(index, {
          ...entry,
          state: "failed",
          failureStage: stage,
          failureDetail: detail,
        });
        if (next.latestGoodId === id) {
          const survivors = next.entries
            .filter((e) => e.backupId !== id && e.state === "promoted")
            .sort((a, b) =>
              (b.promotedAt ?? b.createdAt).localeCompare(a.promotedAt ?? a.createdAt),
            );
          next = { ...next, latestGoodId: survivors[0]?.backupId ?? null };
        }
        await writeBackupIndex(opts.store, next);
      }
    } catch {
      // Best-effort mirror only — see above.
    }
    return { ok: false, attempt: readAttempt(), failureStage: stage, failureDetail: detail };
  };

  // Bookkeeping (review P2): tier/pinned land on the attempt row
  // before the stages begin. Wrapped like every other stage — a throw
  // here is a recorded attempt failure, never an escaping exception
  // that leaves the row dishonestly at 'verified_local'.
  try {
    sqlite
      .prepare(`UPDATE backup_attempts SET tier = ?, pinned = ? WHERE id = ?`)
      .run(tier, pinned ? 1 : 0, id);
  } catch (err) {
    return fail("encrypt", `attempt bookkeeping update failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Stage: encrypt ────────────────────────────────────────────────
  const key = opts.key !== undefined ? opts.key : loadBackupEncryptionKey();
  if (!key) {
    return fail(
      "encrypt",
      "BACKUP_ENCRYPTION_KEY is not set or does not decode to a 32-byte key — " +
        "refusing to store an unencrypted snapshot (fail-closed, plan §3)",
    );
  }
  let ciphertext: Buffer;
  try {
    const plaintext = fs.readFileSync(local.attempt.snapshotPath!);
    const encrypted = encryptBuffer(plaintext, key);
    ciphertext = encrypted.ciphertext;
    manifest = { ...manifest, encryption: encrypted.record };
    sqlite
      .prepare(`UPDATE backup_attempts SET manifest_json = ? WHERE id = ?`)
      .run(JSON.stringify(manifest), id);
  } catch (err) {
    return fail("encrypt", err instanceof Error ? err.message : String(err));
  }

  // ── Stage: upload ─────────────────────────────────────────────────
  const snapshotKey = snapshotObjectKey(id);
  const manifestKey = manifestObjectKey(id);
  let index: BackupIndex;
  try {
    await opts.store.putObject(snapshotKey, ciphertext);
    await opts.store.putObject(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    index = await readBackupIndex(opts.store);
    const entry: BackupIndexEntry = {
      backupId: id,
      createdAt: manifest.createdAt,
      tier,
      pinned,
      state: "uploaded",
      failureStage: null,
      failureDetail: null,
      snapshotKey,
      manifestKey,
      ciphertextSha256: manifest.encryption!.ciphertextSha256,
      promotedAt: null,
      prunedAt: null,
    };
    index = upsertIndexEntry(index, entry);
    await writeBackupIndex(opts.store, index);
    sqlite.prepare(`UPDATE backup_attempts SET state = 'uploaded' WHERE id = ?`).run(id);
  } catch (err) {
    return fail("upload", err instanceof Error ? err.message : String(err));
  }

  // ── Stage: verify-stored ──────────────────────────────────────────
  // Re-read BOTH objects from the store and re-hash the ciphertext
  // against the manifest (G0-AC-03). Trust nothing the upload claimed.
  // The index is re-read INSIDE this stage (review P1): writing back
  // the upload-stage copy would erase any entry another run promoted
  // in between — a lost update that silently un-promotes a backup.
  try {
    const storedCiphertext = await opts.store.getObject(snapshotKey);
    if (storedCiphertext === null) {
      return fail("verify_stored", `stored snapshot object missing after upload: ${snapshotKey}`);
    }
    const actualCipherHash = sha256Buffer(storedCiphertext);
    if (actualCipherHash !== manifest.encryption!.ciphertextSha256) {
      return fail(
        "verify_stored",
        `stored ciphertext SHA-256 mismatch: manifest ${manifest.encryption!.ciphertextSha256}, stored ${actualCipherHash}`,
      );
    }
    const storedManifestRaw = await opts.store.getObject(manifestKey);
    if (storedManifestRaw === null) {
      return fail("verify_stored", `stored manifest object missing after upload: ${manifestKey}`);
    }
    const storedManifest = JSON.parse(storedManifestRaw.toString("utf8")) as BackupManifest;
    // Deep equality against the local manifest (review P2): the stored
    // manifest is exactly what recovery later trusts, so EVERY field —
    // nonce, tableCounts, schemaVersion, hashes — must match, not just
    // the three identifiers. Canonical key order makes the compare
    // insensitive to serialization order only.
    if (canonicalJson(storedManifest) !== canonicalJson(manifest)) {
      return fail("verify_stored", "stored manifest does not match the local manifest");
    }
    index = await readBackupIndex(opts.store);
    const entry = findIndexEntry(index, id);
    if (!entry) {
      return fail("verify_stored", "backup index entry missing at the verify stage — index changed under this run");
    }
    index = upsertIndexEntry(index, { ...entry, state: "verified_stored" });
    await writeBackupIndex(opts.store, index);
    sqlite.prepare(`UPDATE backup_attempts SET state = 'verified_stored' WHERE id = ?`).run(id);
  } catch (err) {
    return fail("verify_stored", err instanceof Error ? err.message : String(err));
  }

  // ── Stage: promote ────────────────────────────────────────────────
  // One index write: entry → promoted AND latestGoodId → this backup.
  // Built on a FRESH index read, like verify (review P1): the pointer
  // moves, every other entry — including a backup another run promoted
  // while this one was verifying — is preserved exactly as stored.
  try {
    const promotedAt = new Date().toISOString();
    index = await readBackupIndex(opts.store);
    const entry = findIndexEntry(index, id);
    if (!entry) {
      return fail("promote", "backup index entry missing at the promote stage — index changed under this run");
    }
    index = {
      ...upsertIndexEntry(index, { ...entry, state: "promoted", promotedAt }),
      latestGoodId: id,
    };
    await writeBackupIndex(opts.store, index);
    sqlite
      .prepare(`UPDATE backup_attempts SET state = 'promoted', promoted_at = ?, finished_at = ? WHERE id = ?`)
      .run(promotedAt, promotedAt, id);
  } catch (err) {
    return fail("promote", err instanceof Error ? err.message : String(err));
  }

  return { ok: true, attempt: readAttempt(), manifest, index };
}

/**
 * Retrieve a stored backup's plaintext from the store alone: fetch the
 * ciphertext object named by the manifest, re-hash it against the
 * manifest (G0-AC-03), decrypt, and check the plaintext against the
 * manifest's snapshot hash — the full round trip B4's restore builds on.
 * Throws on any mismatch; a tampered object never yields plaintext.
 */
export async function retrieveSnapshotPlaintext(
  store: BackupObjectStore,
  manifest: BackupManifest,
  key: Buffer,
): Promise<Buffer> {
  if (!manifest.encryption) {
    throw new Error("manifest has no encryption record — not an off-volume (B2) backup");
  }
  const key2 = snapshotObjectKey(manifest.backupId);
  const stored = await store.getObject(key2);
  if (stored === null) {
    throw new Error(`stored snapshot object missing: ${key2}`);
  }
  const actualCipherHash = sha256Buffer(stored);
  if (actualCipherHash !== manifest.encryption.ciphertextSha256) {
    throw new Error(
      `stored ciphertext SHA-256 mismatch: manifest ${manifest.encryption.ciphertextSha256}, stored ${actualCipherHash}`,
    );
  }
  const plaintext = decryptBuffer(stored, key, manifest.encryption.nonce);
  const actualPlainHash = sha256Buffer(plaintext);
  if (actualPlainHash !== manifest.snapshotSha256) {
    throw new Error(
      `decrypted snapshot SHA-256 mismatch: manifest ${manifest.snapshotSha256}, decrypted ${actualPlainHash}`,
    );
  }
  return plaintext;
}
