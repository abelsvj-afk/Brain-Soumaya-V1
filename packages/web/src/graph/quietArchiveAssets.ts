import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { QUIET_ARCHIVE_SEED } from "./quietArchiveLayout.js";
import type { QuietArchiveLightForm } from "./quietArchiveLayout.js";

/**
 * The Quiet/Archive asset layer (Phase 3, Wave 2) — the single source of
 * truth for what a resting lamp is made of. It follows the peopleAssets.ts
 * pattern (one manifest, named forms, measured geometry) with the same
 * deliberate difference: Quiet/Archive ships NO external asset — except
 * one. The field itself is procedural — dim geometry, baked glow, and
 * the HYG starfield the Station, the garden, the Deep Past, and the
 * People already credit. The single exception is the first artifact:
 * Sputnik, the first human-made thing ever put up there, resting in an
 * alcove by the arrival edge (population increment, 2026-10-27).
 *
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
 * - Sputnik (reodesuxz Low Poly Space Pack, free commercial, no
 *   attribution required — see public/CREDITS.md): kept as-is, BOTH
 *   materials = 2 calls. Its small bright form is its identity. The
 *   GLB lands via the GitHub web UI; until it lands, the alcove stays
 *   empty and the failure is noted for diagnostics — never a stand-in.
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

/**
 * The first artifact (population increment): Sputnik 1 — the first
 * human-made thing ever put up there, resting in an alcove by the
 * arrival edge. Kept as-is (both materials = 2 calls); its small
 * bright form is its identity. Positioned by
 * quietArchiveSputnikPosition() in the layout, from the field radius.
 */
export const QUIET_ARCHIVE_ARTIFACT = {
  key: "sputnik",
  name: "Sputnik 1",
  url: "/lowpoly-sputnik.glb",
  tris: 144,
  materials: 2,
  /** Longest side once placed, in field units — a small bright thing beside the lamps, never a monument. */
  size: 14,
} as const;

/** Every GLB URL this world loads (the upload manifest for this increment). */
export const QUIET_ARCHIVE_ASSET_URLS: readonly string[] = [QUIET_ARCHIVE_ARTIFACT.url];

/**
 * Load the artifact through the app's shared glTF loader. Resolves to
 * the loaded scene, or null when the load fails — the caller keeps the
 * alcove empty and the failure is registered for the diagnostics note
 * (the app's model-fallback pattern).
 */
export function loadQuietArchiveAsset(url: string): Promise<THREE.Object3D | null> {
  const name = url.split("/").pop() ?? url;
  return new Promise((resolve) => {
    const fail = () => {
      noteModelFallback(name);
      resolve(null);
    };
    try {
      gltfLoader().load(url, (gltf) => resolve(gltf.scene), undefined, fail);
    } catch {
      // three's loader can throw synchronously (e.g. an unresolvable URL
      // where there is no page to resolve it against, as in tests) — a
      // failed load degrades to the fallback, never to a crash.
      fail();
    }
  });
}
