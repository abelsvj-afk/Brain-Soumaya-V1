/**
 * G0 backup — the restore procedure (increment B4; G0 spec §8).
 *
 * Restores a brain database from the OFF-VOLUME copy alone, in the
 * spec's order: read the backup index from the object store (no
 * application database participates) → select latest-good or a
 * specified backup → download the ciphertext and verify its SHA-256
 * against the manifest → decrypt (AES-256-GCM; the strict key loader
 * from B2 — a missing/malformed key fails closed, there is no
 * plaintext path) → verify the decrypted snapshot standalone
 * (manifest counts + structural integrity + MUST-BE-NONEMPTY
 * enforcement, `verifySnapshotFile`) → stage it beside the target →
 * reconcile tier 3 on the staged file → swap atomically → re-verify
 * the installed file (hash + tier-3 digests) → record the restore.
 *
 * Safety rules, all load-bearing:
 * - The target is NEVER overwritten in place. The verified snapshot
 *   is staged in the target's own directory and renamed over the
 *   target only after every check has passed; the previous database
 *   (when one exists) is first moved aside as a `.pre-restore-*`
 *   safety copy (spec §7) and is rolled back if the post-install
 *   checks diverge. A failed restore leaves the target byte-for-byte
 *   what it was (G0-AC-10).
 * - Corruption is rejected BEFORE install (G0-AC-06): a flipped byte
 *   fails the ciphertext hash or GCM authentication; a tampered
 *   manifest fails its agreement checks or the count reconciliation.
 *   Nothing partial is ever installed.
 * - Every completed run — restored or failed — produces a restore
 *   record (G0-AC-13): backup id, operator, times, verification
 *   outcome. The record is appended to the off-volume index on a
 *   fresh read (never moving latest-good); when the store
 *   credentials are read-only (the drill's least-privilege setup)
 *   that append fails and `indexRecordWritten` says so — the caller
 *   (restore-cli) then persists the record to a local file instead.
 *   A restore with NO record counts as unproven (spec §8 step 7).
 *
 * This module never starts the server and never touches a live
 * database handle: it works on files and the object store only, so
 * the operator runs it with the target app stopped (see the runbook,
 * docs/G0_BACKUP_RESTORE_RUNBOOK.md).
 */
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import {
  decryptBuffer,
  loadBackupEncryptionKey,
  sha256Buffer,
} from "./encryption.js";
import {
  appendRestoreRecord,
  findIndexEntry,
  readBackupIndex,
  recoverLatestGood,
  type BackupIndex,
  type BackupIndexEntry,
  type BackupRestoreRecord,
} from "./index.js";
import {
  sha256File,
  verifySnapshotFile,
  type BackupManifest,
  type SnapshotVerification,
} from "./manifest.js";
import type { BackupObjectStore } from "./store.js";
import {
  digestCriticalRecords,
  ledgerSummariesEqual,
  openSnapshotReadonly,
  summarizeLedgers,
  type LedgerSummary,
  type TableRecordDigest,
} from "./reconcile.js";

export type RestoreFailureStage =
  | "index"
  | "select"
  | "download"
  | "decrypt"
  | "verify"
  | "reconcile"
  | "install";

/**
 * The three reconciliation tiers, reported SEPARATELY (amendment C —
 * no tier substitutes for another). Tiers 1+2 come from the staged
 * snapshot's standalone verification; tier 3 compares the staged
 * snapshot against the installed database after the swap.
 */
export interface RestoreReconciliationReport {
  tier1ManifestCounts: { ok: boolean; countsChecked: number; failures: string[] };
  tier2StructuralIntegrity: { ok: boolean; integrity: string; foreignKeyViolations: number };
  tier3CriticalRecords: {
    ok: boolean;
    tables: {
      table: string;
      stagedRows: number;
      installedRows: number | null;
      digestsEqual: boolean;
    }[];
    ledgers: { ok: boolean; staged: LedgerSummary | null; installed: LedgerSummary | null };
  };
}

