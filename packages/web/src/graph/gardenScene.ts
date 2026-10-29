import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { GARDEN_BACKDROP_PLANETS, loadGardenAsset } from "./gardenAssets.js";
import { buildHygStarfield } from "./hygStars.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import { buildProceduralShip } from "./transitScene.js";
import {
  GARDEN_TERRACE_COUNT,
  GARDEN_TERRACE_RADIUS,
  GARDEN_TERRACE_HEIGHT,
  GARDEN_UNDERSIDE_DEPTH,
  GARDEN_FLOOR_Y,
  type GardenLayout,
} from "./gardenLayout.js";
import {
  applyTransition,
  clampWarmth,
  provisionalStyle,
  undoTransition,
  warmthColors,
  type LandingKind,
} from "./mutationPresentation.js";

/**
 * Garden scene (Phase 3, P3-1) — renders exactly what gardenLayout returns,
 * nothing more. The host owns the renderer, camera, and fog (palette-matched
 * FogExp2 in deep teal-green, per the adopted technique stack); this module
 * owns the garden group and its per-frame motion.
 *
 * The recipe's dawn grammar: warm dawn-gold key light, layered greens,
 * pale grown stone, gold mist in the hollows; the HYG sky present but
 * humbled by dawn (opacity-dimmed, same real data). Baked glow only —
 * no bloom, no post-processing. The tree stands at the crown's center;
 * the recipe's off-axis intent is honored by the host's arrival camera
 * angle, which meets the garden across the terraces and then up.
 *
 * Draw-call sketch (recipe ceiling 95): terraces ≤6 · tree 4 · vegetation 1
 * · plots 3 (one instanced mesh per form) · paths 1 · landmarks ≤3 each
 * · sky 1 · mist 3 · underside 2 (skirt + bottom cap) · Verb 1 glow ≤2
 * (one halo InstancedMesh + one lit-paths LineSegments, only when non-empty).
 * Runtime measurement belongs to the device check (C4's measured half);
 * these constants are the static half.
 *
 * The garden is a finished solid: a stone skirt drops from the lowest
 * terrace to a solid floor, and a bottom cap closes it — from below,
 * the garden reads as ground, never void. The worlds camera is floored
 * above the lowest terrace as well (see GARDEN_CAMERA_FLOOR_Y), so no
 * view can ever sink under the garden.
 *
 * Kindness is structural here: the scene has no state for decline. An
 * empty layout renders terraces, tree, and sky — honest resting ground.
 * Reduced motion holds the garden: no sway, no drifting mist.
 */

/**
 * Mutation state (Phase 4, A6/A7/A8/A23/A24/A25) — driven by props/data
 * from the host (WorldsSurface), which fetches the world-changes state
 * and pending proposals. The scene never fetches: it renders exactly
 * what it is given, and a position it is not given is never invented.
 *
 * - warmth: the A8 signal (0..1). The scene lerps its light/fog/mist
 *   toward it slowly — never a cut, never a jump.
 * - previews: pending proposals (A23) — rendered only as ghosts, never
 *   as finished things, and only for proposals already in the batched
 *   calm-review queue. A preview carries its own position: a landmark
 *   preview stands at the seeded crown position for its journey; a path
 *   preview joins the two plots it names. A proposal whose target does
 *   not resolve to a position is not previewed at all.
 * - landings: approved changes landing now. A landmark rises (A6, ~8s),
 *   a path draws itself (A7, ~4s), anything else firms from its preview
 *   (A24, ~2s). Exactly one landing animation per log entry — the
 *   generic firming never also plays for a change with its own form.
 *   At most one landing plays at a time: a new landing jumps any
 *   in-progress one straight to its final state (the state change
 *   already happened; the animation is only presentation).
 * - undos: applied changes being undone (A25) — reversed by the
 *   compensating path, never a snap-delete.
 */
export interface GardenMutationPreview {
  proposalId: string;
  kind: "landmark" | "path";
  title: string;
  /** Landmark: its seeded crown-terrace position. */
  x?: number;
  y?: number;
  z?: number;
  /** Path: the two plot positions it joins. */
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  /** Path: the two plot (node) ids it joins, for layout lookup. */
  fromNodeId?: number;
  toNodeId?: number;
}

export interface GardenMutationLanding {
  proposalId: string;
  kind: LandingKind;
  title: string;
  /** Landmark: its seeded crown-terrace position. Omit to skip. */
  x?: number;
  y?: number;
  z?: number;
  /** Landmark: the journey it celebrates — a journey already rendering
   *  presence-only is never re-risen (A6). */
  journeyId?: number;
  /** Path: the two plot positions it joins. */
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  /** Path: the two plot (node) ids it joins, for layout lookup. */
  fromNodeId?: number;
  toNodeId?: number;
}

export interface GardenMutationUndo {
  proposalId: string;
  kind: LandingKind;
  title: string;
  x?: number;
  y?: number;
  z?: number;
  journeyId?: number;
  from?: { x: number; y: number; z: number };
  to?: { x: number; y: number; z: number };
  /** Path: the two plot (node) ids it joins, for layout lookup. */
  fromNodeId?: number;
  toNodeId?: number;
}

export interface GardenMutationInput {
  warmth: number;
  previews: GardenMutationPreview[];
  landings: GardenMutationLanding[];
  undos: GardenMutationUndo[];
}

export const EMPTY_GARDEN_MUTATION: GardenMutationInput = {
  warmth: 0,
  previews: [],
  landings: [],
  undos: [],
};

export interface GardenScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
  /**
   * Verb 1 (Tend a plot): which plot a pointer tap lands on, if any.
   * Raycasts against the three plot InstancedMeshes; returns the plot's
   * node id, or null when the tap hits ground, sky, or nothing.
   */
  pickPlot: (ndc: { x: number; y: number }, camera: THREE.Camera) => number | null;
  /**
   * Garden v2 (walk): what a tap lands on — a seed pod, a plot, or the
   * ground (with the point), nearest first; null for sky. Mist, signs and
   * glows are never targets.
   */
  pickTarget: (ndc: { x: number; y: number }, camera: THREE.Camera) => GardenPick | null;
  /** Place Soumaya's ship (her avatar in the garden). heading: atan2(dx, dz) of travel. */
  setAvatar: (x: number, y: number, z: number, heading: number) => void;
  /** Push new mutation state (warmth target, previews, landings, undos). */
  setMutation: (input: GardenMutationInput) => void;
  /** Jump every in-progress landing/undo to its final state (tap to skip). */
  skipAnimations: () => void;
  /** The warmth currently rendered (the lerp target is the input). */
  getWarmth: () => number;
  /** The fog tint for the warmth currently rendered, or null before any input. */
  getWarmthFogColor: () => number | null;
}

