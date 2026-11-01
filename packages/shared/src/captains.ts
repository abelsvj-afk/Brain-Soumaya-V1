import type { NpcActKind, NpcId, NpcLogEntry } from "./npcs.js";

/**
 * Player NPCs — the captains (NPC-Player Layer, L1 — Presence;
 * P1 — Presence, Galaxy-Wide).
 *
 * A captain is a fake player that behaves like a real player in the
 * PUBLIC worlds (design `Soumaya-NPC-Player-Layer-Design-2026-10-31.md`,
 * settled 2026-10-27): it has a home world and a current world, it
 * leaves and comes back on its own seeded rhythm, it remembers
 * meeting the visitor in its own memory stream, and every act it
 * takes runs through the same PR #117 fence — allow-listed kinds,
 * owner-set budgets, kill switch, append-only log with plain-language
 * causes.
 *
 * This module is the shared vocabulary only: identities, traits,
 * drives, budgets, the advance constants, the question kinds, and
 * the wire shapes. The server owns every decision (a deterministic
 * utility decider in L1, behind a swappable interface — the design's
 * §13 bark seam and the civilization addendum's open D-2 fork both
 * plug in behind it later); the client renders what it returns.
 *
 * L1 activated ONE captain end-to-end: Bex, the Regular. P1 widens
 * the geography to the galaxy D-1 ruled (five travel-open worlds),
 * registers all EIGHT named captains with a specific home anchor
 * each, and flies exactly TWO of them — Bex, and Junia resident at
 * the Growing Place (owner ruling 2026-10-31, spec C2). The other
 * six are defined in full — traits, voice profiles, ships, anchors —
 * with `active: false`; they fly in later increments, one at a time,
 * never as a crowd.
 */

/** The captain ids (the non-roster half of `NpcId`). */
export type CaptainId = Exclude<NpcId, "harbor-controller">;

/** The worlds a captain may travel to in P1: the five D-1
 *  travel-open worlds. Captains never enter private worlds (settled
 *  2026-10-27), `people` is closed, seam worlds are gated shut, and
 *  Eternity has no captain destination at all. Home/current are
 *  FIELDS, not constants — later increments widen the set without
 *  redesign. */
export type CaptainWorld = "great-station" | "scale" | "growing-place" | "deep-past" | "quiet-archive";

/** The D-1 travel set (P1 spec §4): exactly the travel-open worlds,
 *  verified present in the app's world registries at build time
 *  (RA-4: all five keys exist in TRAVEL_WORLD_KEYS and RelicWorld).
 *  Legs, visits, and arrivals consult this set — and only this set. */
export const CAPTAIN_TRAVEL_WORLDS: readonly CaptainWorld[] = [
  "great-station",
  "scale",
  "growing-place",
  "deep-past",
  "quiet-archive",
] as const;

/** Back-compat name for the travel set (L1's two-world public list,
 *  widened by P1 to the D-1 travel set). */
export const CAPTAIN_PUBLIC_WORLDS: readonly CaptainWorld[] = CAPTAIN_TRAVEL_WORLDS;

/** Worlds refused for residence, travel, and anchor alike in P1:
 *  `people` (closed by D-1), the player's private home, every seam
 *  world, and Eternity (gate passage only, P2 wiring — P1 builds no
 *  part of it). Named here so the fence test can refuse them by
 *  name, not by absence. */
export const CAPTAIN_FENCED_WORLDS: readonly string[] = [
  "people",
  "home",
  "eternity",
  "unmade-hour",
  "first-light",
  "unlit-hulls",
  "long-morning",
  "folded-letter",
] as const;

/** A captain's specific home anchor (P1 spec §6.1): a named place —
 *  or, for ship-homed captains, the ship itself — in (or berthed at)
 *  one world. The anchor never moves in P1; it is an identity, a
 *  planning bias, a resting place the panel can name, and the fixed
 *  point acceptance A8 checks. */
export interface CaptainHomeAnchor {
  kind: "berth" | "quarter" | "terrace" | "cell" | "workshop-berth" | "ship";
  /** The anchor's world — for a ship, her berthing/home world. Must
   *  always equal the definition's `homeWorld`. */
  world: CaptainWorld;
  /** The specific anchor, in plain words, as the panel prints it. */
  label: string;
}

