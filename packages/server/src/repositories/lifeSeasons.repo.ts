import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { parseTolerantMs, toIsoDate } from "../lib/time.js";
import type { ChapterTrend, LifeSeason } from "@brain/shared";

/**
 * Life Seasons detection (IM-132, docs/specs/timeline-life-seasons.md).
 *
 * The spec's stated algorithm — reused, not reinvented: `timeline_chapters`
 * becomes the Life Seasons DETECTION INPUT, not a competing data model. Its
 * existing heuristic (analysis/timeline.ts `assessChange`/`maybeGenerateChapter`:
 * momentum + emotion-delta + milestones, gated by MIN_MEMS / THRESHOLD /
 * MIN_GAP_DAYS / MONTHLY_CAP) already decides when a real era boundary
 * happened and writes an auto chapter for it. A Season is therefore DERIVED
 * on read from an `origin='auto'` chapter — no new detection logic, no new
 * table, and auto chapters are never duplicated as journeys.
 *
 * Parameters the spec does NOT pin (logged verbatim as Q5 assumptions):
 *  - MIN_SEASON_DAYS (below): the minimum elapsed span for a chapter to read
 *    as an ERA rather than a moment.
 *  - Label rule (below): "<Capitalised theme> Era", falling back to the
 *    chapter's own title when it has no theme.
 *  - No extra confidence threshold beyond the heuristic's own THRESHOLD
 *    (a chapter's score becomes the season's confidence as-is), and no
 *    merging of adjacent/overlapping seasons.
 *
 * Boundary semantics (Date & Time Accuracy decision — chapter dates are
 * FIXED calendar dates): a season's boundaries are the UTC calendar dates
 * (YYYY-MM-DD) of the source chapter's stored period instants, computed with
 * UTC getters only (parseTolerantMs treats naive SQLite timestamps as UTC,
 * toIsoDate renders the UTC date) — identical under any process timezone.
 */

/** ASSUMED (Q5): an era must span at least one whole elapsed day. */
export const MIN_SEASON_DAYS = 1;

const DAY_MS = 86_400_000;

/** UTC calendar date (YYYY-MM-DD) for a stored instant, or null if unparseable. */
export function utcDateOf(raw: string | null | undefined): string | null {
  const ms = parseTolerantMs(raw ?? undefined);
  return Number.isFinite(ms) ? toIsoDate(new Date(ms)) : null;
}

/** Whole elapsed days between two stored instants (floor), or null if either is unparseable. */
export function elapsedDays(startRaw: string, endRaw: string): number | null {
  const a = parseTolerantMs(startRaw);
  const b = parseTolerantMs(endRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

/** ASSUMED (Q5) label rule: "<Theme> Era" when the chapter has a theme, else its title. */
export function seasonLabel(theme: string, title: string): string {
  const t = (theme ?? "").trim();
  if (t) return `${t.charAt(0).toUpperCase() + t.slice(1)} Era`;
  return (title ?? "").trim() || "Untitled Era";
}

/** Map one timeline_chapters row to a LifeSeason, or null when it is not a season:
 *  manual (`origin='user'`) chapters are authored chapters/Journeys, not detected
 *  eras; unparseable or sub-MIN_SEASON_DAYS periods are moments, not eras. Pure. */
export function chapterRowToSeason(r: {
  id: number; title?: unknown; theme?: unknown; trend?: unknown; score?: unknown;
  period_start?: unknown; period_end?: unknown; origin?: unknown;
}): LifeSeason | null {
  if (String(r.origin ?? "auto") !== "auto") return null;
  const periodStart = String(r.period_start ?? "");
  const periodEnd = String(r.period_end ?? "");
  const startDate = utcDateOf(periodStart);
  const endDate = utcDateOf(periodEnd);
  if (!startDate || !endDate) return null;
  const days = elapsedDays(periodStart, periodEnd);
  if (days === null || days < MIN_SEASON_DAYS) return null;
  const theme = String(r.theme ?? "");
  return {
    id: Number(r.id),
    chapterId: Number(r.id),
    label: seasonLabel(theme, String(r.title ?? "")),
    theme,
    trend: (String(r.trend ?? "neutral") as ChapterTrend),
    confidence: typeof r.score === "number" ? r.score : Number(r.score ?? 0) || 0,
    periodStart,
    periodEnd,
    startDate,
    endDate,
  };
}

/** Owns the SQL for Life Season detection reads. Space-scoped, read-only:
 *  seasons are derived from timeline_chapters, never stored separately. */
export class LifeSeasonsRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  /** All detected seasons for the space, oldest → newest. */
  listSeasons(): LifeSeason[] {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT id, title, theme, trend, score, period_start, period_end, origin
         FROM timeline_chapters
         WHERE space_id = ? AND origin = 'auto'
         ORDER BY period_start ASC, id ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    const seasons: LifeSeason[] = [];
    for (const r of rows) {
      const s = chapterRowToSeason(r as never);
      if (s) seasons.push(s);
    }
    return seasons;
  }
}
