import { SCALE_SEED } from "./scaleLayout.js";

/**
 * Scale's asset layer (Phase 3, Scale world) — the single source of truth
 * for what the space is made of. It follows the stationAssets.ts /
 * peopleAssets.ts pattern (one manifest, named forms, measured geometry).
 *
 * External assets (all NASA, public domain — see public/CREDITS.md and
 * WorldCredits; the full measurement record is in the build record):
 * - ISS (A) — the catalog's low-poly model: 6,642 tris, 39,708 bytes,
 *   bbox 37.77 × 22.67 × 23.54, 1 mesh, 6 flat materials, no embedded
 *   images, Draco-compressed. SHA-256
 *   70d0619a69312a45cbf740ba9a491fad854e10226dc5936c213fb1f93f063678.
 *   ISS (B) is NOT used — 174,440 tris, ~26× heavier.
 * - The four probes, all NASA public domain, all Draco-compressed:
 *   Kepler-A 9,042 tris, Pioneer 10 8,189 tris, Dawn 32,096 tris,
 *   Voyager-A 29,911 tris (measured from the files, 2026-10-27).
 *
 * NONE of these files can go through the API push — the owner uploads
 * them via the GitHub web UI from the manifest in the build record (the
 * P2-6 pattern). Until a file lands, its load resolves null and the
 * scene renders its honest fallback: the ISS keeps a wireframe truss
 * (the Profondo pattern, registered via noteModelFallback), a missing
 * probe is simply absent. No procedural stand-in is ever presented as
 * the real thing.
 *
 * Insignia verdict (this build's recon, design note §1 Q3): the ISS (A)
 * file has a single node named "ISS", six flat materials, and no embedded
 * images — no geometry-level insignia, flag, or lettering found by name
 * inspection, so there is nothing to scrub. (Limit, recorded honestly:
 * name inspection, not a triangle-by-triangle visual check.)
 *
 * The palette (recipe-scale.md): true black, solar gold, the station's
 * own white — the station is real, and its colors are its own, not the
 * seed's. The seed governs the space around it (backdrop, witnesses,
 * light), never the station's own materials. Cyan always means
 * navigation truth (lane markers, approach strobes, gate-side beacons).
 */

/** The recipe seed, shared with the layout so scene and layout can never drift apart. */
export { SCALE_SEED };

/** True black, solar gold, the station's own white. */
export const SCALE_PALETTE = {
  /** The sky itself: true black, no nebula, no fog. */
  backdrop: 0x000000,
  /** Solar gold — the station's panels catching the sun. */
  solarGold: 0xffc95e,
  /** The station's own white, ungraded. */
  stationWhite: 0xf2f0ea,
  /** Cyan = navigation truth only: lane markers, approach strobes, gate beacons. */
  guidanceCyan: 0x7af9ff,
  /** The survey frame's thin light. */
  surveyFrame: 0x7af9ff,
  /** The docked capsule: plain white metal, a witness of known size. */
  capsule: 0xe8e6e0,
  /** Asteroids: dim grey rock, barely lit — small true things in a vast dark. */
  asteroid: 0x8a8a8a,
  /** Merged visitors (encounters, outpost, debris satellite): pale grey, one material —
   *  the Kenney treatment — form reads at distance, per-material accents don't. */
  visitor: 0xcfd2dd,
} as const;

/** The hero model, served from the public path once the owner uploads it. */
export const SCALE_ISS_ASSET = {
  slug: "iss-a",
  name: "International Space Station",
  url: "/ISS-A.glb",
  tris: 6642,
  bytes: 39708,
  sha256: "70d0619a69312a45cbf740ba9a491fad854e10226dc5936c213fb1f93f063678",
  license: "Public domain (NASA 3D Resources)",
} as const;

/** The four probes, served from their public paths once the owner uploads them. */
export const SCALE_PROBE_ASSETS: readonly {
  slug: string;
  name: string;
  url: string;
  tris: number;
  bytes: number;
  license: string;
}[] = [
  {
    slug: "kepler",
    name: "Kepler",
    url: "/nasa-probes/Kepler-A.glb",
    tris: 9042,
    bytes: 2003276,
    license: "Public domain (NASA 3D Resources)",
  },
  {
    slug: "pioneer-10",
    name: "Pioneer 10",
    url: "/nasa-probes/Pioneer10.glb",
    tris: 8189,
    bytes: 2049840,
    license: "Public domain (NASA 3D Resources)",
  },
  {
    slug: "dawn",
    name: "Dawn",
    url: "/nasa-probes/Dawn.glb",
    tris: 32096,
    bytes: 927020,
    license: "Public domain (NASA 3D Resources)",
  },
  {
    slug: "voyager",
    name: "Voyager 1",
    url: "/nasa-probes/Voyager-A.glb",
    tris: 29911,
    bytes: 285936,
    license: "Public domain (NASA 3D Resources)",
  },
];

