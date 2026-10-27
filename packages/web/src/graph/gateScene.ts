import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";

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
};

export const GATE_RADIUS = 60;
export const GATE_BEAD_COUNT = 24;

export interface GateScene {
  group: THREE.Group;
  dispose: () => void;
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
  return {
    group,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
