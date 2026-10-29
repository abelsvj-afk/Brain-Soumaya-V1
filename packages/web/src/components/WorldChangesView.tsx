import { useEffect, useState } from "react";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import {
  getWorldChangeProposal,
  getWorldChangesLog,
  getWorldChangesState,
  undoWorldChangeProposal,
  worldChangeKindLabel,
  type WorldChangeLogEntry,
  type WorldChangeProposal,
  type WorldChangeState,
} from "../api/worldChanges.js";
import { formatWorldChangeTime } from "../graph/mutationPresentation.js";
import { useSpaceTimeZone } from "../utils/spaceTimezone.js";

/**
 * World Changes view (Phase 4, §17 M6/D-17) — the browsable history of
 * what the world did and why. Door two of the log; door one is the
 * on-demand “Why is this here?” explanation per item, which fetches the
 * same proposal the inbox decided — both doors read the same log and
 * the same explanation rules, never two records that could disagree.
 *
 * The view is a reference and control surface, not a notification
 * stream: it never demands attention, and an applied change can be
 * undone from its own entry (a compensating entry, never a rewrite —
 * the log keeps both). Same dark contract as travel: while the worlds
 * flag is off this renders nothing and fetches nothing.
 */
export default function WorldChangesView({
  enabled = WORLDS_TRAVEL_ENABLED,
}: {
  enabled?: boolean;
}) {
  const timeZone = useSpaceTimeZone();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<WorldChangeLogEntry[] | null>(null);
  const [state, setState] = useState<WorldChangeState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const [log, st] = await Promise.all([getWorldChangesLog(), getWorldChangesState()]);
      if (cancelled) return;
      if (log === null) setLoadFailed(true);
      else setEntries(log);
      if (st) setState(st);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, retry]);

  if (!enabled) return null;

  const refresh = () => {
    setLoadFailed(false);
    setRetry((r) => r + 1);
  };

  return (
    <section aria-label="World Changes" className="world-changes-view">
      <button type="button" className="world-changes-view-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide world changes" : "World changes"}
        {state !== null && <span> · {state.appliedCount} applied</span>}
        {state?.season && <span> · {state.season}</span>}
      </button>

      {open && (
        <div className="world-changes-view-body">
          {loadFailed && entries === null && (
            <p className="world-changes-view-note">
              The history couldn&apos;t load — nothing is hidden, it just isn&apos;t reachable right now.{" "}
              <button type="button" onClick={refresh}>
                Try again
              </button>
            </p>
          )}
          {entries !== null && entries.length === 0 && (
            <p className="world-changes-view-note">
              Nothing has changed yet — when the world changes, the story lands here.
            </p>
          )}
          <ol className="world-changes-view-list">
            {(entries ?? []).map((e) => (
              <LogEntryRow
                key={e.id}
                entry={e}
                timeZone={timeZone}
                onUndone={refresh}
              />
            ))}
          </ol>
          <p className="world-changes-view-note">
            This is the world&apos;s own memory — what changed, why, and when, in your local time.
          </p>
        </div>
      )}
    </section>
  );
}

function LogEntryRow({
  entry: e,
  timeZone,
  onUndone,
}: {
  entry: WorldChangeLogEntry;
  timeZone: string;
  onUndone: () => void;
}) {
  const [proposal, setProposal] = useState<WorldChangeProposal | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [whyFailed, setWhyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const when = formatWorldChangeTime(e.appliedAt, timeZone);

  const toggleWhy = async () => {
    if (showWhy) {
      setShowWhy(false);
      return;
    }
    if (!e.proposalId) return;
    setWhyFailed(false);
    const p = await getWorldChangeProposal(e.proposalId);
    if (!p) {
      setWhyFailed(true);
      return;
    }
    setProposal(p);
    setShowWhy(true);
  };

  const undo = async () => {
    if (!e.proposalId) return;
    setBusy(true);
    setError(null);
    try {
      await undoWorldChangeProposal(e.proposalId);
      setUndone(true);
      onUndone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="world-changes-view-item">
      <div>
        <strong>{e.summary}</strong> <span>· {worldChangeKindLabel(e.kind)}</span>
      </div>
      <p>{e.reason}</p>
      {when && <p className="world-changes-view-when">{when}</p>}
      {e.proposalId && (
        <button type="button" onClick={() => void toggleWhy()}>
          {showWhy ? "Hide why" : "Why is this here?"}
        </button>
      )}
      {whyFailed && (
        <p className="world-changes-view-note">The explanation couldn&apos;t load — the entry above still stands.</p>
      )}
      {showWhy && proposal && (
        <div className="world-changes-view-why">
          <p>
            <strong>{proposal.title}</strong>
          </p>
          <p>{proposal.reason}</p>
          {proposal.evidence && <p>Evidence: {proposal.evidence}</p>}
          <p>Status: {proposal.status}</p>
          {proposal.status === "applied" && !undone && (
            <button type="button" disabled={busy} onClick={() => void undo()}>
              Undo this change
            </button>
          )}
          {undone && <p>The undo landed — the history keeps both entries.</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="world-changes-view-error">
          {error}
        </p>
      )}
    </li>
  );
}
