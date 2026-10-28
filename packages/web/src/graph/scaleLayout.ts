/**
 * Scale layout (Phase 3, Scale world) — the pure function that places the
 * Scale space. No three.js here: this module is the testable contract
 * (C1 determinism, C2 identity traceability), and the scene module renders
 * exactly what it returns.
 *
 * Settled ground (Scale design note Rev 123; recipe-scale.md; build-all
 * delegation, 2026-10-26):
 * - Scale is the world of real size. The whole point is one sentence:
 *   "this is the actual station, actual size" — the real International
 *   Space Station at its real size, with your ship beside it so the size
 *   is felt, not stated. The ISS is the hero; nothing in the scene is
 *   bigger, brighter, or more central than it.
 * - Scale surfaces no memories of its own (like the Station, it is not a
 *   memory-bearing world) — memories appear here only as cargo in transit
 *   with the ship, the traveler's own act. This layout therefore takes no
 *   graph input: the space is the same for every traveler, every visit.
 * - The sky is true: HYG stars (already built, P2-3) + real named
 *   asteroids. No fog — distance reads through witness objects and the
 *   approach stages, not through haze. (Nebula planes: the Rev 123
 *   "no nebula planes" line was overridden by the owner on 2026-10-27 —
 *   three OGA renders as distant light only, far outside the orbit,
 *   never a body, never fog. See SCALE_NEBULA_PLANES.)
 * - The approach is felt in sequence: far silhouette → middle witnesses
 *   → near 1:1, the station overfilling the view at closest approach.
 *   The approach is gently curved, never a sterile straight line; the
 *   station is never centered dead-on until the final arc; something with
 *   honest size always shares the frame in the middle distance.
 * - The gate silhouette (adopted EVE/NMS amendment, Rev 123): Scale's
 *   gate is a survey frame — a clean rectangular measurement frame of thin
 *   light, like a surveyor's mark held against the dark.
 * - No size number is ever shown as a label. The size is felt — the
 *   numbers live in this module and the build record, not in the world.
 * - Dates are stored as ISO strings here; anything that displays one must
 *   format it in the viewer's own local time (NO UTC in anything
 *   user-facing). Scale carries no dates of its own.
 *
 * Real-size grounding (the numbers, so a later builder can check them):
 * - The ISS (A) model's own bounding box is 37.77 × 22.67 × 23.54 model
 *   units, truss span on the long axis. The real station's truss spans
 *   about 109 metres. Her ship is 12 units long in the Station and
 *   transit scenes, so the ISS is scaled to a 109-unit truss span — about
 *   nine ship-lengths (109 / 12 = 9.08), the real ratio of the station
 *   (~109 m) to a ~12 m craft.
 *   One scene unit is therefore about one metre at the station's scale.
 * - Probe distances are an ILLUSTRATIVE ORDERING, not true kilometres:
 *   Voyager sits farthest, as in reality, Pioneer next, then Dawn, then
 *   Kepler nearest — but no distance here claims to be a real distance in
 *   kilometres. Claiming true kilometres inside a 1,500-unit scene would
 *   be false; the ordering is the true part.
 * - Asteroid NAMES are real (numbered asteroids 1–60, the first sixty
 *   ever named); their POSITIONS are seed-placed, not true ephemeris —
 *   the recipe's seed table says asteroid placement derives from the
 *   seed, and true orbital positions are out of scope for this build.
 * - Probe stories are plain words about real missions (launch year, what
 *   the craft did, where it is now). No invented mission facts.
 *
 * Relic hooks (relics increment, worlds/relics-codex — NOT on this tip):
 * the three Scale relics (Star Hanger, Sunward Compass, Unnumbered
 * Fragment) rest at SCALE_RELIC_ANCHORS, in the registry's anchor shape
 * (position + size 22, the relics record's RELIC_DISPLAY_SIZE). The
 * scene accepts the registry's `onRelicVisible` callback; the relics
 * increment adds these three entries to its RELIC_ANCHORS and calls its
 * placeWorldRelics(group, "scale", onVisible) when it rebases onto this
 * tip. This module duplicates nothing from the registry — it only names
 * where the relics rest, in the shape the registry reads.
 */

export const SCALE_SEED = "scale / actual-size-1";

