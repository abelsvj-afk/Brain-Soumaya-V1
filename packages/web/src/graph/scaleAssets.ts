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
