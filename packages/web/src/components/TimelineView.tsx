import { useEffect, useRef, useState } from "react";
import type { GraphNode, TimelineChapter, ChapterTrend } from "@brain/shared";
import { getTimeline, addTimelineChapter, deleteTimelineChapter, listAttachments, attachmentObjectUrl } from "../api/client.js";

/**
 * The Chronicle — a chronological vertical timeline of your life. Chapters (written
 * by Soumaya on real change, or added by you) are listed oldest-to-newest, spaced by
 * how much real time actually passed between them (compressed so a long quiet spell
 * doesn't turn into a mile of empty scroll). See docs/TIMELINE_DESIGN.md.
 */

const TREND_COLOR: Record<ChapterTrend, string> = {
  growth: "#46f58c",
  decline: "#9686ff",
  mixed: "#ffcd46",
  neutral: "#cfe3ff",
};
const TREND_LABEL: Record<ChapterTrend, string> = {
  growth: "▲ growth",
  decline: "▼ heavier",
  mixed: "◆ mixed",
  neutral: "● steady",
};

interface Props {
  spaceName: string;
  nodes: GraphNode[];
  onClose: () => void;
  onFocus?: (id: number) => void;
}

/** Normalize a naive SQLite timestamp ("YYYY-MM-DD HH:MM:SS", no zone) to UTC before
 *  parsing — the server (analysis/timeline.ts) already does this internally; without
 *  it here too, `new Date(...)` parses the same string as LOCAL time and a chapter's
 *  displayed date can be off by a day depending on the viewer's timezone. Same
 *  pattern already used for `remindAt`/`expiresAt` elsewhere in the app. */
export function normalizeDate(raw: string): Date {
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  return new Date(iso);
}

/** Whole days between two (possibly naive) timestamps, oldest → newest. Never negative,
 *  never NaN — an out-of-order or malformed pair just reads as "no time apart" rather
 *  than corrupting the layout that's built from it. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = normalizeDate(fromIso).getTime();
  const to = normalizeDate(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / 86_400_000);
}

const MIN_GAP = 28; // px — floor, so even same-day chapters read as visually distinct rows
const MAX_GAP = 220; // px — ceiling, so a multi-year silence doesn't become a mile of scroll
const GAP_PER_SQRT_DAY = 6;

/** The vertical space between two consecutive chapters, compressed (sqrt, not linear) so
 *  "close together in time" reads as visually closer than "far apart" without the layout
 *  blowing up over a long gap. Deterministic and monotonic — verified by test, not by eye
 *  (this is exactly the kind of layout math this repo's own workflow says to measure, not
 *  assume, per the orbit-LOD precedent in graph/orbits.ts). */
export function gapFor(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return MIN_GAP;
  return Math.min(MAX_GAP, MIN_GAP + Math.sqrt(days) * GAP_PER_SQRT_DAY);
}

type Row =
  | { type: "header"; key: string; label: string; gapBefore: number }
  | { type: "chapter"; key: string; chapter: TimelineChapter; index: number; gapBefore: number };

/** Chapters (already oldest-first from the server) → a flat list of month/year header rows
 *  and chapter rows, each carrying the real gap that should sit above it. Pure + exported
 *  so the "does this actually behave like a timeline now" question has a testable answer. */
export function buildRows(chapters: TimelineChapter[]): Row[] {
  const rows: Row[] = [];
  let prevMonthKey: number | null = null;
  let prevPeriodEnd: string | null = null;
  chapters.forEach((ch, index) => {
    const d = normalizeDate(ch.periodEnd);
    // Month bucketing must use UTC, like normalizeDate itself: local getters
    // shift a UTC-midnight periodEnd into the previous month for UTC-negative
    // viewers, so a new month's chapter lands under the old month's header
    // (or gets no header at all).
    const monthKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const gap = prevPeriodEnd ? gapFor(daysBetween(prevPeriodEnd, ch.periodEnd)) : 0;
    if (monthKey !== prevMonthKey) {
      const label = d.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
      rows.push({ type: "header", key: `h-${monthKey}`, label, gapBefore: prevMonthKey === null ? 0 : gap });
      rows.push({ type: "chapter", key: String(ch.id), chapter: ch, index, gapBefore: MIN_GAP });
    } else {
      rows.push({ type: "chapter", key: String(ch.id), chapter: ch, index, gapBefore: gap });
    }
    prevMonthKey = monthKey;
    prevPeriodEnd = ch.periodEnd;
  });
  return rows;
}

