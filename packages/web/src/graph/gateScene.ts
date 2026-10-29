import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";

/**
 * Warp gate (Phase 2, P2-5) — the one shared gate every world plugs into.
 * A ring-and-light threshold: a torus ring, a circle of light beads, and a
 * translucent portal disc. The interaction contract is identical everywhere
 * (pass through → transit); only the dressing changes per world — ring
 * material, bead color, accent — so a gate is recognizable at a glance in
 * any world without making the worlds look identical (review 28, Q1).
 *
 * Palette grammar (Station recipe): amber = working/inhabited, cyan =
 * navigation truth only. The beads are amber; the portal shimmer is the
 * world's accent.
 *
 * Draw-call sketch: ring 1 · beads 1 (instanced) · disc 1 = 3 per gate.
 * A transit scene holds two gates (departure + arrival) = 6.
 */

export interface GateDressing {
  /** Torus ring color. */
  ring: number;
  /** Light-bead color (amber by grammar). */
  beads: number;
  /** Portal-disc accent color. */
  accent: number;
}

export const HOME_DRESSING: GateDressing = {
  ring: 0x9aa3b2,
  beads: 0xffb347,
  accent: 0x7af9ff,
};

export const GATE_DRESSINGS: Record<string, GateDressing> = {
  home: HOME_DRESSING,
  "great-station": { ring: 0x8a8f9a, beads: 0xffb347, accent: 0x7af9ff },
  "growing-place": { ring: 0xd8b36a, beads: 0xffd27a, accent: 0x8fe7c0 },
  "deep-past": { ring: 0x4a3a63, beads: 0xffd9a0, accent: 0x8a76c9 },
  people: { ring: 0x8a5a2e, beads: 0xffb347, accent: 0xffc98a },
  // Quiet/Archive (Wave 2): the low still threshold — dim slate ring,
  // amber beads (grammar), pale cyan shimmer. Quiet, never bright.
  "quiet-archive": { ring: 0x2a3442, beads: 0xffb347, accent: 0x9fd8e0 },
  scale: { ring: 0x5a6a72, beads: 0xffb347, accent: 0xffc95e },
};

/** Scale's gate silhouette (adopted EVE/NMS amendment, Rev 123): the
 *  survey frame — a clean rectangular measurement frame of thin light,
 *  like a surveyor's mark held against the dark. The gate that measures:
 *  you pass through a frame that says, plainly, how big the thing beyond
 *  it is. Same interaction contract as the ring gate (pass through →
 *  transit); only the silhouette differs, per world. */
export const SURVEY_FRAME_BEACON_COUNT = 4;

export interface SurveyFrame {
  group: THREE.Group;
  dispose: () => void;
}

/** Build Scale's survey frame at the origin, facing +Z — the caller positions it on the approach axis. */
export function buildSurveyFrame(width = 130, height = 50): SurveyFrame {
  const group = new THREE.Group();
  group.name = "gate-scale-survey-frame";
  const barMat = new THREE.MeshBasicMaterial({ color: 0x7af9ff });
  const barThickness = 0.8;
  const halfW = width / 2;
  const halfH = height / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(width, barThickness, barThickness), barMat);
  top.position.set(0, halfH, 0);
  top.name = "survey-frame-top";
  group.add(top);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(width, barThickness, barThickness), barMat);
  bottom.position.set(0, -halfH, 0);
  bottom.name = "survey-frame-bottom";
  group.add(bottom);
  const left = new THREE.Mesh(new THREE.BoxGeometry(barThickness, height, barThickness), barMat);
  left.position.set(-halfW, 0, 0);
  left.name = "survey-frame-left";
  group.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(barThickness, height, barThickness), barMat);
  right.position.set(halfW, 0, 0);
  right.name = "survey-frame-right";
  group.add(right);
  // Corner beacons (amber by grammar — working light, not navigation
  // truth): four small lights so the frame reads at distance.
  const beaconGeo = new THREE.SphereGeometry(1.6, 8, 6);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, SURVEY_FRAME_BEACON_COUNT);
  beacons.name = "survey-frame-beacons";
  const dummy = new THREE.Object3D();
  const corners: [number, number][] = [
    [-halfW, halfH],
    [halfW, halfH],
    [-halfW, -halfH],
    [halfW, -halfH],
  ];
  corners.forEach(([x, y], i) => {
    dummy.position.set(x, y, 0);
    dummy.updateMatrix();
    beacons.setMatrixAt(i, dummy.matrix);
  });
  beacons.instanceMatrix.needsUpdate = true;
  group.add(beacons);

  let disposed = false;
  return {
    group,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}

