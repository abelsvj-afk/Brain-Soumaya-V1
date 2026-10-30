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

/** Tier class (approved design §5; implementation design §3.1).
 *  Deliberately NOT named "class" and NOT related to RelicScarcityClass
 *  (the 7/3/1 copy-limit class further below). */
export type RelicTierClass = "keystone" | "seed" | "legacy";

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
  /** The relic's story, in plain words (lore §6 + buffs §3 hook).
   *  This is the L2 item description in the layered Codex (approved
   *  design §3); the field keeps its name — the layer mapping is what
   *  matters, not the identifier. */
  lore: string;
  /** L0 — the stirring fragment (approved design §3). Absent until the
   *  text is authored and owner-approved (O-R1); no code may treat an
   *  absent fragment as an empty one — the layer is simply unwritten. */
  loreStirring?: string;
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
  /** Tier class (approved design §5). null = unassigned — behaves
   *  exactly as relics do today (holdable, releasable, no exchange, no
   *  seed consumption) until the O-R5 worksheet assigns it. Only the two
   *  design-committed values are set (witness-without-a-name: keystone,
   *  unnumbered-fragment: legacy); the other thirteen ship null. */
  tierClass: RelicTierClass | null;
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: "keystone",
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: null,
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
    tierClass: "legacy",
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

// ---------------------------------------------------------------------------
// Relic vocabulary (implementation design §3) — anchor points, lore-layer
// structures, thread records, bearing sectors. DATA ONLY, shipped dark:
// no behavior reads these fields until later increments (I-2 anchors and
// copies, I-4 sampling/scan/claim, I-5 stirrings, I-6 exchange, I-7
// presentation). No lore text is authored here — the content pipeline
// (O-R1: King drafts, the owner approves every canon line) fills text
// into these structures; every mechanic is built to run with it absent.
// ---------------------------------------------------------------------------

/** One resting place of a relic, as a server-known fact (implementation
 *  design §3.2). The claim-time sampling the owner chose (R2-6) needs
 *  anchor coordinates the server can check — until this record, they
 *  existed only in the web's scene module. */
export interface RelicAnchorDef {
  /** Stable id, e.g. "harbor-nail:lower-rim". */
  anchorKey: string;
  /** The world this anchor rests in (always the relic's own world). */
  world: RelicWorld;
  /** Scene units, the relic's center — the same convention the web
   *  scene uses (the model is recentered on load). */
  position: readonly [number, number, number];
  /** Claim radius in scene units (tuning constant, §9 ruling 3). */
  radius: number;
  /** "the lower rim of the harbor" — the registry's own `place` words
   *  for the relic; display text and the scan's bearing fallback. */
  placeName: string;
  /** L1 — what this place has to do with the relic (approved design
   *  §3). Place text lives on the anchor, not the relic: a relic rests
   *  at different places over its life. Absent until authored and
   *  owner-approved (O-R1). */
  placeText?: string;
}

/** The claim radius for every anchor, in scene units — the I-1 starting
 *  tuning constant (implementation design §9 ruling 3: tuning stays
 *  centralized; I-4 validates sampling constants against real client
 *  flight before any of them may reject a claim). Anchors are relic
 *  centers and placed relics span 22 units, so 30 reads as "standing
 *  at the relic" on the worlds' scale (basin radius 320, wheel 210). */
export const RELIC_ANCHOR_RADIUS = 30;

// ---------------------------------------------------------------------------
// Relics I-4 — the hunt's tuning constants (implementation design §5.2/
// §5.3, owner ruling 3). ONE home for every sampling number: dwell,
// cooldown, freshness, speed caps, band edges. Tuning any of these is a
// data change here, never a logic change elsewhere.
// ---------------------------------------------------------------------------

/** Dwell: how long a hunter must settle inside an anchor's radius
 *  before a claim can land, measured between SERVER receipt stamps of
 *  the claim-start and claim-end samples (approved starting constant,
 *  ruling 3). A client-reported duration is never read. */
export const RELIC_DWELL_MS = 5_000;

/** Scan cooldown: the minimum interval between free pulses in a world
 *  (approved starting constant, ruling 3). A widened pulse waives it. */
