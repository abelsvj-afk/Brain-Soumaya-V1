/**
 * G0 backup — lifecycle service. Increment B1 built CREATED →
 * VERIFIED-LOCAL; increment B2 continues the same rows through
 * UPLOADED → VERIFIED-STORED → PROMOTED in `offvolume.ts` (G0 spec §5).
 *
 * One attempt = one row in `backup_attempts`. A failed attempt is
 * recorded with its failure stage (`snapshot` | `manifest` | `verify`
 * in B1; `encrypt` | `upload` | `verify_stored` | `promote` added by
 * B2) and is NEVER listed as a backup: `listVerifiedBackups` returns
 * only rows that reached VERIFIED-LOCAL (states are plain TEXT by
 * design, so the B2 states needed no migration — only the three
 * bookkeeping columns tier/pinned/promoted_at were added, in BOTH
 * schema locations). Increment B3 adds two more bookkeeping columns
 * the same way: `trigger` (how the attempt was started) and
 * `offvolume_outcome` (why the pipeline stopped after local
 * verification, when it did), and writes trigger/tier/pinned at
 * creation when the caller supplies them.
 *
 * Snapshots are taken with VACUUM INTO (spec §1 / G0-AC-01): a
 * consistent, standalone database file — never a raw copy of a live WAL
 * database. The manifest is built FROM the snapshot artifact, so what
 * the manifest describes is exactly what would be restored.
 */
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { DbHandle } from "../db/client.js";
import type { RawDb } from "../db/vec.js";
import {
  classifyLiveObjects,
  countIncludedTables,
  newManifest,
  verifySnapshotFile,
  type BackupManifest,
} from "./manifest.js";

export type BackupAttemptState =
  | "created"
  | "verified_local"
  | "uploaded"
  | "verified_stored"
  | "promoted"
  | "pruned"
  | "failed";
/**
 * How an attempt was started (increment B3). Every trigger — the daily
 * schedule, a missed-run catch-up, the manual "back up now", a manual
 * golden — runs the SAME pipeline (runner.ts); the trigger is recorded
 * on the row at creation so status can say what started an attempt.
 */
export type BackupTrigger = "schedule" | "catch_up" | "manual" | "golden";
/**
 * Recorded outcome of the off-volume leg when it deliberately did not
 * run (increment B3): the local stages completed and the attempt is a
 * verified LOCAL backup, but no off-volume store is configured, so
 * nothing was encrypted, uploaded, or promoted. Distinct from both a
 * failure (state stays 'verified_local', failure fields stay null) and
 * a promotion (state 'promoted').
 */
export type BackupOffVolumeOutcome = "not_configured";
export type BackupFailureStage =
  | "snapshot"
  | "manifest"
  | "verify"
  | "encrypt"
  | "upload"
  | "verify_stored"
  | "promote";

export interface BackupAttemptRow {
  id: string;
  createdAt: string;
  state: BackupAttemptState;
  failureStage: BackupFailureStage | null;
  failureDetail: string | null;
  snapshotPath: string | null;
  snapshotSha256: string | null;
  snapshotBytes: number | null;
  manifest: BackupManifest | null;
  finishedAt: string | null;
  /** Retention tier recorded by the off-volume run (B2); 'daily' by column default, B1-era rows included. */
  tier: string | null;
  /** Golden pin: a pinned backup is never auto-deleted (B2). */
  pinned: boolean;
  /** When this attempt became latest-good (B2); null until PROMOTED. */
  promotedAt: string | null;
  /** How this attempt was started (B3); rows from before B3 read 'manual' (the column default). */
  trigger: BackupTrigger;
  /** B3: 'not_configured' when the pipeline stopped after local verification (see the type). */
  offvolumeOutcome: BackupOffVolumeOutcome | null;
}

interface AttemptDbRow {
  id: string;
  created_at: string;
  state: string;
  failure_stage: string | null;
  failure_detail: string | null;
  snapshot_path: string | null;
  snapshot_sha256: string | null;
  snapshot_bytes: number | null;
  manifest_json: string | null;
  finished_at: string | null;
  tier: string | null;
  pinned: number;
  promoted_at: string | null;
  trigger: string;
  offvolume_outcome: string | null;
}

