import type { AppContext } from "../context.js";
import type { TimelineChapter, ChapterTrend, ChapterThread } from "@brain/shared";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import { parseTolerantMs, localMonthInZone, localDayInZone } from "../lib/time.js";

/**
 * The Chronicle — chapters of your life on the 3D flowing-river timeline. Soumaya
 * writes a chapter when there's REAL change (a blended signal of momentum +
 * emotional-tone trend + new milestones), roughly 1–3× a month; you can add your
 * own anytime. Deterministic + fully offline (heuristic narrative, no API key).
 *
 * See docs/TIMELINE_DESIGN.md for the locked design.
 */

// --- Tunables (documented in the spec) ---
const MIN_MEMS = 4; // need at least this many NEW memories to have anything to say
const THRESHOLD = 0.25; // blended magnitude a chapter must clear (auto only)
const MIN_GAP_DAYS = 8; // min spacing between auto chapters → ~≤3-4/month
const MONTHLY_CAP = 3; // never more than this many auto chapters in a calendar month
const MOMENTUM_FULL = 20; // this many new memories → full momentum score
const MILESTONE_FULL = 5; // this many new milestones → full milestone score
const EMO_TREND = 0.12; // |emotion delta| beyond this reads as growth/decline

/** Milestone kinds — a new one of these signals your life structurally changed. */
const MILESTONE_KINDS = new Set(["goal", "person_entity", "skill", "identity", "idea"]);

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "have", "your", "you", "was", "were", "are",
  "but", "not", "all", "out", "about", "into", "just", "like", "some", "more", "than", "then",
  "them", "they", "what", "when", "from", "been", "over", "very", "got", "get", "day", "today",
  "really", "much", "well", "also", "still", "back", "went", "feel", "felt", "time", "one",
]);

/** SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC, no Z). Parse to ms. */
function toMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

interface MemRow {
  id: number;
  label: string;
  content: string;
  emotional_weight: number | null;
  importance: number | null;
  created_at: string;
}

