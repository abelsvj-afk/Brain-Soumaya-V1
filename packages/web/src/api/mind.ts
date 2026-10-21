import { API, afetch } from "./http.js";

/**
 * Client calls for the Mind / cognitive layer — cognitive items (goals/ideas/skills/
 * identity/…), person profiles + suggestions, proactive inquiries, the suggested-
 * connections queue, and working-memory thoughts. Split out of the large `client.ts`
 * in the Post-MVP D4 refactor (behaviour unchanged); re-exported from `client.ts`.
 */

/** A cognitive object (goal/idea/skill/identity/…) — the cognitive layer. */
export interface CognitiveItem {
  id: number;
  kind: string;
  label: string;
  content: string;
  progress: number | null;
  /** Set once a goal actually finished (never cleared). Always null for other kinds. */
  completedAt: string | null;
  degree: number;
  aliases: string[];
  createdAt: string;
  /** Life Vision's target date (docs/specs/life-vision.md) — never a reminder for
   *  kind "life_vision" (C2.1-locked), even though the field is shared with kinds
   *  where it is one. */
  remindAt: string | null;
}
/**
 * Fetch the cognitive list WITHOUT conflating failure with emptiness: a dead
 * or slow server (network error, non-OK status, malformed body) returns
 * `{ ok: false }`, while a healthy-but-empty mind returns `{ ok: true, items: [] }`.
 * The Mind panel renders those two states differently (error + retry vs
 * "Nothing mapped yet"); getCognitive below keeps the old fail-soft contract
 * for any caller that doesn't care about the distinction.
 */
