import { useEffect, useRef, useState } from "react";
import type { GraphNode, LifeSeasonsTimeline, TimelineChapter, ChapterTrend } from "@brain/shared";
import {
  getTimeline,
  getLifeSeasons,
  addTimelineChapter,
  deleteTimelineChapter,
  listAttachments,
  attachmentObjectUrl,
  getUpcomingEventsResult,
  type UpcomingEvent,
} from "../api/client.js";
import { LifeSeasonsBand } from "./LifeSeasonsBand.js";
import { localDateOfStored } from "../utils/localDay.js";
import { pushToast } from "./Toasts.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

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

/** A stored chapter/event timestamp rendered as the calendar date the user
 *  actually lived it on — its day in the space's own timezone (owner rule,
 *  2026-10-21: no UTC in anything user-facing). The web's canonical helper
 *  (utils/localDay.ts) derives that day in this device's zone, which is the
 *  zone the space timezone is set from; the YYYY-MM-DD it returns is a fixed
 *  calendar date, so it is formatted from its own parts (a local-midnight
 *  Date) and can never shift a day under the viewer's zone. Returns "" for
 *  an unparseable value rather than printing "Invalid Date". */
export function formatLocalDate(raw: string): string {
  const day = localDateOfStored(raw, (r) => normalizeDate(r ?? "").getTime());
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined);
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

/** IM-121: a chapter's `score` is its blended change magnitude 0..1 — render
 *  it as the percentage of change the chapter represents. Clamped so a
 *  malformed score can never print nonsense like "140%". */
export function changeMagnitudePct(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

/** IM-122: does a chapter match the search box? Title, summary and theme. */
export function chapterMatches(ch: TimelineChapter, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ch.title.toLowerCase().includes(q) ||
    ch.summary.toLowerCase().includes(q) ||
    ch.theme.toLowerCase().includes(q)
  );
}

/** IM-137: "today" / "in 3d" / "overdue 2d" for a future event's day offset
 *  (same idiom the Mind panel uses for the same server field). */
