import { type CognitiveKind, COGNITIVE_META } from "@brain/shared";

/**
 * Pure token / name-matching helpers for the cognitive layer — common-word filtering,
 * label tokenisation, alias cleaning, anchor-match tokens, and word-boundary mentions.
 * Extracted from cognitive.ts (Post-MVP D4); no DB/ctx — pure functions.
 */

export const COMMON_WORDS = new Set<string>([
  // articles / pronouns / conjunctions / prepositions
  "the", "and", "for", "with", "that", "this", "there", "here", "they", "them", "their",
  "your", "yours", "mine", "ours", "from", "into", "onto", "over", "under", "about",
  "after", "before", "then", "than", "when", "what", "which", "were", "was", "have",
  "has", "had", "been", "being", "does", "did", "done", "will", "would", "shall",
  "should", "could", "cant", "wont", "dont", "just", "like", "some", "more", "most",
  "much", "many", "very", "also", "still", "even", "back", "down", "out", "off",
  // common verbs / everyday words that double as names
  "make", "made", "take", "took", "give", "gave", "come", "came", "want", "need",
  "feel", "felt", "know", "knew", "think", "thought", "good", "great", "best", "well",
  "time", "day", "days", "week", "year", "today", "tomorrow", "morning", "night",
  "mark", "grace", "hope", "faith", "joy", "rose", "dawn", "may", "june", "april",
  "art", "bill", "will", "sunny", "summer", "autumn", "kim", "guy", "chase", "hunter",
]);

/**
 * Kinds that must link by NAME only — never by "vibe". A person or an identity is
 * about a specific entity; a memory that merely *feels* similar is NOT a real
 * connection (this is what wrongly tied a girlfriend to unrelated memories). Goals,
 * skills, motivations etc. legitimately gather thematically-related memories, so
 * they keep the (now stricter) semantic pass.
 */
export const NAME_ONLY_KINDS = new Set<string>(["person_entity", "identity"]);

/** True if `kind` is one of the cognitive kinds (an anchor, not a plain memory). */
export function isCognitiveKind(kind: string | null | undefined): kind is CognitiveKind {
  return kind != null && kind in COGNITIVE_META;
}

/** Significant match tokens from a label: distinctive words (≥4 chars) + the full phrase. */
export function labelTokens(label: string): string[] {
  const toks = new Set<string>();
  for (const w of label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4) toks.add(w);
  }
  const full = label.trim().toLowerCase();
  if (full.length >= 4) toks.add(full);
  return [...toks];
}

/** Normalize a raw alias list: trim, dedupe, drop empties, cap. */
export function cleanAliases(aliases?: string[]): string[] | undefined {
  if (!aliases) return undefined;
  const out = [...new Set(aliases.map((a) => a.trim()).filter((a) => a.length >= 2))].slice(0, 12);
  return out.length > 0 ? out : undefined;
}

/**
 * Match tokens for an anchor = its label tokens PLUS every alias (each alias kept as
 * a whole phrase AND its distinctive words). So a person "the person" with aliases
 * ["girlfriend", "my girl"] matches memories that say "girlfriend", "my girl", OR
 * "the person" — letting VAGUE memories connect without the exact name.
 */
export function anchorMatchTokens(label: string, aliasesJson: string | null): string[] {
  const toks = new Set(labelTokens(label));
  if (aliasesJson) {
    try {
      const parsed: unknown = JSON.parse(aliasesJson);
      // Same coercion as listCognitive/parseTags: the column can hold any valid JSON
      // (a legacy bare string is not an array of aliases) — only a real array yields
      // alias tokens; anything else is ignored rather than iterated char-by-char.
      for (const a of Array.isArray(parsed) ? parsed : []) {
        const phrase = String(a).trim().toLowerCase();
        if (phrase.length >= 2) toks.add(phrase); // whole alias ("my girl")
        for (const w of phrase.split(/[^a-z0-9]+/)) if (w.length >= 4) toks.add(w);
      }
    } catch {
      /* ignore malformed */
    }
  }
  // Drop single everyday words (a name like "Will"/"May" must not match every memory
  // using that word). Multi-word phrases ("will smith", "my girl") are distinctive → kept.
  return [...toks].filter((t) => t.includes(" ") || !COMMON_WORDS.has(t));
}

/** Whole-word / phrase match (case-insensitive) so "Danny" doesn't hit "Dannyson". */
export function mentions(haystack: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(haystack);
}
