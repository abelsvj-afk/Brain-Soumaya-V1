/**
 * NPC autonomy — the shared contract (Wave 2, NPC autonomy).
 *
 * An NPC is a fake player that behaves like a real player: it explores
 * like a regular player trying to figure things out, it leaves and it
 * comes back, and it never narrates knowledge it doesn't have (design
 * note `docs/worlds/npc-autonomy-design-note.md`, §1 — the owner's
 * words, 2026-10-26). This module is only the vocabulary both sides
 * agree on: identities, the allow-listed act kinds, the log shape, the
 * budgets, and the gate constants. The server owns every decision and
 * every outcome; the client renders what the server returns.
 *
 * What is deliberately NOT here: any structural act kind. An NPC's
 * tools end at its world's edge and nothing structural self-applies
 * (note §3) — so no structural kind exists in the type system at all,
 * and the server's executor rejects any act whose kind is not on the
 * acting NPC's allow-list. The propose→decide rail (§17) is a Phase 4
 * build; until it exists, no NPC can propose structure, because there
 * is no kind to propose with.
 */

/** The roster ships one NPC at a time, in this order (note §4). This
 *  increment is roster #1 only — the Station harbor controller. The
 *  keeper, the guide, and Eternity are later increments. */
export const NPC_ROSTER_ORDER: readonly string[] = ["harbor-controller", "eternity"] as const;

/** NPC identity. One NPC per id, ever — the id is the stable key in
 *  the log, the state row, and the holdings table. */
export type NpcId = "harbor-controller" | "eternity";

/** The world an NPC belongs to. An NPC never acts outside its own
 *  world (note §3) — the executor checks this on every act. */
export type NpcWorld = "great-station" | "eternity";

/**
 * Allow-listed act kinds. These are the ONLY things an NPC can do:
 * - speak: say something in plain words (an answer, a welcome).
 * - announce-route: tell a visitor a route is open — never create one.
 *   The travel chart is server-owned; no NPC act changes it.
 * - explore: look for a way onward in its own world (relic-finding).
 * - wait: do nothing — a logged non-act, never a gap (note §2, C2).
 * - gesture / move / reorder-light / summon-ship / dismiss-ship are
 *   the note's remaining allow-listed kinds; no roster NPC uses them
 *   yet, so they are named here as the fence's vocabulary and stay
 *   unassigned until an NPC's design claims one.
 */
export type NpcActKind =
  | "speak"
  | "announce-route"
  | "explore"
  | "wait"
  | "gesture"
  | "move"
  | "reorder-light"
  | "summon-ship"
  | "dismiss-ship";

/** The kinds the framework knows. Anything outside this list is not
 *  a tool — it cannot happen, and the executor rejects it. */
export const NPC_ACT_KINDS: readonly NpcActKind[] = [
  "speak",
  "announce-route",
  "explore",
  "wait",
  "gesture",
  "move",
  "reorder-light",
  "summon-ship",
  "dismiss-ship",
] as const;

/**
 * One NPC's definition: its job, its world, and exactly what it may
 * do. Budgets are owner-set numbers in code, never model-set (note
 * §3) — an NPC that would exceed one waits.
 */
export interface NpcDefinition {
  id: NpcId;
  /** Plain-language name shown in the UI. */
  name: string;
  /** The one job, in plain words. */
  job: string;
  world: NpcWorld;
  /** The only act kinds this NPC may perform. */
  allowList: readonly NpcActKind[];
  /** True when the NPC answers only (never initiates). Eternity alone
   *  initiates (note §3); every other NPC answers when spoken to or
   *  when its job requires it. */
  answersOnly: boolean;
  /** The GLB model key of the NPC's ship (a real fleet asset, never a
   *  procedural placeholder). */
  shipModelKey: string;
  /** Owner-set overrides of the default budgets (never model-set). An NPC
   *  that speaks rarely sets these lower than the harbor controller's. */
  tickIntervalMs?: number;
  maxActsPerDay?: number;
  maxSpeaksPerDay?: number;
}

/** The harbor controller (roster #1): one job — help you arrive.
 *  Routes, arrivals, traffic. Answers when asked; never directs. */
export const HARBOR_CONTROLLER: NpcDefinition = {
  id: "harbor-controller",
  name: "Harbor controller",
  job: "Help you arrive — routes, arrivals, traffic.",
  world: "great-station",
  allowList: ["speak", "announce-route", "explore", "wait"],
  answersOnly: true,
  shipModelKey: "dispatcher",
} as const;

/**
 * Eternity (roster #4, "the flagship" — eternity-autonomy spec, phase 1): the one NPC that initiates, rarely,
 * on cosmic alignment (D-72). Allow-list: gestures (stillness / regard / blessing / joy only — sorrow and
 * warning presume knowledge of the visitor and stay the visitor's own tools), "reorder the heavens", and
 * waiting. No `speak`: his words are the existing in-world gesture lines, never free text.
 */