function rowToChapter(r: Record<string, unknown>): TimelineChapter {
  const parse = <T>(raw: unknown, fallback: T): T => {
    try {
      return JSON.parse(String(raw ?? "")) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id as number,
    title: (r.title as string) ?? "",
    summary: (r.summary as string) ?? "",
    theme: (r.theme as string) ?? "",
    trend: (r.trend as ChapterTrend) ?? "neutral",
    score: (r.score as number) ?? 0,
    periodStart: (r.period_start as string) ?? "",
    periodEnd: (r.period_end as string) ?? "",
    memoryIds: parse<number[]>(r.memory_ids, []),
    photoIds: parse<number[]>(r.photo_ids, []),
    threads: parse<ChapterThread[]>(r.threads, []),
    origin: ((r.origin as string) === "user" ? "user" : "auto"),
    createdAt: (r.created_at as string) ?? "",
  };
}

/**
 * All chapters for a space, oldest → newest (timeline order). Capped as a safety net,
 * not a real limit — chapters land roughly 1-3x/month (see maybeGenerateChapter), so
 * even a decade of daily use stays well under this; real pagination is a bigger
 * redesign (docs/specs/timeline-life-seasons.md), deferred separately.
 */
export function listChapters(ctx: AppContext, spaceId: string = DEFAULT_SPACE): TimelineChapter[] {
  const rows = ctx.handle.sqlite
    .prepare(`SELECT * FROM timeline_chapters WHERE space_id = ? ORDER BY period_end ASC, id ASC LIMIT 500`)
    .all(spaceId) as Record<string, unknown>[];
  return rows.map(rowToChapter);
}

export function deleteChapter(ctx: AppContext, spaceId: string, id: number): boolean {
  const info = ctx.handle.sqlite
    .prepare(`DELETE FROM timeline_chapters WHERE space_id = ? AND id = ?`)
    .run(spaceId, id);
  return info.changes > 0;
}

interface Assessment {
  since: string; // ISO start of the window
  windowMems: MemRow[];
  magnitude: number;
  trend: ChapterTrend;
  theme: string;
  threads: ChapterThread[];
  emotionDelta: number;
  milestones: number;
  memoryIds: number[];
  photoIds: number[];
  photoCount: number;
}

/**
 * Measure how much your life changed since the last chapter (or the beginning).
 * Pure over the DB read — no side effects — so it's easy to test + reuse for the
 * manual-add path.
 */
export function assessChange(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  nowISO: string = new Date().toISOString(),
): Assessment {
  const s = ctx.handle.sqlite;
  const nowMs = toMs(nowISO);

  const last = s
    .prepare(`SELECT period_end FROM timeline_chapters WHERE space_id = ? ORDER BY period_end DESC, id DESC LIMIT 1`)
    .get(spaceId) as { period_end: string } | undefined;
  const sinceMs = last ? toMs(last.period_end) : 0;
  const sinceISO = last?.period_end ?? new Date(0).toISOString();

  const allMems = s
    .prepare(
      `SELECT id, label, content, emotional_weight, importance, created_at
       FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
       ORDER BY created_at ASC`,
    )
    .all(spaceId) as MemRow[];

  const windowMems = allMems.filter((m) => toMs(m.created_at) > sinceMs && toMs(m.created_at) <= nowMs);
  const priorMems = allMems.filter((m) => toMs(m.created_at) <= sinceMs);

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const windowEmo = mean(windowMems.map((m) => m.emotional_weight ?? 0));
  const priorEmo = mean(priorMems.map((m) => m.emotional_weight ?? 0));
  const emotionDelta = windowEmo - priorEmo;

  // New milestones (cognitive nodes) created inside the window. Compare via toMs so
  // the space-separated DB timestamps and ISO chapter bounds never mismatch.
  const milestoneRows = s
    .prepare(
      `SELECT created_at FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind IN (${[...MILESTONE_KINDS].map(() => "?").join(",")})`,
    )
    .all(spaceId, ...MILESTONE_KINDS) as { created_at: string }[];
  const milestones = milestoneRows.filter((r) => toMs(r.created_at) > sinceMs && toMs(r.created_at) <= nowMs).length;

  const momentumN = clamp01(windowMems.length / MOMENTUM_FULL);
  const milestonesN = clamp01(milestones / MILESTONE_FULL);
  const magnitude = clamp01(0.4 * momentumN + 0.4 * Math.min(1, Math.abs(emotionDelta) / 0.6) + 0.2 * milestonesN);

  const posN = windowMems.filter((m) => (m.emotional_weight ?? 0) > 0.25).length;
  const negN = windowMems.filter((m) => (m.emotional_weight ?? 0) < -0.25).length;
  let trend: ChapterTrend = "neutral";
  if (posN > 0 && negN > 0 && Math.min(posN, negN) / Math.max(posN, negN) > 0.5) trend = "mixed";
  else if (emotionDelta > EMO_TREND) trend = "growth";
  else if (emotionDelta < -EMO_TREND) trend = "decline";

  // Theme + threads: which named anchors (people / goals / skills) recur in the window.
  const anchors = s
    .prepare(
      `SELECT label, kind FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind IN ('person_entity','goal','skill','identity')`,
    )
    .all(spaceId) as { label: string; kind: string }[];
  const windowText = windowMems.map((m) => `${m.label}. ${m.content}`.toLowerCase());
  const anchorHits = new Map<string, { count: number; emo: number; kind: string }>();
  for (const a of anchors) {
    const needle = a.label.trim().toLowerCase();
    if (needle.length < 3) continue;
    let count = 0;
    let emo = 0;
    windowMems.forEach((m, i) => {
      if (windowText[i]!.includes(needle)) {
        count++;
        emo += m.emotional_weight ?? 0;
      }
    });
    if (count > 0) anchorHits.set(a.label, { count, emo: emo / count, kind: a.kind });
  }
  const topAnchors = [...anchorHits.entries()].sort((x, y) => y[1].count - x[1].count);

  const threadTrend = (emo: number): ChapterTrend => (emo > EMO_TREND ? "growth" : emo < -EMO_TREND ? "decline" : "neutral");
  const threads: ChapterThread[] = topAnchors.slice(0, 3).map(([name, v]) => ({ name, trend: threadTrend(v.emo) }));

  // Theme: the strongest anchor, else the most frequent significant word.
  let theme = topAnchors[0]?.[0] ?? "";
  if (!theme) {
    const freq = new Map<string, number>();
    for (const t of windowText) {
      for (const w of t.match(/[a-z]{4,}/g) ?? []) {
        if (STOP.has(w)) continue;
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) theme = top[0];
  }

  // Driving memories: prefer photo-bearing, then most significant. Cap at 8.
  const idList = windowMems.map((m) => m.id);
  const photoIds = new Set<number>();
  if (idList.length) {
    const rows = s
      .prepare(
        `SELECT DISTINCT node_id FROM attachments
         WHERE space_id = ? AND mime LIKE 'image/%' AND node_id IN (${idList.map(() => "?").join(",")})`,
      )
      .all(spaceId, ...idList) as { node_id: number }[];
    for (const r of rows) photoIds.add(r.node_id);
  }
  const significance = (m: MemRow) => (m.importance ?? 0) + Math.abs(m.emotional_weight ?? 0);
  const memoryIds = windowMems
    .slice()
    .sort((a, b) => Number(photoIds.has(b.id)) - Number(photoIds.has(a.id)) || significance(b) - significance(a))
    .slice(0, 8)
    .map((m) => m.id);
  const photoIdsInList = memoryIds.filter((id) => photoIds.has(id));

  return {
    since: sinceISO,
    windowMems,
    magnitude,
    trend,
    theme,
    threads,
    emotionDelta,
    milestones,
    memoryIds,
    photoIds: photoIdsInList,
    photoCount: photoIds.size,
  };
}

function titleFor(trend: ChapterTrend, theme: string): string {
  const t = theme ? theme.charAt(0).toUpperCase() + theme.slice(1) : "";
  if (trend === "growth") return t ? `Rising through ${t}` : "A season of growth";
  if (trend === "decline") return t ? `Weathering ${t}` : "A harder season";
  if (trend === "mixed") return t ? `Turning point — ${t}` : "A turning point";
  return t ? `Holding steady in ${t}` : "Steady days";
}

/** The trend sentence of a chapter narrative, by trend. ONE source of truth:
 *  narrate() writes exactly these, and the formula-signature matcher below
 *  builds its template from the same strings. */
const TREND_SENTENCE: Record<ChapterTrend, string> = {
  growth: "The mood of this stretch lifted — more brightened than dimmed.",
  decline: "This was a heavier stretch; the weight of it shows in what you logged.",
  mixed: "It pulled both ways — real highs threaded through real lows.",
  neutral: "It held a steady register, neither soaring nor sinking.",
};

/** The opening sentence of a chapter narrative — the ONLY sentence the
 *  2026-10-21 truthfulness fix changed. The measure is DISTINCT ACTIVE
 *  DAYS: the number of SPACE-local calendar days on which at least one of
 *  the chapter's memories was actually logged. Chosen over a first→last
 *  span because the sentence sits under a card whose header already shows
 *  the chapter's full period; what a reader wants from the sentence is how
 *  much of that period they actually showed up in — and a span measure
 *  repeats the header while still reading as activity. The wording states
 *  the measure exactly: "on N different days". */
export function narrativeOpening(memoryCount: number, activeDays: number): string {
  if (memoryCount <= 0) return "No new memories landed in this stretch.";
  return `You added ${memoryCount} memor${memoryCount === 1 ? "y" : "ies"} on ${activeDays} different day${activeDays === 1 ? "" : "s"}.`;
}

/** Distinct SPACE-local days among the given instants (owner rule: day
 *  boundaries are the space's own local days, via lib/time localDayInZone). */
export function activeDaysOf(instantsMs: number[], tz: string): number {
  const days = new Set<string>();
  for (const ms of instantsMs) {
    if (Number.isFinite(ms)) days.add(localDayInZone(ms, tz));
  }
  return days.size;
}

/** Deterministic, offline narrative for a chapter (meaningful with no API key). */
function narrate(a: Assessment, tz: string): string {
  const m = a.windowMems.length;
  const activeDays = activeDaysOf(a.windowMems.map((mem) => toMs(mem.created_at)), tz);
  const parts: string[] = [];
  parts.push(narrativeOpening(m, activeDays));
  parts.push(TREND_SENTENCE[a.trend]);
  if (a.theme) parts.push(`Much of it circled around ${a.theme}.`);
  const people = a.threads.filter((t) => t.name).map((t) => t.name);
  if (people.length) parts.push(`${people.slice(0, 3).join(", ")} kept showing up.`);
  if (a.milestones > 0) parts.push(`${a.milestones} new thing${a.milestones === 1 ? "" : "s"} took root in your mind.`);
  if (a.photoCount > 0) parts.push(`You captured ${a.photoCount} moment${a.photoCount === 1 ? "" : "s"} in pictures.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------ *
 * Stored-narrative regeneration (screenshot finding #5, 2026-10-21).
 *
 * Chapter narratives are STORED at creation, so fixing narrate() alone
 * leaves every existing card telling the old lie ("Across about 1 day"
 * measured window-opening → last memory, under a 9-day header). This is
 * the backfill path for those stored texts.
 *
 * TEMPLATE SIGNATURE (what "purely formula-derived" means, exactly): a
 * stored summary is formula-derived iff it FULLY matches (anchored ^…$)
 *   OPENING ( " " TREND )? ( " " THEME )? ( " " PEOPLE )? ( " " MILESTONES )? ( " " PHOTOS )?
 * where
 *   OPENING    = the pre-fix span form  "Across about N day(s), you added M memory/ies."
 *              | the current form       "You added M memory/ies on D different day(s)."
 *              | the current empty form "No new memories landed in this stretch."
 *   TREND      = one of the four TREND_SENTENCE strings, verbatim
 *   THEME      = "Much of it circled around <anything>."
 *   PEOPLE     = "<anything> kept showing up."
 *   MILESTONES = "K new thing(s) took root in your mind."
 *   PHOTOS     = "You captured K moment(s) in pictures."
 * in that fixed order — i.e. precisely the sentence inventory narrate()
 * can emit, nothing else. ANY deviation (a hand edit, LLM prose, an extra
 * or reordered sentence) fails the match and the narrative is EXCLUDED:
 * counted, never rewritten. Before an old-span narrative is rewritten,
 * its stated memory count is additionally cross-checked against the
 * count recomputed from the chapter's own window; a mismatch (data
 * drifted since creation) also excludes it.
 * ------------------------------------------------------------------ */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FORMULA_TAIL =
  `(?: (?:${Object.values(TREND_SENTENCE).map(escapeRegExp).join("|")}))?` +
  `(?: Much of it circled around .+\\.)?` +
  `(?: .+ kept showing up\\.)?` +
  `(?: \\d+ new things? took root in your mind\\.)?` +
  `(?: You captured \\d+ moments? in pictures\\.)?`;
const OLD_OPENING_RE = /^Across about (\d+) days?, you added (\d+) memor(?:y|ies)\./;
const OLD_FORMULA_RE = new RegExp(`^Across about \\d+ days?, you added \\d+ memor(?:y|ies)\\.${FORMULA_TAIL}$`);
const CURRENT_FORMULA_RE = new RegExp(
  `^(?:You added \\d+ memor(?:y|ies) on \\d+ different days?\\.|No new memories landed in this stretch\\.)${FORMULA_TAIL}$`,
);

export type FormulaNarrativeKind = "old-span" | "current";
/** Classify a stored chapter summary against the narrate() template
 *  signature (see above). Returns null for ANY non-formula content. */
export function matchFormulaNarrative(summary: string): { kind: FormulaNarrativeKind; memoryCount: number | null } | null {
  const text = (summary ?? "").trim();
  if (!text) return null;
  const old = OLD_OPENING_RE.exec(text);
  if (old && OLD_FORMULA_RE.test(text)) return { kind: "old-span", memoryCount: Number(old[2]) };
  if (CURRENT_FORMULA_RE.test(text)) {
    const m = /^You added (\d+) memor/.exec(text);
    return { kind: "current", memoryCount: m ? Number(m[1]) : 0 };
  }
  return null;
}

export interface ChapterNarrativeClasses {
  /** Stored narratives matching the CURRENT formula (nothing to do). */
  current: number;
  /** Stored narratives matching the OLD span formula (regenerable). */
  oldFormula: number;
  /** Stored narratives with ANY non-formula content — EXCLUDED from
   *  regeneration by rule. This count (never the content) is how the
   *  owner can size the excluded class. */
  nonFormula: number;
}

/** Count-only classification of a space's stored chapter narratives.
 *  Reads summaries solely to classify them against the template signature;
 *  returns counts, never content. */
export function countChapterNarratives(ctx: AppContext, spaceId: string = DEFAULT_SPACE): ChapterNarrativeClasses {
  const rows = ctx.handle.sqlite
    .prepare(`SELECT summary FROM timeline_chapters WHERE space_id = ?`)
    .all(spaceId) as { summary: string }[];
  const out: ChapterNarrativeClasses = { current: 0, oldFormula: 0, nonFormula: 0 };
  for (const r of rows) {
    const match = matchFormulaNarrative(r.summary ?? "");
    if (!match) out.nonFormula++;
    else if (match.kind === "old-span") out.oldFormula++;
    else out.current++;
  }
  return out;
}

export interface ChapterNarrativeRegenReport extends ChapterNarrativeClasses {
  /** Old-formula narratives actually rewritten to the truthful measure. */
  regenerated: number;
  /** Old-formula narratives whose stated memory count no longer matches
   *  the recomputed window count — excluded rather than rewritten on a
   *  guess (counted here, and also inside oldFormula). */
  skippedCountMismatch: number;
}

/**
 * Rewrite stored OLD-formula chapter narratives to the current truthful
 * opening sentence. Only the opening sentence is replaced; the remainder
 * of the stored text (trend/theme/people/milestone/photo sentences) is
 * preserved byte-for-byte. Non-formula narratives are never touched.
 *
 * Deliberately a callable routine, NOT wired to any route/job/lazy read:
 * no existing maintenance trigger owns chapter text, and silently
 * rewriting stored prose on a read path would be the wrong default. The
 * trigger is an owner decision (see the package report).
 */
export function regenerateChapterNarratives(ctx: AppContext, spaceId: string = DEFAULT_SPACE): ChapterNarrativeRegenReport {
  const s = ctx.handle.sqlite;
  const tz = spaceTimezone(s, spaceId);
  const classes = countChapterNarratives(ctx, spaceId);
  const rows = s
    .prepare(`SELECT id, summary, period_start, period_end FROM timeline_chapters WHERE space_id = ? ORDER BY period_end ASC, id ASC`)
    .all(spaceId) as { id: number; summary: string; period_start: string; period_end: string }[];
  const allMems = s
    .prepare(
      `SELECT created_at FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
       ORDER BY created_at ASC`,
    )
    .all(spaceId) as { created_at: string }[];

  let regenerated = 0;
  let skippedCountMismatch = 0;
  let prevPeriodEnd: string | null = null;
  for (const row of rows) {
    const match = matchFormulaNarrative(row.summary ?? "");
    if (match?.kind === "old-span") {
      // Recompute the chapter's window exactly as assessChange defined it
      // at creation: (previous chapter's boundary, this chapter's end].
      const sinceMs = prevPeriodEnd ? toMs(prevPeriodEnd) : 0;
      const endMs = toMs(row.period_end);
      const windowMs = allMems
        .map((mem) => toMs(mem.created_at))
        .filter((ms) => ms > sinceMs && ms <= endMs);
      if (match.memoryCount !== windowMs.length) {
        skippedCountMismatch++; // data drifted — excluded, never guessed at
      } else {
        const opening = OLD_OPENING_RE.exec((row.summary ?? "").trim())!;
        const rest = (row.summary ?? "").trim().slice(opening[0].length);
        const next = narrativeOpening(windowMs.length, activeDaysOf(windowMs, tz)) + rest;
        s.prepare(`UPDATE timeline_chapters SET summary = ? WHERE id = ? AND space_id = ?`).run(next, row.id, spaceId);
        regenerated++;
      }
    }
    prevPeriodEnd = row.period_end;
  }
  return { ...classes, regenerated, skippedCountMismatch };
}

function chaptersThisMonth(ctx: AppContext, spaceId: string, nowISO: string): number {
  // The cap counts chapters in the SPACE's current local calendar month
  // (owner rule 2026-10-21) — month membership is derived from each row's
  // period_end INSTANT in the space's timezone, never the stored string's
  // UTC month prefix.
  const tz = spaceTimezone(ctx.handle.sqlite, spaceId);
  const nowMs = parseTolerantMs(nowISO);
  const month = Number.isFinite(nowMs) ? localMonthInZone(nowMs, tz) : nowISO.slice(0, 7);
  const rows = ctx.handle.sqlite
    .prepare(`SELECT period_end FROM timeline_chapters WHERE space_id = ? AND origin = 'auto'`)
    .all(spaceId) as { period_end: string }[];
  let count = 0;
  for (const r of rows) {
    const endMs = parseTolerantMs(r.period_end);
    if (Number.isFinite(endMs) && localMonthInZone(endMs, tz) === month) count++;
  }
  return count;
}

function insertChapter(
  ctx: AppContext,
  spaceId: string,
  a: Assessment,
  origin: "auto" | "user",
  nowISO: string,
  titleOverride?: string,
): TimelineChapter {
  const title = titleOverride?.trim() || titleFor(a.trend, a.theme);
  const summary = narrate(a, spaceTimezone(ctx.handle.sqlite, spaceId));
  const periodStart = a.since && toMs(a.since) > 0 ? a.since : a.windowMems[0]?.created_at ?? nowISO;
  const info = ctx.handle.sqlite
    .prepare(
      `INSERT INTO timeline_chapters (space_id, title, summary, theme, trend, score, period_start, period_end, memory_ids, photo_ids, threads, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      spaceId,
      title,
      summary,
      a.theme,
      a.trend,
      a.magnitude,
      periodStart,
      nowISO,
      JSON.stringify(a.memoryIds),
      JSON.stringify(a.photoIds),
      JSON.stringify(a.threads),
      origin,
    );
  const row = ctx.handle.sqlite
    .prepare(`SELECT * FROM timeline_chapters WHERE id = ? AND space_id = ?`)
    .get(info.lastInsertRowid, spaceId) as Record<string, unknown>;
  return rowToChapter(row);
}

/**
 * Auto path: write a chapter iff there's real change AND the cadence allows it
 * (min gap + monthly cap → ~1-3/month). Returns the new chapter or null. Called
 * from the per-space autonomy tick; free + offline + deterministic.
 */
export function maybeGenerateChapter(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  nowISO: string = new Date().toISOString(),
): TimelineChapter | null {
  const a = assessChange(ctx, spaceId, nowISO);
  if (a.windowMems.length < MIN_MEMS) return null;
  if (a.magnitude < THRESHOLD) return null;

  const last = ctx.handle.sqlite
    .prepare(`SELECT period_end FROM timeline_chapters WHERE space_id = ? ORDER BY period_end DESC, id DESC LIMIT 1`)
    .get(spaceId) as { period_end: string } | undefined;
  if (last) {
    const gapDays = (toMs(nowISO) - toMs(last.period_end)) / 86_400_000;
    if (gapDays < MIN_GAP_DAYS) return null;
    if (chaptersThisMonth(ctx, spaceId, nowISO) >= MONTHLY_CAP) return null;
  }
  return insertChapter(ctx, spaceId, a, "auto", nowISO);
}

const MIN_BACKFILL_MEMS = 3; // enough existing history to be worth an opening chapter

function openingTitle(theme: string): string {
  if (!theme) return "Where it all begins";
  return `Where it began — ${theme.charAt(0).toUpperCase() + theme.slice(1)}`;
}

/**
 * One-time backfill: seed an OPENING chapter from a brain's existing history the
 * first time the Chronicle is used, so an established brain isn't blank. Runs at
 * most once per space (guarded by the `timeline_backfilled` flag) and only while
 * there are no chapters yet. Free + offline + deterministic. Returns the seeded
 * chapter, or null if it was skipped (already backfilled, or too little history).
 */
export function backfillInitialChapter(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  nowISO: string = new Date().toISOString(),
): TimelineChapter | null {
  const s = ctx.handle.sqlite;
  s.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
  const flag = s.prepare(`SELECT timeline_backfilled AS f FROM space_meta WHERE space_id = ?`).get(spaceId) as { f: number } | undefined;
  if (flag?.f) return null;

  const already = (s.prepare(`SELECT COUNT(*) AS c FROM timeline_chapters WHERE space_id = ?`).get(spaceId) as { c: number }).c;
  const markDone = () => s.prepare(`UPDATE space_meta SET timeline_backfilled = 1 WHERE space_id = ?`).run(spaceId);
  if (already > 0) {
    markDone(); // chapters already exist → never auto-seed later
    return null;
  }

  const a = assessChange(ctx, spaceId, nowISO);
  if (a.windowMems.length < MIN_BACKFILL_MEMS) return null; // too little history — let it grow organically (retry next open)

  const chapter = insertChapter(ctx, spaceId, a, "auto", nowISO, openingTitle(a.theme));
  markDone();
  return chapter;
}

/** Manual path: you mark a chapter now. Summarizes the current window regardless of
 *  threshold (you asked for it), with an optional custom title. */
export function createManualChapter(
  ctx: AppContext,
  spaceId: string = DEFAULT_SPACE,
  opts: { title?: string; nowISO?: string } = {},
): TimelineChapter {
  const nowISO = opts.nowISO ?? new Date().toISOString();
  const a = assessChange(ctx, spaceId, nowISO);
  return insertChapter(ctx, spaceId, a, "user", nowISO, opts.title);
}
