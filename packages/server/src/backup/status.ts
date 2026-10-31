/**
 * G0 backup — status report (increment B3; spec §7, G0-AC-11).
 *
 * Builds the one JSON document the status endpoint serves and the
 * in-app panel renders. Spec §7's rule is structural here, not
 * presentational: `latestAttempt` and `latestGood` are SEPARATE
 * fields, built from different rows — the newest attempt of any
 * outcome, and the newest PROMOTED backup — so a failed attempt can
 * never masquerade as a good backup, and a good backup stays visible
 * behind a newer failure.
 *
 * Every timestamp is an ISO instant; the panel renders them in the
 * VIEWER's local timezone (the standing owner rule: no UTC in
 * anything user-facing). Age is a duration in milliseconds — it has
 * no timezone. `latestGoodStale` is the plan §1 signal: age over 24h
 * (or no latest-good at all) must be prominent, never silent.
 *
 * The off-volume index read on this path is DEFENSIVE (B2 residual
 * ride-along): a corrupt or unreadable index is reported as
 * `index.status` — "corrupt" / "unreadable" with the error's message —
 * and never throws out of this builder, so the panel and the
 * scheduler keep working and the owner sees the loud, specific state.
 * B2's own recovery semantics are untouched: recovery still refuses a
 * corrupt index; only this READ-ONLY status read downgrades it to a
 * reported state.
 */
import type { DbHandle } from "../db/client.js";
import {
  listBackupAttempts,
  type BackupAttemptRow,
  type BackupFailureStage,
  type BackupOffVolumeOutcome,
  type BackupTrigger,
} from "./service.js";
import { loadS3StoreConfig, S3BackupStore, type BackupObjectStore } from "./store.js";
import { readBackupIndex } from "./index.js";
import {
  BACKUP_TIMEZONE,
  STALE_AFTER_MS,
  decideBackupRun,
  nextScheduledRun,
  type BackupRunFacts,
} from "./schedule.js";

export interface BackupAttemptSummary {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  trigger: BackupTrigger;
  tier: string | null;
  pinned: boolean;
  state: BackupAttemptRow["state"];
  failureStage: BackupFailureStage | null;
  failureDetail: string | null;
  offVolumeOutcome: BackupOffVolumeOutcome | null;
  snapshotBytes: number | null;
}

export interface BackupGoodSummary {
  id: string;
  createdAt: string;
  /** When this backup became latest-good. */
  promotedAt: string | null;
  tier: string | null;
  snapshotBytes: number | null;
}

export interface BackupIndexSummary {
  /**
   * 'ok' — read and valid. 'not_configured' — no off-volume store is
   * configured, so there is no index to read. 'corrupt' — the stored
   * index failed validation (B2's loud refusal, reported not thrown).
   * 'unreadable' — the store itself could not be read (network/auth).
   */
  status: "ok" | "not_configured" | "corrupt" | "unreadable";
  detail: string | null;
  entryCount: number;
  promotedCount: number;
  prunedCount: number;
  latestGoodId: string | null;
}

export interface BackupStatusReport {
  generatedAt: string;
  schedule: {
    timezone: string;
    /** Local wall-clock time of the daily run, "03:30". */
    dailyTime: string;
    nextRunAt: string;
    /** A missed slot / stale latest-good makes a catch-up due right now. */
    catchUpDue: boolean;
  };
  offVolume: {
    configured: boolean;
    index: BackupIndexSummary;
  };
  latestAttempt: BackupAttemptSummary | null;
  latestGood: BackupGoodSummary | null;
  /** Age of latest-good in ms; null when no backup has ever been promoted. */
  latestGoodAgeMs: number | null;
  /** True when latest-good is older than 24h — or none exists. The prominent signal. */
  latestGoodStale: boolean;
  /**
   * The latest-good the OFF-VOLUME INDEX names (null when the index
   * is not readable/configured or names none). Recovery is
   * store-only (G0-AC-05), so THIS is the backup a restore would
   * actually use.
   */
  latestGoodIndexId: string | null;
  /**
   * True when the index and the local record name DIFFERENT
   * latest-goods — the crash window in B2's promotion sequence (the
   * index write landed, the local row update did not). Surfaced, never
   * silently resolved either way (review P2-6).
   */
  latestGoodDiverged: boolean;
  /** Newest attempt that passed local verification (any later state), or null. */
  latestLocalVerified: {
    id: string;
    createdAt: string;
    tier: string | null;
    snapshotBytes: number | null;
  } | null;
}

function summarizeAttempt(a: BackupAttemptRow): BackupAttemptSummary {
  return {
    id: a.id,
    createdAt: a.createdAt,
    finishedAt: a.finishedAt,
    trigger: a.trigger,
    tier: a.tier,
    pinned: a.pinned,
    state: a.state,
    failureStage: a.failureStage,
    failureDetail: a.failureDetail,
    offVolumeOutcome: a.offvolumeOutcome,
    snapshotBytes: a.snapshotBytes,
  };
}

