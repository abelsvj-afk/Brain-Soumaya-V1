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

/**
 * Distant backdrop planets (EVE-style, 2026-10-27 evening, owner's
 * direction: more planets in the other worlds — distant planets you
 * fly toward that grow enormous but you never reach). The Station's
 * camera is a scripted slow orbit at radius 600, so "never reach" is
 * structural: the planets sit 4,000 units out and the camera never
 * gets closer than ~3,400. They loom (~11° across) with the orbit's
 * parallax against the near field. Loaded as-is (1–2 materials each
 * = 1–2 calls); no spin — a backdrop planet's rotation is invisible
 * at 4,000 units — and no merge, which would kill the lava planet's
 * cloud layer. Fog stays on: at 4,000 units FogExp2 0.00016 leaves
 * ~2/3 of the color, and the haze sells the distance.
 *
 * The lava planet is new (FPSunreal, Sketchfab, CC-BY-4.0 — see
 * CREDITS.md); its cloud-rotation clip is not wired, for the same
 * reason. The Quaternius planet reuses a hunt-2 file already in the
 * upload pipeline (second job, no new upload). The two sit ~180°
 * apart, so one is usually in view as the orbit turns.
 */
export interface StationBackdropPlanet extends StationAssetModel {
  /** Material count of the file (= draw calls, loaded as-is). */
  materials: number;
  /** Azimuth of the planet around the Station, radians. */
  angle: number;
  /** Distance from the Station center, in field units. */
  distance: number;
  /** Height above the Station plane — ~7° elevation from the orbit. */
  y: number;
  /** Longest side once placed, in field units. */
  size: number;
}
export const STATION_BACKDROP_PLANETS: readonly StationBackdropPlanet[] = [
  {
    key: "lava",
    url: "/sf-lava-planet.glb",
    tris: 7936,
    materials: 2,
    angle: 0.6,
    distance: 4000,
    y: 500,
    size: 800,
  },
  {
    key: "quaternius-planet-1",
    url: "/pp-planet-1.glb",
    tris: 2586,
    materials: 1,
    angle: 0.6 + Math.PI,
    distance: 4000,
    y: 500,
    size: 800,
  },
];
/** Draw calls the backdrop planets add once loaded (materials, as-is). */
export const STATION_BACKDROP_DRAW_CALLS = STATION_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.materials,
  0,
);
/** Measured triangles the backdrop planets add once loaded. */
export const STATION_BACKDROP_TRIS_TOTAL = STATION_BACKDROP_PLANETS.reduce(
  (n, m) => n + m.tris,
  0,
);

/**
 * Hunt #2 annex clusters (space-hunt-2, 2026-10-27, owner's build-all
 * order) — three whole reodesuxz packs, each merged to ONE material and
 * ONE draw call in the scene (see mergeClusterToSingleMaterial). 85
 * models, 10,410 tris, 3 calls. Measured from the files
 * (space-hunt-2-measure.json); licenses in public/CREDITS.md and
 * WorldCredits. All URLs are flat in `public/`; the GLBs land via the
 * GitHub web UI, and until they land the annex stays empty — never a
 * procedural stand-in. The other 93 Kenney kit files are interior
 * furniture with no home in the app (no interior scene) — recorded in
 * the build record, not shipped.
 *
 * Size rule: a model whose file bbox is tall (bbox-y >= 6) is fitted
 * to 9 units, the rest to 6 — the annex reads as a settlement of
 * mixed-height structures, not a flat mat.
 */
