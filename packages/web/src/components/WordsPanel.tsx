import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  getWordsOverview,
  listWordSources,
  getWordSource,
  searchWords,
  createSourceForgetRequest,
  type WordsChannel,
  type WordSourceSummary,
  type WordSourceDetail,
  type WordsOverview,
  type WordsSearchResponse,
} from "../api/words.js";
import { FlagsReviewSection } from "./FlagsReviewSection.js";
import { formatLocalDate } from "./TimelineView.js";
import { pushToast } from "./Toasts.js";

/**
 * Your Words — the panel face of the Verbatim-Recall system (design
 * `WORDS-PANEL-DESIGN-2026-10-31.md`). Everything this panel shows as
 * the owner's words comes from the server's current reading of a
 * preserved source (corrections applied) — never from node content;
 * derived memories appear as labels only ("What Soumaya made from
 * this"). Search mirrors the `search_my_words` tool's honesty: when
 * the search runs degraded (exact-match only), the panel says so.
 *
 * Sections: Home (archive at a glance) · Browse (the stream, by
 * channel) · Search (excerpts with receipts) · Flagged (the forget-
 * flag review, moved out of Settings per the owner's 2026-10-31
 * settlement). The Forget action in the Source view creates a request
 * through the EXISTING act (POST /api/sources/:id/forget-request) —
 * approval and apply stay on their existing routes; this panel never
 * erases anything itself.
 */

const CHANNEL_LABELS: Record<WordsChannel, string> = {
  typed: "Typed",
  telegram: "Telegram",
  chat: "Chat",
  imported: "Imported",
};

const CHANNELS: readonly WordsChannel[] = ["typed", "telegram", "chat", "imported"];

/** Plain-language citation-class labels — the same words the
 *  search_my_words tool uses (design §2). */
const CITATION_CLASS_LABELS: Record<string, string> = {
  verbatim_typed: "your typed words",
  transcript_machine: "machine transcript",
  transcript_corrected: "transcript you corrected",
  transcript_unverifiable: "transcript that couldn't be verified",
  imported_text: "imported text",
};

function citationClassLabel(cls: string): string {
  return CITATION_CLASS_LABELS[cls] ?? cls;
}

const PAGE_SIZE = 25;
const CONFLICT_OPEN = "⟦conflict⟧";
const CONFLICT_CLOSE = "⟦/conflict⟧";

/** Render a current reading with corrected spans marked. The reading
 *  model wraps conflicted correction text in ⟦conflict⟧…⟦/conflict⟧
 *  markers (server sources.repo) — those spans render as <mark> and
 *  the markers never reach the screen. A correction's replacement
 *  text is also marked where it appears. The corrections list under
 *  the reading is the precise record; this is the visual cue. */
function renderReading(reading: string, correctedTexts: string[]): ReactNode {
  const parts = reading.split(CONFLICT_OPEN);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i === 0) {
      out.push(<span key={`p${i}`}>{markCorrections(part, correctedTexts, `p${i}`)}</span>);
      return;
    }
    const closeAt = part.indexOf(CONFLICT_CLOSE);
    const conflicted = closeAt >= 0 ? part.slice(0, closeAt) : part;
    const rest = closeAt >= 0 ? part.slice(closeAt + CONFLICT_CLOSE.length) : "";
    out.push(
      <mark key={`c${i}`} title="Corrected text — see the corrections list below">
        {conflicted}
      </mark>,
    );
    if (rest) out.push(<span key={`r${i}`}>{markCorrections(rest, correctedTexts, `r${i}`)}</span>);
  });
  return out;
}

function markCorrections(text: string, correctedTexts: string[], keyPrefix: string): ReactNode {
  const needles = correctedTexts.filter((t) => t.length > 0);
  if (needles.length === 0 || !text) return text;
  let segments: ReactNode[] = [text];
  for (const needle of needles) {
    const next: ReactNode[] = [];
    for (const seg of segments) {
      if (typeof seg !== "string") {
        next.push(seg);
        continue;
      }
      const pieces = seg.split(needle);
      pieces.forEach((piece, j) => {
        if (j > 0) {
          next.push(
            <mark key={`${keyPrefix}-${needle}-${j}`} title="Corrected text — see the corrections list below">
              {needle}
            </mark>,
          );
        }
        if (piece) next.push(piece);
      });
    }
    segments = next;
  }
  return segments;
}

