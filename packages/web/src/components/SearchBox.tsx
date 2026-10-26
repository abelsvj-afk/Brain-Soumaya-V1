import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NODE_TYPE_LABEL, type NodeType } from "@brain/shared";
import { searchDetailed, type SearchHit } from "../api/client.js";
import { matchLabel, moreMatchesText } from "../utils/searchFormat.js";

interface Props {
  onFocus: (id: number) => void;
  onClose?: () => void;
}

/**
 * Search (IM-115): hits used to be label-only even though SearchHit already
 * carries content/type/celestial title/importance/createdAt; search was
 * submit-only; there were no recents, no keyboard navigation beyond Escape,
 * and clicking a hit destroyed the result set. Now: rich rows, debounced
 * as-you-type search, recent searches, arrow-key navigation, and results
 * that survive a click (you can fly to a hit and keep browsing the list).
 */

const RECENTS_KEY = "brain.searchRecents";
const DEBOUNCE_MS = 300;

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
function saveRecent(q: string): string[] {
  const next = [q, ...loadRecents().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function snippet(content?: string): string {
  if (!content) return "";
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat;
}

export function SearchBox({ onFocus, onClose }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  // REG-186: the top-k page's honesty envelope — whether more matches exist
  // than the page shows, and whether the total is exact or a lower bound.
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [totalCapped, setTotalCapped] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  // A slow first search resolving after a faster second one used to let the
  // stale response silently overwrite the newer results.
  const requestSeq = useRef(0);
  const lastRunRef = useRef("");

  async function runSearch(query: string) {
    const seq = ++requestSeq.current;
    lastRunRef.current = query;
    setBusy(true);
    setError(null);
    const r = await searchDetailed(query);
    if (seq !== requestSeq.current || !r) return; // a newer search superseded this one
    setBusy(false);
    setHits(r.hits);
    setTotal(r.total);
    setHasMore(r.hasMore ?? false);
    setTotalCapped(r.totalCapped ?? false);
    setError(r.error ?? null);
    setActive(r.hits.length > 0 ? 0 : -1);
    setOpen(true);
  }

  function run(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setRecents(saveRecent(query));
    void runSearch(query);
  }

  // Debounced as-you-type (skips the query a submit just ran, so the two
  // paths never double-fire for the same text).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || query === lastRunRef.current) return;
    const t = window.setTimeout(() => { void runSearch(query); }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const choose = (h: SearchHit) => {
    // IM-115: preserve the result set — flying to a hit no longer destroys
    // the list the user was browsing.
    onFocus(h.id);
    setActive(hits.findIndex((x) => x.id === h.id));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose?.(); return; }
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0 && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    }
  };

  const showRecents = open && !q.trim() && recents.length > 0;

  return (
    <div className="panel search" onKeyDown={onKeyDown} role="search">
      <form onSubmit={run}>
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search your mind…"
          aria-label="Search your mind"
        />
        {onClose && (
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </form>
      {showRecents && (
        <div className="search-recents">
          <span className="search-recents-label">Recent</span>
          {recents.map((r) => (
            <button
              key={r}
              type="button"
              className="search-recent"
              onClick={() => { setQ(r); void runSearch(r); }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="empty">Searching…</p>}
      {!busy && open && q.trim() && (
        <ul className="results" aria-live="polite">
          {error && <li className="empty">⚠️ {error}</li>}
          {!error && hits.length === 0 && (
            <li className="empty" style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
              <span>No matches.</span>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  type="button"
                  className="mini"
                  onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "chat" } }))}
                >
                  💬 Ask Soumaya
                </button>
                <button
                  type="button"
                  className="mini ghost"
                  onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "panel", value: "ingest" } }))}
                >
                  ➕ Add as memory
                </button>
              </div>
            </li>
          )}
          {!error &&
            hits.map((h, i) => (
              <li key={h.id}>
                <button
                  className={i === active ? "search-hit active" : "search-hit"}
                  aria-current={i === active || undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(h)}
                >
                  <span className="search-hit-main">
                    <span className="search-hit-label">{h.label}</span>
                    {h.celestialTitle && h.celestialTitle !== h.label && (
                      <span className="search-hit-title">{h.celestialTitle}</span>
                    )}
                    {snippet(h.content) && <span className="search-hit-snippet">{snippet(h.content)}</span>}
                    <span className="search-hit-meta">
                      {NODE_TYPE_LABEL[h.type as NodeType] ?? h.type}
                      {typeof h.importance === "number" ? ` · importance ${(h.importance * 100).toFixed(0)}%` : ""}
                      {fmtDate(h.createdAt) ? ` · ${fmtDate(h.createdAt)}` : ""}
                    </span>
                  </span>
                  {/* REG-185: no invented percentage — the row names which
                      retrieval side produced the hit instead. */}
                  <em>{matchLabel(h)}</em>
                </button>
              </li>
            ))}
          {/* REG-186: the page is top-k — say so when more matches exist. */}
          {!error && hasMore && (
            <li className="empty small">{moreMatchesText(hits.length, total ?? hits.length, totalCapped)}</li>
          )}
        </ul>
      )}
    </div>
  );
}
