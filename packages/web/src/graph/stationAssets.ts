import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import { STATION_PALETTE } from "./stationLayout.js";

/**
 * The Station's real-asset layer (Phase 2, P2-6). The manifest names
 * every GLB the Station scene loads; the loader fetches them through
 * the app's shared glTF loader with the honest fallback (null +
 * diagnostics note — the scene degrades, never crashes); the merge
 * helpers keep the draw-call budget honest (one material = one call).
 *
 * SOURCES (provenance inventory: `docs/worlds/p2-6-provenance-inventory.md`):
 * - Quaternius Ultimate Spaceships, NATIVE glTF mirror
 *   (yolanother/QuaterniusUltimateSpaceships) — CC0 1.0 in-file, with
 *   the open QAL v1.0 flag attached (owner decides). 11 hulls, 32,064
 *   tris, one 1024 texture each. The Godot conversion is the fallback.
 * - WATO spaceship (XCVG, OpenGameArt) — CC-BY 3.0 in-file, credit
 *   XCVG. 730 tris. The recognizable regular.
 * - Kenney Space Kit + Space Station Kit — CC0 in-file. 8 ships,
 *   dressing, drydock pieces. Station Kit GLBs reference the external
 *   `Textures/colormap.png` (512×512) — the upload must keep it beside
 *   them at `public/Textures/colormap.png`.
 * - NOT here: the NASA probes. Kepler + Pioneer 10 are staged for the
 *   Scale Space (their natural home beside the ISS), not the Station —
 *   the call budget, not the license, defers them. The OGA stylized
 *   ship stays excluded (no in-file license, B-2 hard case).
 *
 * All URLs are flat in `public/` (the app's existing convention:
 * `profondo.glb`, `soumaya-ship.glb`). The GLB files land via the
 * GitHub web UI (binaries cannot ride the API push); until they land,
 * every load resolves null and the scene runs on its procedural
 * fallbacks — see `stationScene.ts`.
 */

export interface StationAssetModel {
  /** Lane/model key (also the traffic-lane index for traffic models). */
  key: string;
  /** Public URL of the GLB. */
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
}

/** Traffic fleet, in traffic-lane order (lane i ↔ model i — see
 *  `trafficLanes` in stationLayout.ts). Eleven Quaternius hulls plus
 *  the WATO regular. Every model is one InstancedMesh in the scene
 *  (Quaternius: 1 mesh / 1 material each; WATO: merged by material). */
export const TRAFFIC_MODELS: readonly StationAssetModel[] = [
  { key: "bob", url: "/quaternius-bob.glb", tris: 938 },
  { key: "challenger", url: "/quaternius-challenger.glb", tris: 1748 },
  { key: "dispatcher", url: "/quaternius-dispatcher.glb", tris: 748 },
  { key: "executioner", url: "/quaternius-executioner.glb", tris: 3388 },
  { key: "imperial", url: "/quaternius-imperial.glb", tris: 2642 },
  { key: "insurgent", url: "/quaternius-insurgent.glb", tris: 8292 },
  { key: "omen", url: "/quaternius-omen.glb", tris: 1426 },
  { key: "pancake", url: "/quaternius-pancake.glb", tris: 2688 },
  { key: "spitfire", url: "/quaternius-spitfire.glb", tris: 3512 },
  { key: "striker", url: "/quaternius-striker.glb", tris: 4530 },
  { key: "zenith", url: "/quaternius-zenith.glb", tris: 2152 },
  { key: "wato", url: "/wato-spaceship.glb", tris: 730 },
];

/** The docking shuttle (Q3) reuses the dispatcher's geometry — the
 *  smallest Quaternius hull, a shuttle easing onto arm 2. */
export const DOCKING_MODEL_INDEX = 2;

/** Docked ships (Kenney Space Kit, merged to one material each):
 *  four models, six instances — the scale ladder at the arms. The
 *  Kenney ships' forward axis is UNVERIFIED (pipeline provenance
 *  §5); docked ships moor parallel to the arm, long axis along it,
 *  so the nose direction does not affect the read at Station scale. */
export const DOCKED_MODELS: readonly (StationAssetModel & { instances: number })[] = [
  { key: "craft_cargoA", url: "/kenney-space-craft_cargoA.glb", tris: 264, instances: 1 },
  { key: "craft_cargoB", url: "/kenney-space-craft_cargoB.glb", tris: 380, instances: 2 },
  { key: "craft_miner", url: "/kenney-space-craft_miner.glb", tris: 384, instances: 2 },
  { key: "craft_racer", url: "/kenney-space-craft_racer.glb", tris: 280, instances: 1 },
];

/** Dressing (six models × two instances): Station Kit pieces load
 *  as-is (one `colormap` material each — their look IS the texture);
 *  Space Kit pieces merge to one material each. */
