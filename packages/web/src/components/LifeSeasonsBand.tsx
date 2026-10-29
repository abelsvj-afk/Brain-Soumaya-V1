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
 * SPACE-local calendar dates (startDate/endDate, YYYY-MM-DD — derived
 * server-side in the space's own timezone, per the owner's no-UTC rule).
 * The axis positions each such date at UTC midnight purely as a drawing
 * convention for a date-only value, so a fixed calendar date plots at the
 * same place in every viewer timezone (never re-derived from a local-time
 * parse, which could shift the day).
 */

const TREND_COLOR: Record<ChapterTrend, string> = {
  growth: "#46f58c",
  decline: "#9686ff",
  mixed: "#ffcd46",
  neutral: "#cfe3ff",
};

export interface AxisBand {
  season: LifeSeason;
  leftPct: number;
  widthPct: number;
  /** Lane index (0-based) from the lane-packing pass — bands whose rendered
   *  ranges overlap never share a lane (screenshot finding #4, 2026-10-21). */
  lane: number;
  /** Label-fit policy: true when the band is wide enough to carry its full
   *  label in-band; false sends the label to the legend row under the axis
   *  instead of clipping it mid-word. */
  labelInBand: boolean;
}
export interface AxisSpan { span: JourneySpan; leftPct: number; widthPct: number }
export interface SeasonAxis {
  domainStartMs: number;
  domainEndMs: number;
  /** CHR-10: the TRUE earliest start and latest end of what is plotted —
   *  un-padded season end dates and raw span ends. Band geometry padding
   *  (+1 day, so a multi-day era has real width) lives in the domain only
   *  and never reaches a displayed date; the header renders this range. */
  rangeStartMs: number;
  rangeEndMs: number;
  bands: AxisBand[];
  spans: AxisSpan[];
  /** Number of season lanes the packing needed (axis grows vertically). */
  laneCount: number;
  /** Bands whose labels live in the legend row (labelInBand === false). */
  legendBands: AxisBand[];
}

/** Vertical geometry of the axis (px): a season lane is a 30px band + 4px
 *  gap; journey lanes sit below the season block. Exported so the layout
 *  tests pin the same numbers the component renders with. */
export const SEASON_LANE_H = 34;
export const SEASON_BAND_H = 30;
export const JOURNEY_LANE_H = 18;
export const JOURNEY_LANE_GAP = 4;
export const JOURNEY_TOP_GAP = 6;

/** Label-fit estimate, in % of axis width: at the axis' typical rendered
 *  width (≤640px panel) one character of the 0.68rem band label costs
 *  roughly 1.2% of the axis, plus ~2% of horizontal padding. A band narrower
 *  than its label's estimate does NOT render the label in-band (it would be
 *  clipped mid-word — the "Fin… / Thei…" screenshot) — the label goes to
 *  the legend row under the axis instead. */
const LABEL_CHAR_PCT = 1.2;
const LABEL_PAD_PCT = 2;
export function labelFitsInBand(label: string, widthPct: number): boolean {
  return widthPct >= label.length * LABEL_CHAR_PCT + LABEL_PAD_PCT;
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
  // CHR-10: the displayed range tracks the TRUE ends (a season's end
  // calendar day, a span's raw end) — the +1 day band padding below is
  // geometry only and is never shown.
  const trueItems: { startMs: number; endMs: number }[] = [];
  for (const s of seasons) {
    const a = utcDayMs(s.startDate);
    const b = utcDayMs(s.endDate);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      items.push({ startMs: a, endMs: b + DAY_MS });
      trueItems.push({ startMs: a, endMs: b });
    }
  }
  for (const sp of spans) {
    const a = instantMs(sp.start);
    if (!Number.isFinite(a)) continue;
    const b = sp.end ? instantMs(sp.end) : nowMs;
    const end = Number.isFinite(b) && b > a ? b : a + DAY_MS;
    items.push({ startMs: a, endMs: end });
    trueItems.push({ startMs: a, endMs: Number.isFinite(b) && b > a ? b : a });
  }
  if (items.length === 0) return null;
  const domainStartMs = Math.min(...items.map((i) => i.startMs));
  let domainEndMs = Math.max(...items.map((i) => i.endMs));
  if (!(domainEndMs > domainStartMs)) domainEndMs = domainStartMs + DAY_MS;
  const rangeStartMs = Math.min(...trueItems.map((i) => i.startMs));
  const rangeEndMs = Math.max(rangeStartMs, ...trueItems.map((i) => i.endMs));
  const range = domainEndMs - domainStartMs;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - domainStartMs) / range) * 100));
  const width = (a: number, b: number) => Math.max(1.5, pct(b) - pct(a));

  const bands: AxisBand[] = [];
  for (const s of seasons) {
    const a = utcDayMs(s.startDate);
    const b = utcDayMs(s.endDate);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const widthPct = width(a, b + DAY_MS);
    bands.push({ season: s, leftPct: pct(a), widthPct, lane: 0, labelInBand: labelFitsInBand(s.label, widthPct) });
  }
  // Lane-packing (finding #4): greedy first-fit over the bands' RENDERED
  // ranges (left + min-width-adjusted width), earliest start first — a band
  // joins the first lane whose last band ends at or before it starts, so
  // overlapping eras stack vertically instead of painting over each other
  // in one plane; non-overlapping bands share a lane. Same approach the
  // journey lanes below already demonstrate, applied to the bands.
  const laneEnds: number[] = [];
  for (const band of [...bands].sort((x, y) => x.leftPct - y.leftPct || x.season.id - y.season.id)) {
    const end = band.leftPct + band.widthPct;
    let lane = laneEnds.findIndex((e) => e <= band.leftPct);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    band.lane = lane;
  }
  const laneCount = Math.max(1, laneEnds.length);
  const legendBands = bands.filter((b) => !b.labelInBand);
  const axisSpans: AxisSpan[] = [];
  for (const sp of spans) {
    const a = instantMs(sp.start);
    if (!Number.isFinite(a)) continue;
    const rawB = sp.end ? instantMs(sp.end) : nowMs;
    const b = Number.isFinite(rawB) && rawB > a ? rawB : a + DAY_MS;
    axisSpans.push({ span: sp, leftPct: pct(a), widthPct: width(a, b) });
  }
  return { domainStartMs, domainEndMs, rangeStartMs, rangeEndMs, bands, spans: axisSpans, laneCount, legendBands };
}

