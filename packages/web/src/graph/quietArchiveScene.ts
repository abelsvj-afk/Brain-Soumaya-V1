import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { QUIET_ARCHIVE_FORMS, QUIET_ARCHIVE_PALETTE, QUIET_ARCHIVE_SEED } from "./quietArchiveAssets.js";
import {
  QUIET_ARCHIVE_EMPTY_FIELD_RADIUS,
  type QuietArchiveLayout,
  type QuietArchiveLightForm,
} from "./quietArchiveLayout.js";

/**
 * Quiet/Archive scene (Phase 3, Wave 2) — renders exactly what
 * quietArchiveLayout returns, nothing more. The host owns the renderer,
 * camera, and fog (palette-matched FogExp2 in dim cool dark, per the
 * settled stack); this module owns the field group and its per-frame motion.
 *
 * The recipe's grammar: a still field of resting lamps, low and even in
 * light, nothing moving fast. Each archived person's cluster is a small
 * steady lamp with its archived memories resting around it; a lone
 * archived memory is a lamp of its own. The low still threshold stands
 * at the field's edge by the arrival side — a quiet doorway of dim light,
 * low and wide, passed through without ceremony. Baked glow only — no
 * bloom, no post-processing. The ground is finished in every direction
 * the camera can reach (C9): a dim cool disc with a faint outer ring,
 * and nothing beyond it to fall into.
 *
 * Draw-call sketch (recipe ceiling 60): ground 1 · ground ring 1 ·
 * threshold 3 · lamps 1 · lamp glows 1 · lights ≤4 (one instanced mesh
 * per form) · bridges 1 · motes 1 · HYG sky 1 = ≤14. Runtime measurement
 * belongs to the device check (C4's measured half); these constants are
 * the static half.
 *
 * Rest is structural here: the scene has no state for decline. Every
 * lamp carries the same light; a quiet cluster is a resting person,
 * never a neglected one. An empty layout renders the field, the ground,
 * the threshold, and the sky — honest resting ground, never a locked
 * door. Reduced motion holds the field: no mote rise, no lamp breathing.
 * No relic meshes: the relic spots are coordinates in the layout, not
 * objects in this scene (see quietArchiveAssets.ts).
 *
 * No faces, no figures, no silhouettes: a cluster's presence is a
 * lamp-glow, never a body. No NPCs here — no keeper, no guide. A resting
 * place keeps its own counsel.
 */

export interface QuietArchiveScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

export const EMPTY_QUIET_ARCHIVE_LAYOUT: QuietArchiveLayout = {
  clusters: [],
  loneLights: [],
  bridges: [],
  relicSpots: [
    {
      id: "stillness-seal",
      x: 0,
      y: 0,
      z: 0,
      place: "at the threshold of a quiet alcove",
      glimmer: "at the threshold of a quiet alcove",
    },
    {
      id: "unopened-fold",
      x: 0,
      y: 0,
      z: 0,
      place: "kept in the Archive, unopened",
      glimmer: "kept in the Archive, unopened",
    },
  ],
  fieldRadius: QUIET_ARCHIVE_EMPTY_FIELD_RADIUS,
  archivedCount: 0,
  omittedEdgeCount: 0,
};

/** A soft low lamplight glow, computed as bytes — no canvas, so it builds in tests too. */
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
      data[i] = 216;
      data[i + 1] = 201;
      data[i + 2] = 163;
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

const FORM_GEOMETRY: Record<QuietArchiveLightForm, () => THREE.BufferGeometry> = {
  memory: () => new THREE.SphereGeometry(QUIET_ARCHIVE_FORMS.memory.radius, 8, 6),
  date: () => new THREE.TorusGeometry(QUIET_ARCHIVE_FORMS.date.radius, 0.9, 6, 10),
  thread: () => new THREE.ConeGeometry(QUIET_ARCHIVE_FORMS.thread.radius, 6, 5),
  gathering: () => new THREE.TorusGeometry(QUIET_ARCHIVE_FORMS.gathering.radius, 1, 6, 12),
};