/** Recipe budget (R-C4 allocation): planned ceilings, asserted statically.
 * The call ceiling moved 90 → 100 for the Sketchfab long game
 * (2026-10-27): ten calls buy the three signature animated pieces the
 * owner downloaded himself — the Planetary Nebula (4 materials, kept
 * as-is so its emissive layers survive), the Sketchfab black hole (4
 * materials, transmission disk kept), and the pulsar (2 materials,
 * unlit glow kept). The tri ceiling is the hard guard and still holds:
 * 450,484 of 500,000. No honest saving existed elsewhere — every
 * existing call is a merged single or a kept color. */
export const SCALE_BUDGET = { maxDrawCalls: 100, maxTris: 500_000 } as const;

/** Her ship's length in scene units (Station + transit scenes) — the yardstick Scale measures against. */
export const SCALE_SHIP_LENGTH = 12;
/** The real ISS truss span, in metres — and, by the 1 unit ≈ 1 m rule, in scene units. */
export const SCALE_ISS_TRUSS_SPAN = 109;
/** The ISS (A) model's own long-axis extent, in model units (measured from the file). */
export const SCALE_ISS_MODEL_SPAN = 37.77;
/** Scale applied to the loaded ISS model so its truss spans 109 scene units. */
export const SCALE_ISS_SCALE = SCALE_ISS_TRUSS_SPAN / SCALE_ISS_MODEL_SPAN;

/** Approach stages (recipe §2): far silhouette → middle witnesses → near 1:1. */
export const SCALE_APPROACH = {
  /** Arrival: the ISS a small bright shape against true black and true stars. */
  far: 600,
  /** Witnesses share the frame — your ship, a docked capsule, a passing probe. */
  middle: 250,
  /** Closest approach: the station overfills the view. */
  near: 140,
} as const;

/** The orbit the surface camera holds (WorldsSurface entry): wide enough to hold the whole station, low enough to feel near. */
export const SCALE_ORBIT = { radius: 320, height: 60, lookAtY: 0 } as const;

/** The sun's direction (key light): from +X, so the panels catch it and the sunward side is the bright side. */
export const SCALE_SUN_DIRECTION: readonly [number, number, number] = [1, 0.35, 0.2];

export type ScaleProbeSlug = "kepler" | "pioneer-10" | "dawn" | "voyager";

export interface ScaleProbe {
  slug: ScaleProbeSlug;
  /** Plain-words name, as the world shows it. */
  name: string;
  /** The real spacecraft's story, in plain words — no invented facts. */
  story: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units. */
  size: number;
  /** Drift direction (unit-ish), seed-derived within the probe's true heading. */
  drift: readonly [number, number, number];
}

export interface ScaleAsteroid {
  /** Real name of a real numbered asteroid (1–60, the first sixty named). */
  name: string;
  x: number;
  y: number;
  z: number;
}

/** A relic's resting place, in the relics registry's anchor shape. */
export interface ScaleRelicAnchor {
  /** Scene-space center of the relic. */
  position: readonly [number, number, number];
  /** Longest side once placed. */
  size: number;
}

/** Longest side of a placed relic, in world units — the relics record's RELIC_DISPLAY_SIZE. */
export const SCALE_RELIC_SIZE = 22;

/**
 * The three Scale relics (build-all decisions §3 + relics record):
 * - Star Hanger — "where the stars were given their places": beside the
 *   survey frame, at the edge of the starfield the frame measures.
 * - Sunward Compass — "along the sun's long road": on the sunward (+X)
 *   side, along the key light's road.
 * - Unnumbered Fragment — "in the vast uncounted space": far out, at the
 *   asteroid field's edge, where counting meets its edge.
 * All three sit clear of the station (truss half-span 54.5) and inside the
 * camera's orbit reach, so they can be spotted from the orbit — and all
 * three are DEFERRED until the relics increment lands (registry entry
 * present there, discoverable: false, until its world exists — which it
 * now does).
 */
export const SCALE_RELIC_ANCHORS: Readonly<Record<string, ScaleRelicAnchor>> = {
  "star-hanger": { position: [150, 30, 180], size: SCALE_RELIC_SIZE },
  "sunward-compass": { position: [260, 12, -60], size: SCALE_RELIC_SIZE },
  "unnumbered-fragment": { position: [-300, -10, 220], size: SCALE_RELIC_SIZE },
};

