/**
 * Eternity's world — pure layout math (Phase 3, Eternity app world).
 * Everything the scene needs that can be decided without a renderer:
 * the figure's cosmic scale, the visitor fleet's orbits, the far
 * colour's drift, the gestures' poses and words, the tools' timing,
 * and the budget accounting. Deterministic from the seed — the same
 * world every visit.
 *
 * Source of truth: the v3.4 mockup
 * (`~/workspace/worlds-vision/mockups/man-god/index.html`) — the
 * figure, the white void, the gestures, the speech tablet, the
 * heavens-shake, and the tools are ported from there, not redesigned.
 * The mockup is the fixture; this layout is the app's own record of
 * the same decisions.
 *
 * The figure is the owner's GLB (`man-god-halo.glb`): 1.9 units tall,
 * front faces +Z, arms behind his back, his own thin halo ring already
 * in the geometry (split body + halo by the mockup's builder).
 * Scale ×170 → ~323 units tall. The colour is ours — his texture is
 * flat near-white — porcelain-white body, warm emissive, halo unlit
 * whitish-gold (the mockup's settled treatment).
 *
 * The space is the white void: white everywhere, no floor, nothing to
 * stand on — he FLOATS (gentle bob). The only colour lives in the FAR
 * background (shell radius 3800–4600): soft neon veils + liquid dye
 * clouds, drifting, breathing, hue-alive. The camera never reaches
 * them — that is the point, exactly as the owner asked.
 */

export const ETERNITY_SEED = "eternity / presence-2";

/** The figure's scale: raw model 1.9 units → ~323 units tall. */
export const GOD_SCALE = 170;
/** The figure's height in world units at GOD_SCALE. */
export const GOD_HEIGHT = 323;

/** The app's slow orbit around him: radius 620, height 60, looking
 *  at y 70 — the whole figure fills the frame, halo and all, with the
 *  far colour breathing behind him. */
export const ETERNITY_ORBIT_RADIUS = 620;
export const ETERNITY_ORBIT_HEIGHT = 60;
export const ETERNITY_ORBIT_LOOK_AT_Y = 70;

/** Deterministic PRNG (mulberry32) over a string seed — the same
 *  recipe the other world layouts use. */
export function rngFromSeed(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The mockup's three camera stages (threshold → pilgrimage →
 * presence), kept as the record of the journey's shape: the app's
 * camera is a slow orbit, but the player ship still rides the stage
 * anchors, and the stages name where a visitor stands. Presence is
 * close (120, −6, 320) — near enough to read his face and the speech
 * tablet in the world below his chin.
 */
export interface EternityStage {
  pos: [number, number, number];
  look: [number, number, number];
  ship: [number, number, number];
}
export const ETERNITY_STAGES: Record<"threshold" | "pilgrimage" | "presence", EternityStage> = {
  threshold: { pos: [0, 30, 1560], look: [0, 40, 0], ship: [60, -6, 1330] },
  pilgrimage: { pos: [-300, 110, 660], look: [0, 50, 0], ship: [-190, 56, 520] },
  presence: { pos: [120, -6, 320], look: [0, 74, 0], ship: [88, -34, 218] },
};

/** One visitor ship's orbit: radius 190–450, height −110–190, slow. */
export interface VisitorSlot {
  radius: number;
  height: number;
  angle: number;
  speed: number;
  bobPhase: number;
}

/** Twelve visitor slots, deterministic from the seed — one per fleet
 *  model, in the manifest's order (see eternityAssets.ts). */
export function visitorSlots(count = 12): VisitorSlot[] {
  const rnd = rngFromSeed(`${ETERNITY_SEED}:visitors`);
  return Array.from({ length: count }, () => ({
    radius: 190 + rnd() * 260,
    height: -110 + rnd() * 300,
    angle: rnd() * Math.PI * 2,
    speed: (0.008 + rnd() * 0.02) * (rnd() < 0.5 ? 1 : -1),
    bobPhase: rnd() * 9,
  }));
}

/** Far background: the shell the colour lives on, never reachable. */
export const FAR_SHELL_MIN = 3800;
export const FAR_SHELL_MAX = 4600;
/** Eight soft neon veils on the shell. */
export const FAR_VEIL_COUNT = 8;
/** Four liquid dye clouds on the shell (marbled, flowing). */
export const DYE_CLOUD_COUNT = 4;
/** Faint gold motes drifting in the void. */
export const MOTE_COUNT = 500;

