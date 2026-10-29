/**
 * The relic registry — the SINGLE SOURCE OF TRUTH for the fifteen relics.
 *
 * Lore ground: `docs/worlds/eternity-lore.md` §6 (the relic register) and
 * `docs/worlds/relic-buffs-design-note.md` §3 (the lore hook per relic).
 * Placements follow the lore register; the two Eternity relics were placed
 * by the build-all delegation (Witness → Deep Past basin, Unnumbered
 * Fragment → Scale). Worlds that do not exist in the app yet (Scale,
 * Quiet/Archive) carry their relics with `discoverable: false` — the
 * registry entry is real, the find waits for its world. People opened
 * with PR #114 (2026-10-27), so the Hearth Ember and the Thread of Many
 * are discoverable there now — the rebase onto tip 0a169f59 wired them
 * per the record's own Unnumbered Fragment precedent.
 *
 * The BUFF EFFECTS are a separate increment (the buffs note stays DRAFT,
 * Review 30 NOT READY). This registry carries no buff numbers — only lore,
 * placement, the gate-credential flag, and the asset facts measured from
 * the slim GLBs (Draco, 1 mesh / 1 material each; tri counts are
 * index-based, measured from the shipped files).
 *
 * Asset convention: `/relics/<slug>-slim.glb` (public/relics/) — fifteen
 * files share one folder, following the existing `public/Textures/`
 * precedent for a multi-file set. The GLBs land via the GitHub web UI
 * (binaries cannot ride the API push); until they land, a relic's load
 * resolves null and its find is never offered.
 */

/** The six worlds a relic can belong to. Eternity has no relic placed in
 *  his world — his two relics live in the Deep Past and the Scale Space. */
export type RelicWorld =
  | "great-station"
  | "growing-place"
  | "deep-past"
  | "people"
  | "scale"
  | "quiet-archive";

export interface RelicDef {
  /** Slug — also the codex key suffix (`relic-<id>`) and the asset name. */
  id: string;
  /** Display name, as the Codex shows it. */
  name: string;
  /** The world the relic rests in. */
  world: RelicWorld;
  /** Plain display name of that world. */
  worldName: string;
  /** Where in the world, in plain words ("the lower rim of the harbor"). */
  place: string;
  /** Short glimmer phrase for the in-world find line ("by the harbor's lower rim"). */
  glimmer: string;
  /** The relic's story, in plain words (lore §6 + buffs §3 hook). */
  lore: string;
  /** Public URL of the slim GLB. */
  assetUrl: string;
  /** Triangles of the shipped slim, index-based, measured from the file. */
  tris: number;
  /** Material / glow treatment already in the file, in plain words. */
  glow: string;
  /** B-01: the Witness Without a Name is the gate key — the only relic
   *  with this flag. The gate opens for a traveler holding the key plus
   *  any two other relics, and stays open to them after that. */
  gateKey: boolean;
  /** False when the relic's world does not exist in the app yet — the
   *  registry entry is real, but no find can happen until its world opens. */
  discoverable: boolean;
  /** Codex icon (shown once discovered; locked entries show 🔒). */
  icon: string;
}

