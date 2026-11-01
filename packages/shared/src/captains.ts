import type { NpcActKind, NpcId, NpcLogEntry } from "./npcs.js";

/**
 * Player NPCs — the captains (NPC-Player Layer, L1 — Presence).
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
 * L1 activates ONE captain end-to-end: Bex, the Regular. Dain and
 * Veyra are defined in full — traits, voice profiles, ships — with
 * `active: false`; they fly in later increments, never as a crowd.
 */

/** The captain ids (the non-roster half of `NpcId`). */
export type CaptainId = Exclude<NpcId, "harbor-controller">;

/** The worlds a captain may live in during L1: the two public
 *  worlds. Captains never enter private worlds (settled 2026-10-27).
 *  Home/current are FIELDS, not constants — later increments widen
 *  the set without redesign. */
export type CaptainWorld = "great-station" | "scale";

export const CAPTAIN_PUBLIC_WORLDS: readonly CaptainWorld[] = ["great-station", "scale"] as const;

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

/**
 * A captain's voice profile (design §13.2): fixed at design time.
 * Pronouns, register, and sample registers are recorded wherever a
 * captain is named (the owner's voice-casting rule). The template
 * bark source (§13) speaks from these lines; a later model-backed
 * source would receive the same profile as fixed text — switching
 * sources never changes who a captain is.
 */
export interface CaptainVoiceProfile {
  pronouns: "he" | "she";
  /** The register, in plain words. */
  register: string;
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
  pronouns: "he" | "she";
  /** Age band, in plain words (voice-casting rule). */
  ageBand: string;
  /** Personality, in plain words (voice-casting rule). */
  personality: string;
  traits: readonly [CaptainTrait, CaptainTrait, CaptainTrait];
  /** Where the captain's life is anchored (a state field, design §2
   *  of the civilization addendum — not a hardcode: `currentWorld`
   *  in state starts here). */
  homeWorld: CaptainWorld;
  /** The GLB model key of the captain's ship (a real fleet asset,
   *  already loaded as traffic — never a procedural placeholder). */
  shipModelKey: string;
  /** The only act kinds this captain may perform in L1. */
  allowList: readonly NpcActKind[];
  voice: CaptainVoiceProfile;
  /** L1 activates Bex only; the others are defined, not flying. */
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
  shipModelKey: "challenger",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "he",
    register: "Dry, economical, understated humor; talks cargo and margins; never flowery.",
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
 *  Defined in L1; flies in a later increment. */
export const VEYRA: CaptainDefinition = {
  id: "veyra",
  name: "Veyra",
  role: "Seeker",
  pronouns: "she",
  ageBand: "early 30s",
  personality: "Restless, private, quietly intense.",
  traits: ["Restless", "Private", "Bold"],
  homeWorld: "scale",
  shipModelKey: "omen",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: false,
  voice: {
    pronouns: "she",
    register: "Terse, low-volume, long silences; short lines about the search and the far side of things; never chatty.",
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
 *  The one captain L1 flies end-to-end. */
export const BEX: CaptainDefinition = {
  id: "bex",
  name: "Bex",
  role: "Regular",
  pronouns: "she",
  ageBand: "late 20s",
  personality: "Warm, sociable, always at the Station.",
  traits: ["Sociable", "Generous", "Cautious"],
  homeWorld: "great-station",
  shipModelKey: "bob",
  allowList: CAPTAIN_L1_ALLOW_LIST,
  active: true,
  voice: {
    pronouns: "she",
    register: "Warm, quick, Station gossip with a kind edge; remembers everyone's business, including yours.",
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

export const CAPTAIN_DEFINITIONS: readonly CaptainDefinition[] = [DAIN, VEYRA, BEX] as const;

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
  pronouns: "he" | "she";
  ageBand: string;
  personality: string;
  traits: readonly string[];
  /** Defined but not flying yet (Dain, Veyra in L1). */
  active: boolean;
  /** In a public world right now (false while away between visits). */
  present: boolean;
  homeWorld: CaptainWorld;
  /** The world she is in, or null while away. */
  currentWorld: CaptainWorld | null;
  /** "visiting" while a session is live, "away" between visits. */
  sessionState: "visiting" | "away";
  /** What she is doing, in one plain line (her current act / plan). */
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
