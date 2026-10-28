import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";

/**
 * The Garden's asset layer (population increment, 2026-10-27) — the
 * single source of truth for the Garden's one kind of external asset:
 * distant backdrop planets (EVE-style, owner's direction: more planets
 * in the other worlds — distant planets you fly toward that grow
 * enormous but you never reach). The Garden itself is procedural —
 * terraces, tree, vegetation, plots, paths, landmarks, mist, sky.
 * The exceptions are the three backdrop planets, hung 4,000 units out
 * at ~7° elevation so the slow orbit (radius 1,150) never brings the
 * camera closer than ~2,850. Their licenses are in public/CREDITS.md
 * and WorldCredits (Poly Pizza entry for the hunt-2 planets, Sketchfab
 * entry for the ice planet).
 *
 * - The planets-set is a whole distant system for 2 calls; the
 *   Quaternius planet is the far-side second world; the ice planet is
 *   THE ice world (imperioame, CC-BY-4.0) — a frozen sphere over the
 *   warm garden. The alisachen69 "Ice Planet" (toy trains) and the
 *   dannzjs "Ice world" (diorama) are both dropped by owner order and
 *   never appear here.
 * - No procedural stand-in as final art: the planets ARE the final
 *   art. A holder stays empty until its GLB lands; a failed load
 *   leaves it empty and notes the failure, never a stand-in.
 */

/** The recipe seed, shared with the layout so scene and layout can never drift apart. */
export { GARDEN_SEED } from "./gardenLayout.js";

/**
 * Distant backdrop planets (EVE-style, 2026-10-27 evening). Loaded
 * as-is (materials = calls); no spin — a backdrop planet's rotation
 * is invisible at 4,000 units. The hunt-2 files reuse planets already
 * in the upload pipeline (second job, no new upload); the ice planet
 * is new (Sketchfab, owner-downloaded).
 */
export interface GardenBackdropPlanet {
  key: string;
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
  /** Material count of the file (= draw calls, loaded as-is). */
  materials: number;
  /** Azimuth of the planet around the garden, radians. */
  angle: number;
  /** Distance from the garden center, in field units. */
  distance: number;
  /** Height above the garden — ~7° elevation from the orbit. */
  y: number;
  /** Longest side once placed, in field units. */
  size: number;
}
export const GARDEN_BACKDROP_PLANETS: readonly GardenBackdropPlanet[] = [
  {
    key: "planets-set",
    url: "/pp-planets-set.glb",
    tris: 1164,
    materials: 2,
    angle: 2.0,
    distance: 4000,
    y: 500,
    size: 1200,
  },
  {
    key: "quaternius-planet-2",
    url: "/pp-planet-2.glb",
    tris: 2010,
    materials: 1,
    angle: 2.0 + Math.PI,
    distance: 4000,
    y: 500,
    size: 800,
  },
  {
    key: "ice-planet-procedural",
    url: "/sf-ice-planet-procedural.glb",
    tris: 60160,
    materials: 2,
    angle: 2.0 + Math.PI / 2,
    distance: 4000,
    y: 500,
    size: 800,
  },
];
/** Draw calls the backdrop planets add once loaded (materials, as-is). */
export const GARDEN_BACKDROP_DRAW_CALLS = GARDEN_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.materials,
  0,
);
/** Measured triangles the backdrop planets add once loaded. */
export const GARDEN_BACKDROP_TRIS_TOTAL = GARDEN_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.tris,
  0,
);

/** Every GLB URL this world loads (the upload manifest for this increment). */
export const GARDEN_ASSET_URLS: readonly string[] = GARDEN_BACKDROP_PLANETS.map((m) => m.url);

/**
 * Load a backdrop planet through the app's shared glTF loader.
 * Resolves to the loaded scene, or null when the load fails — the
 * caller keeps the holder empty and the failure is registered for
 * the diagnostics note (the app's model-fallback pattern).
 */
export function loadGardenAsset(url: string): Promise<THREE.Object3D | null> {
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
