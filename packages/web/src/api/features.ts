import type { TimelineChapter } from "@brain/shared";
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
export async function getDueReviews(): Promise<DueReview[]> {
  try {
    const res = await afetch(`${API}/review/due`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}
/** Grade a recall attempt; SM-2 reschedules server-side. */
export async function gradeReview(id: number, remembered: boolean): Promise<boolean> {
  try {
    const res = await afetch(`${API}/review/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remembered }),
    });
    return res.ok;
  } catch {
    return false;
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