/** The trait table (design §4.3): three fixed traits per captain.
 *  Traits bias the utility curves and, later, captain↔captain
 *  affinity. They never enable combat, destruction, or anything
 *  touching the player. */
export type CaptainTrait =
  | "Bold"
  | "Cautious"
  | "Greedy"
  | "Generous"
  | "Stubborn"
  | "Sociable"
  | "Private"
  | "Methodical"
  | "Restless";

/** The five drives (design §4.1): a captain's own weather. There is
 *  deliberately no survival drive and nothing here decays anything
 *  the player owns. */
export type CaptainDrive = "duty" | "ambition" | "curiosity" | "sociability" | "rest";

export const CAPTAIN_DRIVES: readonly CaptainDrive[] = [
  "duty",
  "ambition",
  "curiosity",
  "sociability",
  "rest",
] as const;

/** A captain's pronouns — widened in P1 to include "they": Sorrel
 *  is they/them (approved proposal; spec C4). Every captain-facing
 *  string in the server module is pronoun-correct per captain or
 *  pronoun-neutral. */
export type CaptainPronouns = "he" | "she" | "they";

/**
 * A captain's voice profile (design §13.2): fixed at design time.
 * Pronouns, register, and sample registers are recorded wherever a
 * captain is named (the owner's voice-casting rule). The template
 * bark source (§13) speaks from these lines; a later model-backed
 * source would receive the same profile as fixed text — switching
 * sources never changes who a captain is.
 */
export interface CaptainVoiceProfile {
  pronouns: CaptainPronouns;
  /** The register, in plain words. */
  register: string;
  /** The banned registers (design §13.2): what this voice never
   *  does, carried as data so later speech sources can be checked
   *  against it. Part of the profile since P1. */
  never: string;
  /** One line in the captain's own register. */
  sampleLine: string;
  /** Greeting lines (a hello to a visitor it shares a world with).
   *  `{world}` is replaced with the world's plain name. */
  greetingLines: readonly string[];
  /** Idle lines (spoken to no one in particular — Chronicle color). */
  idleLines: readonly string[];
}

/** One captain's definition: who it is, where it lives, what it may
 *  do, and how it sounds. */
export interface CaptainDefinition {
  id: CaptainId;
  name: string;
  /** The archetype, in plain words. */
  role: string;
  pronouns: CaptainPronouns;
  /** Age band, in plain words (voice-casting rule). */
  ageBand: string;
  /** Personality, in plain words (voice-casting rule). */
  personality: string;
  traits: readonly [CaptainTrait, CaptainTrait, CaptainTrait];
  /** The anchor's world (P1 spec §6.1: `homeWorld` stays, with the
   *  narrowed meaning "the anchor's world" — for ship-homed
   *  captains, the berthing world). It must always equal
   *  `homeAnchor.world`; the registry test enforces the equality. */
  homeWorld: CaptainWorld;
  /** The specific home anchor (P1 spec §6) — a berth, a quarter, a
   *  terrace, a keeper's cell, a workshop berth, or the ship. */
  homeAnchor: CaptainHomeAnchor;
  /** The GLB model key of the captain's ship (a real fleet asset,
   *  already loaded as traffic — never a procedural placeholder). */
  shipModelKey: string;
  /** The only act kinds this captain may perform in L1/P1. */
  allowList: readonly NpcActKind[];
  voice: CaptainVoiceProfile;
  /** P1 flies exactly Bex and Junia; the others are defined, not
   *  flying. Flipping any other flag is out of spec (spec §7). */
  active: boolean;
}

const CAPTAIN_L1_ALLOW_LIST: readonly NpcActKind[] = [
  "travel",
  "arrive",
  "depart",
  "greet",
  "wait",
  "speak",
] as const;

/** Dain — the Hauler (settled 2026-10-31, owner's tap, Set A).
 *  Defined in L1; flies in a later increment. */