export const RELICS: readonly RelicDef[] = [
  {
    id: "harbor-nail",
    name: "The Harbor Nail",
    world: "great-station",
    worldName: "The Great Station",
    place: "the lower rim of the harbor, set into an ancient seam",
    glimmer: "by the harbor's lower rim",
    lore: "The oldest Station fragment: a nail set into the harbor's first seam. It held no ship and carried no banner — it marked the place where arrival became possible.",
    assetUrl: "/relics/harbor-nail-slim.glb",
    tris: 14282,
    glow: "bare metal, no glow",
    gateKey: false,
    discoverable: true,
    icon: "🔩",
  },
  {
    id: "mooring-ring",
    name: "The Mooring Ring",
    world: "great-station",
    worldName: "The Great Station",
    place: "where the harbor's stone meets the open road",
    glimmer: "where the harbor meets the open road",
    lore: "A dark ring of metal found where the harbor's stone meets the open road. One account says it was placed there so a traveler could pause without being told to depart again. Another says nothing was ever tied to it.",
    assetUrl: "/relics/mooring-ring-slim.glb",
    tris: 14999,
    glow: "bare metal, no glow",
    gateKey: false,
    discoverable: true,
    icon: "⚓",
  },
  {
    id: "dawn-leaf",
    name: "The Dawn Leaf",
    world: "growing-place",
    worldName: "The Growing Place",
    place: "near the roots of the witness tree",
    glimmer: "near the witness tree's roots",
    lore: "A leaf kept near the tree's roots, its veins still holding the colors of a dawn that never finishes becoming day. It is a reminder that growth counts before it arrives anywhere final.",
    assetUrl: "/relics/dawn-leaf-slim.glb",
    tris: 17537,
    glow: "the leaf's own dawn colors, no added glow",
    gateKey: false,
    discoverable: true,
    icon: "🍃",
  },
  {
    id: "witness-seed",
    name: "The Witness Seed",
    world: "growing-place",
    worldName: "The Growing Place",
    place: "beneath the witness tree, at the trunk's base",
    glimmer: "beneath the witness tree",
    lore: "A seed-shaped relic found beneath the witness tree. It is not the tree, and it never promised to become one — it keeps the possibility of becoming, nothing more.",
    assetUrl: "/relics/witness-seed-slim.glb",
    tris: 14522,
    glow: "bare, no glow",
    gateKey: false,
    discoverable: true,
    icon: "🌱",
  },
  {
    id: "first-light-shard",
    name: "The First Light Shard",
    world: "deep-past",
    worldName: "The Deep Past",
    place: "near the First Light basin",
    glimmer: "near the First Light basin",
    lore: "A pale fragment kept near the First Light basin. Some accounts call it the earliest light kept in matter; others insist it is only a trace of the light, not the light itself. The difference is never settled.",
    assetUrl: "/relics/first-light-shard-slim.glb",
    tris: 14495,
    glow: "pale and see-through, with a warm-white light inside (as made: transmission 0.45, glow 2.0)",
    gateKey: false,
    discoverable: true,
    icon: "💎",
  },
  {
    id: "basin-stone",
    name: "The Basin Stone",
    world: "deep-past",
    worldName: "The Deep Past",
    place: "on the floor of the basin",
    glimmer: "on the basin floor",
    lore: "A dark stone from the floor of the basin, its surface marked with shallow lines like waterlines. The marks have been read as the levels of forgotten waters, though no account records a flood. It belongs to the story of keeping, not of loss.",
    assetUrl: "/relics/basin-stone-slim.glb",
    tris: 15000,
    glow: "bare stone, no glow",
    gateKey: false,
    discoverable: true,
    icon: "🪨",
  },
  {
    id: "lantern-of-keeping",
    name: "The Lantern of Keeping",
    world: "deep-past",
    worldName: "The Deep Past",
    place: "in a lowest-stratum alcove above the basin",
    glimmer: "in a low alcove above the basin",
    lore: "A small sealed lantern from the alcoves. Its light is quiet rather than bright, as if it were meant to make something present without forcing it into view. Keeping need not mean disturbing.",
    assetUrl: "/relics/lantern-of-keeping-slim.glb",
    tris: 15000,
    glow: "a warm light inside (as made: glow 1.5)",
    gateKey: false,
    discoverable: true,
    icon: "🏮",
  },
  {
    id: "witness-without-a-name",
    name: "The Witness Without a Name",
    world: "deep-past",
    worldName: "The Deep Past",
    place: "the lowest stratum, at the First Light basin",
    glimmer: "at the very bottom, in the First Light",
    lore: "A smooth, pale object from the oldest accounts of the first making. It has no surviving name in any language — the name used here is only a convenience for the Codex. It marks the boundary between the one who makes and the worlds that remember him, without explaining that boundary. It is the key to Eternity's gate: with any two other relics, it opens the way.",
    assetUrl: "/relics/witness-without-a-name-slim.glb",
    tris: 15002,
    glow: "pale, no glow",
    gateKey: true,
    discoverable: true,
    icon: "🗝️",
  },
  {
    id: "hearth-ember",
    name: "The Hearth Ember",
    world: "people",
    worldName: "People",
    place: "near the first hearths",
    glimmer: "near the first hearths",
    lore: "A coal-like fragment from where the first hearths were set. It gives off a low warmth without consuming itself — love given a place to live outside the mind that remembers it.",
    assetUrl: "/relics/hearth-ember-slim.glb",
    tris: 15881,
    glow: "a low amber glow in its cracks (as made: glow 2.0)",
    gateKey: false,
    discoverable: true,
    icon: "🔥",
  },
  {
    id: "thread-of-many",
    name: "The Thread of Many",
    world: "people",
    worldName: "People",
    place: "between the stones of the hearths",
    glimmer: "between the stones of the hearths",
    lore: "A fine, unbroken thread found between the stones of the hearths. It is said to have passed from one hearth to another without joining them into a single flame — connection without confusing one life with another.",
    assetUrl: "/relics/thread-of-many-slim.glb",
    tris: 22500,
    glow: "bare thread, no glow",
    gateKey: false,
    discoverable: true,
    icon: "🧵",
  },
  {
    id: "star-hanger",
    name: "The Star Hanger",
    world: "scale",
    worldName: "The Scale Space",
    place: "where the stars were given their places",
    glimmer: "where the stars were given their places",
    lore: "A small curved fragment from the moment the stars were hung. It resembles a hook, but no account says it was used to suspend any one star. It belongs to the image of a universe given room to be seen.",
    assetUrl: "/relics/star-hanger-slim.glb",
    tris: 14999,
    glow: "bare metal, no glow",
    gateKey: false,
    discoverable: false,
    icon: "🌟",
  },
  {
    id: "sunward-compass",
    name: "The Sunward Compass",
    world: "scale",
    worldName: "The Scale Space",
    place: "along the sun's long road",
    glimmer: "along the sun's long road",
    lore: "A round instrument with no ordinary needle, found along the sun's long road. Its center stays fixed while its markings suggest motion around it. Some call it a compass; others deny it points anywhere.",
    assetUrl: "/relics/sunward-compass-slim.glb",
    tris: 14390,
    glow: "bare metal, no glow",
    gateKey: false,
    discoverable: false,
    icon: "🧭",
  },
  {
    id: "stillness-seal",
    name: "The Stillness Seal",
    world: "quiet-archive",
    worldName: "The Quiet Archive",
    place: "at the threshold of a quiet alcove",
    glimmer: "at the threshold of a quiet alcove",
    lore: "A smooth, dark seal from the threshold of a quiet alcove. It bears no command and no warning. It speaks of the difference between keeping something safe and calling it back into view: rest is not the same as erasure.",
    assetUrl: "/relics/stillness-seal-slim.glb",
    tris: 14367,
    glow: "bare, no glow",
    gateKey: false,
    discoverable: false,
    icon: "🕯️",
  },
  {
    id: "unopened-fold",
    name: "The Unopened Fold",
    world: "quiet-archive",
    worldName: "The Quiet Archive",
    place: "kept in the Archive, unopened",
    glimmer: "kept in the Archive, unopened",
    lore: "A small folded object kept in the Archive, its material like paper without behaving exactly like it. No account says what is inside. It is not a test of curiosity: its meaning is the permission to keep something without opening it.",
    assetUrl: "/relics/unopened-fold-slim.glb",
    tris: 22500,
    glow: "bare, no glow",
    gateKey: false,
    discoverable: false,
    icon: "✉️",
  },
  {
    id: "unnumbered-fragment",
    name: "The Unnumbered Fragment",
    world: "scale",
    worldName: "The Scale Space",
    place: "in the vast uncounted space",
    glimmer: "in the vast uncounted space",
    lore: "A small, translucent fragment that no world claims as its own. Its inscription refuses to assign a date, an age, or a beginning to its maker — a fragment of the created record struggling to describe the uncreated.",
    assetUrl: "/relics/unnumbered-fragment-slim.glb",
    tris: 15000,
    glow: "a pale glow inside (as made: glow 1.5)",
    gateKey: false,
    discoverable: false,
    icon: "🔮",
  },
];

