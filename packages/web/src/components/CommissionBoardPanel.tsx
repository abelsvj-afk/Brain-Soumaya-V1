import { useState } from "react";
import { ReviewPanel } from "./ReviewPanel.js";
import { JourneysPanel } from "./JourneysPanel.js";
import { InboxPanel } from "./InboxPanel.js";

/**
 * The Commission Board (Wave 2, settled design 2026-10-28) — the
 * Station's board for taking commissions. The settled scope is four
 * kinds: Link, Review, Journey step, Inbox item.
 *
 * This board invents NO commission system of its own — there is none
 * on the tip, and a system of offers, acceptance, and rewards is
 * deferred, not built here. Each kind routes to the surface where
 * that work already lives: Review opens the shipped review surface,
 * Journey step opens the shipped journeys surface, Inbox item opens
 * the shipped inbox, and Link opens the journeys surface too, because
 * linking happens on a journey's card (its in-card link picker) —
 * the board says so plainly instead of pretending Link has a surface
 * of its own. Every entry is real and reachable; there is no fake
 * commission, no "coming soon", no counter, no reward promised.
 */

export type CommissionKind = "link" | "review" | "journey" | "inbox";

const ENTRIES: readonly {
  kind: CommissionKind;
  title: string;
  line: string;
}[] = [
  {
    kind: "link",
    title: "Link",
    line: "Connect something to a journey — links live on a journey's card.",
  },
  {
    kind: "review",
    title: "Review",
    line: "Review what's due, one card at a time.",
  },
  {
    kind: "journey",
    title: "Journey step",
    line: "Take the next step on a journey.",
  },
  {
    kind: "inbox",
    title: "Inbox item",
    line: "Clear something from your inbox.",
  },
];

export default function CommissionBoardPanel({ spaceId }: { spaceId: string }) {
  const [selected, setSelected] = useState<CommissionKind | null>(null);

  return (
    <section className="commission-board" aria-label="Commission board">
      <header className="commission-board-bar">
        <h3>Commission board</h3>
        {selected && (
          <button type="button" onClick={() => setSelected(null)}>
            Back to the board
          </button>
        )}
      </header>

      {!selected && (
        <>
          <p>Work waiting at the Station. Pick one — each opens where it already lives.</p>
          <ul>
            {ENTRIES.map((entry) => (
              <li key={entry.kind}>
                <button type="button" onClick={() => setSelected(entry.kind)}>
                  {entry.title} — {entry.line}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected === "review" && <ReviewPanel onClose={() => setSelected(null)} />}
      {selected === "journey" && <JourneysPanel />}
      {selected === "inbox" && <InboxPanel spaceId={spaceId} />}
      {selected === "link" && (
        <>
          <p>
            Linking happens on a journey&apos;s card — open a journey below and use its link picker
            to connect something to it.
          </p>
          <JourneysPanel />
        </>
      )}
    </section>
  );
}
