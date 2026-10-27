import { PEOPLE_SEED } from "./peopleLayout.js";
import type { PeopleLightForm } from "./peopleLayout.js";

/**
 * The People's asset layer (Phase 3, P3-3) — the single source of truth
 * for what a cluster is made of. It follows the stationAssets.ts pattern
 * (one manifest, named forms, measured geometry) with one deliberate
 * difference: People ships NO external asset.
 *
 * - No GLB, no texture, no audio file: the field is procedural — warm
 *   geometry, baked glow, and the HYG starfield the Station, the garden,
 *   and the Deep Past already credit. There is nothing new to license,
 *   so `public/CREDITS.md` and `WorldCredits` are unchanged by P3-3.
 * - No procedural stand-in as final art: these forms ARE the final art.
 *   A memory-light is a small warm sphere because a memory is a small
 *   warm light in this world — not because a real model is missing.
 *   Nothing here pretends to be a person: no faces, no figures, no
 *   silhouettes. A cluster's presence is a hearth-glow, never a body.
 *
 * The palette (Q6, recipe-people.md): warm clustered orbits, amber-warm
 * light on dark. Every cluster carries the same light — the forms below
 * differ by KIND only, never by rank.
 */

/** The recipe seed, shared with the layout so scene and layout can never drift apart. */
export { PEOPLE_SEED };

/** Amber-warm light on dark (Q6). Distinct on sight from harbor amber
 *  (industrial, horizontal), garden dawn (green, upward), and Deep Past
 *  violet (vertical, quiet): this world is amber, low, and near. */
export const PEOPLE_PALETTE = {
  /** The field itself: warm dark ground, like a neighborhood at dusk. */
  ground: 0x1a120c,
  /** The hearth at a cluster's heart. */
  hearth: 0xffc98a,
  /** Memory-lights: the same warm amber, every person, every memory. */
  memory: 0xffd9a0,
  /** Dates that matter: a slightly deeper gold, so a date reads as a date. */
  date: 0xe8a54b,
  /** Open threads: pale gold — present, never nagging. */
  thread: 0xffe9c4,
  /** Gathering hubs: warm cream. */
  gathering: 0xfff3dd,
  /** Bridges of light between clusters. */
  bridge: 0xffc98a,
  /** The air above the field: faint warm motes, never a sky. */
  motes: 0xd8a86a,
} as const;

/** One form per light kind — geometry params the scene builds from.
 *  Triangle counts are the measured cost of one instance (the scene test
 *  asserts the whole field against the recipe budget). */
export const PEOPLE_FORMS: Record<
  PeopleLightForm,
  { geometry: "sphere" | "ring" | "cone" | "gathering-ring"; radius: number; trisPerInstance: number }
> = {
  memory: { geometry: "sphere", radius: 2.2, trisPerInstance: 96 },
  date: { geometry: "ring", radius: 3.4, trisPerInstance: 120 },
  thread: { geometry: "cone", radius: 2.0, trisPerInstance: 15 },
  gathering: { geometry: "gathering-ring", radius: 4.5, trisPerInstance: 144 },
} as const;

/** The hearth: the warm central presence of a cluster (one per person). */
export const PEOPLE_HEARTH = {
  radius: 6,
  /** SphereGeometry(6, 12, 8) = 12 × 8 × 2 triangles. */
  trisPerInstance: 192,
} as const;

/** External assets this world loads: none. Procedural field + the
 *  already-credited HYG starfield, exactly like the Deep Past. */
export const PEOPLE_EXTERNAL_ASSETS: readonly { key: string; url: string; license: string }[] = [];
