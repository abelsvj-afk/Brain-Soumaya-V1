import { API, afetch } from "./http.js";

/**
 * Client calls for Verb 1 — Tend a plot (Growing Place). Game-loop design
 * of record: `~/workspace/soumaya-readonly-audit/GAME-LOOP-FOUR-VERBS-2026-10-26.md`.
 *
 * Suggestions are fetched on garden entry and live in-world only — never
 * pushed, never in the digest. Ignored suggestions are remembered in
 * localStorage (per space) so an ignored plot is never suggested twice in
 * a row: shown-but-not-picked ids are recorded on garden exit, and the
 * next visit excludes them.
 */

export type TendMode = "line" | "link" | "affirm" | "visit";
export type SuggestionSlot = "coldest" | "most-linked" | "oldest";

export interface GardenSuggestion {
  nodeId: number;
  label: string;
  slot: SuggestionSlot;
  /** One plain line for why — never a score, never guilt. */
  why: string;
  quietDays: number;
  degree?: number;
  ageDays?: number;
}

export interface GardenTend {
  id: number;
  nodeId: number;
  kind: TendMode;
  targetNodeId: number | null;
  edgeId: number | null;
  changed: boolean | null;
  createdAt: string;
}

export interface TendResult {
  ok: true;
  node: { id: number; lastTendedAt?: string | null };
  tend: GardenTend;
  /** Fuel earned by this tend: +6 Mind work, or 0 for a visit, past the
   *  Mind 10/day cap, or when the link already existed. */
  fuelEarned: number;
  fuel: number;
  newNodeId?: number;
  edgeId?: number;
  alreadyLinked?: boolean;
}

export async function getGardenSuggestions(exclude: number[]): Promise<GardenSuggestion[]> {
  const qs = exclude.length > 0 ? `?exclude=${exclude.join(",")}` : "";
  const res = await afetch(`${API}/garden/suggestions${qs}`);
  if (!res.ok) throw new Error(`suggestions failed (${res.status})`);
  const body = (await res.json()) as { suggestions: GardenSuggestion[] };
  return body.suggestions;
}

export async function getRecentGardenTends(days = 7): Promise<GardenTend[]> {
  const res = await afetch(`${API}/garden/tends?days=${days}`);
  if (!res.ok) throw new Error(`tends failed (${res.status})`);
  const body = (await res.json()) as { tends: GardenTend[] };
  return body.tends;
}

export async function tendGardenPlot(input: {
  nodeId: number;
  mode: TendMode;
  text?: string;
  targetId?: number;
  changed?: boolean;
}): Promise<TendResult> {
  const res = await afetch(`${API}/garden/tend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as TendResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `tend failed (${res.status})`);
  return body;
}

const IGNORED_KEY = (spaceId: string) => `garden-ignored:${spaceId}`;

/** The ids shown as suggestions last visit that were not picked. */
export function readIgnoredSuggestionIds(spaceId: string): number[] {
  try {
    const raw = localStorage.getItem(IGNORED_KEY(spaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
  } catch {
    return [];
  }
}

/** Record shown-but-not-picked suggestion ids (overwrites last visit's). */
export function writeIgnoredSuggestionIds(spaceId: string, ids: number[]): void {
  try {
    localStorage.setItem(IGNORED_KEY(spaceId), JSON.stringify(ids));
  } catch {
    // Storage full or unavailable — the next visit simply suggests fresh.
  }
}

/** Clear the ignored set (a picked suggestion resets it). */
export function clearIgnoredSuggestionIds(spaceId: string): void {
  try {
    localStorage.removeItem(IGNORED_KEY(spaceId));
  } catch {
    // Nothing to clear.
  }
}
