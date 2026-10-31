import { API, afetch } from "./http.js";

/**
 * G0 backup status + triggers (increment B3) — client for
 * /api/backup, which the server shows to the owner's brain only.
 * Every timestamp in the report is an ISO instant; the panel renders
 * them in the viewer's local timezone. A null from getBackupStatus
 * means "not the owner (or unreachable)" — the panel simply isn't
 * there, the same convention as the Voices console.
 */

export interface BackupAttemptSummary {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  trigger: "schedule" | "catch_up" | "manual" | "golden" | "pre_deploy";
  tier: string | null;
  pinned: boolean;
  state: "created" | "verified_local" | "uploaded" | "verified_stored" | "promoted" | "pruned" | "failed";
  failureStage: string | null;
  failureDetail: string | null;
  offVolumeOutcome: "not_configured" | null;
  snapshotBytes: number | null;
}

export interface BackupStatus {
  generatedAt: string;
  schedule: {
    timezone: string;
    dailyTime: string;
    nextRunAt: string;
    catchUpDue: boolean;
  };
  offVolume: {
    configured: boolean;
    index: {
      status: "ok" | "not_configured" | "corrupt" | "unreadable";
      detail: string | null;
      entryCount: number;
      promotedCount: number;
      prunedCount: number;
      latestGoodId: string | null;
    };
  };
  latestAttempt: BackupAttemptSummary | null;
  latestGood: {
    id: string;
    createdAt: string;
    promotedAt: string | null;
    tier: string | null;
    snapshotBytes: number | null;
  } | null;
  latestGoodAgeMs: number | null;
  latestGoodStale: boolean;
  /** The latest-good the off-volume index names — what a restore would use. */
  latestGoodIndexId: string | null;
  /** True when the index and the local record name different latest-goods. */
  latestGoodDiverged: boolean;
  latestLocalVerified: {
    id: string;
    createdAt: string;
    tier: string | null;
    snapshotBytes: number | null;
  } | null;
}

export interface BackupRunResult {
  ok: boolean;
  offVolume: "promoted" | "not_configured" | "failed";
  failureStage: string | null;
  failureDetail: string | null;
  attempt: {
    id: string;
    createdAt: string;
    trigger: string;
    tier: string | null;
    pinned: boolean;
    state: string;
    offVolumeOutcome: "not_configured" | null;
    snapshotBytes: number | null;
  };
}

const json = { "Content-Type": "application/json" };

export async function getBackupStatus(): Promise<BackupStatus | null> {
  try {
    const res = await afetch(`${API}/backup/status`);
    if (!res.ok) return null;
    return (await res.json()) as BackupStatus;
  } catch {
    return null;
  }
}

export async function runBackupNow(golden: boolean): Promise<BackupRunResult | null> {
  try {
    const res = await afetch(`${API}/backup/run`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ golden }),
    });
    if (!res.ok) return null;
    return (await res.json()) as BackupRunResult;
  } catch {
    return null;
  }
}
