import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import {
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_STRATUM_ARC_LENGTH,
  DEEP_PAST_STRATUM_ARC_START,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
} from "./deepPastLayout.js";

/**
 * The Deep Past's real-asset layer — the five owner-made pieces wired
 * into the app (worlds build-all, 2026-10-26). The manifest names every
 * GLB the Deep Past scene loads; the loader fetches them through the
 * app's shared glTF loader with the honest fallback (null + diagnostics
 * note — the scene degrades, never crashes); the placement constants
 * carry the mockup's verified placements into the app's scale.
 *
 * PROVENANCE (measured from the files, 2026-10-26): the five slims are
 * the v6 versions — textures cut to 256, one mesh / one material /
 * three embedded PNG textures each, no Draco, no KTX2. Basin and
 * terrace carry KHR_materials_specular (three's GLTFLoader reads it).
 * They are the owner's own generated artwork (image → GLB, the same
 * flow as the relics) — no third-party source, no embedded license;
 * credited as owner-generated in public/CREDITS.md.
 *
 * SCALE (mockup × 5, to the garden's scale family): the mockup proved
 * each placement at its own scale (stratum radius 88 − i·3.5, drop 18,
 * basin y −166, radius 58); every constant below is the mockup value
 * times five, derived from the layout constants where the layout has
 * them. The basin is scaled from its own measured width at load time
 * (the mockup's pattern), so a re-slim still lands at the right span.
 *
 * All URLs are flat in `public/` (the app's existing convention:
 * `profondo.glb`, `soumaya-ship.glb`, the Station's GLBs). The GLB
 * files land via the GitHub web UI (binaries cannot ride the API
 * push); until they land, every load resolves null and the scene runs
 * on its procedural fallbacks — see `deepPastScene.ts`.
 *
 * NOT here: the three pieces the owner still sends, one at a time —
 * the First Light orb, the anchor spire, the route bead. Their
 * positions keep their procedural forms as explicitly-marked interim
 * (TODOs in deepPastScene.ts), never a silent stand-in.
 */

export interface DeepPastAssetModel {
  /** Piece key (also the scene holder's name suffix). */
  key: string;
  /** Public URL of the GLB. */
  url: string;
  /** Measured triangles of the shipped v6 file. */
  tris: number;
  /** Material count of the file (= draw calls for this piece when loaded as-is). */
  materials: number;
}

/** The five shipped pieces, in the asset-components order (basin first) — plus the stratum crystal (population increment, 2026-10-27). */
export const DEEP_PAST_MODELS: readonly DeepPastAssetModel[] = [
  { key: "basin", url: "/first-light-basin-web-256.glb", tris: 22500, materials: 1 },
  { key: "terrace", url: "/stratum-terrace-web-256.glb", tris: 22500, materials: 1 },
  { key: "rim", url: "/rim-web-256.glb", tris: 14200, materials: 1 },
  { key: "stair", url: "/descent-stair-web-256.glb", tris: 14626, materials: 1 },
  { key: "lantern", url: "/stratum-lantern-web-256.glb", tris: 14342, materials: 1 },
  // A stratum crystal in the deep strata (reodesuxz Low Poly Space Pack,
  // free commercial, no attribution required — see CREDITS.md): kept
  // as-is, BOTH materials = 2 calls. Its purple is its identity.
  { key: "crystal", url: "/lowpoly-crystal_cluster.glb", tris: 52, materials: 2 },
];

/** Measured triangles across the shipped pieces (88,168 v6 + 52 crystal). */
export const DEEP_PAST_GLB_TRIS_TOTAL = DEEP_PAST_MODELS.reduce((n, m) => n + m.tris, 0);

/**
 * Draw calls the GLB layer adds once everything has loaded: one call
 * per material per piece, plus the lantern's glow sprite (its point
 * light is not a call). The basin's glow sprite and lights already
 * exist in the procedural scene and are not counted here. The crystal
 * is 2 calls, not 1 — the sum counts materials honestly, so no
 * `length + 1` formula can hide it.
 */
export const DEEP_PAST_GLB_DRAW_CALLS =
  DEEP_PAST_MODELS.reduce((n, m) => n + m.materials, 0) + 1;

/** Every GLB URL the Deep Past scene loads (the upload manifest). */
export const DEEP_PAST_ASSET_URLS: readonly string[] = DEEP_PAST_MODELS.map((m) => m.url);

/**
 * The basin dish spans the basin's full width (mockup: span 116 across
 * a radius-58 basin). Scaled from the loaded file's own measured width,
 * so the span holds whatever the slim measures.
 */
export const DEEP_PAST_BASIN_SPAN = DEEP_PAST_BASIN_RADIUS * 2;

/**
 * The dish group rides below the basin line (mockup: 15 below a −166
 * basin line) so the bowl's rim meets the basin floor: after centring
 * and scaling, the bowl spans ~±75 around the group origin.
 */
