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

/** Worlds an NPC may NEVER be in: personal brains (the home galaxy). Invitation-only is a future feature — nothing here is a back door. */
export const NPC_NEVER_WORLDS: readonly string[] = ["home"] as const;

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
  /** Other worlds this NPC may be in and act in (docs/specs/npc-society-2026-10-30.md). Never a personal brain. */
  roams?: readonly string[];
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
  roams: ["growing-place", "deep-past", "quiet-archive", "scale", "people"],
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

/**
 * The daily script (docs/specs/npc-daily-script-2026-10-30.md): every line the NPCs may need for a brain's local day, asked of the
 * model in ONE batched call and cached. Each NPC lists its situations and how many variants it wants; `need` is the guidance the
 * prompt gives the model for that situation (descriptions only for NPCs that merely answer — the fence).
 */
export type NpcSituation =
  | "encounter_patrolling"
  | "encounter_docked"
  | "encounter_arrival"
  | "encounter_near"
  | "encounter_visiting"
  | "encounter_first"
  | "chatter"
  | "wake"
  | "visitation";

export interface NpcSituationSpec {
  situation: NpcSituation;
  /** Variants wanted (the client rotates through them). */
  count: number;
  /** What the line is, in plain words, for the prompt. */
  need: string;
}

// --- The cast (docs/specs/npc-society-2026-10-30.md): who lives in the worlds, where they go, what they do ---

import type { ActivityKind, FactionId } from "./society.js";

export type NpcTrail = "blue" | "neon" | "gold" | "purple";

/** One layer of an NPC's lore: a deeper thread, unlocked by meeting them enough. Content is the owner's to write (none shipped). */
export interface NpcLoreLayer {
  key: string;
  minMeetings: number;
}

export interface CastMember {
  /** Stable id. The autonomous ones share their NpcDefinition's id; ambient ones are cast-only. */
  id: string;
  name: string;
  /** Where they live. */
  home: string;
  /** Other worlds they go to. Never a personal brain; empty = never leaves home. */
  roams: readonly string[];
  /** The chance (0..1) that, in any two-hour slot, they are at home rather than away. 1 for a non-roamer. */
  homeShare: number;
  job: string;
  /** What their days look like, one or two plain sentences. */
  life: string;
  /** The voice they speak in, for the daily script. */
  voice: string;
  /** Their ship: a Quaternius hull already in public/ (null = no body, e.g. Eternity, who is the world). */
  shipUrl: string | null;
  trail: NpcTrail;
  /** May say a line when you cross paths (every cast member does; the ones that also have loops answer questions in their panels). */
  speaks: boolean;
  /** Which faction they belong to (docs/specs/npc-hive-society-2026-10-30.md), or null for the unaligned (Eternity is the sky; the Wayfarer answers to no one). */
  faction: FactionId | null;
  /** Their own temper toward Eternity, −1 (sceptic) … +1 (devout). Never overwritten; the society's tide only moves them a little. */
  faith: number;
  /** How far the society's tide moves their faith, 0..1. */
  susceptibility: number;
  /** What they want this season — their aspirations, in their own terms. */
  goals: readonly string[];
  /** Baseline activity weights for their working day (before calling/ordinance multipliers). */
  routine: Partial<Record<ActivityKind, number>>;
  /** What "work" looks like for them, as a caption ("tending the groves"). */
  workCaption: string;
  /** "canon" only once the owner has written it; everything shipped now is "provisional" — a placeholder person, no lore claims. */
  canon: "canon" | "provisional";
  lore: { tagline: string; layers: readonly NpcLoreLayer[] };
  /** Pell's rule: where they are is where the world put them this long AGO (ms) — a person who is always behind. Omitted for everyone else. */
  lagMs?: number;
  /** Offline greetings (first person) when no model script exists — nobody goes silent without a key. */
  greetings: readonly string[];
  /** How they introduce themselves at a first meeting (first person; offline fallback for the model's `encounter_first`). */
  intro: string;
}

