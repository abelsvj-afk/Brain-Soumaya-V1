import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { PEOPLE_BACKDROP_PLANETS, PEOPLE_FORMS, PEOPLE_HEARTH, PEOPLE_PALETTE, loadPeopleAsset } from "./peopleAssets.js";
import { placeWorldRelics } from "./relicAssets.js";
import {
  PEOPLE_FIELD_RADIUS,
  PEOPLE_SEED,
  type PeopleLayout,
  type PeopleLightForm,
} from "./peopleLayout.js";

/**
 * People scene (Phase 3, P3-3) — renders exactly what peopleLayout returns,
 * nothing more. The host owns the renderer, camera, and fog (palette-matched
 * FogExp2 in warm dark, per the settled stack); this module owns the field
 * group and its per-frame motion.
 *
 * The recipe's grammar: a warm field of clusters, like lights in a
 * neighborhood at dusk. Each cluster is a warm hearth with its
 * memory-lights in slow orbit; bridges of light join clusters that share
 * a memory. The field is walked among, not flown through at speed — the
 * camera arrives at the field's edge and the clusters open outward.
 * Baked glow only — no bloom, no post-processing. The ground is finished
 * in every direction the camera can reach (C9): a warm dark disc with a
 * faint outer ring, and nothing beyond it to fall into.
 *
 * Draw-call sketch (recipe ceiling 80): ground 1 · ground ring 1 ·
 * hearths 1 · hearth glows 1 · lights ≤4 (one instanced mesh per form) ·
 * bridges 1 · HYG sky 1 · motes 1 · ships 1 = ≤12. Runtime measurement
 * belongs to the device check (C4's measured half); these constants are
 * the static half.
 *
 * Kindness is structural here: the scene has no state for decline. Every
 * cluster carries the same light; a quiet cluster is a resting person,
 * never a neglected one. An empty layout renders the field, the ground,
 * and the sky — honest resting ground, never a locked door. Reduced
 * motion holds the field: no light orbit, no mote rise, no ship drift.
 *
 * No faces, no figures, no silhouettes: a cluster's presence is a
 * hearth-glow, never a body. No NPC people ever stand in this space.
 */

export interface PeopleScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

export const EMPTY_PEOPLE_LAYOUT: PeopleLayout = {
  clusters: [],
  bridges: [],
  eligibleCount: 0,
  excludedCount: 0,
  omittedEdgeCount: 0,
  gateOpen: false,
};

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