/** Every external asset this world loads, in one place for the upload manifest. */
export const SCALE_EXTERNAL_ASSETS: readonly { key: string; url: string; license: string }[] = [
  { key: SCALE_ISS_ASSET.slug, url: SCALE_ISS_ASSET.url, license: SCALE_ISS_ASSET.license },
  ...SCALE_PROBE_ASSETS.map((p) => ({ key: p.slug, url: p.url, license: p.license })),
];

/**
 * Low-poly Space Pack (reodesuxz, itch.io) + FlexUnit UFO — the
 * population increment (2026-10-27, owner's build-all order: every
 * model gets a job). Measured from the files on 2026-10-27
 * (ships-hunt/itchio-2026-10-27.md): 4,868 tris across the 26 pack
 * models — exactly the README claim — plus the FlexUnit UFO at 4,220
 * tris (FBX→GLB via FBX2glTF v0.9.7; its converted bbox is tiny,
 * so it is scaled up on placement like the probes).
 *
 * Licenses: the pack is free for commercial use with no attribution
 * required, but the raw files must NOT be redistributed as standalone
 * assets or in another pack — in-app use only. The UFO is CC0.
 * See public/CREDITS.md and WorldCredits.
 *
 * All URLs are flat in `public/` (the app's convention). The GLBs land
 * via the GitHub web UI (binaries cannot ride the API push); until
 * they land, every load resolves null and the scene runs without that
 * body — never a procedural stand-in, never a crash.
 */
export interface ScaleLowPolyAsset {
  key: string;
  name: string;
  url: string;
  /** Measured triangles of the shipped file. */
  tris: number;
  /** Material count of the shipped file (= draw calls when loaded as-is). */
  materials: number;
  bytes: number;
  sha256: string;
}

/** Planets as floating bodies — loaded as-is, colors kept (their look IS their materials). */
export const SCALE_PLANET_ASSETS: readonly ScaleLowPolyAsset[] = [
  {
    key: "planet_earth",
    name: "Earth",
    url: "/lowpoly-planet_earth.glb",
    tris: 140,
    materials: 3,
    bytes: 17356,
    sha256: "462fc366651ac0698b9781ce0f24186f5817ca4adc4ecbef415a2691ffe3dea2",
  },
  {
    key: "planet_mars",
    name: "Mars",
    url: "/lowpoly-planet_mars.glb",
    tris: 140,
    materials: 3,
    bytes: 17320,
    sha256: "3226183282988de68218245d8c7932fde47bb95bd9945d50a28eae40991e5873",
  },
  {
    key: "planet_jupiter",
    name: "Jupiter",
    url: "/lowpoly-planet_jupiter.glb",
    tris: 464,
    materials: 3,
    bytes: 38120,
    sha256: "a5a2d14934194847e8c4881fedac4b79d0e5bd0f7d618327bf868630845ce8f1",
  },
  {
    key: "planet_saturn",
    name: "Saturn",
    url: "/lowpoly-planet_saturn.glb",
    tris: 400,
    materials: 2,
    bytes: 32712,
    sha256: "e0f5d6a101dbbaa42fee4e3408378dbf4bc6e1102c96fff41c1d155d65d306d4",
  },
];

/** The moon, with its outpost riding on it (the outpost offsets derive from the moon's scaled radius — see scaleLayout.ts). */
export const SCALE_MOON_ASSET: ScaleLowPolyAsset = {
  key: "moon_cratered",
  name: "The Moon",
  url: "/lowpoly-moon_cratered.glb",
  tris: 192,
  materials: 2,
  bytes: 17112,
  sha256: "7095132a03219e49bd643949d2813834fd068809ce9c141ab48d97b9434f7fc5",
};

