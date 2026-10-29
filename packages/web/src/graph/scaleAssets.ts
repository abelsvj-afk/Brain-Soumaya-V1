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

/**
 * Hunt #2 (space-hunt-2, 2026-10-27, owner's build-all order) — every
 * measured model that fits the Scale budget gets a job here. Measured
 * from the files (space-hunt-2-measure.json); licenses in
 * public/CREDITS.md and WorldCredits. All URLs are flat in `public/`;
 * the GLBs land via the GitHub web UI, and until they land every load
 * resolves null and the body is simply absent — never a stand-in.
 *
 * Measured and LEFT OUT, with reasons (the build record has the full
 * list): the Dilley solar system (11 calls for 2,880 tris — worst
 * ratio in the haul); the Jarlan solar system (15,862 tris, 14 calls);
 * the Poly Pizza Moon (6,456 tris — the reodesuxz moon already holds
 * the job at 192); the Poly Pizza ISS (4,308 tris — a stylised
 * duplicate of the real NASA ISS, which is this world's hero); the
 * single Quaternius Star (90 tris — its job is the Sun's, and the call
 * budget sits exactly at its ceiling); CasA A/B (574,678 / 529,724
 * tris — either breaks the 500k cap alone); Cygnus Loop (285,088 —
 * over half the cap; G292 holds the supernova job); Pillars 2
 * (136,150 — the same subject as Pillar 1B at 5.5x the cost).
 */
export interface ScaleHunt2Asset extends ScaleLowPolyAsset {
  license: string;
}

/** Hunt-2 planets as floating bodies — loaded as-is, colors kept. */
export const SCALE_HUNT2_PLANET_ASSETS: readonly ScaleHunt2Asset[] = [
  {
    key: "quaternius-planet-1",
    name: "Planet 1 (Quaternius)",
    url: "/pp-planet-1.glb",
    tris: 2586,
    materials: 1,
    bytes: 88696,
    sha256: "83b6fd9000a8b210bb6f9e62b3e8a401958e01d2d4f153d79f5080754c76db6c",
    license: "CC0 1.0 (Quaternius)",
  },
  {
    key: "quaternius-planet-2",
    name: "Planet 2 (Quaternius)",
    url: "/pp-planet-2.glb",
    tris: 2010,
    materials: 1,
    bytes: 74072,
    sha256: "67c67ac2b2f5af3f6c1f549b696b6872ef0b818e8c005420794d6175164ed674",
    license: "CC0 1.0 (Quaternius)",
  },
  {
    key: "quaternius-planet-3",
    name: "Planet 3 (Quaternius)",
    url: "/pp-planet-3.glb",
    tris: 2178,
    materials: 1,
    bytes: 86312,
    sha256: "db0f8c45c856170f6b6e5592337c3f3125ed5164269829fdf5d60206147d4201",
    license: "CC0 1.0 (Quaternius)",
  },
  {
    key: "planets-set",
    name: "Planets (set)",
    url: "/pp-planets-set.glb",
    tris: 1164,
    materials: 2,
    bytes: 2733732,
    sha256: "354335837b10c000bb1459fc4cb3d614553fce75f16925671c2ffaec941e7e3a",
    license: "CC-BY 3.0 (Poly by Google)",
  },
  {
    key: "earth-and-moon",
    name: "Earth and Moon",
    url: "/pp-earth-and-moon.glb",
    tris: 1524,
    materials: 3,
    bytes: 119164,
    sha256: "f2bcc8f539639a7ccd4dd71003eb2442a1e484ea784d97e168cc5cd90d163507",
    license: "CC-BY 3.0 (Jarlan Perez)",
  },
  {
    key: "pixel-brown-dwarf",
    name: "Pixel Planet WISE 0855-0714",
    url: "/pp-pixel-brown-dwarf.glb",
    tris: 300,
    materials: 1,
    bytes: 105716,
    sha256: "c34f45b9c87cbd309d426bbb03ef982a01967d74a80ff5a497fc58ec37e13f49",
    license: "CC0 1.0 (AstroJar)",
  },
  {
    key: "sun",
    name: "Sun",
    url: "/pp-sun.glb",
    tris: 224,
    materials: 2,
    bytes: 20724,
    sha256: "e9dc92c81801fab1c1de39a4937c4f0d991169ccde54d4252510253f85c5b92f",
    license: "CC-BY 3.0 (Poly by Google)",
  },
  {
    key: "stars",
    name: "Stars",
    url: "/pp-stars.glb",
    tris: 120,
    materials: 1,
    bytes: 141828,
    sha256: "42f2fe3aa40965362fd8d80affad758a64f5a998acda9d6a2b759b81b5ce9458",
    license: "CC-BY 3.0 (MiniPoly)",
  },
];


