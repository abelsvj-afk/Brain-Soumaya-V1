/**
 * How a player comes to FIND things in the story (docs/lore/DRAFT_5_THE_WEB.md §2, DRAFT_4 §9/§10). Pure and shared: the server validates a find against this table (a client can never
 * report one that no trigger allows) and the web uses it to decide what an act of noticing turns up.
 *
 * Nothing is gated by the Hour: it only decides which thing a *regard* shows FIRST. Every sighting is reachable at any time of day (the Hours Clock is emphasis, never a lock).
 */

/** The seven Hours of the local day (the owner may re-time these). The eighth is the gap after a capture and has no band. */
export type HourBand = "first-light" | "measure" | "threshold" | "growing" | "hearths" | "rest" | "standing";

export function hourBand(d: Date): HourBand {
  return hourBandOfHour(d.getHours());
}

export function hourBandOfHour(h: number): HourBand {
  if (h >= 5 && h < 9) return "first-light";
  if (h >= 9 && h < 12) return "measure";
  if (h >= 12 && h < 15) return "threshold";
  if (h >= 15 && h < 18) return "growing";
  if (h >= 18 && h < 22) return "hearths";
  if (h >= 22 || h < 2) return "rest";
  return "standing";
}

export type TriggerHow = "relic" | "regard" | "listen" | "npc" | "companion";

export interface StoryTrigger {
  entryId: string;
  how: TriggerHow;
  /** Where the ship must be (a travel-ledger world id). */
  world: string;
  /** The Hour this is shown first in (emphasis only). */
  hour?: HourBand;
  /** For `npc`: the cast member, and how many meetings in before they give it. */
  npc?: string;
  minMeetings?: number;
}

const relic = (id: string, world: string): StoryTrigger => ({ entryId: `relic.${id}`, how: "relic", world });

/**
 * Every entry in the canon is now released by some trigger (a test enforces it, and that each has words). A new entry needs its words AND a trigger before it exists for a player.
 */
export const STORY_TRIGGERS: readonly StoryTrigger[] = [
  // The fifteen witnesses' kept things — found where the shipped relic system already hides them (the client mirrors its discovery here).
  relic("harbor-nail", "great-station"),
  relic("mooring-ring", "great-station"),
  relic("dawn-leaf", "growing-place"),
  relic("witness-seed", "growing-place"),
  relic("first-light-shard", "deep-past"),
  relic("basin-stone", "deep-past"),
  relic("lantern-of-keeping", "deep-past"),
  relic("witness-without-a-name", "deep-past"),
  relic("hearth-ember", "people"),
  relic("thread-of-many", "people"),
  relic("star-hanger", "scale"),
  relic("sunward-compass", "scale"),
  relic("stillness-seal", "quiet-archive"),
  relic("unopened-fold", "quiet-archive"),
  relic("unnumbered-fragment", "scale"),
  // Regard: stay still where something is wrong (the world's one "wrong thing", Draft 3 §3 — and the Hours Clock's sightings).
  { entryId: "sight.second-seam", how: "regard", world: "great-station", hour: "threshold" },
  { entryId: "sight.missing-berth", how: "regard", world: "great-station", hour: "rest" },
  { entryId: "obj.faded-ticket", how: "regard", world: "great-station", hour: "hearths" },
  { entryId: "sight.missing-stratum", how: "regard", world: "deep-past", hour: "first-light" },
  { entryId: "sight.dead-bough", how: "regard", world: "growing-place", hour: "growing" },
  { entryId: "sight.hung-star", how: "regard", world: "scale", hour: "measure" },
  { entryId: "sight.open-alcove", how: "regard", world: "quiet-archive", hour: "rest" },
  { entryId: "sight.empty-chair", how: "regard", world: "people", hour: "hearths" },
  { entryId: "sight.unlooked-direction", how: "regard", world: "eternity", hour: "standing" },
  { entryId: "sight.locked-room", how: "regard", world: "great-station", hour: "first-light" },
  { entryId: "sight.lane-to-nowhere", how: "regard", world: "great-station", hour: "measure" },
  { entryId: "sight.blank-nameplate", how: "regard", world: "great-station", hour: "growing" },
  { entryId: "sight.tamsins-ward", how: "regard", world: "people", hour: "first-light" },
  { entryId: "obj.follower-ribbon", how: "regard", world: "deep-past", hour: "threshold" },
  { entryId: "sight.lullaby-hollow", how: "regard", world: "quiet-archive", hour: "first-light" },
  { entryId: "sight.ysmerel-at-the-edge", how: "regard", world: "quiet-archive", hour: "standing" },
  { entryId: "sight.long-room", how: "regard", world: "eternity", hour: "rest" },
  { entryId: "obj.kiths-drawing", how: "regard", world: "people", hour: "growing" },
  { entryId: "obj.sleepwalkers-lantern", how: "regard", world: "great-station", hour: "hearths" },
  { entryId: "obj.tin-soldier", how: "regard", world: "great-station", hour: "rest" },
  { entryId: "obj.vesh-paper-boat", how: "regard", world: "quiet-archive", hour: "rest" },
  { entryId: "obj.measurers-cord", how: "regard", world: "scale", hour: "measure" },
  // Listen: stay still and hear (echoes).
  { entryId: "echo.hymnal-gap", how: "listen", world: "quiet-archive", hour: "hearths" },
  { entryId: "echo.eighth-bell", how: "listen", world: "eternity", hour: "standing" },
  // Met people give things after they have met you enough (the client reports the meeting; the pairing is checked here).
  { entryId: "obj.doorkeepers-nail", how: "npc", world: "great-station", npc: "wayfarer", minMeetings: 3 },
  { entryId: "obj.choirmasters-breath", how: "npc", world: "quiet-archive", npc: "cantor", minMeetings: 4 },
  { entryId: "obj.dorrows-page", how: "npc", world: "great-station", npc: "broker", minMeetings: 4 },
  { entryId: "obj.anonymous-payments", how: "npc", world: "great-station", npc: "broker", minMeetings: 6 },
  { entryId: "obj.dissenters-chart", how: "npc", world: "great-station", npc: "dissenter", minMeetings: 4 },
  // The stranger at the dock: once, on a harbor, on a later day than the first.
  { entryId: "companion.dock-1", how: "companion", world: "great-station" },
];