export const DEEP_PAST_BASIN_GLB_Y = DEEP_PAST_BASIN_Y - 75;

/** One real terrace slice, on stratum 1 (mockup: radius 72, angle
 *  stratumA(1) + 0.35, rotation.y = −angle − π/2, y = stratumY(1) +
 *  1.3 + 9 — all × 5). The wall rises exactly one stratum drop; the
 *  shelf runs along the arc, concave side to the axis. */
export const DEEP_PAST_TERRACE = {
  scale: 250,
  angle: DEEP_PAST_STRATUM_ARC_START + 0.35,
  radius: 360,
  y: DEEP_PAST_STRATUM_Y[1]! + 6.5 + 45,
} as const;

/** The rim ring (mockup: scale 176, y −9, gap at angle 0 — all × 5).
 *  Outer radius 440, the top stratum's edge; the band is tall, its base
 *  sunk into the upper strata, only a lip showing above stratum 0. */
export const DEEP_PAST_RIM = { scale: 880, y: -45 } as const;

/** The descent stair (mockup: scale 50, position (62, −5.9, 25),
 *  rotation.y = −π/2 — all × 5). It runs tangentially from the rim gap
 *  in the helix travel direction; the flight is straight and the helix
 *  curves, so the bottom step straddles stratum 1's outer edge — the
 *  mockup's honest caveat, carried over. */
export const DEEP_PAST_STAIR = {
  scale: 250,
  position: { x: 310, y: -29.5, z: 125 },
} as const;

/** One hero lantern on stratum 3 (mockup: stratumA(3) + 0.62·4.4,
 *  radius stratumR(3) − 13, y = stratumY(3) + 1.3 + 10 — all × 5).
 *  A landmark on its stratum, not a beacon; its glow is painted into
 *  the texture, so it gets a real warm light + glow sprite on load. */
export const DEEP_PAST_LANTERN = {
  scale: 100,
  angle: 3 * DEEP_PAST_STRATUM_ARC_START + 0.62 * DEEP_PAST_STRATUM_ARC_LENGTH,
  radius: DEEP_PAST_STRATUM_RADIUS[3]! - 65,
  y: DEEP_PAST_STRATUM_Y[3]! + 6.5 + 50,
} as const;

/** The lantern's warm light (the app's light scale — cf. the basin
 *  light in deepPastScene.ts, not the mockup's physical-falloff
 *  candela) and its glow sprite's span (mockup 26 × 5). */
export const DEEP_PAST_LANTERN_LIGHT = { intensity: 2.0, distance: 250 } as const;
export const DEEP_PAST_LANTERN_GLOW_SPAN = 130;

/** A stratum crystal in the deep strata (population increment): stratum
 *  5, on the stratum's arc, at the alcove radius, 8 above the stratum
 *  floor — the terrace pattern, one stratum deeper. It stands 30 units
 *  tall once placed: a crystal, not a monument. */
export const DEEP_PAST_CRYSTAL = {
  stratum: 5,
  angle: 5 * DEEP_PAST_STRATUM_ARC_START + 0.9,
  radius: DEEP_PAST_STRATUM_RADIUS[5]! - 15,
  y: DEEP_PAST_STRATUM_Y[5]! + 8,
  size: 30,
} as const;

/**
 * Load one Deep Past asset through the app's shared glTF loader.
 * Resolves to the loaded scene, or null when the load fails — the
 * caller keeps its fallback and the failure is registered for the
 * diagnostics note (the app's model-fallback pattern).
 */
export function loadDeepPastAsset(url: string): Promise<THREE.Object3D | null> {
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

/**
 * Centre a loaded root on the origin and scale it uniformly (the
 * mockup's pattern: Box3 centre, then a uniform scale). Returns the
 * scale applied. The root's own node transforms are already baked
 * into the measured box, so the fit holds whatever the file carries.
 */
export function fitDeepPastAsset(root: THREE.Object3D, scale: number): number {
  // Scale FIRST, then centre: the centre is measured after scaling, so
  // an off-origin child (a mesh that does not sit at its root's origin)
  // lands centred instead of drifting by its offset times the scale.
  root.scale.setScalar(scale);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  return scale;
}

/** Centre a loaded root and scale it so its width spans `span`
 *  (the basin's pattern: the dish spans the basin, whatever it
 *  measures). Returns the scale applied. */
export function fitDeepPastAssetToSpan(root: THREE.Object3D, span: number): number {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return fitDeepPastAsset(root, span / Math.max(0.001, size.x));
}

/** Centre a loaded root and scale it so its longest side is `size`
 *  (the crystal's pattern: the file's native units are not a scale the
 *  scene can trust). Returns the scale applied. */
export function fitDeepPastAssetToSize(root: THREE.Object3D, size: number): number {
  const box = new THREE.Box3().setFromObject(root);
  const extents = box.getSize(new THREE.Vector3());
  const longest = Math.max(extents.x, extents.y, extents.z);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return fitDeepPastAsset(root, size / longest);
}