export function LifeSeasonsBand({ seasons, spans }: { seasons: LifeSeason[]; spans: JourneySpan[] }) {
  const axis = buildSeasonAxis(seasons, spans, Date.now());
  if (!axis || (axis.bands.length === 0 && axis.spans.length === 0)) return null;
  // fmtDay renders a UTC-midnight ms that encodes a fixed calendar DATE
  // (date-only technique — the day cannot shift under the viewer's zone).
  const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { timeZone: "UTC" });
  // The axis grows vertically with the season lanes; journey lanes dock
  // below the whole season block (they used to hard-code a 36px offset that
  // assumed exactly one 30px band row).
  const seasonsBlockH = axis.bands.length > 0 ? axis.laneCount * SEASON_LANE_H - (SEASON_LANE_H - SEASON_BAND_H) : 0;
  const journeysBlockH = axis.spans.length > 0
    ? JOURNEY_TOP_GAP + axis.spans.length * JOURNEY_LANE_H + (axis.spans.length - 1) * JOURNEY_LANE_GAP
    : 0;
  const axisHeight = Math.max(56, seasonsBlockH + journeysBlockH);
  return (
    <section className="tl-seasons" aria-label="Life seasons and journey spans">
      <div className="tl-seasons-head">
        <span className="tl-seasons-title">Life Seasons</span>
        <span className="tl-seasons-range">
          {fmtDay(axis.rangeStartMs)} – {fmtDay(axis.rangeEndMs)}
        </span>
      </div>
      <div className="tl-seasons-axis" style={{ height: axisHeight }}>
        {axis.bands.map(({ season, leftPct, widthPct, lane, labelInBand }) => (
          <div
            key={`season-${season.id}`}
            className="tl-season-band"
            data-testid="life-season-band"
            data-lane={lane}
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: lane * SEASON_LANE_H, background: `${TREND_COLOR[season.trend]}2e`, borderColor: `${TREND_COLOR[season.trend]}66` }}
            title={`${season.label} · ${season.startDate} – ${season.endDate}`}
          >
            {labelInBand && <span className="tl-season-label">{season.label}</span>}
          </div>
        ))}
        {axis.spans.map(({ span, leftPct, widthPct }, i) => (
          <div
            key={`journey-${span.journey.id}`}
            className="tl-journey-lane"
            style={{ top: seasonsBlockH + JOURNEY_TOP_GAP + i * (JOURNEY_LANE_H + JOURNEY_LANE_GAP) }}
          >
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
      {axis.legendBands.length > 0 && (
        <div className="tl-season-legend" data-testid="life-season-legend">
          {axis.legendBands.map(({ season }) => (
            <span key={`legend-${season.id}`} className="tl-season-legend-item">
              <span className="tl-season-legend-dot" style={{ background: TREND_COLOR[season.trend] }} aria-hidden="true" />
              {season.label} · {fmtDay(utcDayMs(season.startDate))} – {fmtDay(utcDayMs(season.endDate))}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
