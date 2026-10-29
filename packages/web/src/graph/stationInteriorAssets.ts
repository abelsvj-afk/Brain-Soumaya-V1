import { loadStationAsset } from "./stationAssets.js";

/**
 * The Station Interior's real-asset layer (Wave 2, settled design
 * 2026-10-28). The manifest names every GLB the interior scene loads
 * — all of them already in the app (P2-6, Kenney Space Kit + Station
 * Kit, CC0 1.0 in-file; see `docs/worlds/p2-6-provenance-inventory.md`,
 * plus the app's own ship hulls). No new GLB is added by this
 * increment: the interior is built from the kit the Station already
 * carries and the ship the brain already flies, so there is nothing
 * new to upload, license, or slim.
 *
 * Treatments follow the exterior's dressing rules (stationAssets.ts):
 * Station Kit pieces load as-is (one `colormap` material each — their
 * look IS the texture); Space Kit pieces merge to one material each.
 * The docked ship loads as-is (her own hull, like the galaxy's ship).
 *
 * What changed vs the prior build: the berthed visitor craft
 * (`craft_cargoB`) is GONE — the settled design superseded it. The
 * center of the hangar bay belongs to the user's own ship, so the
 * manifest now carries her hulls instead: `soumaya-ship.glb` (her
 * ship, the default skin) and `organic-spaceship.glb` (the organic
 * skin). The other two skins (fusion_core, holographic) have no GLB
 * anywhere in the app — the galaxy renders them procedurally — so the
 * bay shows her ship hull with the galaxy's own procedural styling
 * for those skins (see stationInteriorScene.ts); the picker remains
 * the truth about which skin is picked.
 */

export interface StationInteriorAssetModel {
  key: string;
  url: string;
  /** Measured triangles of the shipped file (P2-6 manifest). */
  tris: number;
  /** Load as-is (Station Kit colormap) or merge to one material (Space Kit). */
  treatment: "as-is" | "merge";
}

/** Every kit model the interior places, keyed as the layout names it. */
export const INTERIOR_MODELS: readonly StationInteriorAssetModel[] = [
  { key: "hangar_largeA", url: "/kenney-space-hangar_largeA.glb", tris: 412, treatment: "merge" },
  { key: "hangar_smallA", url: "/kenney-space-hangar_smallA.glb", tris: 280, treatment: "merge" },
  { key: "platform_large", url: "/kenney-space-platform_large.glb", tris: 76, treatment: "merge" },
  { key: "structure", url: "/kenney-space-structure.glb", tris: 168, treatment: "merge" },
  { key: "structure_detailed", url: "/kenney-space-structure_detailed.glb", tris: 232, treatment: "merge" },
  { key: "satelliteDish_large", url: "/kenney-space-satelliteDish_large.glb", tris: 186, treatment: "merge" },
  { key: "container", url: "/kenney-station-container.glb", tris: 88, treatment: "as-is" },
  { key: "pipe", url: "/kenney-station-pipe.glb", tris: 20, treatment: "as-is" },
];

/** The passing ship outside the bay door reuses the dispatcher's geometry — the same hull as the exterior's docking shuttle, one load, no second fetch. */
export const INTERIOR_BAY_SHIP = {
  key: "dispatcher",
  url: "/quaternius-dispatcher.glb",
  tris: 748,
} as const;

/**
 * Your ship, floating in the center of the hangar bay (EVE-style
 * dock-in). The skin is the HangarPanel pick (`brain.hangar.ship.*`):
 * default → her ship; organic → the organic hull. Fusion_core and
 * holographic have no GLB — the scene styles her ship hull the way
 * the galaxy styles its procedural hull for those skins.
 */
export const INTERIOR_USER_SHIP = {
  defaultUrl: "/soumaya-ship.glb",
  organicUrl: "/organic-spaceship.glb",
} as const;

/** The GLB for a ship skin — the organic hull for the organic skin, her ship for everything else. */
export function interiorShipUrlForSkin(skin: string): string {
  return skin === "organic" ? INTERIOR_USER_SHIP.organicUrl : INTERIOR_USER_SHIP.defaultUrl;
}

/** Every GLB URL the interior scene loads (the upload manifest) — all already in `public/`. */
export const STATION_INTERIOR_ASSET_URLS: readonly string[] = [
  ...new Set([
    ...INTERIOR_MODELS.map((m) => m.url),
    INTERIOR_BAY_SHIP.url,
    INTERIOR_USER_SHIP.defaultUrl,
    INTERIOR_USER_SHIP.organicUrl,
  ]),
];

/** Load one interior asset through the app's shared Station loader (honest fallback: null + diagnostics note). */
export function loadInteriorAsset(url: string): Promise<import("three").Object3D | null> {
  return loadStationAsset(url);
}