export const RELIC_SCAN_COOLDOWN_MS = 3_000;

/** Freshness: a claim-start sample older than this cannot support a
 *  claim — the dwell must have ENDED recently, not just happened once. */
export const RELIC_SAMPLE_FRESHNESS_MS = 120_000;

/** Samples are validation evidence, not history: only the most recent
 *  this-many per (space, world) are kept (§4.7). */
export const RELIC_SAMPLE_KEEP = 20;

/** Plausibility slack, in world units, added to every sample-to-sample
 *  movement allowance (measurement noise is not cheating). */
export const RELIC_PLAUSIBILITY_SLACK_UNITS = 60;

/**
 * Whether the speed caps below may REJECT a claim. FALSE in I-4 —
 * observe-only (ruling 3: caps must be measured against actual client
 * flight before they may reject). The measurement, recorded in the I-4
 * gate record: the deploy branch has no client flight model at all
 * (worldFlight.ts exists only on main; this branch's world camera is
 * presentational), and main's burn model — peak speed
 * 3·dist/clamp(2400 + 1.2·dist, 2400, 6500)ms — reaches ≈451 u/s
 * (great-station), ≈576 (growing-place), ≈537 (deep-past), ≈908
 * (people) over this registry's anchor spans, with an instant-relocation
 * reduced-motion mode any fixed cap would falsely reject. Every claim
 * therefore COMPUTES and RECORDS its plausibility verdict on the
 * attempt receipt; nothing is rejected on speed until the branches
 * reconcile and a gated measurement against the real client flips this.
 */
export const RELIC_SPEED_CAPS_ENFORCED = false;

/** Per-world maximum plausible travel speed, world units per second —
 *  ≈2× the peak legitimate speeds measured from main's flight model
 *  over this registry's anchor spans (see RELIC_SPEED_CAPS_ENFORCED).
 *  The scale / quiet-archive values are UNMEASURED placeholders — no
 *  relic is anchored or discoverable in those worlds today — and must
 *  be measured like the others before enforcement ever flips on. */
export const RELIC_WORLD_SPEED_CAPS: Readonly<Record<RelicWorld, number>> = {
  "great-station": 1000,
  "growing-place": 1200,
  "deep-past": 1100,
  people: 1900,
  scale: 1000,
  "quiet-archive": 1000,
};

/** The scan's strength bands (approved design §4: Far / Warm / Near /
 *  Resonant). Resonant = inside the anchor's claim radius. A widened
 *  pulse reads the SAME distances through a finer ladder — Closing
 *  between Near and Warm, Fading between Warm and Far — finer
 *  granularity within the same information class (§5.3). */
export type RelicScanBand = "Resonant" | "Near" | "Closing" | "Warm" | "Fading" | "Far";

/** Per-world band edges, world units from the nearest anchor: Near at
 *  or below `near`, Warm at or below `warm`, Far beyond. Worlds differ
 *  wildly in scale (Station ~440 across its anchor span, the People
 *  field ~1140), so the edges are per-world (§5.3). */
export const RELIC_SCAN_BAND_EDGES: Readonly<Record<RelicWorld, { near: number; warm: number }>> = {
  "great-station": { near: 90, warm: 220 },
  "growing-place": { near: 130, warm: 300 },
  "deep-past": { near: 120, warm: 300 },
  people: { near: 200, warm: 570 },
  scale: { near: 90, warm: 220 },
  "quiet-archive": { near: 90, warm: 220 },
};

// ---------------------------------------------------------------------------
// Relics I-5 — stirring tuning (implementation design §4.6/§5.4, owner
// ruling 4). Same discipline as the I-4 block: one home for the number,
// and tuning it is a data change here, never a logic change elsewhere.
// ---------------------------------------------------------------------------

/** How long a stirring stays open — the window in which it promises
 *  its copy and shields it with the last-copy courtesy (approved
 *  starting constant, ruling 4: seven days — "a reasonable opportunity
 *  to hunt"). Server-computed from issuance; expiry is evaluated
 *  inside serialized transactions and at read time, never by a
 *  background sweeper. At most one AMBIENT stirring is open per
 *  (space, world) at a time (ruling 4); chart stirrings are exempt
 *  from that cap, never from eligibility. */
