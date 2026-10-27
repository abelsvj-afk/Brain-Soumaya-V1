import type { LifeSeason, LifeSeasonsTimeline, JourneySpan, TimelineChapter } from "@brain/shared";
import { API, afetch, DEFAULT_TIMEOUT_MS } from "./http.js";

/**
 * Client calls for the newest cohesive domains — the Chronicle timeline and
 * spaced-repetition review. Split out of the (very large) `client.ts` in the
 * Post-MVP D4 refactor; behaviour is unchanged. Re-exported from `client.ts`, so
 * existing `import { getDueReviews } from "../api/client"` call sites still work.
 */

export type { TimelineChapter } from "@brain/shared";

// --- The Chronicle: the 3D flowing-river life timeline ---
/**
 * CHR-01: strict sibling of `getTimeline` — `{ ok: false }` on any failure
 * (network, non-OK, malformed body) instead of the fail-soft `[]`, for
 * callers (TimelineView) that must distinguish a failed fetch from "no
 * chapters yet". Carries the server's `total` so the surface can state the
 * 500-chapter truncation (CHR-07). Accepts the legacy bare-array shape too,
 * so an older server still reads as a success with total = length.
 * `getTimeline` keeps its contract for everyone else.
 */
export async function getTimelineResult(): Promise<
  { ok: true; chapters: TimelineChapter[]; total: number } | { ok: false }