export const GATE_RADIUS = 60;
export const GATE_BEAD_COUNT = 24;

export interface GateScene {
  group: THREE.Group;
  dispose: () => void;
}

export const WARP_GATE_URL = "/warp-gate.glb";

/**
 * The real warp gate model (docs/specs/muse-gate-asset-2026-10-29.md), when `public/warp-gate.glb` exists.
 * Its opening is expected to face +Z; it is centred and scaled so the opening matches the procedural gate
 * (2 × GATE_RADIUS), so every place that positions a gate keeps working. Resolves null when the file is
 * absent — the generated ring is then the gate. Loaded once and cloned per gate.
 */
let warpGateLoad: Promise<THREE.Object3D | null> | null = null;
export function loadWarpGate(): Promise<THREE.Object3D | null> {
  warpGateLoad ??= new Promise((resolve) => {
    gltfLoader().load(
      WARP_GATE_URL,
      (gltf) => {
        const root = gltf.scene;
        // As authored the iris is shut inside the bore (Muse's prep note): open the gate by hiding the iris —
        // its own named piece ("SG Iris") — and keep the event horizon ("SG Ereignishorizont") that she flies through.
        root.traverse((o) => {
          if (/iris/i.test(o.name)) o.visible = false;
        });
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const open = Math.max(size.x, size.y);
        if (!(open > 0)) return resolve(null);
        const k = (GATE_RADIUS * 2) / open;
        const center = box.getCenter(new THREE.Vector3());
        // Every gate clones this model, so its geometry and textures are shared (disposeObject3D leaves
        // `userData.shared` resources alone); each clone gets its own materials.
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.userData.shared = true;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).userData.shared = true;
          }
        });
        const holder = new THREE.Group();
        root.scale.setScalar(k);
        root.position.set(-center.x * k, -center.y * k, -center.z * k);
        holder.add(root);
        resolve(holder);
      },
      undefined,
      () => {
        noteModelFallback("warp-gate.glb");
        resolve(null);
      },
    );
  });
  return warpGateLoad;
}

/** Build one gate, dressed for `worldKey` (falls back to the home dressing). */
export function buildGate(worldKey: string): GateScene {
  const dressing = GATE_DRESSINGS[worldKey] ?? HOME_DRESSING;
  const group = new THREE.Group();
  group.name = `gate-${worldKey}`;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(GATE_RADIUS, 3, 12, 48),
    new THREE.MeshStandardMaterial({ color: dressing.ring, metalness: 0.6, roughness: 0.45 }),
  );
  ring.name = "gate-ring";
  group.add(ring);

  const beadGeo = new THREE.SphereGeometry(1.6, 8, 6);
  const beadMat = new THREE.MeshBasicMaterial({ color: dressing.beads });
  const beads = new THREE.InstancedMesh(beadGeo, beadMat, GATE_BEAD_COUNT);
  beads.name = "gate-beads";
  const dummy = new THREE.Object3D();
  for (let i = 0; i < GATE_BEAD_COUNT; i++) {
    const a = (i / GATE_BEAD_COUNT) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * GATE_RADIUS, Math.sin(a) * GATE_RADIUS, 0);
    dummy.updateMatrix();
    beads.setMatrixAt(i, dummy.matrix);
  }
  beads.instanceMatrix.needsUpdate = true;
  group.add(beads);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(GATE_RADIUS - 2, 48),
    new THREE.MeshBasicMaterial({
      color: dressing.accent,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    }),
  );
  disc.name = "gate-disc";
  group.add(disc);

  let disposed = false;
  // The real model replaces the generated ring the moment it is available (instantly when preloaded).
  void loadWarpGate().then((model) => {
    if (!model || disposed) return;
    for (const name of ["gate-ring", "gate-beads", "gate-disc"]) {
      const part = group.getObjectByName(name);
      if (part) {
        group.remove(part);
        disposeObject3D(part);
      }
    }
    const hull = model.clone(true);
    hull.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    });
    hull.name = "gate-model";
    group.add(hull);
  });
  return {
    group,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
