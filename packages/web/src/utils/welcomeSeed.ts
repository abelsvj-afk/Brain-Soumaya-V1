/**
 * The server seeds every brand-new brain with one warm welcome star
 * (server analysis/welcome.ts → label "The first light", type "daily").
 * It is Soumaya's memory, not the user's: first-run surfaces that ask
 * "has this person added anything yet?" must not count it, or a new user
 * never sees the empty-galaxy cue and gets every veteran-only prompt at once.
 */
export const WELCOME_SEED_LABEL = "The first light";

export function isWelcomeSeed(n: { label?: string | null; type?: string | null }): boolean {
  return n.label === WELCOME_SEED_LABEL && n.type === "daily";
}

/** Memories the user made themselves (excludes action items and the welcome seed). */
export function ownMemoryCount(nodes: ReadonlyArray<{ label?: string | null; type?: string | null; kind?: string | null }>): number {
  let c = 0;
  for (const n of nodes) if (n.kind !== "action" && !isWelcomeSeed(n)) c++;
  return c;
}
