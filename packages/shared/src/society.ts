/**
 * The hive society (docs/specs/npc-hive-society-2026-10-30.md): the brain's currents, the factions that lean on them, the day's callings and ordinances, and what each
 * NPC is doing. Everything here is PURE and clock/seed-driven — the server and the web compute the same answer from the same inputs, so there is no hive state to keep in sync.
 *
 * A MIRROR, NOT A VERDICT: currents describe what runs through a galaxy lately (weather), never whether the person is "good". Nothing here ever scores or labels the user.
 */

// --- The currents (the brain's colour) ---

export const CURRENT_KEYS = ["reverence", "giving", "ambition", "appetite", "friction", "weight", "peace"] as const;
export type CurrentKey = (typeof CURRENT_KEYS)[number];
export type Currents = Record<CurrentKey, number>;

/** What the society looks like with no brain behind it (reflection off, or no memories yet): a moderate, living world. */
export const NEUTRAL_CURRENTS: Readonly<Currents> = {
  reverence: 0.5,
  giving: 0.4,
  ambition: 0.4,
  appetite: 0.3,
  friction: 0.3,
  weight: 0.3,
  peace: 0.4,
};

export const CURRENT_LABELS: Readonly<Record<CurrentKey, { name: string; blurb: string; hue: number }>> = {
  reverence: { name: "Reverence", blurb: "faith, prayer, gratitude toward God", hue: 48 },
  giving: { name: "Giving", blurb: "generosity, service, forgiveness, kindness", hue: 135 },
  ambition: { name: "Ambition", blurb: "building, earning, reaching for goals", hue: 28 },
  appetite: { name: "Appetite", blurb: "craving, indulgence, temptation", hue: 310 },
  friction: { name: "Friction", blurb: "conflict, anger, resentment, control", hue: 2 },
  weight: { name: "Weight", blurb: "grief, loneliness, fatigue, worry", hue: 220 },
  peace: { name: "Peace", blurb: "rest, calm, joy, contentment", hue: 175 },
};

/** Word stems per current (matched at word starts, lower-case). Deliberately plain and few: it is a heuristic, and says so. */
export const CURRENT_LEXICON: Readonly<Record<CurrentKey, readonly string[]>> = {
  reverence: ["god", "pray", "faith", "church", "jesus", "christ", "lord", "scripture", "bible", "worship", "bless", "grace", "spirit", "holy", "psalm", "gospel", "eternity", "sacred", "devot"],
  giving: ["gave", "give", "giving", "donat", "volunteer", "charit", "tithe", "generous", "kind", "help", "serve", "service", "forgiv", "support", "share", "gift", "mentor", "comfort"],
  ambition: ["goal", "build", "launch", "earn", "promot", "business", "startup", "invest", "grow", "plan", "career", "hustle", "ship", "scale", "revenue", "raise", "achiev", "ambit"],
  appetite: ["crav", "indulg", "tempt", "binge", "drunk", "drink", "vape", "smok", "gambl", "splurg", "impuls", "overspen", "addict", "lust", "want"],
  friction: ["angry", "anger", "furious", "resent", "argu", "fight", "conflict", "jealous", "control", "betray", "hate", "bitter", "blame", "fed up", "manipul", "boss"],
  weight: ["grief", "griev", "lonely", "alone", "anxi", "worr", "tired", "exhaust", "depress", "sad", "cry", "overwhelm", "afraid", "lost", "burnout", "stress"],
  peace: ["rest", "calm", "peace", "grate", "thankful", "joy", "content", "quiet", "relax", "gentle", "hope", "smile", "sunrise", "walk"],
};

