/**
 * G0 backup — retention engine (increment B2; G0 spec §3/§12-B,
 * G0-AC-12).
 *
 * Policy (owner-decided): keep the newest 14 daily + 8 weekly backups;
 * golden backups are pinned and NEVER auto-deleted; the current
 * latest-good is never deleted, whatever window it falls in.
 *
 * The planner is a PURE function over the off-volume index — that is
 * the dry-run/list mode: `planRetention` names exactly which entries a
 * prune would remove, and `executeRetention` with `dryRun: true`
 * returns that plan having touched nothing. A real run marks each
 * planned entry `pruned` in the index (with its prune-log record)
 * BEFORE deleting its objects, so a crash mid-prune never leaves the
 * index advertising a deleted object as a good backup. Only PROMOTED
 * entries participate: failed attempts
 * are attempt records (spec §5), not backups, and are left alone.
 */
import type { DbHandle } from "../db/client.js";
import type { BackupObjectStore } from "./store.js";
import {
  writeBackupIndex,
  type BackupIndex,
  type BackupIndexEntry,
  type BackupPruneRecord,
} from "./index.js";

export interface RetentionPolicy {
  dailyKeep: number;
  weeklyKeep: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = { dailyKeep: 14, weeklyKeep: 8 };

export interface RetentionPlan {
  keep: BackupIndexEntry[];
  prune: BackupIndexEntry[];
}

/** Newest first; backupId breaks createdAt ties so plans are deterministic. */
function newestFirst(entries: BackupIndexEntry[]): BackupIndexEntry[] {
  return [...entries].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.backupId.localeCompare(a.backupId),
  );
}

export function planRetention(
  index: BackupIndex,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): RetentionPlan {
  const keep: BackupIndexEntry[] = [];
  const prune: BackupIndexEntry[] = [];
  const promoted = index.entries.filter((e) => e.state === "promoted");
  const byTier = (tier: BackupIndexEntry["tier"]) => newestFirst(promoted.filter((e) => e.tier === tier));

  const windowed = (entries: BackupIndexEntry[], window: number): void => {
    entries.forEach((entry, i) => {
      // Hard protections outrank every window (spec §3, G0-AC-12):
      // pinned (golden) entries and the current latest-good never prune.
      if (entry.pinned || entry.backupId === index.latestGoodId || i < window) {
        keep.push(entry);
      } else {
        prune.push(entry);
      }
    });
  };

  windowed(byTier("daily"), policy.dailyKeep);
  windowed(byTier("weekly"), policy.weeklyKeep);
  // Goldens are pinned by construction; keep them out of the prune set
  // even if a malformed entry arrived unpinned.
  keep.push(...byTier("golden"));

  // Non-promoted entries (failed attempts, pruned history) are not
  // retention's business — neither kept-window members nor prunable.
  return { keep, prune };
}

export interface ExecuteRetentionOptions {
  policy?: RetentionPolicy;
  /** When true: compute and return the plan, change NOTHING. */
  dryRun?: boolean;
  /** ISO-Z timestamp recorded for the prune; defaults to now. */
  now?: string;
  /** When given, pruned backups' local attempt rows are marked 'pruned' too. */
  handle?: DbHandle;
}

export interface ExecuteRetentionResult {
  /** The index after the run (unchanged on dry-run). */
  index: BackupIndex;
  /** Entries the plan removes (on dry-run: WOULD remove). */
  planned: BackupIndexEntry[];
  /** Records actually appended to the prune log (empty on dry-run). */
  pruned: BackupPruneRecord[];
}

export async function executeRetention(
  store: BackupObjectStore,
  index: BackupIndex,
  opts: ExecuteRetentionOptions = {},
): Promise<ExecuteRetentionResult> {
  const policy = opts.policy ?? DEFAULT_RETENTION_POLICY;
  const plan = planRetention(index, policy);
  if (opts.dryRun || plan.prune.length === 0) {
    return { index, planned: plan.prune, pruned: [] };
  }
  const now = opts.now ?? new Date().toISOString();
  const windowFor = (tier: BackupIndexEntry["tier"]): number =>
    tier === "weekly" ? policy.weeklyKeep : policy.dailyKeep;
  const pruned: BackupPruneRecord[] = [];
  let next: BackupIndex = index;
  for (const entry of plan.prune) {
    const reason =
      `retention: beyond the ${windowFor(entry.tier)}-${entry.tier} keep window`;
    const record: BackupPruneRecord = { backupId: entry.backupId, prunedAt: now, reason };
    // Mark + record in the index BEFORE deleting any object, per entry
    // (review P2): if the process dies mid-prune, the index can never
    // advertise an already-deleted object as a good backup — the worst
    // case is an orphaned object the index no longer references, which
    // costs storage and nothing else.
    next = {
      ...next,
      entries: next.entries.map((e) =>
        e.backupId === entry.backupId ? { ...e, state: "pruned" as const, prunedAt: now } : e,
      ),
      pruneLog: [...next.pruneLog, record],
    };
    await writeBackupIndex(store, next);
    pruned.push(record);
    await store.deleteObject(entry.snapshotKey);
    await store.deleteObject(entry.manifestKey);
    if (opts.handle) {
      opts.handle.sqlite
        .prepare(`UPDATE backup_attempts SET state = 'pruned' WHERE id = ?`)
        .run(entry.backupId);
    }
  }
  return { index: next, planned: plan.prune, pruned };
}
