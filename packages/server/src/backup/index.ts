/**
 * G0 backup — the off-volume backup index (increment B2; G0 spec §3/§5).
 *
 * The index lives IN the object store, next to the snapshots it
 * describes — never only on the Fly volume. Latest-good recovery needs
 * nothing but the store: read the index, follow `latestGoodId`, fetch
 * that entry's manifest object, and the manifest's hashes validate the
 * snapshot (spec §3, G0-AC-05). No application database participates.
 *
 * Promotion is a single index write (spec §5): one PUT of this JSON
 * moves `latestGoodId` and the entry's state together, so the pointer
 * can never be observed half-moved, and a failed attempt — recorded
 * here with its failure stage, like the local attempt row — never
 * disturbs the previous latest-good (G0-AC-09).
 */
import { BACKUP_INDEX_KEY, type BackupObjectStore } from "./store.js";
import type { BackupManifest } from "./manifest.js";

/** Retention tier (plan §1): the Sunday daily is tagged "weekly"; goldens are pinned. */
export type BackupTier = "daily" | "weekly" | "golden";

export type StoredBackupState =
  | "uploaded"
  | "verified_stored"
  | "promoted"
  | "failed"
  | "pruned";

export interface BackupIndexEntry {
  backupId: string;
  /** ISO-Z creation time of the backup. */
  createdAt: string;
  tier: BackupTier;
  /** Pinned entries (goldens) are NEVER auto-deleted (G0-AC-12). */
  pinned: boolean;
  state: StoredBackupState;
  failureStage: string | null;
  failureDetail: string | null;
  snapshotKey: string;
  manifestKey: string;
  /** SHA-256 of the stored ciphertext object, from the manifest. */
  ciphertextSha256: string | null;
  promotedAt: string | null;
  prunedAt: string | null;
}

export interface BackupPruneRecord {
  backupId: string;
  prunedAt: string;
  /** Why retention removed it, e.g. "retention: beyond the 14-daily keep window". */
  reason: string;
}

export interface BackupIndex {
  version: 1;
  latestGoodId: string | null;
  entries: BackupIndexEntry[];
  pruneLog: BackupPruneRecord[];
}

export function emptyBackupIndex(): BackupIndex {
  return { version: 1, latestGoodId: null, entries: [], pruneLog: [] };
}

function corrupt(detail: string): Error {
  return new Error(`backup index is corrupt (${detail})`);
}

/**
 * Structural validation of one entry. The load-bearing fields are
 * checked strictly: an entry that cannot name its backup, its state,
 * and its objects is corruption, not data — accepting it would let
 * recovery dereference missing fields and crash (or worse, guess).
 */
function validateEntry(raw: unknown, i: number): BackupIndexEntry {
  if (typeof raw !== "object" || raw === null) throw corrupt(`entry ${i} is not an object`);
  const e = raw as Record<string, unknown>;
  for (const field of ["backupId", "createdAt", "tier", "state", "snapshotKey", "manifestKey"] as const) {
    if (typeof e[field] !== "string") throw corrupt(`entry ${i} has no string ${field}`);
  }
  if (typeof e["pinned"] !== "boolean") throw corrupt(`entry ${i} has no boolean pinned`);
  return raw as BackupIndexEntry;
}

/**
 * Read the index from the store. A MISSING index is an empty index
 * (nothing stored yet). A CORRUPT index throws — silently resetting
 * latest-good to "none" would be exactly the failure this system
 * exists to prevent, so it fails loudly instead. Validation is strict
 * (review P1): latestGoodId must be a string or null (never coerced),
 * and every entry must carry its load-bearing fields.
 */
export async function readBackupIndex(store: BackupObjectStore): Promise<BackupIndex> {
  const raw = await store.getObject(BACKUP_INDEX_KEY);
  if (raw === null) return emptyBackupIndex();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw corrupt(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const idx = parsed as Partial<BackupIndex>;
  if (idx.version !== 1 || !Array.isArray(idx.entries) || !Array.isArray(idx.pruneLog)) {
    throw corrupt("unexpected shape");
  }
  if (idx.latestGoodId !== null && idx.latestGoodId !== undefined && typeof idx.latestGoodId !== "string") {
    throw corrupt("latestGoodId is not a string");
  }
  return {
    version: 1,
    latestGoodId: typeof idx.latestGoodId === "string" ? idx.latestGoodId : null,
    entries: (idx.entries as unknown[]).map(validateEntry),
    pruneLog: idx.pruneLog as BackupPruneRecord[],
  };
}

/** The single write through which every index transition happens. */
export async function writeBackupIndex(store: BackupObjectStore, index: BackupIndex): Promise<void> {
  await store.putObject(BACKUP_INDEX_KEY, Buffer.from(JSON.stringify(index, null, 2), "utf8"));
}

/** Insert or replace the entry for its backupId; returns the updated index. */
export function upsertIndexEntry(index: BackupIndex, entry: BackupIndexEntry): BackupIndex {
  const entries = index.entries.filter((e) => e.backupId !== entry.backupId);
  entries.push(entry);
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.backupId.localeCompare(b.backupId));
  return { ...index, entries };
}

export function findIndexEntry(index: BackupIndex, backupId: string): BackupIndexEntry | null {
  return index.entries.find((e) => e.backupId === backupId) ?? null;
}

export interface RecoveredLatestGood {
  entry: BackupIndexEntry;
  manifest: BackupManifest;
}

/**
 * Latest-good recovery from the store ALONE (G0-AC-05): index →
 * latestGoodId → that entry's manifest object. Returns null when no
 * backup has ever been promoted. Throws when the index names a
 * latest-good whose manifest object is missing or unreadable — that is
 * store corruption, and it must be loud, not a silent "no backups".
 */
export async function recoverLatestGood(
  store: BackupObjectStore,
): Promise<RecoveredLatestGood | null> {
  const index = await readBackupIndex(store);
  if (!index.latestGoodId) return null;
  const entry = findIndexEntry(index, index.latestGoodId);
  if (!entry) {
    throw new Error(`backup index latest-good ${index.latestGoodId} has no entry — index corrupt`);
  }
  // Only a PROMOTED entry can be latest-good (review P1): an index
  // naming a failed/pruned/in-flight entry as latest-good is corrupt,
  // and returning it would hand a restore a non-backup.
  if (entry.state !== "promoted") {
    throw new Error(
      `backup index latest-good ${entry.backupId} is in state "${entry.state}", not "promoted" — index corrupt`,
    );
  }
  const raw = await store.getObject(entry.manifestKey);
  if (raw === null) {
    throw new Error(`latest-good manifest object missing from store: ${entry.manifestKey}`);
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw.toString("utf8")) as BackupManifest;
  } catch (err) {
    throw new Error(
      `latest-good manifest is corrupt: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (manifest.backupId !== entry.backupId) {
    throw new Error(
      `latest-good manifest backupId mismatch: index ${entry.backupId}, manifest ${manifest.backupId}`,
    );
  }
  // The index entry and the manifest must agree on the ciphertext hash
  // — the index alone never vouches for a snapshot (spec §3: verify the
  // manifest hash against the retrieved snapshot; the download itself
  // is hash-checked in retrieveSnapshotPlaintext).
  if (
    entry.ciphertextSha256 !== null &&
    manifest.encryption?.ciphertextSha256 !== entry.ciphertextSha256
  ) {
    throw new Error(
      `latest-good ciphertext hash mismatch: index ${entry.ciphertextSha256}, manifest ${manifest.encryption?.ciphertextSha256 ?? "(no encryption record)"}`,
    );
  }
  return { entry, manifest };
}
