import { QUIET_ARCHIVE_SEED } from "./quietArchiveLayout.js";
import type { QuietArchiveLightForm } from "./quietArchiveLayout.js";

/**
 * The Quiet/Archive asset layer (Phase 3, Wave 2) — the single source of
 * truth for what a resting lamp is made of. It follows the peopleAssets.ts
 * pattern (one manifest, named forms, measured geometry) with the same
 * deliberate difference: Quiet/Archive ships NO external asset.
 *
 * - No GLB, no texture, no audio file: the field is procedural — dim
 *   geometry, baked glow, and the HYG starfield the Station, the garden,
 *   the Deep Past, and the People already credit. There is nothing new
 *   to license, so `public/CREDITS.md` and `WorldCredits` are unchanged
 *   by this build.
 * - No procedural stand-in as final art: these forms ARE the final art.
 *   An archived memory is a small steady lamp because rest is a small
 *   steady light in this world — not because a real model is missing.
 *   Nothing here pretends to be a person: no faces, no figures, no
 *   silhouettes. A cluster's presence is a lamp-glow, never a body.
 * - No relic meshes: the Stillness Seal and the Unopened Fold rest at
 *   the layout's relic spots as coordinates only. Their slim GLBs land
 *   with the relics increment (GitHub web UI), and the relic registry
 *   flips them discoverable then. This world renders no relic it does
 *   not hold.
 *
 * The palette (R-Q2, recipe-quiet-archive.md): dim cool stillness, soft
 * low lamplight. Every lamp carries the same light — the forms below
 * differ by KIND only, never by rank, recency, or importance.
 */

/** The recipe seed, shared with the layout so scene and layout can never drift apart. */
export { QUIET_ARCHIVE_SEED };

/** Dim cool stillness (R-Q2). Distinct on sight from harbor amber
 *  (industrial, horizontal), garden dawn (green, upward), Deep Past
 *  violet (vertical, quiet), and People amber (warm, near): this world
 *  is slate, low, and still. */
export const QUIET_ARCHIVE_PALETTE = {
  /** The field itself: dim cool stone, like still water at night. */
  ground: 0x141a22,
  /** The lamp at a cluster's heart — soft low lamplight, every cluster the same. */
  lamp: 0xd8c9a3,
  /** Archived memories: the same soft lamplight, every memory. */
  memory: 0xd8c9a3,
  /** Dates that matter: a slightly deeper gold, so a date reads as a date. */
  date: 0xc9a86a,
  /** Rested threads: pale gold — a thread laid down, never nagging. */
  thread: 0xe8dcc0,
  /** Gathering hubs: cool cream. */
  gathering: 0xe6e0d2,
  /** Bridges of light between clusters that share an archived memory. */
  bridge: 0xd8c9a3,
  /** The air above the field: faint cool motes, barely there. */
  motes: 0x8fa3b8,
  /** Guidance light, gate-side only — cyan always means navigation truth. */
  guidance: 0x7af9ff,
  /** The low still threshold: dim slate posts, pale cyan lintel light. */
  thresholdPost: 0x2a3442,
  thresholdLight: 0x9fd8e0,
} as const;

/** One form per light kind — geometry params the scene builds from.
 *  Triangle counts are the measured cost of one instance (the scene test
 *  asserts the whole field against the recipe budget). */
export const QUIET_ARCHIVE_FORMS: Record<
  QuietArchiveLightForm,
  { geometry: "sphere" | "ring" | "cone" | "gathering-ring"; radius: number; trisPerInstance: number }
> = {
  memory: { geometry: "sphere", radius: 2.2, trisPerInstance: 96 },
  date: { geometry: "ring", radius: 3.4, trisPerInstance: 120 },
  thread: { geometry: "cone", radius: 2.0, trisPerInstance: 15 },
  gathering: { geometry: "gathering-ring", radius: 4.5, trisPerInstance: 144 },
};
