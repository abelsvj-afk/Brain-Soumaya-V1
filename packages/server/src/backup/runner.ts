/**
 * G0 backup — the one pipeline every trigger runs (increment B3).
 *
 * Schedule, catch-up, manual, and golden attempts all funnel through
 * `runBackupPipeline`, so there is exactly one code path that can
 * produce a backup:
 *
 *   B1 leg (snapshot → manifest → verify-local) — always runs.
 *   B2 leg (encrypt → upload → verify-stored → promote) — runs only
 *   when an off-volume store is configured (BACKUP_R2_* set). When no
 *   store is configured the attempt ends as a verified LOCAL backup
 *   with offvolume_outcome = 'not_configured' recorded on its row: a
 *   distinct recorded outcome — not a failure (the attempt did
 *   everything it was configured to do) and not a promotion (no copy
 *   left the machine). When a store IS configured, the B2 leg's own
 *   fail-closed rules apply (e.g. a missing encryption key fails the
 *   attempt at the encrypt stage, recorded with its stage) — a
 *   half-configured deployment fails loudly, never silently downgrades
 *   to local-only. No plaintext ever leaves the machine on any path:
 *   the local-only path uploads nothing at all.
 *
 * After a promotion, retention runs (B2's engine). A retention error
 * never fails the backup — the backup is already promoted and intact;
 * the error is returned for status/logging instead.
 */
import * as nodePath from "node:path";
import type { DbHandle } from "../db/client.js";
import {
  recordOffVolumeOutcome,
  runBackupAttempt,
  type BackupAttemptRow,
  type BackupFailureStage,
  type BackupTrigger,
} from "./service.js";
import { runOffVolumeBackup } from "./offvolume.js";
import { loadS3StoreConfig, S3BackupStore, type BackupObjectStore } from "./store.js";
import { executeRetention } from "./retention.js";
import type { BackupTier } from "./index.js";

/** Where local snapshot files live: BACKUP_DIR, else a `backups/` dir beside the database file. */
export function resolveBackupDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BACKUP_DIR?.trim();
  if (configured) return configured;
  const dbPath = nodePath.resolve(env.DB_PATH ?? "./brain.db");
  return nodePath.join(nodePath.dirname(dbPath), "backups");
}

/** Whether an off-volume store is configured in this environment (all BACKUP_R2_* present). */
export function offVolumeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadS3StoreConfig(env) !== null;
}

export interface BackupPipelineOptions {
  /** Directory the local snapshot is written into. */
  dir: string;
  /** How this attempt was started — recorded on the attempt row. */
  trigger: BackupTrigger;
  /**
   * Retention tier. Default: 'golden' for the golden trigger, else
   * 'daily'. The scheduler passes its slot tier ('daily' | 'weekly').
   */
  tier?: BackupTier;
  appCommit?: string;
  /**
   * MUST-BE-NONEMPTY guard enforcement for the B1 leg. Defaults to
   * TRUE since inventory v5 (2026-10-30): the B0 amendment-B preflight
   * open item is RESOLVED — the three legitimately-empty MUST tables
   * (episodes_fts, vec_episodes, fin_expense) were reclassified
   * MAY-BE-EMPTY with their causes recorded in backup/inventory.ts,
   * and the remaining 26 MUST tables are all confirmed nonempty in
   * production. A snapshot with any MUST table empty now FAILS the
   * attempt at the verify stage, naming the table(s). Callers may
   * still pass false explicitly (partial-brain fixtures in tests do);
   * production entry points (scheduler, backup routes) pass nothing
   * and get enforcement.
   */
  enforceMustNonempty?: boolean;
  /** Environment the store config is read from. Default process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Store override (tests). Undefined ⇒ built from the environment;
   * explicit null ⇒ force the local-only path.
   */
  store?: BackupObjectStore | null;
  /** Retention override (tests). */
  retentionFn?: typeof executeRetention;
}

