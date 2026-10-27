import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { placeWorldRelics } from "./relicAssets.js";
import {
  GARDEN_TERRACE_COUNT,
  GARDEN_TERRACE_RADIUS,
  GARDEN_TERRACE_HEIGHT,
  type GardenLayout,
} from "./gardenLayout.js";

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
 * · sky 1 · mist 3. Runtime measurement belongs to the device check
 * (C4's measured half); these constants are the static half.
 *
 * Kindness is structural here: the scene has no state for decline. An
 * empty layout renders terraces, tree, and sky — honest resting ground.
 * Reduced motion holds the garden: no sway, no drifting mist.
 */

export interface GardenScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const DAWN_GOLD = 0xffd27a;
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

export function createGardenScene(
  layout: GardenLayout,
  opts: { onRelicVisible?: (slug: string) => void } = {},
): GardenScene {
  const group = new THREE.Group();
  group.name = "growing-place";
  let disposed = false;
  const swaying: THREE.Object3D[] = [];

  // Relics (relics increment): the garden's two relics rest at the witness
  // tree. A relic whose GLB has not landed is simply absent — no stand-in,
  // and its find is never offered (the host learns of it via onRelicVisible).
  const cancelRelics = placeWorldRelics(group, "growing-place", opts.onRelicVisible);

  // Terraces: one flat ring per band present, greens varied per terrace so
  // the arcs read as distinct plantings. Ring i spans radius[i+1]..radius[i].
  const presentTerraces = new Set([
    ...layout.plots.map((p) => p.terrace),
    ...layout.landmarks.map((l) => l.terrace),
  ]);
  if (presentTerraces.size === 0) presentTerraces.add(0); // empty garden still has ground
  for (const t of [...presentTerraces].sort((a, b) => a - b)) {
    const inner = t + 1 < GARDEN_TERRACE_COUNT ? GARDEN_TERRACE_RADIUS[t + 1]! : 60;
    const outer = GARDEN_TERRACE_RADIUS[t]!;
    const green = new THREE.Color().setHSL(0.33 - t * 0.012, 0.42, 0.32 + t * 0.015);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 64),
      new THREE.MeshStandardMaterial({ color: green, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = GARDEN_TERRACE_HEIGHT[t]!;
    ring.name = `terrace-${t}`;
    group.add(ring);
  }
  // Crown disc under the tree.
  const crownDisc = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshStandardMaterial({ color: 0x2e4a2a, roughness: 0.95, metalness: 0 }),
  );
  crownDisc.rotation.x = -Math.PI / 2;
  crownDisc.position.y = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]!;
  group.add(crownDisc);

  // The witness tree: a trunk you could lose a ship inside, a canopy dome
  // wide enough to shade the top terraces.
  const tree = new THREE.Group();
  tree.name = "witness-tree";
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 22, 190, 12),
    new THREE.MeshStandardMaterial({ color: SOIL, roughness: 0.9, metalness: 0 }),
  );
  trunk.position.y = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]! + 95;
  tree.add(trunk);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.9, metalness: 0 });
  const canopySpecs = [
    { r: 150, y: 250 },
    { r: 105, y: 310 },
    { r: 60, y: 355 },
  ];
  for (const spec of canopySpecs) {
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(spec.r, 1), canopyMat);
    dome.position.y = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]! + spec.y;
    tree.add(dome);
  }
  // The whole tree sways as one — a sphere alone would show nothing.
  swaying.push(tree);
  group.add(tree);

  // Vegetation: instanced, seeded across the terraces — the recipe's named
  // perf risk, instancing mandatory; density is the fallback dial.
  const vegRand = mulberry32(hashSeeded("growing-place / first-light-1:vegetation"));
  const vegCount = 600;
  const veg = new THREE.InstancedMesh(
    new THREE.ConeGeometry(3.5, 14, 5),
    new THREE.MeshStandardMaterial({ color: 0x4c7a3f, roughness: 0.9, metalness: 0 }),
    vegCount,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < vegCount; i++) {
    const terrace = Math.floor(vegRand() * GARDEN_TERRACE_COUNT);
    const angle = vegRand() * Math.PI * 2;
    const radius = GARDEN_TERRACE_RADIUS[terrace]! * (0.55 + vegRand() * 0.4);
    dummy.position.set(Math.cos(angle) * radius, GARDEN_TERRACE_HEIGHT[terrace]! + 7, Math.sin(angle) * radius);
    dummy.rotation.y = vegRand() * Math.PI * 2;
    dummy.updateMatrix();
    veg.setMatrixAt(i, dummy.matrix);
  }
  veg.name = "vegetation";
  group.add(veg);

  // Plots: one instanced mesh per form. Form says what kind of thing it is;
  // size, brightness, and color are the same across kinds (non-ranking rule).
  const stoneGeo = new THREE.DodecahedronGeometry(3.2);
  const sproutGeo = new THREE.ConeGeometry(2.6, 9, 5);
  const ringGeo = new THREE.TorusGeometry(5, 1.1, 8, 24);
  const stoneMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.8, metalness: 0.05 });
  const sproutMat = new THREE.MeshStandardMaterial({ color: 0x6fa055, roughness: 0.85, metalness: 0 });
  const ringMat = new THREE.MeshStandardMaterial({ color: DAWN_GOLD, roughness: 0.6, metalness: 0.2 });
  const byForm = {
    stone: layout.plots.filter((p) => p.kind !== "action" && !p.gathering),
    sprout: layout.plots.filter((p) => p.kind === "action"),
    ring: layout.plots.filter((p) => p.gathering),
  } as const;
  const forms = [
    { plots: byForm.stone, geo: stoneGeo, mat: stoneMat, name: "plots-stone", lift: 3 },
    { plots: byForm.sprout, geo: sproutGeo, mat: sproutMat, name: "plots-sprout", lift: 4.5 },
    { plots: byForm.ring, geo: ringGeo, mat: ringMat, name: "plots-gathering", lift: 2 },
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
    group.add(mesh);
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

  // Landmarks: presence-only arches for completed Journeys — pale stone and
  // living branch weaving upward. No rising animation here (A6, Phase 4).
  for (const landmark of layout.landmarks) {
    const arch = new THREE.Group();
    arch.name = `landmark-${landmark.journeyId}`;
    const pillarGeo = new THREE.CylinderGeometry(2.5, 3, 26, 8);
    const left = new THREE.Mesh(pillarGeo, stoneMat);
    left.position.set(-9, 13, 0);
    const right = new THREE.Mesh(pillarGeo, stoneMat);
    right.position.set(9, 13, 0);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(9, 2.2, 8, 24, Math.PI), stoneMat);
    arc.position.y = 26;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(3, 12, 8),
      new THREE.MeshBasicMaterial({ color: DAWN_GOLD }),
    );
    glow.position.y = 30;
    arch.add(left, right, arc, glow);
    arch.position.set(landmark.x, landmark.y, landmark.z);
    group.add(arch);
  }

  // Sky: the real HYG field, humbled by dawn (same data as the Station's).
  const stars = buildHygStarfield();
  const starMat = stars.material as THREE.PointsMaterial;
  starMat.transparent = true;
  starMat.opacity = 0.35;
  group.add(stars);

  // Dawn light: warm low key + soft ambient. Mist: three slow planes.
  const key = new THREE.DirectionalLight(DAWN_GOLD, 1.4);
  key.position.set(-400, 260, 300);
  group.add(key);
  group.add(new THREE.AmbientLight(0x9db8a0, 0.55));
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

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) return;
      const sway = Math.sin(elapsedMs * 0.0004) * 0.012;
      for (const obj of swaying) {
        if (obj.name.startsWith("mist-")) {
          obj.position.x = Math.sin(elapsedMs * 0.00006 + obj.position.z) * 40;
        } else {
          obj.rotation.z = sway;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