export const DAIN: CaptainDefinition = {
  id: "dain",
  name: "Dain",
  role: "Hauler",
  pronouns: "he",
  ageBand: "late 40s",
  personality: "Steady, dry-witted, unhurried.",
  traits: ["Methodical", "Generous", "Stubborn"],
  homeWorld: "great-station",
  homeAnchor: { kind: "berth", world: "great-station", label: "his Station berth" },
  shipModelKey: "challenger",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "he",
    register: "Dry, economical, understated humor; talks cargo and margins; never flowery.",
    never: "Never flowery, never hurried, never sentimental about cargo.",
    sampleLine: "Ore's ore. It sells, I haul it.",
    greetingLines: [
      "Morning. Dock's busy, prices are honest — good day for it.",
      "You caught me between runs. That's the best time to catch me.",
    ],
    idleLines: [
      "A full hold is a quiet mind.",
      "Margins are thin. So is my patience for thin margins.",
    ],
  },
} as const;

/** Veyra — the Seeker (settled 2026-10-31, owner's tap, Set A).
 *  Defined in L1; flies in a later increment. Ship-homed: Scale is
 *  her berthing and plan-bias world, not her residence (spec C3). */
export const VEYRA: CaptainDefinition = {
  id: "veyra",
  name: "Veyra",
  role: "Seeker",
  pronouns: "she",
  ageBand: "early 30s",
  personality: "Restless, private, quietly intense.",
  traits: ["Restless", "Private", "Bold"],
  homeWorld: "scale",
  homeAnchor: { kind: "ship", world: "scale", label: "her ship" },
  shipModelKey: "omen",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "she",
    register: "Terse, low-volume, long silences; short lines about the search and the far side of things; never chatty.",
    never: "Never chatty, never forthcoming about the search, never loud.",
    sampleLine: "Nothing at Scale. The stirring was wrong, or I was.",
    greetingLines: [
      "You're here. So am I, for now.",
      "Few words, then. I'm listening.",
    ],
    idleLines: [
      "The way onward doesn't hide. It waits.",
      "I count what I haven't found. It's a longer list.",
    ],
  },
} as const;

/** Bex — the Regular (settled 2026-10-31, owner's tap, Set A).
 *  The captain L1 flies end-to-end; in P1 her visitor circuit
 *  widens to every D-1 travel-open world. */
export const BEX: CaptainDefinition = {
  id: "bex",
  name: "Bex",
  role: "Regular",
  pronouns: "she",
  ageBand: "late 20s",
  personality: "Warm, sociable, always at the Station.",
  traits: ["Sociable", "Generous", "Cautious"],
  homeWorld: "great-station",
  homeAnchor: { kind: "quarter", world: "great-station", label: "her Station quarter" },
  shipModelKey: "bob",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: true,
  voice: {
    pronouns: "she",
    register: "Warm, quick, Station gossip with a kind edge; remembers everyone's business, including yours.",
    never: "Never cruel, never a gossip with a knife in it, never pretends to be a person.",
    sampleLine: "You missed Dain sulking at the Foundry. He'll live.",
    greetingLines: [
      "There you are! I was just telling the dock you're the interesting arrival today.",
      "Hey — good to see a familiar hull. Stick around {world} a while.",
      "Oh, it's you. Come on then, the Station's been saving its best gossip.",
    ],
    idleLines: [
      "Somebody's got to keep this dock sociable. Apparently it's me.",
      "I know every ship by sound now. Every single one.",
    ],
  },
} as const;

/** Junia — the Tender (approved Five Captains Proposal, 2026-10-31).
 *  ACTIVE in P1 by the owner's C2 ruling: resident at the Growing
 *  Place, living there with the L1 verbs only — no tend act exists
 *  in P1 for anyone (spec F25). Ship: the pancake — a broad, homely
 *  hull for a tender who feeds people (RA-3 assignment, recorded in
 *  the P1 build record). */
