import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { fadeSwapIn } from "./gltf.js";
import { placeWorldRelics } from "./relicAssets.js";
import {
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_BEAD,
  DEEP_PAST_CRYSTALS,
  DEEP_PAST_LANTERN,
  DEEP_PAST_LANTERN_GLOW_SPAN,
  DEEP_PAST_LANTERN_LIGHT,
  DEEP_PAST_MODELS,
  DEEP_PAST_ORB,
  DEEP_PAST_RIM,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SPIRE_GLOW_SPAN,
  DEEP_PAST_SPIRE_LIGHT,
  DEEP_PAST_SUPERNOVA,
  DEEP_PAST_TERRACE,
  deepPastDressingLanterns,
  deepPastStairFlights,
  deepPastTerraceSlices,
  fitDeepPastAssetToHeight,
  fitDeepPastAssetToSize,
  fitDeepPastAssetToSpan,
  instantiateDeepPastRoot,
  loadAnimatedDeepPastAsset,
  loadDeepPastAsset,
  type DeepPastInstancePlacement,
} from "./deepPastAssets.js";
import {
  DEEP_PAST_STRATA_COUNT,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
  DEEP_PAST_STRATUM_ARC_START,
  DEEP_PAST_STRATUM_ARC_LENGTH,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_RISE_SHELF,
  type DeepPastLayout,
} from "./deepPastLayout.js";

/**
 * Deep Past scene (Phase 3, P3-2) — renders exactly what deepPastLayout returns,
 * nothing more. The host owns the renderer, camera, and fog (palette-matched
 * FogExp2 in deep violet, per the adopted technique stack); this module owns
 * the helix group and its per-frame motion.
 *
 * The recipe's grammar: violet dusk lit by the memories' own lanterns, warming
 * with depth toward the First Light basin; the helix encloses, there is no sky
 * of its own (the host's shared home sky shows above the rim, where the
 * present day lives).
 * Baked glow only — no bloom, no post-processing. The basin is the finished
 * bottom: a warm floor of light and stone over solid rock (C9) — never a pit,
 * never a void. The rim is a boundary: finished darkness above, the camera
 * cannot fly out past it.
 *
 * Draw-call sketch (recipe ceiling 110, the 2026-10-29 fix's budget):
 * procedural ~33 (strata walls 9 · rim bands 9 · plinths 1 · alcoves ≤3
 * · memory lanterns 1 · thread ≤1 · anchors ≤1 · particulate 1 · basin 4
 * (floor + rim ring + glow + rock) · rise shelf 1 + shelf glow 1 ·
 * ships 1). The GLB layer adds 71 more calls once loaded (the manifest's
 * measured count in deepPastAssets.ts: the supernova's 34 point meshes,
 * the bead's 24 at the 12-stop route budget, and every repeat instanced
 * to one call per material — 24 terrace slices cost 1 call, 9 stair
 * flights 1, 25 lanterns 2 + their glow points) and 467,558 tris —
 * the budget holds with the layer in (see deepPastAssets.test.ts).
 * Runtime measurement belongs to the device check (C4's measured
 * half); these constants are the static half.
 *
 * The ten real pieces (basin, terrace, rim, stair, lantern, stratum
 * crystal, supernova remnant, anchor spire, First Light orb, route
 * bead) load async from the manifest in deepPastAssets.ts and swap
 * into the holders named `glb-*` below. Until a piece lands, the
 * procedural form stays — the basin's floor and rim ring are the load
 * fallback, hidden only once the real dish fades in; the other pieces
 * have no procedural form in this scene, so a failed load simply
 * leaves that holder empty and the failure is noted for diagnostics.
 * Every piece is fitted from its own measured file (span / longest
 * side / height) — no bare scale factor survives in the load path.
 *
 * Kindness is structural here: the scene has no state for decline. Every member
 * carries the same light at every depth; an empty layout renders the helix, the
 * basin, and the sky — honest resting ground. Reduced motion holds the descent:
 * no particulate drift, no ship drift, no basin breathing.
 */

export interface DeepPastScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

/** The guided descent (A21, follow-only): rim → basin, capped, user-controlled. */
export const DEEP_PAST_DESCENT = {
  /** Full descent time; the user can leave or resume at any moment. */
  durationMs: 90_000,
  /** The opening heading; the path then turns with the helix itself —
   * one stratum arc twist per floor it passes. */
  baseAngle: 0.6,
} as const;

export interface DeepPastDescentKey {
  progress: number;
  angle: number;
  radius: number;
  y: number;
}

/** The descent's opening height above stratum 0 (the rim arrival vista). */
const DESCENT_START_Y = 150;
/** The arrival orbit's clearance outside the rim ring: the descent opens
 * this far beyond stratum 0's radius, close enough that the helix fills
 * the frame. Derived from the rim radius (never a free-standing literal),
 * so the opening follows the layout if the rim ever moves. */