export interface MemoryLite {
  /** label + content (the caller trims it; it never leaves the server). */
  text: string;
  /** Emotional weight 0..1 when known; a heavier memory counts a little more. */
  weight?: number | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const lexiconRegex: Record<CurrentKey, RegExp> = Object.fromEntries(
  CURRENT_KEYS.map((k) => [k, new RegExp(`\\b(?:${CURRENT_LEXICON[k].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")]),
) as Record<CurrentKey, RegExp>;

/**
 * Score the currents from recent memories: per memory, count lexicon hits (at most 3 per current, so one raging note cannot own the day), weight a little by emotional charge,
 * then saturate relative to how many memories there are. Deterministic, bounded 0..1, offline. Thin evidence is blended toward the neutral world (a brain that has said little on
 * these themes must not read as "everything quiet"): `confidence` rises with the number of hits found. No memories → neutral, confidence 0.
 */
export function scoreCurrentsDetailed(memories: readonly MemoryLite[]): { currents: Currents; confidence: number } {
  const n = memories.length;
  if (n === 0) return { currents: { ...NEUTRAL_CURRENTS }, confidence: 0 };
  const raw: Currents = { reverence: 0, giving: 0, ambition: 0, appetite: 0, friction: 0, weight: 0, peace: 0 };
  let hitTotal = 0;
  for (const m of memories) {
    const text = m.text.toLowerCase();
    const w = 0.6 + 0.4 * clamp01(m.weight ?? 0.3);
    for (const k of CURRENT_KEYS) {
      const hits = text.match(lexiconRegex[k])?.length ?? 0;
      raw[k] += w * Math.min(3, hits);
      hitTotal += Math.min(3, hits);
    }
  }
  const scale = 0.5 * n + 4;
  const confidence = clamp01(1 - Math.exp(-hitTotal / 12));
  const currents = {} as Currents;
  for (const k of CURRENT_KEYS) {
    const measured = clamp01(1 - Math.exp(-raw[k] / scale));
    currents[k] = clamp01(NEUTRAL_CURRENTS[k] + confidence * (measured - NEUTRAL_CURRENTS[k]));
  }
  return { currents, confidence };
}

export function scoreCurrents(memories: readonly MemoryLite[]): Currents {
  return scoreCurrentsDetailed(memories).currents;
}

/** The society's faith tide, 0..1: rises with reverence and peace, sags with weight and friction. */
export function beliefTide(c: Currents): number {
  return clamp01(0.5 + 0.45 * c.reverence + 0.2 * c.peace - 0.3 * c.weight - 0.25 * c.friction);
}

/** The brain's colour: the currents blended as hues (circular mean, weighted by strength). The words in the panel are the real information; this is the swatch. */
export function brainColor(c: Currents): { h: number; s: number; l: number; css: string } {
  let x = 0;
  let y = 0;
  let total = 0;
  let peak = 0;
  for (const k of CURRENT_KEYS) {
    const a = (CURRENT_LABELS[k].hue * Math.PI) / 180;
    x += Math.cos(a) * c[k];
    y += Math.sin(a) * c[k];
    total += c[k];
    peak = Math.max(peak, c[k]);
  }
  const h = total > 0 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : 200;
  const s = Math.round(35 + 45 * peak);
  const l = 55;
  return { h: Math.round(h), s, l, css: `hsl(${Math.round(h)} ${s}% ${l}%)` };
}

/** The currents in plain words, strongest first — the only form that ever leaves the server toward a model. */
export function currentsInWords(c: Currents): string {
  const word = (v: number) => (v >= 0.7 ? "strong" : v >= 0.45 ? "present" : v >= 0.25 ? "faint" : "quiet");
  return [...CURRENT_KEYS]
    .sort((a, b) => c[b] - c[a])
    .map((k) => `${CURRENT_LABELS[k].name.toLowerCase()}: ${word(c[k])}`)
    .join("; ");
}

// --- Factions ---

export type FactionId = "choir" | "open-hand" | "ledger" | "undertow" | "wardens";

export type ActivityKind = "work" | "trade" | "refuel" | "travel" | "discuss" | "worship" | "rest" | "patrol" | "wander";

export interface Calling {
  id: string;
  text: string;
  /** Multipliers on activity weights while this calling is in force. */
  bias: Partial<Record<ActivityKind, number>>;
  /** Which currents make this calling more likely today. */
  when: Partial<Record<CurrentKey, number>>;
}

export interface Faction {
  id: FactionId;
  name: string;
  tagline: string;
  charter: string;
  /** A swatch, always paired with the name (never colour alone). */
  color: string;
  /** How each current lifts or lowers this faction's standing. */
  lift: Partial<Record<CurrentKey, number>>;
  /** Extra lift from how much the society believes (+ for believers, − for doubters). */
  beliefLift: number;
  callings: readonly Calling[];
}

export const FACTIONS: readonly Faction[] = [
  {
    id: "choir",
    name: "The Choir",
    tagline: "Keepers of Eternity's word.",
    charter: "Honour Eternity; sing the hours; keep the vigil for those who cannot.",
    color: "#e6c35c",
    lift: { reverence: 1, peace: 0.5 },
    beliefLift: 0.5,
    callings: [
      { id: "gather-and-sing", text: "Gather and sing", bias: { worship: 3, discuss: 1.5 }, when: { reverence: 1, peace: 0.5 } },
      { id: "keep-vigil", text: "Keep the vigil", bias: { worship: 2.5, rest: 2 }, when: { weight: 0.8, reverence: 0.4 } },
      { id: "carry-the-word", text: "Carry the word", bias: { travel: 2.5, discuss: 2 }, when: { reverence: 0.7, ambition: 0.3 } },
    ],
  },
  {
    id: "open-hand",
    name: "The Open Hand",
    tagline: "Givers and healers of the weary.",
    charter: "Feed whoever asks; sit with the lonely; take no payment for kindness.",
    color: "#6fcf8f",
    lift: { giving: 1, weight: 0.5 },
    beliefLift: 0.1,
    callings: [
      { id: "feed-the-weary", text: "Feed the weary", bias: { work: 2.5, discuss: 1.5 }, when: { giving: 1, weight: 0.6 } },
      { id: "visit-the-lonely", text: "Visit the lonely", bias: { travel: 2.5, rest: 1.5 }, when: { weight: 1, peace: 0.2 } },
      { id: "give-freely", text: "Give freely", bias: { trade: 2, work: 1.5 }, when: { giving: 0.8, ambition: 0.2 } },
    ],
  },
  {
    id: "ledger",
    name: "The Ledger",
    tagline: "Traders, makers and fuel brokers.",
    charter: "Honour a debt; keep the lanes fuelled; there is no shame in a fair margin.",
    color: "#e08a4a",
    lift: { ambition: 1, appetite: 0.4 },
    beliefLift: -0.1,
    callings: [
      { id: "work-the-markets", text: "Work the markets", bias: { trade: 3, discuss: 1.5 }, when: { ambition: 1 } },
      { id: "chase-the-margin", text: "Chase the margin", bias: { trade: 2, travel: 2 }, when: { ambition: 0.7, appetite: 0.6 } },
      { id: "stock-the-drydock", text: "Stock the drydock", bias: { refuel: 3, trade: 1.5 }, when: { ambition: 0.5, friction: 0.3 } },
    ],
  },
  {
    id: "undertow",
    name: "The Undertow",
    tagline: "Doubters and dissenters.",
    charter: "Ask what no one asks; owe nothing to a sky that does not answer; leave any room a lie fills.",
    color: "#7a86c8",
    lift: { friction: 0.8, weight: 0.2 },
    beliefLift: -0.6,
    callings: [
      { id: "ask-the-hard-questions", text: "Ask the hard questions", bias: { discuss: 3, wander: 1.5 }, when: { friction: 0.6, weight: 0.3 } },
      { id: "slip-the-leash", text: "Slip the leash", bias: { travel: 2.5, wander: 2.5 }, when: { friction: 0.8, appetite: 0.3 } },
      { id: "stir-the-quiet", text: "Stir the quiet", bias: { discuss: 2.5, rest: 0.5 }, when: { peace: 0.5, friction: 0.4 } },
    ],
  },
  {
    id: "wardens",
    name: "The Wardens",
    tagline: "Order, lanes and ordinances.",
    charter: "Hold the lanes; keep the ordinance; the law is for the safety of the least of us.",
    color: "#7ab4e0",
    lift: { friction: 0.5, appetite: 0.5 },
    beliefLift: 0.1,
    callings: [
      { id: "hold-the-lanes", text: "Hold the lanes", bias: { patrol: 3, work: 1.2 }, when: { friction: 0.7, appetite: 0.4 } },
      { id: "enforce-the-ordinance", text: "Enforce the ordinance", bias: { patrol: 2, discuss: 2 }, when: { friction: 0.5, appetite: 0.5 } },
      { id: "count-the-cargo", text: "Count the cargo", bias: { work: 2.5, trade: 1.5 }, when: { ambition: 0.6 } },
    ],
  },
] as const;

export const faction = (id: FactionId | null | undefined): Faction | undefined => FACTIONS.find((f) => f.id === id);

/** A stable small hash → [0, 1), shared by server and web. */
export function hash01(seed: string): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** How much a faction is felt in this brain today, 0.05..0.95. */
export function factionStanding(f: Faction, c: Currents, belief: number): number {
  let s = 0.3;
  for (const k of CURRENT_KEYS) s += (f.lift[k] ?? 0) * (c[k] - 0.4);
  s += f.beliefLift * (belief - 0.6);
  return Math.min(0.95, Math.max(0.05, s));
}

/** The faction's guidance for the day: weighted by the currents it answers to, broken by the day's seed. */
export function dailyCalling(f: Faction, c: Currents, dayKey: string): Calling {
  const score = (call: Calling) => 0.3 + Object.entries(call.when).reduce((a, [k, w]) => a + (w ?? 0) * (c[k as CurrentKey] ?? 0), 0) + 0.35 * hash01(`${f.id}|${call.id}|${dayKey}`);
  return [...f.callings].sort((a, b) => score(b) - score(a))[0]!;
}

// --- Governance: who governs each world, and today's ordinance ---

export const WORLD_GOVERNORS: Readonly<Record<string, FactionId>> = {
  "great-station": "wardens",
  "growing-place": "open-hand",
  "quiet-archive": "choir",
  "deep-past": "choir",
  scale: "ledger",
  people: "open-hand",
  "faded-ward": "open-hand",
  "road-to-the-seam": "wardens",
  "the-village": "open-hand",
  "the-unmade-hour": "choir",
  eternity: "choir",
};

export interface Ordinance {
  id: string;
  text: string;
  faction: FactionId;
  /** Which currents favour it. */
  when: Partial<Record<CurrentKey, number>>;
  /** Activity multipliers while it is in force. */
  bias: Partial<Record<ActivityKind, number>>;
}

export const ORDINANCES: readonly Ordinance[] = [
  { id: "open-hands", text: "Open Hands Day — docking fees waived, and the Hand feeds anyone who asks.", faction: "open-hand", when: { giving: 1, weight: 0.6 }, bias: { work: 1.5, discuss: 1.3 } },
  { id: "market-day", text: "Market Day — the Ledger opens its stalls; fuel and goods change hands.", faction: "ledger", when: { ambition: 1, appetite: 0.3 }, bias: { trade: 2, refuel: 1.5 } },
  { id: "quiet-watch", text: "The Quiet Watch — patrols thin, voices lowered; the weary are left to rest.", faction: "wardens", when: { weight: 1, peace: 0.3 }, bias: { rest: 2, patrol: 0.5 } },
  { id: "festival", text: "A Festival of the Hours — the Choir sings from dawn, and all are welcome.", faction: "choir", when: { reverence: 1, peace: 0.5 }, bias: { worship: 2.5, discuss: 1.3 } },
  { id: "fast-day", text: "A Day of Fasting — appetites are set down; the stalls stay shut.", faction: "choir", when: { appetite: 1, reverence: 0.3 }, bias: { worship: 1.8, trade: 0.4 } },
  { id: "free-berth", text: "Free Berth Charter — the Undertow rallies for open lanes; the Wardens watch closely.", faction: "undertow", when: { friction: 1 }, bias: { discuss: 2, wander: 1.5, patrol: 1.5 } },
  { id: "tightened-lanes", text: "Tightened Lanes — the Wardens inspect every hold and count every berth.", faction: "wardens", when: { friction: 0.8, appetite: 0.4 }, bias: { patrol: 2.5, trade: 0.7 } },
  { id: "common-day", text: "A common day — no decree; everyone about their own business.", faction: "wardens", when: {}, bias: {} },
];

export function ordinanceFor(world: string, c: Currents, dayKey: string): Ordinance {
  const governor = WORLD_GOVERNORS[world];
  // The governing faction's ordinances are favoured; another faction's are possible (a rally, a feast day) but rarer — so one strong current does not paint every world the same.
  const score = (o: Ordinance) =>
    (o.id === "common-day" ? 0.5 : 0.2) +
    0.6 * Object.entries(o.when).reduce((a, [k, w]) => a + (w ?? 0) * (c[k as CurrentKey] ?? 0), 0) +
    (governor ? (o.faction === governor ? 0.5 : -0.2) : 0) +
    0.6 * hash01(`${world}|${o.id}|${dayKey}`);
  return [...ORDINANCES].sort((a, b) => score(b) - score(a))[0]!;
}

// --- The society's day ---

export interface SocietyDay {
  dayKey: string;
  /** False = a neutral society (reflection off): nothing was read from the brain. */
  reflects: boolean;
  /** 0..1: how much the brain actually said on these themes. Low = the world leans on a neutral day. */
  confidence: number;
  currents: Currents;
  belief: number;
  color: { h: number; s: number; l: number; css: string };
  factions: { id: FactionId; standing: number; calling: { id: string; text: string } }[];
}

export function societyDay(currents: Currents | null, dayKey: string, confidence = 1): SocietyDay {
  const c = currents ?? { ...NEUTRAL_CURRENTS };
  const belief = beliefTide(c);
  return {
    dayKey,
    reflects: !!currents,
    confidence: currents ? confidence : 0,
    currents: c,
    belief,
    color: brainColor(c),
    factions: FACTIONS.map((f) => {
      const call = dailyCalling(f, c, dayKey);
      return { id: f.id, standing: factionStanding(f, c, belief), calling: { id: call.id, text: call.text } };
    }),
  };
}

export function callingOf(s: SocietyDay, id: FactionId | null | undefined): Calling | undefined {
  const f = faction(id);
  const picked = s.factions.find((x) => x.id === id)?.calling.id;
  return f?.callings.find((c) => c.id === picked);
}

// --- Faith: each NPC's own temper, moved a little by the tide ---

export function npcFaith(baseline: number, susceptibility: number, belief: number): number {
  return Math.min(1, Math.max(-1, baseline + susceptibility * (belief - 0.6) * 2));
}

export function faithLabel(v: number): string {
  return v >= 0.55 ? "devout" : v >= 0.2 ? "a believer" : v > -0.2 ? "wavering" : v > -0.55 ? "a doubter" : "a sceptic";
}