export const JUNIA: CaptainDefinition = {
  id: "junia",
  name: "Junia",
  role: "Tender",
  pronouns: "she",
  ageBand: "late 50s",
  personality: "Unhurried, warm-handed, and quietly immovable.",
  traits: ["Methodical", "Generous", "Cautious"],
  homeWorld: "growing-place",
  homeAnchor: { kind: "terrace", world: "growing-place", label: "a tender's cottage-terrace at the Growing Place" },
  shipModelKey: "pancake",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: true,
  voice: {
    pronouns: "she",
    register: "Slow, warm, plainspoken; gardening time as the measure of all time; talks growing, feeding people, weather of the Place.",
    never: "Never hurried, never clinical, never a word of wilting or blight — in her care and in her speech, nothing goes brown (the kindness rule).",
    sampleLine: "The lower beds came up early this year. They do that when they're ready, not when I'm ready.",
    greetingLines: [
      "Sit a moment. There's food before there's business — that's the order of things here.",
      "You came by the terrace. Good. The lower beds are up early this year.",
    ],
    idleLines: [
      "Things come up when they're ready. Not before, and not because I fretted about it.",
      "I keep people the way I keep beds: fed, unforced, and never once written off.",
    ],
  },
} as const;

/** Hollis — the Delver (approved proposal). Ship-homed at the Great
 *  Station; the Deep Past is his working world, visited and never
 *  settled (D-1). Ship: the wato — a plain working hull (RA-3). */
export const HOLLIS: CaptainDefinition = {
  id: "hollis",
  name: "Hollis",
  role: "Delver",
  pronouns: "he",
  ageBand: "mid-40s",
  personality: "A quiet, deep-water man; patient in the strata, reverent, with a gravel-dry humour.",
  traits: ["Private", "Stubborn", "Bold"],
  homeWorld: "great-station",
  homeAnchor: { kind: "ship", world: "great-station", label: "his ship, berthed at the Great Station" },
  shipModelKey: "wato",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "he",
    register: "Low, sparse, unadorned; long pauses are part of the register; talks depth, marks, light, what was kept.",
    never: "Never chatty, never boastful, never calls anything in the Deep Past \"forgotten\" or \"lost\" — it is kept, and so is he.",
    sampleLine: "Eight strata down, the light changes. I go slow there. It deserves slow.",
    greetingLines: [
      "Mind the step. …You're here. Good.",
      "Back from the quiet. You'll have to do the talking at first.",
    ],
    idleLines: [
      "A thing seen slowly is worth ten things reported quickly.",
      "The strata keep their order. So do I.",
    ],
  },
} as const;

/** Sorrel — the Keeper (approved proposal). They/them — the C4
 *  done-test captain. Resident keeper at the Archive. Ship: the
 *  zenith — a high, quiet hull (RA-3). */
export const SORREL: CaptainDefinition = {
  id: "sorrel",
  name: "Sorrel",
  role: "Keeper",
  pronouns: "they",
  ageBand: "early 40s",
  personality: "Still, exact, and gentler than their precision first suggests.",
  traits: ["Private", "Methodical", "Cautious"],
  homeWorld: "quiet-archive",
  homeAnchor: { kind: "cell", world: "quiet-archive", label: "a keeper's cell at the Archive" },
  shipModelKey: "zenith",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "they",
    register: "Measured, precise, low-volume; sentences complete and short; talks keeping, rest, what is and is not lost.",
    never: "Never gossipy, never revealing about anything in their keeping, never uses \"gone\" where \"resting\" is true.",
    sampleLine: "It isn't lost. It's resting. There's a difference, and the difference is the whole job.",
    greetingLines: [
      "You came a long way on purpose. That's noted — and welcome.",
      "Rest a moment. Nothing here is in a hurry to be opened.",
    ],
    idleLines: [
      "What comes to rest here stays rested. That is the arrangement.",
      "A shelf in order is a quiet mind. Mine is quiet.",
    ],
  },
} as const;

/** Yara — the Long-Hauler (approved proposal). Ship-homed on the
 *  Scale road (anchor world: scale, per the spec §6.2 table and the
 *  RA-3 ruling). Ship: the imperial — a big road hull (RA-3). */
