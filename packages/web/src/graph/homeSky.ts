import * as THREE from "three";
import { makeStarfield, makeMilkyWay } from "./starfield.js";
import { makeBackdropBakeSources } from "./deepSpace.js";
import { bakeBackdrop, disposeBakedBackdrop, type BakedBackdrop } from "./backdropBake.js";
import { buildEternityHalo } from "./eternityHalo.js";

/**
 * The one sky (docs/specs/warp-consistency-2026-10-29.md). The home galaxy builds its stars, Milky Way and
 * nebula/galaxy cubemap with Math.random(), so every world that invented its own backdrop disagreed with
 * it — and with every other world. `withSkySeed` runs a builder under a fixed random sequence so the home
 * galaxy, every world and the warp draw the SAME sky.
 */
export const SKY_SEED = 0x5a0c1a;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `build` with Math.random replaced by a seeded sequence (restored even if it throws). */
export function withSkySeed<T>(build: () => T, salt = 0): T {
  const real = Math.random;
  Math.random = mulberry32(SKY_SEED + salt);
  try {
    return build();
  } finally {
    Math.random = real;
  }
}

export type SkyLevel = "low" | "medium" | "high";

export interface HomeSky {
  /** Live stars + Milky Way. Parent it to the scene; `update` keeps it centred on the camera. */
  group: THREE.Group;
  /** Keep the sky at infinity and twinkle. `yaw` turns the whole sky (the warp swings it round the ship). */
  update: (cameraPos: THREE.Vector3, t: number, yaw?: number, reducedMotion?: boolean) => void;
  dispose: () => void;
}

/**
 * Install the home sky into `scene`: baked nebulae as `scene.background`, live stars + Milky Way as a
 * camera-following group. Fog never touches a background and the star shader ignores it.
 */
export function installHomeSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, level: SkyLevel = "medium"): HomeSky {
  const group = new THREE.Group();
  group.name = "home-sky";
  const stars = withSkySeed(() => makeStarfield(level === "low" ? 3000 : 4500), 1);
  const band = withSkySeed(() => makeMilkyWay(8600, level), 2);
  group.add(stars, band);
  // Eternity's presence in every world's sky (spec §2d): a faint arc of his halo at the edge of the heavens.
  const halo = buildEternityHalo(2200, 7000);
  group.add(halo.group);
  let baked: BakedBackdrop | null = null;
  try {
    const sources = withSkySeed(() => makeBackdropBakeSources(level), 3);
    baked = bakeBackdrop(renderer, scene, sources, level === "low" ? 512 : 768);
  } catch {
    // A device that cannot bake keeps the live stars on its plain background; the sky never blocks a world.
  }
  let disposed = false;
  return {
    group,
    update(cameraPos, t, yaw = 0, reducedMotion = false) {
      group.position.copy(cameraPos);
      group.rotation.y = yaw;
      scene.backgroundRotation.y = yaw;
      stars.userData.update?.(t);
      halo.update(t, reducedMotion);
      band.userData.update?.(t);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      halo.dispose();
      group.traverse((o) => {
        const m = o as THREE.Points;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const x of mats) x.dispose();
      });
      if (baked) disposeBakedBackdrop(baked);
      scene.background = null;
    },
  };
}