export function eventWhenLabel(ev: UpcomingEvent): string {
  if (ev.inDays < 0) return `overdue ${-ev.inDays}d`;
  if (ev.inDays === 0) return "today";
  return `in ${ev.inDays}d`;
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
    // Month bucketing follows the SPACE-local calendar (owner rule,
    // 2026-10-21): a chapter groups under the month its periodEnd falls in
    // in the user's own timezone — the same local day formatLocalDate shows
    // on the card — never the UTC month of the stored instant.
    const localDay = localDateOfStored(ch.periodEnd, (r) => normalizeDate(r ?? "").getTime());
    const [ly, lm] = localDay ? localDay.split("-").map(Number) as [number, number, number] : [NaN, NaN, NaN];
    const monthKey = Number.isFinite(ly) && Number.isFinite(lm) ? ly! * 12 + (lm! - 1) : Number.NaN;
    const gap = prevPeriodEnd ? gapFor(daysBetween(prevPeriodEnd, ch.periodEnd)) : 0;
    if (monthKey !== prevMonthKey) {
      const label = Number.isFinite(monthKey)
        ? new Date(ly!, lm! - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })
        : "";
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
  const [seasonsData, setSeasonsData] = useState<LifeSeasonsTimeline | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [images, setImages] = useState<Record<number, string>>({});
  // IM-122: chapter search text.
  const [search, setSearch] = useState("");
  // IM-122: chapter awaiting delete confirmation (shared ConfirmDialog).
  const [confirmDelete, setConfirmDelete] = useState<TimelineChapter | null>(null);
  // IM-122: chapter ids whose photo fetch has SETTLED — a photo slot whose
  // fetch finished with no image is "no photo", not a forever-loading 📷.
  const [photosSettled, setPhotosSettled] = useState<ReadonlySet<number>>(new Set());
  // IM-137: the future-events overlay section (existing future_event kind).
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [eventsError, setEventsError] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // IM-122: auto-scroll to the latest chapter ONCE per open — a long-lived
  // brain used to open on its OLDEST chapter every time.
  const scrolledOnceRef = useRef(false);
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
    // Life Seasons + Journey spans (IM-132) — additive section; a failure here
    // leaves seasonsData null and never disturbs the chapters list.
    void getLifeSeasons().then(setSeasonsData).catch(() => setSeasonsData(null));
  }, []);

  // IM-137: load the future-events section (strict Result variant — a failed
  // fetch shows an honest note + retry, never a fake "nothing ahead").
  const loadEvents = () => {
    setEventsError(false);
    void getUpcomingEventsResult().then((r) => {
      if (r.ok) setEvents(r.events);
      else setEventsError(true);
    });
  };
  useEffect(() => {
    loadEvents();
  }, []);

  // IM-122: once chapters first arrive, land on the LATEST chapter (the
  // track is oldest→newest, so "now" is the bottom), not the oldest.
  useEffect(() => {
    if (!chapters || chapters.length === 0 || scrolledOnceRef.current) return;
    scrolledOnceRef.current = true;
    const el = trackRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chapters]);

  const jumpToLatest = () => {
    if (!chapters || chapters.length === 0) return;
    setSelected(chapters.length - 1);
    const el = trackRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

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
    } else {
      // IM-122: add failures were silent — the button just stopped spinning.
      pushToast("Couldn't mark this moment — nothing was saved. Try again in a moment.", "⚠️", 4500);
    }
  };
  const removeChapter = async (id: number) => {
    const ok = await deleteTimelineChapter(id);
    setConfirmDelete(null);
    if (!ok) {
      // IM-122: delete failures were silent AND the chapter quietly stayed.
      pushToast("Couldn't delete that chapter — it's still on your timeline.", "⚠️", 4500);
      return;
    }
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
    const chapterId = nowOpen.id;
    const toFetch = nowOpen.photoIds.filter((id) => !images[id]);
    void Promise.all(
      toFetch.map(async (id) => {
        const atts = await listAttachments(id);
        const img = atts.find((a) => a.mime.startsWith("image/"));
        if (!img) return;
        const url = await attachmentObjectUrl(img);
        if (url && !cancelled) setImages((m) => ({ ...m, [id]: url }));
      }),
    ).then(() => {
      // IM-122: the fetch SETTLED for this chapter — any photo slot still
      // without an image genuinely has no photo, and renders as such.
      if (!cancelled) {
        setPhotosSettled((prev) => (prev.has(chapterId) ? prev : new Set(prev).add(chapterId)));
      }
    });
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
  // IM-122: search filters the visible chapters; buildRows indexes the
  // FILTERED list, so row.index maps back through visibleIdx for selection.
  const visibleIdx = chapters
    ? chapters.map((c, i) => (chapterMatches(c, search) ? i : -1)).filter((i) => i >= 0)
    : [];
  const rows =
    chapters && visibleIdx.length > 0
      ? buildRows(visibleIdx.flatMap((i) => { const c = chapters[i]; return c ? [c] : []; }))
      : [];

  return (
    <div className="timeline-overlay">
      <div className="timeline-head">
        <div className="timeline-title">
          <span className="tl-glyph">🌌</span> {spaceName}'s Chronicle
          {/* Dates are grouped + shown in the space's own local timezone
              (owner rule, 2026-10-21 — supersedes IM-123's UTC labelling):
              the day on a card is the day the user lived it. */}
          <span className="tl-sub">your story, in order · dates in your local time</span>
        </div>
        <div className="timeline-actions">
          {/* IM-122: search across chapters (title / summary / theme). */}
          <input
            className="tl-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chapters…"
            aria-label="Search chapters"
          />
          {chapters && chapters.length > 0 && (
            <button className="tl-add" onClick={jumpToLatest}>
              ↓ Latest
            </button>
          )}
          <button className="tl-add" onClick={() => void addNow()} disabled={adding}>
            {adding ? "…" : "✍️ Mark this moment"}
          </button>
          <button className="tl-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      {seasonsData && (seasonsData.seasons.length > 0 || seasonsData.journeySpans.length > 0) && (
        <LifeSeasonsBand seasons={seasonsData.seasons} spans={seasonsData.journeySpans} />
      )}

      {rows.length > 0 && (
        <div className="tl-track" role="list" aria-label="Life chapters, chronological" ref={trackRef}>
          {rows.map((row) =>
            row.type === "header" ? (
              <div key={row.key} className="tl-group-header" style={{ marginTop: row.gapBefore }}>
                {row.label}
              </div>
            ) : (
              <button
                key={row.key}
                role="listitem"
                className={`tl-node-row${selected === visibleIdx[row.index] ? " active" : ""}`}
                style={{ marginTop: row.gapBefore, borderColor: TREND_COLOR[row.chapter.trend] }}
                onClick={() => setSelected(visibleIdx[row.index]!)}
              >
                <span className="tl-node-dot" style={{ background: TREND_COLOR[row.chapter.trend] }} aria-hidden="true" />
                <span className="tl-node-body">
                  <span className="tl-node-title">{row.chapter.title}</span>
                  <span className="tl-node-when">
                    {formatLocalDate(row.chapter.periodStart)} – {formatLocalDate(row.chapter.periodEnd)}
                  </span>
                  {row.chapter.summary && <span className="tl-node-summary">{row.chapter.summary}</span>}
                  {/* IM-121: the chapter's theme + change magnitude were
                      fetched and rendered NOWHERE. */}
                  {(row.chapter.theme || row.chapter.score > 0) && (
                    <span className="tl-node-meta">
                      {row.chapter.theme && <span className="tl-node-theme">✦ {row.chapter.theme}</span>}
                      {row.chapter.score > 0 && (
                        <span className="tl-node-score">change {changeMagnitudePct(row.chapter.score)}%</span>
                      )}
                    </span>
                  )}
                </span>
              </button>
            ),
          )}
        </div>
      )}

      {chapters && chapters.length > 0 && visibleIdx.length === 0 && (
        <div className="timeline-empty">
          <p>No chapters match “{search.trim()}”.</p>
          <button className="tl-add" onClick={() => setSearch("")}>Clear search</button>
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

      {/* IM-137 (future-events portion of Cognitive Layer Phase 7): the
          story so far runs oldest→newest above; this section is what's
          AHEAD — the existing `future_event` cognitive kind + their dates,
          soonest first (server order). Persona activation / imagination
          region / gravity wells are NOT built here — blocked on an owner
          question (Q2). */}
      {(eventsError || (events && events.length > 0)) && (
        <div className="tl-ahead">
          <div className="tl-ahead-head">🔭 Ahead — future events</div>
          {eventsError && (
            <div className="tl-ahead-error">
              <span>Couldn't load your future events.</span>
              <button className="tl-add" onClick={loadEvents}>↻ Try again</button>
            </div>
          )}
          {events && events.length > 0 && (
            <div className="tl-ahead-list">
              {events.map((ev) => (
                <button key={ev.id} className="tl-ahead-row" onClick={() => onFocus?.(ev.id)} title="Find it in the galaxy">
                  <span className="tl-ahead-label">{ev.label}</span>
                  <span className="tl-ahead-when">
                    {formatLocalDate(ev.date)} · {eventWhenLabel(ev)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {sel && (
        <div className="timeline-card" style={{ borderColor: TREND_COLOR[sel.trend] }}>
          <button className="tl-card-x" onClick={() => setSelected(null)} aria-label="Close">×</button>
          <div className="tl-card-trend" style={{ color: TREND_COLOR[sel.trend] }}>{TREND_LABEL[sel.trend]}</div>
          <h3>{sel.title}</h3>
          <div className="tl-card-when">
            {formatLocalDate(sel.periodStart)} → {formatLocalDate(sel.periodEnd)}
            {sel.origin === "user" && <span className="tl-origin"> · you marked this</span>}
          </div>
          {/* IM-121: theme + change magnitude, on the card as on the row. */}
          {(sel.theme || sel.score > 0) && (
            <div className="tl-card-meta">
              {sel.theme && <span>✦ {sel.theme}</span>}
              {sel.score > 0 && <span>change magnitude {changeMagnitudePct(sel.score)}%</span>}
            </div>
          )}
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
                ) : photosSettled.has(sel.id) ? (
                  // IM-122: the fetch settled and there IS no image — say so
                  // (and link the memory) instead of a 📷 chip that reads as
                  // forever-loading.
                  <button
                    key={id}
                    className="tl-photo-missing"
                    onClick={() => onFocus?.(id)}
                    title="This memory has no photo — open it in the galaxy"
                  >
                    🖼 no photo · {labelOf(id)}
                  </button>
                ) : (
                  <span key={id} className="tl-photo-load" aria-label="Loading photo">📷…</span>
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
          {/* IM-122: deletion goes through the shared ConfirmDialog — it
              used to fire instantly with no confirm and no feedback. */}
          <button className="tl-del" onClick={() => setConfirmDelete(sel)}>Delete chapter</button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this chapter?"
          message={`“${confirmDelete.title}” will be removed from your Chronicle. The memories themselves stay in your galaxy.`}
          confirmLabel="Delete chapter"
          onConfirm={() => void removeChapter(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