export const DRESSING_MODELS: readonly (StationAssetModel & { instances: number; merge: boolean })[] = [
  { key: "container", url: "/kenney-station-container.glb", tris: 88, instances: 2, merge: false },
  { key: "pipe", url: "/kenney-station-pipe.glb", tris: 20, instances: 2, merge: false },
  { key: "platform_large", url: "/kenney-space-platform_large.glb", tris: 76, instances: 2, merge: true },
  { key: "structure_detailed", url: "/kenney-space-structure_detailed.glb", tris: 232, instances: 2, merge: true },
  { key: "hangar_smallA", url: "/kenney-space-hangar_smallA.glb", tris: 280, instances: 2, merge: true },
  { key: "satelliteDish_large", url: "/kenney-space-satelliteDish_large.glb", tris: 186, instances: 2, merge: true },
];

/** Witnesses (C1): the hauler is a Kenney cargo ship, merged; the
 *  drydock frame is composed from Space Kit pieces (recon ledger). */
export const WITNESS_HAULER: StationAssetModel = {
  key: "craft_cargoA",
  url: "/kenney-space-craft_cargoA.glb",
  tris: 264,
};
export const DRYDOCK_PIECES: readonly (StationAssetModel & { instances: number })[] = [
  { key: "hangar_largeA", url: "/kenney-space-hangar_largeA.glb", tris: 412, instances: 1 },
  { key: "platform_large", url: "/kenney-space-platform_large.glb", tris: 76, instances: 4 },
  { key: "structure_detailed", url: "/kenney-space-structure_detailed.glb", tris: 232, instances: 2 },
  { key: "structure", url: "/kenney-space-structure.glb", tris: 168, instances: 2 },
];

/**
 * Low-poly Space Pack (reodesuxz) — the population increment
 * (2026-10-27, owner's build-all order). Measured from the files
 * (ships-hunt/itchio-2026-10-27.md); licenses in public/CREDITS.md
 * and WorldCredits. All URLs are flat in `public/`; the GLBs land via
 * the GitHub web UI, and until they land every load resolves null and
 * the mooring stays empty — never a procedural stand-in.
 */

/** Low-poly docked ships (merged to one material each, the existing
 *  docked pattern): one instance per model. Their mooring spots live
 *  in stationLayout.ts (LOWPOLY_DOCKED_SPOTS, same order — spot i ↔
 *  model i, the traffic-lane pattern). */
export const LOWPOLY_DOCKED_MODELS: readonly (StationAssetModel & { instances: number })[] = [
  { key: "rocket_classic", url: "/lowpoly-rocket_classic.glb", tris: 224, instances: 1 },
  { key: "rocket_shuttle", url: "/lowpoly-rocket_shuttle.glb", tris: 184, instances: 1 },
  { key: "lander_pod", url: "/lowpoly-lander_pod.glb", tris: 272, instances: 1 },
  { key: "space_capsule", url: "/lowpoly-space_capsule.glb", tris: 200, instances: 1 },
];

/** Low-poly dressing (merged to one material each, the existing
 *  dressing pattern): one instance per model. Spots come from
 *  lowPolyDressingSpots() in stationLayout.ts. */
export const LOWPOLY_DRESSING_MODELS: readonly (StationAssetModel & { instances: number; merge: boolean })[] = [
  { key: "space_station_core", url: "/lowpoly-space_station_core.glb", tris: 192, instances: 1, merge: true },
  { key: "station_module", url: "/lowpoly-station_module.glb", tris: 128, instances: 1, merge: true },
  { key: "satellite_dish", url: "/lowpoly-satellite_dish.glb", tris: 216, instances: 1, merge: true },
  { key: "solar_array", url: "/lowpoly-solar_array.glb", tris: 128, instances: 1, merge: true },
  { key: "fuel_tank", url: "/lowpoly-fuel_tank.glb", tris: 220, instances: 1, merge: true },
];

/** The drydock gantry witness (merged to one material): the launch
 *  tower stands beside the drydock frame (LOWPOLY_GANTRY_POSITION in
 *  stationLayout.ts). Its ~10-unit height reads as a gantry at
 *  Station scale. */
export const LOWPOLY_GANTRY: StationAssetModel = {
  key: "launch_tower",
  url: "/lowpoly-launch_tower.glb",
  tris: 332,
};

/** Every GLB URL the Station scene loads (the upload manifest) — one
 *  entry per distinct file, even when the same file serves several
 *  roles (platform_large dresses and drydocks; craft_cargoA docks and
 *  witnesses). */
export const STATION_ASSET_URLS: readonly string[] = [
  ...new Set([
    ...TRAFFIC_MODELS.map((m) => m.url),
    ...DOCKED_MODELS.map((m) => m.url),
    ...DRESSING_MODELS.map((m) => m.url),
    WITNESS_HAULER.url,
    ...DRYDOCK_PIECES.map((m) => m.url),
    ...LOWPOLY_DOCKED_MODELS.map((m) => m.url),
    ...LOWPOLY_DRESSING_MODELS.map((m) => m.url),
    LOWPOLY_GANTRY.url,
  ]),
];