/** The survey frame (Scale's gate silhouette): the measurement frame's center and size. */
export const SCALE_SURVEY_FRAME = {
  /** On the approach axis, between the arrival point and the station. */
  position: [0, 0, 320] as const,
  /** Wide enough to frame the 109-unit truss with room to measure. */
  width: 130,
  height: 50,
} as const;

/** The docked capsule (witness of known size): docked at the truss's +X end. */
export const SCALE_CAPSULE = {
  position: [64, 0, 10] as const,
  /** Total length, in scene units — a capsule about two-thirds of a ship-length. */
  length: 8,
} as const;

export interface ScalePlanet {
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units — all smaller than the 109-unit ISS truss. */
  size: number;
  /** Material count of the file (= draw calls when loaded as-is, colors kept). */
  materials: number;
}

/**
 * Planets as floating bodies (population increment, 2026-10-27) — loaded
 * as-is, colors kept. Deterministic seed positions, clear of the ISS
 * (truss half-span 54.5), the survey frame, the probe lanes, and the
 * relic anchors (verified by the layout test's clearance assertions).
 */
export const SCALE_PLANETS: readonly ScalePlanet[] = [
  { key: "planet_earth", name: "Earth", x: -220, y: 60, z: -260, size: 40, materials: 3 },
  { key: "planet_mars", name: "Mars", x: 300, y: -40, z: 240, size: 30, materials: 3 },
  { key: "planet_jupiter", name: "Jupiter", x: -420, y: 90, z: 320, size: 55, materials: 3 },
  { key: "planet_saturn", name: "Saturn", x: 520, y: -70, z: -320, size: 45, materials: 2 },
];

/**
 * Hunt-2 planets (space-hunt-2, 2026-10-27) — appended to SCALE_PLANETS
 * below by buildScaleLayout; same shape, same clearances (verified by
 * the layout test's clearance assertions).
 */
export const SCALE_HUNT2_PLANETS: readonly ScalePlanet[] = [
  { key: "quaternius-planet-1", name: "Planet 1 (Quaternius)", x: -650, y: -60, z: -150, size: 35, materials: 1 },
  { key: "quaternius-planet-2", name: "Planet 2 (Quaternius)", x: 150, y: 140, z: -480, size: 30, materials: 1 },
  { key: "quaternius-planet-3", name: "Planet 3 (Quaternius)", x: -80, y: -120, z: 560, size: 32, materials: 1 },
  { key: "planets-set", name: "Planets (set)", x: 680, y: 100, z: -80, size: 45, materials: 2 },
  { key: "earth-and-moon", name: "Earth and Moon", x: -520, y: -140, z: 480, size: 28, materials: 3 },
  { key: "pixel-brown-dwarf", name: "Pixel Planet WISE 0855-0714", x: 60, y: 180, z: 380, size: 22, materials: 1 },
  { key: "sun", name: "Sun", x: -150, y: -60, z: -650, size: 60, materials: 2 },
  { key: "stars", name: "Stars", x: 480, y: -160, z: -480, size: 30, materials: 1 },
];


/** Hunt-2 belt pieces at the field's edge (see scaleAssets.ts for the files). */
export interface ScaleBeltPiece {
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units. */
  size: number;
  /** Drift direction (unit-ish) for the slow sway — only Bennu drifts. */
  drift?: readonly [number, number, number];
}
export const SCALE_BELT_PIECES: readonly ScaleBeltPiece[] = [
  { key: "belt-strip", name: "Asteroids (Jarlan)", x: -700, y: 200, z: 700, size: 40 },
  { key: "bennu", name: "Bennu", x: 850, y: -260, z: -750, size: 18, drift: [0.4, -0.05, -0.5] },
  { key: "asteroid-large", name: "Asteroid", x: -1400, y: 250, z: -300, size: 25 },
  { key: "debris-pile", name: "Debris Pile", x: 250, y: -220, z: 750, size: 12 },
  { key: "asteroid-toastie", name: "Asteroid (J-Toastie)", x: -250, y: 260, z: -750, size: 10 },
  { key: "rubble-rocks", name: "Rubble Rocks", x: 1100, y: 80, z: -150, size: 14 },
];