export const RELIC_STIRRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Server-known anchor SETS (I-2 expanded the I-1 single anchors per
 * implementation design §3.2). Each placed relic's FIRST entry is its
 * original resting place, lifted verbatim (evaluated) from the web
 * record (`packages/web/src/graph/relicAssets.ts` RELIC_ANCHORS), which
 * derives it from the world layout constants: Station wheel radius 210,
 * Garden top terrace 90 (+12 clearance), Deep Past basin floor −830
 * (+12), People field radius 560 (+10 at the edge). The web keeps
 * deriving its scene placement from those constants; the parity test in
 * `packages/web/src/graph/relicAssets.test.ts` asserts the scene anchor
 * and this record's first entry agree, so scene and server can never
 * silently drift.
 *
 * The additional entries are real resting places in the same worlds,
 * computed from the same layout constants (derivations noted per set),
 * spread across each world's named places, at least a claim diameter
 * (2 × RELIC_ANCHOR_RADIUS) apart within a set — copies are physical
 * (§4.2): several can rest at once, and a returning copy may never go
 * back to a place IT has already been (approved design §1), so a set
 * must hold at least the definition's copy limit (7 public, 3
 * Eternity-class) or at least 3 for private-class relics.
 *
 * An EMPTY array means unplaced (approved design §3.3): no stirrings,
 * no references, no claims until an O-R6 placement session gives the
 * relic a real resting place. No position is invented for the five
 * relics whose worlds are unbuilt — they keep empty sets, exactly as
 * they keep `discoverable: false`.
 */
export const RELIC_ANCHOR_POINTS: Readonly<
  Record<string, readonly RelicAnchorDef[]>
