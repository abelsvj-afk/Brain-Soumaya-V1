import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { HERO_SHIP_FORWARD_LENGTH } from "./stationLayout.js";

/**
 * Soumaya's own ship as the Station/transit hero (Phase 2, P2-6,
 * Q2 — owner-corrected 2026-10-25). Her ship already flies in the
 * home galaxy (`graph/soumaya.ts`); this module is the thin worlds
 * wrapper around the same file — same loading, same material
 * treatment — scaled to the settled 12-unit forward length so the
 * 35:1 wheel-to-ship ratio holds. The procedural hull stays the
 * load-failure fallback (the Profondo pattern), never the hero.
 *
 * PROVENANCE — IDENTIFIED (2026-10-26, from the file itself): the
 * model is 3DHaupt's "Intergalactic Spaceship Version 2", licensed
 * CC-BY-NC (non-commercial use only) — in-file copyright "Modeled and
 * Textured by 3DHaupt aka DennisH2010 (Dennis Haupt)", node named
 * `Intergalactic_Spaceships_Version_2`. Before any commercial use of
 * the worlds, the hero must be replaced with the verified CC-BY-4.0
 * fallback (`organic-spaceship.glb`). Full record in the P2-6
 * provenance inventory (`docs/worlds/p2-6-provenance-inventory.md`)
 * and `public/CREDITS.md`.
 *
 * Measured from the deployed file (2026-10-25, Blender world-space):
 * 37,026 tris, 10 meshes, 3 materials (Material.001/002/003), KTX2
 * textures 1024×1024, Draco + clearcoat + BasisU, 2,364,720 bytes.
 * Nose at glTF +Z (tapered end, cross-section 1.30 at the tip);
 * engine rings at glTF −Z. Forward length 13.53.
 */
export const SOUMAYA_SHIP_URL = "/soumaya-ship.glb";

/**
 * The default-skin treatment, verbatim from `graph/soumaya.ts` (the
 * galaxy's own loader — tint #c2d4f5, sheen #2f7bff,
 * emissiveIntensity 0.3, metalness 0.35, roughness 0.45, mutated in
 * place). Copied, not imported: soumaya.ts is the 1600-line agent
 * module, and the worlds bundle takes only this treatment. Replacing
 * loaded materials breaks the mesh's rendering (found in smoke
 * testing) — mutate in place, exactly as the galaxy does.
 */
export function applySoumayaShipTreatment(root: THREE.Object3D): void {
  const tint = new THREE.Color("#c2d4f5");
  const sheen = new THREE.Color("#2f7bff");
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (typeof std.color?.set !== "function") continue;
      std.color.copy(tint);
      if (std.emissive) {
        std.emissive.copy(sheen);
        std.emissiveIntensity = 0.3;
      }
      if ("metalness" in std) std.metalness = 0.35;
      if ("roughness" in std) std.roughness = 0.45;
      std.needsUpdate = true;
    }
  });
}

/**
 * Point the nose forward and scale to the settled forward length.
 * The file's nose is at glTF +Z; worlds-forward is −Z (the transit
 * corridor runs toward −Z, the mooring faces outward), so the root
 * turns half a revolution. Scale is measured live from the Box3 —
 * never from raw accessor bounds, which ignore the node transforms
 * (the raw POSITION box reads 5.98 × 8.50 × 5.02; the true assembly
 * is 5.98 × 3.10 × 13.53). The root carries its own rotation and
 * recenter — callers position the HOLDER, never this root.
 */
export function normalizeSoumayaShipScale(root: THREE.Object3D): void {
  root.rotation.y = Math.PI;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const forward = size.z;
  if (forward <= 0) return;
  const k = HERO_SHIP_FORWARD_LENGTH / forward;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);
}

/**
 * Load her ship through the app's shared glTF loader. Resolves to the
 * prepared ship group, or null when the load fails — the caller keeps
 * the procedural hull (the app's model-fallback pattern; the failure
 * is registered for the diagnostics note). The caller must have a
 * renderer whose KTX2 support is ensured (WorldsSurface does this
 * when it creates its renderer — the hero's textures are KTX2).
 */
export function loadSoumayaShip(): Promise<THREE.Object3D | null> {
  return new Promise((resolve) => {
    gltfLoader().load(
      SOUMAYA_SHIP_URL,
      (gltf) => {
        const root = gltf.scene;
        applySoumayaShipTreatment(root);
        normalizeSoumayaShipScale(root);
        resolve(root);
      },
      undefined,
      () => {
        noteModelFallback("soumaya-ship.glb");
        resolve(null);
      },
    );
  });
}