export interface BackupPipelineResult {
  attempt: BackupAttemptRow;
  trigger: BackupTrigger;
  tier: BackupTier;
  /**
   * 'promoted' — the full B2 chain completed and this attempt became
   * latest-good. 'not_configured' — local stages completed; no
   * off-volume store is configured (recorded on the row). 'failed' —
   * the attempt failed at `failureStage` (recorded on the row).
   */
  offVolume: "promoted" | "not_configured" | "failed";
  failureStage: BackupFailureStage | null;
  failureDetail: string | null;
  /** Set when retention ran after a promotion. */
  retention: { prunedCount: number } | null;
  /** A retention failure after a successful promotion — the backup itself is intact. */
  retentionError: string | null;
}

/**
 * Thrown (the pipeline's ONLY throw) when a run is already in flight
 * in this process. Backup runs share one directory, one attempt
 * table, and one off-volume index; two interleaved runs could race
 * snapshot writes and index updates. Every entry point — scheduler,
 * POST /run, the future B5 hook — goes through this one lock, so the
 * refusal is uniform: the route answers 409, the scheduler logs and
 * skips the tick. Operational backup failures are NOT throws — they
 * are recorded outcomes on the attempt row (see BackupPipelineResult).
 */
export class BackupRunBusyError extends Error {
  constructor() {
    super("a backup run is already in progress");
    this.name = "BackupRunBusyError";
  }
}

let pipelineInFlight = false;

export async function runBackupPipeline(
  handle: DbHandle,
  opts: BackupPipelineOptions,
): Promise<BackupPipelineResult> {
  if (pipelineInFlight) throw new BackupRunBusyError();
  pipelineInFlight = true;
  try {
    return await runBackupPipelineUnlocked(handle, opts);
  } finally {
    pipelineInFlight = false;
  }
}

async function runBackupPipelineUnlocked(
  handle: DbHandle,
  opts: BackupPipelineOptions,
): Promise<BackupPipelineResult> {
  const tier: BackupTier = opts.trigger === "golden" ? "golden" : (opts.tier ?? "daily");
  const pinned = tier === "golden";
  const env = opts.env ?? process.env;
  const enforceMustNonempty = opts.enforceMustNonempty ?? true;

  let store: BackupObjectStore | null;
  if (opts.store !== undefined) {
    store = opts.store;
  } else {
    const config = loadS3StoreConfig(env);
    store = config ? new S3BackupStore(config) : null;
  }

  if (store === null) {
    // Local-only: B1 leg, then record WHY the attempt stops there.
    const local = runBackupAttempt(handle, {
      dir: opts.dir,
      appCommit: opts.appCommit,
      enforceMustNonempty,
      trigger: opts.trigger,
      tier,
      pinned,
    });
    if (!local.ok) {
      return {
        attempt: local.attempt,
        trigger: opts.trigger,
        tier,
        offVolume: "failed",
        failureStage: local.failureStage,
        failureDetail: local.failureDetail,
        retention: null,
        retentionError: null,
      };
    }
    const attempt = recordOffVolumeOutcome(handle, local.attempt.id, "not_configured");
    return {
      attempt,
      trigger: opts.trigger,
      tier,
      offVolume: "not_configured",
      failureStage: null,
      failureDetail: null,
      retention: null,
      retentionError: null,
    };
  }

  const result = await runOffVolumeBackup(handle, {
    dir: opts.dir,
    store,
    tier,
    pinned,
    trigger: opts.trigger,
    appCommit: opts.appCommit,
    enforceMustNonempty,
    // The key is read from the environment inside the B2 leg, whose
    // fail-closed rule applies: configured store + missing key fails
    // the attempt at 'encrypt', recorded — never a plaintext upload.
  });
  if (!result.ok) {
    return {
      attempt: result.attempt,
      trigger: opts.trigger,
      tier,
      offVolume: "failed",
      failureStage: result.failureStage,
      failureDetail: result.failureDetail,
      retention: null,
      retentionError: null,
    };
  }

  // Retention after promotion (B2 engine). Never fails the backup.
  let retention: { prunedCount: number } | null = null;
  let retentionError: string | null = null;
  try {
    const ran = await (opts.retentionFn ?? executeRetention)(store, result.index, { handle });
    retention = { prunedCount: ran.pruned.length };
  } catch (err) {
    retentionError = err instanceof Error ? err.message : String(err);
  }

  return {
    attempt: result.attempt,
    trigger: opts.trigger,
    tier,
    offVolume: "promoted",
    failureStage: null,
    failureDetail: null,
    retention,
    retentionError,
  };
}
