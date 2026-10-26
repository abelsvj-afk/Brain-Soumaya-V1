import type { LifeSeasonsTimeline, TimelineChapter } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Client calls for the newest cohesive domains — the Chronicle timeline and
 * spaced-repetition review. Split out of the (very large) `client.ts` in the
 * Post-MVP D4 refactor; behaviour is unchanged. Re-exported from `client.ts`, so
 * existing `import { getDueReviews } from "../api/client"` call sites still work.
 */

export type { TimelineChapter } from "@brain/shared";

// --- The Chronicle: the 3D flowing-river life timeline ---
export async function getTimeline(): Promise<TimelineChapter[]> {
  try {
    const res = await afetch(`${API}/timeline`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}
/** Mark a chapter now (manual add). Returns the new chapter or null. */
export async function addTimelineChapter(title?: string): Promise<TimelineChapter | null> {
  try {
    const res = await afetch(`${API}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as TimelineChapter;
  } catch {
    return null;
  }
}
/** Life Seasons + Journey spans for the Timeline's real time axis (IM-132).
 *  Returns null on any failure so the Timeline can show a distinct state for
 *  this section without taking down the chapters list. */
export async function getLifeSeasons(): Promise<LifeSeasonsTimeline | null> {
  try {
    const res = await afetch(`${API}/timeline/seasons`);
    if (!res.ok) return null;
    const d = (await res.json()) as LifeSeasonsTimeline;
    return Array.isArray(d?.seasons) && Array.isArray(d?.journeySpans) ? d : null;
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
export async function getDueReviewsResult(): Promise<{ ok: true; reviews: DueReview[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/review/due`);
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