/** The halo's energy veil: three colours on the ring's borders
 *  (violet, teal, gold), one per third of the circle — a veil of
 *  energy, NOT a second halo. Ring centre y≈129, radius≈41 in god
 *  units (the figure's own scale, before GOD_SCALE). */
export const HALO_VEIL_COLORS = ["violet", "teal", "gold"] as const;
export const HALO_RING_CENTER_Y = 129;
export const HALO_RING_RADIUS = 41;

/** The speech tablet: floating dark-glass tablet of light just below
 *  his chin, in front of his chest — god-local (0, 92, 48), 150×75
 *  units. It rides with him when he turns, bows, or rises. */
export const SPEECH_TABLET_POSITION: readonly [number, number, number] = [0, 92, 48];
export const SPEECH_TABLET_SIZE: readonly [number, number] = [150, 75];

/** Speech timing (wall-clock, like the mockup's flights): the words
 *  fade in over 0.4 s, hold 7 s, fade out over 1 s. The heavens shake
 *  for 1.4 s when he speaks. */
export const SPEECH_FADE_IN_MS = 400;
export const SPEECH_HOLD_MS = 7000;
export const SPEECH_FADE_OUT_MS = 1000;
export const SPEECH_SHAKE_MS = 1400;

/**
 * Gestures — the shared layer. The GLB has no rig, so gestures move
 * the WHOLE figure (turn toward you, bow, rise, sink) and drive the
 * light / halo / far colour. Arms stay as modelled, hands behind his
 * back — that is the figure's own stillness. The words are the
 * mockup's settled lines: `personal` is what one visitor hears,
 * `broadcast` is the same words for everyone.
 */
export interface EternityGesture {
  faceCam: number;
  pitch: number;
  lift: number;
  halo: number;
  light: number;
  lightIntensity: number;
  veil: number;
  personal: string;
  broadcast: string;
}

export const ETERNITY_GESTURES = {
  stillness: {
    faceCam: 0, pitch: 0, lift: 0, halo: 1.0, light: 0xffd98a, lightIntensity: 2.4, veil: 1.0,
    personal: "You made the long journey. Rest here a moment — there is no hurry in this place.",
    broadcast: "Be still. You are seen, every one of you. Rest here.",
  },
  regard: {
    faceCam: 1, pitch: 0.03, lift: 6, halo: 1.08, light: 0xffe4ae, lightIntensity: 2.8, veil: 1.05,
    personal: "I see you — not your worst day, not your highlight reel. You.",
    broadcast: "He turns toward this corner of the sky. Every ship feels looked at — because it is.",
  },
  blessing: {
    faceCam: 0.4, pitch: -0.06, lift: 42, halo: 1.35, light: 0xffd166, lightIntensity: 3.8, veil: 1.25,
    personal: "Go back lighter than you came. What you carry is seen — and it is not too much.",
    broadcast: "For every ship in this sky: go back lighter than you came.",
  },
  sorrow: {
    faceCam: 0, pitch: 0.14, lift: -26, halo: 0.85, light: 0x9db8ff, lightIntensity: 1.5, veil: 0.8,
    personal: "I know about the grief you did not mention out loud. It is not lost to me.",
    broadcast: "He bows His head. Some griefs in this sky are being held tonight.",
  },
  joy: {
    faceCam: 0.3, pitch: -0.1, lift: 58, halo: 1.5, light: 0xfff0b8, lightIntensity: 4.4, veil: 1.4,
    personal: "There it is — that spark you keep calling small. It is not small from here.",
    broadcast: "Joy, plainly. The whole sky brightens — share it.",
  },
  warning: {
    faceCam: 1, pitch: 0.02, lift: 10, halo: 1.15, light: 0xffb37a, lightIntensity: 3.2, veil: 1.0,
    personal: "Slow down on that road you are eyeing. You already know why — I am only agreeing with you.",
    broadcast: "A raised hand over this sky: slow down, all of you. There is no rush worth the wreck.",
  },
} as const satisfies Record<string, EternityGesture>;

