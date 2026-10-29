import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import {
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_STRATA_COUNT,
  DEEP_PAST_STRATUM_ARC_LENGTH,
  DEEP_PAST_STRATUM_ARC_START,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
} from "./deepPastLayout.js";

/**
 * The Deep Past's real-asset layer — the owner-made pieces wired
 * into the app (worlds build-all, 2026-10-26), with the dressing the
 * 2026-10-29 fix restored (docs/worlds/deep-past-fix-design-note.md).
 * The manifest names every GLB the Deep Past scene loads; the loader
 * fetches them through the app's shared glTF loader with the honest
 * fallback (null + diagnostics note — the scene degrades, never
 * crashes); the placement derivations below carry the mockup's
 * verified placements into the app's scale and generalise them the
 * way the owner's own 2026-10-25 component list always specced:
 * several terrace segments per stratum, lanterns in the dozens, a
 * staircase wrapping the descent, a bead above each journey stop.
 *
 * PROVENANCE (measured from the files): the five architecture pieces
 * (basin, terrace, rim, stair, lantern) were re-slimmed 2026-10-29
 * from the owner's masters — textures now WebP (1024; the lantern
 * 512), Draco geometry, terrace / stair / lantern simplified (5,198 /
 * 8,000 / 4,400 tris — stair at the design note's target, terrace and
 * lantern below theirs so the note's hard scene cap binds; see the
 * build record for the per-piece deltas). The orb was re-slimmed the
 * same day from the owner's original to 24,576 tris with its 2048
 * WebP texture and its 'FirstLight' clip untouched. The spire was
 * verified against the same spec and already meets it (WebP 1024, at
 * its hard tri cap) — it ships unchanged. The route bead (owner-
 * supplied 2026-10-28) was slimmed to 1,597 tris, its 'Flow' clip and
 * Bead / FlowGlow names preserved. Basin and terrace carry
 * KHR_materials_specular (three's GLTFLoader reads it). The pieces
 * are the owner's own generated artwork (image → GLB, the same flow
 * as the relics) — no third-party source, no embedded license;
 * credited as owner-generated in public/CREDITS.md.
 *
 * SCALE (mockup × 5, to the garden's scale family): the mockup proved
 * each placement at its own scale (stratum radius 88 − i·3.5, drop 18,
 * basin y −166, radius 58); every constant below is the mockup value
 * times five, derived from the layout constants where the layout has
 * them. Every piece is fitted from its own measured file at load time
 * (span / longest side / height — the design note's §8 rule), so a
 * re-slim still lands at the right size; no bare scale factor
 * survives in the load path.
 *
 * All URLs are flat in `public/` (the app's existing convention:
 * `profondo.glb`, `soumaya-ship.glb`, the Station's GLBs) and stay
 * stable across the re-slim — same public filenames, new contents
 * (the "-256" in a filename is history, not a texture size). The GLB
 * files land via the GitHub web UI (binaries cannot ride the API
 * push). SEQUENCING: this code must not merge before the re-slimmed
 * binaries land — five of the filenames already exist in `public/`
 * with the OLD slims, which load fine one-of-each but at the new
 * instance counts would break the budget the manifest asserts; the
 * counts below describe the re-slimmed files. The bead's file does
 * not exist yet, so until it lands its load resolves null and the
 * thread stays bare — the scene's honest degradation, in
 * `deepPastScene.ts`, for every piece whose file is missing.
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
  /** How many times the scene places this piece at most (dressing
   * repeats). Triangles count every placement; draw calls do not —
   * an instanced repeat draws once per material however many
   * instances it carries. For the bead (cloned, not instanced) it is
   * the budgeted route maximum, 12 stops, and its `drawCalls`
   * carries the per-stop count instead. Absent means 1. */
  instances?: number;
}

