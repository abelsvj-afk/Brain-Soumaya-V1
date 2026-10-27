import { useEffect, useMemo, useState } from "react";
import type { JourneyLinkKind } from "@brain/shared";
import { linkToJourney } from "../api/journeys.js";
import { getGraph } from "../api/client.js";
import { listIncome, listExpense, listBills, getWealthSummary } from "../api/finance.js";
import { pushToast } from "./Toasts.js";

/**
 * In-card "link something" picker (IM-88). Linking used to be possible only
 * from the other object's surface (its inspector / Money row / capture flow);
 * this brings the same link API (`linkToJourney`, the exact call JourneyChips
 * makes) into the Journey's own detail view. Candidates come from the existing
 * list APIs — memories/tasks from the graph, money from Finance, goals from
 * the Wealth summary — and are fetched lazily, only when the picker is opened.
 * Action nodes are linked with kind "node", exactly as NodeInspector's
 * JourneyChips links them (actions are nodes rows).
 */

export interface LinkCandidate {
  kind: JourneyLinkKind;
  refId: number;
  label: string;
  section: string;
}

export function JourneyLinkPicker({
  journeyId,
  linkedKeys,
  onLinked,
}: {
  journeyId: number;
  /** "kind:refId" for everything already linked (display window — the server's
   *  link insert is idempotent, so an already-linked row outside the window
   *  is a harmless no-op, never a duplicate). */
  linkedKeys: Set<string>;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || candidates !== null) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      const [graph, incomes, expenses, bills, wealth] = await Promise.all([
        getGraph(300).catch(() => null),
        listIncome().catch(() => null),
        listExpense().catch(() => null),
        listBills().catch(() => null),
        getWealthSummary().catch(() => null),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!graph && !incomes && !expenses && !bills && !wealth) { setLoadError(true); return; }
      const out: LinkCandidate[] = [];
      for (const n of graph?.nodes ?? []) {
        out.push({
          kind: "node",
          refId: n.id,
          label: n.label,
          section: n.kind === "action" ? "✅ Tasks" : "🧭 Memories",
        });
      }
      for (const i of incomes ?? []) out.push({ kind: "income", refId: i.id, label: i.platform || "Income", section: "💵 Transactions" });
      for (const e of expenses ?? []) out.push({ kind: "expense", refId: e.id, label: e.merchant || e.category || "Expense", section: "💵 Transactions" });
      for (const b of bills ?? []) out.push({ kind: "bill", refId: b.id, label: b.name, section: "📅 Bills" });
      for (const g of wealth?.goals ?? []) out.push({ kind: "goal", refId: g.id, label: g.name, section: "🎯 Goals" });
      setCandidates(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    if (!candidates) return [];
    const needle = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (linkedKeys.has(`${c.kind}:${c.refId}`) || justLinked.has(`${c.kind}:${c.refId}`)) return false;
      return !needle || c.label.toLowerCase().includes(needle);
    });
  }, [candidates, query, linkedKeys, justLinked]);

  const link = async (c: LinkCandidate) => {
    const key = `${c.kind}:${c.refId}`;
    setBusyKey(key);
    const result = await linkToJourney(journeyId, c.kind, c.refId);
    setBusyKey(null);
    if (!result) {
      pushToast("Couldn't link that — try again.", "⚠️", 3500);
      return;
    }
    setJustLinked((prev) => new Set(prev).add(key));
    pushToast(`Linked "${c.label}" to this Journey`, "🧭", 3000);
    onLinked();
  };

  if (!open) {
    return (
      <button className="jn-secondary" onClick={() => setOpen(true)}>
        ＋ Link something
      </button>
    );
  }

  const sections = [...new Set(visible.map((c) => c.section))];
  return (
    <div className="jn-picker">
      <div className="jn-picker-head">
        <strong>Link something to this Journey</strong>
        <button className="jn-secondary" onClick={() => setOpen(false)}>Done</button>
      </div>
      <input
        className="jn-picker-search"
        placeholder="Search memories, tasks, transactions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search linkable items"
      />
      {loading && <p className="jn-hint">Loading what you can link…</p>}
      {loadError && <p className="jn-hint">⚠️ Couldn't load linkable items — try reopening this Journey.</p>}
      {!loading && !loadError && candidates !== null && visible.length === 0 && (
        <p className="jn-hint">{candidates.length === 0 ? "Nothing available to link yet — capture a memory or add a transaction first." : "Nothing unlinked matches that search."}</p>
      )}
      {sections.map((section) => {
        // REG-163/JN-06: the picker used to slice each section at 20 with no
        // note — five of 25 memories simply never appeared, indistinguishable
        // from absent. Disclose shown/total like the panel's own links section.
        const inSection = visible.filter((c) => c.section === section);
        const shown = inSection.slice(0, 20);
        return (
          <div key={section} className="jn-links-group">
            <div className="jn-links-label">{section}</div>
            {shown.map((c) => (
              <button
                key={`${c.kind}:${c.refId}`}
                className="jn-link-row"
                disabled={busyKey === `${c.kind}:${c.refId}`}
                onClick={() => void link(c)}
              >
                {c.label}
              </button>
            ))}
            {inSection.length > shown.length && (
              <p className="jn-hint">Showing {shown.length} of {inSection.length} — search to find the rest.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
