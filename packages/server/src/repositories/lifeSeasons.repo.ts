import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { parseTolerantMs } from "../lib/time.js";
import { getPreferences, localDay, DEFAULT_PREFS } from "../agent/notify/policy.js";
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
 * Boundary semantics (owner rule, restated 2026-10-21: NO UTC in anything
 * user-facing): a season's boundaries are the SPACE-local calendar dates
 * (YYYY-MM-DD) of the source chapter's stored period instants — the days
 * the user actually lived them in their own timezone (space_meta.timezone
 * via the notify layer, the same source as the streak and the digest).
 * (This supersedes the earlier UTC-boundary reading: chapter period
 * timestamps are instants, and an instant's perceived date is its local
 * day. Chapters' own authored calendar dates remain fixed dates — this
 * derivation never rewrites them, it only reads the instants locally.)
 */

/** ASSUMED (Q5): an era must span at least one whole elapsed day. */
export const MIN_SEASON_DAYS = 1;

const DAY_MS = 86_400_000;

/** SPACE-local calendar date (YYYY-MM-DD) for a stored instant in zone
 *  `tz`, or null if unparseable. */
export function localDateOf(raw: string | null | undefined, tz: string): string | null {
  const ms = parseTolerantMs(raw ?? undefined);
  return Number.isFinite(ms) ? localDay(new Date(ms), tz) : null;
}

/** Whole CALENDAR days between two YYYY-MM-DD dates (end − start). */
function calendarDaysBetween(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T12:00:00Z`);
  const b = Date.parse(`${endDate}T12:00:00Z`);
  return Math.round((b - a) / DAY_MS);
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
}, tz: string = DEFAULT_PREFS.timezone): LifeSeason | null {
  if (String(r.origin ?? "auto") !== "auto") return null;
  const periodStart = String(r.period_start ?? "");
  const periodEnd = String(r.period_end ?? "");
  const startDate = localDateOf(periodStart, tz);
  const endDate = localDateOf(periodEnd, tz);
  if (!startDate || !endDate) return null;
  // The era span is measured on the same local calendar the boundaries are
  // drawn on: whole calendar days from the local start date to the local
  // end date (MIN_SEASON_DAYS=1 → the era must reach a later local day).
  const days = calendarDaysBetween(startDate, endDate);
  if (days < MIN_SEASON_DAYS) return null;
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
    // Season boundaries follow the SPACE's own timezone (owner rule
    // 2026-10-21) — the same space_meta source as the streak and digest;
    // the shared default applies when space_meta is unreachable.
    let tz = DEFAULT_PREFS.timezone;
    try {
      tz = getPreferences(this.handle.sqlite, this.spaceId).timezone;
    } catch {
      /* space_meta unreachable (bare test DB) — the shared default applies */
    }
    const seasons: LifeSeason[] = [];
    for (const r of rows) {
      const s = chapterRowToSeason(r as never, tz);
      if (s) seasons.push(s);
    }
    return seasons;
  }
}