export const NPC_CAST: readonly CastMember[] = [
  {
    id: "harbor-controller",
    name: "Harbor controller",
    home: "great-station",
    roams: ["growing-place", "deep-past", "quiet-archive", "scale", "people"],
    homeShare: 0.6,
    job: "Keeps the Great Station's traffic safe and helps arrivals find their way.",
    life: "Patrols the Station on a long lap and docks at her berth between rounds; now and then flies out to see how the other worlds' traffic fares.",
    voice: "Calm, practical, dry-warm; a working pilot who has seen every kind of arrival. Short sentences.",
    shipUrl: "/quaternius-dispatcher.glb",
    trail: "blue",
    faction: "wardens",
    faith: 0.35,
    susceptibility: 0.3,
    goals: ["Keep every lane clear and every arrival safe.", "Learn what the Undertow is really asking for."],
    routine: { patrol: 3, work: 1.5, discuss: 1, refuel: 0.6, rest: 0.8, trade: 0.3, travel: 0.4 },
    workCaption: "keeping the lanes in order",
    speaks: true,
    canon: "provisional",
    lore: { tagline: "She is who you ask about routes and arrivals.", layers: [] },
    greetings: [
      "Clear skies, traveller. Tap my tag if you need a route.",
      "Traffic's light. Ask me if you want the way somewhere.",
      "Good to see a ship I know. Need anything?",
    ],
    intro: "I'm the Harbor controller. Ask me about routes and arrivals — I only ever answer.",
  },
  {
    id: "eternity",
    name: "Eternity",
    home: "eternity",
    roams: [],
    homeShare: 1,
    job: "His own — blessing, comfort, wonder.",
    life: "He is the sky of his world and does not leave it; he acts rarely, in his own time.",
    voice: "Ancient, brief, warm, unhurried; plain words with cosmic weight, never questions.",
    shipUrl: null,
    trail: "gold",
    faction: null,
    faith: 1,
    susceptibility: 0,
    goals: ["To be a sky worth looking up to."],
    routine: { rest: 1 },
    workCaption: "keeping the heavens",
    speaks: true,
    canon: "provisional",
    lore: { tagline: "He blesses and comforts, rarely, in his own time.", layers: [] },
    greetings: ["You are here. That is enough.", "Be still a moment. You are seen."],
    intro: "I am Eternity. My gestures are how you answer me.",
  },
  {
    id: "keeper",
    name: "The Keeper",
    home: "growing-place",
    roams: ["great-station", "deep-past"],
    homeShare: 0.75,
    job: "Tends the Growing Place's groves and watches what grows from your Journeys.",
    life: "Walks the terraces at dawn, rests under the witness tree, and sometimes visits the Station to trade seeds and the Deep Past to look at old roots.",
    voice: "Patient, gentle, a little earthy; speaks of growing things and of waiting.",
    shipUrl: "/quaternius-pancake.glb",
    trail: "gold",
    faction: "open-hand",
    faith: 0.7,
    susceptibility: 0.3,
    goals: ["See the witness tree bear fruit.", "Learn why some Journeys stall and what helps them grow."],
    routine: { work: 3, rest: 1.2, discuss: 1, worship: 0.8, wander: 0.4, travel: 0.4, trade: 0.4 },
    workCaption: "tending the groves",
    speaks: true,
    canon: "canon",
    lore: { tagline: "Someone has been tending this place for longer than it has had a name.", layers: [{ key: "keeper.seed", minMeetings: 1 }, { key: "keeper.bough", minMeetings: 3 }, { key: "keeper.water", minMeetings: 5 }] },
    greetings: [
      "Mind the new shoots, friend. They remember where you step.",
      "Everything here is slower than you expect, and better for it.",
      "Rest a while. The garden will wait.",
    ],
    intro: "I'm the Keeper. I tend the groves here, and I watch what grows from your Journeys.",
  },
  {
    id: "archivist",
    name: "The Archivist",
    home: "quiet-archive",
    roams: ["deep-past", "people"],
    homeShare: 0.7,
    job: "Minds the memories you have set aside, and makes sure nothing there is lost.",
    life: "Shelves, dusts and re-reads; goes down to the Deep Past to compare notes, and now and then sits among the People world's lights.",
    voice: "Quiet, exact, a touch wistful; speaks softly and never rushes a thought.",
    shipUrl: "/quaternius-omen.glb",
    trail: "purple",
    faction: "choir",
    faith: 0.5,
    susceptibility: 0.35,
    goals: ["Make sure nothing set aside is ever lost.", "Understand why people set things down."],
    routine: { work: 2.5, rest: 1.5, discuss: 0.8, worship: 1.2, wander: 0.3, travel: 0.4, trade: 0.2 },
    workCaption: "shelving what was set aside",
    speaks: true,
    canon: "canon",
    lore: { tagline: "What is set aside is not forgotten — only kept.", layers: [{ key: "archivist.fold", minMeetings: 1 }, { key: "archivist.alcove", minMeetings: 3 }, { key: "archivist.penance", minMeetings: 4 }] },
    greetings: [
      "Nothing here asks anything of you. Stay as long as you like.",
      "I keep what you set down. I do not judge it.",
      "Soft steps in the archive. Welcome.",
    ],
    intro: "I'm the Archivist. I mind what you've set aside, so that nothing is lost.",
  },
  {
    id: "surveyor",
    name: "The Surveyor",
    home: "scale",
    roams: ["great-station", "deep-past"],
    homeShare: 0.65,
    job: "Measures real things at their real size and tells travellers how big the world really is.",
    life: "Flies tape-measure lines between planets, then drifts over to the Station to check its true span and down to the Deep Past to measure the rim.",
    voice: "Precise, curious, quietly delighted by numbers; a little pedantic and proud of it.",
    shipUrl: "/quaternius-challenger.glb",
    trail: "neon",
    faction: "ledger",
    faith: -0.25,
    susceptibility: 0.45,
    goals: ["Measure everything once, accurately.", "Find the thing that is larger than it looks."],
    routine: { work: 2.5, trade: 1.2, travel: 1.2, discuss: 1, refuel: 0.8, wander: 0.8, rest: 0.6, worship: 0.1 },
    workCaption: "measuring the world",
    speaks: true,
    canon: "canon",
    lore: { tagline: "Everything has a size. Some things are larger than they look.", layers: [{ key: "surveyor.size", minMeetings: 1 }, { key: "surveyor.star", minMeetings: 3 }, { key: "surveyor.cord", minMeetings: 4 }] },
    greetings: [
      "Do you know how far that is? Further than it looks.",
      "Careful — your ship is twelve units. Everything else is bigger.",
      "I measure; you wonder. A fair split.",
    ],
    intro: "I'm the Surveyor. I measure real things at their real size — ask me how big anything is.",
  },
  {
    id: "wayfarer",
    name: "Calend",
    home: "great-station",
    roams: ["growing-place", "deep-past", "quiet-archive", "scale", "people", "eternity"],
    homeShare: 0.2,
    job: "Goes everywhere, belongs nowhere, and knows more than they say.",
    life: "Never stays long. Turns up in every world sooner or later, and always seems to have just come from somewhere you have not been.",
    voice: "Light, wry, a little mysterious; speaks in half-finished thoughts and leaves doors ajar.",
    shipUrl: "/wato-spaceship.glb",
    trail: "purple",
    faction: null,
    faith: -0.05,
    susceptibility: 0.8,
    goals: ["Reach the place everyone keeps not describing.", "Learn whether anyone is listening."],
    routine: { wander: 3, travel: 2.5, discuss: 1.2, rest: 0.8, refuel: 0.6, trade: 0.5, work: 0.3 },
    workCaption: "following a thread",
    speaks: true,
    canon: "canon",
    lore: { tagline: "A traveller who is somehow always already there.", layers: [{ key: "calend.arrived", minMeetings: 1 }, { key: "calend.seam", minMeetings: 2 }, { key: "calend.first", minMeetings: 3 }, { key: "calend.door", minMeetings: 4 }] },
    greetings: [
      "Ah — you again. Or you, soon. Hard to say.",
      "Mind the quiet places. They listen.",
      "I was just in the other one. It was… not as it seemed.",
    ],
    intro: "They call me the Wayfarer. Calend. I go where I'm going, and I've been wherever you're headed.",
  },
  {
    id: "cantor",
    name: "Ysmerel",
    home: "quiet-archive",
    roams: ["growing-place", "great-station", "deep-past"],
    homeShare: 0.55,
    job: "Sings the hours for Eternity and keeps the Choir's vigil.",
    life: "Sings from the Archive's steps at dawn and dusk; walks the other worlds carrying the Choir's word.",
    voice: "Warm, measured, cadenced; speaks as if every sentence were half a hymn.",
    shipUrl: "/quaternius-zenith.glb",
    trail: "gold",
    faction: "choir",
    faith: 0.9,
    susceptibility: 0.15,
    goals: ["Sing a day with no silence in it.", "Bring one doubter back to the hour."],
    routine: { worship: 3, work: 1.5, discuss: 1.5, travel: 1.2, rest: 1, wander: 0.3, trade: 0.2 },
    workCaption: "singing the hours",
    speaks: true,
    canon: "canon",
    lore: { tagline: "The hours are sung whether or not anyone is listening.", layers: [{ key: "ysmerel.torn", minMeetings: 1 }, { key: "ysmerel.gap", minMeetings: 3 }, { key: "ysmerel.hum", minMeetings: 4 }] },
    greetings: [
      "Peace to your hours, traveller.",
      "Eternity keeps all our hours. Even this one.",
      "Stay for the next verse, if you can.",
    ],
    intro: "I'm Ysmerel, the Choir's last choirmaster. I sing the hours, and I keep the vigil.",
  },
  {
    id: "broker",
    name: "Dorrow Quint",
    home: "scale",
    roams: ["great-station", "growing-place", "people"],
    homeShare: 0.5,
    job: "Brokers fuel and goods between the worlds and keeps the Ledger's books.",
    life: "Haggles at the Drydock, runs fuel between the Station and Scale, and knows the price of everything and the cost of most things.",
    voice: "Quick, genial, a little too friendly; talks in margins and favours, never quite lying.",
    shipUrl: "/quaternius-bob.glb",
    trail: "neon",
    faction: "ledger",
    faith: -0.1,
    susceptibility: 0.4,
    goals: ["Corner the fuel market on a slow day.", "Find a debt worth more than it looks."],
    routine: { trade: 3, refuel: 1.5, travel: 1.5, discuss: 1.2, work: 1, rest: 0.5, wander: 0.4, worship: 0.1 },
    workCaption: "working the books",
    speaks: true,
    canon: "canon",
    lore: { tagline: "Everyone owes someone. The Broker keeps count.", layers: [{ key: "dorrow.owes", minMeetings: 1 }, { key: "dorrow.page", minMeetings: 3 }, { key: "dorrow.pay", minMeetings: 5 }] },
    greetings: [
      "Fuel's up a point. Funny how that happens.",
      "Friend! I've got a deal you'll want to hear.",
      "Everything has a price. Some of it is even fair.",
    ],
    intro: "Dorrow Quint, of the Ledger. Fuel, goods, favours — ask me what anything costs.",
  },
  {
    id: "dissenter",
    name: "The Dissenter",
    home: "great-station",
    roams: ["quiet-archive", "deep-past", "people"],
    homeShare: 0.5,
    job: "Asks the questions the Choir and the Wardens would rather not hear.",
    life: "Argues in the Station's concourse, then slips off to the Archive to read what it keeps and to the Deep Past to doubt it.",
    voice: "Sharp, dry, restless; honest to the point of rudeness, but never cruel.",
    shipUrl: "/quaternius-insurgent.glb",
    trail: "purple",
    faction: "undertow",
    faith: -0.7,
    susceptibility: 0.25,
    goals: ["Get one straight answer from the sky.", "Open every lane the Wardens have closed."],
    routine: { discuss: 3, wander: 2, travel: 1.5, rest: 0.8, work: 0.6, trade: 0.4, patrol: 0.1, worship: 0.05 },
    workCaption: "asking awkward questions",
    speaks: true,
    canon: "canon",
    lore: { tagline: "A sky that never answers is still a sky worth asking.", layers: [{ key: "dissenter.hole", minMeetings: 1 }, { key: "dissenter.edge", minMeetings: 3 }, { key: "dissenter.free", minMeetings: 5 }] },
    greetings: [
      "Ask yourself who benefits.",
      "Don't take my word for it. Don't take anyone's.",
      "Still waiting on an answer. You?",
    ],
    intro: "I'm the Dissenter. I ask what nobody else will — don't mind the edges.",
  },
  {
    id: "hesk",
    name: "Hesk",
    home: "great-station",
    roams: ["quiet-archive", "people", "faded-ward"],
    homeShare: 0.65,
    job: "Warden-General: inspects the harbor's rules and keeps its keys.",
    life: "Patrols the annexes, folds what strangers leave behind, and now and then walks to the Archive or the hearths, never saying why.",
    voice: "Stern, tired, exact; says little and means it; kinder than he sounds.",
    shipUrl: "/quaternius-imperial.glb",
    trail: "gold",
    faction: "wardens",
    faith: 0.3,
    susceptibility: 0.3,
    goals: ["Keep every rule the harbor still needs.", "Hand one small thing back to its owner."],
    routine: { patrol: 3, work: 1.5, discuss: 0.8, rest: 1, wander: 0.4, travel: 0.3, worship: 0.2 },
    workCaption: "inspecting the berths",
    speaks: true,
    canon: "canon",
    lore: { tagline: "Rules kept for people who are not here.", layers: [{ key: "hesk.inspect", minMeetings: 1 }, { key: "hesk.door", minMeetings: 2 }, { key: "hesk.keep", minMeetings: 4 }] },
    greetings: [
      "Mind your trail. I notice trails.",
      "Papers, friend. And then a kinder word.",
      "The rules are small. Keeping them is not.",
    ],
    intro: "Hesk, Warden-General. I keep the harbor's rules, and a few of my own.",
  },
  {
    id: "tamsin",
    name: "Tamsin",
    home: "people",
    roams: ["quiet-archive", "growing-place", "faded-ward"],
    homeShare: 0.6,
    job: "Tends the ward for the Open Hand, where the Faded come back in pieces.",
    life: "Carries soup and buttons between narrow cots, sits with each patient, and sometimes goes to the Archive or the groves to be quiet.",
    voice: "Warm, plain, unhurried; a nurse who has learned not to ask the ill for anything.",
    shipUrl: "/quaternius-zenith.glb",
    trail: "gold",
    faction: "open-hand",
    faith: 0.55,
    susceptibility: 0.35,
    goals: ["Remember her patients enough that they can finish returning.", "Never turn away a hand held out."],
    routine: { work: 3, rest: 1.2, discuss: 1, worship: 0.8, wander: 0.3, travel: 0.3, trade: 0.2 },
    workCaption: "tending the ward",
    speaks: true,
    canon: "canon",
    lore: { tagline: "Someone has to sit with the half-returned.", layers: [{ key: "tamsin.soup", minMeetings: 1 }, { key: "tamsin.pieces", minMeetings: 3 }, { key: "tamsin.keep", minMeetings: 5 }] },
    greetings: [
      "Have you lost a button? I have spares.",
      "Soup is hot. Sit if you like.",
      "They are kinder than you would think.",
    ],
    intro: "I'm Tamsin, of the Open Hand. I tend the ward.",
  },
  {
    id: "ossian",
    name: "Ossian Reed",
    home: "great-station",
    roams: ["quiet-archive", "deep-past", "scale", "people", "growing-place"],
    homeShare: 0.3,
    job: "Tells wrong stories on purpose, so you will go looking for the right ones.",
    life: "Trades tales for berths and meals, collects every version of everything, and keeps the true ones to himself.",
    voice: "Quick, grinning, generous with falsehoods and stingy with the truth; every sentence has one word loose.",
    shipUrl: "/quaternius-spitfire.glb",
    trail: "neon",
    faction: "undertow",
    faith: -0.3,
    susceptibility: 0.4,
    goals: ["Be caught, once, by someone who listens.", "Find out whether he invented a girl, or only named her."],
    routine: { discuss: 3, wander: 2, travel: 1.5, trade: 1, rest: 0.6, work: 0.5, worship: 0.1 },
    workCaption: "collecting a better version",
    speaks: true,
    canon: "canon",
    lore: { tagline: "One word in every tale is wrong. Which?", layers: [{ key: "ossian.wrong", minMeetings: 1 }, { key: "ossian.three", minMeetings: 3 }, { key: "ossian.true", minMeetings: 5 }] },
    greetings: [
      "Have I told you this one? I have, but wrongly.",
      "Sit. Listen. Find the loose word.",
      "Everything I say is true, apart from the part that isn't.",
    ],
    intro: "Ossian Reed, the last honest liar. Listen for the loose word.",
  },
  {
    id: "ilsabet",
    name: "Ilsabet Marrow",
    home: "scale",
    roams: ["great-station", "deep-past"],
    homeShare: 0.65,
    job: "Cartographer: draws lanes, and one that ends at a seam.",
    life: "Unrolls charts that change as they open, flies survey lines between planets, and keeps a pencil lane beyond the seam.",
    voice: "Patient, ink-stained, dry; speaks as if each sentence were a line she might erase.",
    shipUrl: "/quaternius-executioner.glb",
    trail: "blue",
    faction: "ledger",
    faith: 0.0,
    susceptibility: 0.3,
    goals: ["Finish the lane that ends at the seam.", "Make peace with the Dissenter's copy."],
    routine: { work: 3, travel: 1.5, discuss: 1, rest: 0.8, wander: 0.6, trade: 0.3, worship: 0.1 },
    workCaption: "drawing a lane",
    speaks: true,
    canon: "canon",
    lore: { tagline: "A chart is a kindness that says how far.", layers: [{ key: "ilsabet.lane", minMeetings: 1 }, { key: "ilsabet.copy", minMeetings: 3 }, { key: "ilsabet.margin", minMeetings: 4 }] },
    greetings: [
      "Hold the corner. It will change.",
      "Pencil first. Always pencil first.",
      "Every lane is somewhere's edge.",
    ],
    intro: "Ilsabet Marrow, cartographer. Mind the corner, it changes.",
  },
  {
    id: "pell",
    name: "Pell",
    home: "great-station",
    roams: ["quiet-archive", "deep-past", "scale", "people", "growing-place"],
    homeShare: 0.2,
    job: "The Follower: always one day behind, leaving a coin, a ribbon, a note.",
    life: "Is wherever the world was yesterday; leaves small things for whoever comes next, and hopes they are found.",
    voice: "Light, shy, quick to apologise; seen mostly from behind; speaks as if arriving mid-sentence.",
    shipUrl: "/quaternius-striker.glb",
    trail: "purple",
    faction: null,
    faith: 0.2,
    susceptibility: 0.4,
    goals: ["Catch up, just once.", "Learn who hung the star she walks in."],
    routine: { travel: 3, wander: 2, rest: 0.6, discuss: 0.8, work: 0.3, worship: 0.1 },
    workCaption: "leaving a note",
    speaks: true,
    lagMs: 24 * 60 * 60 * 1000,
    canon: "canon",
    lore: { tagline: "Always one day behind. Always ahead of someone.", layers: [{ key: "pell.note", minMeetings: 1 }, { key: "pell.ribbon", minMeetings: 2 }, { key: "pell.light", minMeetings: 4 }] },
    greetings: [
      "Sorry. Was that yesterday?",
      "I left something for you. Did you find it?",
      "I am nearly with you.",
    ],
    intro: "Pell. I'm a day behind. It's all right. Mostly.",
  },
  {
    id: "wim",
    name: "Wim Ostler",
    home: "great-station",
    roams: ["scale"],
    homeShare: 0.8,
    job: "Junior clerk to the berth-log; keeps it tidy and tries to keep it true.",
    life: "Reconciles the berths each morning, pays a fee no one asked of him, and walks to Scale to count things that cannot be counted.",
    voice: "Earnest, neat, a little anxious; apologises for being exact.",
    shipUrl: "/quaternius-dispatcher.glb",
    trail: "blue",
    faction: "ledger",
    faith: 0.1,
    susceptibility: 0.35,
    goals: ["Make the berth-log balance, honestly.", "Never be thanked for the one thing he pays."],
    routine: { work: 3, rest: 1, discuss: 1, trade: 1, travel: 0.4, wander: 0.3, worship: 0.2 },
    workCaption: "reconciling the berth-log",
    speaks: true,
    canon: "canon",
    lore: { tagline: "He keeps a berth for someone who never came.", layers: [{ key: "wim.log", minMeetings: 1 }, { key: "wim.empty", minMeetings: 3 }, { key: "wim.pay", minMeetings: 5 }] },
    greetings: [
      "Oh! Sorry. Counting.",
      "Mind the log, it is wet.",
      "Every berth is paid. Truly.",
    ],
    intro: "Wim Ostler, junior clerk. Mind the log, it is wet.",
  },
] as const;