/** The moon outpost: dome, rover, and flag — merged to one material each (the Kenney treatment). */
export const SCALE_MOON_OUTPOST_ASSETS: readonly ScaleLowPolyAsset[] = [
  {
    key: "moon_base_dome",
    name: "Moon base dome",
    url: "/lowpoly-moon_base_dome.glb",
    tris: 148,
    materials: 4,
    bytes: 16140,
    sha256: "b8f3296c18160efa18e2262fd5b2e12092cc9bbbe1df1eb0a0e8c5be0032bb86",
  },
  {
    key: "moon_rover",
    name: "Moon rover",
    url: "/lowpoly-moon_rover.glb",
    tris: 232,
    materials: 5,
    bytes: 18948,
    sha256: "48b4f7d2273741e8511c64c2da351a1c3cb95c606f068ce346e7e4f6d6b49942",
  },
  {
    key: "flag_pole",
    name: "Flag pole",
    url: "/lowpoly-flag_pole.glb",
    tris: 72,
    materials: 4,
    bytes: 8392,
    sha256: "1f7ba6961495516423f5e39da633fa8f8fa07cfb1efcbafd208f76f1d695cc5e",
  },
];

/** The asteroid belts: big and small bodies, instanced at the 60 seed positions (mergeByMaterial cost = material count). */
export const SCALE_BELT_ASSETS: readonly ScaleLowPolyAsset[] = [
  {
    key: "asteroid_big",
    name: "Asteroid (large)",
    url: "/lowpoly-asteroid_big.glb",
    tris: 40,
    materials: 2,
    bytes: 6216,
    sha256: "c890cc8efbe3b963c0961b3f51ce1128e0e9e1b3251951060f5d185c4b16c800",
  },
  {
    key: "asteroid_small",
    name: "Asteroid (small)",
    url: "/lowpoly-asteroid_small.glb",
    tris: 20,
    materials: 1,
    bytes: 3264,
    sha256: "3a0246e367292bbb0d718e1ee5771d6377ad1ff0d699ea6474d23053fb3c492d",
  },
];

/** Encounters — rare, slow-drift, far out (merged to one material each, the Kenney treatment: form reads at distance, accents don't). */
export const SCALE_ENCOUNTER_ASSETS: readonly ScaleLowPolyAsset[] = [
  {
    key: "alien",
    name: "Alien",
    url: "/lowpoly-alien.glb",
    tris: 144,
    materials: 3,
    bytes: 16292,
    sha256: "d21d22f76414a68eaeff41e76787c219e11f7aa7aa2653c3f907f9c5ecd76ac7",
  },
  {
    key: "astronaut",
    name: "Astronaut",
    url: "/lowpoly-astronaut.glb",
    tris: 128,
    materials: 4,
    bytes: 13372,
    sha256: "a4bcd23dc7c2078c99846578e876c2275bb2f1fd950f2e8716bef61e539e42c7",
  },
  {
    key: "flexunit-ufo",
    name: "FlexUnit UFO",
    url: "/flexunit-ufo.glb",
    tris: 4220,
    materials: 4,
    bytes: 131396,
    sha256: "0dc865456808c3fe27fae024cd3e4bde0e59116f43f667fc151c08fa0b9df2cd",
  },
  {
    key: "ufo",
    name: "UFO",
    url: "/lowpoly-ufo.glb",
    tris: 304,
    materials: 3,
    bytes: 26908,
    sha256: "30d43750cbcf1501b22645449e21621c7f1c264db69d1e4d7b2fcdb0261385ae",
  },
];

/** Drifting debris satellite (merged to one material). */
export const SCALE_SATELLITE_ASSET: ScaleLowPolyAsset = {
  key: "satellite_a",
  name: "Satellite A",
  url: "/lowpoly-satellite_a.glb",
  tris: 152,
  materials: 4,
  bytes: 13924,
  sha256: "433ac7e0b54ba39ba07f798a25f8350173c680a7a3fcf259ce0e37fadb00eb47",
};

/** Every low-poly URL this world loads (the upload manifest for this increment). */
export const SCALE_LOW_POLY_URLS: readonly string[] = [
  ...SCALE_PLANET_ASSETS.map((m) => m.url),
  SCALE_MOON_ASSET.url,
  ...SCALE_MOON_OUTPOST_ASSETS.map((m) => m.url),
  ...SCALE_BELT_ASSETS.map((m) => m.url),
  ...SCALE_ENCOUNTER_ASSETS.map((m) => m.url),
  SCALE_SATELLITE_ASSET.url,
];