type Section = "home" | "browse" | "search" | "flagged";

export function WordsPanel({ onClose }: { onClose?: () => void }) {
  const [section, setSection] = useState<Section>("home");
  const [sourceId, setSourceId] = useState<number | null>(null);

  const openSource = (id: number) => setSourceId(id);
  const goSection = (s: Section) => {
    setSourceId(null);
    setSection(s);
  };

  return (
    <div className="dock-body words-panel">
      <div className="dock-head">
        <h3>🗣️ Your Words</h3>
        {onClose && (
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      <p className="settings-note" style={{ fontSize: "12px", opacity: 0.75, margin: "0 0 10px" }}>
        Your exact words, stored as you said them. Nothing here is used to train anything.
      </p>
      <div className="subtabs" role="tablist" aria-label="Your Words sections">
        <button className={section === "home" && sourceId === null ? "on" : ""} onClick={() => goSection("home")}>
          🏠 Home
        </button>
        <button className={section === "browse" ? "on" : ""} onClick={() => goSection("browse")}>
          📚 Browse
        </button>
        <button className={section === "search" ? "on" : ""} onClick={() => goSection("search")}>
          🔎 Search
        </button>
        <button className={section === "flagged" ? "on" : ""} onClick={() => goSection("flagged")}>
          🧹 Flagged
        </button>
      </div>

      {sourceId !== null ? (
        <SourceView sourceId={sourceId} onBack={() => setSourceId(null)} />
      ) : section === "home" ? (
        <WordsHome onOpenSource={openSource} onOpenFlagged={() => goSection("flagged")} />
      ) : section === "browse" ? (
        <WordsBrowse onOpenSource={openSource} />
      ) : section === "search" ? (
        <WordsSearch onOpenSource={openSource} />
      ) : (
        <FlagsReviewSection />
      )}
    </div>
  );
}

function SourceRow({ s, onOpen }: { s: WordSourceSummary; onOpen: (id: number) => void }) {
  return (
    <button
      className="words-source-row"
      onClick={() => onOpen(s.id)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "1px solid #444",
        borderRadius: "6px",
        padding: "10px",
        marginBottom: "8px",
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{s.preview.trim() ? s.preview : "(no text)"}</div>
      <div className="settings-note" style={{ fontSize: "12px", opacity: 0.65, marginTop: "4px" }}>
        {CHANNEL_LABELS[s.channel]} · {formatLocalDate(s.createdAt)} · {citationClassLabel(s.citationClass)} · {s.wordCount}{" "}
        {s.wordCount === 1 ? "word" : "words"}
      </div>
    </button>
  );
}

function WordsHome({
  onOpenSource,
  onOpenFlagged,
}: {
  onOpenSource: (id: number) => void;
  onOpenFlagged: () => void;
}) {
  const [overview, setOverview] = useState<WordsOverview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getWordsOverview()
      .catch(() => null)
      .then((o) => {
        if (cancelled) return;
        if (o) setOverview(o);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Loading your archive…</p>;
  }
  if (!overview) {
    return (
      <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
        Couldn&apos;t reach the server — your archive isn&apos;t available right now.
      </p>
    );
  }
  if (overview.total === 0) {
    return (
      <p className="settings-note" style={{ fontSize: "13px", opacity: 0.8 }}>
        Your words will gather here — everything you type, say, or send Soumaya is preserved exactly as you
        said it, starting with your next capture.
      </p>
    );
  }
  return (
    <div>
      <p style={{ fontSize: "13px", margin: "4px 0 8px" }}>
        <strong>
          {overview.total} {overview.total === 1 ? "capture" : "captures"} preserved
        </strong>
      </p>
      <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap", marginBottom: "12px" }}>
        {CHANNELS.map((c) => (
          <span key={c} className="words-channel-count" style={{ fontSize: "12px", opacity: 0.85 }}>
            {CHANNEL_LABELS[c]}: {overview.byChannel[c]}
          </span>
        ))}
      </div>
      {overview.openFlags > 0 && (
        <div className="row" style={{ marginBottom: "12px" }}>
          <button className="mini" onClick={onOpenFlagged}>
            🧹 {overview.openFlags} flagged for review →
          </button>
        </div>
      )}
      <h4 style={{ margin: "8px 0" }}>Most recent</h4>
      {overview.recent.map((s) => (
        <SourceRow key={s.id} s={s} onOpen={onOpenSource} />
      ))}
    </div>
  );
}

function WordsBrowse({ onOpenSource }: { onOpenSource: (id: number) => void }) {
  const [channel, setChannel] = useState<WordsChannel | null>(null);
  const [sources, setSources] = useState<WordSourceSummary[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped by the channel effect on every (re)load; loadMore captures
  // it so a page fetched for a list that has since been reset (channel
  // switch) can be dropped instead of landing on the new list (H1).
  const listGen = useRef(0);

  useEffect(() => {
    listGen.current += 1;
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    setSources(null);
    void listWordSources({ channel: channel ?? undefined, limit: PAGE_SIZE })
      .catch(() => null)
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setSources(res.sources);
          setHasMore(res.sources.length === PAGE_SIZE);
        } else {
          setFailed(true);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  const loadMore = async () => {
    if (!sources || sources.length === 0) return;
    const gen = listGen.current;
    const base = sources;
    setLoadingMore(true);
    try {
      const res = await listWordSources({
        channel: channel ?? undefined,
        limit: PAGE_SIZE,
        before: base[base.length - 1]!.id,
      }).catch(() => null);
      // The list was reset while this page was in flight (the channel
      // changed): the effect's own fetch owns the screen now — drop
      // the stale page, rows and hasMore alike (pitfall hunt H1).
      if (listGen.current !== gen) return;
      if (res) {
        setSources([...base, ...res.sources]);
        setHasMore(res.sources.length === PAGE_SIZE);
      } else {
        pushToast("Couldn't load more — try again.", "⚠️", 4000);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ gap: "8px", display: "flex", flexWrap: "wrap", marginBottom: "10px" }}>
        <button className={channel === null ? "on" : ""} onClick={() => setChannel(null)}>
          All
        </button>
        {CHANNELS.map((c) => (
          <button key={c} className={channel === c ? "on" : ""} onClick={() => setChannel(c)}>
            {CHANNEL_LABELS[c]}
          </button>
        ))}
      </div>
      {!loaded ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Loading…</p>
      ) : failed ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
          Couldn&apos;t reach the server — the stream isn&apos;t available right now.
        </p>
      ) : !sources || sources.length === 0 ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
          Nothing here yet — words you capture will appear in this stream.
        </p>
      ) : (
        <>
          {sources.map((s) => (
            <SourceRow key={s.id} s={s} onOpen={onOpenSource} />
          ))}
          {hasMore && (
            <button className="mini" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function WordsSearch({ onOpenSource }: { onOpenSource: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<WordsSearchResponse | null>(null);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await searchWords({
        q: query,
        from: from || undefined,
        to: to || undefined,
      }).catch(() => null);
      if (res) {
        setResult(res);
      } else {
        setFailed(true);
      }
      setSearched(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="row" style={{ gap: "8px", display: "flex", marginBottom: "8px" }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your exact words…"
            aria-label="Search your words"
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy || !q.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="row" style={{ gap: "8px", display: "flex", marginBottom: "10px", fontSize: "12px" }}>
          <label>
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </label>
          <label>
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
        </div>
      </form>
      {failed ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
          Couldn&apos;t reach the server — search isn&apos;t available right now.
        </p>
      ) : searched && result ? (
        <>
          {result.degraded && (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 8px" }}>
              Search is in exact-match mode right now — it finds the words themselves, not the meaning.
            </p>
          )}
          {result.results.length === 0 ? (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
              No matches in your preserved words.
            </p>
          ) : (
            result.results.map((hit) => (
              <button
                key={hit.chunkId}
                className="words-search-hit"
                onClick={() => onOpenSource(hit.sourceId)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  padding: "10px",
                  marginBottom: "8px",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{hit.excerpt}</div>
                <div className="settings-note" style={{ fontSize: "12px", opacity: 0.65, marginTop: "4px" }}>
                  {CHANNEL_LABELS[hit.channel]} · {formatLocalDate(hit.createdAt)} · {citationClassLabel(hit.citationClass)}
                </div>
              </button>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}

function SourceView({ sourceId, onBack }: { sourceId: number; onBack: () => void }) {
  const [detail, setDetail] = useState<WordSourceDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [forgetStage, setForgetStage] = useState<"idle" | "confirm" | "done">("idle");
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetNote, setForgetNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setDetail(null);
    void getWordSource(sourceId)
      .catch(() => null)
      .then((d) => {
        if (cancelled) return;
        if (d) setDetail(d);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const onForget = async () => {
    setForgetBusy(true);
    try {
      const res = await createSourceForgetRequest(sourceId).catch(() => null);
      if (res && res.requestId !== undefined) {
        setForgetStage("done");
        setForgetNote(
          "Forget request created. Nothing is erased yet — forgetting finishes through the usual approval steps.",
        );
      } else if (res && res.message) {
        setForgetNote(res.message);
      } else {
        setForgetNote("Couldn't create the forget request — try again.");
      }
    } finally {
      setForgetBusy(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: "10px" }}>
        <button className="mini" onClick={onBack}>
          ← Back
        </button>
      </div>
      {!loaded ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>Loading…</p>
      ) : !detail ? (
        <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6 }}>
          Couldn&apos;t reach this capture — it may have been forgotten, or the server is unavailable.
        </p>
      ) : (
        <>
          <div
            className="words-reading"
            style={{
              fontSize: "13px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              border: "1px solid #444",
              borderRadius: "6px",
              padding: "10px",
              marginBottom: "10px",
            }}
          >
            {detail.reading === null
              ? "(This capture has no text — it was preserved as binary data.)"
              : detail.reading.trim() === ""
                ? "(This capture is empty — no words were recorded in it.)"
                : renderReading(detail.reading, detail.corrections.map((c) => c.correctedText))}
          </div>
          <p className="settings-note" style={{ fontSize: "12px", opacity: 0.7, margin: "0 0 10px" }}>
            Captured via {CHANNEL_LABELS[detail.source.capturedVia]} · {detail.source.kind} ·{" "}
            {formatLocalDate(detail.source.createdAt)} · {citationClassLabel(detail.source.citationClass)}
          </p>

          {detail.corrections.length > 0 && (
            <>
              <h4 style={{ margin: "8px 0" }}>Corrections</h4>
              {detail.corrections.map((c, i) => (
                <p key={i} className="settings-note" style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 4px" }}>
                  Characters {c.startOffset}–{c.endOffset} now read “{c.correctedText}” · {formatLocalDate(c.createdAt)}
                </p>
              ))}
            </>
          )}

          <h4 style={{ margin: "12px 0 8px" }}>What Soumaya made from this</h4>
          {detail.derivedNodes.length === 0 ? (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.6, margin: "0 0 10px" }}>
              Nothing yet — no memories carry this capture as their source.
            </p>
          ) : (
            <ul style={{ margin: "0 0 10px", paddingLeft: "18px", fontSize: "13px" }}>
              {detail.derivedNodes.map((n) => (
                <li key={n.nodeId}>{n.label}</li>
              ))}
            </ul>
          )}

          <h4 style={{ margin: "12px 0 8px" }}>Forget</h4>
          {forgetStage === "done" ? (
            <p className="settings-note" style={{ fontSize: "12px", opacity: 0.8 }}>{forgetNote}</p>
          ) : forgetStage === "confirm" ? (
            <>
              <p className="settings-note" style={{ fontSize: "12px", opacity: 0.8, margin: "0 0 8px" }}>
                This starts a forget request for this capture. Nothing is erased by this panel — the request
                still goes through the usual approval steps.
              </p>
              <div className="row" style={{ gap: "8px", display: "flex" }}>
                <button className="mini" disabled={forgetBusy} onClick={() => void onForget()}>
                  Create forget request
                </button>
                <button className="mini" disabled={forgetBusy} onClick={() => setForgetStage("idle")}>
                  Keep it
                </button>
              </div>
              {forgetNote && (
                <p className="settings-note" style={{ fontSize: "12px", opacity: 0.8, marginTop: "8px" }}>{forgetNote}</p>
              )}
            </>
          ) : (
            <button className="mini" onClick={() => setForgetStage("confirm")}>
              Forget these words…
            </button>
          )}
        </>
      )}
    </div>
  );
}
