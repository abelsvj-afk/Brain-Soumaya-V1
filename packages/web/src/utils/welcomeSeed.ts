/**
 * First-run helpers (UX review #3). Every brand-new brain is seeded by the server
 * with one warm welcome star (server analysis/welcome.ts, `origin: "agent"`), and
 * Soumaya later charts her own hubs/beliefs (also `origin: "agent"`). Those are
 * hers, not the user's: first-run surfaces that ask "has this person added
 * anything yet?" must not count them, or a new user never sees the empty-galaxy
 * cue and gets every veteran-only prompt at once. Authorship is read from
 * `origin` — never from a label, which a user's own note could share.
 */
type Authored = { origin?: string | null; kind?: string | null };

/** True for anything the user made themselves (memories AND action items/to-dos). */
export function isOwnContent(n: Authored): boolean {
  return n.origin !== "agent";
}

/** How many things the user has added themselves (memories + action items). */
export function ownContentCount(nodes: ReadonlyArray<Authored>): number {
  let c = 0;
  for (const n of nodes) if (isOwnContent(n)) c++;
  return c;
}

/** Whether Soumaya's seeded/charted stars are in the sky (the welcome star etc.). */
export function hasAgentStar(nodes: ReadonlyArray<Authored>): boolean {
  return nodes.some((n) => n.origin === "agent" && n.kind !== "action");
}