export const YARA: CaptainDefinition = {
  id: "yara",
  name: "Yara",
  role: "Long-Hauler",
  pronouns: "she",
  ageBand: "late 30s",
  personality: "Big-road energy: a loud laugh, a longer memory, and a convoy captain's instinct that nobody travels alone.",
  traits: ["Bold", "Sociable", "Restless"],
  homeWorld: "scale",
  homeAnchor: {
    kind: "ship",
    world: "scale",
    label: "her ship — an at-large ship home on the Scale road, berthed at the Great Station between runs",
  },
  shipModelKey: "imperial",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "she",
    register: "Hearty, direct, road-metaphor native; talks convoys, weather of the lanes, who's travelling and who's overdue for company.",
    never: "Never sentimental about the rim, never disparaging about slow hulls — the slowest hull sets the pace.",
    sampleLine: "A convoy's only as fast as its slowest hull, and I love my slowest hull. Mostly.",
    greetingLines: [
      "Well, look who caught the convoy! Berth's open, and the laugh's free.",
      "You travel alone too much. Sit with the road crew a while.",
    ],
    idleLines: [
      "Nobody travels alone on my road if I can help it.",
      "The rim isn't the edge of anything. It's the far end of the route.",
    ],
  },
} as const;

/** Felix — the Engineer (approved proposal). Ship: the spitfire —
 *  a quick, sparky workshop hull (RA-3). */
export const FELIX: CaptainDefinition = {
  id: "felix",
  name: "Felix",
  role: "Engineer",
  pronouns: "he",
  ageBand: "early 30s",
  personality: "Bright, quick-handed, and constitutionally unable to walk past a malfunction.",
  traits: ["Sociable", "Greedy", "Methodical"],
  homeWorld: "great-station",
  homeAnchor: { kind: "workshop-berth", world: "great-station", label: "a workshop-adjacent berth at the Great Station" },
  shipModelKey: "spitfire",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "he",
    register: "Quick, cheerful, technical-without-jargon; talks fixes, tolerances, margins, what things do when they work.",
    never: "Never mystical about machines, never disparaging about a broken thing — broken is a state, not a verdict.",
    sampleLine: "Bring me a broken thing before you bring me a story about it. Broken things I can fix.",
    greetingLines: [
      "Quick hello — then tell me what's broken. Broken things first, stories after.",
      "You caught the workshop at its best hour: everything humming. Mostly.",
    ],
    idleLines: [
      "A dead thing working again is the whole religion. Everything else is commentary.",
      "She'll hold better. They always hold better.",
    ],
  },
} as const;

export const CAPTAIN_DEFINITIONS: readonly CaptainDefinition[] = [
  DAIN,
  VEYRA,
  BEX,
  JUNIA,
  HOLLIS,
  SORREL,
  YARA,
  FELIX,
] as const;

export function captainDefinition(id: string): CaptainDefinition | undefined {
  return CAPTAIN_DEFINITIONS.find((d) => d.id === id);
}

/** Budgets (owner-set constants, design §3.4 — counted per space,
 *  per space-local day, on the shared NPC log, exactly as the roster
 *  budgets are). Bex is social software: her day legitimately holds
 *  more small acts than the harbor controller's. */
export const CAPTAIN_MAX_ACTS_PER_DAY = 32;
export const CAPTAIN_MAX_SPEAKS_PER_DAY = 48;

/** The lazy advance (design §3): hourly seeded steps, capped — a
 *  longer absence becomes one summarized jump, honestly logged. */
export const CAPTAIN_ADVANCE_STEP_MS = 60 * 60 * 1000;
export const CAPTAIN_ADVANCE_MAX_STEPS = 72;

/** Transit timing (P1 spec §5.1, ruled at build authorization —
 *  RA-8): a warp leg arrives at the start of the next advance step
 *  after departure; a drift leg at the start of the third. Home legs
 *  follow their kind's timing. An arrival step is always strictly
 *  after its departure step, and drift is always strictly longer
 *  than warp on the same route — fuel buys speed, never access. */
export const CAPTAIN_LEG_WARP_STEPS = 1;
export const CAPTAIN_LEG_DRIFT_STEPS = 3;

/** A leg's kind: warp (charged, fast), drift (free, slow), or home
 *  (a leg whose destination is the captain's home anchor world by
 *  the home route — always free, timed like its underlying kind). */
export type CaptainLegKind = "warp" | "drift" | "home";

/** Starting balances (design §7.1: a captain's own ledgers under the
 *  player's rules). Fuel burns only on warps in L1 — drift is free,
 *  so a captain can never be stranded; credits have no L1 source or
 *  sink yet (the economy is L3) and the balance simply exists, honest
 *  from day one. */
export const CAPTAIN_START_FUEL = 60;
export const CAPTAIN_START_CREDITS = 120;

