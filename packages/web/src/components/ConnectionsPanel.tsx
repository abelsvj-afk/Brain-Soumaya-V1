import { useEffect, useRef, useState } from "react";
import {
  getCandidates,
  acceptCandidate,
  dismissCandidate,
  linkMemories,
  pruneWeakLinks,
  restoreCandidate,
  search,
  type Candidate,
  type SearchHit,
} from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * Suggested Connections — YOU control the linking. Soumaya no longer silently wires
 * everything together: the ones she's unsure of (or holds back past her per-memory
 * cap) wait here, and you can also declutter weak links she'd already drawn into this
 * same queue. Connect the ones that matter, dismiss the ones that don't — and link any
 * two memories yourself, no AI required.
 */
export function ConnectionsPanel({
  onClose,
  onChanged,
  onFocus,
}: {
  onClose: () => void;
  /** A link was created/removed → refresh the galaxy. */
  onChanged?: () => void;
  /** Fly the camera to a memory. */
  onFocus?: (id: number) => void;
}) {
  const [items, setItems] = useState<Candidate[]>([]);
  const [pruning, setPruning] = useState(false);
  // IM-120 (honesty subset): loading / error / true-empty are distinct states.
  // This used to be one `items` array + a swallowed catch, so "Nothing waiting"
  // was simultaneously the loading state, the error state, and the empty state.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  // IM-120 (remainder): per-row context preview, bulk selection, and an undo
  // slot for the most recent accept/dismiss (restored server-side too).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastAction, setLastAction] = useState<{ c: Candidate; kind: "accept" | "dismiss"; idx: number } | null>(null);

  const refresh = async () => {
    try {
      const d = await getCandidates();
      setItems(d.candidates);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Put an optimistically-removed row back where it was after a failed action. */
  const restore = (c: Candidate, idx: number) =>
    setItems((xs) => (xs.some((x) => x.id === c.id) ? xs : [...xs.slice(0, Math.max(0, idx)), c, ...xs.slice(Math.max(0, idx))]));

  const accept = async (c: Candidate) => {
    const idx = items.findIndex((x) => x.id === c.id);
    setItems((xs) => xs.filter((x) => x.id !== c.id));
    if (await acceptCandidate(c.id)) {
      playSfx("achievement");
      pushToast("Connected ✦", "🔗", 2500);
      setLastAction({ c, kind: "accept", idx });
      onChanged?.();
    } else {
      // IM-120: a failed accept used to vanish exactly like a successful one.
      restore(c, idx);
      pushToast("Couldn't connect those — try again.", "⚠️", 3500);
    }
  };
  const dismiss = async (c: Candidate) => {
    const idx = items.findIndex((x) => x.id === c.id);
    setItems((xs) => xs.filter((x) => x.id !== c.id));
    if (await dismissCandidate(c.id)) {
      setLastAction({ c, kind: "dismiss", idx });
    } else {
      restore(c, idx);
      pushToast("Couldn't dismiss that — try again.", "⚠️", 3500);
    }
  };
  const undoLast = async () => {
    if (!lastAction) return;
    const { c, idx } = lastAction;
    setLastAction(null);
    if (await restoreCandidate(c.id)) {
      restore(c, idx);
      pushToast("Undone — the suggestion is back.", "↩️", 3000);
      onChanged?.();
    } else {
      pushToast("Couldn't undo that — try refreshing.", "⚠️", 3500);
    }
  };

  const bulk = async (kind: "accept" | "dismiss") => {
    const targets = items.filter((x) => selected.has(x.id));
    setSelected(new Set());
    for (const c of targets) {
      if (kind === "accept") await accept(c);
      else await dismiss(c);
    }
  };

  const declutter = async () => {
    setPruning(true);
    try {
      const { pruned, anchorPruned, weakPruned } = await pruneWeakLinks();
      if (pruned > 0) {
        const bits = [
          anchorPruned > 0 ? `${anchorPruned} wrong link${anchorPruned === 1 ? "" : "s"} removed` : "",
          weakPruned > 0 ? `${weakPruned} weak one${weakPruned === 1 ? "" : "s"} sent here to review` : "",
        ].filter(Boolean);
        pushToast(`Decluttered — ${bits.join(", ")}.`, "🧹", 6000);
        onChanged?.();
        await refresh();
      } else {
        pushToast("Nothing to clear — your galaxy's already tidy.", "✨", 4000);
      }
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="connections-overlay" role="dialog" aria-label="Suggested connections">
      <div className="connections-card">
        <header className="connections-head">
          <h2>🔗 Connections</h2>
          <button className="connections-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <ManualLink onLinked={() => { onChanged?.(); refresh(); }} />

        <section className="connections-section">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Suggested {items.length > 0 ? `(${items.length})` : ""}</h3>
            <button className="mini ghost" onClick={() => void declutter()} disabled={pruning} title="Move the weakest links here so you can review them">
              {pruning ? "Clearing…" : "🧹 Declutter weak links"}
            </button>
          </div>
          <p className="connections-note" style={{ fontSize: "12px", opacity: 0.75, margin: "2px 0 10px" }}>
            Links Soumaya wasn't sure about, or that you decluttered — connect the real ones, dismiss the rest.
          </p>
          {lastAction && (
            <div className="cand-undo" role="status">
              <span>{lastAction.kind === "accept" ? "Connected" : "Dismissed"} “{lastAction.c.aLabel} ↔ {lastAction.c.bLabel}”.</span>
              <button className="mini" onClick={() => void undoLast()}>↩️ Undo</button>
            </div>
          )}
          {selected.size > 0 && (
            <div className="cand-bulk">
              <span>{selected.size} selected</span>
              <button className="mini" onClick={() => void bulk("accept")}>Connect selected</button>
              <button className="mini ghost" onClick={() => void bulk("dismiss")}>Dismiss selected</button>
            </div>
          )}
          {items.length === 0 && loadState === "loading" ? (
            <p className="connections-note" style={{ opacity: 0.6 }}>Loading suggestions…</p>
          ) : items.length === 0 && loadState === "error" ? (
            <p className="connections-note" role="alert" style={{ opacity: 0.85 }}>
              Couldn't load suggestions — something went wrong reaching Soumaya.{" "}
              <button className="mini ghost" onClick={() => { setLoadState("loading"); void refresh(); }}>Try again</button>
            </p>
          ) : items.length === 0 ? (
            <p className="connections-note" style={{ opacity: 0.6 }}>Nothing waiting. New suggestions show up as you add memories.</p>
          ) : (
            <ul className="cand-list">
              {items.map((c) => (
                <li key={c.id} className="cand-item">
                  <div className="cand-pair">
                    <input
                      type="checkbox" aria-label={`Select ${c.aLabel} and ${c.bLabel}`}
                      checked={selected.has(c.id)}
                      onChange={() => setSelected((xs) => { const n = new Set(xs); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                    />
                    <button className="cand-node" onClick={() => onFocus?.(c.a)} title="Fly to it">{c.aLabel}</button>
                    <span className="cand-link" aria-hidden>↔</span>
                    <button className="cand-node" onClick={() => onFocus?.(c.b)} title="Fly to it">{c.bLabel}</button>
                  </div>
                  {/* IM-120: score + age were fetched but never rendered — every
                      suggestion looked equally certain in a triage panel. */}
                  <div className="cand-meta">
                    <span className="cand-score">{Math.round(c.score * 100)}% match</span>
                    {c.createdAt && <span className="cand-age">suggested {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
                  </div>
                  {c.reason && <div className="cand-reason">{c.origin === "pruned" ? "🧹 " : "💭 "}{c.reason}</div>}
                  {(c.aContent || c.bContent) && (
                    <button
                      type="button" className="mini ghost cand-preview-toggle"
                      aria-expanded={expanded.has(c.id)}
                      onClick={() => setExpanded((xs) => { const n = new Set(xs); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                    >
                      {expanded.has(c.id) ? "Hide context" : "Preview context"}
                    </button>
                  )}
                  {expanded.has(c.id) && (
                    <div className="cand-preview">
                      {c.aContent && <p><strong>{c.aLabel}:</strong> {c.aContent.slice(0, 180)}{c.aContent.length > 180 ? "…" : ""}</p>}
                      {c.bContent && <p><strong>{c.bLabel}:</strong> {c.bContent.slice(0, 180)}{c.bContent.length > 180 ? "…" : ""}</p>}
                    </div>
                  )}
                  <div className="cand-actions">
                    <button className="cand-yes" onClick={() => void accept(c)}>Connect</button>
                    <button className="mini ghost" onClick={() => void dismiss(c)}>Dismiss</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Search two memories and connect them yourself — the manual-linking path. */
function ManualLink({ onLinked }: { onLinked: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [a, setA] = useState<SearchHit | null>(null);
  const [b, setB] = useState<SearchHit | null>(null);
  const t = useRef<number | null>(null);

  useEffect(() => {
    if (t.current) window.clearTimeout(t.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    t.current = window.setTimeout(() => {
      void search(q.trim()).then((r) => setHits(r.slice(0, 6)));
    }, 250);
    return () => {
      if (t.current) window.clearTimeout(t.current);
    };
  }, [q]);

  const pick = (h: SearchHit) => {
    if (!a) setA(h);
    else if (!b && h.id !== a.id) setB(h);
    setQ("");
    setHits([]);
  };
  const connect = async () => {
    if (!a || !b) return;
    if (await linkMemories(a.id, b.id)) {
      playSfx("achievement");
      pushToast("Linked ✦", "🔗", 2500);
      setA(null);
      setB(null);
      onLinked();
    } else {
      pushToast("Couldn't link those — try again.", "⚠️", 3000);
    }
  };

  return (
    <section className="connections-section">
      <h3>Connect two memories yourself</h3>
      <div className="ml-slots">
        <span className={`ml-slot ${a ? "filled" : ""}`}>{a ? a.label : "Pick the first…"}{a && <button onClick={() => setA(null)} aria-label="clear">×</button>}</span>
        <span className="ml-x" aria-hidden>↔</span>
        <span className={`ml-slot ${b ? "filled" : ""}`}>{b ? b.label : "Pick the second…"}{b && <button onClick={() => setB(null)} aria-label="clear">×</button>}</span>
        <button className="cand-yes" onClick={() => void connect()} disabled={!a || !b}>Link</button>
      </div>
      <input
        className="ml-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={a && !b ? "Search the second memory…" : "Search a memory to connect…"}
      />
      {hits.length > 0 && (
        <ul className="ml-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <button onClick={() => pick(h)}>{h.label}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
