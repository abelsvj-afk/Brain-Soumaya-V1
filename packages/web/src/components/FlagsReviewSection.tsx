import { useEffect, useState } from "react";
import {
  listUnresolvedFlags,
  reviewUnresolvedFlag,
  deleteUnresolvedFlagRow,
  dismissUnresolvedFlag,
  type UnresolvedFlagView,
  type UnresolvedFlagsList,
} from "../api/forgetRequests.js";
import { pushToast } from "./Toasts.js";

/** Plain-language description of a flagged row (review surface, design
 *  §2.1). Content-free by construction: a user_model row shows only its
 *  controlled-vocabulary descriptors, never its content; an instruction
 *  profile shows its id + mode/priority/enabled, never its name. */
function flagDescriptor(flag: UnresolvedFlagView): string {
  if (flag.table === "user_model") {
    const parts = [`${flag.slot ?? "stated"} · ${flag.origin ?? "stated"}`];
    if (flag.topicLabels && flag.topicLabels.length > 0) parts.push(`topics: ${flag.topicLabels.join(", ")}`);
    if (flag.confidence != null) parts.push(`confidence ${flag.confidence}`);
    return parts.join(" — ");
  }
  return `${flag.mode ?? "always"} · priority ${flag.priority ?? 0} · ${flag.enabled === false ? "disabled" : "enabled"}`;
}

function flagTitle(flag: UnresolvedFlagView): string {
  return flag.table === "user_model"
    ? "Your stated words"
    : `Instruction profile #${flag.rowId}`;
}

/**
 * Review surface for flagged forget rows (design note
 * `unresolved-flag-review-surface-design-2026-10-25.md` §2): quoting
 * rows a forget left in place by policy, persisted as durable flags.
 *
 * Extracted from SettingsPanel into the Your Words panel (owner
 * settlement 2026-10-31: the flag review is part of the panel, not a
 * Settings section). Behaviour is unchanged from the Settings era:
 * the list is content-free, review/delete/dismiss ride the existing
 * /api/forget-requests/unresolved wrappers, delete is two-step, and
 * the load rides its OWN effect — a slow or hung flags request must
 * not stall the rest of the panel. Fail-soft: null means the list
 * could not be loaded (never "empty"). No badge or count is shown
 * anywhere else (Q3) — the counts live only on this section's own
 * filter buttons.
 */
export function FlagsReviewSection() {
  const [flags, setFlags] = useState<UnresolvedFlagsList | null>(null);
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const [flagsFilter, setFlagsFilter] = useState<"open" | "reviewed">("open");
  const [flagsBusy, setFlagsBusy] = useState<number | null>(null);
  const [flagConfirmDelete, setFlagConfirmDelete] = useState<number | null>(null);

  const refreshFlags = async () => {
    const f = await listUnresolvedFlags().catch(() => null);
    if (f) setFlags(f);
    setFlagsLoaded(true);
  };

  useEffect(() => {
    let cancelled = false;
    void listUnresolvedFlags()
      .catch(() => null)
      .then((f) => {
        if (cancelled) return;
        if (f) setFlags(f);
        setFlagsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const onReviewFlag = async (flagId: number) => {
    setFlagsBusy(flagId);
    try {
      const v = await reviewUnresolvedFlag(flagId);
      if (!v) throw new Error("review rejected");
      await refreshFlags();
      pushToast("Marked as reviewed.", "✓", 3000);
    } catch {
      pushToast("Couldn't mark that as reviewed — try again.", "⚠️", 4000);
    } finally {
      setFlagsBusy(null);
    }
  };

  const onDeleteFlagRow = async (flagId: number) => {
    setFlagsBusy(flagId);
    try {
      const v = await deleteUnresolvedFlagRow(flagId);
      if (!v) throw new Error("delete rejected");
      setFlagConfirmDelete(null);
      await refreshFlags();
      pushToast("Row deleted.", "✓", 3000);
    } catch {
      pushToast("Couldn't delete that row — try again.", "⚠️", 4000);
    } finally {
      setFlagsBusy(null);
    }
  };

  const onDismissFlag = async (flagId: number) => {
    setFlagsBusy(flagId);
    try {
      const v = await dismissUnresolvedFlag(flagId);
      if (!v) throw new Error("dismiss rejected");
      await refreshFlags();
      pushToast("Flag dismissed — the row was already gone.", "✓", 3000);
    } catch {
      pushToast("Couldn't dismiss that flag — try again.", "⚠️", 4000);
    } finally {
      setFlagsBusy(null);
    }
  };

  return (
    <section className="settings-section">
      <h3>🧹 Forgotten words — flagged for review</h3>
      <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
        When you ask Soumaya to forget words, a few rows are kept on purpose — your own stated
        words and instruction profiles — and flagged here so you can review them. The forgotten
        words themselves are never shown here.
      </p>
      {!flagsLoaded ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Loading flagged rows…</p>
      ) : !flags ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Couldn&apos;t reach the server — flagged rows aren&apos;t available right now.</p>
      ) : flags.open.length === 0 && flags.reviewed.length === 0 ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Nothing flagged — no forgotten words are waiting for review.</p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: "10px", gap: "8px", display: "flex" }}>
            <button className={flagsFilter === "open" ? "on" : ""} onClick={() => setFlagsFilter("open")}>
              To review ({flags.open.length})
            </button>
            <button className={flagsFilter === "reviewed" ? "on" : ""} onClick={() => setFlagsFilter("reviewed")}>
              Reviewed ({flags.reviewedCount})
            </button>
          </div>
          {(flagsFilter === "open" ? flags.open : flags.reviewed).map((flag) => (
            <div key={flag.flagId} style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "8px" }}>
              <div style={{ fontWeight: 600 }}>{flagTitle(flag)}</div>
              <div className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "4px 0 8px" }}>
                {flagDescriptor(flag)}
              </div>
              {flag.targetMissing ? (
                <>
                  <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 8px" }}>
                    This row is already gone.
                  </p>
                  {flag.status === "open" && (
                    <button className="mini" disabled={flagsBusy === flag.flagId} onClick={() => void onDismissFlag(flag.flagId)}>
                      Dismiss flag
                    </button>
                  )}
                </>
              ) : flag.status === "open" ? (
                flagConfirmDelete === flag.flagId ? (
                  <>
                    <p className="settings-note" style={{ fontSize: "12px", margin: "0 0 8px" }}>
                      Delete this {flag.table === "user_model" ? "stated-words row" : "instruction profile"} (#{flag.rowId})?
                      This permanently removes the row itself. This can&apos;t be undone.
                    </p>
                    <div className="row" style={{ gap: "8px", display: "flex" }}>
                      <button className="mini" disabled={flagsBusy === flag.flagId} onClick={() => void onDeleteFlagRow(flag.flagId)}>
                        Delete permanently
                      </button>
                      <button className="mini" disabled={flagsBusy === flag.flagId} onClick={() => setFlagConfirmDelete(null)}>
                        Keep it
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="row" style={{ gap: "8px", display: "flex" }}>
                    <button className="mini" disabled={flagsBusy === flag.flagId} onClick={() => void onReviewFlag(flag.flagId)}>
                      Mark reviewed
                    </button>
                    <button className="mini" disabled={flagsBusy === flag.flagId} onClick={() => setFlagConfirmDelete(flag.flagId)}>
                      Delete row
                    </button>
                  </div>
                )
              ) : (
                <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6, margin: 0 }}>Reviewed.</p>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