function mapRow(r: AttemptDbRow): BackupAttemptRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    state: r.state as BackupAttemptState,
    failureStage: (r.failure_stage as BackupFailureStage | null) ?? null,
    failureDetail: r.failure_detail,
    snapshotPath: r.snapshot_path,
    snapshotSha256: r.snapshot_sha256,
    snapshotBytes: r.snapshot_bytes,
    manifest: r.manifest_json ? (JSON.parse(r.manifest_json) as BackupManifest) : null,
    finishedAt: r.finished_at,
    tier: r.tier,
    pinned: r.pinned === 1,
    promotedAt: r.promoted_at,
    trigger: (r.trigger as BackupTrigger) ?? "manual",
    offvolumeOutcome: (r.offvolume_outcome as BackupOffVolumeOutcome | null) ?? null,
  };
}

export function listBackupAttempts(handle: DbHandle): BackupAttemptRow[] {
  const rows = handle.sqlite
    .prepare(`SELECT * FROM backup_attempts ORDER BY created_at ASC, rowid ASC`)
    .all() as AttemptDbRow[];
  return rows.map(mapRow);
}

/**
 * The newest attempt's creation instant (epoch ms), or null when no
 * attempt exists — one MAX query over an indexed-order column, for
 * hot paths (the scheduler's per-minute evaluation) that must not
 * re-read and re-parse the whole attempt history (review P2-5).
 * created_at values are ISO-Z strings, which sort chronologically.
 */
export function latestBackupAttemptCreatedMs(handle: DbHandle): number | null {
  const row = handle.sqlite
    .prepare(`SELECT MAX(created_at) AS newest FROM backup_attempts`)
    .get() as { newest: string | null };
  return row.newest === null ? null : Date.parse(row.newest);
}

/** Backups = attempts that passed local verification. Failures never appear here. */
export function listVerifiedBackups(handle: DbHandle): BackupAttemptRow[] {
  return listBackupAttempts(handle).filter((a) => a.state === "verified_local");
}

/**
 * Record the off-volume outcome on an attempt (increment B3) and
 * return the refreshed row. Used by the pipeline when no off-volume
 * store is configured: the attempt remains a verified local backup —
 * this marks WHY it stopped there, so status never has to guess from
 * the current configuration (which may change later).
 */
export function recordOffVolumeOutcome(
  handle: DbHandle,
  attemptId: string,
  outcome: BackupOffVolumeOutcome,
): BackupAttemptRow {
  handle.sqlite
    .prepare(`UPDATE backup_attempts SET offvolume_outcome = ? WHERE id = ?`)
    .run(outcome, attemptId);
  const row = handle.sqlite
    .prepare(`SELECT * FROM backup_attempts WHERE id = ?`)
    .get(attemptId) as AttemptDbRow | undefined;
  if (!row) throw new Error(`backup attempt row vanished: ${attemptId}`);
  return mapRow(row);
}

export interface RunBackupOptions {
  /** Directory the snapshot file is written into (created if missing). */
  dir: string;
  /** App version / git commit recorded in the manifest. */
  appCommit?: string;
  /** MUST-BE-NONEMPTY guard enforcement (see manifest.ts VerifyOptions). */
  enforceMustNonempty?: boolean;
  /** How this attempt was started (B3); recorded at creation. Default 'manual'. */
  trigger?: BackupTrigger;
  /**
   * Retention tier written at creation (B3). B2's off-volume run also
   * passes its tier/pinned here so a golden is pinned from the row's
   * first moment, not only when the off-volume bookkeeping lands.
   * Default: the column defaults ('daily', unpinned).
   */
  tier?: string;
  pinned?: boolean;
}

export type RunBackupResult =
  | { ok: true; attempt: BackupAttemptRow; manifest: BackupManifest }
  | { ok: false; attempt: BackupAttemptRow; failureStage: BackupFailureStage; failureDetail: string };

function openSnapshotRaw(path: string): RawDb {
  const sqlite = new BetterSqlite3(path, { readonly: true });
  try {
    sqliteVec.load(sqlite);
  } catch {
    // Counts for vec_* tables will fail and be reported, not hidden.
  }
  return sqlite as RawDb;
}