export interface RunRestoreOptions {
  store: BackupObjectStore;
  /**
   * Encryption key override (tests). Undefined ⇒ read from the
   * BACKUP_ENCRYPTION_KEY env var via the strict B2 loader. Explicit
   * null ⇒ the missing-key case: the restore fails closed at the
   * decrypt stage.
   */
  key?: Buffer | null;
  /** Backup to restore. Undefined ⇒ the index's latest-good. */
  backupId?: string;
  /** Absolute or relative path of the database file to install as. */
  targetDbPath: string;
  /** Who is performing the restore — recorded (G0-AC-13). */
  operator: string;
  /** MUST-BE-NONEMPTY enforcement on the staged snapshot. Default true (inventory v5). */
  enforceMustNonempty?: boolean;
  /** Clock override (tests). */
  now?: () => Date;
}

export type RestoreResult =
  | {
      ok: true;
      record: BackupRestoreRecord;
      reconciliation: RestoreReconciliationReport;
      manifest: BackupManifest;
      /** The pre-restore safety copy of the previous target, when one existed. */
      safetyCopyPath: string | null;
      indexRecordWritten: boolean;
    }
  | {
      ok: false;
      record: BackupRestoreRecord;
      failureStage: RestoreFailureStage;
      failureDetail: string;
      reconciliation: RestoreReconciliationReport | null;
      indexRecordWritten: boolean;
    };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fsyncFile(path: string): void {
  const fd = fs.openSync(path, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(path: string): void {
  try {
    const fd = fs.openSync(path, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Best effort only — some filesystems refuse directory fsync.
  }
}

function moveAside(from: string, to: string): void {
  if (fs.existsSync(from)) fs.renameSync(from, to);
}

function removeIfExists(path: string): void {
  if (fs.existsSync(path)) fs.rmSync(path, { force: true });
}

/**
 * Fetch + validate the manifest for a by-id restore, mirroring
 * recoverLatestGood's agreement checks (the index alone never
 * vouches for a snapshot): the manifest must exist, name the same
 * backup, and agree with the index entry on the ciphertext hash.
 */
async function fetchManifestForEntry(
  store: BackupObjectStore,
  entry: BackupIndexEntry,
): Promise<BackupManifest> {
  const raw = await store.getObject(entry.manifestKey);
  if (raw === null) {
    throw new Error(`manifest object missing from store: ${entry.manifestKey}`);
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw.toString("utf8")) as BackupManifest;
  } catch (err) {
    throw new Error(`manifest is corrupt: ${errMsg(err)}`);
  }
  if (manifest.backupId !== entry.backupId) {
    throw new Error(`manifest backupId mismatch: index ${entry.backupId}, manifest ${manifest.backupId}`);
  }
  if (entry.ciphertextSha256 !== null && manifest.encryption?.ciphertextSha256 !== entry.ciphertextSha256) {
    throw new Error(
      `ciphertext hash mismatch: index ${entry.ciphertextSha256}, manifest ${manifest.encryption?.ciphertextSha256 ?? "(no encryption record)"}`,
    );
  }
  return manifest;
}

export async function runRestore(opts: RunRestoreOptions): Promise<RestoreResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const restoreId = randomUUID();
  const targetPath = nodePath.resolve(opts.targetDbPath);
  const targetDir = nodePath.dirname(targetPath);

  let backupId: string | null = opts.backupId ?? null;
  let manifest: BackupManifest | null = null;
  let verification: SnapshotVerification | null = null;
  let reconciliation: RestoreReconciliationReport | null = null;
  let safetyCopyPath: string | null = null;
  let stagingPath: string | null = null;

  const finish = async (
    outcome: "restored" | "failed",
    failureStage: RestoreFailureStage | null,
    failureDetail: string | null,
  ): Promise<RestoreResult> => {
    const record: BackupRestoreRecord = {
      restoreId,
      // "" only when selection failed before any backup was known —
      // the failure detail says which case it was.
      backupId: backupId ?? "",
      operator: opts.operator,
      target: targetPath,
      startedAt,
      finishedAt: now().toISOString(),
      outcome,
      failureStage,
      failureDetail,
      verification: verification
        ? {
            countsChecked: verification.countsChecked,
            integrity: verification.integrity,
            foreignKeyViolations: verification.foreignKeyViolations,
          }
        : null,
      reconciliation: reconciliation
        ? {
            tier1Ok: reconciliation.tier1ManifestCounts.ok,
            tier2Ok: reconciliation.tier2StructuralIntegrity.ok,
            tier3Ok: reconciliation.tier3CriticalRecords.ok,
          }
        : null,
    };
    // Record the restore in the index (spec §8 step 7) — except when
    // the index itself was unreadable, where an append is impossible
    // by definition. Best-effort-but-reported: see the module header.
    let indexRecordWritten = false;
    if (failureStage !== "index") {
      try {
        await appendRestoreRecord(opts.store, record);
        indexRecordWritten = true;
      } catch {
        indexRecordWritten = false;
      }
    }
    if (stagingPath) removeIfExists(stagingPath);
    // Sweep any staging sidecars (a read-only open can leave -wal/-shm
    // next to the staging file; after a successful swap the staging
    // path itself is already gone, so sweep by the restore's prefix).
    try {
      const prefix = `.restore-staging-${restoreId}.db`;
      for (const name of fs.readdirSync(targetDir)) {
        if (name.startsWith(prefix)) removeIfExists(nodePath.join(targetDir, name));
      }
    } catch {
      // Best effort — a leftover staging sidecar is litter, not corruption.
    }
    if (outcome === "restored") {
      return {
        ok: true,
        record,
        reconciliation: reconciliation!,
        manifest: manifest!,
        safetyCopyPath,
        indexRecordWritten,
      };
    }
    return {
      ok: false,
      record,
      failureStage: failureStage!,
      failureDetail: failureDetail!,
      reconciliation,
      indexRecordWritten,
    };
  };

  // ── Stage: index — the off-volume index, from the store ALONE ────
  let index: BackupIndex;
  try {
    index = await readBackupIndex(opts.store);
  } catch (err) {
    return finish("failed", "index", errMsg(err));
  }

  // ── Stage: select — latest-good, or the specified backup ─────────
  let entry: BackupIndexEntry;
  try {
    if (opts.backupId) {
      const found = findIndexEntry(index, opts.backupId);
      if (!found) {
        throw new Error(`backup ${opts.backupId} is not in the backup index`);
      }
      // Only a PROMOTED entry is a backup (spec §5): anything else is
      // an attempt that never completed the lifecycle.
      if (found.state !== "promoted") {
        throw new Error(
          `backup ${opts.backupId} is in state "${found.state}", not "promoted" — only promoted backups are restorable`,
        );
      }
      entry = found;
      backupId = found.backupId;
      manifest = await fetchManifestForEntry(opts.store, entry);
    } else {
      const recovered = await recoverLatestGood(opts.store);
      if (!recovered) {
        throw new Error("the backup index names no latest-good — no backup has been promoted yet");
      }
      entry = recovered.entry;
      manifest = recovered.manifest;
      backupId = entry.backupId;
    }
  } catch (err) {
    return finish("failed", "select", errMsg(err));
  }

  // ── Stages: download + decrypt ────────────────────────────────────
  // The key check comes first and fails CLOSED: a missing/malformed
  // key means the restore stops here, before anything is staged.
  const key = opts.key !== undefined ? opts.key : loadBackupEncryptionKey();
  if (!key) {
    return finish(
      "failed",
      "decrypt",
      "BACKUP_ENCRYPTION_KEY is not set or does not decode to a 32-byte key — " +
        "refusing to proceed (fail-closed, plan §3). Re-supply the key from its " +
        "authoritative store (the Fly secret / the owner's offline copy) and retry.",
    );
  }
  if (!manifest.encryption) {
    return finish("failed", "select", "manifest has no encryption record — not an off-volume (B2) backup");
  }
  let plaintext: Buffer;
  try {
    const stored = await opts.store.getObject(entry.snapshotKey);
    if (stored === null) {
      throw new Error(`stored snapshot object missing: ${entry.snapshotKey}`);
    }
    // G0-AC-03: the retrieved ciphertext must re-hash to the manifest
    // before it is decrypted — a flipped byte dies here (download) or
    // at GCM authentication (decrypt), never as restored data.
    const actualCipherHash = sha256Buffer(stored);
    if (actualCipherHash !== manifest.encryption.ciphertextSha256) {
      throw new Error(
        `stored ciphertext SHA-256 mismatch: manifest ${manifest.encryption.ciphertextSha256}, stored ${actualCipherHash}`,
      );
    }
    plaintext = decryptBuffer(stored, key, manifest.encryption.nonce);
    const actualPlainHash = sha256Buffer(plaintext);
    if (actualPlainHash !== manifest.snapshotSha256) {
      throw new Error(
        `decrypted snapshot SHA-256 mismatch: manifest ${manifest.snapshotSha256}, decrypted ${actualPlainHash}`,
      );
    }
  } catch (err) {
    const detail = errMsg(err);
    const stage: RestoreFailureStage = /ciphertext SHA-256 mismatch|snapshot object missing/.test(detail)
      ? "download"
      : "decrypt";
    return finish("failed", stage, detail);
  }

  // ── Stage: stage the plaintext beside the target ─────────────────
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    stagingPath = nodePath.join(targetDir, `.restore-staging-${restoreId}.db`);
    fs.writeFileSync(stagingPath, plaintext);
    fsyncFile(stagingPath);
  } catch (err) {
    return finish("failed", "install", `could not stage the snapshot beside the target: ${errMsg(err)}`);
  }

  // ── Stage: verify — tiers 1+2 on the staged snapshot ─────────────
  verification = verifySnapshotFile(stagingPath, manifest, {
    enforceMustNonempty: opts.enforceMustNonempty ?? true,
  });
  if (!verification.ok) {
    return finish("failed", "verify", verification.failures.join("; "));
  }
  const tier2Failures = verification.failures.filter((f) =>
    /^(integrity_check|foreign_key_check)/.test(f),
  );
  const tier1Failures = verification.failures.filter((f) => !tier2Failures.includes(f));
  reconciliation = {
    tier1ManifestCounts: {
      ok: tier1Failures.length === 0,
      countsChecked: verification.countsChecked,
      failures: tier1Failures,
    },
    tier2StructuralIntegrity: {
      ok: verification.integrity === "ok" && verification.foreignKeyViolations === 0,
      integrity: verification.integrity,
      foreignKeyViolations: verification.foreignKeyViolations,
    },
    tier3CriticalRecords: {
      ok: false, // settled after the installed-side comparison below
      tables: [],
      ledgers: { ok: false, staged: null, installed: null },
    },
  };

  // ── Stage: reconcile (staged half of tier 3) ──────────────────────
  let stagedDigests: TableRecordDigest[];
  let stagedLedgers: LedgerSummary;
  try {
    const stagedDb = openSnapshotReadonly(stagingPath);
    try {
      stagedDigests = digestCriticalRecords(stagedDb);
      stagedLedgers = summarizeLedgers(stagedDb);
    } finally {
      stagedDb.close();
    }
  } catch (err) {
    return finish("failed", "reconcile", errMsg(err));
  }
  reconciliation.tier3CriticalRecords.tables = stagedDigests.map((d) => ({
    table: d.table,
    stagedRows: d.rowCount,
    installedRows: null,
    digestsEqual: false,
  }));
  reconciliation.tier3CriticalRecords.ledgers = { ok: false, staged: stagedLedgers, installed: null };

  // ── Stage: install — safety copy, atomic swap, post-install proof ─
  const targetExists = fs.existsSync(targetPath);
  const stamp = startedAt.replace(/[:.]/g, "-");
  safetyCopyPath = targetExists ? `${targetPath}.pre-restore-${stamp}` : null;
  try {
    if (targetExists) {
      // Spec §7: the pre-restore database is preserved before any
      // production restore — here, for every restore with a target.
      moveAside(targetPath, safetyCopyPath!);
      moveAside(`${targetPath}-wal`, `${safetyCopyPath}-wal`);
      moveAside(`${targetPath}-shm`, `${safetyCopyPath}-shm`);
    } else {
      removeIfExists(`${targetPath}-wal`);
      removeIfExists(`${targetPath}-shm`);
    }
    fs.renameSync(stagingPath, targetPath);
    stagingPath = null; // consumed by the swap
    fsyncFile(targetPath);
    fsyncDir(targetDir);

    // Post-install proof: the installed file IS the verified snapshot
    // (byte hash) and carries the same critical RECORDS (tier 3).
    const installedSha = sha256File(targetPath);
    if (installedSha !== manifest.snapshotSha256) {
      throw new Error(
        `installed database SHA-256 mismatch: manifest ${manifest.snapshotSha256}, installed ${installedSha}`,
      );
    }
    const installedDb = openSnapshotReadonly(targetPath);
    let installedDigests: TableRecordDigest[];
    let installedLedgers: LedgerSummary;
    try {
      installedDigests = digestCriticalRecords(installedDb);
      installedLedgers = summarizeLedgers(installedDb);
    } finally {
      installedDb.close();
    }
    const tables = stagedDigests.map((d, i) => {
      const inst = installedDigests[i]!;
      return {
        table: d.table,
        stagedRows: d.rowCount,
        installedRows: inst.rowCount,
        digestsEqual: inst.digest === d.digest && inst.rowCount === d.rowCount,
      };
    });
    const ledgersOk = ledgerSummariesEqual(stagedLedgers, installedLedgers);
    reconciliation.tier3CriticalRecords = {
      // Tier 3's verdict is FIDELITY (staged records == installed
      // records) plus a clean installed ledger: pre-existing event-
      // chain violations in the source data are reported in the
      // summary and make this false — they never block the swap,
      // because the restore's job is to reproduce the records, and
      // hiding a source-data problem would be worse than naming it.
      ok:
        tables.every((t) => t.digestsEqual) &&
        ledgersOk &&
        installedLedgers.eventChainViolations.length === 0,
      tables,
      ledgers: { ok: ledgersOk, staged: stagedLedgers, installed: installedLedgers },
    };
    if (!tables.every((t) => t.digestsEqual) || !ledgersOk) {
      throw new Error("post-install reconciliation diverged from the verified snapshot — rolling back");
    }
  } catch (err) {
    // Roll back: the target returns to exactly what it was.
    try {
      removeIfExists(targetPath);
      removeIfExists(`${targetPath}-wal`);
      removeIfExists(`${targetPath}-shm`);
      if (safetyCopyPath && fs.existsSync(safetyCopyPath)) {
        fs.renameSync(safetyCopyPath, targetPath);
        moveAside(`${safetyCopyPath}-wal`, `${targetPath}-wal`);
        moveAside(`${safetyCopyPath}-shm`, `${targetPath}-shm`);
      }
    } catch {
      // Best effort — the failure detail below is the record; the
      // safety copy path (when one existed) is in the result.
    }
    return finish("failed", "install", errMsg(err));
  }

  return finish("restored", null, null);
}