/**
 * Verb 1 (Tend a plot): the garden's warm glow, passed at build time.
 * warmNodeIds — plots tended within the warm window (gold halos).
 * litEdgeIds — edges a recent tend created or reused (brighter paths).
 * Both are additive only: untended plots and unlit paths render exactly
 * as before. The layout's own paths already carry edge ids (GardenPath),
 * so the scene resolves lit endpoints from the layout — no re-derivation.
 */
export type GardenPick =
  | { kind: "pod" | "plot"; nodeId: number; x: number; z: number }
  | { kind: "ground"; x: number; z: number };

export interface GardenGlow {
  warmNodeIds: Set<number>;
  litEdgeIds: Set<number>;
}

const DAWN_GOLD = 0xffd27a;
/**
 * Terrace tops, outermost (lowest) to crown — the approved Growing Place
 * mock-up's five layered greens, lightening toward the light; the sixth
 * (crown) repeats the lightest so the top reads as sunlit.
 */
const TERRACE_GREENS = [0x3d6b35, 0x477a3a, 0x528741, 0x5d9247, 0x6b9c4e, 0x6b9c4e] as const;
const STONE = 0xd8d2c4;
const SOIL = 0x4a3a28;

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

function hashSeeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The landmark arch: two pillars, a lintel arc, a warm glow at the top.
 * Built from the caller's materials so presence-only landmarks can share
 * one pair while previews/landings get their own (a fading ghost must
 * never dim the landmarks that stand beside it).
 */
function buildLandmarkArch(
  stoneMat: THREE.Material,
  glowMat: THREE.Material,
): { arch: THREE.Group; glow: THREE.Mesh } {
  const arch = new THREE.Group();
  const pillarGeo = new THREE.CylinderGeometry(2.5, 3, 26, 8);
  const left = new THREE.Mesh(pillarGeo, stoneMat);
  left.position.set(-9, 13, 0);
  const right = new THREE.Mesh(pillarGeo, stoneMat);
  right.position.set(9, 13, 0);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(9, 2.2, 8, 24, Math.PI), stoneMat);
  arc.position.y = 26;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), glowMat);
  glow.position.y = 30;
  arch.add(left, right, arc, glow);
  return { arch, glow };
}

/** Scale a loaded model so its longest side is `size`, recentered on its bounding-box center. */
function fitToSize(root: THREE.Object3D, size: number): void {
  const box = new THREE.Box3().setFromObject(root);
  const extents = box.getSize(new THREE.Vector3());
  const longest = Math.max(extents.x, extents.y, extents.z);
  if (!Number.isFinite(longest) || longest <= 0) return;
  const scale = size / longest;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  const scaled = new THREE.Box3().setFromObject(root);
  const center = scaled.getCenter(new THREE.Vector3());
  root.position.sub(center);
}

/** Height a seed pod floats above the ground it ripened over. */
export const POD_FLOAT = 16;

/** A grove tree's growth factor: one tier per completed mission, up to ten — it only grows. */
export function groveGrowth(missionsCompleted: number): number {
  // Base 1.7: a grove tree stands well above the forest so a grove reads
  // as a place, not one more tree.
  return 1.7 * (1 + 0.12 * Math.min(Math.max(missionsCompleted, 0), 10));
}

/**
 * Garden v2 groves: one per Journey — a cleared lawn, a grove tree whose
 * height counts completed missions, a flower per completed mission, a soft
 * mist over paused Journeys (resting, never wilted; owner 2026-10-29), gold
 * trails between groves that share memories, the grove's name on a sign,
 * and the day's seed pods. Every kind is one instanced mesh whatever the
 * count, so draw calls don't grow with Journeys (signs aside, capped).
 */
function buildGroves(
  group: THREE.Group,
  layout: GardenLayout,
  dummy: THREE.Object3D,
  pods: { mesh: THREE.InstancedMesh | null; base: { x: number; y: number; z: number }[] },
): void {
  const groves = layout.groves ?? [];
  if (groves.length > 0) {
    const lawns = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshLambertMaterial({ color: 0x7aa85a }),
      groves.length,
    );
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(3.2, 5, 30, 7),
      new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
      groves.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(17, 1),
      // A lighter, blossom-warm green than the forest's, so groves pop.
      new THREE.MeshLambertMaterial({ color: 0xa8c96a, emissive: 0x3a3a12 }),
      groves.length,
    );
    groves.forEach((g, i) => {
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.position.set(g.x, g.y + 0.6, g.z);
      dummy.scale.setScalar(g.radius);
      dummy.updateMatrix();
      lawns.setMatrixAt(i, dummy.matrix);
      const grow = groveGrowth(g.missionsCompleted);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(grow);
      dummy.position.set(g.x, g.y + 15 * grow, g.z);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(grow, grow * 0.8, grow);
      dummy.position.set(g.x, g.y + 34 * grow, g.z);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
    });
    dummy.scale.setScalar(1);
    dummy.rotation.set(0, 0, 0);
    lawns.name = "grove-lawns";
    trunks.name = "grove-trunks";
    crowns.name = "grove-trees";
    group.add(lawns, trunks, crowns);

    // Flowers for completed missions, ringed around each grove tree.
    const flowerSpots: { x: number; y: number; z: number }[] = [];
    for (const g of groves) {
      const n = Math.min(g.missionsCompleted, 24);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + g.journeyId;
        const r = g.radius * 0.28 + (k % 2) * 4;
        flowerSpots.push({ x: g.x + Math.cos(a) * r, y: g.y + 3, z: g.z + Math.sin(a) * r });
      }
    }
    if (flowerSpots.length > 0) {
      const flowers = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(2.6, 0),
        new THREE.MeshLambertMaterial({ color: DAWN_GOLD, emissive: 0x4a3410 }),
        flowerSpots.length,
      );
      flowerSpots.forEach((f, i) => {
        dummy.position.set(f.x, f.y, f.z);
        dummy.updateMatrix();
        flowers.setMatrixAt(i, dummy.matrix);
      });
      flowers.name = "grove-flowers";
      group.add(flowers);
    }

    // Paused Journeys rest under mist: soft, quiet, never wilted.
    const resting = groves.filter((g) => g.status === "paused");
    if (resting.length > 0) {
      const mist = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 20, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8efe0, transparent: true, opacity: 0.22, depthWrite: false }),
        resting.length,
      );
      resting.forEach((g, i) => {
        dummy.position.set(g.x, g.y + 18, g.z);
        dummy.scale.set(g.radius * 1.05, 26, g.radius * 1.05);
        dummy.updateMatrix();
        mist.setMatrixAt(i, dummy.matrix);
      });
      dummy.scale.setScalar(1);
      mist.name = "grove-mist";
      mist.raycast = () => {}; // mist never blocks a tap on what rests under it
      group.add(mist);
    }

    // Grove signs: the Journey's icon + name (+ "resting" in words, never
    // mist alone), readable from walking distance. Capped so a brain with
    // many Journeys can't blow the draw-call budget.
    if (typeof document !== "undefined") {
      for (const g of groves.slice(0, GROVE_SIGN_MAX)) {
        const label = `${g.icon ? `${g.icon} ` : ""}${g.title}${g.status === "paused" ? " · resting" : ""}`;
        const sign = groveSign(label);
        if (!sign) continue;
        sign.position.set(g.x, g.y + 62 * groveGrowth(g.missionsCompleted), g.z);
        sign.name = `grove-sign-${g.journeyId}`;
        group.add(sign);
      }
    }
  }

  // Trails between groves that share memories — confirmed links only.
  const byJourney = new Map(groves.map((g) => [g.journeyId, g]));
  const trail: number[] = [];
  for (const p of layout.grovePaths ?? []) {
    const a = byJourney.get(p.fromJourneyId);
    const b = byJourney.get(p.toJourneyId);
    if (!a || !b) continue;
    const y = Math.max(a.y, b.y) + 4;
    trail.push(a.x, y, a.z, b.x, y, b.z);
  }
  if (trail.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(trail), 3));
    const line = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: DAWN_GOLD, transparent: true, opacity: 0.85 }),
    );
    line.name = "grove-trails";
    group.add(line);
  }

  // Seed pods: memories due for recall, glowing above where they rest.
  const due = layout.pods ?? [];
  if (due.length > 0) {
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(5, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
      due.length,
    );
    pods.base = due.map((p) => ({ x: p.x, y: p.y + POD_FLOAT, z: p.z }));
    pods.base.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.name = "seed-pods";
    pods.mesh = mesh;
    group.add(mesh);
  }
}

