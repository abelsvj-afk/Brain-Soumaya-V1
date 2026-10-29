import * as THREE from "three";

/**
 * Eternity's presence in a sky (docs/specs/eternity-autonomy-2026-10-29.md §2d): never his body — a vast, faint arc of
 * his halo at the edge of the heavens, the same whitish-gold as the halo in his own world. It burns brighter on a day his
 * loop acted in this brain. Additive, no depth write, no fog, no lights: one draw call. Reduced motion: it holds still.
 */
export interface EternityHalo {
  group: THREE.Group;
  /** 0..1 — faint presence (0.35) to a day he acted (1). */
  setIntensity: (k: number) => void;
  update: (tSeconds: number, reducedMotion?: boolean) => void;
  dispose: () => void;
}

export const HALO_GOLD = 0xffe7a8;

export function buildEternityHalo(radius: number, distance: number): EternityHalo {
  const group = new THREE.Group();
  group.name = "eternity-halo";
  // A partial ring, tilted, high in the sky ahead: an arc you notice, not a hoop around the scene.
  const geo = new THREE.TorusGeometry(radius, radius * 0.012, 8, 160, Math.PI * 1.25);
  const mat = new THREE.MeshBasicMaterial({
    color: HALO_GOLD,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const arc = new THREE.Mesh(geo, mat);
  arc.name = "eternity-halo-arc";
  arc.frustumCulled = false;
  arc.renderOrder = -5;
  group.add(arc);
  group.position.set(0, distance * 0.42, -distance * 0.9);
  group.lookAt(0, 0, 0);
  arc.rotation.z = -Math.PI * 0.12;
  let intensity = 0.35;
  return {
    group,
    setIntensity(k) {
      intensity = Math.max(0, Math.min(1, k));
      mat.opacity = 0.08 + 0.32 * intensity;
    },
    update(t, reducedMotion) {
      if (reducedMotion) return;
      // A slow breath, never a flicker: ±12 % over ~20 s.
      mat.opacity = (0.08 + 0.32 * intensity) * (0.88 + 0.12 * Math.sin(t * 0.3));
      arc.rotation.z = -Math.PI * 0.12 + Math.sin(t * 0.01) * 0.05;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
