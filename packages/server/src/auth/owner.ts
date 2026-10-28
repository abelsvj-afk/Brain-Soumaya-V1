/**
 * Owner access — the deployment owner's brain(s) are exempt from the
 * worlds' ACCESS gates (the People gate, Eternity's relic gate and its
 * three-leg chain), which are earned-progression gates for everyone else.
 *
 * Configured by the OWNER_SPACE_IDS secret (comma-separated space ids),
 * read on every call so a `fly secrets set` takes effect on restart with
 * no code change and tests can flip it per case. It is deliberately keyed
 * on the space id, not the gamer tag: a tag can be re-registered by
 * anyone once its owner deletes or renames the account, whereas a space
 * id is an unguessable bearer key that must already exist. Unset or empty
 * means nobody is exempt — the default, so an unconfigured deployment
 * behaves exactly as before. The id never leaves the server: callers get a
 * boolean, and nothing client-side decides access.
 *
 * What this does NOT bypass: fuel (the economy — warp costs, and drift is
 * always free), and any gate on another person's brain. It lifts progression
 * gates on the owner's own brain only.
 */
export function isOwnerSpace(spaceId: string): boolean {
  const raw = process.env.OWNER_SPACE_IDS;
  if (!raw || !spaceId) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(spaceId);
}