const DESCENT_ARRIVAL_CLEARANCE = 160;
/** The descent ends hovering this far above the basin floor, facing the orb. */
const DESCENT_BASIN_HOVER = 60;
/** The end pose rides this far inside the basin's radius. (A separate
 * constant from the hover height — the two 60s are a coincidence of the
 * framing, not the same decision.) */
const DESCENT_END_INSET = 60;
/** Total virtual drop, opening vista to basin hover: 150 + 720 + 50 = 920.
 * Progress is proportional to drop, so each stratum floor is reached at
 * the fraction of the descent its depth represents. */
const DESCENT_TOTAL_DROP = DESCENT_START_Y - (DEEP_PAST_BASIN_Y + DESCENT_BASIN_HOVER);

/**
 * The descent path, derived from the layout constants (the 2026-10-29
 * fix): a keyframe at every stratum floor — angle = base + i × the
 * helix twist (1.08 turns over the nine floors, the levels' own
 * winding, not a chosen fraction of a circle), radius = the stratum's
 * radius − 25 (inside the rings, over the alcoves), height = the
 * floor itself — opening from the arrival orbit (stratum 0's radius
 * + the arrival clearance, +150) and settling at the basin hover
 * (radius = basin radius − the end inset, 60 above the basin floor).
 * No literal in this path is free-standing: change a layout constant
 * and the path follows.
 */
export const DEEP_PAST_DESCENT_KEYS: readonly DeepPastDescentKey[] = (() => {
  const keys: DeepPastDescentKey[] = [
    {
      progress: 0,
      angle: DEEP_PAST_DESCENT.baseAngle,
      radius: DEEP_PAST_STRATUM_RADIUS[0]! + DESCENT_ARRIVAL_CLEARANCE,
      y: DESCENT_START_Y,
    },
  ];
  for (let i = 0; i < DEEP_PAST_STRATA_COUNT; i++) {
    keys.push({
      progress: (DESCENT_START_Y - DEEP_PAST_STRATUM_Y[i]!) / DESCENT_TOTAL_DROP,
      angle: DEEP_PAST_DESCENT.baseAngle + i * DEEP_PAST_STRATUM_ARC_START,
      radius: DEEP_PAST_STRATUM_RADIUS[i]! - 25,
      y: DEEP_PAST_STRATUM_Y[i]!,
    });
  }
  keys.push({
    progress: 1,
    angle: DEEP_PAST_DESCENT.baseAngle + DEEP_PAST_STRATA_COUNT * DEEP_PAST_STRATUM_ARC_START,
    radius: DEEP_PAST_BASIN_RADIUS - DESCENT_END_INSET,
    y: DEEP_PAST_BASIN_Y + DESCENT_BASIN_HOVER,
  });
  return keys;
})();

/** A point on the derived path: angle / radius / height lerped between
 * the two keyframes the progress sits between. Pure, testable. */
