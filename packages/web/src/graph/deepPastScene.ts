import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { disposeObject3D } from "./graph3dHelpers.js";
import { fadeSwapIn } from "./gltf.js";
import { placeWorldRelics } from "./relicAssets.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import {
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_MODELS,
  DEEP_PAST_ORB,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SUPERNOVA,
  fitDeepPastAssetToHeight,
  fitDeepPastAssetToSize,
  fitDeepPastAssetToSpan,
  loadAnimatedDeepPastAsset,
  loadDeepPastAsset,
} from "./deepPastAssets.js";
import {
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_RISE_SHELF,
  DEEP_PAST_SHIP_BERTH,
  DEEP_PAST_STAIR,
  DEEP_PAST_STRATA_COUNT,
  DEEP_PAST_STRATUM_ARC_LENGTH,
  DEEP_PAST_STRATUM_ARC_START,
  DEEP_PAST_STRATUM_RADIUS,
  DEEP_PAST_STRATUM_Y,
  buildDeepPastStairSteps,
  buildDeepPastWalkPoints,
  deepPastFloorY,
  type DeepPastLayout,
  type DeepPastMember,
} from "./deepPastLayout.js";

/**
 * Deep Past scene — REWORK (2026-10-29, design note
 * `deep-past-rework-design-note.md` + the functions/animation
 * addendum). Renders exactly what deepPastLayout returns, nothing
 * more. The host owns the renderer, camera, and fog; this module owns
 * the helix group and its per-frame motion.
 *
 * The rework's architecture is GENERATED from the layout constants
 * (the pre-asset mockup's method, §5): nine solid sector discs with
 * gold trim lips, a rim band on stratum 0, and one continuous helical
 * stair whose connection to the discs is the layout's own arithmetic
 * (buildDeepPastStairSteps) — no GLB is repeated or used as
 * architecture. The only GLBs are the four singular keeps in
 * deepPastAssets.ts (basin dish, anchor spire, First Light orb,
 * re-slimmed supernova), each in a `glb-*` holder; the route beads
 * are code-built (addendum AN15) because the approved bead is a
 * four-light cosmic interior no GLB carries.
 *
 * Budgets (design note §9, hard caps): ≤48 draw calls whole scene,
 * ≤45k generated triangles, ≤65k points, ≤2 real point lights (the
 * basin key at the orb + the stratum-3 hero orb; the spire's tip is
 * a glow sprite only). Generated architecture is merged geometry on
 * Lambert/Basic materials; Standard lives only on the kept GLBs,
 * the member forms, and the hero orbs.
 *
 * Motion (addendum): the orb's 'FirstLight' clip plays on a mixer
 * with the delta clamped to 0.1 s (AN1); the thread kindles behind
 * the ride via frame-state (AN3); bead interiors run four free
 * lights per stop (AN15) with current-stop emphasis (AN2); motes
 * RISE through the restored light shaft (AN5/AN6); the basin breathes
 * on a ~12.6 s sine (AN7); alcove lanterns breathe out of phase
 * (AN8); risen members glide to the shelf over 5.2 s with a light
 * column (AN10) when the host names them in `riseGlides`; a newly
 * resting member is CARRIED in by the ship (AN11) when the host
 * names it in `carryIn`. The ship is a scene resident: berthed at
 * the rim by default, posed by the host through frame-state during
 * the Chronicle ride (AN14). Reduced motion holds all motion but
 * still applies frame-state statics — ship pose, kindle, bead
 * emphasis — because the host jumps the ship between stops in RM.
 *
 * Kindness is structural: the scene has no state for decline. Every
 * member carries the same light at every depth; an empty layout
 * renders the helix, the basin, and the shaft — honest resting
 * ground.
 */

export interface DeepPastFrameState {
  /** Chronicle kindling, 0..1 — the bright thread's lit fraction (AN3). */
  kindle?: number;
  /** The thread stop the ride currently dwells at (AN2 emphasis). */
  currentStop?: number;
  /** The ship's pose for this frame; null/absent = the rim berth (AN14/F16). */
  shipPose?: { position: [number, number, number]; target: [number, number, number] } | null;
  /** The camera's world position — bead interiors dim behind their far wall from it (AN15). */
  cameraPosition?: [number, number, number];
}

export interface DeepPastScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
  /** Host → scene frame state (kindle, current stop, ship pose, camera). Stored, consumed by update(). */
  setFrameState: (state: DeepPastFrameState) => void;
  /** AN4: the alcove ring — blooms once at the member's resting position. */
  pulseAlcove: (nodeId: number) => void;
  /** Raycast the member forms/pads; returns the member's nodeId or null. */
  pickMember: (ndc: { x: number; y: number }, camera: THREE.Camera) => number | null;
  /** A point on the Chronicle thread curve (u ∈ [0,1]), for the host's ship. Null without a thread. */
  threadPointAt: (u: number) => { position: [number, number, number]; tangent: [number, number, number] } | null;
  /** The thread parameter nearest each stop, in stop order. Empty without a thread. */
  stopFractions: () => number[];
}

const VIOLET_RIM = 0x4a3a63;
const VIOLET_BASIN = 0x5a4436;
const LANTERN = 0xffd9a0;
const STONE = 0x3a2f52;
const GOLD = 0xc9a35c;
const BASIN_FLOOR_TOP = DEEP_PAST_BASIN_Y + 1.3; // -166.7

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