> {
  try {
    const res = await afetch(`${API}/timeline`);
    if (!res.ok) return { ok: false };
    const d = (await res.json().catch(() => null)) as
      | { chapters?: unknown; total?: unknown }
      | unknown[] | null;
    if (Array.isArray(d)) return { ok: true, chapters: d as TimelineChapter[], total: d.length };
    if (d && Array.isArray(d.chapters)) {
      return {
        ok: true,
        chapters: d.chapters as TimelineChapter[],
        total: typeof d.total === "number" ? d.total : d.chapters.length,
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getTimeline(): Promise<TimelineChapter[]> {
  const r = await getTimelineResult();
  return r.ok ? r.chapters : [];
}
/** Mark a chapter now (manual add). Returns the new chapter or null. */
export async function addTimelineChapter(title?: string): Promise<TimelineChapter | null> {
  const r = await addTimelineChapterResult(title);
  return r.ok ? r.chapter : null;
}
/**
 * CHR-12: strict sibling of `addTimelineChapter` — names the empty-window
 * refusal (`{ ok: false, empty: true }`, HTTP 409 `empty-window`) so the
 * surface can explain "nothing new to narrate yet" instead of toasting a
 * generic failure. Any other failure is plain `{ ok: false }`.
 */
export async function addTimelineChapterResult(
  title?: string,
): Promise<{ ok: true; chapter: TimelineChapter } | { ok: false; empty?: boolean }> {
  try {
    const res = await afetch(`${API}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!res.ok) {
      if (res.status === 409) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (d.error === "empty-window") return { ok: false, empty: true };
      }
      return { ok: false };
    }
    return { ok: true, chapter: (await res.json()) as TimelineChapter };
  } catch {
    return { ok: false };
  }
}
/** Life Seasons + Journey spans for the Timeline's real time axis (IM-132).
 *  Returns null on any failure so the Timeline can show a distinct state for
 *  this section without taking down the chapters list.
 *  CHR-11: pages (limit/offset) until the server's totals have arrived, so
 *  beyond the window the band shows the whole story instead of silently
 *  showing the first page. A page that adds nothing ends the loop. */
export async function getLifeSeasons(): Promise<LifeSeasonsTimeline | null> {
  try {
    const limit = 500; // server max per page
    let offset = 0;
    let seasons: LifeSeason[] = [];
    let journeySpans: JourneySpan[] = [];
    let totalSeasons = 0;
    let totalJourneySpans = 0;
    for (;;) {
      const res = await afetch(`${API}/timeline/seasons?limit=${limit}&offset=${offset}`);
      if (!res.ok) return null;
      const d = (await res.json()) as LifeSeasonsTimeline;
      if (!Array.isArray(d?.seasons) || !Array.isArray(d?.journeySpans)) return null;
      const before = seasons.length + journeySpans.length;
      seasons = seasons.concat(d.seasons);
      journeySpans = journeySpans.concat(d.journeySpans);
      totalSeasons = typeof d.totalSeasons === "number" ? d.totalSeasons : seasons.length;
      totalJourneySpans = typeof d.totalJourneySpans === "number" ? d.totalJourneySpans : journeySpans.length;
      if (seasons.length >= totalSeasons && journeySpans.length >= totalJourneySpans) break;
      if (seasons.length + journeySpans.length === before) break; // no progress — never spin
      offset += limit;
    }
    return { seasons, journeySpans, totalSeasons, totalJourneySpans };
  } catch {
    return null;
  }
}

export async function deleteTimelineChapter(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/timeline/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Spaced repetition (active recall) ---
export interface DueReview {
  id: number;
  label: string;
  /** The memory's full content — shown by ReviewPanel only after Reveal (IM-111). */
  content: string;
  strength: number;
  reviewCount: number;
}
/**
 * Batch G (REG-196): the due list is the badge count's source
 * (`getDueReviews().length` in App's poll), so it must THROW on failure
 * instead of fail-softing to `[]` — a dead server used to read as "0 due".
 * Callers that need a count hold their last value / report unknown on a
 * throw (usePolledCount); callers that need failure-vs-empty (ReviewPanel,
 * Observatory) use the strict `getDueReviewsResult` sibling below.
 */
export async function getDueReviews(): Promise<DueReview[]> {
  const res = await afetch(`${API}/review/due`);
  if (!res.ok) throw new Error(`due reviews fetch failed (${res.status})`);
  const d = await res.json().catch(() => null);
  if (!Array.isArray(d)) throw new Error("due reviews fetch returned a malformed payload");
  return d as DueReview[];
}
/**
 * IM-124 residual: strict sibling of `getDueReviews` — `{ ok: false }` on
 * any failure (network, non-OK, malformed body) instead of a throw, for
 * callers (the Observatory, ReviewPanel) that must distinguish a failed fetch
 * from "nothing due" without a try/catch at the call site.
 */
export async function getDueReviewsResult(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<{ ok: true; reviews: DueReview[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/review/due`, {}, timeoutMs);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, reviews: d as DueReview[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
/** Grade a recall attempt; SM-2 reschedules server-side. */
export async function gradeReview(id: number, remembered: boolean): Promise<boolean> {
  return (await gradeReviewDetailed(id, remembered)).ok;
}

export interface GradeResult {
  ok: boolean;
  /** ISO instant of the next scheduled review (IM-114), when the server sent it. */
  nextReviewAt?: string;
  /** Whole days until that review (IM-114) — "next review in ~N days". */
  nextIntervalDays?: number;
  /** REG-200 (RC-07): the fuel the grade paid, in the earn sheet's terms. */
  fuelEarned?: number;
  /** REG-200 (RC-07): true when the grade advanced the streak to a new day. */
  streakAdvanced?: boolean;
  /** REG-197 (RC-04): true when this response replays an already-committed attempt. */
  duplicate?: boolean;
}

/** IM-114: like gradeReview, but also surfaces WHEN the memory comes back —
 *  the grade response already carried nextReviewAt; the boolean wrapper
 *  discarded it, so the panel could never give reschedule feedback. */
export async function gradeReviewDetailed(id: number, remembered: boolean, attemptKey?: string): Promise<GradeResult> {
  try {
    const res = await afetch(`${API}/review/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(attemptKey ? { remembered, attemptKey } : { remembered }),
    });
    if (!res.ok) return { ok: false };
    const d = (await res.json().catch(() => ({}))) as {
      nextReviewAt?: string;
      nextIntervalDays?: number;
      fuelEarned?: number;
      streakAdvanced?: boolean;
      duplicate?: boolean;
    };
    return {
      ok: true,
      nextReviewAt: d.nextReviewAt,
      nextIntervalDays: d.nextIntervalDays,
      fuelEarned: d.fuelEarned,
      streakAdvanced: d.streakAdvanced,
      duplicate: d.duplicate,
    };
  } catch {
    return { ok: false };
  }
}

/** Soumaya's autonomously-charted Codex field notes. */
export interface AgentDiscovery { key: string; title: string; lore: string; icon: string; focusId: number | null; createdAt: string }
export async function getCodexDiscoveries(): Promise<AgentDiscovery[]> {
  try {
    const res = await afetch(`${API}/codex/discoveries`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/** Player-controlled Fuel sink: commission Soumaya to warm your coldest memories now. */
export interface CommissionResult { ok: boolean; warmed?: number; labels?: string[]; cost?: number; error?: string }
export async function commissionWarm(): Promise<CommissionResult> {
  try {
    const res = await afetch(`${API}/maintenance/commission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "warm" }),
    });
    const d = (await res.json().catch(() => ({}))) as CommissionResult;
    return res.ok ? { ...d, ok: true } : { ok: false, error: d.error ?? "Couldn't commission" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}
