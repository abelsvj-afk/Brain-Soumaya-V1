import type { DbHandle } from "../db/client.js";
import { NEUTRAL_CURRENTS, currentsInWords, faction, scoreCurrentsDetailed, societyDay, type MemoryLite, type SocietyDay } from "@brain/shared";
import { spaceTimezone } from "../agent/notify/policy.js";
import { localDateKey } from "../npcs/repo.js";

/**
 * The society's reading of a brain (docs/specs/npc-hive-society-2026-10-30.md). A MIRROR, NOT A VERDICT: it counts what runs through the galaxy lately (named currents) and
 * never scores the person. Private by construction — memory text is read here, on the server, scored by word-and-weight counting, and thrown away; only small numbers and words
 * leave. Optional: with reflection off nothing is read and the society is a fixed, neutral, still-living one.
 */

export const SOCIETY_WINDOW_DAYS = 90;
export const SOCIETY_MAX_MEMORIES = 400;
const EXCERPT_CHARS = 600;
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; society: SocietyDay }>();

/** Tests only. */
export function resetSocietyCache(): void {
  cache.clear();
}

export function getReflect(h: DbHandle, spaceId: string): boolean {
  const row = h.sqlite.prepare(`SELECT reflect FROM society_prefs WHERE space_id = ?`).get(spaceId) as { reflect: number } | undefined;
  return row ? row.reflect !== 0 : true; // default on; the panel says so and offers the switch
}

export function setReflect(h: DbHandle, spaceId: string, reflect: boolean): void {
  h.sqlite
    .prepare(`INSERT INTO society_prefs (space_id, reflect) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET reflect = excluded.reflect`)
    .run(spaceId, reflect ? 1 : 0);
  for (const k of [...cache.keys()]) if (k.startsWith(`${spaceId}|`)) cache.delete(k);
}

/** The user's own recent memories (never the agent's hubs or action items), as plain text + weight. Stays on the server. */
export function recentMemories(h: DbHandle, spaceId: string, nowMs: number): MemoryLite[] {
  const since = new Date(nowMs - SOCIETY_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = h.sqlite
    .prepare(
      `SELECT label, content, emotional_weight AS w FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'archived')
         AND (origin IS NULL OR origin <> 'agent') AND (kind IS NULL OR kind NOT IN ('action', 'action_item'))
         AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(spaceId, since, SOCIETY_MAX_MEMORIES) as { label: string; content: string | null; w: number | null }[];
  return rows.map((r) => ({ text: `${r.label ?? ""} ${(r.content ?? "").slice(0, EXCERPT_CHARS)}`, weight: r.w }));
}

/** Today's society for a brain. Reflection off (or nothing to read) → the neutral society, computing and reading nothing. */
export function computeSociety(h: DbHandle, spaceId: string, nowMs: number = Date.now()): { reflect: boolean; society: SocietyDay } {
  const tz = spaceTimezone(h.sqlite, spaceId);
  const dayKey = localDateKey(tz, nowMs);
  const reflect = getReflect(h, spaceId);
  if (!reflect) return { reflect, society: societyDay(null, dayKey) };
  const key = `${spaceId}|${dayKey}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return { reflect, society: hit.society };
  const memories = recentMemories(h, spaceId, nowMs);
  const scored = scoreCurrentsDetailed(memories);
  const society = societyDay(memories.length > 0 ? scored.currents : { ...NEUTRAL_CURRENTS }, dayKey, scored.confidence);
  // `reflects` is true only when something was actually read; a brain with no memories yet shows the neutral world honestly.
  const out = memories.length > 0 ? society : { ...society, reflects: false };
  cache.set(key, { at: nowMs, society: out });
  return { reflect, society: out };
}

/** The society in words for the daily script's prompt — currents and callings only, never memory text. */
export function societyBrief(s: SocietyDay): string {
  const calls = s.factions
    .map((f) => `${faction(f.id)?.name ?? f.id} (standing ${f.standing >= 0.55 ? "high" : f.standing >= 0.35 ? "middling" : "low"}) is called to: ${f.calling.text.toLowerCase()}`)
    .join("; ");
  const tide = s.belief >= 0.65 ? "high — most believe" : s.belief >= 0.45 ? "middling — faith wavers" : "low — doubt is in the air";
  return `The society today. Currents in this world: ${currentsInWords(s.currents)}. Belief in Eternity: ${tide}. Callings: ${calls}.`;
}
