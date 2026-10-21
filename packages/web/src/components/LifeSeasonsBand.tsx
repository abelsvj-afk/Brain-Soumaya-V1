import type { ChapterTrend, JourneySpan, LifeSeason } from "@brain/shared";

/** Same tolerant UTC parse as TimelineView.normalizeDate (naive SQLite
 *  timestamps are UTC), duplicated in miniature to keep this component
 *  import-cycle-free with TimelineView (which imports this component). */
function normalizeMs(raw: string): number {
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  return new Date(iso).getTime();
}

/**
 * Life Seasons band (IM-132, docs/specs/timeline-life-seasons.md) — a
 * component-local addition to the Timeline surface: auto-detected identity
 * eras render as background bands on a REAL time axis, with Journey spans
 * drawn as bars in front of them. Positions are proportional to elapsed
 * time (linear over the axis domain), verified by the pure layout tests —
 * measured, not eyeballed.
 *
 * Boundary semantics: season/span dates arrive from the server as fixed
 * UTC calendar dates (startDate/endDate, YYYY-MM-DD); the axis positions
 * them at UTC midnight of that date, so the layout is identical in every
 * viewer timezone (never re-derived from a local-time parse).
 */

const TREND_COLOR: Record<ChapterTrend, string> = {
  growth: "#46f58c",
  decline: "#9686ff",
  mixed: "#ffcd46",
  neutral: "#cfe3ff",
};

export interface AxisBand { season: LifeSeason; leftPct: number; widthPct: number }
export interface AxisSpan { span: JourneySpan; leftPct: number; widthPct: number }
export interface SeasonAxis {
  domainStartMs: number;
  domainEndMs: number;
  bands: AxisBand[];
  spans: AxisSpan[];
}

const DAY_MS = 86_400_000;

/** UTC-midnight ms for a fixed YYYY-MM-DD calendar date; NaN when malformed. */
export function utcDayMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function instantMs(raw: string): number {
  const t = normalizeMs(raw);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Build the time axis: domain = earliest start → latest end across seasons
 * and spans (ongoing spans extend the domain to `nowMs`). A season's band
 * covers its start calendar day through the END of its end calendar day
 * (+1 day), so a multi-day era has a real width even on a long axis. Pure +
 * exported for measurement tests. Returns null when there is nothing dated
 * to plot (never NaN positions).
 */
export function buildSeasonAxis(seasons: LifeSeason[], spans: JourneySpan[], nowMs: number): SeasonAxis | null {
  const items: { startMs: number; endMs: number }[] = [];
  for (const s of seasons) {
    const a = utcDayMs(s.startDate);
    const b = utcDayMs(s.endDate);
    if (Number.isFinite(a) && Number.isFinite(b)) items.push({ startMs: a, endMs: b + DAY_MS });
  }
  for (const sp of spans) {
    const a = instantMs(sp.start);
    if (!Number.isFinite(a)) continue;
    const b = sp.end ? instantMs(sp.end) : nowMs;
    items.push({ startMs: a, endMs: Number.isFinite(b) && b > a ? b : a + DAY_MS });
  }
  if (items.length === 0) return null;
  const domainStartMs = Math.min(...items.map((i) => i.startMs));
  let domainEndMs = Math.max(...items.map((i) => i.endMs));
  if (!(domainEndMs > domainStartMs)) domainEndMs = domainStartMs + DAY_MS;
  const range = domainEndMs - domainStartMs;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - domainStartMs) / range) * 100));
  const width = (a: number, b: number) => Math.max(1.5, pct(b) - pct(a));

  const bands: AxisBand[] = [];
  for (const s of seasons) {
    const a = utcDayMs(s.startDate);
    const b = utcDayMs(s.endDate);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    bands.push({ season: s, leftPct: pct(a), widthPct: width(a, b + DAY_MS) });
  }
  const axisSpans: AxisSpan[] = [];
  for (const sp of spans) {
    const a = instantMs(sp.start);
    if (!Number.isFinite(a)) continue;
    const rawB = sp.end ? instantMs(sp.end) : nowMs;
    const b = Number.isFinite(rawB) && rawB > a ? rawB : a + DAY_MS;
    axisSpans.push({ span: sp, leftPct: pct(a), widthPct: width(a, b) });
  }
  return { domainStartMs, domainEndMs, bands, spans: axisSpans };
}

export function LifeSeasonsBand({ seasons, spans }: { seasons: LifeSeason[]; spans: JourneySpan[] }) {
  const axis = buildSeasonAxis(seasons, spans, Date.now());
  if (!axis || (axis.bands.length === 0 && axis.spans.length === 0)) return null;
  const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { timeZone: "UTC" });
  return (
    <section className="tl-seasons" aria-label="Life seasons and journey spans">
      <div className="tl-seasons-head">
        <span className="tl-seasons-title">Life Seasons</span>
        <span className="tl-seasons-range">
          {fmtDay(axis.domainStartMs)} – {fmtDay(axis.domainEndMs)}
        </span>
      </div>
      <div className="tl-seasons-axis">
        {axis.bands.map(({ season, leftPct, widthPct }) => (
          <div
            key={`season-${season.id}`}
            className="tl-season-band"
            data-testid="life-season-band"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: `${TREND_COLOR[season.trend]}2e`, borderColor: `${TREND_COLOR[season.trend]}66` }}
            title={`${season.label} · ${season.startDate} – ${season.endDate}`}
          >
            <span className="tl-season-label">{season.label}</span>
          </div>
        ))}
        {axis.spans.map(({ span, leftPct, widthPct }) => (
          <div key={`journey-${span.journey.id}`} className="tl-journey-lane">
            <div
              className="tl-journey-span"
              data-testid="journey-span"
              style={{ left: `${leftPct}%`, width: `${widthPct}%`, background: span.journey.color ?? "#7af9ff" }}
              title={`${span.journey.title} · ${span.startDate}${span.endDate ? ` – ${span.endDate}` : " – now"}`}
            >
              <span className="tl-journey-span-label">
                {span.journey.icon ? `${span.journey.icon} ` : ""}{span.journey.title}{span.ongoing ? " · ongoing" : ""}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
