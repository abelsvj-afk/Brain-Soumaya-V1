import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { PEOPLE_SEED } from "./peopleLayout.js";
import type { PeopleLightForm } from "./peopleLayout.js";

/**
 * The People's asset layer (Phase 3, P3-3) — the single source of truth
 * for what a cluster is made of. It follows the stationAssets.ts pattern
 * (one manifest, named forms, measured geometry) with one deliberate
 * difference: People ships NO external asset — except two. The field
 * itself is procedural — warm geometry, baked glow, and the HYG
 * starfield the Station, the garden, and the Deep Past already credit.
 * The exceptions are the distant backdrop planets (EVE-style,
 * 2026-10-27): Earth and Moon, and a Quaternius planet, hung 4,000
 * units out so the slow orbit never reaches them. Their licenses are
 * in public/CREDITS.md and WorldCredits (Poly Pizza entry).
 *
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

/**
 * Distant backdrop planets (EVE-style, 2026-10-27 evening): Earth and
 * Moon — home, far away — and a Quaternius planet, 4,000 units out at
 * ~7° elevation, ~180° apart. The People's camera is a scripted slow
 * orbit at radius 700, so it never gets closer than ~3,300; the
 * planets loom and never arrive. Loaded as-is (materials = calls); no
 * spin — a backdrop planet's rotation is invisible at 4,000 units.
 * Both files reuse hunt-2 planets already in the upload pipeline
 * (second job, no new upload).
 */
export interface PeopleBackdropPlanet {
  key: string;
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
  /** Material count of the file (= draw calls, loaded as-is). */
  materials: number;
  /** License of the file, as credited in public/CREDITS.md. */
  license: string;
  /** Azimuth of the planet around the field, radians. */
  angle: number;
  /** Distance from the field center, in field units. */
  distance: number;
  /** Height above the field — ~7° elevation from the orbit. */
  y: number;
  /** Longest side once placed, in field units. */
  size: number;
}
export const PEOPLE_BACKDROP_PLANETS: readonly PeopleBackdropPlanet[] = [
  {
    key: "earth-and-moon",
    url: "/pp-earth-and-moon.glb",
    tris: 1524,
    materials: 3,
    license: "CC-BY 3.0 (Jarlan Perez)",
    angle: 4.0,
    distance: 4000,
    y: 500,
    size: 700,
  },
  {
    key: "quaternius-planet-3",
    url: "/pp-planet-3.glb",
    tris: 2178,
    materials: 1,
    license: "CC0 1.0 (Quaternius)",
    angle: 4.0 + Math.PI,
    distance: 4000,
    y: 500,
    size: 800,
  },
];
/** Draw calls the backdrop planets add once loaded (materials, as-is). */
export const PEOPLE_BACKDROP_DRAW_CALLS = PEOPLE_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.materials,
  0,
);
/** Measured triangles the backdrop planets add once loaded. */
export const PEOPLE_BACKDROP_TRIS_TOTAL = PEOPLE_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.tris,
  0,
);

/** External assets this world loads: the backdrop planets, and nothing
 *  else. Procedural field + the already-credited HYG starfield. */
export const PEOPLE_EXTERNAL_ASSETS: readonly { key: string; url: string; license: string }[] =
  PEOPLE_BACKDROP_PLANETS.map((m) => ({ key: m.key, url: m.url, license: m.license }));

/** Every GLB URL this world loads (the upload manifest for this increment). */
export const PEOPLE_ASSET_URLS: readonly string[] = PEOPLE_BACKDROP_PLANETS.map((m) => m.url);

/**
 * Load a backdrop planet through the app's shared glTF loader.
 * Resolves to the loaded scene, or null when the load fails — the
 * caller keeps the holder empty and the failure is registered for
 * the diagnostics note (the app's model-fallback pattern).
 */
export function loadPeopleAsset(url: string): Promise<THREE.Object3D | null> {
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