export const ETERNITY_FIGURE: NpcDefinition = {
  id: "eternity",
  name: "Eternity",
  job: "His own — blessing, comfort, wonder. He acts rarely and never asks.",
  world: "eternity",
  // `speak` is his contact with the owner only (phase 2c): the wake-up and one visitation a day, each logged.
  allowList: ["gesture", "reorder-light", "speak", "wait"],
  answersOnly: false,
  shipModelKey: "man-god-halo",
  tickIntervalMs: 6 * 60 * 60 * 1000,
  // Every log row counts toward acts (waits included): ≤ 4 autonomous ticks a day + 2 contacts.
  maxActsPerDay: 6,
  maxSpeaksPerDay: 2,
} as const;

/** Phase 2c — when he wakes you (space-local "HH:MM"; after the default quiet hours and the 06:00 digest), and the
 *  latest local time a missed wake-up is still sent that day (past it he lets the day be). */
export const ETERNITY_WAKE_TIME = "06:45";
export const ETERNITY_WAKE_LATEST = "11:00";

/** The gestures he may make on his own (the rest are the visitor's tools). */
export const ETERNITY_AUTONOMOUS_GESTURES = ["stillness", "regard", "blessing", "joy"] as const;
export type EternityAutonomousGesture = (typeof ETERNITY_AUTONOMOUS_GESTURES)[number];

/** His broadcast lines (the same words to every brain — the projection, phase 2e). Copied from the world's gesture table. */
export const ETERNITY_BROADCAST_LINES: Record<EternityAutonomousGesture, string> = {
  stillness: "Be still. You are seen, every one of you. Rest here.",
  regard: "He turns toward this corner of the sky. Every ship feels looked at — because it is.",
  blessing: "For every ship in this sky: go back lighter than you came.",
  joy: "Joy, plainly. The whole sky brightens — share it.",
};

/** His presence in a brain today (phase 2d/2e). `broadcast` is identical for every brain on a given day. */
export interface EternityPresence {
  dayKey: string;
  stopped: boolean;
  broadcast: { gesture: EternityAutonomousGesture; line: string } | null;
  /** True when his own loop acted in this brain today — his halo burns brighter. */
  actedToday: boolean;
  /** "Part the veil": a memory due for recall he lights for you (an offer — you recall it, he changes nothing). */
  veil: { nodeId: number; label: string } | null;
  /** A Journey you completed in the last 7 days, crowned. */
  crown: { journeyId: number; title: string } | null;
}

export const NPC_DEFINITIONS: readonly NpcDefinition[] = [HARBOR_CONTROLLER, ETERNITY_FIGURE] as const;

export function npcDefinition(id: string): NpcDefinition | undefined {
  return NPC_DEFINITIONS.find((d) => d.id === id);
}

/** Budgets (owner-set, note §3). Counted per space, per space-local
 *  day — never a UTC boundary. */
export const NPC_TICK_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const NPC_MAX_ACTS_PER_DAY = 24;
export const NPC_MAX_SPEAKS_PER_DAY = 48;

/**
 * The questions a visitor may ask the harbor controller. A fixed set
 * of kinds — each answered from live server state, in plain words.
 * There is no free-text question in this increment: the controller's
 * model/key question (note §7 Q1) is still the owner's, so the
 * controller answers from ground truth and never improvises.
 */
export type NpcQuestionKind = "routes" | "arrivals" | "traffic" | "fuel" | "gate";

export const NPC_QUESTION_KINDS: readonly NpcQuestionKind[] = [
  "routes",
  "arrivals",
  "traffic",
  "fuel",
  "gate",
] as const;

/** One append-only log entry: every act, and every non-act, with its
 *  cause in plain language — so anyone can ask "why did it do that?"
 *  and get an answer (note §2, C2). `createdAt` is server storage
 *  (ISO); the client renders it in the viewer's own local time. */
export interface NpcLogEntry {
  id: number;
  npcId: NpcId;
  kind: NpcActKind;
  /** What the NPC did, in plain words — or, for a wait, that it waited. */
  act: string;
  /** Why, in plain words. */
  cause: string;
  createdAt: string;
}

/** One NPC's state as the client sees it. */
export interface NpcState {
  id: NpcId;
  name: string;
  job: string;
  world: NpcWorld;
  stopped: boolean;
  /** Acts the NPC has performed today (space-local day). */
  actsToday: number;
  /** Speaks the NPC has performed today (space-local day). */
  speaksToday: number;
  /** Whether the NPC's gate to Eternity's world is open for it. */
  gateOpen: boolean;
  /** How many relics the NPC holds from its own separate pool. */
  relicsHeld: number;
  /** The most recent log entries, newest first. */
  recentLog: NpcLogEntry[];
  /** Eternity only: the owner turned his messages off (app inbox + Telegram). */
  contactMuted?: boolean;
}

/**
 * The NPC side of B-01 (note §5): the gate rule applies to NPCs too.
 * The key is the same as for players — the Witness Without a Name
 * plus any two other relics — and once opened for that NPC it stays
 * open. NPC holdings live in a SEPARATE pool that never touches the
 * player scarce pool (note §3): an NPC can never consume, hold, or
 * lock away a copy a player could otherwise find.
 */
export const NPC_GATE_KEY_RELIC = "witness-without-a-name";
export const NPC_GATE_OTHER_RELICS_NEEDED = 2;