/** The Hubble telescope — the one hunt-2 encounter (merged to one material, like the others). */
export const SCALE_HUNT2_HUBBLE_ASSET: ScaleHunt2Asset =   {
    key: "hubble",
    name: "Hubble telescope",
    url: "/pp-hubble.glb",
    tris: 684,
    materials: 1,
    bytes: 1182732,
    sha256: "b9d3e3855522cf8961836d76c7f268a029667a246f0a524f68cfe29301024f13",
    license: "CC-BY 3.0 (Poly by Google)",
  };

/** Placed belt pieces at the field's edge — big named rocks, not the instanced field. */
export const SCALE_BELT_PIECE_ASSETS: readonly ScaleHunt2Asset[] = [
  {
    key: "belt-strip",
    name: "Asteroids (Jarlan)",
    url: "/pp-belt-strip.glb",
    tris: 6840,
    materials: 1,
    bytes: 526328,
    sha256: "4f69068096826431d4071af230bbaca4e9d66c7ac94a6497e7a37a41ea6d597a",
    license: "CC-BY 3.0 (Jarlan Perez)",
  },
  {
    key: "bennu",
    name: "Bennu",
    url: "/nasa-bennu.glb",
    tris: 18240,
    materials: 1,
    bytes: 329596,
    sha256: "644af15678447df90c2d9e85674809c7fc70f439e0865418aa6618a8483b7958",
    license: "Public domain (NASA 3D Resources)",
  },
  {
    key: "asteroid-large",
    name: "Asteroid",
    url: "/pp-asteroid-large.glb",
    tris: 1678,
    materials: 1,
    bytes: 734132,
    sha256: "f3efc0c737625225639f9a0ab13d27e656b48010344a8f641486b620c3befe03",
    license: "CC-BY 3.0 (Poly by Google)",
  },
  {
    key: "debris-pile",
    name: "Debris Pile",
    url: "/pp-debris-pile.glb",
    tris: 424,
    materials: 3,
    bytes: 26776,
    sha256: "9c4c150605aec485eda18c3906b1adc6576f491076428a2a2d3f5949a0b97163",
    license: "CC0 1.0 (Quaternius)",
  },
  {
    key: "asteroid-toastie",
    name: "Asteroid (J-Toastie)",
    url: "/pp-asteroid-toastie.glb",
    tris: 304,
    materials: 1,
    bytes: 23176,
    sha256: "5d7fa9e29b5da9b54a0b348806541fa83d1707040d151ec35504b838ddcb26cd",
    license: "CC-BY 3.0 (J-Toastie)",
  },
  {
    key: "rubble-rocks",
    name: "Rubble Rocks",
    url: "/pp-rubble-rocks.glb",
    tris: 152,
    materials: 3,
    bytes: 24116,
    sha256: "b9e405968f24fe93432d308a0b51914337cda4509f17d5b241a5931bf4605aaf",
    license: "CC-BY 3.0 (Kyle Hickman)",
  },
];


/** Heavy centerpieces, far out and dim — the black hole and G292 load
 * as-is; Pillars 1B and the gas cloud carry no color of their own and
 * are given the nebula material in the scene. */
