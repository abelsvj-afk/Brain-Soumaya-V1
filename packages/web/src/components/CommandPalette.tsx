import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchDetailed, type SearchHit } from "../api/client.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { filterPaletteCommands, type PaletteCommand } from "../lib/commandPalette.js";

/**
 * IM-142 — command palette (⌘K). Minimal by design: one input that both
 * filters the jump-to/action commands (lib/commandPalette.ts) and, from 2+
 * characters, searches memories through the SAME search API SearchBox uses
 * (searchDetailed — SearchBox's internals are untouched). Enter/click runs
 * the active row: a command goes to App's onCommand (which drives the app's
 * existing panel/tab/overlay state), a memory hit goes to onFocusNode.
 * Escape closes and focus returns to the opener via useDialogA11y.
 */
interface Props {
  onClose: () => void;
  onCommand: (cmd: PaletteCommand) => void;
  onFocusNode: (id: number) => void;
}

type Row =
  | { kind: "command"; cmd: PaletteCommand }
  | { kind: "hit"; hit: SearchHit };

const SEARCH_DEBOUNCE_MS = 200;
const MIN_SEARCH_CHARS = 2;

export function CommandPalette({ onClose, onCommand, onFocusNode }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  useDialogA11y(rootRef, onClose);

  const commands = useMemo(() => filterPaletteCommands(q), [q]);
  const rows = useMemo<Row[]>(
    () => [
      ...commands.map((cmd): Row => ({ kind: "command", cmd })),
      ...hits.map((hit): Row => ({ kind: "hit", hit })),
    ],
    [commands, hits],
  );

  // Any new query invalidates the previous hit list + active row.
  useEffect(() => {
    setActive(0);
    setHits([]);
    setError(null);
    setSearched(false);
  }, [q]);

  // Debounced memory search (same stale-response guard pattern as SearchBox).
  useEffect(() => {
    const query = q.trim();
    if (query.length < MIN_SEARCH_CHARS) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const seq = ++requestSeq.current;
    const t = setTimeout(() => {
      void searchDetailed(query).then(({ hits: found, error: err }) => {
        if (seq !== requestSeq.current) return;
        setBusy(false);
        setSearched(true);
        setHits(found);
        setError(err ?? null);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const runRow = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "command") onCommand(row.cmd);
    else onFocusNode(row.hit.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runRow(rows[active]);
    }
  };

  const query = q.trim();
  const showSearchSection = query.length >= MIN_SEARCH_CHARS;

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={rootRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          className="cmdk-input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search memories or jump to…"
          aria-label="Search memories or jump to a tab or action"
        />
        <div className="cmdk-list" role="listbox" aria-label="Results">
          {commands.length > 0 && <div className="cmdk-section">Go to / do</div>}
          {commands.map((cmd, i) => (
            <button
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={active === i}
              className={`cmdk-row${active === i ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => runRow(rows[i])}
            >
              <span className="cmdk-ic">{cmd.icon}</span>
              <span className="cmdk-title">{cmd.title}</span>
              {cmd.hint && <span className="cmdk-hint">{cmd.hint}</span>}
            </button>
          ))}
          {commands.length === 0 && !showSearchSection && (
            <p className="cmdk-empty">No commands match “{query}”.</p>
          )}

          {showSearchSection && (
            <>
              <div className="cmdk-section">Memories</div>
              {busy && <p className="cmdk-empty">Searching…</p>}
              {!busy && error && <p className="cmdk-empty">⚠️ {error}</p>}
              {!busy && !error && searched && hits.length === 0 && (
                <p className="cmdk-empty">No memories match “{query}”.</p>
              )}
              {!busy &&
                !error &&
                hits.map((h, j) => {
                  const idx = commands.length + j;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      role="option"
                      aria-selected={active === idx}
                      className={`cmdk-row${active === idx ? " active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => runRow(rows[idx])}
                    >
                      <span className="cmdk-ic">✦</span>
                      <span className="cmdk-title">{h.label}</span>
                      {typeof h.similarity === "number" && (
                        <span className="cmdk-hint">{`${(h.similarity * 100).toFixed(0)}%`}</span>
                      )}
                    </button>
                  );
                })}
            </>
          )}
          {query.length === 1 && (
            <p className="cmdk-empty">Keep typing — memory search starts at 2 characters.</p>
          )}
        </div>
        <div className="cmdk-foot">↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}