/** At most this many grove signs (one draw call each). */
const GROVE_SIGN_MAX = 20;

/** A text sign as a sprite (canvas-drawn; skipped where there is no DOM or 2D context). */
function groveSign(text: string): THREE.Sprite | null {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  if (!g) return null;
  const font = "600 34px system-ui, sans-serif";
  g.font = font;
  const w = Math.min(560, Math.ceil(g.measureText(text).width) + 40);
  c.width = w;
  c.height = 60;
  g.font = font; // resizing the canvas resets its state
  g.fillStyle = "rgba(12,28,20,0.72)";
  g.fillRect(0, 0, w, 60);
  g.fillStyle = "#fff4d6";
  g.textBaseline = "middle";
  g.fillText(text, 20, 31, w - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set((w / 60) * 13, 13, 1);
  sprite.raycast = () => {}; // signs are reached through the Groves list, not tapped in the scene
  return sprite;
}

/**
 * Soft radial gold glow for the crown halo — computed into a DataTexture
 * (no canvas, so it also builds where there is no DOM) and no asset to load.
 */
function haloTexture(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2));
      const o = (y * n + x) * 4;
      data[o] = 255;
      data[o + 1] = Math.round(215 - 35 * d);
      data[o + 2] = Math.round(140 - 50 * d);
      data[o + 3] = Math.round(255 * 0.55 * (1 - d));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createGardenScene(
  layout: GardenLayout,
  glowOrMutation?: GardenGlow | GardenMutationInput,
  initialMutationArg?: GardenMutationInput,
): GardenScene {
  // Rebase union (Verb 1 + Phase 4): the second argument is the tend
  // glow or an initial mutation — told apart by shape, never by
  // position, so both call forms keep working unchanged. GardenGlow
  // has no `warmth` property; GardenMutationInput always does.
  const glow =
    glowOrMutation && "warmth" in glowOrMutation ? undefined : glowOrMutation;
  const initialMutation =
    glowOrMutation && "warmth" in glowOrMutation ? glowOrMutation : initialMutationArg;
  const group = new THREE.Group();
  group.name = "growing-place";
  let disposed = false;
  const swaying: THREE.Object3D[] = [];
  // Seed pods bob gently; kept so update() can move them (still under reduced motion).
  const pods: { mesh: THREE.InstancedMesh | null; base: { x: number; y: number; z: number }[] } = { mesh: null, base: [] };
  // Verb 1: the plot meshes, kept for tap-to-tend raycasting.
  const plotMeshes: { mesh: THREE.InstancedMesh; plots: readonly { nodeId: number; x: number; z: number }[] }[] = [];

  // Terraces: every band is built, whether or not a plot sits on it yet —
  // the garden is always a complete, layered hillside (as in the mock-up),
  // never bare rings with the underside showing through the gaps. Greens
  // step per terrace. Ring i spans radius[i+1]..radius[i].
  const presentTerraces = new Set(Array.from({ length: GARDEN_TERRACE_COUNT }, (_, t) => t));
  // What a tap can land on as "ground" (walk targets).
  const groundMeshes: THREE.Object3D[] = [];
  const riserMat = new THREE.MeshLambertMaterial({ color: 0x2e4d2a, side: THREE.DoubleSide });
  for (const t of [...presentTerraces].sort((a, b) => a - b)) {
    const inner = t + 1 < GARDEN_TERRACE_COUNT ? GARDEN_TERRACE_RADIUS[t + 1]! : 60;
    const outer = GARDEN_TERRACE_RADIUS[t]!;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 64),
      new THREE.MeshLambertMaterial({ color: TERRACE_GREENS[t]!, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = GARDEN_TERRACE_HEIGHT[t]!;
    ring.name = `terrace-${t}`;
    group.add(ring);
    groundMeshes.push(ring);
    // The step down to the terrace below: without a riser each ring floats
    // as a flat disc and the garden reads as a plate, not as terraces.
    if (t > 0) {
      const below = GARDEN_TERRACE_HEIGHT[t - 1]!;
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(outer, outer, GARDEN_TERRACE_HEIGHT[t]! - below, 64, 1, true),
        riserMat,
      );
      riser.position.y = (GARDEN_TERRACE_HEIGHT[t]! + below) / 2;
      riser.name = `terrace-riser-${t}`;
      group.add(riser);
    }
  }
  // Crown disc under the tree.
  const crownDisc = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshLambertMaterial({ color: TERRACE_GREENS[GARDEN_TERRACE_COUNT - 1]! }),
  );
  crownDisc.rotation.x = -Math.PI / 2;
  crownDisc.position.y = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]!;
  group.add(crownDisc);
  groundMeshes.push(crownDisc);

  // Finished underside: the garden is a solid, not flat rings over void.
  // A stone skirt drops from the lowest terrace (y=0) to the solid floor,
  // and a bottom cap closes it — from below, the garden reads as ground.
  const undersideMat = new THREE.MeshStandardMaterial({
    color: 0x3a2f24,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(
      GARDEN_TERRACE_RADIUS[0]!,
      GARDEN_TERRACE_RADIUS[0]!,
      GARDEN_UNDERSIDE_DEPTH,
      64,
      1,
      true,
    ),
    undersideMat,
  );
  skirt.position.y = GARDEN_FLOOR_Y + GARDEN_UNDERSIDE_DEPTH / 2;
  skirt.name = "garden-underside-skirt";
  group.add(skirt);
  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(GARDEN_TERRACE_RADIUS[0]!, 64),
    undersideMat,
  );
  cap.rotation.x = Math.PI / 2; // face down: the bottom seen from below
  cap.position.y = GARDEN_FLOOR_Y;
  cap.name = "garden-underside-cap";
  group.add(cap);

  // The witness tree: a trunk you could lose a ship inside, a canopy dome
  // wide enough to shade the top terraces.
  const tree = new THREE.Group();
  tree.name = "witness-tree";
  const crownY = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]!;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 28, 190, 10),
    new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
  );
  trunk.position.y = crownY + 95;
  tree.add(trunk);
  // Canopy: five overlapping, flattened blobs (the mock-up's silhouette),
  // faintly self-lit so the crown holds its green against the dark sky.
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x74a24b, emissive: 0x1d2f10 });
  const canopyBlobs = [
    { x: 0, y: 235, z: 0, r: 146 },
    { x: 84, y: 202, z: 34, r: 95 },
    { x: -78, y: 207, z: -28, r: 90 },
    { x: 22, y: 213, z: -78, r: 84 },
    { x: -28, y: 218, z: 73, r: 78 },
  ];
  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  for (const b of canopyBlobs) {
    const blob = new THREE.Mesh(canopyGeo, canopyMat);
    blob.position.set(b.x, crownY + b.y, b.z);
    blob.scale.set(b.r, b.r * 0.72, b.r);
    tree.add(blob);
  }
  // A warm halo behind the crown — the tree is the world's light source.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, fog: false }),
  );
  halo.scale.setScalar(640);
  halo.position.set(0, crownY + 225, 0);
  halo.name = "witness-halo";
  halo.raycast = () => {}; // a glow is never a pick target (and Sprite.raycast needs a camera)
  tree.add(halo);
  // The whole tree sways as one — a sphere alone would show nothing.
  swaying.push(tree);
  group.add(tree);

  // Vegetation: instanced, seeded across the terraces — the recipe's named
  // perf risk, instancing mandatory; density is the fallback dial.
  const vegRand = mulberry32(hashSeeded("growing-place / first-light-1:vegetation"));
  const vegCount = 300;
  const vegBlocked = [...layout.plots, ...layout.landmarks];
  const groves = layout.groves ?? [];
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(2.5, 3.9, 22, 5),
    new THREE.MeshLambertMaterial({ color: 0x54402e }),
    vegCount,
  );
  const veg = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(16, 0),
    new THREE.MeshLambertMaterial({ color: 0x5c8a42 }),
    vegCount,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < vegCount; i++) {
    // Rejection-sample so a tree never stands on a memory: plots are tiny
    // next to a tree and would vanish behind one.
    let x = 0;
    let z = 0;
    let terrace = 0;
    for (let tries = 0; tries < 12; tries++) {
      terrace = Math.floor(vegRand() * GARDEN_TERRACE_COUNT);
      const angle = vegRand() * Math.PI * 2;
      const radius = GARDEN_TERRACE_RADIUS[terrace]! * (0.55 + vegRand() * 0.4);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      if (
        !vegBlocked.some((o) => Math.hypot(o.x - x, o.z - z) < 40) &&
        !groves.some((g) => Math.hypot(g.x - x, g.z - z) < g.radius + 45)
      ) {
        break;
      }
    }
    const sc = 0.7 + vegRand() * 0.9;
    dummy.position.set(x, GARDEN_TERRACE_HEIGHT[terrace]! + 11 * sc, z);
    dummy.rotation.y = vegRand() * Math.PI * 2;
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = GARDEN_TERRACE_HEIGHT[terrace]! + 30 * sc;
    dummy.updateMatrix();
    veg.setMatrixAt(i, dummy.matrix);
  }
  trunks.name = "vegetation-trunks";
  group.add(trunks);
  veg.name = "vegetation";
  group.add(veg);

  // Plots: one instanced mesh per form. Form says what kind of thing it is —
  // a grove's open mission is a sprout, a grove's memory a stone, a loose
  // meadow memory a wildflower; size, brightness, and color are the same
  // within a form (non-ranking rule). Sized to read from walking height.
  const stoneGeo = new THREE.DodecahedronGeometry(5);
  const sproutGeo = new THREE.ConeGeometry(3.6, 14, 6);
  const ringGeo = new THREE.TorusGeometry(6, 1.4, 8, 24);
  const wildGeo = new THREE.OctahedronGeometry(3.4);
  const wildMat = new THREE.MeshLambertMaterial({ color: 0xf3e6c4, emissive: 0x3a2c10 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.8, metalness: 0.05 });
  const sproutMat = new THREE.MeshStandardMaterial({ color: 0x6fa055, roughness: 0.85, metalness: 0 });
  const ringMat = new THREE.MeshStandardMaterial({ color: DAWN_GOLD, roughness: 0.6, metalness: 0.2 });
  const wild = (p: GardenLayout["plots"][number]) => p.role === "wild";
  const byForm = {
    stone: layout.plots.filter((p) => !wild(p) && p.kind !== "action" && !p.gathering),
    sprout: layout.plots.filter((p) => !wild(p) && p.kind === "action"),
    ring: layout.plots.filter((p) => !wild(p) && p.gathering),
    wild: layout.plots.filter(wild),
  } as const;
  const forms = [
    { plots: byForm.stone, geo: stoneGeo, mat: stoneMat, name: "plots-stone", lift: 3 },
    { plots: byForm.sprout, geo: sproutGeo, mat: sproutMat, name: "plots-sprout", lift: 7 },
    { plots: byForm.ring, geo: ringGeo, mat: ringMat, name: "plots-gathering", lift: 2 },
    { plots: byForm.wild, geo: wildGeo, mat: wildMat, name: "plots-wild", lift: 5 },
  ] as const;
  for (const form of forms) {
    if (form.plots.length === 0) continue;
    const mesh = new THREE.InstancedMesh(form.geo, form.mat, form.plots.length);
    form.plots.forEach((plot, i) => {
      dummy.position.set(plot.x, plot.y + form.lift, plot.z);
      dummy.rotation.set(0, 0, 0);
      if (form.name === "plots-gathering") dummy.rotation.x = Math.PI / 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.name = form.name;
    plotMeshes.push({ mesh, plots: form.plots });
    group.add(mesh);
  }

  // Verb 1 (Tend a plot): the warm glow. One InstancedMesh of gold halo
  // spheres over plots tended within the warm window, plus one brighter
  // LineSegments over the paths a recent tend lit. Additive only — an
  // untended plot looks exactly as it always did; the glow simply isn't
  // drawn. Baked glow, no bloom, no post-processing.
  if (glow && glow.warmNodeIds.size > 0) {
    const warmPlots: { x: number; y: number; z: number }[] = [];
    for (const form of forms) {
      form.plots.forEach((plot) => {
        if (glow.warmNodeIds.has(plot.nodeId)) {
          warmPlots.push({ x: plot.x, y: plot.y + form.lift, z: plot.z });
        }
      });
    }
    if (warmPlots.length > 0) {
      const halos = new THREE.InstancedMesh(
        new THREE.SphereGeometry(5.5, 12, 8),
        new THREE.MeshBasicMaterial({ color: DAWN_GOLD, transparent: true, opacity: 0.45, depthWrite: false }),
        warmPlots.length,
      );
      warmPlots.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        halos.setMatrixAt(i, dummy.matrix);
      });
      halos.name = "warm-halos";
      group.add(halos);
    }
  }
  if (glow && glow.litEdgeIds.size > 0) {
    const byId = new Map(layout.plots.map((p) => [p.nodeId, p]));
    const positions: number[] = [];
    for (const path of layout.paths) {
      if (!glow.litEdgeIds.has(path.edgeId)) continue;
      const a = byId.get(path.fromNodeId);
      const b = byId.get(path.toNodeId);
      if (!a || !b) continue; // layout guarantees endpoints; defense in depth
      positions.push(a.x, a.y + 3, a.z, b.x, b.y + 3, b.z);
    }
    if (positions.length > 0) {
      const litGeo = new THREE.BufferGeometry();
      litGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      const lit = new THREE.LineSegments(
        litGeo,
        new THREE.LineBasicMaterial({ color: 0xffc84d, transparent: true, opacity: 1 }),
      );
      lit.name = "lit-paths";
      group.add(lit);
    }
  }

  // Paths: one LineSegments of dawn-gold chords between plot pairs.
  if (layout.paths.length > 0) {
    const byId = new Map(layout.plots.map((p) => [p.nodeId, p]));
    const positions: number[] = [];
    for (const path of layout.paths) {
      const a = byId.get(path.fromNodeId);
      const b = byId.get(path.toNodeId);
      if (!a || !b) continue; // layout guarantees endpoints; defense in depth
      positions.push(a.x, a.y + 3, a.z, b.x, b.y + 3, b.z);
    }
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    const paths = new THREE.LineSegments(
      pathGeo,
      new THREE.LineBasicMaterial({ color: DAWN_GOLD, transparent: true, opacity: 0.7 }),
    );
    paths.name = "paths";
    group.add(paths);
  }

  buildGroves(group, layout, dummy, pods);
  const lawns = group.getObjectByName("grove-lawns");
  if (lawns) groundMeshes.push(lawns);

  // Her ship: the traveller's avatar in the garden (v2 walk). The
  // procedural hull stands in until her real ship loads (the proxy
  // pattern), and forever if it can't. Hidden until the host places it.
  const avatar = new THREE.Group();
  avatar.name = "garden-avatar";
  avatar.visible = false;
  const avatarBody = new THREE.Group();
  avatarBody.scale.setScalar(2);
  avatar.add(avatarBody);
  const proceduralShip = buildProceduralShip();
  avatarBody.add(proceduralShip);
  group.add(avatar);
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    avatarBody.remove(proceduralShip);
    disposeObject3D(proceduralShip);
    avatarBody.add(hero);
  });

  // Landmarks: presence-only arches for completed Journeys — pale stone and
  // living branch weaving upward. No rising animation here (A6, Phase 4).
  for (const landmark of layout.landmarks) {
    const { arch } = buildLandmarkArch(
      stoneMat,
      new THREE.MeshBasicMaterial({ color: DAWN_GOLD }),
    );
    arch.name = `landmark-${landmark.journeyId}`;
    arch.position.set(landmark.x, landmark.y, landmark.z);
    group.add(arch);
  }

  // Sky: the real HYG field, humbled by dawn (same data as the Station's).
  const stars = buildHygStarfield();
  const starMat = stars.material as THREE.PointsMaterial;
  starMat.transparent = true;
  starMat.opacity = 0.35;
  group.add(stars);

  // Distant backdrop planets (EVE-style, 2026-10-27): a whole distant
  // system, a Quaternius planet, and THE ice world — a frozen sphere
  // over the warm garden — 4,000 units out at ~7° elevation. The slow
  // orbit (radius 1,150) never brings the camera closer than ~2,850,
  // so they loom and never arrive. Loaded as-is; a holder stays empty
  // until its GLB lands.
  for (const planet of GARDEN_BACKDROP_PLANETS) {
    const holder = new THREE.Group();
    holder.name = `backdrop-${planet.key}`;
    holder.position.set(
      Math.cos(planet.angle) * planet.distance,
      planet.y,
      Math.sin(planet.angle) * planet.distance,
    );
    group.add(holder);
    void loadGardenAsset(planet.url).then((loaded) => {
      if (!loaded) return;
      if (disposed) {
        disposeObject3D(loaded);
        return;
      }
      fitToSize(loaded, planet.size);
      loaded.name = `backdrop-${planet.key}-model`;
      holder.add(loaded);
    });
  }

  // Dawn light: warm low key + soft ambient. Mist: three slow planes.
  // The key, ambient, and mist are the A8 handles — the mutation block
  // below lerps their colors toward the warmth signal, never a cut.
  const key = new THREE.DirectionalLight(0xffc27d, 1.6);
  key.position.set(-400, 260, 300);
  group.add(key);
  const ambient = new THREE.AmbientLight(0xffd9b0, 1.15);
  group.add(ambient);
  const mistMat = new THREE.MeshBasicMaterial({ color: 0xcfd8b8, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
  const mists: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(1200, 260), mistMat);
    mist.position.set(0, 30 + i * 40, -500 + i * 260);
    mist.name = `mist-${i}`;
    group.add(mist);
    mists.push(mist);
    swaying.push(mist);
  }

  const raycaster = new THREE.Raycaster();
  const podMatrix = new THREE.Matrix4();
  // --- Phase 4 mutation presentation (A6/A7/A8/A23/A24/A25) ---
  // The scene renders exactly what setMutation is given — never a
  // position it was not given, never a change the rail did not approve.
  // Combined load (inventory): A8 crossfade + A23 previews + at most
  // one of A6/A7 at a time + A18 idle + A20 selection + A26 tend, inside
  // the garden budget (95 draw calls, 700k tris). Fallback order when
  // the budget is exceeded: particle drift off, A6/A7 at reduced-motion
  // form, A8 crossfade slows (never jumps).
  const mutationGroup = new THREE.Group();
  mutationGroup.name = "mutation";
  group.add(mutationGroup);

  const easeInOut = (x: number) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  let warmthTarget = 0;
  let warmthCurrent = 0;
  let warmthSeen = false;
  let clockMs = 0;
  let lastElapsedMs: number | null = null;

  // The shared paths line, kept so a path undo can rebuild it without
  // the undone edge (the line is one draw call for all paths; it is
  // rebuilt, never duplicated).
  const sharedPaths = group.getObjectByName("paths") as THREE.LineSegments | undefined;
  const rebuildSharedPaths = (excludeEdgeId?: number) => {
    if (!sharedPaths) return;
    const byId = new Map(layout.plots.map((p) => [p.nodeId, p]));
    const positions: number[] = [];
    for (const path of layout.paths) {
      if (path.edgeId === excludeEdgeId) continue;
      const a = byId.get(path.fromNodeId);
      const b = byId.get(path.toNodeId);
      if (!a || !b) continue;
      positions.push(a.x, a.y + 3, a.z, b.x, b.y + 3, b.z);
    }
    sharedPaths.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    sharedPaths.geometry = geo;
  };

  interface PreviewEntry {
    object: THREE.Object3D;
    materials: THREE.Material[];
  }
  const previews = new Map<string, PreviewEntry>();
  const fadingPreviews: { entry: PreviewEntry; startedAt: number }[] = [];

  interface ActiveMotion {
    object: THREE.Object3D;
    kind: "landmark" | "path" | "other";
    startedAt: number;
    durationMs: number;
    reducedDurationMs: number;
    /** Reverse (undo) or forward (landing). */
    direction: "forward" | "reverse";
    materials: THREE.Material[];
    points?: number;
    finalize: () => void;
  }
  let activeLanding: ActiveMotion | null = null;
  const activeUndos: ActiveMotion[] = [];
  /** Objects this scene landed, by proposal id — undos find them here. */
  const landed = new Map<string, THREE.Object3D>();

  const setMaterialsOpacity = (materials: THREE.Material[], opacity: number) => {
    for (const m of materials) {
      const mat = m as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      if ("opacity" in mat) {
        mat.transparent = true;
        mat.opacity = opacity;
      }
    }
  };

  const buildPreviewLandmark = (p: GardenMutationPreview): PreviewEntry | null => {
    if (p.x === undefined || p.y === undefined || p.z === undefined) return null;
    const style = provisionalStyle(false);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffe9b0,
      transparent: true,
      opacity: style.opacity,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: DAWN_GOLD,
      transparent: true,
      opacity: style.opacity,
    });
    const { arch } = buildLandmarkArch(ghostMat, glowMat);
    arch.name = `preview-${p.proposalId}`;
    arch.position.set(p.x, p.y, p.z);
    return { object: arch, materials: [ghostMat, glowMat] };
  };

  const buildPreviewPath = (p: GardenMutationPreview): PreviewEntry | null => {
    if (!p.from || !p.to) return null;
    const style = provisionalStyle(false);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([p.from.x, p.from.y + 3, p.from.z, p.to.x, p.to.y + 3, p.to.z]),
        3,
      ),
    );
    const mat = new THREE.LineDashedMaterial({
      color: DAWN_GOLD,
      dashSize: 6,
      gapSize: 4,
      transparent: true,
      opacity: style.opacity,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.name = `preview-${p.proposalId}`;
    return { object: line, materials: [mat] };
  };

  const buildLandingLandmark = (
    l: GardenMutationLanding,
    desc: ReturnType<typeof applyTransition>,
  ): ActiveMotion | null => {
    if (l.x === undefined || l.y === undefined || l.z === undefined) return null;
    const stoneMat = new THREE.MeshStandardMaterial({
      color: STONE,
      roughness: 0.8,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: DAWN_GOLD,
      transparent: true,
      opacity: 0,
    });
    const { arch } = buildLandmarkArch(stoneMat, glowMat);
    arch.name = `landing-${l.proposalId}`;
    arch.position.set(l.x, l.y, l.z);
    arch.scale.y = 0.05;
    mutationGroup.add(arch);
    landed.set(l.proposalId, arch);
    const materials = [stoneMat, glowMat];
    return {
      object: arch,
      kind: "landmark",
      startedAt: clockMs,
      durationMs: desc.durationMs,
      reducedDurationMs: desc.reducedMotion.durationMs,
      direction: "forward",
      materials,
      finalize: () => {
        arch.scale.y = 1;
        glowMat.opacity = 1;
        stoneMat.opacity = 1;
      },
    };
  };

  const sampledLine = (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    segments: number,
  ): { geometry: THREE.BufferGeometry; points: number } => {
    const positions: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      positions.push(
        from.x + (to.x - from.x) * t,
        from.y + 3 + (to.y - from.y) * t,
        from.z + (to.z - from.z) * t,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    return { geometry, points: segments + 1 };
  };

  const buildLandingPath = (
    l: GardenMutationLanding,
    desc: ReturnType<typeof applyTransition>,
  ): ActiveMotion | null => {
    if (!l.from || !l.to) return null;
    const { geometry, points } = sampledLine(l.from, l.to, 32);
    const mat = new THREE.LineBasicMaterial({
      color: DAWN_GOLD,
      transparent: true,
      opacity: 0.7,
    });
    const line = new THREE.Line(geometry, mat);
    line.name = `landing-${l.proposalId}`;
    line.geometry.setDrawRange(0, 0);
    mutationGroup.add(line);
    landed.set(l.proposalId, line);
    return {
      object: line,
      kind: "path",
      startedAt: clockMs,
      durationMs: desc.durationMs,
      reducedDurationMs: desc.reducedMotion.durationMs,
      direction: "forward",
      materials: [mat],
      points,
      finalize: () => {
        line.geometry.setDrawRange(0, points);
        mat.opacity = 0.7;
      },
    };
  };

  const buildLandingOther = (
    l: GardenMutationLanding,
    desc: ReturnType<typeof applyTransition>,
  ): ActiveMotion | null => {
    if (l.x === undefined || l.y === undefined || l.z === undefined) return null;
    // An anchor's garden form: a small stone marker that firms in (A24).
    const mat = new THREE.MeshStandardMaterial({
      color: STONE,
      roughness: 0.8,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
    });
    const marker = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2), mat);
    marker.name = `landing-${l.proposalId}`;
    marker.position.set(l.x, l.y + 3, l.z);
    mutationGroup.add(marker);
    landed.set(l.proposalId, marker);
    return {
      object: marker,
      kind: "other",
      startedAt: clockMs,
      durationMs: desc.durationMs,
      reducedDurationMs: desc.reducedMotion.durationMs,
      direction: "forward",
      materials: [mat],
      finalize: () => {
        mat.opacity = 1;
      },
    };
  };

  const finishMotion = (motion: ActiveMotion) => {
    motion.finalize();
    if (motion === activeLanding) activeLanding = null;
    const undoIdx = activeUndos.indexOf(motion);
    if (undoIdx >= 0) activeUndos.splice(undoIdx, 1);
  };

  const startLanding = (l: GardenMutationLanding): void => {
    // At most one landing at a time: a new landing jumps any
    // in-progress one straight to its final state (the state change
    // already happened; the animation is only presentation).
    if (activeLanding) finishMotion(activeLanding);
    // A6: a landmark already rendering presence-only never re-rises.
    if (
      l.kind === "landmark" &&
      l.journeyId !== undefined &&
      layout.landmarks.some((lm) => lm.journeyId === l.journeyId)
    ) {
      return;
    }
    const desc = applyTransition(l.kind);
    const motion =
      l.kind === "landmark"
        ? buildLandingLandmark(l, desc)
        : l.kind === "path"
          ? buildLandingPath(l, desc)
          : buildLandingOther(l, desc);
    if (motion) activeLanding = motion;
  };

  const startUndo = (u: GardenMutationUndo): void => {
    const desc = undoTransition(u.kind);
    const target = landed.get(u.proposalId);
    if (u.kind === "landmark") {
      if (!target) return; // nothing this scene landed: no object to lower
      const materials: THREE.Material[] = [];
      target.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.material) materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
      });
      activeUndos.push({
        object: target,
        kind: "landmark",
        startedAt: clockMs,
        durationMs: desc.durationMs,
        reducedDurationMs: desc.reducedMotion.durationMs,
        direction: "reverse",
        materials,
        finalize: () => {
          mutationGroup.remove(target);
          disposeObject3D(target);
          landed.delete(u.proposalId);
        },
      });
      return;
    }
    if (u.kind === "path") {
      if (target && target instanceof THREE.Line) {
        const points = (target.geometry.getAttribute("position") as THREE.BufferAttribute).count;
        activeUndos.push({
          object: target,
          kind: "path",
          startedAt: clockMs,
          durationMs: desc.durationMs,
          reducedDurationMs: desc.reducedMotion.durationMs,
          direction: "reverse",
          materials: [],
          points,
          finalize: () => {
            mutationGroup.remove(target);
            disposeObject3D(target);
            landed.delete(u.proposalId);
          },
        });
        return;
      }
      // Layout-native path: rebuild the shared line without the undone
      // edge, then un-draw an overlay of the same line so the removal
      // reads as one continuous motion, never a cut.
      const edge =
        u.fromNodeId !== undefined && u.toNodeId !== undefined
          ? layout.paths.find(
              (p) =>
                (p.fromNodeId === u.fromNodeId && p.toNodeId === u.toNodeId) ||
                (p.fromNodeId === u.toNodeId && p.toNodeId === u.fromNodeId),
            )
          : undefined;
      if (!edge || !u.from || !u.to) return;
      rebuildSharedPaths(edge.edgeId);
      const { geometry, points } = sampledLine(u.from, u.to, 32);
      const mat = new THREE.LineBasicMaterial({ color: DAWN_GOLD, transparent: true, opacity: 0.7 });
      const overlay = new THREE.Line(geometry, mat);
      overlay.name = `undo-${u.proposalId}`;
      mutationGroup.add(overlay);
      activeUndos.push({
        object: overlay,
        kind: "path",
        startedAt: clockMs,
        durationMs: desc.durationMs,
        reducedDurationMs: desc.reducedMotion.durationMs,
        direction: "reverse",
        materials: [mat],
        points,
        finalize: () => {
          mutationGroup.remove(overlay);
          disposeObject3D(overlay);
        },
      });
      return;
    }
    // Other/anchor: fade the landed marker out, then remove it.
    if (!target) return;
    const materials: THREE.Material[] = [];
    target.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.material) materials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
    });
    activeUndos.push({
      object: target,
      kind: "other",
      startedAt: clockMs,
      durationMs: desc.durationMs,
      reducedDurationMs: desc.reducedMotion.durationMs,
      direction: "reverse",
      materials,
      finalize: () => {
        mutationGroup.remove(target);
        disposeObject3D(target);
        landed.delete(u.proposalId);
      },
    });
  };

  const setMutation = (input: GardenMutationInput): void => {
    if (disposed) return;
    warmthTarget = clampWarmth(input.warmth);
    warmthSeen = true;
    // Previews reconcile by proposal id: new ones appear (already in
    // place — A23 has no entrance animation), gone ones fade out plainly.
    const nextIds = new Set(input.previews.map((p) => p.proposalId));
    for (const [id, entry] of [...previews]) {
      if (!nextIds.has(id)) {
        previews.delete(id);
        // Stays in the group while it fades — the update loop removes
        // it once the plain fade finishes.
        fadingPreviews.push({ entry, startedAt: clockMs });
      }
    }
    for (const p of input.previews) {
      if (previews.has(p.proposalId)) continue;
      const entry = p.kind === "landmark" ? buildPreviewLandmark(p) : buildPreviewPath(p);
      if (!entry) continue; // unresolvable position: never invented
      previews.set(p.proposalId, entry);
      mutationGroup.add(entry.object);
    }
    for (const l of input.landings) startLanding(l);
    for (const u of input.undos) startUndo(u);
  };

  const skipAnimations = (): void => {
    if (activeLanding) finishMotion(activeLanding);
    for (const undo of [...activeUndos]) finishMotion(undo);
    for (const { entry } of fadingPreviews) {
      mutationGroup.remove(entry.object);
      disposeObject3D(entry.object);
    }
    fadingPreviews.length = 0;
  };

  // An initial mutation state lands exactly like a pushed one — the
  // scene starts from it and lerps, never jumps.
  if (initialMutation) setMutation(initialMutation);

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed) return;
      const rm = !!opts?.reducedMotion;
      const dt = lastElapsedMs === null ? 0 : Math.max(0, elapsedMs - lastElapsedMs);
      lastElapsedMs = elapsedMs;
      clockMs = elapsedMs;

      // A8: the warmth lerp runs under reduced motion too — color
      // information is never removed, only the particle drift is.
      if (warmthSeen) {
        const rate = 1 - Math.exp(-dt / 4000);
        warmthCurrent += (warmthTarget - warmthCurrent) * rate;
        if (Math.abs(warmthTarget - warmthCurrent) < 0.001) warmthCurrent = warmthTarget;
        const colors = warmthColors(warmthCurrent);
        key.color.setHex(colors.keyLight);
        ambient.color.setHex(colors.ambient);
        mistMat.color.setHex(colors.mist);
      }

      if (!rm) {
        const sway = Math.sin(elapsedMs * 0.0004) * 0.012;
        for (const obj of swaying) {
          if (obj.name.startsWith("mist-")) {
            obj.position.x = Math.sin(elapsedMs * 0.00006 + obj.position.z) * 40;
          } else {
            obj.rotation.z = sway;
          }
        }
        // Seed pods drift up and down, each on its own phase (still under reduced motion).
        const podMesh = pods.mesh;
        if (podMesh) {
          pods.base.forEach((b, i) => {
            podMatrix.makeTranslation(b.x, b.y + Math.sin(elapsedMs * 0.0012 + i * 1.7) * 3, b.z);
            podMesh.setMatrixAt(i, podMatrix);
          });
          podMesh.instanceMatrix.needsUpdate = true;
        }
      }

      // A23: the provisional shimmer pulses slowly and calmly; under
      // reduced motion it holds still at the same opacity.
      for (const entry of previews.values()) {
        const opacity = rm ? 0.45 : 0.45 + 0.1 * Math.sin(elapsedMs * 0.001);
        setMaterialsOpacity(entry.materials, opacity);
      }
      // Rejected previews fade out plainly, then leave.
      for (let i = fadingPreviews.length - 1; i >= 0; i--) {
        const fading = fadingPreviews[i]!;
        const p = Math.min(1, (elapsedMs - fading.startedAt) / 600);
        setMaterialsOpacity(fading.entry.materials, 0.45 * (1 - p));
        if (p >= 1) {
          mutationGroup.remove(fading.entry.object);
          disposeObject3D(fading.entry.object);
          fadingPreviews.splice(i, 1);
        }
      }

      // Landings and undos: one progress per motion, eased; reduced
      // motion uses the shorter fade durations from the inventory.
      const stepMotion = (motion: ActiveMotion) => {
        const duration = rm ? motion.reducedDurationMs : motion.durationMs;
        const p = duration === 0 ? 1 : Math.min(1, (elapsedMs - motion.startedAt) / duration);
        if (motion.direction === "forward") {
          if (motion.kind === "landmark") {
            motion.object.scale.y = rm ? 1 : 0.05 + 0.95 * easeInOut(p);
            if (rm) setMaterialsOpacity(motion.materials, p);
            else {
              const glow = motion.materials[1];
              if (glow) setMaterialsOpacity([glow], Math.min(1, Math.max(0, (p - 0.75) / 0.25)));
            }
          } else if (motion.kind === "path") {
            const line = motion.object as THREE.Line;
            if (rm) setMaterialsOpacity(motion.materials, 0.7 * p);
            else line.geometry.setDrawRange(0, Math.round((motion.points ?? 0) * easeInOut(p)));
          } else {
            setMaterialsOpacity(motion.materials, p);
          }
        } else if (motion.kind === "landmark") {
          motion.object.scale.y = rm ? 1 : 1 - 0.95 * easeInOut(p);
          if (rm) setMaterialsOpacity(motion.materials, 1 - p);
        } else if (motion.kind === "path") {
          const line = motion.object as THREE.Line;
          if (rm) setMaterialsOpacity(motion.materials, 0.7 * (1 - p));
          else line.geometry.setDrawRange(0, Math.round((motion.points ?? 0) * (1 - easeInOut(p))));
        } else {
          setMaterialsOpacity(motion.materials, 1 - p);
        }
        if (p >= 1) finishMotion(motion);
      };
      if (activeLanding) stepMotion(activeLanding);
      for (const undo of [...activeUndos]) stepMotion(undo);
    },
    setMutation,
    skipAnimations,
    getWarmth() {
      return warmthCurrent;
    },
    getWarmthFogColor() {
      return warmthSeen ? warmthColors(warmthCurrent).fog : null;
    },
    pickTarget(ndc: { x: number; y: number }, camera: THREE.Camera): GardenPick | null {
      if (disposed) return null;
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const targets: THREE.Object3D[] = [...plotMeshes.map((p) => p.mesh), ...groundMeshes];
      if (pods.mesh) targets.push(pods.mesh);
      for (const hit of raycaster.intersectObjects(targets, false)) {
        if (hit.object === pods.mesh && hit.instanceId != null) {
          const pod = layout.pods[hit.instanceId];
          if (pod) return { kind: "pod", nodeId: pod.nodeId, x: pod.x, z: pod.z };
        }
        const entry = plotMeshes.find((p) => p.mesh === hit.object);
        if (entry && hit.instanceId != null) {
          const plot = entry.plots[hit.instanceId];
          if (plot) return { kind: "plot", nodeId: plot.nodeId, x: plot.x, z: plot.z };
        }
        if (groundMeshes.includes(hit.object)) return { kind: "ground", x: hit.point.x, z: hit.point.z };
      }
      return null;
    },
    setAvatar(x: number, y: number, z: number, heading: number) {
      avatar.visible = true;
      avatar.position.set(x, y, z);
      // Her hull's nose points down −z; heading 0 faces +z.
      avatar.rotation.y = heading + Math.PI;
    },
    pickPlot(ndc: { x: number; y: number }, camera: THREE.Camera): number | null {
      if (disposed || plotMeshes.length === 0) return null;
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const hits = raycaster.intersectObjects(
        plotMeshes.map((p) => p.mesh),
        false,
      );
      const hit = hits[0];
      if (!hit || hit.instanceId === undefined || hit.instanceId === null) return null;
      const entry = plotMeshes.find((p) => p.mesh === hit.object);
      return entry?.plots[hit.instanceId]?.nodeId ?? null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
