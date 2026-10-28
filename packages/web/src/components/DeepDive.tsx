import { useEffect, useState } from "react";
import type { InvestigationReport } from "@brain/shared";
import { investigateNode } from "../api/client.js";

/**
 * Deep-dive (IM-37): the Investigator's face in the Details tab. POSTs to
 * /api/investigate for THIS memory and renders the cited report — summary,
 * the research type it assigned, the evidence (each citation is a real node,
 * tappable to fly to it), and the open questions it surfaced.
 *
 * REG-152 / INS-05: this is the INVESTIGATOR deep-dive — internal, cited,
 * free — and it is named as such everywhere here, because a second system
 * shares the name "deep-dive": Research Mode research (paid, gated,
 * persistent, mutating — it appends a `--- Research Deep Dive ---` section
 * to the node's own content). The two must never again share a bare label.
 *
 * Truthful states: before a run it says nothing has run in this visit yet
 * (REG-108 — reports don't persist, so the copy never claims none ever ran);
 * while running it says so; on failure the error goes to a dedicated error
 * surface with Retry — never into the report body (the IM-32 lesson: server
 * error text must not be rendered in Soumaya's voice).
 *
 * Note on scope: the endpoint's contract is { nodeId } only — it investigates
 * the memory itself and RETURNS the questions worth asking (rendered below).
 * There is deliberately no free-text question input: the endpoint would
 * discard it, and a box whose text silently does nothing is fake UI.
 */
export function DeepDive({
  nodeId,
  nodeLabel,
  onFocus,
}: {
  nodeId: number;
  nodeLabel: string;
  onFocus: (id: number) => void;
}) {
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A report about a different memory must never linger when the user moves on.
  useEffect(() => {
    setReport(null);
    setError("");
    setBusy(false);
  }, [nodeId]);

  const run = () => {
    setBusy(true);
    setError("");
    investigateNode(nodeId)
      .then(setReport)
      .catch((e) => setError((e as Error).message || "The Investigator deep-dive couldn't run — try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="deep-dive">
      <div className="chronicle-head">
        <h3>🔍 Investigator deep-dive</h3>
        <button className="mini" onClick={run} disabled={busy}>
          {busy ? "Investigating…" : report ? "Run again" : "Investigate"}
        </button>
      </div>
      <p className="deep-dive-hint">
        Soumaya digs through your own memories around “{nodeLabel}” first — what connects,
        what pattern it sits in — and cites everything she finds. This is the Investigator: a free,
        cited look through your own memories. It&apos;s different from Research Mode research, which
        expands a memory with outside research and costs fuel.
      </p>
      {busy && (
        <p className="empty small" role="status">
          Digging through your memories…
        </p>
      )}
      {!busy && error && (
        <div className="deep-dive-error" role="alert">
          <p>Couldn’t run that Investigator deep-dive. {error}</p>
          <button className="mini" onClick={run}>
            Retry
          </button>
        </div>
      )}
      {!busy && !error && !report && (
        // REG-108: reports are ephemeral (no store) — the empty copy is scoped
        // honestly to this visit, so reopening never claims no deep-dive ever ran.
        // REG-152: named Investigator, so it never shares a bare label with
        // Research Mode research.
        <p className="empty small">No Investigator deep-dive run in this visit yet.</p>
      )}
      {!busy && report && (
        <div className="deep-dive-report">
          <p className="deep-dive-type">
            Research type: <strong>{report.researchType}</strong>
          </p>
          <p className="deep-dive-summary">{report.summary}</p>
          {report.evidence.length > 0 && (
            <>
              <h4>Evidence she found</h4>
              <ul className="deep-dive-evidence">
                {report.evidence.map((ev) => (
                  <li key={ev.nodeId}>
                    <button className="pill" onClick={() => onFocus(ev.nodeId)} title="Fly to this memory">
                      {ev.label}
                    </button>
                    <span className="deep-dive-why">{ev.why}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {report.openQuestions.length > 0 && (
            <>
              <h4>Questions it opens</h4>
              <ul className="deep-dive-questions">
                {report.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