/** Fill a geometry's `color` attribute with one flat color (the merged Lambert merges are vertex-colored). */
function colored(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

const pixelRatio = (): number => {
  try {
    return Math.min(2, globalThis.devicePixelRatio || 1);
  } catch {
    return 1;
  }
};

/**
 * Cylinder theta → layout angle conversion. three.js CylinderGeometry
 * places a vertex at angle θ as (r·sinθ, ·, r·cosθ); the layout's
 * angle convention is x = cos a, z = sin a. Substituting
 * θ = π/2 − a gives (r·sin(π/2−a), ·, r·cos(π/2−a)) = (r·cos a, ·, r·sin a)
 * — but as θ increases a decreases, so an arc [arcStart, arcStart+len]
 * in layout angles is swept by θ from π/2 − (arcStart + len) upward
 * with thetaLength = len. Proven by the alignment unit test, which
 * reads the merged vertices' atan2(z, x) span back off the geometry.
 */
function cylinderThetaStart(arcStart: number, arcLength: number): number {
  return Math.PI / 2 - (arcStart + arcLength);
}

/**
 * Torus arc → layout angle conversion. A TorusGeometry arc starts at
 * +X in its XY plane and sweeps toward +Y. rotateZ(φ) first moves the
 * arc's start to angle φ; rotateX(−π/2) then maps (x, y, z) →
 * (x, z, −y), so a point at XY angle β lands at XZ angle −β. To cover
 * layout angles [arcStart, arcStart + len] the pre-rotation must
 * place the arc at [−(arcStart + len), −arcStart]: φ = −(arcStart +
 * len), sweeping upward in β covers the span in reverse — the same
 * covered span, proven by the same alignment test.
 */
function torusArc(geo: THREE.BufferGeometry, arcStart: number, arcLength: number): THREE.BufferGeometry {
  geo.rotateZ(-(arcStart + arcLength));
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export const EMPTY_DEEP_PAST_LAYOUT: DeepPastLayout = {
  members: [],
  strata: [],
  anchors: [],
  thread: null,
  eligibleCount: 0,
  excludedCount: 0,
  omittedEdgeCount: 0,
};

export function createDeepPastScene(
  layout: DeepPastLayout,
  opts: {
    onRelicVisible?: (slug: string) => void;
    /** Members (by nodeId) whose rise glide plays from scene creation (AN10). */
    riseGlides?: number[];
    /** Members newly come to rest: the FIRST is carried in by the ship (AN11); the rest simply rest. */
    carryIn?: number[];
  } = {},
): DeepPastScene {
  const group = new THREE.Group();
  group.name = "deep-past";
  let disposed = false;
  const dummy = new THREE.Object3D();
  const glowTex = makeGlowTexture();
  const rimColor = new THREE.Color(VIOLET_RIM);
  const basinColor = new THREE.Color(VIOLET_BASIN);
  const stratumColor = (i: number): THREE.Color =>
    new THREE.Color().lerpColors(rimColor, basinColor, i / (DEEP_PAST_STRATA_COUNT - 1));

  // Relics: the Deep Past's four — three at the basin and its lowest
  // alcoves, the Witness at the basin's center, in the First Light
  // itself. A relic whose GLB has not landed is simply absent — no
  // stand-in, and its find is never offered (the host learns of it
  // via onRelicVisible).
  const cancelRelics = placeWorldRelics(group, "deep-past", opts.onRelicVisible);

  // ---- Strata: nine solid sector discs + the rim band, ONE merge ----
  // Disc vertices carry their stratum's tint (rim violet warming to
  // basin umber with depth); the band rides stratum 0 in the same
  // merge. Hero-orb stands join this merge too (plain stone).
  const strataGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DEEP_PAST_STRATA_COUNT; i++) {
    const radius = DEEP_PAST_STRATUM_RADIUS[i]!;
    const arcStart = i * DEEP_PAST_STRATUM_ARC_START;
    const disc = new THREE.CylinderGeometry(
      radius,
      radius,
      2.6,
      48,
      1,
      false,
      cylinderThetaStart(arcStart, DEEP_PAST_STRATUM_ARC_LENGTH),
      DEEP_PAST_STRATUM_ARC_LENGTH,
    );
    disc.translate(0, DEEP_PAST_STRATUM_Y[i]!, 0);
    strataGeos.push(colored(disc, stratumColor(i)));
  }
  // Rim band: stratum 0's outer wall (radius R0 + 1, height 6, base on
  // stratum 0's floor) covering arcs [0, 3.0] and [3.8, 4.4] — the
  // 3.0–3.8 gap is the arrival/stair gap, where the ship berths.
  for (const [a, b] of [
    [0, 3.0],
    [3.8, DEEP_PAST_STRATUM_ARC_LENGTH],
  ] as const) {
    const band = new THREE.CylinderGeometry(
      DEEP_PAST_STRATUM_RADIUS[0]! + 1,
      DEEP_PAST_STRATUM_RADIUS[0]! + 1,
      6,
      36,
      1,
      true,
      cylinderThetaStart(a, b - a),
      b - a,
    );
    band.translate(0, deepPastFloorY(0) + 3, 0);
    strataGeos.push(colored(band, stratumColor(0)));
  }

  // ---- Gold trims: one merge (disc lips, band tops, basin ring, stair strips) ----
  const trimGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DEEP_PAST_STRATA_COUNT; i++) {
    const radius = DEEP_PAST_STRATUM_RADIUS[i]!;
    const arcStart = i * DEEP_PAST_STRATUM_ARC_START;
    const lip = new THREE.TorusGeometry(radius - 0.3, 0.5, 8, 72, DEEP_PAST_STRATUM_ARC_LENGTH);
    torusArc(lip, arcStart, DEEP_PAST_STRATUM_ARC_LENGTH);
    lip.translate(0, deepPastFloorY(i), 0);
    trimGeos.push(lip);
  }
  for (const [a, b] of [
    [0, 3.0],
    [3.8, DEEP_PAST_STRATUM_ARC_LENGTH],
  ] as const) {
    const arc = new THREE.TorusGeometry(
      DEEP_PAST_STRATUM_RADIUS[0]! + 0.7,
      0.5,
      8,
      48,
      b - a,
    );
    torusArc(arc, a, b - a);
    arc.translate(0, deepPastFloorY(0) + 6, 0);
    trimGeos.push(arc);
  }
  const basinRingGeo = new THREE.TorusGeometry(DEEP_PAST_BASIN_RADIUS, 0.5, 8, 72);
  basinRingGeo.rotateX(-Math.PI / 2);
  basinRingGeo.translate(0, BASIN_FLOOR_TOP, 0);
  trimGeos.push(basinRingGeo);

  // ---- The stair: steps + cheeks in one merge, gold strips into the trims ----
  // Step orientation: a box whose local X is rotated by rotationY =
  // −angle maps local +X to (cos angle, 0, sin angle) — the RADIAL
  // direction — and local +Z to (−sin angle, 0, cos angle), the
  // tangent. So BoxGeometry(radialWidth, height, tangentialDepth)
  // rotated −angle sits with its width radial and its depth along
  // the arc, centred exactly on the layout step's (x, z).
  const stairGeos: THREE.BufferGeometry[] = [];
  const steps = buildDeepPastStairSteps();
  const windStep = DEEP_PAST_STAIR.windRad / DEEP_PAST_STAIR.stepsPerFlight;
  for (const step of steps) {
    const arcLen = windStep * step.radius;
    const upper = step.flight - 1; // flight k leaves stratum k−1; flight 9 leaves stratum 8
    const upperRadius = DEEP_PAST_STRATUM_RADIUS[upper]!;
    const tint = stratumColor(Math.min(upper, DEEP_PAST_STRATA_COUNT - 1));
    const box = new THREE.BoxGeometry(14, 3, arcLen);
    box.rotateY(-step.angle);
    box.translate(step.x, step.topY - 1.5, step.z);
    stairGeos.push(colored(box, tint));
    for (const edgeRadius of [upperRadius - DEEP_PAST_STAIR.bandInnerOffset, upperRadius - DEEP_PAST_STAIR.bandOuterOffset]) {
      const cheek = new THREE.BoxGeometry(0.5, 2.2, arcLen);
      cheek.rotateY(-step.angle);
      cheek.translate(Math.cos(step.angle) * edgeRadius, step.topY + 1.1, Math.sin(step.angle) * edgeRadius);
      stairGeos.push(colored(cheek, tint));
    }
    const strip = new THREE.BoxGeometry(0.6, 0.3, arcLen);
    strip.rotateY(-step.angle);
    const outerRadius = upperRadius - DEEP_PAST_STAIR.bandOuterOffset;
    strip.translate(Math.cos(step.angle) * outerRadius, step.topY + 2.2 + 0.15, Math.sin(step.angle) * outerRadius);
    trimGeos.push(strip);
  }

  // Hero-orb stands join the strata merge (stone, at the hero orbs' feet).
  const heroOrbPos = (stratum: number): { x: number; z: number; base: number; cx: number; cy: number; cz: number } => {
    const angle = stratum * DEEP_PAST_STRATUM_ARC_START + 1.1;
    const radius = DEEP_PAST_STRATUM_RADIUS[stratum]! - 16;
    const base = deepPastFloorY(stratum);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return { x, z, base, cx: x, cy: base + 2.6 + 2.1, cz: z };
  };
  for (const stratum of [3, 7]) {
    const p = heroOrbPos(stratum);
    const stand = new THREE.CylinderGeometry(0.35, 0.45, 2.6, 10);
    stand.translate(p.x, p.base + 1.3, p.z);
    strataGeos.push(colored(stand, new THREE.Color(STONE)));
  }

  const strataMerged = mergeGeometries(strataGeos, false);
  if (strataMerged) {
    const strata = new THREE.Mesh(strataMerged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    strata.name = "strata";
    group.add(strata);
  }
  const stairMerged = mergeGeometries(stairGeos, false);
  if (stairMerged) {
    const stair = new THREE.Mesh(stairMerged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    stair.name = "stair";
    group.add(stair);
  }
  const trimMerged = mergeGeometries(trimGeos, false);
  if (trimMerged) {
    const trims = new THREE.Mesh(trimMerged, new THREE.MeshBasicMaterial({ color: GOLD }));
    trims.name = "gold-trims";
    group.add(trims);
  }

  // ---- Basin: generated floor + rock, pool glow, halo, light shaft ----
  const basinFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(DEEP_PAST_BASIN_RADIUS, DEEP_PAST_BASIN_RADIUS, 2.6, 48),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2e }),
  );
  basinFloor.position.y = DEEP_PAST_BASIN_Y;
  basinFloor.name = "basin-floor";
  group.add(basinFloor);
  const basinRock = new THREE.Mesh(
    new THREE.CylinderGeometry(74, 84, 60, 32, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x241a33, side: THREE.DoubleSide }),
  );
  basinRock.position.y = BASIN_FLOOR_TOP - 1.3 - 30;
  basinRock.name = "basin-rock";
  group.add(basinRock);
  const poolGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.8,
    }),
  );
  // Span ≈ 0.61 × basin span (note §6: the pool glow must read as the
  // brightest object in the entry frame). Tuned against TWO renders:
  // round 1's plain-blended 79 read dimmer than the lit discs from the
  // rim (additive blend is what the fixture's glow relied on), but 95
  // at 0.95 washed the in-bowl perch frame to pale yellow — 80 / 0.8
  // additive is the balance point between the two framings.
  poolGlow.scale.setScalar(80);
  poolGlow.position.set(0, BASIN_FLOOR_TOP + 2, 0);
  poolGlow.name = "pool-glow";
  group.add(poolGlow);
  const orbHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.7 }),
  );
  orbHalo.scale.setScalar(30);
  orbHalo.position.set(0, DEEP_PAST_ORB.y, 0);
  orbHalo.name = "orb-halo";
  group.add(orbHalo);
  // The light shaft (AN6): two additive open cylinders, pool to above
  // stratum 0, motionless — the column that makes the basin findable
  // from the rim. It never pulses; the pool glow carries the breath.
  const shaftOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(16.5, 16.5, 190, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shaftOuter.position.y = DEEP_PAST_BASIN_Y + 95;
  shaftOuter.name = "light-shaft-outer";
  group.add(shaftOuter);
  const shaftCore = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 9.5, 190, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shaftCore.position.y = DEEP_PAST_BASIN_Y + 95;
  shaftCore.name = "light-shaft-core";
  group.add(shaftCore);

  // The basin KEY LIGHT — real point light #1 of 2. Unbounded
  // (distance 0), decay 1, so the upper discs still catch warm light.
  // Intensity tuned against the A1 renders (note §6): high enough that
  // the entry frame shows warm light on the upper discs and the basin
  // reads from the rim, low enough that the in-bowl perch is not
  // scorched (170 blew the bowl out; 130 starved the entry frame).
  const basinLight = new THREE.PointLight(0xffc98a, 150, 0, 1);
  basinLight.position.set(0, DEEP_PAST_ORB.y, 0);
  basinLight.name = "basin-key-light";
  group.add(basinLight);

  // ---- The kept GLBs: one holder each, fitted by measurement on load ----
  const basinHolder = new THREE.Group();
  basinHolder.name = "glb-basin";
  basinHolder.position.y = DEEP_PAST_BASIN_GLB_Y;
  group.add(basinHolder);
  // The dish fades in ON TOP of the generated basin floor — the floor
  // stays (it is the walking surface of the basin leg); there is no
  // fallback to hide anymore, so the fade's hide callback is a no-op.
  void loadDeepPastAsset(DEEP_PAST_MODELS[0]!.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded);
      return;
    }
    fitDeepPastAssetToSpan(loaded, DEEP_PAST_BASIN_SPAN);
    basinHolder.add(loaded);
    fadeSwapIn(loaded, () => {});
  });

  const orbHolder = new THREE.Group();
  orbHolder.name = "glb-orb";
  orbHolder.position.set(0, DEEP_PAST_ORB.y, 0);
  group.add(orbHolder);
  const clipMixers: THREE.AnimationMixer[] = [];
  void loadAnimatedDeepPastAsset(DEEP_PAST_MODELS[2]!.url).then((loaded) => {
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

  const spireHolder = new THREE.Group();
  spireHolder.name = "glb-spire";
  spireHolder.position.set(
    Math.cos(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius,
    DEEP_PAST_SPIRE.y,
    Math.sin(DEEP_PAST_SPIRE.angle) * DEEP_PAST_SPIRE.radius,
  );
  group.add(spireHolder);
  void loadDeepPastAsset(DEEP_PAST_MODELS[1]!.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded);
      return;
    }
    fitDeepPastAssetToHeight(loaded, DEEP_PAST_SPIRE.height);
    spireHolder.add(loaded);
    // The tip glows warm (owner direction) — a sprite ONLY, no light:
    // the fitted root is centred, so the tip sits half the height up.
    const tip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    tip.scale.setScalar(DEEP_PAST_SPIRE.glowSpan);
    tip.position.set(0, DEEP_PAST_SPIRE.height / 2, 0);
    tip.name = "glb-spire-glow";
    spireHolder.add(tip);
  });

  const supernovaHolder = new THREE.Group();
  supernovaHolder.name = "glb-supernova";
  supernovaHolder.position.set(
    Math.cos(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius,
    DEEP_PAST_SUPERNOVA.y,
    Math.sin(DEEP_PAST_SUPERNOVA.angle) * DEEP_PAST_SUPERNOVA.radius,
  );
  group.add(supernovaHolder);
  void loadDeepPastAsset(DEEP_PAST_MODELS[3]!.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded);
      return;
    }
    fitDeepPastAssetToSize(loaded, DEEP_PAST_SUPERNOVA.size);
    supernovaHolder.add(loaded);
  });

  // ---- Hero orbs (generated): strata 3 and 7, the fixture's landmarks ----
  const heroOrbGeos: THREE.BufferGeometry[] = [];
  for (const stratum of [3, 7]) {
    const p = heroOrbPos(stratum);
    const orbGeo = new THREE.SphereGeometry(2.1, 20, 14);
    orbGeo.translate(p.cx, p.cy, p.cz);
    heroOrbGeos.push(orbGeo);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    glow.scale.setScalar(7.5);
    glow.position.set(p.cx, p.cy, p.cz);
    glow.name = `hero-orb-glow-${stratum}`;
    group.add(glow);
  }
  const heroOrbsMerged = mergeGeometries(heroOrbGeos, false);
  if (heroOrbsMerged) {
    const heroOrbs = new THREE.Mesh(
      heroOrbsMerged,
      new THREE.MeshStandardMaterial({
        color: 0x332211,
        emissive: 0xffc98a,
        emissiveIntensity: 2.4,
        roughness: 0.4,
        metalness: 0,
      }),
    );
    heroOrbs.name = "hero-orbs";
    group.add(heroOrbs);
  }
  // Real point light #2 of 2 rides the stratum-3 hero orb.
  const heroPos3 = heroOrbPos(3);
  const heroLight = new THREE.PointLight(0xffc98a, 30, 55, 1);
  heroLight.position.set(heroPos3.cx, heroPos3.cy, heroPos3.cz);
  heroLight.name = "hero-orb-light";
  group.add(heroLight);

  // ---- Lights: ambient + rim directional (the two point lights are above) ----
  group.add(new THREE.AmbientLight(0x8a76c9, 0.85));
  const rimLight = new THREE.DirectionalLight(0x9a86d9, 0.7);
  rimLight.position.set(60, 120, 80);
  group.add(rimLight);

  // ---- Rise shelf: a stone platform at the layout's shelf point ----
  const shelf = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 1.2, 24),
    new THREE.MeshLambertMaterial({ color: STONE }),
  );
  shelf.position.set(DEEP_PAST_RISE_SHELF.x, DEEP_PAST_RISE_SHELF.y - 0.6, DEEP_PAST_RISE_SHELF.z);
  shelf.name = "rise-shelf";
  group.add(shelf);
  const shelfGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shelfGlow.scale.setScalar(20);
  shelfGlow.position.set(DEEP_PAST_RISE_SHELF.x, DEEP_PAST_RISE_SHELF.y + 2, DEEP_PAST_RISE_SHELF.z);
  shelfGlow.name = "rise-glow";
  group.add(shelfGlow);

  // ---- Members: pads, forms, lantern points ----
  // Presentation state per member: most members instance; members
  // named in opts.riseGlides get individual meshes so they can glide
  // (AN10, capped at 6); the member named first in opts.carryIn
  // starts hidden (scale-0) until the ship places it (AN11).
  const members = layout.members;
  const memberById = new Map(members.map((m) => [m.nodeId, m]));
  const carriedMember: DeepPastMember | null =
    (opts.carryIn ?? []).map((id) => memberById.get(id)).find((m) => m !== undefined) ?? null;
  const glideIds = new Set(
    (opts.riseGlides ?? [])
      .filter((id) => {
        const m = memberById.get(id);
        return m !== undefined && m.risen && m.nodeId !== carriedMember?.nodeId;
      })
      .slice(0, 6),
  );

  const padGeo = new THREE.CylinderGeometry(1.6, 1.9, 0.6, 10);
  const padMat = new THREE.MeshLambertMaterial({ color: STONE });
  const stoneGeo = new THREE.DodecahedronGeometry(0.85);
  const sproutGeo = new THREE.ConeGeometry(0.7, 2.4, 5);
  const ringGeo = new THREE.TorusGeometry(1.3, 0.3, 8, 20);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8, metalness: 0.05 });
  const sproutMat = new THREE.MeshStandardMaterial({ color: 0x8a76c9, roughness: 0.85, metalness: 0 });
  const ringMat = new THREE.MeshStandardMaterial({ color: LANTERN, roughness: 0.6, metalness: 0.2 });
  const formFor = (m: DeepPastMember): { geo: THREE.BufferGeometry; mat: THREE.Material; flat: boolean } =>
    m.gathering
      ? { geo: ringGeo, mat: ringMat, flat: true }
      : m.kind === "action"
        ? { geo: sproutGeo, mat: sproutMat, flat: false }
        : { geo: stoneGeo, mat: stoneMat, flat: false };
  const formYaw = (m: DeepPastMember): number =>
    mulberry32(hashSeeded(`deep-past-form:${m.nodeId}`))() * Math.PI * 2;

  const pickables: THREE.Object3D[] = [];
  interface InstancedSlot {
    mesh: THREE.InstancedMesh;
    index: number;
  }
  const formSlots = new Map<number, InstancedSlot>();
  const padSlots = new Map<number, InstancedSlot>();

  const instancedMembers = members.filter((m) => !glideIds.has(m.nodeId));
  if (instancedMembers.length > 0) {
    const pads = new THREE.InstancedMesh(padGeo, padMat, instancedMembers.length);
    pads.name = "alcove-pads";
    const padIds: number[] = [];
    instancedMembers.forEach((m, i) => {
      dummy.position.set(m.x, m.y + 0.3, m.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      pads.setMatrixAt(i, dummy.matrix);
      padIds.push(m.nodeId);
      padSlots.set(m.nodeId, { mesh: pads, index: i });
    });
    pads.userData.nodeIds = padIds;
    group.add(pads);
    pickables.push(pads);

    const kinds = [
      { name: "alcoves-stone", list: instancedMembers.filter((m) => m.kind !== "action" && !m.gathering) },
      { name: "alcoves-sprout", list: instancedMembers.filter((m) => m.kind === "action") },
      { name: "alcoves-gathering", list: instancedMembers.filter((m) => m.gathering) },
    ] as const;
    for (const kind of kinds) {
      if (kind.list.length === 0) continue;
      const { geo, mat, flat } = formFor(kind.list[0]!);
      const mesh = new THREE.InstancedMesh(geo, mat, kind.list.length);
      mesh.name = kind.name;
      const ids: number[] = [];
      kind.list.forEach((m, i) => {
        dummy.position.set(m.x, m.y + 1.5, m.z);
        dummy.rotation.set(flat ? Math.PI / 2 : 0, formYaw(m), 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        ids.push(m.nodeId);
        formSlots.set(m.nodeId, { mesh, index: i });
      });
      mesh.userData.nodeIds = ids;
      group.add(mesh);
      pickables.push(mesh);
    }
  }
  const setInstancedVisible = (slot: InstancedSlot | undefined, m: DeepPastMember, visible: boolean): void => {
    if (!slot) return;
    if (visible) {
      dummy.position.set(m.x, m.y + (slot.mesh.name === "alcove-pads" ? 0.3 : 1.5), m.z);
      dummy.rotation.set(0, 0, 0);
      if (slot.mesh.name !== "alcove-pads") {
        const { flat } = formFor(m);
        dummy.rotation.set(flat ? Math.PI / 2 : 0, formYaw(m), 0);
      }
      dummy.scale.setScalar(1);
    } else {
      dummy.position.set(0, -10000, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.0001);
    }
    dummy.updateMatrix();
    slot.mesh.setMatrixAt(slot.index, dummy.matrix);
    slot.mesh.instanceMatrix.needsUpdate = true;
  };
  if (carriedMember) {
    setInstancedVisible(padSlots.get(carriedMember.nodeId), carriedMember, false);
    setInstancedVisible(formSlots.get(carriedMember.nodeId), carriedMember, false);
  }

  // Dynamic (gliding) members: individual pad + form + light column.
  interface DynMember {
    member: DeepPastMember;
    pad: THREE.Mesh;
    form: THREE.Mesh;
    column: THREE.Mesh;
    columnMat: THREE.MeshBasicMaterial;
    lanternIndex: number;
    start: THREE.Vector3;
    end: THREE.Vector3;
    done: boolean;
  }
  const dynMembers: DynMember[] = [];
  const lanternIndexOf = new Map(members.map((m, i) => [m.nodeId, i]));
  for (const id of glideIds) {
    const m = memberById.get(id)!;
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.name = `glide-pad-${id}`;
    pad.userData.nodeId = id;
    group.add(pad);
    pickables.push(pad);
    const { geo, mat, flat } = formFor(m);
    const form = new THREE.Mesh(geo, mat);
    form.name = `glide-form-${id}`;
    form.userData.nodeId = id;
    if (flat) form.rotation.x = Math.PI / 2;
    form.rotation.y = formYaw(m);
    group.add(form);
    pickables.push(form);
    const columnMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 10, 1, true), columnMat);
    column.name = `glide-column-${id}`;
    group.add(column);
    dynMembers.push({
      member: m,
      pad,
      form,
      column,
      columnMat,
      lanternIndex: lanternIndexOf.get(id) ?? 0,
      start: new THREE.Vector3(m.homeX, m.homeY, m.homeZ),
      end: new THREE.Vector3(m.x, m.y, m.z),
      done: false,
    });
  }

  // Shelf remnant columns (AN12): one merged additive mesh, a faint
  // 0.1 column hanging 26 below each risen member's shelf rest. The
  // gliding members join it only once landed (their own column
  // becomes the remnant), so they are excluded from this merge.
  const remnantGeos: THREE.BufferGeometry[] = [];
  for (const m of members) {
    if (!m.risen || glideIds.has(m.nodeId) || m.nodeId === carriedMember?.nodeId) continue;
    const col = new THREE.CylinderGeometry(1.6, 1.6, 26, 10, 1, true);
    col.translate(m.x, m.y - 13, m.z);
    remnantGeos.push(col);
  }
  if (remnantGeos.length > 0) {
    const merged = mergeGeometries(remnantGeos, false);
    if (merged) {
      const columns = new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({
          color: 0xffd9a0,
          transparent: true,
          opacity: 0.1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      columns.name = "rise-columns";
      group.add(columns);
    }
  }

  // Lantern points (AN8): one shader Points cloud for every member —
  // per-point phase (seeded), so the field breathes out of phase like
  // embers, never in unison. Positions follow glides/carries per frame.
  let lanternGeo: THREE.BufferGeometry | null = null;
  let lanternMat: THREE.ShaderMaterial | null = null;
  if (members.length > 0) {
    const positions = new Float32Array(members.length * 3);
    const phases = new Float32Array(members.length);
    members.forEach((m, i) => {
      const start = glideIds.has(m.nodeId) ? { x: m.homeX, y: m.homeY, z: m.homeZ } : m;
      positions[i * 3] = start.x;
      positions[i * 3 + 1] = start.y + 2.4;
      positions[i * 3 + 2] = start.z;
      phases[i] = mulberry32(hashSeeded(`deep-past-lantern:${m.nodeId}`))();
    });
    if (carriedMember) {
      const ci = lanternIndexOf.get(carriedMember.nodeId);
      if (ci !== undefined) positions[ci * 3 + 1] = -10000;
    }
    lanternGeo = new THREE.BufferGeometry();
    lanternGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    lanternGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    lanternMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio() } },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float breath = 0.82 + 0.18 * sin(uTime * 0.5 + aPhase * 6.28318);
          vAlpha = breath;
          gl_PointSize = 3.2 * (0.9 + 0.1 * sin(uTime * 0.5 + aPhase * 6.28318)) * uPixelRatio * (120.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 2.0) * vAlpha * 0.95;
          if (a < 0.003) discard;
          gl_FragColor = vec4(1.0, 0.85, 0.63, a);
        }`,
    });
    const lanterns = new THREE.Points(lanternGeo, lanternMat);
    lanterns.name = "memory-lanterns";
    group.add(lanterns);
  }
  const setLanternPos = (index: number, x: number, y: number, z: number): void => {
    if (!lanternGeo) return;
    const attr = lanternGeo.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(index, x, y, z);
    attr.needsUpdate = true;
  };

  // Anchors (D-8): a fine line of light rising from a member's HOME
  // alcove toward the rim — a visit-path to its other appearance.
  if (layout.anchors.length > 0) {
    const positions: number[] = [];
    for (const anchor of layout.anchors) {
      const m = memberById.get(anchor.fromNodeId);
      if (!m) continue;
      positions.push(m.homeX, m.homeY + 2.4, m.homeZ, m.homeX * 1.15, 9, m.homeZ * 1.15);
    }
    if (positions.length > 0) {
      const anchorGeo = new THREE.BufferGeometry();
      anchorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      const anchors = new THREE.LineSegments(
        anchorGeo,
        new THREE.LineBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.5 }),
      );
      anchors.name = "anchors";
      group.add(anchors);
    }
  }

  // ---- The Chronicle thread (A21/AN3): dim full route + kindling bright line ----
  // The curve is a CatmullRom with tension 0.5 through the stops: it
  // EASES at stops (prototype record §9.2 — a steady helix thread
  // clips the discs; easing at stops keeps the ship's path honest).
  let threadCurve: THREE.CatmullRomCurve3 | null = null;
  let threadBrightGeo: THREE.BufferGeometry | null = null;
  let stopFractionList: number[] = [];
  const THREAD_SAMPLES = 400;
  if (layout.thread && layout.thread.stops.length >= 2) {
    const stopPts = layout.thread.stops.map((s) => new THREE.Vector3(s.x, s.y + 2.2, s.z));
    threadCurve = new THREE.CatmullRomCurve3(stopPts, false, "catmullrom", 0.5);
    const sampled = threadCurve.getPoints(THREAD_SAMPLES - 1);
    const dimGeo = new THREE.BufferGeometry().setFromPoints(sampled);
    const dim = new THREE.Line(
      dimGeo,
      new THREE.LineBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.35 }),
    );
    dim.name = "thread-dim";
    group.add(dim);
    threadBrightGeo = new THREE.BufferGeometry().setFromPoints(sampled);
    threadBrightGeo.setDrawRange(0, 0);
    const bright = new THREE.Line(
      threadBrightGeo,
      new THREE.LineBasicMaterial({ color: LANTERN, transparent: true, opacity: 0.95 }),
    );
    bright.name = "thread-bright";
    group.add(bright);
    // Stop fractions: the curve parameter nearest each stop, found by
    // search over a dense sampling of the same curve.
    const dense = threadCurve.getPoints(1000);
    stopFractionList = stopPts.map((p) => {
      let best = 0;
      let bestD = Infinity;
      dense.forEach((q, i) => {
        const d = q.distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best / 1000;
    });
  }

  // ---- Route beads, CODE-BUILT (AN15): cosmic glass, four free lights ----
  // Per stop: a violet glass shell + an additive rim shell (instanced),
  // and ONE Points cloud for every bead's interior — 26 points per
  // bead: 4 lights (gold/teal/violet/rose) × (core + halo + 3 trails)
  // = 20, gold's 2 extra sparks, 3 nebula, 1 floor pool. The lights
  // ride independent tilted circles at their own tempos, dim behind
  // the bead's far wall, and the current stop's whole interior
  // brightens together while its gold lead flares (AN2).
  const BEAD_POINTS_PER_BEAD = 26;
  interface BeadLight {
    color: THREE.Color;
    radius: number;
    periodS: number;
    pulsePeriodS: number;
    phase: number;
    u: THREE.Vector3;
    v: THREE.Vector3;
    core: number;
    halo: number;
    trails: [number, number, number];
  }
  interface Bead {
    center: THREE.Vector3;
    lights: BeadLight[];
    sparks: { index: number; phase: number }[];
    nebula: { index: number; color: THREE.Color; phase: number }[];
    pool: number;
  }
  const beadList: Bead[] = [];
  let beadShells: THREE.InstancedMesh | null = null;
  let beadRims: THREE.InstancedMesh | null = null;
  let beadGeo: THREE.BufferGeometry | null = null;
  const beadCenters: THREE.Vector3[] = [];
  if (layout.thread && layout.thread.stops.length >= 2) {
    const stops = layout.thread.stops;
    for (const s of stops) beadCenters.push(new THREE.Vector3(s.x, s.y + 2.6, s.z));
    const shellGeo = new THREE.SphereGeometry(0.5, 24, 18);
    beadShells = new THREE.InstancedMesh(
      shellGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2a1650,
        transparent: true,
        opacity: 0.3,
        roughness: 0.08,
        depthWrite: false,
      }),
      stops.length,
    );
    beadShells.name = "bead-shells";
    group.add(beadShells);
    beadRims = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.54, 24, 18),
      new THREE.MeshBasicMaterial({
        color: 0x8a5fe0,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
      stops.length,
    );
    beadRims.name = "bead-rims";
    group.add(beadRims);

    const total = stops.length * BEAD_POINTS_PER_BEAD;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const alphas = new Float32Array(total);
    beadGeo = new THREE.BufferGeometry();
    beadGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    beadGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    beadGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    beadGeo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    const beadMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPixelRatio: { value: pixelRatio() } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 1.5) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    const beadPoints = new THREE.Points(beadGeo, beadMat);
    beadPoints.name = "bead-interiors";
    beadPoints.frustumCulled = false;
    group.add(beadPoints);

    const lightSpecs = [
      { color: new THREE.Color(0xffb347), radius: 0.26, periodS: 4, pulsePeriodS: 2.0 },
      { color: new THREE.Color(0x2affc4), radius: 0.3, periodS: 7, pulsePeriodS: 3.1 },
      { color: new THREE.Color(0x9a5cff), radius: 0.28, periodS: 9, pulsePeriodS: 2.6 },
      { color: new THREE.Color(0xff5c8a), radius: 0.14, periodS: 1.8, pulsePeriodS: 1.3 },
    ] as const;
    stops.forEach((stop, beadIdx) => {
      const base = beadIdx * BEAD_POINTS_PER_BEAD;
      const rand = mulberry32(hashSeeded(`deep-past-bead:${beadIdx}:${stop.nodeId}`));
      const lights: BeadLight[] = lightSpecs.map((spec, li) => {
        // An independent tilted circle per light: two seeded tilt
        // angles give an orthonormal basis (u, v) for its plane.
        const tiltA = rand() * Math.PI * 2;
        const tiltB = rand() * Math.PI;
        const u = new THREE.Vector3(Math.cos(tiltA), Math.sin(tiltA) * Math.cos(tiltB), Math.sin(tiltA) * Math.sin(tiltB)).normalize();
        const w = new THREE.Vector3(0, 1, 0);
        const v = new THREE.Vector3().crossVectors(w, u).normalize();
        if (v.lengthSq() < 0.01) v.set(0, 0, 1);
        // Layout per bead: gold core/halo/trails at 0..4, its sparks
        // at 5..6, then teal 7..11, violet 12..16, rose 17..21.
        const core = li === 0 ? base : base + 2 + li * 5;
        return {
          color: spec.color,
          radius: spec.radius,
          periodS: spec.periodS,
          pulsePeriodS: spec.pulsePeriodS,
          phase: rand() * Math.PI * 2,
          u,
          v,
          core,
          halo: core + 1,
          trails: [core + 2, core + 3, core + 4] as [number, number, number],
        };
      });
      const sparks = [base + 5, base + 6].map((index) => ({ index, phase: rand() * Math.PI * 2 }));
      const nebulaColors = [new THREE.Color(0x2affc4), new THREE.Color(0xff4fd8), new THREE.Color(0x9a5cff)];
      const nebula = nebulaColors.map((color, ni) => ({
        index: base + 22 + ni,
        color,
        phase: rand() * Math.PI * 2,
      }));
      beadList.push({ center: beadCenters[beadIdx]!, lights, sparks, nebula, pool: base + 25 });
      // Static colors for every point (positions/alphas/sizes are per-frame).
      const paint = (idx: number, c: THREE.Color): void => {
        colors[idx * 3] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
      };
      for (const light of lights) {
        paint(light.core, light.color);
        paint(light.halo, light.color);
        light.trails.forEach((t) => paint(t, light.color));
      }
      sparks.forEach((s) => paint(s.index, new THREE.Color(0xffe9b0)));
      nebula.forEach((n) => paint(n.index, n.color));
      paint(base + 25, new THREE.Color(0xffd9a0));
    });
    beadGeo.getAttribute("aColor").needsUpdate = true;
  }

  // ---- Motes rising through the shaft (AN5) + marine snow ----
  const MOTES = 130;
  const moteRand = mulberry32(hashSeeded("deep-past / first-descent-1:motes"));
  const motePositions = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    const angle = moteRand() * Math.PI * 2;
    const radius = Math.sqrt(moteRand()) * 14;
    motePositions[i * 3] = Math.cos(angle) * radius;
    motePositions[i * 3 + 1] = DEEP_PAST_BASIN_Y + 2 + moteRand() * 185;
    motePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      size: 1.6,
      map: glowTex,
      transparent: true,
      opacity: 0.8,
      color: 0xffd9a0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  motes.name = "motes";
  group.add(motes);

  const SNOW = 500;
  const snowRand = mulberry32(hashSeeded("deep-past / first-descent-1:marine-snow"));
  const snowPositions = new Float32Array(SNOW * 3);
  for (let i = 0; i < SNOW; i++) {
    const angle = snowRand() * Math.PI * 2;
    const radius = Math.sqrt(snowRand()) * 110;
    snowPositions[i * 3] = Math.cos(angle) * radius;
    snowPositions[i * 3 + 1] = -175 + snowRand() * 200;
    snowPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({
      size: 2.5,
      color: 0xbfa8e0,
      map: glowTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  snow.name = "marine-snow";
  group.add(snow);

  // ---- The ship (F16): a scene resident, berthed at the rim ----
  // loadSoumayaShip applies her treatment and normalizes her to a
  // 12-unit forward length (HERO_SHIP_FORWARD_LENGTH, measured from
  // the file's own Box3 at load), so the holder IS the ship at span
  // ≈12; this scene only poses the holder.
  const shipGroup = new THREE.Group();
  shipGroup.name = "deep-past-ship";
  group.add(shipGroup);
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    shipGroup.add(hero);
  });
  const berthPos = new THREE.Vector3(
    Math.cos(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
    DEEP_PAST_SHIP_BERTH.y,
    Math.sin(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
  );
  const berthTarget = berthPos
    .clone()
    .add(new THREE.Vector3(-Math.sin(DEEP_PAST_SHIP_BERTH.angle), 0, Math.cos(DEEP_PAST_SHIP_BERTH.angle)).multiplyScalar(10));
  shipGroup.position.copy(berthPos);
  shipGroup.lookAt(berthTarget);

  // ---- The carry (AN11): collect → transit → placement → return ----
  const cargo = new THREE.Group();
  cargo.name = "carry-cargo";
  const cargoCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffc98a, emissiveIntensity: 2, roughness: 0.4 }),
  );
  cargo.add(cargoCore);
  const cargoGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  cargoGlow.scale.setScalar(4);
  cargo.add(cargoGlow);
  cargo.visible = false;
  group.add(cargo);
  // The alcove "warms" at placement: a glow sprite that flares and fades.
  const warmGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false }),
  );
  warmGlow.scale.setScalar(9);
  warmGlow.visible = false;
  group.add(warmGlow);
  let warmStartMs = -1;

  type CarryPhase = "collect" | "transit" | "place" | "return" | "done";
  interface CarryState {
    member: DeepPastMember;
    phase: CarryPhase;
    phaseMs: number;
    curve: THREE.CatmullRomCurve3;
    transitMs: number;
    returnMs: number;
    placed: boolean;
  }
  let carry: CarryState | null = null;
  if (carriedMember) {
    const homeAngle = Math.atan2(carriedMember.homeZ, carriedMember.homeX);
    const s = carriedMember.stratum;
    const pts = [
      berthPos.clone(),
      new THREE.Vector3(
        Math.cos(homeAngle) * (DEEP_PAST_STRATUM_RADIUS[0]! - 10),
        deepPastFloorY(0) + 6,
        Math.sin(homeAngle) * (DEEP_PAST_STRATUM_RADIUS[0]! - 10),
      ),
      new THREE.Vector3(
        Math.cos(homeAngle) * (DEEP_PAST_STRATUM_RADIUS[s]! - 10),
        deepPastFloorY(s) + 10,
        Math.sin(homeAngle) * (DEEP_PAST_STRATUM_RADIUS[s]! - 10),
      ),
      new THREE.Vector3(carriedMember.homeX, carriedMember.homeY + 6, carriedMember.homeZ),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
    const length = curve.getLength();
    carry = {
      member: carriedMember,
      phase: "collect",
      phaseMs: 0,
      curve,
      transitMs: (length / 12) * 1000,
      returnMs: (length / 16) * 1000,
      placed: false,
    };
  }
  const placeCarriedMember = (): void => {
    if (!carry || carry.placed) return;
    carry.placed = true;
    const m = carry.member;
    setInstancedVisible(padSlots.get(m.nodeId), m, true);
    setInstancedVisible(formSlots.get(m.nodeId), m, true);
    const ci = lanternIndexOf.get(m.nodeId);
    if (ci !== undefined) setLanternPos(ci, m.x, m.y + 2.4, m.z);
    cargo.visible = false;
    pulseAlcove(m.nodeId);
    warmGlow.position.set(m.x, m.y + 1.5, m.z);
    warmGlow.visible = true;
    warmStartMs = lastElapsed;
  };

  // ---- Alcove rings (AN4): a small pool, one bloom per pulse ----
  const ringPool: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; startMs: number; nodeId: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: LANTERN,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.2, 32), mat);
    mesh.geometry.rotateX(-Math.PI / 2);
    mesh.name = `alcove-ring-${i}`;
    mesh.visible = false;
    group.add(mesh);
    ringPool.push({ mesh, mat, startMs: -1, nodeId: -1 });
  }
  let ringCursor = 0;
  function pulseAlcove(nodeId: number): void {
    const m = memberById.get(nodeId);
    if (!m) return;
    const dyn = dynMembers.find((d) => d.member.nodeId === nodeId);
    const pos = dyn && !dyn.done ? dyn.form.position : new THREE.Vector3(m.x, m.y, m.z);
    const slot = ringPool[ringCursor % ringPool.length]!;
    ringCursor++;
    slot.mesh.position.set(pos.x, (dyn && !dyn.done ? dyn.form.position.y - 1.5 : m.y) + 0.15, pos.z);
    slot.startMs = lastElapsed;
    slot.nodeId = nodeId;
    slot.mesh.visible = true;
  }

  // ---- Landing markers for fly-to (generated places, design §7) ----
  // Invisible boxes named place-*: findPlaces measures an object's
  // Box3 regardless of visibility (Box3.setFromObject traverses
  // children without a visibility check), so visible=false markers
  // still register as places while costing no draw calls.
  const addMarker = (name: string, w: number, h: number, d: number, cx: number, cy: number, cz: number): void => {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    marker.name = name;
    marker.position.set(cx, cy, cz);
    marker.visible = false;
    group.add(marker);
  };
  addMarker("place-rim", 170, 8, 170, 0, deepPastFloorY(0), 0);
  addMarker("place-shelf", 26, 6, 26, DEEP_PAST_RISE_SHELF.x, DEEP_PAST_RISE_SHELF.y, DEEP_PAST_RISE_SHELF.z);
  if (members.length > 0) {
    const landings = buildDeepPastWalkPoints().landings;
    const landingFor = (stratum: number): [number, number, number] | undefined =>
      landings.find((l) => l.stratum === stratum)?.point;
    const deepest = Math.max(...members.map((m) => m.stratum));
    const deepestPt = landingFor(deepest);
    if (deepestPt) addMarker("place-landing-deepest", 6, 6, 6, deepestPt[0], deepestPt[1], deepestPt[2]);
    if (deepest !== 4 && members.some((m) => m.stratum === 4)) {
      const midPt = landingFor(4);
      if (midPt) addMarker("place-landing-mid", 6, 6, 6, midPt[0], midPt[1], midPt[2]);
    }
    if (deepest !== 8) {
      const lastPt = landingFor(8);
      if (lastPt) addMarker("place-landing-last", 6, 6, 6, lastPt[0], lastPt[1], lastPt[2]);
    }
  }

  // ---- Frame state + per-frame work ----
  let frameState: DeepPastFrameState = {};
  let lastElapsed = 0;
  let firstElapsed: number | null = null;
  const applyKindle = (): void => {
    if (!threadBrightGeo) return;
    const k = Math.min(1, Math.max(0, frameState.kindle ?? 0));
    threadBrightGeo.setDrawRange(0, Math.round(k * THREAD_SAMPLES));
  };

  const easeCos = (k: number): number => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;

  const updateShipAndCarry = (dtMs: number, rm: boolean): void => {
    if (carry && !carry.placed) {
      if (rm) {
        // Reduced motion: no theater — the member simply rests.
        carry.phase = "done";
        placeCarriedMember();
      } else {
        carry.phaseMs += dtMs;
        cargo.visible = true;
        if (carry.phase === "collect") {
          shipGroup.position.copy(berthPos);
          shipGroup.lookAt(berthTarget);
          cargo.position.copy(berthPos).add(new THREE.Vector3(0, -2, 0));
          const fade = Math.min(1, carry.phaseMs / 1200);
          (cargoCore.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 * fade;
          cargoGlow.material.opacity = 0.9 * fade;
          if (carry.phaseMs >= 1200) {
            carry.phase = "transit";
            carry.phaseMs = 0;
          }
        } else if (carry.phase === "transit") {
          const u = easeCos(carry.phaseMs / carry.transitMs);
          const pos = carry.curve.getPoint(u);
          shipGroup.position.copy(pos);
          shipGroup.lookAt(carry.curve.getPoint(Math.min(1, u + 0.02)));
          cargo.position.copy(pos).add(new THREE.Vector3(0, -2, 0));
          if (carry.phaseMs >= carry.transitMs) {
            carry.phase = "place";
            carry.phaseMs = 0;
          }
        } else if (carry.phase === "place") {
          const above = carry.curve.getPoint(1);
          shipGroup.position.copy(above);
          shipGroup.lookAt(carry.member.homeX, carry.member.homeY, carry.member.homeZ);
          const k = easeCos(carry.phaseMs / 2600);
          const from = above.clone().add(new THREE.Vector3(0, -2, 0));
          const to = new THREE.Vector3(carry.member.homeX, carry.member.homeY + 1.5, carry.member.homeZ);
          cargo.position.lerpVectors(from, to, k);
          if (carry.phaseMs >= 2600) {
            carry.phase = "return";
            carry.phaseMs = 0;
            placeCarriedMember();
          }
        }
      }
    }
    if (carry && carry.placed && carry.phase === "return" && !rm) {
      carry.phaseMs += dtMs;
      const u = 1 - easeCos(carry.phaseMs / carry.returnMs);
      const pos = carry.curve.getPoint(Math.max(0, u));
      shipGroup.position.copy(pos);
      shipGroup.lookAt(carry.curve.getPoint(Math.max(0, u - 0.02)));
      if (carry.phaseMs >= carry.returnMs) carry.phase = "done";
      return; // the return leg owns the ship until it berths
    }
    if (carry && !carry.placed) return; // collect/transit/place own the ship
    // Normal pose control: the host's frame-state pose, else the berth.
    if (frameState.shipPose) {
      shipGroup.position.set(...frameState.shipPose.position);
      shipGroup.lookAt(...frameState.shipPose.target);
    } else {
      shipGroup.position.copy(berthPos);
      shipGroup.lookAt(berthTarget);
    }
  };

  const updateGlides = (elapsedMs: number, rm: boolean): void => {
    if (dynMembers.length === 0) return;
    const start = firstElapsed ?? elapsedMs;
    for (const dyn of dynMembers) {
      const k = rm ? 1 : Math.min(1, Math.max(0, (elapsedMs - start) / 5200));
      const e = easeCos(k);
      const pos = dyn.start.clone().lerp(dyn.end, e);
      pos.y += Math.sin(Math.PI * e) * 2.5; // a gentle arc, never a straight slide
      dyn.pad.position.set(pos.x, pos.y + 0.3, pos.z);
      dyn.form.position.set(pos.x, pos.y + 1.5, pos.z);
      setLanternPos(dyn.lanternIndex, pos.x, pos.y + 2.4, pos.z);
      if (k >= 1) {
        dyn.done = true;
        // The column settles to the AN12 remnant at the shelf.
        dyn.column.scale.set(1, 26, 1);
        dyn.column.position.set(dyn.end.x, dyn.end.y - 13, dyn.end.z);
        dyn.columnMat.opacity = 0.1;
      } else {
        const span = Math.abs(dyn.end.y - dyn.start.y) + 4;
        dyn.column.scale.set(1, span, 1);
        dyn.column.position.set(pos.x, (dyn.start.y + dyn.end.y) / 2, pos.z);
        dyn.columnMat.opacity = 0.16 * Math.sin(Math.PI * k * 1.15);
      }
    }
  };

  const updateBeads = (elapsedMs: number, rm: boolean): void => {
    if (!beadGeo || beadList.length === 0) return;
    const t = rm ? 0 : elapsedMs / 1000;
    const posAttr = beadGeo.getAttribute("position") as THREE.BufferAttribute;
    const sizeAttr = beadGeo.getAttribute("aSize") as THREE.BufferAttribute;
    const alphaAttr = beadGeo.getAttribute("aAlpha") as THREE.BufferAttribute;
    const camPos = frameState.cameraPosition
      ? new THREE.Vector3(...frameState.cameraPosition)
      : null;
    const tmp = new THREE.Vector3();
    const lightPosAt = (light: BeadLight, center: THREE.Vector3, atT: number, out: THREE.Vector3): void => {
      const ang = (Math.PI * 2 * atT) / light.periodS + light.phase;
      out
        .copy(center)
        .addScaledVector(light.u, Math.cos(ang) * light.radius)
        .addScaledVector(light.v, Math.sin(ang) * light.radius);
    };
    beadList.forEach((bead, beadIdx) => {
      const bob = rm ? 0 : Math.sin(elapsedMs * 0.001 + beadIdx) * 0.08;
      const center = tmp.set(bead.center.x, bead.center.y + bob, bead.center.z).clone();
      const emphasis = frameState.currentStop === beadIdx;
      const alphaMul = emphasis ? 1.5 : 1;
      const camDistC = camPos ? camPos.distanceTo(center) : 0;
      const setPt = (idx: number, p: THREE.Vector3, size: number, alpha: number, isLight: boolean): void => {
        let a = alpha * alphaMul;
        if (isLight && camPos && camPos.distanceTo(p) > camDistC + 0.05) a *= 0.55; // behind the far wall
        posAttr.setXYZ(idx, p.x, p.y, p.z);
        sizeAttr.setX(idx, size);
        alphaAttr.setX(idx, Math.min(1, a));
      };
      const p = new THREE.Vector3();
      for (const light of bead.lights) {
        const pulse = 0.72 + 0.28 * Math.sin((Math.PI * 2 * t) / light.pulsePeriodS + light.phase * 1.7);
        lightPosAt(light, center, t, p);
        const isGold = light.core % BEAD_POINTS_PER_BEAD === 0;
        setPt(light.core, p, 0.22 * pulse * (emphasis && isGold ? 1.6 : 1), 0.95 * pulse, true);
        setPt(light.halo, p, 0.65 * pulse, 0.38 * pulse, true);
        const trailFades = [0.5, 0.3, 0.15] as const;
        light.trails.forEach((trailIdx, ti) => {
          const tp = new THREE.Vector3();
          lightPosAt(light, center, t - 0.12 * (ti + 1), tp);
          setPt(trailIdx, tp, 0.13, 0.95 * pulse * trailFades[ti]!, true);
        });
        if (isGold) {
          for (const spark of bead.sparks) {
            const ang = (Math.PI * 2 * t) / 0.7 + spark.phase;
            const sp = p
              .clone()
              .addScaledVector(light.u, Math.cos(ang) * 0.12)
              .addScaledVector(light.v, Math.sin(ang) * 0.12);
            const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + spark.phase));
            setPt(spark.index, sp, emphasis ? 0.14 : 0.07, emphasis ? 1 : twinkle, true);
          }
        }
      }
      bead.nebula.forEach((n, ni) => {
        const np = center
          .clone()
          .add(
            new THREE.Vector3(
              Math.sin((Math.PI * 2 * t) / (11 + ni * 2) + n.phase) * 0.16,
              Math.sin((Math.PI * 2 * t) / (13 + ni * 2) + n.phase * 1.3) * 0.12,
              Math.cos((Math.PI * 2 * t) / (17 + ni * 2) + n.phase) * 0.16,
            ),
          );
        setPt(n.index, np, 0.85, 0.14, false);
      });
      const poolPos = center.clone();
      poolPos.y -= 0.38;
      setPt(bead.pool, poolPos, 0.55, 0.5, false);
      // Shells ride the same bob as their interior.
      if (beadShells && beadRims) {
        dummy.position.copy(center);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        beadShells.setMatrixAt(beadIdx, dummy.matrix);
        beadRims.setMatrixAt(beadIdx, dummy.matrix);
      }
    });
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    if (beadShells) beadShells.instanceMatrix.needsUpdate = true;
    if (beadRims) beadRims.instanceMatrix.needsUpdate = true;
  };

  const updateRings = (elapsedMs: number, rm: boolean): void => {
    for (const slot of ringPool) {
      if (!slot.mesh.visible || slot.startMs < 0) continue;
      if (rm) {
        slot.mesh.scale.setScalar(1.2);
        slot.mat.opacity = 0.5;
        continue;
      }
      const k = (elapsedMs - slot.startMs) / 1200;
      if (k >= 1) {
        slot.mesh.visible = false;
        slot.mat.opacity = 0;
        continue;
      }
      slot.mesh.scale.setScalar(0.5 + 1.1 * k);
      slot.mat.opacity = 0.9 * (1 - k);
    }
    if (warmGlow.visible && warmStartMs >= 0) {
      const k = (elapsedMs - warmStartMs) / 1600;
      if (k >= 1 || rm) {
        warmGlow.visible = false;
        warmGlow.material.opacity = 0;
      } else {
        warmGlow.material.opacity = 0.85 * (1 - k);
      }
    }
  };

  const raycaster = new THREE.Raycaster();
  const pickMember = (ndc: { x: number; y: number }, camera: THREE.Camera): number | null => {
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const hit of hits) {
      const obj = hit.object;
      if ((obj as THREE.InstancedMesh).isInstancedMesh && hit.instanceId !== undefined) {
        const ids = obj.userData.nodeIds as number[] | undefined;
        const id = ids?.[hit.instanceId];
        if (id !== undefined) return id;
      } else if (typeof obj.userData.nodeId === "number") {
        return obj.userData.nodeId;
      }
    }
    return null;
  };

  return {
    group,
    setFrameState(state: DeepPastFrameState) {
      frameState = { ...frameState, ...state };
      applyKindle();
    },
    pulseAlcove,
    pickMember,
    threadPointAt(u: number) {
      if (!threadCurve) return null;
      const clamped = Math.min(1, Math.max(0, u));
      const pos = threadCurve.getPoint(clamped);
      const tan = threadCurve.getTangent(clamped).normalize();
      return {
        position: [pos.x, pos.y, pos.z] as [number, number, number],
        tangent: [tan.x, tan.y, tan.z] as [number, number, number],
      };
    },
    stopFractions() {
      return [...stopFractionList];
    },
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed) return;
      const rm = opts?.reducedMotion ?? false;
      if (firstElapsed === null) firstElapsed = elapsedMs;
      const dt = Math.max(0, elapsedMs - lastElapsed);
      lastElapsed = elapsedMs;
      // Frame-state statics apply in EVERY mode, reduced motion
      // included: the host jumps the ship between stops in RM, and
      // the kindle/emphasis must land where it was told to.
      applyKindle();
      updateShipAndCarry(dt, rm);
      updateGlides(elapsedMs, rm);
      updateBeads(elapsedMs, rm);
      updateRings(elapsedMs, rm);
      if (warmGlow.visible && warmStartMs < 0) warmStartMs = elapsedMs;
      if (rm) {
        // Motion holds still: breathing rests at mid-breath values,
        // the orb clip holds (AN1), particulate hangs.
        poolGlow.scale.setScalar(80);
        basinLight.intensity = 150;
        if (lanternMat) lanternMat.uniforms.uTime!.value = 0;
        return;
      }
      // The orb's 'FirstLight' clip ticks with the delta clamped to
      // 0.1 s, so a tab-switch can never fast-forward it (AN1).
      const deltaS = Math.min(0.1, dt / 1000);
      for (const mixer of clipMixers) mixer.update(deltaS);
      if (lanternMat) lanternMat.uniforms.uTime!.value = elapsedMs / 1000;
      // Marine snow sinks slowly and wraps.
      const snowPos = snowGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < SNOW; i++) {
        let y = snowPos.getY(i) - dt * 0.0004;
        if (y < -175) y += 200;
        snowPos.setY(i, y);
      }
      snowPos.needsUpdate = true;
      // Motes RISE through the shaft at ~1.2 units/s and wrap to the basin (AN5).
      const motePos = moteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < MOTES; i++) {
        let y = motePos.getY(i) + dt * 0.0012;
        if (y > DEEP_PAST_BASIN_Y + 187) y -= 185;
        motePos.setY(i, y);
      }
      motePos.needsUpdate = true;
      // The basin breathes (AN7): pool glow + key light on one slow
      // ~12.6 s sine (0.0005 rad/ms), subtle, together.
      const breath = Math.sin(elapsedMs * 0.0005);
      poolGlow.scale.setScalar(80 + breath * 4);
      basinLight.intensity = 150 + breath * 11;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
