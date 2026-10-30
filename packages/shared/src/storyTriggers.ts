/**
 * How a player comes to FIND things in the story (docs/lore/DRAFT_5_THE_WEB.md §2, DRAFT_4 §9/§10). Pure and shared: the server validates a find against this table (a client can never
 * report one that no trigger allows) and the web uses it to decide what an act of noticing turns up.
 *
 * Nothing is gated by the Hour: it only decides which thing a *regard* shows FIRST. Every sighting is reachable at any time of day (the Hours Clock is emphasis, never a lock).
 */

/** The seven Hours of the local day (the owner may re-time these). The eighth is the gap after a capture and has no band. */
export type HourBand = "first-light" | "measure" | "threshold" | "growing" | "hearths" | "rest" | "standing";

export function hourBand(d: Date): HourBand {
  const h = d.getHours();
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
 * Only entries whose words are written are released (a test enforces it). The rest of the canon is in the web and awaits its prose; adding a trigger here is how it goes live.
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
  // Listen: stay still and hear (echoes).
  { entryId: "echo.hymnal-gap", how: "listen", world: "quiet-archive", hour: "hearths" },
  { entryId: "echo.eighth-bell", how: "listen", world: "eternity", hour: "standing" },
  // Met people give things after they have met you enough (the client reports the meeting; the pairing is checked here).
  { entryId: "obj.doorkeepers-nail", how: "npc", world: "great-station", npc: "wayfarer", minMeetings: 1 },
  { entryId: "obj.choirmasters-breath", how: "npc", world: "quiet-archive", npc: "cantor", minMeetings: 2 },
  { entryId: "obj.dorrows-page", how: "npc", world: "great-station", npc: "broker", minMeetings: 2 },
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