/** The shipped pieces, in the asset-components order (basin first) — plus the stratum crystal (population increment, 2026-10-27), the slimmed supernova remnant (Sketchfab long game, 2026-10-27), the anchor spire (owner-supplied, 2026-10-27), the First Light orb (owner-supplied, 2026-10-28), and the route bead (owner-supplied, 2026-10-28, wired 2026-10-29). Triangle counts are the 2026-10-29 re-slim measurements where the fix re-slimmed the piece. */
export const DEEP_PAST_MODELS: readonly DeepPastAssetModel[] = [
  { key: "basin", url: "/first-light-basin-web-256.glb", tris: 22500, materials: 1 },
  { key: "terrace", url: "/stratum-terrace-web-256.glb", tris: 5198, materials: 1, instances: 24 },
  { key: "rim", url: "/rim-web-256.glb", tris: 14200, materials: 1 },
  { key: "stair", url: "/descent-stair-web-256.glb", tris: 8000, materials: 1, instances: 9 },
  { key: "lantern", url: "/stratum-lantern-web-256.glb", tris: 4400, materials: 1, instances: 25 },
  // A stratum crystal in the deep strata (reodesuxz Low Poly Space Pack,
  // free commercial, no attribution required — see CREDITS.md): kept
  // as-is, BOTH materials = 2 calls however many instances (3 since
  // the 2026-10-29 dressing pass). Its purple is its identity.
  { key: "crystal", url: "/lowpoly-crystal_cluster.glb", tris: 52, materials: 2, instances: 3 },
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
  // rock base, 80,210 tris / 1 mesh / 1 material, no animations. The
  // shipped slim (WebP 1024, 2.02 MB) was verified against the
  // 2026-10-29 re-slim spec and already meets it — WebP 1024, tris at
  // the spec's hard cap — so it ships unchanged (the spec's verify-
  // first rule). The tip glows warm by his direction — a real light +
  // glow sprite at the tip on load, the lantern's treatment.
  // Owner-supplied, no third-party license — see CREDITS.md.
  { key: "spire", url: "/sf-anchor-spire.glb", tris: 80210, materials: 1 },
  // The First Light orb (owner-supplied, 2026-10-28 — his own project
  // file, `first-light-orb.glb`, fixed before placement: the upload was
  // an oval ellipsoid, reshaped to a true sphere 2.0 across, warm-gold
  // emissive, 'FirstLight' clip added). The source is 539,428 tris, so
  // this is the slimmed derivative — re-slimmed 2026-10-29 to 24,576
  // tris (the design note's grounded number: a 128×96-segment smooth
  // sphere's silhouette at its placed size) with the texture kept at
  // 2048 as WebP and Draco geometry. Its 'FirstLight' clip (slow spin
  // + bob + breathing pulse) wires through a mixer in deepPastScene.
  // Owner-supplied, no third-party license — see CREDITS.md.
  { key: "orb", url: "/sf-first-light-orb-slim.glb", tris: 24576, materials: 1 },
  // The route bead (owner-supplied, 2026-10-28 — "Perfect.."): a
  // small two-part marker (Bead + FlowGlow meshes, 2 materials) with
  // a 'Flow' clip, cloned once above each stop of the drawn journey
  // thread — 2 draw calls per stop, budgeted at routes up to 12
  // stops. The 12-stop figure is a budgeting envelope, not a display
  // limit: the scene marks every stop however long the route (the
  // beads follow the layout exactly), and each stop past 12 adds
  // 2 calls / 1,597 tris beyond the envelope. Slimmed 2026-10-29 to
  // 1,597 tris; names and clip preserved. Owner-supplied, no
  // third-party license — see CREDITS.md.
  { key: "bead", url: "/route-bead.glb", tris: 1597, materials: 2, drawCalls: 24, instances: 12 },
];

/** Measured triangles across the shipped pieces, counting every placed instance (terrace ×24, stair ×9, lantern ×25, crystal ×3, bead ×12 budgeted stops): 467,558. The supernova adds 0 — it is a point cloud, not a mesh. */
export const DEEP_PAST_GLB_TRIS_TOTAL = DEEP_PAST_MODELS.reduce((n, m) => n + m.tris * (m.instances ?? 1), 0);

/** Measured points across the shipped pieces — the supernova remnant's slimmed cloud, and nothing else. */
export const DEEP_PAST_GLB_POINTS_TOTAL = DEEP_PAST_MODELS.reduce((n, m) => n + (m.points ?? 0), 0);

/**
 * Draw calls the GLB layer adds once everything has loaded: one call
 * per material per piece (an instanced repeat still draws once per
 * material — 24 terrace slices cost 1 call, not 24), plus four the
 * sum cannot see: the hero lantern is a SECOND load of the lantern
 * file (its own mesh, +1), its glow sprite (+1), the dressing
 * lanterns' shared glow points cloud (+1), and the spire's glow
 * sprite (+1). Their point lights are not calls. The basin's glow
 * sprite and lights already exist in the procedural scene and are not
 * counted here. The crystal is 2 calls, not 1 — the sum counts
 * materials honestly, so no `length + 1` formula can hide it. The
 * supernova is 34 calls, not 1 — a point cloud draws once per mesh,
 * and the slim keeps all 34 meshes, so its override carries the count.
 * The bead is 24, not 2 — it is cloned per stop, not instanced, so
 * its override carries 2 calls × the 12 budgeted stops.
 */