export function createQuietArchiveScene(layout: QuietArchiveLayout): QuietArchiveScene {
  const group = new THREE.Group();
  group.name = "quiet-archive";
  let disposed = false;
  const dummy = new THREE.Object3D();
  const glowTex = makeGlowTexture();
  const clusters = layout.clusters;
  const fieldRadius = layout.fieldRadius;

  // The ground: dim cool stone, finished in every direction the camera
  // can reach — a still field at night, not a void with lamps pasted on it.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(fieldRadius + 40, 48),
    new THREE.MeshStandardMaterial({ color: QUIET_ARCHIVE_PALETTE.ground, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  ground.name = "field-ground";
  group.add(ground);
  const groundRing = new THREE.Mesh(
    new THREE.RingGeometry(fieldRadius + 38, fieldRadius + 42, 48),
    new THREE.MeshBasicMaterial({ color: QUIET_ARCHIVE_PALETTE.memory, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.y = -0.5;
  groundRing.name = "field-ring";
  group.add(groundRing);

  // The low still threshold (adopted amendment, Rev 123): a quiet doorway
  // of dim light, low and wide, at the field's edge by the arrival side.
  // No fanfare, no kindling, no reveal — you pass through without ceremony.
  const thresholdAngle = 0.6;
  const threshold = new THREE.Group();
  threshold.name = "still-threshold";
  threshold.position.set(
    Math.cos(thresholdAngle) * (fieldRadius + 10),
    0,
    Math.sin(thresholdAngle) * (fieldRadius + 10),
  );
  threshold.rotation.y = -thresholdAngle;
  const postGeo = new THREE.BoxGeometry(4, 26, 4);
  const postMat = new THREE.MeshStandardMaterial({ color: QUIET_ARCHIVE_PALETTE.thresholdPost, roughness: 0.9, metalness: 0.1 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * 58, 13, 0);
    post.name = `threshold-post-${side < 0 ? "left" : "right"}`;
    threshold.add(post);
  }
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(120, 5, 4),
    new THREE.MeshStandardMaterial({
      color: QUIET_ARCHIVE_PALETTE.thresholdPost,
      emissive: QUIET_ARCHIVE_PALETTE.thresholdLight,
      emissiveIntensity: 0.35,
      roughness: 0.9,
      metalness: 0.1,
    }),
  );
  lintel.position.set(0, 28, 0);
  lintel.name = "threshold-lintel";
  threshold.add(lintel);
  group.add(threshold);

  // Lamps: one small steady lamp per archived person — the same form, the
  // same light, for every cluster. No cluster is larger or brighter.
  let lampGlows: THREE.Points | null = null;
  if (clusters.length > 0) {
    const lampGeo = new THREE.SphereGeometry(5, 12, 8);
    const lampMat = new THREE.MeshStandardMaterial({
      color: QUIET_ARCHIVE_PALETTE.lamp,
      emissive: QUIET_ARCHIVE_PALETTE.lamp,
      emissiveIntensity: 0.5,
      roughness: 0.7,
      metalness: 0,
    });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, clusters.length);
    clusters.forEach((c, i) => {
      dummy.position.set(c.x, c.y + 6, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
    });
    lamps.name = "cluster-lamps";
    group.add(lamps);

    const lampPositions = new Float32Array(clusters.length * 3);
    clusters.forEach((c, i) => {
      lampPositions[i * 3] = c.x;
      lampPositions[i * 3 + 1] = c.y + 8;
      lampPositions[i * 3 + 2] = c.z;
    });
    const lampGlowGeo = new THREE.BufferGeometry();
    lampGlowGeo.setAttribute("position", new THREE.BufferAttribute(lampPositions, 3));
    lampGlows = new THREE.Points(
      lampGlowGeo,
      new THREE.PointsMaterial({
        size: 40,
        sizeAttenuation: true,
        map: glowTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    lampGlows.name = "cluster-glows";
    group.add(lampGlows);
  }

  // Archived-memory lights: one instanced mesh per form. Form says what
  // kind of thing a light is — never how much it matters. Lone lights
  // rest in the same meshes: a memory with no person is still a lamp.
  const byForm: Record<QuietArchiveLightForm, { nodeId: number; x: number; y: number; z: number }[]> = {
    memory: [],
    thread: [],
    date: [],
    gathering: [],
  };
  for (const cluster of clusters) {
    for (const light of cluster.lights) {
      byForm[light.form].push({ nodeId: light.nodeId, x: light.x, y: light.y, z: light.z });
    }
  }
  for (const light of layout.loneLights) {
    byForm[light.form].push({ nodeId: light.nodeId, x: light.x, y: light.y, z: light.z });
  }
  const formColors: Record<QuietArchiveLightForm, number> = {
    memory: QUIET_ARCHIVE_PALETTE.memory,
    thread: QUIET_ARCHIVE_PALETTE.thread,
    date: QUIET_ARCHIVE_PALETTE.date,
    gathering: QUIET_ARCHIVE_PALETTE.gathering,
  };
  const formNames: Record<QuietArchiveLightForm, string> = {
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
      dummy.position.set(light.x, light.y, light.z);
      dummy.rotation.set(form === "date" || form === "gathering" ? Math.PI / 2 : 0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.name = formNames[form];
    group.add(mesh);
  }

  // Bridges of light: a shared archived memory joins two clusters. A
  // person with no bridges rests alone, honestly — the field never draws
  // a bridge to an invented endpoint.
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
        new THREE.LineBasicMaterial({ color: QUIET_ARCHIVE_PALETTE.bridge, transparent: true, opacity: 0.6 }),
      );
      bridges.name = "bridges";
      group.add(bridges);
    }
  }

  // Faint cool motes: the air above the field, barely there — atmosphere,
  // never fact. They rise slowly and wrap back to the ground.
  const moteCount = 300;
  const moteRand = mulberry32(hashSeeded(`${QUIET_ARCHIVE_SEED}:motes`));
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    const angle = moteRand() * Math.PI * 2;
    const radius = moteRand() * fieldRadius;
    motePositions[i * 3] = Math.cos(angle) * radius;
    motePositions[i * 3 + 1] = 2 + moteRand() * 50;
    motePositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ size: 2, color: QUIET_ARCHIVE_PALETTE.motes, transparent: true, opacity: 0.35, sizeAttenuation: true }),
  );
  motes.name = "still-motes";
  group.add(motes);

  // The faintest HYG points far above the field — the same real data as
  // the Station's and the garden's, dimmed further: the field is low and
  // near, the sky is not its subject, and the night here is quiet.
  const stars = buildHygStarfield();
  const starMat = stars.material as THREE.PointsMaterial;
  starMat.transparent = true;
  starMat.opacity = 0.15;
  group.add(stars);

  // Dim cool light, low and even: the lamps do the warming; the ambient
  // is low and calm, one cool point light holds the field's center.
  group.add(new THREE.AmbientLight(0x8fa3b8, 0.7));
  const fieldLight = new THREE.PointLight(0xb8c9d8, 1.6, 700);
  fieldLight.position.set(0, 60, 0);
  group.add(fieldLight);

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
      // The field breathes, barely (A-Q1): the lamp glow swells almost
      // imperceptibly, and the motes rise slowly. Nothing here hurries.
      if (lampGlows) {
        const mat = lampGlows.material as THREE.PointsMaterial;
        mat.opacity = 0.85 + Math.sin(elapsedMs * 0.00004) * 0.05;
      }
      const pos = moteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < moteCount; i++) {
        let y = pos.getY(i) + dt * 0.0008;
        if (y > 52) y = 2;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