// ── Preflight (operator facts, store alone) ──────────────────────────

export interface RestorePreflight {
  latestGoodId: string | null;
  entry: {
    backupId: string;
    createdAt: string;
    tier: BackupTier;
    pinned: boolean;
    promotedAt: string | null;
  } | null;
  manifest: {
    backupId: string;
    createdAt: string;
    appCommit: string;
    schemaVersion: number;
    inventoryVersion: number;
    snapshotBytes: number;
    snapshotSha256: string;
    ciphertextSha256: string | null;
    tablesCounted: number;
  } | null;
  /** Presence/format of BACKUP_ENCRYPTION_KEY only — never the value. */
  keyStatus: "present" | "missing_or_malformed";
}

type BackupTier = BackupIndexEntry["tier"];

/**
 * The facts an operator needs before a restore, from the store ALONE
 * (G0-AC-05): which backup latest-good names, what its manifest
 * promises, and whether a usable encryption key is present in the
 * environment. Downloads nothing, decrypts nothing. Throws when the
 * index/manifest are corrupt — loudly, like recovery itself.
 */
export async function buildRestorePreflight(
  store: BackupObjectStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestorePreflight> {
  const recovered = await recoverLatestGood(store);
  return {
    latestGoodId: recovered?.entry.backupId ?? null,
    entry: recovered
      ? {
          backupId: recovered.entry.backupId,
          createdAt: recovered.entry.createdAt,
          tier: recovered.entry.tier,
          pinned: recovered.entry.pinned,
          promotedAt: recovered.entry.promotedAt,
        }
      : null,
    manifest: recovered
      ? {
          backupId: recovered.manifest.backupId,
          createdAt: recovered.manifest.createdAt,
          appCommit: recovered.manifest.appCommit,
          schemaVersion: recovered.manifest.schemaVersion,
          inventoryVersion: recovered.manifest.inventoryVersion,
          snapshotBytes: recovered.manifest.snapshotBytes,
          snapshotSha256: recovered.manifest.snapshotSha256,
          ciphertextSha256: recovered.manifest.encryption?.ciphertextSha256 ?? null,
          tablesCounted: Object.keys(recovered.manifest.tableCounts).length,
        }
      : null,
    keyStatus: loadBackupEncryptionKey(env) ? "present" : "missing_or_malformed",
  };
}