/** Heavy centerpieces, far out and dim — never central, never bright.
 * Pillars 1B and the gas cloud carry the nebula material; the black
 * hole and G292 keep their own. The Sketchfab pair (2026-10-27) keeps
 * its own materials too — the nebula's emissive layers and the black
 * hole's transmission disk — and both play their own animation clips
 * in the scene (the first GLB clips this world has ever played). */
export interface ScaleCenterpiece {
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units. */
  size: number;
  /** "as-is" keeps the file's materials; "nebula" takes the scene's nebula material. */
  material: "as-is" | "nebula";
  /** One slow turn, in ms — minutes, never seconds. */
  spinMs: number;
  /** The file carries its own animation clip(s), played by the scene — not just the slow spin. */
  animated?: boolean;
}
export const SCALE_CENTERPIECES: readonly ScaleCenterpiece[] = [
  { key: "black-hole", name: "Black hole", x: -1900, y: -350, z: 1400, size: 90, material: "as-is", spinMs: 600000 },
  { key: "pillars-1b", name: "Pillars of Creation (Pillar 1B)", x: -1400, y: 300, z: -1200, size: 160, material: "nebula", spinMs: 720000 },
  { key: "g292", name: "G292.0+1.8", x: 1500, y: -250, z: 1100, size: 140, material: "as-is", spinMs: 900000 },
  { key: "gas-cloud", name: "Cloud", x: 0, y: 450, z: -1700, size: 120, material: "nebula", spinMs: 720000 },
  { key: "planetary-nebula", name: "Planetary Nebula", x: 1900, y: 350, z: -1400, size: 150, material: "as-is", spinMs: 720000, animated: true },
  { key: "sf-black-hole", name: "Black hole (Sketchfab)", x: 2100, y: -400, z: -900, size: 90, material: "as-is", spinMs: 600000, animated: true },
];


/** Distant nebula light — three OGA renders as huge static planes far
 * outside the orbit, facing the center. 1800 x 1125 (the renders are
 * 2560x1600, 16:10). */
export interface ScaleNebulaPlane {
  key: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}
export const SCALE_NEBULA_PLANES: readonly ScaleNebulaPlane[] = [
  { key: "nebula-01", x: -3500, y: 600, z: 1200, width: 1800, height: 1125 },
  { key: "nebula-02", x: 3000, y: -500, z: -1800, width: 1800, height: 1125 },
  { key: "nebula-03", x: 800, y: 1500, z: 3300, width: 1800, height: 1125 },
];

export interface ScaleMoon {
  key: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units. */
  size: number;
  materials: number;
  /** Drift direction (unit-ish), seed-derived — the moon sways like the probes, and the outpost rides with it. */
  drift: readonly [number, number, number];
}

/** The moon (population increment) — the outpost stands on it. */
export const SCALE_MOON: ScaleMoon = {
  key: "moon_cratered",
  x: -300,
  y: 120,
  z: 420,
  size: 25,
  materials: 2,
  drift: [-0.5, 0.1, 0.6],
};

/**
 * The moon outpost, as fractions of the moon's scaled radius — the dome,
 * rover, and flag sit on the moon's surface and ride with it when it
 * drifts (they are children of the moon holder in the scene, at
 * offset × radius). Fractions, not units, so a re-fit moon keeps its
 * outpost on the surface.
 */
export const SCALE_MOON_OUTPOST_OFFSETS = {
  dome: [0.45, 0.95, 0.25],
  rover: [-0.7, 0.9, -0.4],
  flag: [0.8, 1.0, -0.6],
} as const;
/** Longest side of each outpost piece once placed, in scene units. */
export const SCALE_MOON_OUTPOST_SIZES = { dome: 10, rover: 8, flag: 6 } as const;

export interface ScaleEncounter {
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Longest side once placed, in scene units. */
  size: number;
  /** Drift direction (unit-ish) for the slow sway, like the probes. */
  drift: readonly [number, number, number];
  /** "merged" collapses the file to the visitor grey (ships, telescopes,
   * hardware); "as-is" keeps the file's materials — only the pulsar,
   * whose unlit glow IS the sight. Absent means "merged". */
  material?: "as-is" | "merged";
}

