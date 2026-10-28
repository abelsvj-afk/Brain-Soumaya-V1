import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { fadeSwapIn } from "./gltf.js";
import { buildHygStarfield } from "./hygStars.js";
import {
  DEEP_PAST_BASIN_GLB_Y,
  DEEP_PAST_BASIN_SPAN,
  DEEP_PAST_CRYSTAL,
  DEEP_PAST_LANTERN,
  DEEP_PAST_LANTERN_GLOW_SPAN,
  DEEP_PAST_LANTERN_LIGHT,
  DEEP_PAST_MODELS,
  DEEP_PAST_ORB,
  DEEP_PAST_RIM,
  DEEP_PAST_SPIRE,
  DEEP_PAST_SPIRE_GLOW_SPAN,
  DEEP_PAST_SPIRE_LIGHT,
  DEEP_PAST_STAIR,
  DEEP_PAST_SUPERNOVA,
  DEEP_PAST_TERRACE,
  fitDeepPastAsset,
  fitDeepPastAssetToSize,
  fitDeepPastAssetToSpan,
  loadAnimatedDeepPastAsset,
  loadDeepPastAsset,
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
 * (only the faintest HYG points far above the rim, where the present day lives).
 * Baked glow only — no bloom, no post-processing. The basin is the finished
 * bottom: a warm floor of light and stone over solid rock (C9) — never a pit,
 * never a void. The rim is a boundary: finished darkness above, the camera
 * cannot fly out past it.
 *
 * Draw-call sketch (recipe ceiling 90): strata walls 9 · rim bands 9 · plinths 1
 * · alcoves ≤3 (one instanced mesh per form) · lanterns 1 · thread ≤1 · anchors ≤1
 * · particulate 1 · HYG sky 1 · basin 4 (floor + rim ring + glow + rock) · rise
 * shelf 1 + shelf glow 1 · ships 1 = ~34. The GLB layer adds 42 more calls once
 * loaded (five meshes + the crystal's two materials + the supernova's
 * 34 point meshes + the lantern's glow sprite) and 88,220 measured
 * tris — the budget still holds with the layer in
 * (see deepPastAssets.test.ts). Runtime measurement belongs to the device
 * check (C4's measured half); these constants are the static half.
 *
 * The seven real pieces (basin, terrace, rim, stair, lantern, stratum crystal, supernova remnant) load async
 * from the manifest in deepPastAssets.ts and swap into the holders named
 * `glb-*` below. Until a piece lands, the procedural form stays — the
 * basin's floor and rim ring are the load fallback, hidden only once the
 * real dish fades in; the other four have no procedural form in this
 * scene, so a failed load simply leaves that holder empty and the
 * failure is noted for diagnostics. Three positions are still waiting
 * on the owner's pieces (orb, spire, bead) and keep their procedural
 * forms as explicitly-marked interim — see the TODOs at the basin light,
 * the anchors, and the thread.
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
  /** The descent flies inside the arrival orbit, close to the thread. */
  radius: 600,
  startY: 150,
  endY: -650,
  baseAngle: 0.6,
  /** Three-quarters of a turn, following the helix's winding direction. */
  angleTurns: 0.75,
  /** The look target never goes below this (the basin floor is at −830). */
  lookAtFloor: -800,
} as const;

/** Camera pose for a descent progress p ∈ [0, 1] (rim → basin). Pure, testable. */
export function deepPastDescentCamera(progress: number): {
  position: [number, number, number];
  lookAt: [number, number, number];
} {
  const p = Math.min(Math.max(progress, 0), 1);
  const y = DEEP_PAST_DESCENT.startY + p * (DEEP_PAST_DESCENT.endY - DEEP_PAST_DESCENT.startY);
  const angle = DEEP_PAST_DESCENT.baseAngle + p * Math.PI * 2 * DEEP_PAST_DESCENT.angleTurns;
  return {
    position: [
      Math.sin(angle) * DEEP_PAST_DESCENT.radius,
      y,
      Math.cos(angle) * DEEP_PAST_DESCENT.radius,
    ],
    lookAt: [0, Math.max(y - 350, DEEP_PAST_DESCENT.lookAtFloor), 0],
  };
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

export function createDeepPastScene(layout: DeepPastLayout): DeepPastScene {
  const group = new THREE.Group();
  group.name = "deep-past";
  let disposed = false;
  const dummy = new THREE.Object3D();
  const glowTex = makeGlowTexture();

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
  // in both cases: the rock is the finished bottom, and the glow + light
  // are the basin's light until the First Light orb arrives (TODO below).
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
  const terraceHolder = new THREE.Group();
  terraceHolder.name = "glb-terrace";
  terraceHolder.position.set(
    Math.cos(DEEP_PAST_TERRACE.angle) * DEEP_PAST_TERRACE.radius,
    DEEP_PAST_TERRACE.y,
    Math.sin(DEEP_PAST_TERRACE.angle) * DEEP_PAST_TERRACE.radius,
  );
  terraceHolder.rotation.y = -DEEP_PAST_TERRACE.angle - Math.PI / 2;
  group.add(terraceHolder);
  const rimHolder = new THREE.Group();
  rimHolder.name = "glb-rim";
  rimHolder.position.y = DEEP_PAST_RIM.y;
  group.add(rimHolder);
  const stairHolder = new THREE.Group();
  stairHolder.name = "glb-stair";
  stairHolder.position.set(
    DEEP_PAST_STAIR.position.x,
    DEEP_PAST_STAIR.position.y,
    DEEP_PAST_STAIR.position.z,
  );
  stairHolder.rotation.y = -Math.PI / 2;
  group.add(stairHolder);
  const lanternHolder = new THREE.Group();
  lanternHolder.name = "glb-lantern";
  lanternHolder.position.set(
    Math.cos(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius,
    DEEP_PAST_LANTERN.y,
    Math.sin(DEEP_PAST_LANTERN.angle) * DEEP_PAST_LANTERN.radius,
  );
  group.add(lanternHolder);
  // The stratum crystal (population increment): a crystal in the deep
  // strata, loaded as-is — both materials, 2 calls; its purple is its
  // identity. The holder stays empty until its GLB lands.
  const crystalHolder = new THREE.Group();
  crystalHolder.name = "glb-crystal";
  crystalHolder.position.set(
    Math.cos(DEEP_PAST_CRYSTAL.angle) * DEEP_PAST_CRYSTAL.radius,
    DEEP_PAST_CRYSTAL.y,
    Math.sin(DEEP_PAST_CRYSTAL.angle) * DEEP_PAST_CRYSTAL.radius,
  );
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
  // The dish fades in over the procedural floor; the fallback is hidden
  // only once the real dish is mostly visible (a crossfade, not a cut).
  loadInto(
    DEEP_PAST_MODELS[0]!,
    basinHolder,
    (root) => fitDeepPastAssetToSpan(root, DEEP_PAST_BASIN_SPAN),
    (root) => fadeSwapIn(root, hideBasinFallback),
  );
  loadInto(DEEP_PAST_MODELS[1]!, terraceHolder, (root) =>
    fitDeepPastAsset(root, DEEP_PAST_TERRACE.scale),
  );
  loadInto(DEEP_PAST_MODELS[2]!, rimHolder, (root) =>
    fitDeepPastAsset(root, DEEP_PAST_RIM.scale),
  );
  loadInto(DEEP_PAST_MODELS[3]!, stairHolder, (root) =>
    fitDeepPastAsset(root, DEEP_PAST_STAIR.scale),
  );
  loadInto(
    DEEP_PAST_MODELS[4]!,
    lanternHolder,
    (root) => fitDeepPastAsset(root, DEEP_PAST_LANTERN.scale),
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
  loadInto(DEEP_PAST_MODELS[5]!, crystalHolder, (root) =>
    fitDeepPastAssetToSize(root, DEEP_PAST_CRYSTAL.size),
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
  // The orb loads through the animated loader (its 'FirstLight' clip is
  // the Deep Past's only animation so far): the clip ticks on the
  // scene's mixer in update(), the Scale pattern — delta clamped,
  // reduced motion holds it still.
  const orbMixers: THREE.AnimationMixer[] = [];
  void loadAnimatedDeepPastAsset(DEEP_PAST_MODELS[8]!.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded.scene);
      return;
    }
    fitDeepPastAssetToSize(loaded.scene, DEEP_PAST_ORB.size);
    orbHolder.add(loaded.scene);
    const mixer = new THREE.AnimationMixer(loaded.scene);
    for (const clip of loaded.animations) mixer.clipAction(clip).play();
    orbMixers.push(mixer);
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
  // TODO (missing GLB — anchor-spire, needed from the owner): each anchor
  // line rises from its alcove with no physical foot yet — the INTERIM
  // form. When the spire lands, one stands at each anchor's foot and the
  // line rises from its tip. Do not invent a substitute spire.
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
  // TODO (missing GLB — route-bead, needed from the owner): the thread line
  // marks the route but its stops have no markers yet — the INTERIM form.
  // When the bead lands, one floats above each stop. Do not invent a
  // substitute bead.
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

  // The faintest HYG points far above the rim — the present day, far above.
  // Same real data as the Station's and the garden's, dimmed further: the
  // helix encloses, there is no sky here.
  const stars = buildHygStarfield();
  const starMat = stars.material as THREE.PointsMaterial;
  starMat.transparent = true;
  starMat.opacity = 0.25;
  group.add(stars);

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
      // The orb's FirstLight clip ticks on the same clock: delta clamped
      // so a tab-switch can never jump it forward by minutes. Reduced
      // motion holds it still with the rest of the space (see the early
      // return above).
      const deltaS = Math.min(0.1, dt / 1000);
      for (const mixer of orbMixers) mixer.update(deltaS);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
