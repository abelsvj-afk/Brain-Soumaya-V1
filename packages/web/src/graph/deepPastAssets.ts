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
 * NOT here: the one piece the owner still sends — the route bead. Its
 * position keeps its procedural form as explicitly-marked interim (a TODO
 * in deepPastScene.ts), never a silent stand-in. The anchor spire arrived
 * 2026-10-27 (his own project file, `anchor-spire.glb`) and the First
 * Light orb arrived 2026-10-28 (his own project file, `first-light-orb.glb`,
 * fixed to a true sphere with a warm-gold emissive + 'FirstLight' clip);
 * both are placed below.
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
  /** Measured points, for point-cloud models (0 triangles — the
   * supernova remnant is a cloud, not a mesh). Absent means 0. */
  points?: number;
  /** Draw calls when they differ from the material count — a point
   * cloud draws once per mesh, not once per material. Absent means
   * the material count. */
  drawCalls?: number;
}

/** The five shipped pieces, in the asset-components order (basin first) — plus the stratum crystal (population increment, 2026-10-27), the slimmed supernova remnant (Sketchfab long game, 2026-10-27), the anchor spire (owner-supplied, 2026-10-27), and the slimmed First Light orb (owner-supplied, 2026-10-28). */
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
  // A dead star in the deep strata (Aiekick's "Supernova remnant",
  // Sketchfab, CC-BY 4.0 — see CREDITS.md): the source is a POINT
  // CLOUD, not a triangle mesh — 2,168,851 points, 0 triangles (the
  // "722,950 tris" first counted was a miscount: position count ÷ 3).
  // This is the slimmed derivative (10% subsample, same 34-mesh
  // structure, unlit): 216,902 points, 6,094,016 bytes. It draws once
  // per mesh — 34 calls — not once per material, so the call count
  // carries the override below. The "lighting 2" twin is the same
  // cloud and stays out.
  { key: "supernova", url: "/sf-supernova-remnant-slim.glb", tris: 0, materials: 1, points: 216902, drawCalls: 34 },
  // The anchor spire (owner-supplied, 2026-10-27 — his own project
  // file, `anchor-spire.glb`, confirmed by him as the Deep Past anchor
  // spire; render `anchor-spire-render.jpg`): a tall stone nail on a
  // rock base, 80,210 tris / 1 mesh / 1 material, no animations, 1
  // embedded PNG. The tip glows warm by his direction — a real light +
  // glow sprite at the tip on load, the lantern's treatment.
  // Owner-supplied, no third-party license — see CREDITS.md.
  { key: "spire", url: "/sf-anchor-spire.glb", tris: 80210, materials: 1 },
  // The First Light orb (owner-supplied, 2026-10-28 — his own project
  // file, `first-light-orb.glb`, fixed before placement: the upload was
  // an oval ellipsoid, reshaped to a true sphere 2.0 across, warm-gold
  // emissive, 'FirstLight' clip added). The source is 539,428 tris —
  // 6.7× the ≤80k basin budget — so this is the slimmed derivative
  // (70,120 tris, texture 1024, Draco, render-checked in a real browser),
  // the only version that ships. Its 'FirstLight' clip (slow spin + bob
  // + breathing pulse) wires through a mixer in deepPastScene.
  // Owner-supplied, no third-party license — see CREDITS.md.
  { key: "orb", url: "/sf-first-light-orb-slim.glb", tris: 70120, materials: 1 },
];

/** Measured triangles across the shipped pieces (88,168 v6 + 52 crystal + 80,210 spire + 70,120 orb slim). The supernova adds 0 — it is a point cloud, not a mesh. */
export const DEEP_PAST_GLB_TRIS_TOTAL = DEEP_PAST_MODELS.reduce((n, m) => n + m.tris, 0);

/** Measured points across the shipped pieces — the supernova remnant's slimmed cloud, and nothing else. */
export const DEEP_PAST_GLB_POINTS_TOTAL = DEEP_PAST_MODELS.reduce((n, m) => n + (m.points ?? 0), 0);