/**
 * Encounters (population increment) — rare, slow-drift, far out, long
 * loops. An alien, an astronaut, two UFOs: things passing through the
 * vast dark, seen sometimes, never central. The pulsar (Sketchfab,
 * 2026-10-27) is the one encounter that is not a craft: a stellar
 * jet, thirty units of light, kept as-is so its glow survives.
 */
export const SCALE_ENCOUNTERS: readonly ScaleEncounter[] = [
  { key: "alien", name: "Alien", x: 900, y: 150, z: -700, size: 6, drift: [0.7, 0.1, -0.6] },
  { key: "astronaut", name: "Astronaut", x: -1100, y: -100, z: 800, size: 6, drift: [-0.6, 0.08, 0.7] },
  { key: "flexunit-ufo", name: "FlexUnit UFO", x: 1200, y: 200, z: 600, size: 3, drift: [0.8, -0.05, 0.5] },
  { key: "ufo", name: "UFO", x: -900, y: -150, z: -900, size: 8, drift: [-0.7, -0.1, -0.6] },
  { key: "hubble", name: "Hubble", x: 1050, y: -120, z: 150, size: 8, drift: [0.5, 0.05, -0.6] },
  { key: "pulsar", name: "Pulsar (AstroRiah)", x: -1600, y: 500, z: -600, size: 30, drift: [0.6, 0.1, -0.5], material: "as-is" },
];

/** A drifting debris satellite (population increment) — old hardware, still out there. */
export const SCALE_SATELLITE_A: ScaleEncounter = {
  key: "satellite_a",
  name: "Satellite A",
  x: 700,
  y: -200,
  z: -500,
  size: 8,
  drift: [0.6, 0.05, -0.7],
};

/** Belt body sizes, in scene units: the big rocks read at ~15, the small ones at ~8. */
export const SCALE_BELT_SIZES = { big: 15, small: 8 } as const;

/**
 * The four NASA probes (design note §2; Q1 settled: all four first).
 * Distances are the illustrative ordering (see module header) — Voyager
 * farthest, as in reality. Drift vectors are seed-derived within each
 * probe's true heading: outward, away from the sun, never back toward it.
 */
export const SCALE_PROBES: readonly ScaleProbe[] = [
  {
    slug: "kepler",
    name: "Kepler",
    story:
      "Kepler watched more than 150,000 stars for the tiny dimming of a planet crossing one — and found more than 2,600 planets. Launched 2009; retired 2018, when its fuel ran out.",
    x: 420,
    y: 40,
    z: -180,
    size: 9,
    drift: [0.8, 0.1, -0.5],
  },
  {
    slug: "pioneer-10",
    name: "Pioneer 10",
    story:
      "Pioneer 10 was the first spacecraft through the asteroid belt and the first to look closely at Jupiter. Launched 1972; last heard from in 2003, still heading out of the solar system.",
    x: 640,
    y: -30,
    z: 320,
    size: 7,
    drift: [0.9, -0.05, 0.45],
  },
  {
    slug: "dawn",
    name: "Dawn",
    story:
      "Dawn was the first spacecraft to orbit two different worlds — the asteroid Vesta, then the dwarf planet Ceres — running on ion engines. Launched 2007; mission ended 2018.",
    x: 980,
    y: 60,
    z: -420,
    size: 10,
    drift: [0.85, 0.08, -0.4],
  },
  {
    slug: "voyager",
    name: "Voyager 1",
    story:
      "Voyager 1 is the farthest human-made object there is. Launched 1977, it crossed into interstellar space in 2012 and still sends back data from beyond the sun's reach.",
    x: -1280,
    y: -80,
    z: 540,
    size: 8,
    drift: [-0.95, -0.06, 0.4],
  },
];