export function TimelineView({ spaceName, nodes, onClose, onFocus }: Props) {
  const [chapters, setChapters] = useState<TimelineChapter[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [images, setImages] = useState<Record<number, string>>({});
  // Photo ids currently held in `images` for whichever chapter is open — lets a
  // chapter switch revoke the PREVIOUS chapter's blob URLs instead of only doing so
  // on unmount (they'd otherwise accumulate for the whole session).
  const loadedPhotoIdsRef = useRef<number[]>([]);

  const labelOf = (id: number) => nodes.find((n) => n.id === id)?.label ?? `Memory #${id}`;

  const loadChapters = () => {
    setLoadError(false);
    void getTimeline()
      .then(setChapters)
      .catch(() => setLoadError(true));
  };

  useEffect(() => {
    loadChapters();
  }, []);

  const reload = async () => {
    setChapters(await getTimeline());
  };
  const addNow = async () => {
    setAdding(true);
    const ch = await addTimelineChapter();
    const fresh = await getTimeline();
    setChapters(fresh);
    setAdding(false);
    if (ch) {
      const idx = fresh.findIndex((c) => c.id === ch.id);
      if (idx >= 0) setSelected(idx);
    }
  };
  const removeChapter = async (id: number) => {
    await deleteTimelineChapter(id);
    setSelected(null);
    await reload();
  };

  // Load photo thumbnails for the selected chapter (lazy — only what's on screen).
  useEffect(() => {
    // Revoke whatever the PREVIOUS chapter (or a since-closed card) was holding —
    // ids that also belong to the newly-selected chapter are left alone, everything
    // else is freed instead of living until the whole view unmounts.
    const nowOpen = selected != null && selected >= 0 && chapters ? chapters[selected] : null;
    const keep = new Set(nowOpen?.photoIds ?? []);
    const stale = loadedPhotoIdsRef.current.filter((id) => !keep.has(id));
    if (stale.length > 0) {
      setImages((m) => {
        const next = { ...m };
        for (const id of stale) {
          if (next[id]) URL.revokeObjectURL(next[id]);
          delete next[id];
        }
        return next;
      });
    }
    if (!nowOpen) {
      loadedPhotoIdsRef.current = [];
      return;
    }
    loadedPhotoIdsRef.current = nowOpen.photoIds;
    let cancelled = false;
    const toFetch = nowOpen.photoIds.filter((id) => !images[id]);
    void Promise.all(
      toFetch.map(async (id) => {
        const atts = await listAttachments(id);
        const img = atts.find((a) => a.mime.startsWith("image/"));
        if (!img) return;
        const url = await attachmentObjectUrl(img);
        if (url && !cancelled) setImages((m) => ({ ...m, [id]: url }));
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, chapters]);

  // Revoke object URLs on unmount. Goes through a ref (kept in sync below) rather than
  // closing over `images` directly — an effect with `[]` deps only ever sees the render
  // it was defined on, so its cleanup was permanently closing over the INITIAL empty
  // `images` object and revoking nothing, no matter how many blob URLs had accumulated
  // by the time the component actually unmounted.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => Object.values(imagesRef.current).forEach((u) => URL.revokeObjectURL(u)), []);

  const sel = selected != null && selected >= 0 && chapters ? chapters[selected] : null;
  const rows = chapters && chapters.length > 0 ? buildRows(chapters) : [];

  return (
    <div className="timeline-overlay">
      <div className="timeline-head">
        <div className="timeline-title">
          <span className="tl-glyph">🌌</span> {spaceName}'s Chronicle
          <span className="tl-sub">your story, in order</span>
        </div>
        <div className="timeline-actions">
          <button className="tl-add" onClick={() => void addNow()} disabled={adding}>
            {adding ? "…" : "✍️ Mark this moment"}
          </button>
          <button className="tl-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="tl-track" role="list" aria-label="Life chapters, chronological">
          {rows.map((row) =>
            row.type === "header" ? (
              <div key={row.key} className="tl-group-header" style={{ marginTop: row.gapBefore }}>
                {row.label}
              </div>
            ) : (
              <button
                key={row.key}
                role="listitem"
                className={`tl-node-row${selected === row.index ? " active" : ""}`}
                style={{ marginTop: row.gapBefore, borderColor: TREND_COLOR[row.chapter.trend] }}
                onClick={() => setSelected(row.index)}
              >
                <span className="tl-node-dot" style={{ background: TREND_COLOR[row.chapter.trend] }} aria-hidden="true" />
                <span className="tl-node-body">
                  <span className="tl-node-title">{row.chapter.title}</span>
                  <span className="tl-node-when">
                    {normalizeDate(row.chapter.periodStart).toLocaleDateString(undefined, { timeZone: "UTC" })} – {normalizeDate(row.chapter.periodEnd).toLocaleDateString(undefined, { timeZone: "UTC" })}
                  </span>
                  {row.chapter.summary && <span className="tl-node-summary">{row.chapter.summary}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}

      {chapters && chapters.length === 0 && (
        <div className="timeline-empty">
          <p>Your chronicle begins as you live.</p>
          <p className="tl-empty-sub">
            Soumaya writes a chapter when enough truly changes — growth, a hard season, a turning point.
            You can mark one yourself anytime.
          </p>
          <button className="tl-add" onClick={() => void addNow()} disabled={adding}>✍️ Write my first chapter</button>
        </div>
      )}
      {chapters === null && loadError && (
        <div className="timeline-empty">
          <p>Couldn't load your timeline.</p>
          <button className="tl-add" onClick={loadChapters}>↻ Try again</button>
        </div>
      )}
      {chapters === null && !loadError && <div className="timeline-empty"><p>Unspooling your timeline…</p></div>}

      {sel && (
        <div className="timeline-card" style={{ borderColor: TREND_COLOR[sel.trend] }}>
          <button className="tl-card-x" onClick={() => setSelected(null)} aria-label="Close">×</button>
          <div className="tl-card-trend" style={{ color: TREND_COLOR[sel.trend] }}>{TREND_LABEL[sel.trend]}</div>
          <h3>{sel.title}</h3>
          <div className="tl-card-when">
            {normalizeDate(sel.periodStart).toLocaleDateString(undefined, { timeZone: "UTC" })} → {normalizeDate(sel.periodEnd).toLocaleDateString(undefined, { timeZone: "UTC" })}
            {sel.origin === "user" && <span className="tl-origin"> · you marked this</span>}
          </div>
          <p className="tl-card-summary">{sel.summary}</p>
          {sel.threads.length > 0 && (
            <div className="tl-threads">
              {sel.threads.map((th) => (
                <span key={th.name} className="tl-thread" style={{ borderColor: TREND_COLOR[th.trend] }}>
                  {th.name} <span style={{ color: TREND_COLOR[th.trend] }}>{TREND_LABEL[th.trend].split(" ")[0]}</span>
                </span>
              ))}
            </div>
          )}
          {sel.photoIds.length > 0 && (
            <div className="tl-photos">
              {sel.photoIds.map((id) =>
                images[id] ? (
                  <img key={id} src={images[id]} alt={labelOf(id)} title={labelOf(id)} onClick={() => onFocus?.(id)} />
                ) : (
                  <span key={id} className="tl-photo-load">📷</span>
                ),
              )}
            </div>
          )}
          {sel.memoryIds.length > 0 && (
            <div className="tl-mems">
              <div className="tl-mems-label">Memories from this chapter</div>
              {sel.memoryIds.map((id) => (
                <button key={id} className="tl-mem" onClick={() => onFocus?.(id)} title="Find it in the galaxy">
                  {labelOf(id)}
                </button>
              ))}
            </div>
          )}
          <button className="tl-del" onClick={() => void removeChapter(sel.id)}>Delete chapter</button>
        </div>
      )}
    </div>
  );
}