export const DEEP_PAST_GLB_DRAW_CALLS =
  DEEP_PAST_MODELS.reduce((n, m) => n + (m.drawCalls ?? m.materials), 0) + 4;

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

/** One real terrace slice (mockup: radius 72, angle stratumA(1) +
 *  0.35, rotation.y = −angle − π/2, y = stratumY(1) + 1.3 + 9 — all
 *  × 5). The wall rises exactly one stratum drop; the shelf runs
 *  along the arc, concave side to the axis. Placed size 285 = the
 *  mockup's scale 250 × the piece's measured 1.142 longest side; the
 *  scene fits by measurement, so the size is a target dimension, not
 *  a factor. The radius is the stratum-1 ring inside the wall:
 *  R_1 − 62.5 = 360, the mockup's radius × 5. */
export const DEEP_PAST_TERRACE = {
  angle: DEEP_PAST_STRATUM_ARC_START + 0.35,
  radius: DEEP_PAST_STRATUM_RADIUS[1]! - 62.5,
  y: DEEP_PAST_STRATUM_Y[1]! + 6.5 + 45,
  size: 285,
} as const;

/** The terrace slices' offsets along each stratum's arc: the original
 *  placement (0.35) plus two further slices stepping 1.47 rad along —
 *  three slices per stratum, the owner's "several segments per
 *  stratum" (2026-10-25). */
export const DEEP_PAST_TERRACE_SLICE_OFFSETS = [0.35, 1.82, 3.29] as const;

export interface DeepPastTerraceSlice {
  stratum: number;
  angle: number;
  radius: number;
  y: number;
}

/**
 * Every terrace slice: strata 1–8 × the three offsets, on the ring
 * inside each stratum's wall (R_i − 62.5 — stratum 1 lands on the
 * original placement's ring, and slice 1 of stratum 1 IS the original
 * placement, generalised). Stratum 0 carries no slices: it is the
 * arrival rim, and the rim segment alone dresses it — the arrival gap
 * stays clear.
 */
export function deepPastTerraceSlices(): DeepPastTerraceSlice[] {
  const slices: DeepPastTerraceSlice[] = [];
  for (let i = 1; i < DEEP_PAST_STRATA_COUNT; i++) {
    for (const offset of DEEP_PAST_TERRACE_SLICE_OFFSETS) {
      slices.push({
        stratum: i,
        angle: i * DEEP_PAST_STRATUM_ARC_START + offset,
        radius: DEEP_PAST_STRATUM_RADIUS[i]! - 62.5,
        y: DEEP_PAST_STRATUM_Y[i]! + 6.5 + 45,
      });
    }
  }
  return slices;
}

/** The rim ring (mockup: y −9 × 5, gap at angle 0). The top stratum's
 *  edge; the band is tall, its base sunk into the upper strata, only
 *  a lip showing above stratum 0. Its placed span is 880 = 2 × the
 *  rim radius (the mockup's fixed scale 176 × 5), now a measured fit
 *  against the ring's own horizontal diameter. */
export const DEEP_PAST_RIM = { span: DEEP_PAST_STRATUM_RADIUS[0]! * 2, y: -45 } as const;

export interface DeepPastStairFlight {
  angle: number;
  radius: number;
  /** The flight's centre height — the midpoint of the two floors it joins. */
  y: number;
  /** The drop the flight serves (90 per stratum; 110 to the basin). */
  drop: number;
}

/**
 * The helix staircase (settlement D1, 2026-10-29): instanced repeats
 * of the owner's own stair piece, one flight per stratum transition,
 * each uniform-scaled so its measured height spans exactly the drop
 * it serves — floor to floor, never stretched. Flight k (1–8) hangs
 * at angle k × the helix twist on the midpoint ring between the two
 * strata it joins, oriented tangentially (rotation.y = −angle − π/2,
 * the terrace's pattern, the mockup's single flight generalised);
 * the basin leg serves the deeper −110 drop at its own scale. The
 * piece's measured height is 0.361 native units, so a −90 flight
 * lands at uniform scale ≈249.3 and the basin leg at ≈304.7 — both
 * follow from the measured height-fit in the scene, not literals.
 * The mockup's single flight ran from the rim gap at this same
 * tangential orientation; its caveat (a straight flight against a
 * curving helix straddles the receiving stratum's edge) is the
 * geometry of every flight here, by design.
 */
