import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { STATION_PALETTE, STATION_WHEEL_RADIUS } from "./stationLayout.js";

/**
 * The Great Station's hull (Phase 2, P2-3 / Gate 0, D-37/D-43):
 * "Profondo" by vostok (BlendSwap), CC BY 3.0 — license verified from
 * the downloaded file itself; attribution in public/CREDITS.md and in
 * the in-app Worlds credits. Gate 0 measurements: 333,563 raw tris →
 * 132,432 after weld + decimate (line: 150k), converted to
 * /profondo.glb (one object, five material groups). The owner's
 * look-test passed 2026-10-23.
 *
 * The raw export's materials are unfaithful to the 2014 Cycles setup
 * (black base colors, broad emissive wash), so materials are
 * re-expressed here under the Great Station recipe's grammar — by the
 * model's own material names, mutated IN PLACE: replacing loaded
 * materials breaks the mesh's rendering (found in smoke testing).
 *   luci (lights)      → warm amber working light, gently emissive
 *   arancione (orange) → muted amber accent, no glow
 *   plastica grigia    → gunmetal
 *   plastica nera      → near-black basalt
 *   Material           → basalt graphite
 * Cyan stays reserved for navigation truth (the beacon ring), per the
 * recipe — the hull carries none.
 */
export const PROFONDO_URL = "/profondo.glb";

const RECIPE_BY_MATERIAL: Readonly<Record<string, { color: number; roughness: number; metalness: number }>> = {
  "plastica grigia": { color: STATION_PALETTE.hullGunmetal, roughness: 0.55, metalness: 0.5 },
  "plastica nera": { color: 0x22242a, roughness: 0.8, metalness: 0.35 },
  Material: { color: STATION_PALETTE.hullBasalt, roughness: 0.7, metalness: 0.4 },
  arancione: { color: 0xb56a28, roughness: 0.5, metalness: 0.3 },
};
const FALLBACK_RECIPE = { color: 0x35383f, roughness: 0.65, metalness: 0.45 };

export function applyProfondoRecipe(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (typeof std.color?.set !== "function") continue;
      if (m.name === "luci") {
        std.color.set(0x201408);
        std.emissive?.set(0xff9d2e);
        std.emissiveIntensity = 0.8;
        std.roughness = 0.5;
        std.metalness = 0.1;
      } else {
        const r = RECIPE_BY_MATERIAL[m.name] ?? FALLBACK_RECIPE;
        std.color.set(r.color);
        std.roughness = r.roughness;
        std.metalness = r.metalness;
        std.emissive?.set(0x000000);
        std.emissiveIntensity = 0;
      }
      std.needsUpdate = true;
    }
  });
}

/** Scale the hull so its rim matches the layout's wheel radius, and
 *  recenter it on the group origin (the model's own center sits
 *  slightly below its bounding middle). */
export function normalizeProfondoScale(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const halfRim = Math.max(size.x, size.z) / 2;
  if (halfRim <= 0) return;
  const scale = STATION_WHEEL_RADIUS / halfRim;
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
}

/**
 * Load the hull through the app's shared glTF loader. Resolves to the
 * prepared hull group, or null when the load fails — the caller keeps
 * the procedural backup form (the app's model-fallback pattern; the
 * failure is registered for the diagnostics note).
 */
export function loadProfondoHull(): Promise<THREE.Object3D | null> {
  return new Promise((resolve) => {
    gltfLoader().load(
      PROFONDO_URL,
      (gltf) => {
        const root = gltf.scene;
        applyProfondoRecipe(root);
        normalizeProfondoScale(root);
        resolve(root);
      },
      undefined,
      () => {
        noteModelFallback("profondo.glb");
        resolve(null);
      },
    );
  });
}
