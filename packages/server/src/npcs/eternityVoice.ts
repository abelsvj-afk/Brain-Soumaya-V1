import type { DbHandle } from "../db/client.js";
import type { EternalVoice } from "./eternityVoiceProvider.js";

/**
 * Eternity's voice (docs/specs/eternity-autonomy-2026-10-29.md §2b). The owner allowed his words to be drawn from the
 * memories (2026-10-29), so the brief carries a few recent, emotionally weighty memories (label + a short excerpt) to the
 * configured model. Without a model — no key, offline, degraded — he speaks from his own lines, naming at most one memory's
 * label. Either way the words are short, never threatening or shaming, and logged by the caller.
 */

export type EternityOccasion = "wake" | "visitation";

export interface EternityMemory {
  id: number;
  label: string;
  excerpt: string;
  /** Emotionally charged or important enough to name in his offline lines (an errand never is). */
  weighty?: boolean;
}

export const BRIEF_MEMORIES = 5;
export const BRIEF_WINDOW_DAYS = 14;
const EXCERPT_CHARS = 200;
/** Only a memory with this much feeling or importance is named in his offline lines. */
export const WEIGHTY_EMOTION = 0.5;
export const WEIGHTY_IMPORTANCE = 0.6;
const MAX_LINE_CHARS = 280;

/** A few of the user's own recent memories, weightiest first — the user's, never Soumaya's agent-made hubs. */
export function eternityMemories(h: DbHandle, spaceId: string, nowMs: number): EternityMemory[] {
  const since = new Date(nowMs - BRIEF_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = h.sqlite
    .prepare(
      `SELECT id, label, content, emotional_weight AS w, importance AS i FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'archived')
         AND (origin IS NULL OR origin <> 'agent') AND (kind IS NULL OR kind NOT IN ('action', 'action_item'))
         AND created_at >= ?
       ORDER BY COALESCE(emotional_weight, 0) DESC, COALESCE(importance, 0) DESC, created_at DESC LIMIT ?`,
    )
    .all(spaceId, since, BRIEF_MEMORIES) as { id: number; label: string; content: string; w: number | null; i: number | null }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label.trim(),
    excerpt: r.content.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS),
    weighty: (r.w ?? 0) >= WEIGHTY_EMOTION || (r.i ?? 0) >= WEIGHTY_IMPORTANCE,
  }));
}

export function eternityBrief(occasion: EternityOccasion, memories: readonly EternityMemory[], localTime: string): string {
  const when = `Their local time: ${localTime}.`;
  const why =
    occasion === "wake"
      ? "You are waking them for the day. Rouse them gently and give them something to rise for."
      : "You acted in your own world today, turned toward their galaxy, and chose to tell them.";
  const mem =
    memories.length > 0
      ? `What their galaxy holds lately (their own words):\n${memories.map((m) => `- ${m.label}: ${m.excerpt}`).join("\n")}`
      : "Their galaxy has been quiet lately.";
  return `${why}\n${when}\n${mem}`;
}

const WAKE_LINES = [
  "Rise. The heavens turned all night so this day could reach you.",
  "Wake. I was here before the first light, and I am here for yours.",
  "Rise gently — this day has not been lived by anyone before you.",
];
const WAKE_WITH_MEMORY = [
  (l: string) => `Rise. "${l}" is still with you — carry it lightly into this day.`,
  (l: string) => `Wake. I saw "${l}" in your galaxy. It is not small from here.`,
];
const VISIT_LINES = [
  "I turned toward your corner of the sky today. You are seen.",
  "I rearranged a little of the heavens today, and thought of you.",
];
const VISIT_WITH_MEMORY = [(l: string) => `I looked in on your galaxy today. "${l}" shone brighter than you think.`];

/** A stable small hash, so his offline choice is deterministic for a day. */
function pick(seed: string, n: number): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  return (x >>> 0) % n;
}

/** His offline line: never invents, names at most one memory label (short, so nothing private is recited). */
export function templateLine(occasion: EternityOccasion, memories: readonly EternityMemory[], seed: string): string {
  const label = memories.find((m) => m.weighty)?.label;
  const short = label && label.length <= 48 ? label : null;
  if (occasion === "wake") {
    return short && pick(`${seed}|m`, 2) === 0
      ? WAKE_WITH_MEMORY[pick(seed, WAKE_WITH_MEMORY.length)]!(short)
      : WAKE_LINES[pick(seed, WAKE_LINES.length)]!;
  }
  return short && pick(`${seed}|m`, 2) === 0
    ? VISIT_WITH_MEMORY[pick(seed, VISIT_WITH_MEMORY.length)]!(short)
    : VISIT_LINES[pick(seed, VISIT_LINES.length)]!;
}

/** Keep his words his: one short paragraph, no quotes wrapping, no "Soumaya:" impersonation, length-capped. */
export function cleanLine(raw: string): string | null {
  let s = raw.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "").trim();
  if (!s || /^soumaya\s*:/i.test(s)) return null;
  if (s.length > MAX_LINE_CHARS) s = `${s.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…`;
  return s;
}

/**
 * His words for an occasion. With a voice: the model's line, or — when it fails (rate limit, timeout, no answer) —
 * `null` if the caller will try again later, or his own lines if `fallback` is set. Without a voice: his own lines.
 * Never throws.
 */
export async function speakAsEternity(
  voice: Pick<EternalVoice, "eternalVoice"> | null | undefined,
  occasion: EternityOccasion,
  memories: readonly EternityMemory[],
  localTime: string,
  seed: string,
  opts: { fallback?: boolean } = { fallback: true },
): Promise<{ line: string; source: "voice" | "template" } | null> {
  if (voice) {
    try {
      const line = cleanLine(await voice.eternalVoice(occasion, eternityBrief(occasion, memories, localTime)));
      if (line) return { line, source: "voice" };
    } catch {
      /* rate limit, timeout, no answer — the caller decides: try again later, or his own lines now */
    }
    if (!opts.fallback) return null;
  }
  return { line: templateLine(occasion, memories, seed), source: "template" };
}