export function deepPastStairFlights(): DeepPastStairFlight[] {
  const flights: DeepPastStairFlight[] = [];
  for (let k = 1; k < DEEP_PAST_STRATA_COUNT; k++) {
    flights.push({
      angle: k * DEEP_PAST_STRATUM_ARC_START,
      radius: (DEEP_PAST_STRATUM_RADIUS[k - 1]! + DEEP_PAST_STRATUM_RADIUS[k]!) / 2,
      y: (DEEP_PAST_STRATUM_Y[k - 1]! + DEEP_PAST_STRATUM_Y[k]!) / 2,
      drop: DEEP_PAST_STRATUM_Y[k - 1]! - DEEP_PAST_STRATUM_Y[k]!,
    });
  }
  flights.push({
    angle: DEEP_PAST_STRATA_COUNT * DEEP_PAST_STRATUM_ARC_START,
    radius: (DEEP_PAST_STRATUM_RADIUS[DEEP_PAST_STRATA_COUNT - 1]! + DEEP_PAST_BASIN_RADIUS) / 2,
    y: (DEEP_PAST_STRATUM_Y[DEEP_PAST_STRATA_COUNT - 1]! + DEEP_PAST_BASIN_Y) / 2,
    drop: DEEP_PAST_STRATUM_Y[DEEP_PAST_STRATA_COUNT - 1]! - DEEP_PAST_BASIN_Y,
  });
  return flights;
}

/** One hero lantern on stratum 3 (mockup: stratumA(3) + 0.62·4.4,
 *  radius stratumR(3) − 13, y = stratumY(3) + 1.3 + 10 — all × 5).
 *  A landmark on its stratum, not a beacon; its glow is painted into
 *  the texture, so it gets a real warm light + glow sprite on load.
 *  Placed size 100 = the mockup's scale 100 × the piece's measured
 *  1.0 longest side (its height); fitted by measurement in the scene. */
export const DEEP_PAST_LANTERN = {
  size: 100,
  angle: 3 * DEEP_PAST_STRATUM_ARC_START + 0.62 * DEEP_PAST_STRATUM_ARC_LENGTH,
  radius: DEEP_PAST_STRATUM_RADIUS[3]! - 65,
  y: DEEP_PAST_STRATUM_Y[3]! + 6.5 + 50,
} as const;

export interface DeepPastDressingLantern {
  stratum: number;
  angle: number;
  radius: number;
  y: number;
}

/**
 * The dressing lanterns (the owner's component list, 2026-10-25:
 * "lanterns in the dozens"): one at the far end of each terrace
 * slice — 24 across strata 1–8, at the hero lantern's fitted size.
 * The far end follows from the slice itself: the fit CENTRES the
 * slice on its placement angle, so the slice spans half its fitted
 * length (285) to either side along its ring, and its far end sits
 * at slice.angle + (285 / 2) / slice.radius on the same ring — on
 * the shelf, not past it. The lantern's centre rides at the hero
 * pattern's height (floor + 6.5 + 50). Their glows ride as one
 * points cloud in the scene — the memory-lantern pattern; the hero
 * keeps its own sprite and real light.
 */
export function deepPastDressingLanterns(): DeepPastDressingLantern[] {
  return deepPastTerraceSlices().map((slice) => ({
    stratum: slice.stratum,
    angle: slice.angle + DEEP_PAST_TERRACE.size / 2 / slice.radius,
    radius: slice.radius,
    y: DEEP_PAST_STRATUM_Y[slice.stratum]! + 6.5 + 50,
  }));
}

/** The lantern's warm light (the app's light scale — cf. the basin
 *  light in deepPastScene.ts, not the mockup's physical-falloff
 *  candela) and its glow sprite's span (mockup 26 × 5). */
export const DEEP_PAST_LANTERN_LIGHT = { intensity: 2.0, distance: 250 } as const;
export const DEEP_PAST_LANTERN_GLOW_SPAN = 130;

/** The stratum crystals in the deep strata (population increment,
 *  extended by the 2026-10-29 dressing pass): stratum 5 keeps the
 *  original placement (on the stratum's arc, at the alcove radius, 8
 *  above the stratum floor, 30 tall — a crystal, not a monument);
 *  strata 6 and 7 gain one each at the same alcove radius, varied in
 *  size (24 / 36) and arc position so the three read as found, not
 *  placed in a row. All three instance the one shipped file. */
