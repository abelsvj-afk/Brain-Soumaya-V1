import { useCallback, useEffect, useState } from "react";
import {
  getBackupStatus,
  runBackupNow,
  type BackupAttemptSummary,
  type BackupStatus,
} from "../api/backup.js";

/** Render an ISO instant in the VIEWER's local timezone (never raw UTC). */
function fmtLocal(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/** A duration as "2d 4h" / "3h 12m" / "26m" — timezone-free by nature. */
function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TRIGGER_LABEL: Record<BackupAttemptSummary["trigger"], string> = {
  schedule: "automatic — daily schedule",
  catch_up: "catch-up — a missed run",
  manual: "manual — Back up now",
  golden: "golden — manual, pinned forever",
};

/** What an attempt's tier MEANS, in words — the bare tier name alone doesn't say it. */
function tierNote(a: BackupAttemptSummary): string {
  if (a.trigger === "golden") return ""; // the trigger label already says golden + pinned
  if (a.tier === "weekly") return " · weekly keeper (Sunday's run)";
  if (a.tier === "golden") return " · golden";
  return " · daily";
}

/** One honest sentence about how an attempt ended. */
function attemptOutcome(a: BackupAttemptSummary): string {
  switch (a.state) {
    case "promoted":
      return "Promoted — this attempt became the latest good backup.";
    case "failed":
      return (
        `Failed at the ${a.failureStage ?? "unknown"} stage` +
        (a.failureDetail ? ` — ${a.failureDetail}` : "") +
        " The previous latest good backup is untouched."
      );
    case "verified_local":
      return a.offVolumeOutcome === "not_configured"
        ? "Verified locally — the off-volume copy is not configured, so nothing left this machine."
        : "Verified locally.";
    case "pruned":
      return "Completed, and later pruned by retention.";
    default:
      return `In progress — currently at the ${a.state.replace(/_/g, " ")} stage.`;
  }
}

/**
 * The owner's backup panel (G0 increment B3; spec §7, G0-AC-11).
 * Latest-good and latest-attempt are separate, always-labelled blocks
 * — a failed attempt never renders as, or next to, a success state.
 * The server shows this surface to the owner's brain only; for anyone
 * else the panel simply is not there. All times render in the
 * viewer's local timezone.
 */
export default function BackupPanel() {
  const [data, setData] = useState<BackupStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = useCallback(async () => setData(await getBackupStatus()), []);
  useEffect(() => {
    void load();
  }, [load]);
  // While the status loads — and for anyone who is not the owner —
  // the panel simply is not there (no placeholder text for anyone).
  if (data === undefined || data === null) return null;

  const run = async (golden: boolean) => {
    setBusy(true);
    setNote(golden ? "Taking a golden backup…" : "Taking a backup…");
    const result = await runBackupNow(golden);
    setBusy(false);
    if (!result) {
      // No answer is NOT proof of no backup: a slow run can outlast
      // the connection, and the attempt continues server-side. The
      // reloaded status below is the source of truth.
      setNote("No answer from the server — the run may still be under way. The status below is the source of truth.");
    } else if (result.offVolume === "promoted") {
      setNote("Done — the new backup is promoted and stored off-volume.");
    } else if (result.offVolume === "not_configured") {
      setNote("Done — verified locally. The off-volume copy is not configured yet, so it stayed on this machine.");
    } else {
      setNote(`The attempt failed at the ${result.failureStage ?? "unknown"} stage${result.failureDetail ? ` — ${result.failureDetail}` : ""}. The previous latest good backup is untouched.`);
    }
    await load();
  };

  const index = data.offVolume.index;
  return (
    <section className="backup-panel" aria-label="Backups (owner)">
      <h3>Backups (owner)</h3>

      <div className="backup-block backup-good">
        <h4>Latest good backup</h4>
        {data.latestGood ? (
          <>
            <p>
              {fmtLocal(data.latestGood.promotedAt ?? data.latestGood.createdAt)} ·{" "}
              {data.latestGood.tier === "weekly"
                ? "weekly keeper"
                : (data.latestGood.tier ?? "daily")}{" "}
              · {fmtBytes(data.latestGood.snapshotBytes)} · stored off-volume
            </p>
            <p>
              Age: {fmtAge(data.latestGoodAgeMs)}
              {data.latestGoodStale && (
                <strong className="backup-stale">
                  {" "}
                  — ⚠️ STALE: older than 24 hours. A missed day is a visible failure here, never
                  silent.
                </strong>
              )}
            </p>
          </>
        ) : (
          <>
            <p>No backup has been promoted yet.</p>
            {data.latestGoodStale && (
              <p>
                <strong className="backup-stale">
                  ⚠️ STALE: there is no good backup — nothing to restore from off this machine.
                </strong>
              </p>
            )}
            {data.latestLocalVerified && (
              <p className="backup-note">
                Newest verified LOCAL backup: {fmtLocal(data.latestLocalVerified.createdAt)} (
                {fmtBytes(data.latestLocalVerified.snapshotBytes)}) — it lives only on this
                machine until the off-volume copy is configured.
              </p>
            )}
          </>
        )}
        {data.latestGoodDiverged && (
          <p>
            <strong className="backup-stale">
              ⚠️ The off-volume index names a different latest-good
              {data.latestGoodIndexId ? ` (${data.latestGoodIndexId})` : ""} than the local record
              above — a restore would use the index one. The local record likely missed the final
              write of a promotion; nothing was silently overwritten.
            </strong>
          </p>
        )}
      </div>

      <div className="backup-block backup-attempt">
        <h4>Latest attempt</h4>
        {data.latestAttempt ? (
          <>
            <p>
              {fmtLocal(data.latestAttempt.createdAt)} · {TRIGGER_LABEL[data.latestAttempt.trigger]}
              {tierNote(data.latestAttempt)}
              {data.latestAttempt.pinned && data.latestAttempt.trigger !== "golden"
                ? " · 📌 pinned"
                : ""}
            </p>
            <p>{attemptOutcome(data.latestAttempt)}</p>
          </>
        ) : (
          <p>No backup attempt has run yet.</p>
        )}
      </div>

      <p className="backup-note">
        {data.offVolume.configured ? (
          index.status === "ok" ? (
            <>
              Off-volume copy: configured · index healthy ({index.promotedCount} promoted of{" "}
              {index.entryCount} stored, {index.prunedCount} pruned by retention).
            </>
          ) : index.status === "corrupt" ? (
            <strong className="backup-stale">
              ⚠️ Off-volume INDEX CORRUPT — {index.detail ?? "the stored index failed validation"}.
              Recovery would refuse it; nothing was silently reset.
            </strong>
          ) : (
            <strong className="backup-stale">
              ⚠️ Off-volume index unreadable — {index.detail ?? "the store could not be read"}.
            </strong>
          )
        ) : (
          <>
            Off-volume copy: <b>not configured</b> — set BACKUP_R2_* and BACKUP_ENCRYPTION_KEY to
            send encrypted copies off this machine. Until then every attempt is a verified local
            backup only.
          </>
        )}
      </p>
      <p className="backup-note">
        Next automatic run: {fmtLocal(data.schedule.nextRunAt)} — daily at 3:30 AM{" "}
        {data.schedule.timezone} wall-clock.
        {data.schedule.catchUpDue && (
          <strong> A catch-up run is due now (a slot was missed).</strong>
        )}
      </p>

      <div className="backup-btns">
        <button type="button" disabled={busy} onClick={() => void run(false)}>
          Back up now
        </button>
        <button type="button" disabled={busy} onClick={() => void run(true)}>
          Golden backup (pinned)
        </button>
      </div>
      {note && <p className="backup-note">{note}</p>}
    </section>
  );
}
