/**
 * Captions that follow the voice (docs/specs/lore-narration-2026-10-30.md §5). Sentence-level, not per word: the voice's progress (0..1) is mapped onto the sentences by how much
 * speech each holds, so the sentence being read is the one marked. The words are always on screen, so this is a reading aid and never the only carrier of meaning.
 */

/** Split into sentences, keeping the punctuation with each. Never drops or reorders text: joining the parts reproduces the input (modulo single spaces). */
export function splitCaptionSentences(text: string): string[] {
  const out = text.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*|$)/g) ?? [];
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Which sentence is being spoken at `fraction` (0..1) of the whole, weighting each by its length. -1 before it starts or when not speaking. */
export function sentenceAt(sentences: readonly string[], fraction: number | null): number {
  if (fraction === null || !Number.isFinite(fraction) || fraction < 0 || sentences.length === 0) return -1;
  const total = sentences.reduce((n, s) => n + s.length, 0);
  if (total === 0) return -1;
  const at = Math.min(0.9999, fraction) * total;
  let run = 0;
  for (let i = 0; i < sentences.length; i++) {
    run += sentences[i]!.length;
    if (at < run) return i;
  }
  return sentences.length - 1;
}

/** A rough reading time for the browser-voice fallback, which cannot report its progress: about 14 characters a second at the narrator's slow pace. */
export const FALLBACK_CHARS_PER_SECOND = 14;