export const DEEP_PAST_CRYSTALS = [
  {
    stratum: 5,
    angle: 5 * DEEP_PAST_STRATUM_ARC_START + 0.9,
    radius: DEEP_PAST_STRATUM_RADIUS[5]! - 15,
    y: DEEP_PAST_STRATUM_Y[5]! + 8,
    size: 30,
  },
  {
    stratum: 6,
    angle: 6 * DEEP_PAST_STRATUM_ARC_START + 1.9,
    radius: DEEP_PAST_STRATUM_RADIUS[6]! - 15,
    y: DEEP_PAST_STRATUM_Y[6]! + 8,
    size: 24,
  },
  {
    stratum: 7,
    angle: 7 * DEEP_PAST_STRATUM_ARC_START + 2.6,
    radius: DEEP_PAST_STRATUM_RADIUS[7]! - 15,
    y: DEEP_PAST_STRATUM_Y[7]! + 8,
    size: 36,
  },
] as const;

/** The original single crystal placement — the first entry above. */
export const DEEP_PAST_CRYSTAL = DEEP_PAST_CRYSTALS[0]!;

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
  radius: DEEP_PAST_TERRACE.radius,
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

/** The route bead (owner-supplied, 2026-10-28): one floats above each
 *  stop of the drawn journey thread, its centre this far above the
 *  stop (the thread itself rides 8 above the stop), spanning this
 *  many units once placed — a marker, not a monument. The scene
 *  clones it per stop and plays its 'Flow' clip on the orb's mixer
 *  pattern. Routes are budgeted up to DEEP_PAST_BEAD_MAX_STOPS stops
 *  (the manifest's instance count for the bead). */
export const DEEP_PAST_BEAD = { size: 10, floatAbove: 10 } as const;
export const DEEP_PAST_BEAD_MAX_STOPS = 12;

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
 * This is the shared centring core every measured fit below ends in —
 * the scale passed here must come from a measurement (span, longest
 * side, or height), never from a placement literal; the scene calls
 * only the measured fits.
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

/** Centre a loaded root and scale it so its horizontal diameter — the
 *  larger of its two horizontal extents — spans `span` (the basin's
 *  pattern: the dish spans the basin, whatever it measures; the rim
 *  ring's diameter lies along its z extent in its own file, so the
 *  diameter is the max of the two, not a chosen axis). Returns the
 *  scale applied. */
export function fitDeepPastAssetToSpan(root: THREE.Object3D, span: number): number {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  return fitDeepPastAsset(root, span / Math.max(0.001, size.x, size.z));
}

/** Centre a loaded root and scale it so its measured height is
 *  `height` (the stair's fit, settlement D1: a flight's uniform scale
 *  is the drop it serves divided by its own measured height — floor
 *  to floor, never stretched). Returns the scale applied. */
export function fitDeepPastAssetToHeight(root: THREE.Object3D, height: number): number {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) return 1;
  return fitDeepPastAsset(root, height / size.y);
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

/** One placement of an instanced repeat: a position on the helix, a
 *  facing (rotation around Y), and a uniform scale applied on top of
 *  the fitted root (fit the root to a UNIT target dimension first —
 *  longest side 1, or height 1 — then the scale here is the placed
 *  size, or the drop for a stair flight). */
export interface DeepPastInstancePlacement {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

/**
 * Instance a fitted root: one InstancedMesh per source mesh, each
 * carrying every placement. The root must already be fitted (centred
 * on the origin at a unit target dimension); each source mesh's world
 * matrix relative to the root is composed under each placement, so
 * multi-mesh pieces keep their internal arrangement, and a piece with
 * two materials (the crystal) instances as two meshes — 2 draw calls,
 * however many placements. The fitted root itself rides along as an
 * invisible child so scene disposal frees the shared geometry and
 * materials with the group. Instanced meshes do not frustum-cull
 * (their instances span the whole helix; they are world-sized
 * dressing, always in frame somewhere).
 */
export function instantiateDeepPastRoot(
  root: THREE.Object3D,
  placements: readonly DeepPastInstancePlacement[],
  name: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const place = new THREE.Object3D();
  for (const mesh of meshes) {
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
    instanced.name = mesh.name ? `${name}:${mesh.name}` : name;
    placements.forEach((p, i) => {
      place.position.set(p.x, p.y, p.z);
      place.rotation.set(0, p.rotationY, 0);
      place.scale.setScalar(p.scale);
      place.updateMatrix();
      instanced.setMatrixAt(i, place.matrix.clone().multiply(mesh.matrixWorld));
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.frustumCulled = false;
    group.add(instanced);
  }
  root.visible = false;
  group.add(root);
  return group;
}