export const SCALE_CENTERPIECE_ASSETS: readonly ScaleHunt2Asset[] = [
  {
    key: "black-hole",
    name: "Black hole",
    url: "/pp-black-hole.glb",
    tris: 1572,
    materials: 1,
    bytes: 1892040,
    sha256: "53f351bd7ccfe5b8a3d859a36713f1c90a9ce3a8dfa473e0360e6ccc1d45b2d2",
    license: "CC-BY 3.0 (Poly by Google)",
  },
  {
    key: "pillars-1b",
    name: "Pillars of Creation (Pillar 1B)",
    url: "/nasa-pillars-1b.glb",
    tris: 24576,
    materials: 1,
    bytes: 2065448,
    sha256: "10d9732bb21bb3ad24d0b446c8c32b111a3b82d7ea6abaef0d6d8891cf664c84",
    license: "Public domain (NASA 3D Resources / STScI)",
  },
  {
    key: "g292",
    name: "G292.0+1.8",
    url: "/nasa-g292.glb",
    tris: 122304,
    materials: 1,
    bytes: 1200552,
    sha256: "20973fcaa3bd36cbaa8cfc4f347f31bb97b56513ffd686d7b53bd1508a4af2da",
    license: "Public domain (NASA 3D Resources)",
  },
];


/** The gas cloud — a nebula-material centerpiece, listed separately so
 * the scene can treat it as the fourth centerpiece without a second
 * materials decision. */
export const SCALE_CLOUD_ASSET: ScaleHunt2Asset =   {
    key: "gas-cloud",
    name: "Cloud",
    url: "/pp-gas-cloud.glb",
    tris: 816,
    materials: 1,
    bytes: 45856,
    sha256: "dad81f64d3566030dbe9fdd77453af10fb02c79a80d6e4189fdf46d8db41dd24",
    license: "CC-BY 3.0 (jeremy)",
  };

/** Distant nebula light: three OGA renders as huge static backdrop
 * planes far outside the orbit. They are pictures of nebulas, not 3D
 * nebulas — distant light only, per the owner's 2026-10-27 direction
 * (which overrides the Rev 123 "no nebula planes" line, bounded:
 * distant light only, never a body, never fog). */
export const SCALE_NEBULA_PLANE_ASSETS: readonly ScaleHunt2Asset[] = [
  {
    key: "nebula-01",
    name: "Nebula render",
    url: "/oga-nebula-01.jpg",
    tris: 0,
    materials: 1,
    bytes: 156157,
    sha256: "6a418216f50ebda2bcec1e2dbcaed198df754fcb4bd33e09d1a592778589fe15",
    license: "CC-BY 3.0 (Jattenalle, OpenGameArt)",
  },
  {
    key: "nebula-02",
    name: "Nebula render",
    url: "/oga-nebula-02.jpg",
    tris: 0,
    materials: 1,
    bytes: 99182,
    sha256: "c9eb261443dfa43bf3b2f23bdf7937343a71996661d87e961239d331455e398e",
    license: "CC-BY 3.0 (Jattenalle, OpenGameArt)",
  },
  {
    key: "nebula-03",
    name: "Nebula render",
    url: "/oga-nebula-03.jpg",
    tris: 0,
    materials: 1,
    bytes: 310569,
    sha256: "b056fca95526ac458e9cbac91a0c1fc4ad7466a432d80b34477bc756ba6abe66",
    license: "CC-BY 3.0 (Jattenalle, OpenGameArt)",
  },
];


/** Every hunt-2 URL Scale loads (the upload manifest for this increment). */
export const SCALE_HUNT2_URLS: readonly string[] = [
  "/pp-planet-1.glb",
  "/pp-planet-2.glb",
  "/pp-planet-3.glb",
  "/pp-planets-set.glb",
  "/pp-earth-and-moon.glb",
  "/pp-pixel-brown-dwarf.glb",
  "/pp-sun.glb",
  "/pp-stars.glb",
  "/pp-hubble.glb",
  "/pp-belt-strip.glb",
  "/nasa-bennu.glb",
  "/pp-asteroid-large.glb",
  "/pp-debris-pile.glb",
  "/pp-asteroid-toastie.glb",
  "/pp-rubble-rocks.glb",
  "/pp-black-hole.glb",
  "/nasa-pillars-1b.glb",
  "/nasa-g292.glb",
  "/pp-gas-cloud.glb",
  "/oga-nebula-01.jpg",
  "/oga-nebula-02.jpg",
  "/oga-nebula-03.jpg",
];