/**
 * Run one backup attempt end to end (B1 scope). Never throws for an
 * operational failure — the failure is recorded on the attempt row and
 * returned. (Programming errors before the attempt row exists, e.g. a
 * missing backup_attempts table, still throw.)
 */
export function runBackupAttempt(handle: DbHandle, opts: RunBackupOptions): RunBackupResult {
  const sqlite = handle.sqlite;
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO backup_attempts (id, created_at, state, trigger, tier, pinned)
       VALUES (?, ?, 'created', ?, ?, ?)`,
    )
    .run(id, createdAt, opts.trigger ?? "manual", opts.tier ?? "daily", opts.pinned ? 1 : 0);

  const fail = (stage: BackupFailureStage, detail: string): RunBackupResult => {
    const finishedAt = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE backup_attempts SET state = 'failed', failure_stage = ?, failure_detail = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(stage, detail, finishedAt, id);
    const row = sqlite.prepare(`SELECT * FROM backup_attempts WHERE id = ?`).get(id) as AttemptDbRow;
    return { ok: false, attempt: mapRow(row), failureStage: stage, failureDetail: detail };
  };

  // Stage: manifest (assertion) — the live object list must classify
  // cleanly under the bucketed comparison before anything is snapshotted.
  const classification = classifyLiveObjects(sqlite);
  if (classification.unrecognized.length > 0) {
    return fail(
      "manifest",
      `unrecognized application-owned object(s) in live database: ${classification.unrecognized.join(", ")}`,
    );
  }

  // Stage: snapshot — VACUUM INTO a fresh file (the target must not exist).
  // mkdir lives inside the try (review P2-1): an unusable dir is an
  // operational failure of this stage and must be recorded on the attempt,
  // never thrown past the caller leaving the attempt stuck in 'created'.
  const snapshotPath = nodePath.join(opts.dir, `brain-backup-${id}.db`);
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
    sqlite.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
  } catch (err) {
    return fail("snapshot", err instanceof Error ? err.message : String(err));
  }

  // Stage: manifest — describe the artifact itself (counts read from the
  // snapshot, not the live database).
  let manifest: BackupManifest;
  try {
    const snap = openSnapshotRaw(snapshotPath);
    try {
      const counts = countIncludedTables(snap);
      const schemaVersion = snap.pragma("user_version", { simple: true }) as number;
      manifest = newManifest({
        backupId: id,
        createdAt,
        appCommit: opts.appCommit ?? process.env.GIT_COMMIT ?? "unknown",
        schemaVersion,
        snapshotPath,
        tableCounts: counts,
      });
    } finally {
      snap.close();
    }
  } catch (err) {
    return fail("manifest", err instanceof Error ? err.message : String(err));
  }
  try {
    sqlite
      .prepare(
        `UPDATE backup_attempts SET snapshot_path = ?, snapshot_sha256 = ?, snapshot_bytes = ?, manifest_json = ?
         WHERE id = ?`,
      )
      .run(snapshotPath, manifest.snapshotSha256, manifest.snapshotBytes, JSON.stringify(manifest), id);
  } catch (err) {
    return fail("manifest", err instanceof Error ? err.message : String(err));
  }

  // Stage: verify — integrity, foreign keys, count reconciliation, and
  // the wiped-DB MUST guard against the manifest (spec §4).
  let verification;
  try {
    verification = verifySnapshotFile(snapshotPath, manifest, {
      enforceMustNonempty: opts.enforceMustNonempty,
    });
  } catch (err) {
    return fail("verify", err instanceof Error ? err.message : String(err));
  }
  if (!verification.ok) {
    return fail("verify", verification.failures.join("; "));
  }

  const finishedAt = new Date().toISOString();
  sqlite
    .prepare(`UPDATE backup_attempts SET state = 'verified_local', finished_at = ? WHERE id = ?`)
    .run(finishedAt, id);
  const row = sqlite.prepare(`SELECT * FROM backup_attempts WHERE id = ?`).get(id) as AttemptDbRow;
  return { ok: true, attempt: mapRow(row), manifest };
}