export const castMember = (id: string): CastMember | undefined => NPC_CAST.find((c) => c.id === id);

/** A stable small hash → [0, 1). Same on server and client, so everyone sees the same cast in the same place. */
function unitHash(seed: string): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export const NPC_SLOT_MS = 2 * 60 * 60 * 1000;

/**
 * Where a cast member is right now: pure and clock-driven (docs/specs/npc-society-2026-10-30.md). Per two-hour slot, home with their own share, else one of
 * the worlds they roam, chosen by a hash of (id, slot). Never a personal brain; a non-roamer is always home. No server state exists for this — it cannot drift.
 */
export function npcLocation(member: CastMember, nowMs: number): string {
  const away = member.roams.filter((w) => !NPC_NEVER_WORLDS.includes(w));
  if (away.length === 0) return member.home;
  const slot = Math.floor((nowMs - (member.lagMs ?? 0)) / NPC_SLOT_MS);
  if (unitHash(`${member.id}|${slot}|stay`) < member.homeShare) return member.home;
  return away[Math.floor(unitHash(`${member.id}|${slot}|where`) * away.length)]!;
}

/** The cast members who are in a world right now. A personal brain ("home") never has any. */
export function castIn(world: string | null | undefined, nowMs: number): CastMember[] {
  if (!world || NPC_NEVER_WORLDS.includes(world)) return [];
  return NPC_CAST.filter((c) => npcLocation(c, nowMs) === world);
}