export async function getCognitiveResult(
  kind?: string,
): Promise<{ ok: true; items: CognitiveItem[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/cognitive${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, items: d as CognitiveItem[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getCognitive(kind?: string): Promise<CognitiveItem[]> {
  const r = await getCognitiveResult(kind);
  return r.ok ? r.items : [];
}
export async function createCognitive(kind: string, label: string, content?: string, date?: string, aliases?: string[]): Promise<{ id: number } | null> {
  try {
    const res = await afetch(`${API}/cognitive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, label, content, date, aliases }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function unlinkCognitive(id: number, memoryId: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/unlink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export async function pruneCognitive(id: number): Promise<number> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/prune`, { method: "POST" });
    const d = res.ok ? await res.json().catch(() => ({})) : {};
    return typeof d.pruned === "number" ? d.pruned : 0;
  } catch {
    return 0;
  }
}
export async function confirmInquiry(id: number): Promise<{ ok: boolean; hubId?: number | null }> {
  try {
    const res = await afetch(`${API}/inquiries/${id}/confirm`, { method: "POST" });
    if (!res.ok) return { ok: false };
    const d = (await res.json().catch(() => ({}))) as { hubId?: number | null };
    return { ok: true, hubId: d.hubId ?? null };
  } catch {
    return { ok: false };
  }
}
export interface UpcomingEvent { id: number; label: string; date: string; inDays: number }
/**
 * IM-45: same truthful-state contract as getCognitiveResult — failure is
 * `{ ok: false }`, never a fake empty list. getUpcomingEvents below keeps the
 * old fail-soft contract for callers that don't distinguish.
 */
export async function getUpcomingEventsResult(): Promise<{ ok: true; events: UpcomingEvent[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/cognitive/events/upcoming`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, events: d as UpcomingEvent[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getUpcomingEvents(): Promise<UpcomingEvent[]> {
  const r = await getUpcomingEventsResult();
  return r.ok ? r.events : [];
}
export async function setCognitiveProgress(id: number, value: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export interface CognitiveEvidence {
  for: { id: number; label: string }[];
  against: { id: number; label: string }[];
  confidence: number;
}
export async function getCognitiveEvidence(id: number): Promise<CognitiveEvidence | null> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/evidence`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export interface PersonProfile {
  count: number;
  lastAt: string | null;
  tone: "warm" | "heavy" | "mixed" | "neutral";
  interactions: { id: number; label: string; createdAt: string; emotionalWeight: number | null }[];
}
export async function getPersonProfile(id: number): Promise<PersonProfile | null> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/profile`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
/** IM-45: truthful-state variant of getPersonSuggestions (see getCognitiveResult). */
export async function getPersonSuggestionsResult(): Promise<{ ok: true; suggestions: { name: string; count: number }[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/people/suggestions`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, suggestions: d as { name: string; count: number }[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getPersonSuggestions(): Promise<{ name: string; count: number }[]> {
  const r = await getPersonSuggestionsResult();
  return r.ok ? r.suggestions : [];
}
/** Tell Soumaya a suggested name is NOT a person, so it never resurfaces. */
export async function dismissPersonSuggestion(name: string): Promise<boolean> {
  try {
    const res = await afetch(`${API}/people/suggestions/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function promoteIdea(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/promote`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
/**
 * IM-136 — user-triggered idea split: branch `id` into a new idea named
 * `newLabel`. The server keeps the original intact, partitions supporting
 * memories by nearness to the new branch, and deletes nothing. Returns the
 * new idea's id + how many supporters moved, or null on any failure.
 */
export async function splitIdea(id: number, newLabel: string, content?: string): Promise<{ newId: number; moved: number } | null> {
  try {
    const res = await afetch(`${API}/cognitive/${id}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newLabel, content }),
    });
    if (!res.ok) return null;
    const d = (await res.json().catch(() => null)) as { id?: unknown; moved?: unknown } | null;
    return typeof d?.id === "number" ? { newId: d.id, moved: typeof d.moved === "number" ? d.moved : 0 } : null;
  } catch {
    return null;
  }
}
/**
 * IM-136 — user-triggered idea merge: fold `dropId` into `keepId`. The server
 * unions every link onto the survivor, keeps the folded idea's label as an
 * alias on it, and soft-deletes the folded node (recoverable) — nothing is
 * hard-deleted. False on any failure (including non-idea ids).
 */
export async function mergeIdeas(keepId: number, dropId: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/cognitive/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId, dropId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export async function updateCognitive(id: number, patch: { label?: string; content?: string; aliases?: string[]; date?: string | null }): Promise<boolean> {
  try {
    const res = await afetch(`${API}/cognitive/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Inquiries: connections Soumaya noticed and wants to ask about ─────────────
export interface Inquiry {
  id: number;
  question: string;
  kind: string;
  nodes: { id: number; label: string }[];
  createdAt: string;
}
/** IM-45: truthful-state variant of getInquiries (see getCognitiveResult). */
export async function getInquiriesResult(): Promise<{ ok: true; inquiries: Inquiry[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/inquiries`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, inquiries: d as Inquiry[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getInquiries(): Promise<Inquiry[]> {
  const r = await getInquiriesResult();
  return r.ok ? r.inquiries : [];
}
export async function answerInquiry(id: number, text: string): Promise<{ nodeIds: number[]; fuelEarned: number } | null> {
  try {
    const res = await afetch(`${API}/inquiries/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function dismissInquiry(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/inquiries/${id}/dismiss`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
export async function rejectInquiry(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/inquiries/${id}/reject`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Suggested Connections: the review queue you control ───────────────────────
export interface Candidate {
  id: number;
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
  reason: string | null;
  score: number;
  origin: string; // withheld | pruned | suggested
  createdAt: string;
  /** IM-120 (additive, optional for older payloads): context preview data. */
  aContent?: string;
  bContent?: string;
  aCreatedAt?: string;
  bCreatedAt?: string;
}
export async function getCandidates(): Promise<{ candidates: Candidate[]; count: number }> {
  // IM-120 (honesty subset): failures must be DISTINGUISHABLE from a true empty
  // queue. This used to swallow every error into `{ candidates: [] }`, so the
  // Connections panel's "Nothing waiting" simultaneously meant loading, error,
  // and empty. It now throws; callers that only need a count (App's polled
  // badge) already catch rejections, and the panel renders an error state.
  const res = await afetch(`${API}/candidates`);
  if (!res.ok) throw new Error(`candidates fetch failed (${res.status})`);
  const d = await res.json().catch(() => null);
  if (!d || !Array.isArray(d.candidates)) throw new Error("candidates fetch returned a malformed payload");
  return d;
}
export async function acceptCandidate(id: number): Promise<boolean> {
  try {
    return (await afetch(`${API}/candidates/${id}/accept`, { method: "POST" })).ok;
  } catch {
    return false;
  }
}
export async function dismissCandidate(id: number): Promise<boolean> {
  try {
    return (await afetch(`${API}/candidates/${id}/dismiss`, { method: "POST" })).ok;
  } catch {
    return false;
  }
}
/** IM-120: undo an accept/dismiss — the server re-pends the candidate,
 *  removes an accept's edge, or clears a dismiss's rejection. */
export async function restoreCandidate(id: number): Promise<boolean> {
  try {
    return (await afetch(`${API}/candidates/${id}/restore`, { method: "POST" })).ok;
  } catch {
    return false;
  }
}
/** Connect two memories yourself (no Soumaya). */
export async function linkMemories(source: number, target: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/candidates/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, target }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
/** Declutter: sever bogus anchor links + move the weakest associative links to the queue. */
export async function pruneWeakLinks(): Promise<{ pruned: number; anchorPruned: number; weakPruned: number }> {
  try {
    const res = await afetch(`${API}/candidates/prune`, { method: "POST" }, 60_000);
    const d = await res.json().catch(() => ({}));
    return {
      pruned: typeof d.pruned === "number" ? d.pruned : 0,
      anchorPruned: typeof d.anchorPruned === "number" ? d.anchorPruned : 0,
      weakPruned: typeof d.weakPruned === "number" ? d.weakPruned : 0,
    };
  } catch {
    return { pruned: 0, anchorPruned: 0, weakPruned: 0 };
  }
}

// ── Working Memory (Cognitive Layer Phase 2): the ephemeral "mind space" ──────
export interface Thought {
  id: number;
  text: string;
  source: string;
  strength: number; // effective (decayed) 0..1
  reinforceCount: number;
  createdAt: string;
}
/** IM-45: truthful-state variant of getThoughts (see getCognitiveResult). */
export async function getThoughtsResult(): Promise<{ ok: true; thoughts: Thought[] } | { ok: false }> {
  try {
    const res = await afetch(`${API}/working`);
    if (!res.ok) return { ok: false };
    const d = await res.json().catch(() => null);
    return Array.isArray(d) ? { ok: true, thoughts: d as Thought[] } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export async function getThoughts(): Promise<Thought[]> {
  const r = await getThoughtsResult();
  return r.ok ? r.thoughts : [];
}
export async function addThought(text: string, source?: string): Promise<{ id: number } | null> {
  try {
    const res = await afetch(`${API}/working`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function reinforceThought(id: number): Promise<{ promotedNodeId: number | null } | null> {
  try {
    const res = await afetch(`${API}/working/${id}/reinforce`, { method: "POST" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function promoteThought(id: number): Promise<{ nodeId: number } | null> {
  try {
    const res = await afetch(`${API}/working/${id}/promote`, { method: "POST" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
export async function dismissThought(id: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/working/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
export async function editThought(id: number, text: string): Promise<boolean> {
  try {
    const res = await afetch(`${API}/working/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