export const RELIC_BY_ID: ReadonlyMap<string, RelicDef> = new Map(
  RELICS.map((r) => [r.id, r]),
);

/** The Codex entry id for a relic (`relic-<slug>`). */
export function relicCodexKey(id: string): string {
  return `relic-${id}`;
}

/** Every relic Codex key (the claimable set — see CODEX_STATIC_KEYS). */
export const RELIC_CODEX_KEYS: readonly string[] = RELICS.map((r) =>
  relicCodexKey(r.id),
);

/** The relics resting in one world, in registry order. */
export function relicsForWorld(world: RelicWorld): RelicDef[] {
  return RELICS.filter((r) => r.world === world);
}

/** The relics a traveler can actually find today — their worlds exist. */
export function discoverableRelics(): RelicDef[] {
  return RELICS.filter((r) => r.discoverable);
}

/**
 * B-01 (settled): the gate to Eternity's world opens for a traveler
 * holding the Witness Without a Name (the key) plus any two other relics.
 * Once opened, the gate stays open to that traveler — the permanence is
 * travel-layer state, recorded when the gate first opens; this function
 * answers only whether a set of held relics opens it. Holding relics is
 * never a score and never required for anything but this gate.
 */
export function eternityGateOpen(
  held: ReadonlySet<string> | readonly string[],
): boolean {
  const set = held instanceof Set ? held : new Set(held);
  if (!set.has("witness-without-a-name")) return false;
  let others = 0;
  for (const id of set) {
    if (id !== "witness-without-a-name" && RELIC_BY_ID.has(id)) others++;
  }
  return others >= 2;
}