export interface StationClusterModel {
  key: string;
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
  bytes: number;
  sha256: string;
  /** Longest side once placed, in scene units (9 tall, 6 otherwise). */
  size: number;
}
export interface StationCluster {
  key: string;
  name: string;
  models: readonly StationClusterModel[];
}
export const STATION_CLUSTERS: readonly StationCluster[] = [
  {
    key: "lunar-annex",
    name: "Lunar Annex",
    models: [
      { key: "lunar-airlock", url: "/lunar-airlock.glb", tris: 108, bytes: 11124, sha256: "d61e02319cccf9d9623ec628265c1642e826edf4c075209a19056b615cb5820a", size: 6 },
      { key: "lunar-antenna-tower", url: "/lunar-antenna-tower.glb", tris: 132, bytes: 12348, sha256: "2c7052ca73df92e54c5fc68ceb5ebc4869ab52322aed9e3d4cc3f607dd44efb8", size: 9 },
      { key: "lunar-astronaut", url: "/lunar-astronaut.glb", tris: 104, bytes: 10764, sha256: "c6f737c9010d9b7c443dd1991835352cd110a9243efde7248aade21cce2d7d27", size: 6 },
      { key: "lunar-battery-bank", url: "/lunar-battery-bank.glb", tris: 84, bytes: 8556, sha256: "e6c702da59546c826ef5068f9af3668627f5d615667a58eac545e27faf91a546", size: 6 },
      { key: "lunar-cabin-module", url: "/lunar-cabin-module.glb", tris: 116, bytes: 11712, sha256: "a46989be2d8c64172e51f465b6b4bc521dc3371ce0e026bb929c32acb0c09c16", size: 6 },
      { key: "lunar-cargo-hauler", url: "/lunar-cargo-hauler.glb", tris: 192, bytes: 16096, sha256: "c487151aaa4c69aab37e5bbbefd098ce6f940b5f645170c2bba5e31ca6cde73d", size: 6 },
      { key: "lunar-command-tower", url: "/lunar-command-tower.glb", tris: 172, bytes: 16232, sha256: "b7bcc617a3ad4c14e275a5ed795a74dcebe270b5986fb20c9f1e0eff74c2b84e", size: 9 },
      { key: "lunar-connector-tube", url: "/lunar-connector-tube.glb", tris: 132, bytes: 11120, sha256: "a8d5cb9752d2c750fc058828ee8b081cc836134497c6013a518bfb80b2f84eaa", size: 6 },
      { key: "lunar-crater", url: "/lunar-crater.glb", tris: 136, bytes: 7940, sha256: "ab6169cac003ea79af16e4277ef59789fe45703d97a733ec5b22660321867252", size: 6 },
      { key: "lunar-dome-habitat", url: "/lunar-dome-habitat.glb", tris: 224, bytes: 18244, sha256: "c3e42da1fb158dd71a956700d9216ffedc67de29ef135309e6fe864fe7994e70", size: 6 },
      { key: "lunar-flag", url: "/lunar-flag.glb", tris: 60, bytes: 6980, sha256: "0f3605b4681fe304da017339d8e7d266ec382174191e4bbcab34e2a0711af407", size: 6 },
      { key: "lunar-fuel-tank", url: "/lunar-fuel-tank.glb", tris: 164, bytes: 14732, sha256: "4fadec5c0d937e8ac643f3c755cd46b2be0218c57137b0852218bb4d1e0a4988", size: 6 },
      { key: "lunar-greenhouse", url: "/lunar-greenhouse.glb", tris: 68, bytes: 7736, sha256: "70a28ccec61e52595d092d10ef0e9b6d2a443144bf0963875f2a9fa242e77d7c", size: 6 },
      { key: "lunar-hover-drone", url: "/lunar-hover-drone.glb", tris: 200, bytes: 18100, sha256: "dfd5666dcb1c7140a3db5a12e6cb965b19d717b654837bd6c2aa84e626d9bd82", size: 6 },
      { key: "lunar-lamp-post", url: "/lunar-lamp-post.glb", tris: 44, bytes: 5968, sha256: "5dc3402c42314c24fe91e48318e458ae7aa8c17cc0f785c4d7e020f18c77b32f", size: 6 },
      { key: "lunar-lander", url: "/lunar-lander.glb", tris: 260, bytes: 19012, sha256: "8a4959f8dfed9b6d430174ef0f017059c0e83c206067f2c99b9c9fb6e4ab85fa", size: 6 },
      { key: "lunar-landing-pad", url: "/lunar-landing-pad.glb", tris: 240, bytes: 18868, sha256: "d3607e9a23afe8a6694052d1885e8690d9a50c421707c7279eab0dadd5c4cdf2", size: 6 },
      { key: "lunar-mining-drill", url: "/lunar-mining-drill.glb", tris: 80, bytes: 9180, sha256: "05f2164da5c7f309fe395958e76e64b4f5a3f90e6fa080819efce01016ffb450", size: 6 },
      { key: "lunar-moon-rocks", url: "/lunar-moon-rocks.glb", tris: 60, bytes: 8260, sha256: "e77f8674edea8fbfdd77bad891b8b83a78e068dd5501a4cb8f3db4bb1bb149e5", size: 6 },
      { key: "lunar-moon-rover", url: "/lunar-moon-rover.glb", tris: 336, bytes: 26044, sha256: "39b0a6b6a322eb889c5a82a18cfd9c20383fe2577c0b192d1758eff0e2fa2bab", size: 6 },
      { key: "lunar-radio-dish", url: "/lunar-radio-dish.glb", tris: 104, bytes: 9380, sha256: "34d167362330bd49a4c8a3cd8539b1c42fcdd53ebf0021933c5af7a55b9e8d07", size: 6 },
      { key: "lunar-reactor", url: "/lunar-reactor.glb", tris: 140, bytes: 12644, sha256: "df7421a8bf7657d617b45321521af23bc93f91db0fda5d42ca1f5ac247db4728", size: 6 },
      { key: "lunar-rocket", url: "/lunar-rocket.glb", tris: 158, bytes: 14232, sha256: "aca7911db457430e391ac7041ffd43431a7a73823311463d5aa4927e41f58274", size: 9 },
      { key: "lunar-solar-field-tile", url: "/lunar-solar-field-tile.glb", tris: 84, bytes: 8024, sha256: "998b4614b35437b35787d0a4ece9ccd202c8bde31f31d47a08c18210a02a6862", size: 6 },
      { key: "lunar-solar-panel-array", url: "/lunar-solar-panel-array.glb", tris: 80, bytes: 9140, sha256: "ec19a160c9cb42530c6682ab7be2ef4c3ffa6f65a79c95fc9ba6dc1b32c6f284", size: 6 },
      { key: "lunar-storage-pod", url: "/lunar-storage-pod.glb", tris: 68, bytes: 8064, sha256: "2c1ef8b17be50a656c151df336b64e464e1c43ae85574ebdfb50ff1878731260", size: 6 },
      { key: "lunar-supply-crate", url: "/lunar-supply-crate.glb", tris: 36, bytes: 4592, sha256: "8cac2056c1071d0201a8d8f929c86d0337b47943b199b971c556a763c29cbd01", size: 6 },
    ],
  },
  {
    key: "colony-ring",
    name: "Colony Ring",
    models: [
      { key: "colony-air-vent", url: "/colony-air-vent.glb", tris: 60, bytes: 7044, sha256: "dfa68ff5dcef1207fdb39ffc553115f172c551637eee9f18ace789e6c001d36b", size: 6 },
      { key: "colony-antenna-dish", url: "/colony-antenna-dish.glb", tris: 92, bytes: 7648, sha256: "64077e9fc5748db5cf69b83697b97825f11592b7149c089d0ab6c4cd8fd1c9d3", size: 6 },
      { key: "colony-astronaut", url: "/colony-astronaut.glb", tris: 104, bytes: 10752, sha256: "1c2f022384a6174947dd8a9954a8c2162a71db3714fce12c2b4fca04f385d5f0", size: 6 },
      { key: "colony-battery-bank", url: "/colony-battery-bank.glb", tris: 72, bytes: 6828, sha256: "d2c072d3c07c2446e1b699d176237970c58da568c8dd555b3514f44347954af5", size: 6 },
      { key: "colony-cargo-crate", url: "/colony-cargo-crate.glb", tris: 36, bytes: 4584, sha256: "413635b532be3dd40fedebd4363b06f2d19da31eabdb8d95525c776317cd18b7", size: 6 },
      { key: "colony-drone", url: "/colony-drone.glb", tris: 156, bytes: 13588, sha256: "6b7e1fbf1e7358bbacf2f6c4a81e03685562f5fe123c5f726d7319e83cd1f5a6", size: 6 },
      { key: "colony-hab-airlock", url: "/colony-hab-airlock.glb", tris: 232, bytes: 12760, sha256: "9247935bccb4608d0d113feef3a23d0aa01476d5fb48e7bdbf4ba8a011a56642", size: 6 },
      { key: "colony-hab-corridor", url: "/colony-hab-corridor.glb", tris: 60, bytes: 6864, sha256: "da36ec996360c8ff07f3882a492f5e9a57a3480b9cd093439c8fab1a66f07615", size: 6 },
      { key: "colony-hab-dock", url: "/colony-hab-dock.glb", tris: 248, bytes: 19388, sha256: "889dc63e9e9284888fd47b297283bccf921893b2580d0f72f3e376c4d5866467", size: 6 },
      { key: "colony-hab-dome", url: "/colony-hab-dome.glb", tris: 92, bytes: 9252, sha256: "3676d63a4d4d4a0fa32193d41f05bcfc99eab7835aeca1834a40ec986a332079", size: 6 },
      { key: "colony-hab-hub", url: "/colony-hab-hub.glb", tris: 104, bytes: 10152, sha256: "bcb48b3673b8eff213e7e4ebe7f98687e96c9e3207dd1f790f833fcf3f176d38", size: 6 },
      { key: "colony-hab-module", url: "/colony-hab-module.glb", tris: 156, bytes: 13004, sha256: "f50d9308750b2a1dafbc0a6e1ae73300b88c90498f12e15b92f4d4732f4e0b39", size: 6 },
      { key: "colony-hab-tower", url: "/colony-hab-tower.glb", tris: 146, bytes: 12768, sha256: "d8b9f67d4cb0165c91e803ca14394025994d37c04a600b575bcfffedc5ec894d", size: 9 },
      { key: "colony-hydroponic-rack", url: "/colony-hydroponic-rack.glb", tris: 120, bytes: 11024, sha256: "2917543c25f295d5293ada7681efbbce4e1e49a4273bb467d58cac2e3a7a8ba0", size: 6 },
      { key: "colony-lander-pad", url: "/colony-lander-pad.glb", tris: 300, bytes: 21304, sha256: "deb49235841e9396b6e2435a0ecd9f0c28f77dcfc2b4fe9514a3bf26bf9b1a90", size: 6 },
      { key: "colony-mining-drill", url: "/colony-mining-drill.glb", tris: 54, bytes: 6704, sha256: "da52e2057b0e179d507410e8094d56f591801675dd319670a4efd1384830a7bb", size: 6 },
      { key: "colony-oxygen-tank", url: "/colony-oxygen-tank.glb", tris: 92, bytes: 8420, sha256: "93b1389752d74d4f761e1b3f1fb79cd803279fed4e29f6ad1997d1793119786c", size: 6 },
      { key: "colony-planter-box", url: "/colony-planter-box.glb", tris: 84, bytes: 10604, sha256: "d9a8192aecd762044979d436e88e3269b736e400932608eb728490e53ad4100e", size: 6 },
      { key: "colony-radar-mast", url: "/colony-radar-mast.glb", tris: 52, bytes: 6280, sha256: "adbaee0743aa510535103a65ed25c928e11775438f4511def5d0695d72da4f74", size: 6 },
      { key: "colony-reactor", url: "/colony-reactor.glb", tris: 376, bytes: 25144, sha256: "16ba6190a6676e46e9cc1d6b905708b3277d4897db5cdd65de254e06e1567bec", size: 6 },
      { key: "colony-robot-helper", url: "/colony-robot-helper.glb", tris: 92, bytes: 9496, sha256: "2cebdb360207fce2a18f304134f35d10ffcc6a0552adab9cea791c4363d48bc3", size: 6 },
      { key: "colony-rover", url: "/colony-rover.glb", tris: 204, bytes: 16200, sha256: "0c41c6e64ed00b1bc358c926cf2b08ae08c946e9fc15d27893f54af72d88f93f", size: 6 },
      { key: "colony-solar-array", url: "/colony-solar-array.glb", tris: 60, bytes: 6336, sha256: "1b220cd7b1c843aeb5e7249b8373801a0b36637218b56d1655b7f0145066939b", size: 6 },
      { key: "colony-solar-panel", url: "/colony-solar-panel.glb", tris: 36, bytes: 5324, sha256: "705db4c9c59665937ebdd8fc1b33cd98faec3b4bafab567550025cd8e93c0a1c", size: 6 },
      { key: "colony-water-tank", url: "/colony-water-tank.glb", tris: 100, bytes: 8532, sha256: "18fd45ec7c20ecc5e7324b12a135c9a4dce751c0562326bbb55295dbd350eabc", size: 6 },
      { key: "colony-wind-turbine", url: "/colony-wind-turbine.glb", tris: 72, bytes: 8444, sha256: "367b738060052630b13bdd6ea5e841e3c4ffd44eb6d30250ec53bb084c6ec070", size: 9 },
    ],
  },
  {
    key: "station-stores",
    name: "Station Stores",
    models: [
      { key: "stationpack-airlock-door", url: "/stationpack-airlock-door.glb", tris: 108, bytes: 12108, sha256: "10b8e359721f7b804eaf0e2d47368b97abb08549a3c44e6d06b8acc1f16fb267", size: 6 },
      { key: "stationpack-antenna-dish", url: "/stationpack-antenna-dish.glb", tris: 136, bytes: 13256, sha256: "b4ee064ec5a8b8beb579af7644f338a4d194f02398227db53735d09ee648c2da", size: 6 },
      { key: "stationpack-astronaut-suit", url: "/stationpack-astronaut-suit.glb", tris: 148, bytes: 16640, sha256: "e1664d6327e29d6fad60e683c2f6458e978b33c4e211c45b566f6dd87eef71f8", size: 6 },
      { key: "stationpack-captain-chair", url: "/stationpack-captain-chair.glb", tris: 124, bytes: 12188, sha256: "ff8739d6447a82f4e0e4930361888c772be6845f0375bfc0357d47ae7c2c8525", size: 6 },
      { key: "stationpack-cargo-crate", url: "/stationpack-cargo-crate.glb", tris: 48, bytes: 6140, sha256: "cd7530e65ca2284095bb0cda6dece1c06c195d08650aaa01131128933ff3da05", size: 6 },
      { key: "stationpack-cargo-crate-small", url: "/stationpack-cargo-crate-small.glb", tris: 36, bytes: 5336, sha256: "ea7f039ad79de2652175b90cc508330e3e54daffc51107af9b02ffebd5c89331", size: 6 },
      { key: "stationpack-control-console", url: "/stationpack-control-console.glb", tris: 96, bytes: 11636, sha256: "b23c407da347705be8e044264ca5080f94ab8b78d1bc642867784c4f658f246a", size: 6 },
      { key: "stationpack-corridor-corner", url: "/stationpack-corridor-corner.glb", tris: 72, bytes: 8636, sha256: "d2be7fb0b97997ec44d500c0e6ad6adef860092ff7d1455601ee1e80bd4358a3", size: 6 },
      { key: "stationpack-corridor-straight", url: "/stationpack-corridor-straight.glb", tris: 108, bytes: 11360, sha256: "e841e02041548a9f21b98566e78f645a4dfc5c4e016472908c8888f376487bec", size: 6 },
      { key: "stationpack-crew-bunk", url: "/stationpack-crew-bunk.glb", tris: 96, bytes: 11028, sha256: "38307721a795cf2936b3d3b6932da0d74fc795fd53942c9aec02106eabf3c956", size: 6 },
      { key: "stationpack-drone-bot", url: "/stationpack-drone-bot.glb", tris: 188, bytes: 18444, sha256: "d34b6b36dc69a6845f3c132df7b1653bf6b826579f387dd5352a745d345f47da", size: 6 },
      { key: "stationpack-escape-pod", url: "/stationpack-escape-pod.glb", tris: 172, bytes: 16052, sha256: "b8eb11ff63921e0a16707c3b895649e79031e13e05f37092ed2a1588fc3ee345", size: 6 },
      { key: "stationpack-holo-table", url: "/stationpack-holo-table.glb", tris: 144, bytes: 12116, sha256: "f5f5a45789ff904b8d1fa293b585d1f5cd8c8787b70ecffb1e027ade926a4936", size: 6 },
      { key: "stationpack-hull-panel", url: "/stationpack-hull-panel.glb", tris: 104, bytes: 9572, sha256: "ada41023c896de6f30320c28e86529a4bf6949169b2c1fa501baf068841d0505", size: 6 },
      { key: "stationpack-hydroponic-planter", url: "/stationpack-hydroponic-planter.glb", tris: 160, bytes: 19176, sha256: "6add5ddcb650896282ce5a3b929e82367350e328374e99d5e4fc2013b6c0537d", size: 6 },
      { key: "stationpack-light-strip", url: "/stationpack-light-strip.glb", tris: 24, bytes: 3580, sha256: "b84932d8173ddac247e714c20d6a00e57acc9b0a88117928598dd2ce16870d34", size: 6 },
      { key: "stationpack-oxygen-tank", url: "/stationpack-oxygen-tank.glb", tris: 160, bytes: 14876, sha256: "8d341f7cc18abd5e8068e5dc50e7d1cdf14306995f6501fe406f722fbbc45ce5", size: 6 },
      { key: "stationpack-pipe-straight", url: "/stationpack-pipe-straight.glb", tris: 144, bytes: 11432, sha256: "b39c82c4e95a7a309f28fe8d8540a9c1c14574fdca2653df63d48b883a5362e0", size: 6 },
      { key: "stationpack-radar-display", url: "/stationpack-radar-display.glb", tris: 180, bytes: 14840, sha256: "d94d7b8033de08096041969f39b81380b2cd92390a490f0e48d94a4f5640c9ff", size: 6 },
      { key: "stationpack-reactor-core", url: "/stationpack-reactor-core.glb", tris: 252, bytes: 20080, sha256: "bd7bf267c82f8c3ed6bb6a3b69f114fba0075328935ecb0b530edb839fab79ea", size: 6 },
      { key: "stationpack-sliding-door", url: "/stationpack-sliding-door.glb", tris: 72, bytes: 8260, sha256: "79e47a217d2dc391f79cfb6b927740ed4b9324f049e961423bfa9ccd2b9b30c9", size: 6 },
      { key: "stationpack-solar-panel", url: "/stationpack-solar-panel.glb", tris: 136, bytes: 13388, sha256: "ab89b4d759fb5aac2135d0cd927b124135d53bfe7fcda142d78e14c664936e86", size: 6 },
      { key: "stationpack-stairs-metal", url: "/stationpack-stairs-metal.glb", tris: 108, bytes: 9704, sha256: "b9866b28a85dc89aaf777f55325b1a20e76ba3be1bd857f53876dffdec7c91ae", size: 6 },
      { key: "stationpack-storage-locker", url: "/stationpack-storage-locker.glb", tris: 60, bytes: 7732, sha256: "9a7e7872887d8d3ee0fe47f375b20020f7661ce2092c4ba3e5280e0dce8e7c04", size: 6 },
      { key: "stationpack-terminal-wall", url: "/stationpack-terminal-wall.glb", tris: 48, bytes: 7040, sha256: "4fef97a489deb3afc8a897a5e916344c9de0590f73565a3de2588f8753f13b7a", size: 6 },
      { key: "stationpack-vent-fan", url: "/stationpack-vent-fan.glb", tris: 92, bytes: 8952, sha256: "d824c734588af25967ececbc97bdb59ad45019d446c0bf2467b8c73272d31fd7", size: 6 },
      { key: "stationpack-warning-sign", url: "/stationpack-warning-sign.glb", tris: 72, bytes: 7468, sha256: "546446a990a86a351b80c5b35cef4e9f8fb3aeb5a8d92eadfe2e7cfc0808a2bd", size: 6 },
      { key: "stationpack-window-pane", url: "/stationpack-window-pane.glb", tris: 60, bytes: 6344, sha256: "e53d09fcd752779ce8ab4d6e66270e155a7b6c6018cbc197624a94ab21afbd5f", size: 6 },
      { key: "kenney-container-tall", url: "/kenney-container-tall.glb", tris: 116, bytes: 13052, sha256: "e790f12cdab2e50d266d54e1bbb8a05a1cd77629a065254be3734a67b6053358", size: 6 },
      { key: "kenney-rocks", url: "/kenney-rocks.glb", tris: 80, bytes: 9308, sha256: "cdad530e15972f1f3cdf4dec1d1ca2d3b9406b46c2bbd67bb67abf3bbf173aa3", size: 6 },
      { key: "kenney-structure", url: "/kenney-structure.glb", tris: 144, bytes: 29828, sha256: "ef12f1eaec019116ece1aebb0c512ce19a5cbc385f7a393c62d9f32f129cf088", size: 6 },
      { key: "kenney-table-display-planet", url: "/kenney-table-display-planet.glb", tris: 140, bytes: 16740, sha256: "55f4055020546163a7bc4b025d150b128917a046f903def087a9cc52767fa68a", size: 6 },
    ],
  },
];

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
    ...STATION_CLUSTERS.flatMap((c) => c.models.map((m) => m.url)),
    ...STATION_BACKDROP_PLANETS.map((m) => m.url),
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
 * Merge a whole annex cluster — every model of one pack — to ONE mesh
 * with ONE material (the Kenney treatment, at settlement scale). Each
 * model's meshes bake their world transforms, merge into that model's
 * own geometry (so a multi-part model's layout survives), then the
 * model is recentered, fitted to its manifest size, and set down on
 * the deck (base at y = 0) at its disc offset. Only position + normal
 * survive (the single material needs nothing else); normals are
 * computed when a file omits them, so every part merges cleanly.
 * Returns null when anything cannot merge — the caller omits the
 * settlement whole, never half-shipped.
 */
export function mergeClusterToSingleMaterial(
  models: readonly {
    root: THREE.Object3D;
    offset: readonly [number, number];
    size: number;
  }[],
  color: number = STATION_PALETTE.hullGunmetal,
): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const { root, offset, size } of models) {
    const meshes = collectMeshes(root);
    if (meshes.length === 0) return null;
    root.updateWorldMatrix(true, true);
    const parts: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      // Expand indexed geometry first: dropping the index would
      // corrupt the faces (a box's 24 vertices only form 12 triangles
      // through its 36-entry index). Non-indexed parts pass through.
      const expanded = baked.index ? baked.toNonIndexed() : baked;
      const position = expanded.getAttribute("position");
      if (!position) return null;
      const stripped = new THREE.BufferGeometry();
      stripped.setAttribute("position", position);
      const normal = expanded.getAttribute("normal");
      if (normal) stripped.setAttribute("normal", normal);
      if (!stripped.getAttribute("normal")) stripped.computeVertexNormals();
      parts.push(stripped);
    }
    const first = parts[0];
    if (!first) return null;
    const modelGeo = parts.length === 1 ? first : mergeGeometries(parts, false);
    if (!modelGeo) return null;
    recenterGeometry(modelGeo);
    scaleGeometryToSize(modelGeo, size);
    modelGeo.computeBoundingBox();
    const box = modelGeo.boundingBox;
    if (!box) return null;
    // Set down on the deck: the model's base sits at y = 0.
    modelGeo.translate(offset[0], -box.min.y, offset[1]);
    geos.push(modelGeo);
  }
  if (geos.length === 0) return null;
  const first = geos[0];
  if (!first) return null;
  const merged = geos.length === 1 ? first : mergeGeometries(geos, false);
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