function descentPoint(progress: number): { angle: number; radius: number; y: number } {
  const p = Math.min(Math.max(progress, 0), 1);
  const keys = DEEP_PAST_DESCENT_KEYS;
  let a = keys[0]!;
  let b = keys[keys.length - 1]!;
  for (let i = 0; i < keys.length - 1; i++) {
    if (p >= keys[i]!.progress && p <= keys[i + 1]!.progress) {
      a = keys[i]!;
      b = keys[i + 1]!;
      break;
    }
  }
  const span = b.progress - a.progress;
  const t = span > 0 ? (p - a.progress) / span : 0;
  return {
    angle: a.angle + (b.angle - a.angle) * t,
    radius: a.radius + (b.radius - a.radius) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function descentPosition(progress: number): [number, number, number] {
  const pt = descentPoint(progress);
  return [Math.sin(pt.angle) * pt.radius, pt.y, Math.cos(pt.angle) * pt.radius];
}

/** Camera pose for a descent progress p ∈ [0, 1] (rim → basin). Pure, testable. */
export function deepPastDescentCamera(progress: number): {
  position: [number, number, number];
  lookAt: [number, number, number];
} {
  const p = Math.min(Math.max(progress, 0), 1);
  const position = descentPosition(p);
  // The look target rides the same path one stratum-drop ahead — you
  // look where you are about to be, at the flight you are about to
  // pass — and across the final segment it settles from the path to
  // the orb, the basin's light, where the descent ends facing.
  const dropAhead = 90 / DESCENT_TOTAL_DROP;
  let lookAt = descentPosition(Math.min(p + dropAhead, 1));
  const lastFloor = DEEP_PAST_DESCENT_KEYS[DEEP_PAST_DESCENT_KEYS.length - 2]!;
  if (p >= lastFloor.progress) {
    const t = (p - lastFloor.progress) / (1 - lastFloor.progress);
    const orb: [number, number, number] = [0, DEEP_PAST_ORB.y, 0];
    lookAt = [
      lookAt[0] + (orb[0] - lookAt[0]) * t,
      lookAt[1] + (orb[1] - lookAt[1]) * t,
      lookAt[2] + (orb[2] - lookAt[2]) * t,
    ];
  }
  return { position, lookAt };
}

/**
 * Where the route beads float: one above each thread stop, its centre
 * DEEP_PAST_BEAD.floatAbove above the stop (the thread itself rides 8
 * above). Pure, testable — the beads follow the layout exactly.
 */
export function deepPastBeadPositions(
  stops: readonly { x: number; y: number; z: number }[],
): [number, number, number][] {
  return stops.map((s) => [s.x, s.y + DEEP_PAST_BEAD.floatAbove, s.z]);
}

/**
 * Reduced motion: the descent becomes stratified stage holds — rim, mid, basin —
 * instead of continuous motion. Same stops, same placement outcome.
 */
export function deepPastDescentStage(elapsedMs: number): number {
  const third = DEEP_PAST_DESCENT.durationMs / 3;
  if (elapsedMs < third) return 0;
  if (elapsedMs < third * 2) return 0.5;
  return 1;
}

const VIOLET_RIM = 0x4a3a63;
const VIOLET_BASIN = 0x5a4436;
const LANTERN = 0xffd9a0;
const STONE = 0x3a2f52;

/** A warm radial glow, computed as bytes — no canvas, so it builds in tests too. */
function makeGlowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2; // 0 at the center, 1 at the edge
      const a = Math.pow(Math.max(0, 1 - d), 2.2) * 255;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 214;
      data[i + 2] = 150;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function hashSeeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EMPTY_DEEP_PAST_LAYOUT: DeepPastLayout = {
  members: [],
  anchors: [],
  thread: null,
  eligibleCount: 0,
  excludedCount: 0,
  omittedEdgeCount: 0,
};

export function createDeepPastScene(
  layout: DeepPastLayout,
  opts: { onRelicVisible?: (slug: string) => void } = {},
): DeepPastScene {
  const group = new THREE.Group();
  group.name = "deep-past";
  let disposed = false;
  const dummy = new THREE.Object3D();
  const glowTex = makeGlowTexture();

  // Relics (relics increment): the Deep Past's four relics — three at the
  // basin and its lowest alcoves, the Witness at the basin's center, in
  // the First Light itself. A relic whose GLB has not landed is simply
  // absent — no stand-in, and its find is never offered (the host learns
  // of it via onRelicVisible).
  const cancelRelics = placeWorldRelics(group, "deep-past", opts.onRelicVisible);

  // Strata: nine lit walls winding down, warming subtly with depth, each with
  // a thin lit rim band at its top edge (same arc parameters — the band cannot
  // drift out of alignment with its wall by construction).
  const rimColor = new THREE.Color(VIOLET_RIM);
  const basinColor = new THREE.Color(VIOLET_BASIN);
  for (let i = 0; i < DEEP_PAST_STRATA_COUNT; i++) {
    const radius = DEEP_PAST_STRATUM_RADIUS[i]!;
    const y = DEEP_PAST_STRATUM_Y[i]!;
    const arcStart = i * DEEP_PAST_STRATUM_ARC_START;
    const stone = new THREE.Color().lerpColors(rimColor, basinColor, i / (DEEP_PAST_STRATA_COUNT - 1));
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 13, 26, 1, true, arcStart, DEEP_PAST_STRATUM_ARC_LENGTH),
      new THREE.MeshStandardMaterial({
        color: stone,
        emissive: 0x120b20,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    wall.position.y = y;
    wall.name = `stratum-${i}`;
    group.add(wall);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 1.5, radius + 1.5, 2, 26, 1, true, arcStart, DEEP_PAST_STRATUM_ARC_LENGTH),
      new THREE.MeshBasicMaterial({ color: 0x8a6a4a, side: THREE.DoubleSide }),
    );
    rim.position.y = y + 6.5;
    rim.name = `stratum-rim-${i}`;
    group.add(rim);
  }

  // The First Light basin: the finished bottom. A warm floor of light and
  // stone, a lit rim ring, a breathing glow — and solid rock below it, so
  // there is no "underneath the Deep Past" to fall into (C9).
  //
  // The real dish (deepPastAssets: basin) is the primary: it loads into
  // `glb-basin` and fades in, hiding the procedural floor + rim ring.
  // Until it lands, that procedural pair IS the basin — the load fallback,
  // never the primary. The solid rock, the glow, and the basin light stay
  // in both cases: the rock is the finished bottom, and the glow is the
  // First Light orb's halo with the basin light as its source (the orb
  // itself loads into `glb-orb` below).
  const basinFallback = new THREE.Group();
  basinFallback.name = "basin-fallback";
  const basinFloor = new THREE.Mesh(
    new THREE.CircleGeometry(DEEP_PAST_BASIN_RADIUS, 48),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85, metalness: 0 }),
  );
  basinFloor.rotation.x = -Math.PI / 2;
  basinFloor.position.y = DEEP_PAST_BASIN_Y;
  basinFloor.name = "basin-floor";
  basinFallback.add(basinFloor);
  const basinRing = new THREE.Mesh(
    new THREE.TorusGeometry(DEEP_PAST_BASIN_RADIUS, 1.1, 8, 48),
    new THREE.MeshBasicMaterial({ color: LANTERN }),
  );
  basinRing.rotation.x = Math.PI / 2;
  basinRing.position.y = DEEP_PAST_BASIN_Y + 0.6;
  basinRing.name = "basin-rim";
  basinFallback.add(basinRing);
  group.add(basinFallback);
  const basinGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }),
  );
  basinGlow.scale.setScalar(190);
  basinGlow.position.y = DEEP_PAST_BASIN_Y + 16;
  basinGlow.name = "basin-glow";
  group.add(basinGlow);
  const basinRock = new THREE.Mesh(
    new THREE.CylinderGeometry(DEEP_PAST_BASIN_RADIUS + 20, DEEP_PAST_BASIN_RADIUS + 40, 200, 24),
    new THREE.MeshStandardMaterial({ color: 0x241a33, roughness: 1, metalness: 0 }),
  );
  basinRock.position.y = DEEP_PAST_BASIN_Y - 100;
  basinRock.name = "basin-rock";
  group.add(basinRock);

  // Real-asset layer: one holder per piece, placed at the manifest's
  // verified positions. A holder is empty until its GLB lands; a load
  // that fails leaves it empty and notes the failure (see
  // loadDeepPastAsset) — the world is never left with a hole.
  const basinHolder = new THREE.Group();
  basinHolder.name = "glb-basin";
  basinHolder.position.y = DEEP_PAST_BASIN_GLB_Y;
  group.add(basinHolder);
  // The terrace slices, the stair flights, and the dressing lanterns
  // are instanced layers: their holders sit at the origin and the
  // per-instance placements (derived in deepPastAssets) carry every
  // position — one holder per piece, empty until its GLB lands.
  const terraceHolder = new THREE.Group();
  terraceHolder.name = "glb-terrace";
  group.add(terraceHolder);
  const rimHolder = new THREE.Group();
  rimHolder.name = "glb-rim";
  rimHolder.position.y = DEEP_PAST_RIM.y;
  group.add(rimHolder);
  const stairHolder = new THREE.Group();
  stairHolder.name = "glb-stair";
  group.add(stairHolder);
  const lanternHolder = new THREE.Group();
  lanternHolder.name = "glb-lantern";
  lanternHolder.position.set(
    Math.cos(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius,
    DEEP_PAST_LANTERN.y,
    Math.sin(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius,
  );
  group.add(lanternHolder);
  const lanternsHolder = new THREE.Group();
  lanternsHolder.name = "glb-lanterns";
  group.add(lanternsHolder);
  // The stratum crystals (population increment + the 2026-10-29
  // dressing pass): three crystals down the deep strata, instanced
  // from the one shipped file — both materials, 2 calls; their purple
  // is their identity. The holder stays empty until the GLB lands.
  const crystalHolder = new THREE.Group();
  crystalHolder.name = "glb-crystal";
  group.add(crystalHolder);
  // The dead star (Sketchfab long game): a slimmed supernova remnant
  // in the deep strata, loaded as-is — a point cloud, 34 meshes, 34
  // calls; its unlit points are the light. The holder stays empty
  // until its GLB lands.
  const supernovaHolder = new THREE.Group();
  supernovaHolder.name = "glb-supernova";
  supernovaHolder.position.set(
    Math.cos(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius,
    DEEP_PAST_SUPERNOVA.y,
    Math.sin(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius,
  );
  group.add(supernovaHolder);

  // The anchor spire: a tall stone nail on stratum 1, opposite the
  // terrace, its base on the stratum floor and its tip above the rim
  // plane. The holder stays empty until its GLB lands.
  const spireHolder = new THREE.Group();
  spireHolder.name = "glb-spire";
  spireHolder.position.set(
    Math.cos(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius,
    DEEP_PAST_SPIRE.y,
    Math.sin(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius,
  );
  group.add(spireHolder);

  // The First Light orb: a glowing sphere hovers just above the pool at
  // the basin center, where the interim basin light already sits. The
  // holder stays empty until its GLB lands.
  const orbHolder = new THREE.Group();
  orbHolder.name = "glb-orb";
  orbHolder.position.set(0, DEEP_PAST_ORB.y, 0);
  group.add(orbHolder);

  const hideBasinFallback = () => {
    if (basinFallback.parent !== group) return;
    group.remove(basinFallback);
    disposeObject3D(basinFallback);
  };
  const loadInto = (
    model: (typeof DEEP_PAST_MODELS)[number],
    holder: THREE.Group,
    fit: (root: THREE.Object3D) => void,
    onLanded?: (root: THREE.Object3D) => void,
  ) => {
    void loadDeepPastAsset(model.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      fit(loaded);
      holder.add(loaded);
      onLanded?.(loaded);
    });
  };
  // A placement on a stratum ring, in the scene's (cos, sin)
  // convention; tangential pieces (terrace, stair) face along the
  // arc — rotation.y = −angle − π/2, the original placements' pattern.
  const ringPlacement = (
    angle: number,
    radius: number,
    y: number,
    scale: number,
    tangential = true,
  ): DeepPastInstancePlacement => ({
    x: Math.cos(angle) * radius,
    y,
    z: Math.sin(angle) * radius,
    rotationY: tangential ? -angle - Math.PI / 2 : 0,
    scale,
  });
  // An instanced layer: fit the loaded root to its unit target
  // dimension, then instance it at the derived placements. A failed
  // load leaves the holder empty and noted, exactly like loadInto.
  const loadInstanced = (
    model: (typeof DEEP_PAST_MODELS)[number],
    holder: THREE.Group,
    fitUnit: (root: THREE.Object3D) => void,
    placements: readonly DeepPastInstancePlacement[],
    name: string,
    onLanded?: () => void,
  ) => {
    void loadDeepPastAsset(model.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      fitUnit(loaded);
      holder.add(instantiateDeepPastRoot(loaded, placements, name));
      onLanded?.();
    });
  };
  // The dish fades in over the procedural floor; the fallback is hidden
  // only once the real dish is mostly visible (a crossfade, not a cut).
  loadInto(
    DEEP_PAST_MODELS[0]!,
    basinHolder,
    (root) => fitDeepPastAssetToSpan(root, DEEP_PAST_BASIN_SPAN),
    (root) => fadeSwapIn(root, hideBasinFallback),
  );
  loadInstanced(
    DEEP_PAST_MODELS[1]!,
    terraceHolder,
    (root) => fitDeepPastAssetToSize(root, 1),
    deepPastTerraceSlices().map((s) => ringPlacement(s.angle, s.radius, s.y, DEEP_PAST_TERRACE.size)),
    "terrace-slices",
  );
  loadInto(DEEP_PAST_MODELS[2]!, rimHolder, (root) =>
    fitDeepPastAssetToSpan(root, DEEP_PAST_RIM.span),
  );
  loadInstanced(
    DEEP_PAST_MODELS[3]!,
    stairHolder,
    (root) => fitDeepPastAssetToHeight(root, 1),
    deepPastStairFlights().map((f) => ringPlacement(f.angle, f.radius, f.y, f.drop)),
    "stair-flights",
  );
  loadInto(
    DEEP_PAST_MODELS[4]!,
    lanternHolder,
    (root) => fitDeepPastAssetToSize(root, DEEP_PAST_LANTERN.size),
    () => {
      // The lantern's glow is painted into its texture (no emissive in
      // the file), so it gets a real warm light + glow sprite on load —
      // the basin's treatment, at this lantern's scale.
      const light = new THREE.PointLight(
        0xffc98a,
        DEEP_PAST_LANTERN_LIGHT.intensity,
        DEEP_PAST_LANTERN_LIGHT.distance,
      );
      lanternHolder.add(light);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      glow.scale.setScalar(DEEP_PAST_LANTERN_GLOW_SPAN);
      glow.name = "glb-lantern-glow";
      lanternHolder.add(glow);
    },
  );
  // The dressing lanterns: the same file, instanced at the far end of
  // every terrace slice. Their glows ride as ONE points cloud (the
  // memory-lantern pattern — a sprite per lantern would cost 24 calls
  // for light the texture already paints); the cloud appears only
  // when the lanterns themselves land.
  const dressingLanterns = deepPastDressingLanterns();
  loadInstanced(
    DEEP_PAST_MODELS[4]!,
    lanternsHolder,
    (root) => fitDeepPastAssetToSize(root, 1),
    dressingLanterns.map((l) => ringPlacement(l.angle, l.radius, l.y, DEEP_PAST_LANTERN.size, false)),
    "lanterns-dressing",
    () => {
      const positions = new Float32Array(dressingLanterns.length * 3);
      dressingLanterns.forEach((l, i) => {
        positions[i * 3] = Math.cos(l.angle) * l.radius;
        positions[i * 3 + 1] = l.y;
        positions[i * 3 + 2] = Math.sin(l.angle) * l.radius;
      });
      const glowGeo = new THREE.BufferGeometry();
      glowGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const glows = new THREE.Points(
        glowGeo,
        new THREE.PointsMaterial({
          size: 90,
          sizeAttenuation: true,
          map: glowTex,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      glows.name = "glb-lantern-glows";
      lanternsHolder.add(glows);
    },
  );
  loadInstanced(
    DEEP_PAST_MODELS[5]!,
    crystalHolder,
    (root) => fitDeepPastAssetToSize(root, 1),
    DEEP_PAST_CRYSTALS.map((c) => ringPlacement(c.angle, c.radius, c.y, c.size, false)),
    "crystals",
  );
  loadInto(DEEP_PAST_MODELS[6]!, supernovaHolder, (root) =>
    fitDeepPastAssetToSize(root, DEEP_PAST_SUPERNOVA.size),
  );
  loadInto(
    DEEP_PAST_MODELS[7]!,
    spireHolder,
    (root) => fitDeepPastAssetToSize(root, DEEP_PAST_SPIRE.size),
    () => {
      // The tip of the nail glows warm, as the owner directed — a real
      // warm light + glow sprite at the tip, the lantern's treatment.
      // The fitted root is centred in the holder, so the tip sits half
      // the spire's height above the holder's origin.
      const tipY = DEEP_PAST_SPIRE.size / 2;
      const light = new THREE.PointLight(
        0xffc98a,
        DEEP_PAST_SPIRE_LIGHT.intensity,
        DEEP_PAST_SPIRE_LIGHT.distance,
      );
      light.position.set(0, tipY, 0);
      spireHolder.add(light);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      glow.scale.setScalar(DEEP_PAST_SPIRE_GLOW_SPAN);
      glow.position.set(0, tipY, 0);
      glow.name = "glb-spire-glow";
      spireHolder.add(glow);
    },
  );
  // Animated pieces (the orb's 'FirstLight' clip, the route beads'
  // 'Flow') load through the animated loader: their clips tick on the
  // scene's mixers in update(), the Scale pattern — delta clamped,
  // reduced motion holds them still.
  const clipMixers: THREE.AnimationMixer[] = [];
  void loadAnimatedDeepPastAsset(DEEP_PAST_MODELS[8]!.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded.scene);
      return;
    }
    fitDeepPastAssetToSize(loaded.scene, DEEP_PAST_ORB.size);
    orbHolder.add(loaded.scene);
    const mixer = new THREE.AnimationMixer(loaded.scene);
    for (const clip of loaded.animations) mixer.clipAction(clip).play();
    clipMixers.push(mixer);
  });

  // The rim-side resting place for risen members: a finished stone platform
  // with its own lamp, empty when nothing is risen.
  const shelf = new THREE.Mesh(
    new THREE.CircleGeometry(60, 36),
    new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9, metalness: 0 }),
  );
  shelf.rotation.x = -Math.PI / 2;
  shelf.position.set(DEEP_PAST_RISE_SHELF.x, DEEP_PAST_RISE_SHELF.y, DEEP_PAST_RISE_SHELF.z);
  shelf.name = "rise-shelf";
  group.add(shelf);
  const shelfGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  shelfGlow.scale.setScalar(60);
  shelfGlow.position.set(DEEP_PAST_RISE_SHELF.x, DEEP_PAST_RISE_SHELF.y + 12, DEEP_PAST_RISE_SHELF.z);
  shelfGlow.name = "rise-glow";
  group.add(shelfGlow);

  // Members: plinths ground every alcove on its stratum's top edge; the form
  // says what kind of thing it is (never how much it matters); the lantern is
  // its own small warm glow — the same light at every depth, by construction.
  // Lanterns are glow POINTS, not spheres: a 2,000-member sphere field would
  // cost ~320k tris against a ≤60k lantern allocation.
  const members = layout.members;
  if (members.length > 0) {
    const plinthGeo = new THREE.CylinderGeometry(4.5, 5.5, 3, 8);
    const plinthMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9, metalness: 0 });
    const plinths = new THREE.InstancedMesh(plinthGeo, plinthMat, members.length);
    members.forEach((m, i) => {
      dummy.position.set(m.x, m.y, m.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      plinths.setMatrixAt(i, dummy.matrix);
    });
    plinths.name = "alcove-plinths";
    group.add(plinths);

    const stoneGeo = new THREE.DodecahedronGeometry(3.2);
    const sproutGeo = new THREE.ConeGeometry(2.6, 9, 5);
    const ringGeo = new THREE.TorusGeometry(5, 1.1, 8, 24);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8, metalness: 0.05 });
    const sproutMat = new THREE.MeshStandardMaterial({ color: 0x8a76c9, roughness: 0.85, metalness: 0 });
    const ringMat = new THREE.MeshStandardMaterial({ color: LANTERN, roughness: 0.6, metalness: 0.2 });
    const byForm = {
      stone: members.filter((m) => m.kind !== "action" && !m.gathering),
      sprout: members.filter((m) => m.kind === "action"),
      ring: members.filter((m) => m.gathering),
    } as const;
    const forms = [
      { list: byForm.stone, geo: stoneGeo, mat: stoneMat, name: "alcoves-stone", lift: 3.5, flat: false },
      { list: byForm.sprout, geo: sproutGeo, mat: sproutMat, name: "alcoves-sprout", lift: 3.5, flat: false },
      { list: byForm.ring, geo: ringGeo, mat: ringMat, name: "alcoves-gathering", lift: 2, flat: true },
    ] as const;
    for (const form of forms) {
      if (form.list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(form.geo, form.mat, form.list.length);
      form.list.forEach((m, i) => {
        dummy.position.set(m.x, m.y + form.lift, m.z);
        dummy.rotation.set(form.flat ? Math.PI / 2 : 0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.name = form.name;
      group.add(mesh);
    }

    const lanternPositions = new Float32Array(members.length * 3);
    members.forEach((m, i) => {
      lanternPositions[i * 3] = m.x;
      lanternPositions[i * 3 + 1] = m.y + 8;
      lanternPositions[i * 3 + 2] = m.z;
    });
    const lanternGeo = new THREE.BufferGeometry();
    lanternGeo.setAttribute("position", new THREE.BufferAttribute(lanternPositions, 3));
    const lanterns = new THREE.Points(
      lanternGeo,
      new THREE.PointsMaterial({
        size: 14,
        sizeAttenuation: true,
        map: glowTex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    lanterns.name = "memory-lanterns";
    group.add(lanterns);
  }

  // Anchors (D-8): a fine line of light rising from a member's alcove toward
  // the rim — a visit-path to its other appearance, never a relocation.
  // The anchor spire stands at stratum 1 only (glb-spire above). An
  // earlier plan put a spire at each anchor's foot, but that plan
  // predated the owner's actual spire file: what arrived is a
  // 120-unit landmark, not the small terrace marker the plan imagined
  // (settlement D2, 2026-10-29 — the spire-at-each-anchor idea is
  // dropped, not deferred). Landmarks stay singular, the route bead
  // marks the journey stops, and the anchor line keeps its light-only
  // form: it is a visit-path, not a structure.
  if (layout.anchors.length > 0) {
    const byId = new Map(members.map((m) => [m.nodeId, m]));
    const positions: number[] = [];
    for (const anchor of layout.anchors) {
      const m = byId.get(anchor.fromNodeId);
      if (!m) continue; // layout guarantees the member; defense in depth
      positions.push(m.homeX, m.homeY + 8, m.homeZ, m.homeX * 1.15, 30, m.homeZ * 1.15);
    }
    const anchorGeo = new THREE.BufferGeometry();
    anchorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    const anchors = new THREE.LineSegments(
      anchorGeo,
      new THREE.LineBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.5 }),
    );
    anchors.name = "anchors";
    group.add(anchors);
  }

  // The Chronicle thread (A21): a lit ribbon through the active route's stops,
  // in chronological order — the route, made visible before it is traveled.
  // One route bead (the owner's file, deepPastAssets) floats above each
  // stop, its 'Flow' clip playing on the orb's mixer pattern; the line
  // stays the route, the beads mark the stops. No thread → no beads:
  // the beads follow the layout exactly — routes longer than the
  // manifest's 12-stop budget envelope still mark every stop (each
  // extra stop adds 2 calls / 1,597 tris beyond the envelope). A
  // failed bead load leaves the bare thread and notes the failure —
  // never a substitute marker.
  if (layout.thread && layout.thread.stops.length >= 2) {
    const points = layout.thread.stops.map((s) => new THREE.Vector3(s.x, s.y + 8, s.z));
    const curve = new THREE.CatmullRomCurve3(points);
    const threadGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(220));
    const thread = new THREE.Line(
      threadGeo,
      new THREE.LineBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.95 }),
    );
    thread.name = `thread-${layout.thread.routeId}`;
    group.add(thread);
    const beadPositions = deepPastBeadPositions(layout.thread.stops);
    const beadGroup = new THREE.Group();
    beadGroup.name = "route-beads";
    group.add(beadGroup);
    void loadAnimatedDeepPastAsset(DEEP_PAST_MODELS[9]!.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded.scene);
        return;
      }
      beadPositions.forEach((pos, i) => {
        // Each bead rides in its own holder at the stop: the fitted
        // clone keeps the fit's centring offset as its local position
        // (overwriting it would silently misplace any future re-slim
        // whose pivot sits off-origin).
        const holder = new THREE.Group();
        holder.name = `route-bead-${i}`;
        holder.position.set(pos[0], pos[1], pos[2]);
        const bead = loaded.scene.clone();
        fitDeepPastAssetToSize(bead, DEEP_PAST_BEAD.size);
        holder.add(bead);
        beadGroup.add(holder);
        const mixer = new THREE.AnimationMixer(bead);
        for (const clip of loaded.animations) mixer.clipAction(clip).play();
        clipMixers.push(mixer);
      });
    });
  }

  // Marine snow: slow particulate drift, the depth's own atmosphere — never
  // fact, never a signal of activity.
  const snowCount = 600;
  const snowRand = mulberry32(hashSeeded("deep-past / first-descent-1:marine-snow"));
  const snowPositions = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowCount; i++) {
    const angle = snowRand() * Math.PI * 2;
    const radius = 60 + snowRand() * 440;
    const y = 80 - snowRand() * 910;
    snowPositions[i * 3] = Math.cos(angle) * radius;
    snowPositions[i * 3 + 1] = y;
    snowPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({ size: 2.5, color: 0xbfa8e0, transparent: true, opacity: 0.5, sizeAttenuation: true }),
  );
  snow.name = "marine-snow";
  group.add(snow);

  // The sky above the rim is the host's shared home sky (homeSky.ts).

  // Violet dusk light: the memories' own lanterns do the warming; the ambient
  // is low and calm, the basin's ember is the one true warmth below.
  // The First Light orb has landed (glb-orb, deepPastAssets): a glowing
  // sphere hovers just above the pool and this glow is its halo; the basin
  // light stays as the light source. The orb is the focal light: without it
  // the basin still reads, with it the light gains a visible body.
  group.add(new THREE.AmbientLight(0x8a76c9, 0.85));
  const basinLight = new THREE.PointLight(0xffc98a, 2.2, 500);
  basinLight.position.set(0, DEEP_PAST_BASIN_Y + 24, 0);
  group.add(basinLight);
  const rimLight = new THREE.DirectionalLight(0x9a86d9, 0.7);
  rimLight.position.set(300, 600, 400);
  group.add(rimLight);

  // Ships as set dressing (Q4): a few small silent procedural hulls hovering
  // between the strata — slow drift, no interaction, no progression. No asset
  // ships without a verified license; the procedural hull is the ship.
  const shipRand = mulberry32(hashSeeded("deep-past / first-descent-1:ships"));
  const shipSpecs = [2, 4, 6].map((stratum) => {
    const angle = shipRand() * Math.PI * 2;
    const radius = 260 + shipRand() * 90;
    return {
      angle,
      radius,
      y: DEEP_PAST_STRATUM_Y[stratum]! + 40,
      speed: 0.00002 + shipRand() * 0.00001,
    };
  });
  const shipGeo = new THREE.OctahedronGeometry(5);
  shipGeo.scale(1, 0.45, 2.4);
  const ships = new THREE.InstancedMesh(
    shipGeo,
    new THREE.MeshStandardMaterial({ color: 0xb9c4d6, roughness: 0.5, metalness: 0.3 }),
    shipSpecs.length,
  );
  const placeShip = (spec: (typeof shipSpecs)[number], elapsedMs: number) => {
    const a = spec.angle + elapsedMs * spec.speed;
    dummy.position.set(Math.cos(a) * spec.radius, spec.y, Math.sin(a) * spec.radius);
    dummy.rotation.set(0, -a, 0);
    dummy.updateMatrix();
    return dummy.matrix;
  };
  shipSpecs.forEach((spec, i) => ships.setMatrixAt(i, placeShip(spec, 0)));
  ships.name = "dressing-ships";
  group.add(ships);

  let lastElapsed = 0;
  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) {
        lastElapsed = elapsedMs;
        return;
      }
      const dt = Math.max(0, elapsedMs - lastElapsed);
      lastElapsed = elapsedMs;
      // Marine snow sinks slowly and wraps back to the top.
      const pos = snowGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < snowCount; i++) {
        let y = pos.getY(i) - dt * 0.0015;
        if (y < DEEP_PAST_BASIN_Y) y += 910;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      // Dressing ships drift their slow circles.
      shipSpecs.forEach((spec, i) => ships.setMatrixAt(i, placeShip(spec, elapsedMs)));
      ships.instanceMatrix.needsUpdate = true;
      // The basin's ember shimmer breathes — weather only, never depth or state.
      const breath = Math.sin(elapsedMs * 0.0005);
      basinGlow.scale.setScalar(190 + breath * 10);
      basinLight.intensity = 2.2 + breath * 0.15;
      // The animated clips (the orb's FirstLight, the beads' Flow) tick
      // on the same clock: delta clamped so a tab-switch can never jump
      // them forward by minutes. Reduced motion holds them still with
      // the rest of the space (see the early return above).
      const deltaS = Math.min(0.1, dt / 1000);
      for (const mixer of clipMixers) mixer.update(deltaS);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