> = {
  // Great Station: the wheel rim (radius 210, top y = 38 — the first
  // anchor's convention), further seams ~0.9 rad apart (≈188 units of
  // arc). The mooring road: radius 220 at y = 14 (the first anchor
  // rests at radius ≈228), angles clear of the hero's mooring (0), the
  // docking arm (π/2) and the harbor controller's berth (3π/4).
  "harbor-nail": [
    {
      anchorKey: "harbor-nail:lower-rim",
      world: "great-station",
      position: [210, 38, 0],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the lower rim of the harbor, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-2",
      world: "great-station",
      position: [130.5, 38, 164.5],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-3",
      world: "great-station",
      position: [-47.7, 38, 204.5],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-4",
      world: "great-station",
      position: [-189.9, 38, 89.7],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-5",
      world: "great-station",
      position: [-188.3, 38, -92.9],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-6",
      world: "great-station",
      position: [-44.3, 38, -205.3],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
    {
      anchorKey: "harbor-nail:rim-seam-7",
      world: "great-station",
      position: [133.3, 38, -162.3],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the harbor's rim, set into an ancient seam",
    },
  ],
  "mooring-ring": [
    {
      anchorKey: "mooring-ring:harbor-road",
      world: "great-station",
      position: [214, 14, 78],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-2",
      world: "great-station",
      position: [89.9, 14, 200.8],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-3",
      world: "great-station",
      position: [-81.4, 14, 204.4],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-4",
      world: "great-station",
      position: [-216, 14, 41.9],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-5",
      world: "great-station",
      position: [-167.1, 14, -143.1],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-6",
      world: "great-station",
      position: [-13.7, 14, -219.6],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
    {
      anchorKey: "mooring-ring:road-7",
      world: "great-station",
      position: [148, 14, -162.8],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "where the harbor's stone meets the open road",
    },
  ],
  // The Growing Place: the terraces (gardenLayout: radii
  // 900/780/660/540/400/250, heights 0/18/36/54/72/90; anchors rest at
  // terrace height + 12, the first anchors' convention). Extra rests
  // sit on the crown terrace (radius 250) and the terraces below.
  "dawn-leaf": [
    {
      anchorKey: "dawn-leaf:witness-roots",
      world: "growing-place",
      position: [-34, 102, 22],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "near the roots of the witness tree",
    },
    {
      anchorKey: "dawn-leaf:terrace-five",
      world: "growing-place",
      position: [150, 102, -140],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the top terrace of the Growing Place",
    },
    {
      anchorKey: "dawn-leaf:terrace-four",
      world: "growing-place",
      position: [-260, 84, 180],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "a lower terrace of the Growing Place",
    },
  ],
  "witness-seed": [
    {
      anchorKey: "witness-seed:trunk-base",
      world: "growing-place",
      position: [26, 102, 14],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "beneath the witness tree, at the trunk's base",
    },
    {
      anchorKey: "witness-seed:terrace-five",
      world: "growing-place",
      position: [-170, 102, -110],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the top terrace of the Growing Place",
    },
    {
      anchorKey: "witness-seed:terrace-three",
      world: "growing-place",
      position: [300, 66, 260],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "a lower terrace of the Growing Place",
    },
  ],
  // The Deep Past: the basin floor (−830 + 12) inside the basin radius
  // (320); the lantern's alcove band at the lowest stratum (y = −712,
  // radius ~270–285, inside the strata arc 0.85–5.25 rad).
  "first-light-shard": [
    {
      anchorKey: "first-light-shard:basin-floor",
      world: "deep-past",
      position: [120, -818, 80],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "near the First Light basin",
    },
    {
      anchorKey: "first-light-shard:basin-west",
      world: "deep-past",
      position: [-60, -818, 210],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "near the First Light basin",
    },
    {
      anchorKey: "first-light-shard:basin-south",
      world: "deep-past",
      position: [40, -818, -230],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "near the First Light basin",
    },
  ],
  "basin-stone": [
    {
      anchorKey: "basin-stone:basin-floor",
      world: "deep-past",
      position: [-140, -818, 60],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "on the floor of the basin",
    },
    {
      anchorKey: "basin-stone:basin-east",
      world: "deep-past",
      position: [210, -818, 150],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "on the floor of the basin",
    },
    {
      anchorKey: "basin-stone:basin-south",
      world: "deep-past",
      position: [-20, -818, -215],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "on the floor of the basin",
    },
  ],
  "lantern-of-keeping": [
    {
      anchorKey: "lantern-of-keeping:lowest-alcove",
      world: "deep-past",
      position: [150, -712, 242],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "in a lowest-stratum alcove above the basin",
    },
    {
      anchorKey: "lantern-of-keeping:alcove-2",
      world: "deep-past",
      position: [-231.4, -712, 139.2],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "in a lowest-stratum alcove above the basin",
    },
    {
      anchorKey: "lantern-of-keeping:alcove-3",
      world: "deep-past",
      position: [-81.8, -712, -253.1],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "in a lowest-stratum alcove above the basin",
    },
  ],
  "witness-without-a-name": [
    {
      anchorKey: "witness-without-a-name:basin-center",
      world: "deep-past",
      position: [0, -818, 0],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the lowest stratum, at the First Light basin",
    },
    {
      anchorKey: "witness-without-a-name:basin-east",
      world: "deep-past",
      position: [180, -818, -120],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the lowest stratum, at the First Light basin",
    },
    {
      anchorKey: "witness-without-a-name:basin-west",
      world: "deep-past",
      position: [-190, -818, -140],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "the lowest stratum, at the First Light basin",
    },
  ],
  // People: the field's heart (the first Ember anchor) and its rim —
  // radius 570 (field radius 560 + 10, the first Thread anchor's
  // convention), clear of the farthest orbiting light (540) and the
  // dressing ships (620+), on ground that runs to radius 600.
  "hearth-ember": [
    {
      anchorKey: "hearth-ember:first-hearths",
      world: "people",
      position: [0, 12, 0],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "near the first hearths",
    },
    {
      anchorKey: "hearth-ember:field-rim-2",
      world: "people",
      position: [-287.8, 12, 492],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "at the rim of the field of hearths",
    },
    {
      anchorKey: "hearth-ember:field-rim-3",
      world: "people",
      position: [-279.4, 12, -496.8],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "at the rim of the field of hearths",
    },
  ],
  "thread-of-many": [
    {
      anchorKey: "thread-of-many:field-edge",
      world: "people",
      position: [570, 12, 0],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "between the stones of the hearths",
    },
    {
      anchorKey: "thread-of-many:field-rim-2",
      world: "people",
      position: [283.6, 12, 494.4],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "at the field's rim, where the paths meet the dark",
    },
    {
      anchorKey: "thread-of-many:field-rim-3",
      world: "people",
      position: [287, 12, -492.5],
      radius: RELIC_ANCHOR_RADIUS,
      placeName: "at the field's rim, where the paths meet the dark",
    },
  ],
  "star-hanger": [],
  "sunward-compass": [],
  "stillness-seal": [],
  "unopened-fold": [],
  "unnumbered-fragment": [],
};

/** A thread between two relics (approved design §3.3): the Codex's
 *  cross-reference layer, L3. A thread's text can be REVEALED only when
 *  it is authored (`text` present) AND owner-approved AND the other
 *  member is placed (non-empty anchor set) — unauthored or unapproved
 *  text is indistinguishable from unwritten text to every reader, so
 *  future content cannot leak through a half-filled record. */
export interface RelicThreadDef {
  threadId: string;
  relicA: string;
  relicB: string;
  /** Unlock condition for the pair: "discovery" (the default — personal
   *  discovery of both) or the stricter authored "held". */
  condition: "discovery" | "held";
  /** The thread text — absent until authored (content pipeline). */
  text?: string;
  /** O-R1: owner-approved canon only. */
  approved: boolean;
}

/** No threads are authored yet — structure only (O-R1). */
export const RELIC_THREADS: readonly RelicThreadDef[] = [];

/** Bearing sector labels per world (implementation design §3.3): eight
 *  authored phrases per world, filled by the content pipeline and
 *  approved like all canon. Shipped empty — the scan's bearing falls
 *  back to the anchor's `placeName` until a world's sectors exist. */
export const WORLD_BEARING_SECTORS: Readonly<
  Record<RelicWorld, readonly string[]>
> = {
  "great-station": [],
  "growing-place": [],
  "deep-past": [],
  people: [],
  scale: [],
  "quiet-archive": [],
};

// ---------------------------------------------------------------------------
// Relic Buffs v2 (design note v2 §§5, 10, 11) — data beside the registry.
// This stays data only: no buffed value is ever stored anywhere; the server
// computes effective values fresh from the held set on every read.
// ---------------------------------------------------------------------------

export type RelicScarcityClass = "public" | "eternity" | "private";
export interface RelicCopyLimit { scarcityClass: RelicScarcityClass; /** null = 1 per brain, enforced by the holdings primary key. */ limit: number | null; }
export const RELIC_COPY_LIMITS: Readonly<Record<string, RelicCopyLimit>> = {
  "harbor-nail": { scarcityClass: "public", limit: 7 },
  "mooring-ring": { scarcityClass: "public", limit: 7 },
  "dawn-leaf": { scarcityClass: "private", limit: null },
  "witness-seed": { scarcityClass: "private", limit: null },
  "first-light-shard": { scarcityClass: "private", limit: null },
  "basin-stone": { scarcityClass: "private", limit: null },
  "lantern-of-keeping": { scarcityClass: "private", limit: null },
  "witness-without-a-name": { scarcityClass: "eternity", limit: 3 },
  "hearth-ember": { scarcityClass: "private", limit: null },
  "thread-of-many": { scarcityClass: "private", limit: null },
  "star-hanger": { scarcityClass: "public", limit: 7 },
  "sunward-compass": { scarcityClass: "public", limit: 7 },
  "stillness-seal": { scarcityClass: "private", limit: null },
  "unopened-fold": { scarcityClass: "private", limit: null },
  "unnumbered-fragment": { scarcityClass: "eternity", limit: 3 },
};

export const MAX_HELD_RELICS = 3;
export const RELIC_BASE = { fuelCap: 200, fuelRegenPerHour: 3.5, reviewEarn: 3, linkEarn: 2, discoveryEarn: 4, driftBonus: 3, driftDailyCap: 2, riseWindowDays: 30 } as const;
export const REVIEW_EARN_FLOOR = 1;
export const FUEL_REGEN_FLOOR_PER_HOUR = 0.5;
export const DRIFT_BONUS_FLOOR = 1;
export const GROWTH_MULTIPLIER_FLOOR = 0.25;

export type RelicBlessingStatus = "live" | "cut" | "gate-key";
export interface RelicBlessing { status: RelicBlessingStatus; giftPlain: string; costPlain: string; cutReason?: string; }
export const RELIC_BLESSINGS: Readonly<Record<string, RelicBlessing>> = {
  "harbor-nail": { status: "live", giftPlain: "Your fuel tank holds 225 instead of 200.", costPlain: "Review earnings are 1 less while you hold it." },
  "mooring-ring": { status: "live", giftPlain: "Drift journeys pay 4 instead of 3, and up to 3 drift bonuses can pay in a day instead of 2.", costPlain: "No trade-off." },
  "dawn-leaf": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — the app has no way for partial milestones to feed progress, so there is nothing for it to change." },
  "witness-seed": { status: "live", giftPlain: "Memories from the last 45 days can rise in the Deep Past, instead of 30.", costPlain: "Progress increases grow more slowly (three quarters of the usual step) while you hold it." },
  "first-light-shard": { status: "live", giftPlain: "Review earnings are 1 more.", costPlain: "The mood curve is shown with its swings a little larger — only how it looks changes, never what is stored." },
  "basin-stone": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — the app has no way to soften swings from particular memories, and a trade-off on its own would only be a cost." },
  "lantern-of-keeping": { status: "live", giftPlain: "Memories from the last 45 days can rise in the Deep Past, and a risen memory stays risen for the rest of the visit.", costPlain: "Progress increases grow more slowly (three quarters of the usual step) while you hold it." },
  "witness-without-a-name": { status: "gate-key", giftPlain: "It is the key to Eternity's gate — with any two other relics found, the way can open.", costPlain: "No trade-off." },
  "hearth-ember": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — progress already counts for each goal and skill on its own, and there is no combined growth signal for it to feed." },
  "thread-of-many": { status: "live", giftPlain: "Link earnings pay 4 per link instead of 2.", costPlain: "Memories from only the last 20 days can rise in the Deep Past while you hold it (if it is the most recently held relic that sets the window)." },
  "star-hanger": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — there is no Alignment measure in the app for it to speed up." },
  "sunward-compass": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — travelling never changes emotional weight, so there is nothing for it to steady." },
  "stillness-seal": { status: "live", giftPlain: "Fuel returns faster — 5 per hour instead of 3.5.", costPlain: "Review earnings are 1 less while you hold it." },
  "unopened-fold": { status: "live", giftPlain: "Discovery earnings pay 6 instead of 4.", costPlain: "Progress increases grow more slowly (three quarters of the usual step) while you hold it." },
  "unnumbered-fragment": { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — there is no Alignment measure in the app for it to speed up." },
};

/** RETIRED (Relics I-2): the synthetic anchor pools (`RELIC_ANCHORS`,
 * `nextRelicAnchor`, `firstRelicAnchor`) are gone. Placement is per
 * physical copy now: real anchor sets live in RELIC_ANCHOR_POINTS
 * above, and a returning copy's next resting place is chosen from its
 * own placement history (the relic_copy_events chain), never by
 * per-definition rotation (implementation design §6, fix (c)). */

export interface EffectiveRelicBuffs {
  fuelCap: number; fuelRegenPerHour: number; reviewEarn: number; linkEarn: number; discoveryEarn: number;
  driftBonus: number; driftDailyCap: number; riseWindowDays: number;
  riseWindowSetBy: string | null; riseWindowOverruled: string[];
  growthMultiplier: number; emotionalSwingMultiplier: number; risenHold: boolean;
}
export interface RelicHoldingView { relicId: string; name: string; held: boolean; testOnly: boolean; anchorKey: string; blessing: RelicBlessing; }
export interface RelicReturnView { relicId: string; name: string; reason: "release" | "brain-deleted"; fromAnchor: string | null; toAnchor: string | null; }
export interface RelicGateView { open: boolean; openedBefore: boolean; missingPlain: string; }
export interface RelicsStateView {
  found: string[]; held: string[]; holdings: RelicHoldingView[]; buffs: EffectiveRelicBuffs;
  gate: RelicGateView; recentDepartures: RelicReturnView[]; isOwnerSpace: boolean; scarcityOff: boolean;
  currentAnchorByRelic: Record<string, string>;
}
