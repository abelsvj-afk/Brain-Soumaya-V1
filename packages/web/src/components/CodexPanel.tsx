import { useEffect, useMemo, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { buildCodex, codexProgress, CODEX_CATEGORIES, fieldNoteEntries, type CodexEntry, type CodexCategory } from "./codex.js";
import { getCodexDiscoveries, type AgentDiscovery } from "../api/client.js";
import { useCodexDiscoveryClaims } from "./useCodexDiscoveryClaims.js";

/**
 * The Codex — a gamified, living atlas of the galaxy. Entries start locked, unlock as
 * the brain grows (with a completion %), and level up with engagement. Newly-discovered
 * entries fire a toast + claim a small fuel reward once each (server-tracked).
 */
export function CodexPanel({
  graph,
  onFocus,
  spaceId = "",
  onReward,
  onNavigate,
}: {
  graph: GraphData;
  onFocus: (id: number) => void;
  spaceId?: string;
  onReward?: () => void;
  /** IM-95: jump to another dock tab (locked entries whose unlock lives elsewhere). */
  onNavigate?: (tab: string) => void;
}) {
  // Soumaya's autonomously-charted field notes (server), merged into the atlas.
  // IM-91: a fetch failure is VISIBLE (banner + retry) — before, the catch
  // swallowed it and the Field Notes category showing 0 was indistinguishable
  // from "she has charted nothing".
  const [discoveries, setDiscoveries] = useState<AgentDiscovery[]>([]);
  const [notesError, setNotesError] = useState(false);
  const [notesRetry, setNotesRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getCodexDiscoveries()
      .then((d) => {
        if (cancelled) return;
        setDiscoveries(d);
        setNotesError(false);
      })
      .catch(() => {
        if (!cancelled) setNotesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, notesRetry]);

  const entries = useMemo(() => {
    const nodes = graph.nodes as GraphNode[];
    return [
      ...buildCodex({
        memories: nodes.filter((n) => n.kind !== "action" && n.kind !== "moc"),
        constellations: nodes.filter((n) => n.kind === "moc"),
        links: graph.links.length,
      }),
      ...fieldNoteEntries(discoveries),
    ];
  }, [graph, discoveries]);
  const progress = useMemo(() => codexProgress(entries), [entries]);
  const [tab, setTab] = useState<CodexCategory>("sectors");

  // REG-047 (PG-04): discovery claiming lives in the shared hook (App mounts
  // it globally, so discoveries announce + pay at the moment they first become
  // true). The panel mounts it too with its full entry list — opening the
  // panel afterwards shows no backlog burst, because both share one seen-store.
  const { seenRef } = useCodexDiscoveryClaims(entries, spaceId, onReward);

  // IM-91 "recently discovered": when each entry was first seen on this
  // device, recorded going forward (same honesty rule as IM-92 — entries seen
  // before this was tracked have no date and sort last, never an invented one).
  const [seenAt, setSeenAt] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!spaceId) return;
    try {
      setSeenAt(JSON.parse(localStorage.getItem(`codex.seenAt.${spaceId}`) || "{}"));
    } catch {
      setSeenAt({});
    }
  }, [spaceId]);

  const [query, setQuery] = useState("");
  const [recentView, setRecentView] = useState(false);
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const shown = useMemo(() => {
    if (searching) {
      return entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.lore.toLowerCase().includes(q) ||
          e.lockedHint.toLowerCase().includes(q),
      );
    }
    if (recentView) {
      // Dated discoveries first, newest first; undated ones (seen before
      // tracking, or computed entries never claimed here) follow in catalog
      // order — no date is ever invented for them.
      return entries
        .filter((e) => e.discovered)
        .map((e, i) => ({ e, i, at: seenAt[e.id] ?? e.createdAt ?? "" }))
        .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? 1 : -1))
        .map((x) => x.e);
    }
    return entries.filter((e) => e.category === tab);
  }, [entries, searching, q, recentView, tab, seenAt]);

  return (
    <div className="dock-body" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <div className="dock-head">
        <h3>📖 Codex</h3>
        <span style={{ fontSize: "0.76rem", opacity: 0.75 }}>
          {progress.discovered}/{progress.total} · {progress.pct}%
        </span>
      </div>
      <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden", marginBottom: "0.9rem" }}>
        <div style={{ height: "100%", width: `${progress.pct}%`, background: "linear-gradient(90deg,#7af9ff,#c9a0ff)" }} />
      </div>

      {notesError && (
        <div className="codex-notes-error" role="alert">
          <span>⚠️ Soumaya&apos;s field notes couldn&apos;t be loaded — her charted discoveries may be missing.</span>
          <button className="mini" onClick={() => setNotesRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {/* IM-91: search the whole atlas (40+ entries) from one box. */}
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.6rem" }}>
        <input
          type="search"
          aria-label="Search the Codex"
          placeholder="Search the Codex…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          className="mini"
          aria-pressed={recentView}
          onClick={() => setRecentView((v) => !v)}
          style={{
            borderColor: recentView ? "var(--accent)" : "rgba(255,255,255,0.14)",
            background: recentView ? "rgba(122,249,255,0.12)" : "transparent",
            fontSize: "0.74rem",
          }}
          title="Show discovered entries, newest first"
        >
          🕒 Recent
        </button>
      </div>

      {/* Category chips */}
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {CODEX_CATEGORIES.map((c) => {
          const p = progress.byCategory[c.id];
          const on = tab === c.id && !recentView && !searching;
          return (
            <button
              key={c.id}
              className="mini"
              onClick={() => {
                setTab(c.id);
                setRecentView(false);
              }}
              style={{
                borderColor: on ? "var(--accent)" : "rgba(255,255,255,0.14)",
                background: on ? "rgba(122,249,255,0.12)" : "transparent",
                fontSize: "0.74rem",
              }}
            >
              {c.icon} {c.title} <span style={{ opacity: 0.6 }}>{p.discovered}/{p.total}</span>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: "0.76rem", opacity: 0.65, margin: "0 0 0.8rem 0" }}>
        {searching
          ? `${shown.length} ${shown.length === 1 ? "entry" : "entries"} matching “${query.trim()}”`
          : recentView
            ? "Everything you've discovered, newest first."
            : CODEX_CATEGORIES.find((c) => c.id === tab)?.blurb}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {shown.map((e) => (
          <CodexRow
            key={e.id}
            entry={e}
            onFocus={onFocus}
            onNavigate={onNavigate}
            isNew={e.discovered && !seenRef.current.has(e.id)}
            seenAt={seenAt[e.id]}
          />
        ))}
        {shown.length === 0 && (
          <li style={{ fontSize: "0.8rem", opacity: 0.65 }}>
            {searching
              ? "Nothing in the atlas matches that yet."
              : recentView
                ? "Nothing discovered yet — your first discovery will appear here."
                : tab === "fieldnotes" && notesError
                  ? "Field notes failed to load — use Retry above."
                  : "Nothing charted here yet."}
          </li>
        )}
      </ul>
    </div>
  );
}

function CodexRow({
  entry: e,
  onFocus,
  onNavigate,
  isNew,
  seenAt,
}: {
  entry: CodexEntry;
  onFocus: (id: number) => void;
  onNavigate?: (tab: string) => void;
  isNew: boolean;
  seenAt?: string;
}) {
  const locked = !e.discovered;
  // IM-92 (Codex half): detail drill-in — the collapsed card is a summary;
  // expanding shows the category, level fraction and charting/discovery date.
  const [open, setOpen] = useState(false);
  const category = CODEX_CATEGORIES.find((c) => c.id === e.category);
  return (
    <li
      className={`codex-row ${locked ? "locked" : "discovered"}`}
      style={{
        border: "1px solid " + (locked ? "rgba(255,255,255,0.06)" : "rgba(122,200,255,0.2)"),
        borderRadius: 10,
        padding: "0.7rem 0.8rem",
        background: locked ? "rgba(255,255,255,0.015)" : "rgba(122,249,255,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span className="codex-ic" style={{ fontSize: "1.1rem" }}>{locked ? "🔒" : e.icon}</span>
        <button
          type="button"
          className="codex-title-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Hide details" : "See details"}
        >
          {locked ? "??? — undiscovered" : e.title} <span className="codex-caret">{open ? "▾" : "▸"}</span>
        </button>
        {isNew && !locked && (
          <span style={{ fontSize: "0.6rem", fontWeight: 700, background: "#ff7af9", color: "#fff", padding: "1px 5px", borderRadius: 4 }}>NEW</span>
        )}
        {e.focusId != null && !locked && (
          <button className="mini" style={{ padding: "0.1rem 0.4rem", fontSize: "0.7rem" }} onClick={() => onFocus(e.focusId!)} title="Fly to it">
            ✦
          </button>
        )}
      </div>
      <p style={{ fontSize: "0.78rem", opacity: 0.85, margin: "0.4rem 0 0.35rem 0", lineHeight: 1.4 }}>
        {locked ? e.lockedHint : e.lore}
      </p>
      {/* IM-95: a locked entry whose unlock lives in another tab gets a button
          that GOES there, not just prose naming that tab's vocabulary. */}
      {locked && e.goTo && onNavigate && (
        <button className="mini codex-goto" onClick={() => onNavigate(e.goTo!.tab)}>
          {e.goTo.label}
        </button>
      )}
      {/* IM-91: field notes render their charting date — Soumaya's charting
          has a chronology again. */}
      {!locked && e.createdAt && (
        <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>Charted {formatDay(e.createdAt)}</div>
      )}
      {!locked && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {e.maxLevel > 1 && (
            <span style={{ display: "flex", gap: 2 }} title={`Level ${e.level} of ${e.maxLevel}`}>
              {Array.from({ length: e.maxLevel }).map((_, i) => (
                <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: i < e.level ? "#7af9ff" : "rgba(255,255,255,0.15)" }} />
              ))}
            </span>
          )}
          <span style={{ fontSize: "0.7rem", opacity: 0.65 }}>{e.levelLabel}</span>
          {e.progressToNext && (
            <span style={{ fontSize: "0.68rem", opacity: 0.5, marginLeft: "auto" }}>
              {e.progressToNext.cur}/{e.progressToNext.target} to next
            </span>
          )}
        </div>
      )}
      {open && (
        <div className="codex-detail">
          <span>
            {category?.icon} {category?.title}
            {!locked && e.maxLevel > 1 ? ` · Level ${e.level} of ${e.maxLevel}` : ""}
            {!locked && e.progressToNext ? ` · ${e.progressToNext.cur}/${e.progressToNext.target} toward the next level` : ""}
          </span>
          {!locked && seenAt && <span> · Discovered {formatDay(seenAt)}</span>}
          {locked && <span> · Locked — {e.lockedHint}</span>}
        </div>
      )}
    </li>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
