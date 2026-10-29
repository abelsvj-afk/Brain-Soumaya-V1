import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Shared lighting for the worlds (owner, 2026-10-29: "the lighting for every
 * space is bad … the only place that's bright enough is the Growing Place").
 *
 * Measured cause: the home galaxy lights its glTF models with an environment
 * map (Graph3D's RoomEnvironment PMREM); the worlds never got one, so every
 * PBR / metallic model (the Station, planets, ships) rendered near-black
 * whatever lights the scene added — mean brightness 14–15 of 255 against the
 * garden's 54 (the garden is Lambert-shaded, which needs no environment).
 *
 * Each world declares a small rig; the host applies it once per renderer.
 * Everything here is additive and cheap: one environment texture (built once,
 * shared by the scene), at most one hemisphere + one directional light.
 */

export interface WorldLightRig {
  /** scene.environmentIntensity — how strongly metals pick up the room map. 0 = none. */
  env: number;
  /** Soft sky/ground fill so shadowed sides are never pure black. */
  hemi?: { sky: number; ground: number; intensity: number };
  /** A key ("sun" / star) light. direction = where the light comes FROM. */
  key?: { color: number; intensity: number; from: readonly [number, number, number] };
}

/** Sensible default for a space world with glTF models: lit, never washed out. */
export const DEFAULT_WORLD_RIG: WorldLightRig = {
  env: 0.9,
  hemi: { sky: 0x9fb0ff, ground: 0x2a2036, intensity: 0.9 },
  key: { color: 0xfff1dc, intensity: 2.4, from: [-600, 500, 400] },
};

export interface AppliedLighting {
  dispose: () => void;
}

/**
 * Apply a rig to a scene. The environment texture is generated from the
 * renderer (PMREM) and released by `dispose`. Safe to call with a rig of
 * `env: 0` and no lights (applies nothing).
 */
export function applyWorldLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  rig: WorldLightRig,
): AppliedLighting {
  const owned: THREE.Object3D[] = [];
  let pmrem: THREE.PMREMGenerator | null = null;
  let envTarget: THREE.WebGLRenderTarget | null = null;

  if (rig.env > 0) {
    pmrem = new THREE.PMREMGenerator(renderer);
    // A high blur keeps the stylised room from reading as a window-shaped
    // reflection on curved hulls (same reason Graph3D uses 0.6).
    const room = new RoomEnvironment();
    envTarget = pmrem.fromScene(room, 0.6);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = rig.env;
    room.dispose();
  }
  if (rig.hemi) {
    const h = new THREE.HemisphereLight(rig.hemi.sky, rig.hemi.ground, rig.hemi.intensity);
    h.name = "world-hemi";
    scene.add(h);
    owned.push(h);
  }
  if (rig.key) {
    const k = new THREE.DirectionalLight(rig.key.color, rig.key.intensity);
    k.name = "world-key";
    k.position.set(rig.key.from[0], rig.key.from[1], rig.key.from[2]);
    scene.add(k);
    owned.push(k);
  }

  return {
    dispose() {
      for (const o of owned) scene.remove(o);
      if (scene.environment === envTarget?.texture) scene.environment = null;
      envTarget?.dispose();
      pmrem?.dispose();
    },
  };
}
