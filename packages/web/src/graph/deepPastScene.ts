import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { placeWorldRelics } from "./relicAssets.js";
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
 * shelf 1 + shelf glow 1 · ships 1 = ~34. Runtime measurement belongs to the
 * device check (C4's measured half); these constants are the static half.
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
  const basinFloor = new THREE.Mesh(
    new THREE.CircleGeometry(DEEP_PAST_BASIN_RADIUS, 48),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85, metalness: 0 }),
  );
  basinFloor.rotation.x = -Math.PI / 2;
  basinFloor.position.y = DEEP_PAST_BASIN_Y;
  basinFloor.name = "basin-floor";
  group.add(basinFloor);
  const basinRing = new THREE.Mesh(
    new THREE.TorusGeometry(DEEP_PAST_BASIN_RADIUS, 1.1, 8, 48),
    new THREE.MeshBasicMaterial({ color: LANTERN }),
  );
  basinRing.rotation.x = Math.PI / 2;
  basinRing.position.y = DEEP_PAST_BASIN_Y + 0.6;
  basinRing.name = "basin-rim";
  group.add(basinRing);
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
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