export function triggerFor(entryId: string, how: TriggerHow, npc?: string): StoryTrigger | undefined {
  return STORY_TRIGGERS.find((t) => t.entryId === entryId && t.how === how && (how !== "npc" || t.npc === npc));
}

/**
 * What an act of noticing turns up: the next thing in this world not yet found, the one belonging to the current Hour first, otherwise in table order.
 * Null when there is nothing left to notice here (the world is simply as it was).
 */
export function pickNoticed(world: string, how: "regard" | "listen", hour: HourBand, found: ReadonlySet<string>): string | null {
  const pool = STORY_TRIGGERS.filter((t) => t.how === how && t.world === world && !found.has(t.entryId));
  const now = pool.find((t) => t.hour === hour);
  return (now ?? pool[0])?.entryId ?? null;
}

/** Entries a met person is ready to give, given how often you have met. */
export function npcGifts(npc: string, meetings: number, found: ReadonlySet<string>): string[] {
  return STORY_TRIGGERS.filter((t) => t.how === "npc" && t.npc === npc && (t.minMeetings ?? 1) <= meetings && !found.has(t.entryId)).map((t) => t.entryId);
}

function hash01(str: string): number {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return (x >>> 0) / 4294967295;
}

/** Outside its own Hour a sighting still answers — but only on about one day in three, chosen by a seed (brain + entry + day) so spamming stillness cannot re-roll it. */
export const OUT_OF_HOUR_CHANCE = 1 / 3;

/**
 * Does the world answer THIS stillness, for this entry, now? In its own Hour: yes. Otherwise only on its good days. Deterministic, so server and client agree and a
 * second try the same day gives the same answer. Never a lock: every sighting has good days, and nothing here depends on any other entry.
 */
export function worldAnswers(t: Pick<StoryTrigger, "entryId" | "hour">, localHour: number, brainId: string, dayKey: string): boolean {
  if (!t.hour) return true;
  if (hourBandOfHour(localHour) === t.hour) return true;
  return hash01(`${brainId}|${t.entryId}|${dayKey}|answers`) < OUT_OF_HOUR_CHANCE;
}