/**
 * Draw calls the GLB layer adds once everything has loaded: one call
 * per material per piece, plus one glow sprite each for the lantern
 * and the spire (their point lights are not calls). The basin's glow
 * sprite and lights already exist in the procedural scene and are not
 * counted here. The crystal is 2 calls, not 1 — the sum counts
 * materials honestly, so no `length + 1` formula can hide it. The
 * supernova is 34 calls, not 1 — a point cloud draws once per mesh,
 * and the slim keeps all 34 meshes, so its override carries the count.
 */
export const DEEP_PAST_GLB_DRAW_CALLS =
  DEEP_PAST_MODELS.reduce((n, m) => n + (m.drawCalls ?? m.materials), 0) + 2;

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

/** A dead star in the deep strata (Sketchfab long game): stratum 7, on
 *  the stratum's arc, at the alcove radius, 20 above the stratum
 *  floor — the crystal's pattern, two strata deeper. It spans 100
 *  units once placed: a shell of ancient light, not a monument — the
 *  oldest thing in the descent, a star that died before the first
 *  memory was laid down. */
export const DEEP_PAST_SUPERNOVA = {
  stratum: 7,
  angle: 7 * DEEP_PAST_STRATUM_ARC_START + 1.4,
  radius: DEEP_PAST_STRATUM_RADIUS[7]! - 40,
  y: DEEP_PAST_STRATUM_Y[7]! + 20,
  size: 100,
} as const;

/** The anchor spire (owner-supplied, 2026-10-27): stratum 1, opposite
 *  the terrace across the descent, on the terrace's ring (radius 360).
 *  It stands 120 units tall once placed: a landmark you see from the
 *  top of the descent, not a monument. Its base sits ON the stratum-1
 *  floor (−90), so the holder rides half its height above the floor
 *  and the tip reaches +30, above the rim plane — the nail that pins
 *  the top of the descent. The tip glows warm, as the owner directed
 *  ("the tip of the nail needs to glow") — a real warm light + glow
 *  sprite at the tip on load, the lantern's treatment. */
export const DEEP_PAST_SPIRE = {
  stratum: 1,
  angle: DEEP_PAST_TERRACE.angle + Math.PI,
  radius: 360,
  y: DEEP_PAST_STRATUM_Y[1]! + 60,
  size: 120,
} as const;

/** The spire tip's warm light (the lantern's light scale) and its glow
 *  sprite's span — a point of light, smaller than the lantern's lamp. */
export const DEEP_PAST_SPIRE_LIGHT = { intensity: 2.0, distance: 250 } as const;
export const DEEP_PAST_SPIRE_GLOW_SPAN = 100;

/** The First Light orb (owner-supplied, 2026-10-28): the basin center,
 *  just above the hollow, at the interim basin light's position — the
 *  basin light stays as the light source and the glow sprite becomes
 *  the orb's halo, per the note in deepPastScene. It spans 80 units
 *  once placed: the focal light, the heart inside the 190-wide basin
 *  glow — a judgment call, adjustable on the owner's word. */
export const DEEP_PAST_ORB = {
  y: DEEP_PAST_BASIN_Y + 24,
  size: 80,
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
 * Load one Deep Past asset WITH its animation clips (the orb's
 * 'FirstLight' clip — the Deep Past's only animated piece so far).
 * Mirrors loadDeepPastAsset's fail-degrade pattern: resolves null when
 * the load fails, so the caller keeps its fallback.
 */
export function loadAnimatedDeepPastAsset(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
  const name = url.split("/").pop() ?? url;
  return new Promise((resolve) => {
    const fail = () => {
      noteModelFallback(name);
      resolve(null);
    };
    try {
      gltfLoader().load(
        url,
        (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
        undefined,
        fail,
      );
    } catch {
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