const LOCAL_VERIFIED_STATES = new Set(["verified_local", "uploaded", "verified_stored", "promoted"]);

export interface BackupStatusDeps {
  /** Environment the store config is read from. Default process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Store override (tests). Undefined ⇒ built from the environment;
   * explicit null ⇒ no store (not configured).
   */
  store?: BackupObjectStore | null;
  /** Evaluation instant. Default: now. */
  now?: Date;
}

export async function buildBackupStatus(
  handle: DbHandle,
  deps: BackupStatusDeps = {},
): Promise<BackupStatusReport> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env;
  const attempts = listBackupAttempts(handle);

  const latestAttemptRow = attempts.length > 0 ? attempts[attempts.length - 1]! : null;

  const promotedRows = attempts.filter((a) => a.state === "promoted");
  const latestGoodRow =
    promotedRows.length > 0
      ? promotedRows.reduce((best, a) =>
          (a.promotedAt ?? a.createdAt) > (best.promotedAt ?? best.createdAt) ? a : best,
        )
      : null;
  const latestGoodMs = latestGoodRow
    ? Date.parse(latestGoodRow.promotedAt ?? latestGoodRow.createdAt)
    : null;
  const latestGoodAgeMs = latestGoodMs === null ? null : Math.max(0, now.getTime() - latestGoodMs);

  const localVerifiedRows = attempts.filter((a) => LOCAL_VERIFIED_STATES.has(a.state));
  const latestLocalVerifiedRow =
    localVerifiedRows.length > 0 ? localVerifiedRows[localVerifiedRows.length - 1]! : null;

  // Schedule facts + catch-up signal (same decision the scheduler
  // runs; the newest instant comes from the rows already loaded).
  const facts: BackupRunFacts = {
    latestAttemptMs: latestAttemptRow ? Date.parse(latestAttemptRow.createdAt) : null,
  };
  const decision = decideBackupRun(now, facts);

  // Off-volume index — defensive read (see module header).
  let store: BackupObjectStore | null;
  if (deps.store !== undefined) {
    store = deps.store;
  } else {
    const config = loadS3StoreConfig(env);
    store = config ? new S3BackupStore(config) : null;
  }
  let index: BackupIndexSummary;
  if (store === null) {
    index = {
      status: "not_configured",
      detail: null,
      entryCount: 0,
      promotedCount: 0,
      prunedCount: 0,
      latestGoodId: null,
    };
  } else {
    try {
      const idx = await readBackupIndex(store);
      index = {
        status: "ok",
        detail: null,
        entryCount: idx.entries.length,
        promotedCount: idx.entries.filter((e) => e.state === "promoted").length,
        prunedCount: idx.pruneLog.length,
        latestGoodId: idx.latestGoodId,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      index = {
        status: detail.toLowerCase().includes("corrupt") ? "corrupt" : "unreadable",
        detail,
        entryCount: 0,
        promotedCount: 0,
        prunedCount: 0,
        latestGoodId: null,
      };
    }
  }

  const latestGoodIndexId = index.status === "ok" ? index.latestGoodId : null;
  const latestGoodDiverged =
    latestGoodIndexId !== null && latestGoodIndexId !== (latestGoodRow?.id ?? null);

  return {
    generatedAt: now.toISOString(),
    schedule: {
      timezone: BACKUP_TIMEZONE,
      dailyTime: "03:30",
      nextRunAt: nextScheduledRun(now).toISOString(),
      catchUpDue: decision.run && decision.trigger === "catch_up",
    },
    offVolume: { configured: store !== null, index },
    latestAttempt: latestAttemptRow ? summarizeAttempt(latestAttemptRow) : null,
    latestGood: latestGoodRow
      ? {
          id: latestGoodRow.id,
          createdAt: latestGoodRow.createdAt,
          promotedAt: latestGoodRow.promotedAt,
          tier: latestGoodRow.tier,
          snapshotBytes: latestGoodRow.snapshotBytes,
        }
      : null,
    latestGoodAgeMs,
    latestGoodStale: latestGoodAgeMs === null || latestGoodAgeMs > STALE_AFTER_MS,
    latestGoodIndexId,
    latestGoodDiverged,
    latestLocalVerified: latestLocalVerifiedRow
      ? {
          id: latestLocalVerifiedRow.id,
          createdAt: latestLocalVerifiedRow.createdAt,
          tier: latestLocalVerifiedRow.tier,
          snapshotBytes: latestLocalVerifiedRow.snapshotBytes,
        }
      : null,
  };
}