interface LightOrbit {
  mesh: THREE.InstancedMesh;
  index: number;
  centerX: number;
  centerZ: number;
  radius: number;
  angle0: number;
  y: number;
  speed: number;
  /** Date and gathering rings lie flat; memory spheres and thread cones stand. */
  flat: boolean;
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

const FORM_GEOMETRY: Record<PeopleLightForm, () => THREE.BufferGeometry> = {
  memory: () => new THREE.SphereGeometry(PEOPLE_FORMS.memory.radius, 8, 6),
  date: () => new THREE.TorusGeometry(PEOPLE_FORMS.date.radius, 0.9, 6, 10),
  thread: () => new THREE.ConeGeometry(PEOPLE_FORMS.thread.radius, 6, 5),
  gathering: () => new THREE.TorusGeometry(PEOPLE_FORMS.gathering.radius, 1, 6, 12),
};

export function createPeopleScene(
  layout: PeopleLayout,
  opts: { onRelicVisible?: (slug: string) => void } = {},
): PeopleScene {
  const group = new THREE.Group();
  group.name = "people";
  let disposed = false;
  const dummy = new THREE.Object3D();
  const glowTex = makeGlowTexture();
  const clusters = layout.clusters;

  // Relics (relics increment): the Hearth Ember rests at the field's
  // heart, the Thread of Many at its edge — fixed spots, never tied to
  // one person's cluster (the non-ranking rule). A relic whose GLB has
  // not landed is simply absent — no stand-in, and its find is never
  // offered (the host learns of it via onRelicVisible).
  const cancelRelics = placeWorldRelics(group, "people", opts.onRelicVisible);

  // The ground: warm dark, finished in every direction the camera can
  // reach — a neighborhood at dusk, not a void with lights pasted on it.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(PEOPLE_FIELD_RADIUS + 40, 48),
    new THREE.MeshStandardMaterial({ color: PEOPLE_PALETTE.ground, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  ground.name = "field-ground";
  group.add(ground);
  const groundRing = new THREE.Mesh(
    new THREE.RingGeometry(PEOPLE_FIELD_RADIUS + 38, PEOPLE_FIELD_RADIUS + 42, 48),
    new THREE.MeshBasicMaterial({ color: PEOPLE_PALETTE.memory, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.y = -0.5;
  groundRing.name = "field-ring";
  group.add(groundRing);

  // Hearths: one warm central presence per person — the same form, the
  // same light, for every cluster. No cluster is larger or brighter.
  const orbits: LightOrbit[] = [];
  if (clusters.length > 0) {
    const hearthGeo = new THREE.SphereGeometry(PEOPLE_HEARTH.radius, 12, 8);
    const hearthMat = new THREE.MeshStandardMaterial({
      color: PEOPLE_PALETTE.hearth,
      emissive: PEOPLE_PALETTE.hearth,
      emissiveIntensity: 0.55,
      roughness: 0.7,
      metalness: 0,
    });
    const hearths = new THREE.InstancedMesh(hearthGeo, hearthMat, clusters.length);
    clusters.forEach((c, i) => {
      dummy.position.set(c.x, c.y + 6, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hearths.setMatrixAt(i, dummy.matrix);
    });
    hearths.name = "cluster-hearths";
    group.add(hearths);

    const hearthPositions = new Float32Array(clusters.length * 3);
    clusters.forEach((c, i) => {
      hearthPositions[i * 3] = c.x;
      hearthPositions[i * 3 + 1] = c.y + 8;
      hearthPositions[i * 3 + 2] = c.z;
    });
    const hearthGlowGeo = new THREE.BufferGeometry();
    hearthGlowGeo.setAttribute("position", new THREE.BufferAttribute(hearthPositions, 3));
    const hearthGlows = new THREE.Points(
      hearthGlowGeo,
      new THREE.PointsMaterial({
        size: 46,
        sizeAttenuation: true,
        map: glowTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    hearthGlows.name = "cluster-glows";
    group.add(hearthGlows);
  }

  // Memory-lights: one instanced mesh per form. Form says what kind of
  // thing a light is — never how much it matters. The lights orbit their
  // hearth slowly; the orbit is presentation, the layout is the truth.
  const byForm: Record<PeopleLightForm, { nodeId: number; x: number; y: number; z: number; centerX: number; centerZ: number }[]> = {
    memory: [],
    thread: [],
    date: [],
    gathering: [],
  };
  for (const cluster of clusters) {
    for (const light of cluster.lights) {
      byForm[light.form].push({
        nodeId: light.nodeId,
        x: light.x,
        y: light.y,
        z: light.z,
        centerX: cluster.x,
        centerZ: cluster.z,
      });
    }
  }
  const formColors: Record<PeopleLightForm, number> = {
    memory: PEOPLE_PALETTE.memory,
    thread: PEOPLE_PALETTE.thread,
    date: PEOPLE_PALETTE.date,
    gathering: PEOPLE_PALETTE.gathering,
  };
  const formNames: Record<PeopleLightForm, string> = {
    memory: "lights-memory",
    thread: "lights-thread",
    date: "lights-date",
    gathering: "lights-gathering",
  };
  for (const form of ["memory", "thread", "date", "gathering"] as const) {
    const list = byForm[form];
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(
      FORM_GEOMETRY[form](),
      new THREE.MeshStandardMaterial({ color: formColors[form], roughness: 0.6, metalness: 0.1 }),
      list.length,
    );
    list.forEach((light, i) => {
      const radius = Math.hypot(light.x - light.centerX, light.z - light.centerZ);
      const angle0 = Math.atan2(light.z - light.centerZ, light.x - light.centerX);
      const speedRand = mulberry32(hashSeeded(`${PEOPLE_SEED}:speed:${light.nodeId}`));
      orbits.push({
        mesh,
        index: i,
        centerX: light.centerX,
        centerZ: light.centerZ,
        radius: Math.max(radius, 4),
        angle0,
        y: light.y,
        speed: 0.00002 + speedRand() * 0.00002,
        flat: form === "date" || form === "gathering",
      });
      dummy.position.set(light.x, light.y, light.z);
      dummy.rotation.set(form === "date" || form === "gathering" ? Math.PI / 2 : 0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.name = formNames[form];
    group.add(mesh);
  }

  // Bridges of light: a shared memory joins two clusters. A person with
  // no bridges stands alone, honestly — the field never draws a bridge
  // to an invented endpoint.
  if (layout.bridges.length > 0) {
    const byPerson = new Map(clusters.map((c) => [c.personId, c]));
    const positions: number[] = [];
    for (const bridge of layout.bridges) {
      const from = byPerson.get(bridge.fromPersonId);
      const to = byPerson.get(bridge.toPersonId);
      if (!from || !to) continue; // layout guarantees both; defense in depth
      positions.push(from.x, from.y + 6, from.z, to.x, to.y + 6, to.z);
    }
    if (positions.length > 0) {
      const bridgeGeo = new THREE.BufferGeometry();
      bridgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      const bridges = new THREE.LineSegments(
        bridgeGeo,
        new THREE.LineBasicMaterial({ color: PEOPLE_PALETTE.bridge, transparent: true, opacity: 0.7 }),
      );
      bridges.name = "bridges";
      group.add(bridges);
    }
  }

  // Warm motes: the air above the field, slow and low — atmosphere, never fact.
  const moteCount = 400;
  const moteRand = mulberry32(hashSeeded(`${PEOPLE_SEED}:motes`));
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    const angle = moteRand() * Math.PI * 2;
    const radius = moteRand() * PEOPLE_FIELD_RADIUS;
    motePositions[i * 3] = Math.cos(angle) * radius;
    motePositions[i * 3 + 1] = 2 + moteRand() * 60;
    motePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ size: 2.5, color: PEOPLE_PALETTE.motes, transparent: true, opacity: 0.5, sizeAttenuation: true }),
  );
  motes.name = "ember-motes";
  group.add(motes);

  // The faintest HYG points far above the field — the same real data as
  // the Station's and the garden's, dimmed: the field is low and near,
  // the sky is not its subject.
  const stars = buildHygStarfield();
  const starMat = stars.material as THREE.PointsMaterial;
  starMat.transparent = true;
  starMat.opacity = 0.2;
  group.add(stars);

  // Distant backdrop planets (EVE-style, 2026-10-27): Earth and Moon —
  // home, far away — and a Quaternius planet, 4,000 units out at ~7°
  // elevation, ~180° apart. The slow orbit never brings the camera
  // closer than ~3,300, so they loom and never arrive. Loaded as-is;
  // a holder stays empty until its GLB lands.
  for (const planet of PEOPLE_BACKDROP_PLANETS) {
    const holder = new THREE.Group();
    holder.name = `backdrop-${planet.key}`;
    holder.position.set(
      Math.cos(planet.angle) * planet.distance,
      planet.y,
      Math.sin(planet.angle) * planet.distance,
    );
    group.add(holder);
    void loadPeopleAsset(planet.url).then((loaded) => {
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

  // Amber-warm light on dark: the hearths do the warming; the ambient is
  // low and calm, one warm point light holds the field's center.
  group.add(new THREE.AmbientLight(0xffd9a0, 0.85));
  const hearthLight = new THREE.PointLight(0xffc98a, 2.0, 700);
  hearthLight.position.set(0, 60, 0);
  group.add(hearthLight);

  // Ships as set dressing (P3-2 precedent): a few small silent procedural
  // hulls drifting outside the clusters — slow drift, no interaction, no
  // progression. No other traveler's ship ever enters People (Q5).
  const shipRand = mulberry32(hashSeeded(`${PEOPLE_SEED}:ships`));
  const shipSpecs = [0, 1, 2].map(() => {
    const angle = shipRand() * Math.PI * 2;
    return {
      angle,
      radius: PEOPLE_FIELD_RADIUS + 60 + shipRand() * 80,
      y: 40 + shipRand() * 40,
      speed: 0.00002 + shipRand() * 0.00001,
    };
  });
  const shipGeo = new THREE.OctahedronGeometry(5);
  shipGeo.scale(1, 0.45, 2.4);
  const ships = new THREE.InstancedMesh(
    shipGeo,
    new THREE.MeshStandardMaterial({ color: 0xd8c4a6, roughness: 0.5, metalness: 0.3 }),
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
      // Memory-lights orbit their hearths, slowly — the orbit is the
      // field's own breathing, never a signal of activity.
      for (const orbit of orbits) {
        const a = orbit.angle0 + elapsedMs * orbit.speed;
        dummy.position.set(
          orbit.centerX + Math.cos(a) * orbit.radius,
          orbit.y,
          orbit.centerZ + Math.sin(a) * orbit.radius,
        );
        dummy.rotation.set(orbit.flat ? Math.PI / 2 : 0, 0, 0);
        dummy.updateMatrix();
        orbit.mesh.setMatrixAt(orbit.index, dummy.matrix);
      }
      for (const orbit of new Set(orbits.map((o) => o.mesh))) {
        orbit.instanceMatrix.needsUpdate = true;
      }
      // Ember motes rise slowly and wrap back to the ground.
      const pos = moteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < moteCount; i++) {
        let y = pos.getY(i) + dt * 0.0012;
        if (y > 62) y = 2;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      // Dressing ships drift their slow circles outside the clusters.
      shipSpecs.forEach((spec, i) => ships.setMatrixAt(i, placeShip(spec, elapsedMs)));
      ships.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
