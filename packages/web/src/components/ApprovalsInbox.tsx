import { useEffect, useState } from "react";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import {
  decideWorldChangeProposal,
  getWorldChangesState,
  listWorldChangeProposals,
  worldChangeKindLabel,
  type WorldChangeDecision,
  type WorldChangeProposal,
  type WorldChangeState,
} from "../api/worldChanges.js";
import { formatWorldChangeTime } from "../graph/mutationPresentation.js";
import { useSpaceTimeZone } from "../utils/spaceTimezone.js";

/**
 * Approvals inbox (Phase 4, §17 M1/D-15) — the calm batched review
 * moment. Proposals arrive like mail, not interruptions: no urgency
 * styling, no countdowns, and silence is never approval — nothing here
 * decides itself, and proposals wait quietly until the owner chooses
 * approve, reject, or defer (with an optional note).
 *
 * Same dark contract as travel: while the worlds flag is off this
 * renders nothing and fetches nothing. While the flag is on it fetches
 * the pending proposals on mount, like the travel panel fetches state.
 */
export default function ApprovalsInbox({
  enabled = WORLDS_TRAVEL_ENABLED,
}: {
  enabled?: boolean;
}) {
  const timeZone = useSpaceTimeZone();
  const [open, setOpen] = useState(false);
  const [proposals, setProposals] = useState<WorldChangeProposal[] | null>(null);
  const [state, setState] = useState<WorldChangeState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const [list, st] = await Promise.all([
        listWorldChangeProposals({ status: "pending" }),
        getWorldChangesState(),
      ]);
      if (cancelled) return;
      if (list === null) setLoadFailed(true);
      else setProposals(list);
      if (st) setState(st);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return null;

  const pendingCount = proposals?.length ?? state?.pendingCount ?? null;

  const decide = async (p: WorldChangeProposal, decision: WorldChangeDecision, note: string) => {
    setBusyId(p.id);
    setError(null);
    setDecided(null);
    try {
      const updated = await decideWorldChangeProposal(p.id, decision, note.trim() ? note.trim() : undefined);
      setProposals((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      const verb = updated.status === "approved" ? "Approved" : updated.status === "rejected" ? "Rejected" : "Deferred";
      setDecided(`${verb}: ${p.title}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through — please try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="Approvals" className="approvals-inbox">
      <button type="button" className="approvals-inbox-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide review" : "Review"}
        {pendingCount !== null && pendingCount > 0 && (
          <span> · {pendingCount} waiting — no rush</span>
        )}
        {pendingCount === 0 && <span> · nothing waiting</span>}
        {state?.season && <span> · {state.season}</span>}
      </button>

      {open && (
        <div className="approvals-inbox-body">
          {loadFailed && proposals === null && (
            <p className="approvals-inbox-note">
              Proposals couldn&apos;t load — nothing is decided while they&apos;re out of reach.{" "}
              <button type="button" onClick={() => window.location.reload()}>
                Try again
              </button>
            </p>
          )}
          {proposals !== null && proposals.length === 0 && (
            <p className="approvals-inbox-note">
              Nothing waiting for review. When the brain proposes a change, it will wait here until you choose.
            </p>
          )}
          {decided && <p className="approvals-inbox-note">{decided}</p>}
          {error && (
            <p role="alert" className="approvals-inbox-error">
              {error}
            </p>
          )}
          <ul className="approvals-inbox-list">
            {(proposals ?? []).map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                timeZone={timeZone}
                busy={busyId === p.id}
                onDecide={(decision, note) => void decide(p, decision, note)}
              />
            ))}
          </ul>
          <p className="approvals-inbox-note">
            Nothing here decides itself — proposals wait until you choose. Ignoring one changes nothing.
          </p>
        </div>
      )}
    </section>
  );
}

function ProposalRow({
  proposal: p,
  timeZone,
  busy,
  onDecide,
}: {
  proposal: WorldChangeProposal;
  timeZone: string;
  busy: boolean;
  onDecide: (decision: WorldChangeDecision, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const when = formatWorldChangeTime(p.createdAt, timeZone);
  return (
    <li className="approvals-inbox-item">
      <div>
        <strong>{p.title}</strong> <span>· {worldChangeKindLabel(p.kind)}</span>
      </div>
      <p>{p.reason}</p>
      {p.evidence && <p className="approvals-inbox-evidence">Evidence: {p.evidence}</p>}
      {when && <p className="approvals-inbox-when">Proposed {when}</p>}
      <label>
        A note, if you want one
        <input
          type="text"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — why this choice"
        />
      </label>
      <div className="approvals-inbox-actions">
        <button type="button" disabled={busy} onClick={() => onDecide("approve", note)}>
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => onDecide("reject", note)}>
          Reject
        </button>
        <button type="button" disabled={busy} onClick={() => onDecide("defer", note)}>
          Defer
        </button>
      </div>
    </li>
  );
}