/**
 * The questions a visitor may ask a captain in L1 — a fixed set of
 * kinds, each answered from live state and the captain's own memory
 * stream, in plain words (design §9, L1 subset). There is no
 * free-text question: the model/key question is still the owner's.
 */
export type CaptainQuestionKind = "doing" | "met" | "headed";

export const CAPTAIN_QUESTION_KINDS: readonly CaptainQuestionKind[] = [
  "doing",
  "met",
  "headed",
] as const;

/** The memory stream (design §6.2): in L1 a captain writes meetings,
 *  observations, and session markers only. Importance is a fixed
 *  rubric in shared constants (§6.2), never a model call. */
export type CaptainMemoryKind = "meeting" | "observation" | "session";

export const CAPTAIN_MEETING_IMPORTANCE_FIRST = 8;
export const CAPTAIN_MEETING_IMPORTANCE = 6;
export const CAPTAIN_OBSERVATION_IMPORTANCE = 3;
export const CAPTAIN_SESSION_IMPORTANCE = 4;

export interface CaptainMemoryEntry {
  id: number;
  captainId: CaptainId;
  kind: CaptainMemoryKind;
  /** What happened, in plain words — the captain's own record. */
  text: string;
  importance: number;
  /** Retrieval tags (design §6.3): world keys, people, topics. */
  tags: string[];
  createdAt: string;
}

/** One stored bark (design §13): a spoken line and its provenance.
 *  `source` is always "template" in L1 — the LLM cartridge of the
 *  seam is a later, separately-authorized increment. */
export interface CaptainBark {
  id: number;
  captainId: CaptainId;
  /** The space-local day the line belongs to (YYYY-MM-DD). */
  dayKey: string;
  context: "greeting" | "idle";
  text: string;
  source: "template";
  /** The npc_log entry ids the line rests on (may be empty). */
  basedOn: number[];
  createdAt: string;
}

/** One captain's state as the client sees it. */
export interface CaptainState {
  id: CaptainId;
  name: string;
  role: string;
  pronouns: CaptainPronouns;
  ageBand: string;
  personality: string;
  traits: readonly string[];
  /** Defined but not flying yet (six of the eight in P1). */
  active: boolean;
  /** In a public world right now (false while away between visits
   *  and false while a leg is open — underway is present nowhere). */
  present: boolean;
  homeWorld: CaptainWorld;
  /** The specific home anchor's label, as the panel prints it
   *  (P1 spec §6.1) — the panel names the place, not just the world. */
  homeAnchor: string;
  /** The world the captain is in, or null while away / in transit. */
  currentWorld: CaptainWorld | null;
  /** "visiting" while a session is live, "away" between visits. A
   *  captain with an open leg reports her transit state in
   *  `transitState` instead — "away" never hides a transit. */
  sessionState: "visiting" | "away";
  /** Transit state (P1 spec §5.3): "none" when no leg is open;
   *  "departed" in the departure step; "underway" once a later step
   *  has been processed and the arrival step is not yet reached. */
  transitState: "none" | "departed" | "underway";
  /** The open leg's destination (a world from her held plan), or
   *  null when no leg is open. */
  legTo: CaptainWorld | null;
  /** The open leg's kind, or null when no leg is open. */
  legKind: CaptainLegKind | null;
  /** What the captain is doing, in one plain line (her current act / plan). */
  doingLine: string;
  fuel: number;
  credits: number;
  stopped: boolean;
  actsToday: number;
  speaksToday: number;
  /** Meetings she remembers (her stream's meeting entries). */
  meetingsRemembered: number;
  /** When she first remembers meeting you (ISO), or null. */
  firstMetAt: string | null;
  /** The most recent log entries, newest first (the shared log). */
  recentLog: NpcLogEntry[];
  /** Her stored template lines for today, newest first. */
  barks: CaptainBark[];
}

/** One Chronicle line (design §8.1): a read model over the shared
 *  append-only log — harbor and captain acts as plain radio lines,
 *  with their causes. */
export interface ChronicleLine {
  id: number;
  npcId: NpcId;
  npcName: string;
  kind: NpcActKind;
  /** What happened, in plain words. */
  line: string;
  /** Why, in plain words. */
  cause: string;
  createdAt: string;
}
