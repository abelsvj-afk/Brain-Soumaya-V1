/**
 * A tiny event contract between the Book's narration and the rest of the app (docs/specs/lore-narration-2026-10-30.md §4): while the lore is being read aloud the ambient bed
 * ducks, and comes back when it stops. Plain window events, so audio.ts needs no knowledge of the Book.
 */
export const NARRATION_EVENT = "story:narration";
/** The ambient bed's level while someone is being read to (a fraction of its normal level). */
export const NARRATION_DUCK = 0.2;

export function emitNarration(playing: boolean): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<{ playing: boolean }>(NARRATION_EVENT, { detail: { playing } }));
}

export function onNarration(cb: (playing: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => cb(!!(e as CustomEvent<{ playing: boolean }>).detail?.playing);
  window.addEventListener(NARRATION_EVENT, h);
  return () => window.removeEventListener(NARRATION_EVENT, h);
}

/** A new find that should be shown (and, if the player asked, read aloud) the moment it happens. */
export const REVEAL_EVENT = "story:reveal";
export function emitReveal(entryId: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<{ entryId: string }>(REVEAL_EVENT, { detail: { entryId } }));
}
