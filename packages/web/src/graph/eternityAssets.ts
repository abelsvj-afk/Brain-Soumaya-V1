import * as THREE from "three";
import { gltfLoader, noteModelFallback } from "./gltf.js";

/**
 * Eternity's world — real-asset layer (Phase 3, Eternity app world).
 * The manifest names every GLB the Eternity scene loads; the loader
 * fetches them through the app's shared glTF loader (Draco + KTX2 —
 * the Quaternius hulls and her ship are Draco-compressed) with the
 * honest fallback (null + diagnostics note — the scene degrades, never
 * crashes); the fit helper scales each hull by its bounding box to the
 * old 11-unit visitor length.
 *
 * SOURCES (provenance: the v3.4 mockup's fleet staging, verified
 * 2026-10-26 — 9 of 13 files hash-match the deploy-branch blobs
 * exactly; the 4 speeders come from the verified P2-6 staging assets):
 * - The figure is the owner's own upload (`man-god-halo.glb`, body +
 *   halo split by the mockup's builder) — no third-party license; the
 *   owner's file, recorded in CREDITS.md as such.
 * - Kenney Space Kit — CC0 in-file (see CREDITS.md; the shipped
 *   siblings carry no in-file copyright line either — the kit-level
 *   CC0 is the basis, same as the Station's Kenney entries).
 * - Quaternius Ultimate Spaceships — CC0 1.0 in-file, with the open
 *   QAL v1.0 flag attached (owner decides; see the P2-6 provenance
 *   inventory).
 * - Her ship (`soumaya-ship.glb`) loads through the existing
 *   `loadSoumayaShip` — it is NOT in this manifest (one loader, one
 *   copy).
 *
 * All URLs are flat in `public/` (the app's existing convention:
 * `profondo.glb`, `soumaya-ship.glb`). The GLB files land via the
 * GitHub web UI (binaries cannot ride the API push); until they land,
 * every load resolves null and the scene runs without that ship — a
 * hull that fails to load is left out and named in the diagnostics,
 * never replaced by a procedural stand-in.
 */

export interface EternityAssetModel {
  /** Model key. */
  key: string;
  /** Public URL of the GLB. */
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
  /** Nose sits at glTF −Z: the loader turns the hull PI about Y so
   *  the nose points at Eternity (lookAt points +Z at the target).
   *  Kenney + Quaternius noses are −Z (measured 2026-10-26);
   *  her ship's nose is +Z (P2-6 recon) and needs no turn. */
  flip: boolean;
}

/** The figure: the owner's GLB, body + halo split, ×170 → ~323 units. */
export const FIGURE_MODEL: EternityAssetModel = {
  key: "man-god-halo",
  url: "/man-god-halo.glb",
  tris: 222_118,
  flip: false,
};

/** The visitor fleet, in orbit-slot order (slot i ↔ model i — see
 *  `visitorSlots` in eternityLayout.ts). Eight Kenney Space Kit craft
 *  + four Quaternius hulls. The four speeders are NEW to the app
 *  (P2-6 shipped only cargoA/cargoB/miner/racer) — they ride the same
 *  upload as the figure. */
export const VISITOR_MODELS: readonly EternityAssetModel[] = [
  { key: "craft_cargoA", url: "/kenney-space-craft_cargoA.glb", tris: 264, flip: true },
  { key: "craft_cargoB", url: "/kenney-space-craft_cargoB.glb", tris: 380, flip: true },
  { key: "craft_miner", url: "/kenney-space-craft_miner.glb", tris: 384, flip: true },
  { key: "craft_racer", url: "/kenney-space-craft_racer.glb", tris: 280, flip: true },
  { key: "craft_speederA", url: "/kenney-space-craft_speederA.glb", tris: 280, flip: true },
  { key: "craft_speederB", url: "/kenney-space-craft_speederB.glb", tris: 270, flip: true },
  { key: "craft_speederC", url: "/kenney-space-craft_speederC.glb", tris: 292, flip: true },
  { key: "craft_speederD", url: "/kenney-space-craft_speederD.glb", tris: 322, flip: true },
  { key: "challenger", url: "/quaternius-challenger.glb", tris: 1748, flip: true },
  { key: "striker", url: "/quaternius-striker.glb", tris: 4530, flip: true },
  { key: "spitfire", url: "/quaternius-spitfire.glb", tris: 3512, flip: true },
  { key: "zenith", url: "/quaternius-zenith.glb", tris: 2152, flip: true },
];

/** Every GLB URL the Eternity scene loads (the upload manifest) —
 *  the figure plus the twelve visitor hulls. Her ship is not listed:
 *  it loads through `loadSoumayaShip`, as in the Station and transit. */
export const ETERNITY_ASSET_URLS: readonly string[] = [
  FIGURE_MODEL.url,
  ...VISITOR_MODELS.map((m) => m.url),
];

/**
 * Load one Eternity asset through the app's shared glTF loader.
 * Resolves to the loaded scene, or null when the load fails — the
 * caller keeps its fallback and the failure is registered for the
 * diagnostics note (the app's model-fallback pattern).
 */
export function loadEternityAsset(url: string): Promise<THREE.Object3D | null> {
  const name = url.split("/").pop() ?? url;
  return new Promise((resolve) => {
    gltfLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => {
        noteModelFallback(name);
        resolve(null);
      },
    );
  });
}

/**
 * Split the figure GLB into its body meshes and its halo mesh. The
 * builder split the model into two named meshes — body + halo — so
 * the halo gets its own unlit whitish-gold material and the body gets
 * porcelain. Returns the body meshes (everything not named "halo")
 * and the halo mesh (null when the file was never split — the caller
 * then treats the whole figure as body and the halo simply does not
 * flare on its own).
 */
export function splitFigure(root: THREE.Object3D): { body: THREE.Mesh[]; halo: THREE.Mesh | null } {
  const body: THREE.Mesh[] = [];
  let halo: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    if (mesh.name === "halo") halo = mesh;
    else body.push(mesh);
  });
  return { body, halo };
}

/**
 * Normalise a loaded ship hull: turn a −Z nose to +Z when `flip`,
 * scale the longest side to `len` units, and centre the hull on its
 * own origin so the caller can place it by group position alone.
 * Returns the root group, ready to add to the scene.
 */
export function fitShip(root: THREE.Object3D, len: number, flip: boolean): THREE.Object3D {
  if (flip) root.rotation.y = Math.PI;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const k = len / longest;
  root.scale.setScalar(k);
  const center = box.getCenter(new THREE.Vector3());
  // The centre was measured before scaling; scale it with the hull.
  root.position.set(-center.x * k, -center.y * k, -center.z * k);
  return root;
}