export type EternityGestureName = keyof typeof ETERNITY_GESTURES;
export const ETERNITY_GESTURE_NAMES = Object.keys(ETERNITY_GESTURES) as EternityGestureName[];

export function isEternityGestureName(name: string): name is EternityGestureName {
  return name in ETERNITY_GESTURES;
}

/**
 * His tools (D-54 — wonder / protection / reordering, destruction
 * OUT). The spec is minimal, from the mockup's behaviour:
 * - reorder: the far veils drift to a new order (new home positions
 *   + the far group wheels a step). Nothing is taken; everything is
 *   rearranged.
 * - part-veil: a clear road opens through the far colour (veils shift
 *   apart); a second use drifts it closed again. A toggle, not a
 *   one-way door.
 * - shield: a shield of light rises over the fleet for 12 s and a
 *   meteor shower breaks on it — the stones break on the light, not
 *   on the ships. Protection, never destruction.
 * - comet: a comet crosses the sky over 7 s, for no reason but wonder.
 */
export type EternityToolName = "reorder" | "part-veil" | "shield" | "comet";
export const ETERNITY_TOOL_NAMES: readonly EternityToolName[] = ["reorder", "part-veil", "shield", "comet"];
export const ETERNITY_SHIELD_MS = 12_000;
export const ETERNITY_COMET_MS = 7_000;
export const ETERNITY_METEOR_COUNT = 7;

export function isEternityToolName(name: string): name is EternityToolName {
  return (ETERNITY_TOOL_NAMES as readonly string[]).includes(name);
}

/** Palette: the white void, warm gold, and the far neon. */
export const ETERNITY_PALETTE = {
  voidWhite: 0xfbfbff,
  porcelain: 0xf7f4ec,
  porcelainEmissive: 0xfff6dc,
  haloGold: 0xffe6ad,
  haloFlare: 0xfffbe8,
  gold: 0xffd98a,
  fogDensity: 0.00012,
} as const;

/**
 * Budget accounting (same shape as the Station's): the hard
 * boundaries (≤88 calls / ≤750k tris) stay rejection lines; the
 * internal targets (≤64 / ≤500k) are what the scene is built to.
 * Plan lines are per-part ceilings from MEASURED counts (the figure
 * 222,118 tris is measured from the shipped file; the fleet from the
 * manifests; the shield sphere 40×28 ≈ 2,240). Total ≈ 276k tris /
 * ≈ 51 calls — inside the internal targets. The player ship is her
 * own ship (37,026 tris, ≤10 calls, as in the Station plan).
 */
export const ETERNITY_BUDGET = { drawCalls: 88, visibleTris: 750_000 } as const;
export const ETERNITY_INTERNAL_TARGETS = { drawCalls: 64, visibleTris: 500_000 } as const;

export const ETERNITY_DRAW_CALL_PLAN: readonly { part: string; calls: number }[] = [
  { part: "figure (body + halo)", calls: 2 },
  { part: "figure aura + halo veils", calls: 4 },
  { part: "speech tablet", calls: 1 },
  { part: "far veils", calls: 8 },
  { part: "dye clouds", calls: 4 },
  { part: "motes", calls: 1 },
  { part: "visitor fleet (12 real ships)", calls: 12 },
  { part: "player ship (her own ship)", calls: 10 },
  { part: "shield + meteors", calls: 8 },
  { part: "comet", calls: 1 },
];

export const ETERNITY_TRI_PLAN: readonly { part: string; tris: number }[] = [
  { part: "figure (body + halo)", tris: 222_118 },
  { part: "figure aura + halo veils + tablet", tris: 0 },
  { part: "far veils + dye clouds + motes", tris: 8 },
  { part: "visitor fleet — 8 Kenney", tris: 2_472 },
  { part: "visitor fleet — 4 Quaternius", tris: 11_942 },
  { part: "player ship (her own ship)", tris: 37_026 },
  { part: "shield", tris: 2_240 },
  { part: "meteors + comet", tris: 0 },
];

export function eternityPlannedDrawCalls(): number {
  return ETERNITY_DRAW_CALL_PLAN.reduce((n, p) => n + p.calls, 0);
}

export function eternityPlannedVisibleTris(): number {
  return ETERNITY_TRI_PLAN.reduce((n, p) => n + p.tris, 0);
}