/**
 * Sketchfab long game, landed 2026-10-27 — the owner downloaded these
 * himself (the Epic→Sketchfab sign-in never cleared its captcha in the
 * automated browser, so he pulled them on his own connection). All four
 * are CC-BY 4.0, licenses verified from each file's own asset extras;
 * see public/CREDITS.md and WorldCredits. All URLs are flat in
 * `public/`; the GLBs land via the GitHub web UI, and until they land
 * every load resolves null and the body is simply absent — never a
 * stand-in.
 *
 * The three black holes, so the roles stay straight: the app's own
 * `blackhole.glb` (NestaEric, 534,196 tris, spec
 * docs/specs/blackhole-singularity.md) is the unplaced singularity,
 * still awaiting its placement decision; the Poly Pizza black hole
 * (1,572 tris, static) holds the far-out Scale centerpiece; this
 * Sketchfab black hole (10,216 tris, animated disk) is the second,
 * nearer Scale centerpiece — the one that visibly turns.
 *
 * NOT here: the two Aiekick supernova remnants (2,168,851 points
 * each, the same point cloud twice — they are POINTS, not triangles:
 * 0 tris, so the old "722,950 tris" count was a miscount from
 * dividing the point count by three. Each breaks the spirit of the
 * cap at full size). Only a slimmed derivative ships, in the Deep
 * Past, not here. The animated "Supernova" (anim: 2) from the hunt
 * list is a different model — tamminen's, 161,280 tris, 2 animations —
 * downloaded 2026-10-27 and HELD (no placement direction yet).
 */
export interface ScaleSketchfabAsset extends ScaleLowPolyAsset {
  license: string;
}

/** Sketchfab centerpieces — loaded as-is, all materials kept: the
 * nebula's four emissive layers and the black hole's transmission disk
 * ARE their look, so neither merges to one material. */
export const SCALE_SKETCHFAB_CENTERPIECE_ASSETS: readonly ScaleSketchfabAsset[] = [
  {
    key: "planetary-nebula",
    name: "Planetary Nebula",
    url: "/sf-planetary-nebula.glb",
    tris: 146636,
    materials: 4,
    bytes: 4601184,
    sha256: "74f8c0295453f1befebdfca882f1a3c8db4ced37a922ccd2fce5320f2e7259bf",
    license: "CC-BY 4.0 (Tycho Magnetic Anomaly)",
  },
  {
    key: "sf-black-hole",
    name: "Black hole (Sketchfab)",
    url: "/sf-black-hole.glb",
    tris: 10216,
    materials: 4,
    bytes: 356728,
    sha256: "a85b28aa72cba6b83eb8f74f8e1677adf0aec44e34a2eb9c84e0b611e04eaa3c",
    license: "CC-BY 4.0 (SebastianSosnowski)",
  },
];

/** The pulsar — an encounter, loaded as-is: its unlit emissive
 * materials are the glow, so it never merges to the visitor grey. */
export const SCALE_SKETCHFAB_PULSAR_ASSET: ScaleSketchfabAsset = {
  key: "pulsar",
  name: "Pulsar (AstroRiah)",
  url: "/sf-pulsar.glb",
  tris: 11520,
  materials: 2,
  bytes: 2146408,
  sha256: "0d71903160b7e02d86c0f9ec160e2bc6f0c5e30943beb67afb7eb42c7b50ce71",
  license: "CC-BY 4.0 (AstroRiah)",
};

/** Every Sketchfab URL Scale loads (the upload manifest for this increment). */
export const SCALE_SKETCHFAB_URLS: readonly string[] = [
  ...SCALE_SKETCHFAB_CENTERPIECE_ASSETS.map((m) => m.url),
  SCALE_SKETCHFAB_PULSAR_ASSET.url,
];