/**
 * Extract the single mesh of a loaded GLB (geometry baked into the
 * root's space, so node transforms cannot surprise the caller).
 * Returns null unless the root holds exactly one single-material
 * mesh — the shape every traffic/dressing GLB in the manifest has.
 * Multi-mesh or multi-material roots are the caller's problem, not
 * silently half-used: null means "omit this model".
 */
export function singleMeshGeometry(
  root: THREE.Object3D,
): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length !== 1) return null;
  const mesh = meshes[0];
  if (!mesh || Array.isArray(mesh.material)) return null;
  root.updateWorldMatrix(true, true);
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  return { geometry, material: mesh.material };
}

/**
 * Load one Station asset through the app's shared glTF loader.
 * Resolves to the loaded scene, or null when the load fails — the
 * caller keeps its fallback and the failure is registered for the
 * diagnostics note (the app's model-fallback pattern).
 */
export function loadStationAsset(url: string): Promise<THREE.Object3D | null> {
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

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

/**
 * Merge a loaded group by material: one mesh per distinct material.
 * Geometry is cloned with the mesh's world transform baked in, so the
 * merged mesh sits exactly where the parts did. Meshes with material
 * arrays are copied through untouched (they carry their own groups).
 * Returns the merged group, or the ORIGINAL root when anything cannot
 * merge (mismatched attributes, a failed merge) — never a broken mesh,
 * never a throw. The caller budgets the unmerged cost in that case
 * (see the scene's fail-safes: an unmergeable WATO is omitted, not
 * shipped at 18 calls).
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Object3D {
  const meshes = collectMeshes(root);
  if (meshes.length === 0) return root;
  root.updateWorldMatrix(true, true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const passthrough: THREE.Mesh[] = [];
  for (const mesh of meshes) {
    const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (Array.isArray(mesh.material)) {
      // Multi-material meshes carry their own groups — bake the
      // transform in and carry them through untouched.
      const carried = new THREE.Mesh(baked, mesh.material);
      passthrough.push(carried);
      continue;
    }
    const list = byMaterial.get(mesh.material) ?? [];
    list.push(baked);
    byMaterial.set(mesh.material, list);
  }
  if (byMaterial.size === 0) return root;
  const out = new THREE.Group();
  for (const [material, geos] of byMaterial) {
    const first = geos[0];
    if (!first) return root;
    const merged = geos.length === 1 ? first : mergeGeometries(geos, false);
    if (!merged) return root;
    out.add(new THREE.Mesh(merged, material));
  }
  for (const o of passthrough) out.add(o);
  return out;
}

/**
 * Merge a loaded group to ONE material — the Kenney treatment. The
 * Space Kit ships and dressing pieces ship with four flat materials
 * (`metalDark`, `dark`, `metalRed`, `metal`); at Station scale the
 * form reads and the per-material accents do not, so the build merges
 * them into a single recipe-tinted material (1 call per model). The
 * red accent is lost — recorded here, not hidden. Returns the single
 * mesh, or null when the group cannot merge (the caller omits the
 * model rather than blowing the budget).
 */
export function mergeToSingleMaterial(
  root: THREE.Object3D,
  color: number = STATION_PALETTE.hullGunmetal,
): THREE.Mesh | null {
  const meshes = collectMeshes(root);
  if (meshes.length === 0) return null;
  root.updateWorldMatrix(true, true);
  const geos: THREE.BufferGeometry[] = [];
  for (const mesh of meshes) {
    geos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  }
  const merged = (() => {
    const first = geos[0];
    if (!first) return null;
    return geos.length === 1 ? first : mergeGeometries(geos, false);
  })();
  if (!merged) return null;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.5,
  });
  return new THREE.Mesh(merged, material);
}

/**
 * Recenter a geometry on its own bounding-box center (geometry space,
 * no scene needed). Merged GLB geometry keeps the file's own offsets,
 * so a merged body placed at a point would sit off-center by the
 * model's own origin error — recentering puts the body where the
 * placement says it is. Returns the same geometry.
 */
export function recenterGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  return geometry;
}

/**
 * Scale a geometry uniformly so its longest side is `size` (geometry
 * space). Returns the scale applied, or 1 when the geometry has no
 * measurable extent. The population increment's bodies are sized this
 * way — the files' native units are not a scale the scenes can trust
 * (the FlexUnit UFO measures 0.05 units long in its own file).
 */
export function scaleGeometryToSize(geometry: THREE.BufferGeometry, size: number): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return 1;
  const extents = box.getSize(new THREE.Vector3());
  const longest = Math.max(extents.x, extents.y, extents.z);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  const scale = size / longest;
  geometry.scale(scale, scale, scale);
  return scale;
}