/**
 * What each cast member needs said for the daily script. The two autonomous NPCs keep their specific situations (their places and voices differ); every other cast
 * member gets the generic three. `speaks`: first person, quoted. Adding a cast row adds its lines to the SAME single call.
 */
export function scriptSpecsFor(member: CastMember): readonly NpcSituationSpec[] {
  const speak = "First person, in the character's own voice, one short sentence (max 240 characters), as they cross paths with the visitor. Plain words, no emojis.";
  if (member.id === "harbor-controller") {
    return [
      { situation: "encounter_patrolling", count: 4, need: `${speak} The Harbor controller is out on patrol and sweeps past the visitor's ship. She may mention they can tap her tag to talk.` },
      { situation: "encounter_docked", count: 4, need: `${speak} The Harbor controller is moored at her berth as the visitor passes.` },
      { situation: "encounter_near", count: 3, need: `${speak} The Harbor controller is visiting another world (not her own Station) and meets the visitor there.` },
      { situation: "encounter_first", count: 3, need: `${speak} The visitor's very FIRST meeting with her: say who she is (who you ask about routes and arrivals).` },
      { situation: "chatter", count: 3, need: "One short first-person line the Harbor controller might be overheard saying to a companion about the lanes, the traffic or the day's ordinance. Never about the visitor." },
    ];
  }
  if (member.id === "eternity") {
    return [
      { situation: "encounter_arrival", count: 4, need: "One short sentence of atmosphere as the visitor arrives in Eternity's world: he is here, vast, still. Spoken in his own first-person voice or described; no questions, no commands." },
      { situation: "encounter_first", count: 3, need: "One short sentence for the visitor's very FIRST arrival: who Eternity is and that his gestures are how they answer him." },
      { situation: "wake", count: 4, need: "His own words (first person, 1-2 sentences, max 240 characters) waking the person gently for the day. May name ONE thing from their recent memories, truthfully." },
      { situation: "visitation", count: 3, need: "His own words (first person, 1-2 sentences, max 240 characters) telling the person he acted in his world today and turned toward their galaxy. May name ONE recent memory." },
    ];
  }
  return [
    { situation: "encounter_near", count: 4, need: `${speak} ${member.name} is in their own home world and meets the visitor there.` },
    { situation: "encounter_visiting", count: 3, need: `${speak} ${member.name} is far from home, visiting another world, and meets the visitor there.` },
    { situation: "encounter_first", count: 3, need: `${speak} The visitor's very FIRST meeting with ${member.name}: say who they are and what they do.` },
    { situation: "chatter", count: 3, need: `One short first-person line ${member.name} might be overheard saying to a companion on a day shaped by the brief's currents and their faction's calling — about their work, their faith or doubt, or what they want. Never about the visitor.` },
  ];
}

/** Kept for existing callers: the autonomous NPCs' situations, by id. */
export const NPC_SCRIPT_SPECS: Readonly<Record<string, readonly NpcSituationSpec[]>> = Object.fromEntries(
  NPC_CAST.map((c) => [c.id, scriptSpecsFor(c)]),
);

/** One brain's lines for one local day. `source: "fallback"` means no model produced it (offline lines only). */
export interface NpcDayScript {
  dayKey: string;
  source: "model" | "fallback";
  generatedAt: string;
  lines: Record<string, Partial<Record<NpcSituation, string[]>>>;
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