/** Real named asteroids — numbered 1–60, the first sixty ever named. Positions are seed-placed (see module header). */
export const SCALE_ASTEROID_NAMES: readonly string[] = [
  "Ceres",
  "Pallas",
  "Juno",
  "Vesta",
  "Astraea",
  "Hebe",
  "Iris",
  "Flora",
  "Metis",
  "Hygiea",
  "Parthenope",
  "Victoria",
  "Egeria",
  "Irene",
  "Eunomia",
  "Psyche",
  "Thetis",
  "Melpomene",
  "Fortuna",
  "Massalia",
  "Lutetia",
  "Kalliope",
  "Thalia",
  "Themis",
  "Phocaea",
  "Proserpina",
  "Euterpe",
  "Bellona",
  "Amphitrite",
  "Urania",
  "Euphrosyne",
  "Pomona",
  "Polyhymnia",
  "Circe",
  "Leukothea",
  "Atalante",
  "Fides",
  "Leda",
  "Laetitia",
  "Harmonia",
  "Daphne",
  "Isis",
  "Ariadne",
  "Nysa",
  "Eugenia",
  "Hestia",
  "Aglaja",
  "Doris",
  "Pales",
  "Virginia",
  "Nemausa",
  "Europa",
  "Kalypso",
  "Alexandra",
  "Pandora",
  "Melete",
  "Mnemosyne",
  "Concordia",
  "Elpis",
  "Echo",
];

export interface ScaleLayout {
  /** The station's center — the origin; everything else is placed against it. */
  iss: { x: number; y: number; z: number; scale: number; trussSpan: number };
  probes: ScaleProbe[];
  asteroids: ScaleAsteroid[];
  /** Planets as floating bodies (population increment) — loaded as-is, colors kept. */
  planets: ScalePlanet[];
  /** The moon, with its outpost riding on it — null in the empty layout. */
  moon: ScaleMoon | null;
  /** Rare slow-drift encounters, far out (population increment). */
  encounters: ScaleEncounter[];
  /** The drifting debris satellite — null in the empty layout. */
  satellite: ScaleEncounter | null;
  /** Placed belt pieces at the field's edge (hunt #2). */
  beltPieces: ScaleBeltPiece[];
  /** Heavy centerpieces, far out and dim (hunt #2). */
  centerpieces: ScaleCenterpiece[];
  /** Distant nebula-light planes (hunt #2). */
  nebulaPlanes: ScaleNebulaPlane[];
  surveyFrame: {
    position: readonly [number, number, number];
    width: number;
    height: number;
  };
  capsule: { position: readonly [number, number, number]; length: number };
  relicAnchors: Readonly<Record<string, ScaleRelicAnchor>>;
}

function hashSeeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the Scale layout. No graph input — Scale surfaces no memories of
 * its own, so the space is the same for every traveler, every visit.
 * Deterministic: same seed, same space, every device.
 */
export function buildScaleLayout(): ScaleLayout {
  const rand = mulberry32(hashSeeded(`${SCALE_SEED}:asteroids`));
  const asteroids: ScaleAsteroid[] = SCALE_ASTEROID_NAMES.map((name) => {
    // A wide shell around the station, 900–2,600 out — far enough that
    // the field reads as vast, near enough that the points still read as
    // things, not sky. Flat-ish: real belts are thin.
    const angle = rand() * Math.PI * 2;
    const radius = 900 + rand() * 1700;
    return {
      name,
      x: Math.cos(angle) * radius,
      y: (rand() - 0.5) * 600,
      z: Math.sin(angle) * radius,
    };
  });
  return {
    iss: { x: 0, y: 0, z: 0, scale: SCALE_ISS_SCALE, trussSpan: SCALE_ISS_TRUSS_SPAN },
    probes: [...SCALE_PROBES],
    asteroids,
    planets: [...SCALE_PLANETS, ...SCALE_HUNT2_PLANETS],
    moon: { ...SCALE_MOON },
    encounters: [...SCALE_ENCOUNTERS],
    satellite: { ...SCALE_SATELLITE_A },
    beltPieces: [...SCALE_BELT_PIECES],
    centerpieces: [...SCALE_CENTERPIECES],
    nebulaPlanes: [...SCALE_NEBULA_PLANES],
    surveyFrame: {
      position: SCALE_SURVEY_FRAME.position,
      width: SCALE_SURVEY_FRAME.width,
      height: SCALE_SURVEY_FRAME.height,
    },
    capsule: { position: SCALE_CAPSULE.position, length: SCALE_CAPSULE.length },
    relicAnchors: SCALE_RELIC_ANCHORS,
  };
}
