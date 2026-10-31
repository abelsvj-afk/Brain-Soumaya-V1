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

/**
 * Where a regard/listen answers (docs/specs/lore-physical-spots-2026-10-31.md): at a PLACE in the scene (one of the world's own named holders, `PLACE_RULES`), or — in the garden —
 * round the witness tree at the origin. Hidden: there is no marker and the Fly-to tiles never list a spot.
 */
export interface StorySpot {
  /** Regex SOURCE of a `PLACE_RULES[world]` pattern (web/graph/worldPlaces.ts). Omit for an origin spot. */
  place?: string;
  /** Shift the point inside the place, in units of its radius (e.g. [0,-0.85,0] = its lower rim). */
  at?: readonly [number, number, number];
  /** Reach: this many place-radii (or, for an origin spot, this many units). */
  near: number;
  /** Never tighter than this many units. */
  min?: number;
  /** Anchored at the world origin (the garden's witness tree) instead of a named place. */
  origin?: boolean;
  /** Eternity (no flying ship): where the viewer's CAMERA is, round him. All given limits must hold. */
  view?: EternityView;
}

/** Camera limits round Eternity's figure (units from him; `behind` = on the far side from where visitors arrive, +z). */
export interface EternityView {
  nearerThan?: number;
  fartherThan?: number;
  behind?: boolean;
}

/** Eternity's figure stands here; the camera orbits it. */
export const ETERNITY_PIVOT: readonly [number, number, number] = [0, 70, 0];

/** Is a camera at `cam` inside the view limits? Pure. */
export function viewReach(view: EternityView, cam: readonly [number, number, number]): boolean {
  const d = Math.hypot(cam[0] - ETERNITY_PIVOT[0], cam[1] - ETERNITY_PIVOT[1], cam[2] - ETERNITY_PIVOT[2]);
  if (view.nearerThan !== undefined && d >= view.nearerThan) return false;
  if (view.fartherThan !== undefined && d <= view.fartherThan) return false;
  if (view.behind && cam[2] > -0.3 * d) return false;
  return true;
}

export interface StoryTrigger {
  entryId: string;
  how: TriggerHow;
  /** Where the ship must be (a travel-ledger world id). */
  world: string;
  /** The Hour this is shown first in (emphasis only). */
  hour?: HourBand;
  /** For regard/listen in a world the viewer can move through: where it answers. Absent = the whole world (Eternity, until it has a travel model). */
  spot?: StorySpot;
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
  { entryId: "sight.second-seam", how: "regard", world: "great-station", hour: "threshold", spot: { place: "^station-rotating$", at: [0, -0.85, 0], near: 0.45 } },
  { entryId: "sight.missing-berth", how: "regard", world: "great-station", hour: "rest", spot: { place: "^witness-drydock-gantry$", near: 1.4 } },
  { entryId: "obj.faded-ticket", how: "regard", world: "great-station", hour: "hearths", spot: { place: "^annex-(?!model)", near: 1.6 } },
  // The rim anchor follows the Deep Past rework (2026-10-30): the rim is a generated place now
  // (scene object "place-rim", PLACE_RULES deep-past), not the removed rim GLB ("glb-rim").
  { entryId: "sight.missing-stratum", how: "regard", world: "deep-past", hour: "first-light", spot: { place: "^place-rim$", at: [0, -0.6, 0], near: 0.7 } },
  { entryId: "sight.dead-bough", how: "regard", world: "growing-place", hour: "growing", spot: { origin: true, near: 160 } },
  { entryId: "sight.hung-star", how: "regard", world: "scale", hour: "measure", spot: { place: "^planet-(?!model)", near: 2.4 } },
  { entryId: "sight.open-alcove", how: "regard", world: "quiet-archive", hour: "rest", spot: { place: "^still-threshold$", near: 1.5 } },
  { entryId: "sight.empty-chair", how: "regard", world: "people", hour: "hearths", spot: { place: "^field-ground$", near: 0.35 } },
  { entryId: "sight.unlooked-direction", how: "regard", world: "eternity", hour: "standing", spot: { near: 0, view: { behind: true } } },
  { entryId: "sight.locked-room", how: "regard", world: "great-station", hour: "first-light", spot: { place: "^annex-(?!model)", at: [0, 0, 0.6], near: 1.1 } },
  { entryId: "sight.lane-to-nowhere", how: "regard", world: "great-station", hour: "measure", spot: { place: "^station-rotating$", at: [-0.9, 0.2, 0.3], near: 0.4 } },
  { entryId: "sight.blank-nameplate", how: "regard", world: "great-station", hour: "growing", spot: { place: "^witness-drydock-gantry$", at: [0, 0.6, 0], near: 1.0 } },
  { entryId: "sight.tamsins-ward", how: "regard", world: "people", hour: "first-light", spot: { place: "^field-ground$", at: [0.8, 0, 0], near: 0.3 } },
  // Same re-anchor: the stair is a generated mesh now (scene object "stair"), not the removed stair GLB.
  { entryId: "obj.follower-ribbon", how: "regard", world: "deep-past", hour: "threshold", spot: { place: "^stair$", near: 0.45 } },
  { entryId: "sight.lullaby-hollow", how: "regard", world: "quiet-archive", hour: "first-light", spot: { place: "^field-ground$", at: [0, 0, -0.6], near: 0.3 } },
  { entryId: "sight.ysmerel-at-the-edge", how: "regard", world: "quiet-archive", hour: "standing", spot: { place: "^field-ground$", at: [-0.9, 0, 0], near: 0.3 } },
  { entryId: "sight.long-room", how: "regard", world: "eternity", hour: "rest", spot: { near: 0, view: { fartherThan: 1100 } } },
  { entryId: "obj.kiths-drawing", how: "regard", world: "people", hour: "growing", spot: { place: "^field-ground$", at: [-0.5, 0, 0.5], near: 0.25 } },
  { entryId: "obj.sleepwalkers-lantern", how: "regard", world: "great-station", hour: "hearths", spot: { place: "^station-rotating$", at: [0.9, 0, 0], near: 0.4 } },
  { entryId: "obj.tin-soldier", how: "regard", world: "great-station", hour: "rest", spot: { place: "^witness-drydock-gantry$", at: [0, -0.5, 0], near: 1.0 } },
  { entryId: "obj.vesh-paper-boat", how: "regard", world: "quiet-archive", hour: "rest", spot: { place: "^still-threshold$", at: [0, 0, 0.7], near: 1.0 } },
  { entryId: "obj.measurers-cord", how: "regard", world: "scale", hour: "measure", spot: { place: "^iss-holder$", near: 1.8 } },
  // Draft 7 (the Station knot)
  { entryId: "sight.ruels-laugh", how: "regard", world: "people", hour: "rest", spot: { place: "^field-ground$", at: [0.7, 0, 0.4], near: 0.3 } },
  { entryId: "sight.aldous-at-rest", how: "regard", world: "quiet-archive", hour: "first-light", spot: { place: "^still-threshold$", at: [0.5, 0, 0.2], near: 0.8 } },
  { entryId: "sight.ysmerels-hum", how: "listen", world: "quiet-archive", hour: "standing", spot: { place: "^field-ground$", at: [-0.9, 0, 0], near: 0.3 } },
  { entryId: "obj.blank-line", how: "regard", world: "great-station", hour: "standing", spot: { place: "^annex-(?!model)", at: [-0.9, 0, 0], near: 1.1 } },
  { entryId: "sight.marens-winter", how: "regard", world: "growing-place", hour: "rest", spot: { origin: true, near: 90 } },
  { entryId: "obj.orus-bead", how: "regard", world: "deep-past", hour: "first-light", spot: { place: "^glb-basin$", near: 1.2 } },
  { entryId: "account.tall-tale", how: "regard", world: "people", hour: "hearths", spot: { place: "^field-ground$", at: [-0.2, 0, -0.6], near: 0.25 } },
  { entryId: "obj.sleepwalkers-cup", how: "regard", world: "great-station", hour: "first-light", spot: { place: "^witness-drydock-gantry$", near: 1.6 } },
  // The Faded Ward (S-VII): every one answers only where she is parked in the hall; Tamsin and Hesk give two after enough meetings there.
  { entryId: "sight.ward-door", how: "regard", world: "faded-ward", hour: "first-light", spot: { place: "^ward-door$", near: 1.4 } },
  { entryId: "sight.ward-long-hall", how: "regard", world: "faded-ward", hour: "standing", spot: { place: "^ward-cot-linnet$", near: 5 } },
  { entryId: "sight.ward-lanterns", how: "regard", world: "faded-ward", hour: "hearths", spot: { place: "^ward-window$", near: 1.6 } },
  { entryId: "obj.ward-bowl", how: "regard", world: "faded-ward", hour: "rest", spot: { place: "^ward-bowl$", near: 2.2 } },
  { entryId: "obj.ward-soldier", how: "regard", world: "faded-ward", hour: "first-light", spot: { place: "^ward-small-bed$", near: 3 } },
  { entryId: "sight.ward-window", how: "regard", world: "faded-ward", hour: "standing", spot: { place: "^ward-window$", near: 1.1 } },
  { entryId: "sight.ward-blank-cot", how: "regard", world: "faded-ward", hour: "rest", spot: { place: "^ward-hook$", near: 2.2 } },
  { entryId: "echo.ward-hum", how: "listen", world: "faded-ward", hour: "rest", spot: { place: "^ward-cot-ruel$", near: 3 } },
  { entryId: "echo.ward-far-breath", how: "listen", world: "faded-ward", hour: "standing", spot: { place: "^ward-far$", near: 2.4 } },
  { entryId: "obj.ward-button", how: "npc", world: "faded-ward", npc: "tamsin", minMeetings: 4 },
  { entryId: "echo.ward-count", how: "npc", world: "faded-ward", npc: "tamsin", minMeetings: 6 },
  { entryId: "obj.ward-wake", how: "npc", world: "faded-ward", npc: "hesk", minMeetings: 5 },
  // The Road to the Seam (S-III): answers only where she is parked on the road; the Wayfarer leaves one thing after enough meetings.
  { entryId: "sight.road-mouth", how: "regard", world: "road-to-the-seam", hour: "first-light", spot: { place: "^road-mouth$", near: 1.4 } },
  { entryId: "sight.road-lamps", how: "regard", world: "road-to-the-seam", hour: "hearths", spot: { place: "^road-lamps$", near: 1.2 } },
  { entryId: "obj.road-nails", how: "regard", world: "road-to-the-seam", hour: "measure", spot: { place: "^road-nails$", near: 1.6 } },
  { entryId: "sight.road-chalk", how: "regard", world: "road-to-the-seam", hour: "growing", spot: { place: "^road-chalk$", near: 1.6 } },
  { entryId: "obj.road-doorframe", how: "regard", world: "road-to-the-seam", hour: "threshold", spot: { place: "^road-doorframe$", near: 2.2 } },
  { entryId: "sight.road-post", how: "regard", world: "road-to-the-seam", hour: "standing", spot: { place: "^road-post$", near: 2.4 } },
  { entryId: "sight.road-chalk-end", how: "regard", world: "road-to-the-seam", hour: "rest", spot: { place: "^road-chalk-end$", near: 3 } },
  { entryId: "echo.road-steps", how: "listen", world: "road-to-the-seam", hour: "standing", spot: { place: "^road-far$", near: 3 } },
  { entryId: "sight.road-far", how: "regard", world: "road-to-the-seam", hour: "first-light", spot: { place: "^road-far$", near: 2.4 } },
  { entryId: "obj.road-oil", how: "npc", world: "road-to-the-seam", npc: "wayfarer", minMeetings: 5 },
  // The Siege of the First Light (S-IV): answers only where she is parked on the field; the Dissenter gives one cup after enough meetings.
  { entryId: "sight.siege-edges", how: "regard", world: "the-siege", hour: "first-light", spot: { place: "^siege-edges$", near: 0.7 } },
  { entryId: "sight.siege-smile", how: "regard", world: "the-siege", hour: "measure", spot: { place: "^siege-smile$", near: 2.6 } },
  { entryId: "obj.siege-cups", how: "regard", world: "the-siege", hour: "growing", spot: { place: "^siege-line$", near: 1.2 } },
  { entryId: "sight.siege-first-light", how: "regard", world: "the-siege", hour: "standing", spot: { place: "^siege-first-light$", near: 3 } },
  { entryId: "sight.siege-small", how: "regard", world: "the-siege", hour: "hearths", spot: { place: "^siege-small$", near: 2.2 } },
  { entryId: "sight.siege-vast", how: "regard", world: "the-siege", hour: "threshold", spot: { place: "^siege-vast$", near: 0.7 } },
  { entryId: "sight.siege-blur", how: "regard", world: "the-siege", hour: "rest", spot: { place: "^siege-blur$", near: 2 } },
  { entryId: "obj.siege-cord", how: "regard", world: "the-siege", hour: "measure", spot: { place: "^siege-cord$", near: 2.4 } },
  { entryId: "echo.siege-breath", how: "listen", world: "the-siege", hour: "standing", spot: { place: "^siege-edges$", near: 1.4 } },
  { entryId: "obj.siege-empty-cup", how: "npc", world: "the-siege", npc: "dissenter", minMeetings: 5 },
  // The Unmade Hour (S-I): answers only where she is parked on the floor; the Archivist gives one leaf after enough meetings.
  { entryId: "sight.unmade-hollows", how: "regard", world: "the-unmade-hour", hour: "first-light", spot: { place: "^unmade-hollows$", near: 0.8 } },
  { entryId: "sight.unmade-ring", how: "regard", world: "the-unmade-hour", hour: "measure", spot: { place: "^unmade-ring$", near: 1.3 } },
  { entryId: "sight.unmade-standing", how: "regard", world: "the-unmade-hour", hour: "rest", spot: { place: "^unmade-standing$", near: 3 } },
  { entryId: "obj.unmade-hands", how: "regard", world: "the-unmade-hour", hour: "standing", spot: { place: "^unmade-hands$", near: 1.4 } },
  { entryId: "sight.unmade-frame", how: "regard", world: "the-unmade-hour", hour: "threshold", spot: { place: "^unmade-frame$", near: 2.2 } },
  { entryId: "obj.unmade-tally", how: "regard", world: "the-unmade-hour", hour: "hearths", spot: { place: "^unmade-tally$", near: 1.6 } },
  { entryId: "sight.unmade-seam", how: "regard", world: "the-unmade-hour", hour: "growing", spot: { place: "^unmade-seam$", near: 1.2 } },
  { entryId: "echo.unmade-note", how: "listen", world: "the-unmade-hour", hour: "standing", spot: { place: "^unmade-note$", near: 2.4 } },
  { entryId: "sight.unmade-no-mark", how: "listen", world: "the-unmade-hour", hour: "rest", spot: { place: "^unmade-hollows$", near: 1.6 } },
  { entryId: "obj.unmade-blank-leaf", how: "npc", world: "the-unmade-hour", npc: "archivist", minMeetings: 5 },
  // The Village (S-V): answers only where she is parked in the village; the Keeper gives one thread-end after enough meetings.
  { entryId: "sight.village-gate", how: "regard", world: "the-village", hour: "first-light", spot: { place: "^village-gate$", near: 1.4 } },
  { entryId: "sight.village-windows", how: "regard", world: "the-village", hour: "hearths", spot: { place: "^village-windows$", near: 0.8 } },
  { entryId: "obj.village-well", how: "regard", world: "the-village", hour: "measure", spot: { place: "^village-well$", near: 2.2 } },
  { entryId: "sight.village-chair", how: "regard", world: "the-village", hour: "rest", spot: { place: "^village-chair$", near: 3 } },
  { entryId: "sight.village-hearth", how: "regard", world: "the-village", hour: "hearths", spot: { place: "^village-hearth$", near: 2.4 } },
  { entryId: "obj.village-hooks", how: "regard", world: "the-village", hour: "growing", spot: { place: "^village-hooks$", near: 0.7 } },
  { entryId: "sight.village-door", how: "regard", world: "the-village", hour: "standing", spot: { place: "^village-door$", near: 1.8 } },
  { entryId: "obj.village-bread", how: "regard", world: "the-village", hour: "first-light", spot: { place: "^village-bread$", near: 3 } },
  { entryId: "echo.village-count", how: "listen", world: "the-village", hour: "rest", spot: { place: "^village-gate$", near: 2.4 } },
  { entryId: "obj.village-thread-end", how: "npc", world: "the-village", npc: "keeper", minMeetings: 5 },
  { entryId: "sight.gatepost-lamp", how: "regard", world: "great-station", hour: "hearths", spot: { place: "^annex-(?!model)", at: [0.9, 0, 0], near: 1.1 } },
  { entryId: "obj.linnets-coat", how: "regard", world: "great-station", hour: "rest", spot: { place: "^annex-(?!model)", at: [0, 0.5, -0.4], near: 0.9 } },
  // Listen: stay still and hear (echoes).
  { entryId: "echo.hymnal-gap", how: "listen", world: "quiet-archive", hour: "hearths", spot: { place: "^still-threshold$", at: [0, 0, -0.5], near: 1.2 } },
  { entryId: "echo.eighth-bell", how: "listen", world: "eternity", hour: "standing", spot: { near: 0, view: { nearerThan: 330 } } },
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
export function pickNoticed(world: string, how: "regard" | "listen", hour: HourBand, found: ReadonlySet<string>, reaches?: (t: StoryTrigger) => boolean): string | null {
  const pool = STORY_TRIGGERS.filter((t) => t.how === how && t.world === world && !found.has(t.entryId) && (!reaches || !t.spot || reaches(t)));
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

/** Outside its own Hour a sighting still answers — but only on about one day in two, chosen by a seed (brain + entry + day) so spamming stillness cannot re-roll it. (Was one in three; loosened 2026-10-31, docs/specs/living-worlds-dialogue-2026-10-31.md.) */
export const OUT_OF_HOUR_CHANCE = 1 / 2;

/**
 * Does the world answer THIS stillness, for this entry, now? In its own Hour: yes. Otherwise only on its good days. Deterministic, so server and client agree and a
 * second try the same day gives the same answer. Never a lock: every sighting has good days, and nothing here depends on any other entry.
 */
export function worldAnswers(t: Pick<StoryTrigger, "entryId" | "hour">, localHour: number, brainId: string, dayKey: string, firstHere = false): boolean {
  // The very first stillness a brain keeps in a world is always answered: a first taste, so the slowness that follows is never a silent wall.
  if (firstHere) return true;
  if (!t.hour) return true;
  if (hourBandOfHour(localHour) === t.hour) return true;
  return hash01(`${brainId}|${t.entryId}|${dayKey}|answers`) < OUT_OF_HOUR_CHANCE;
}

/**
 * Is a viewer at `v` within reach of the spot, given the located landmark? Pure. For an origin spot pass center [0,0,0] and radius 1 (near is then in units).
 */
export function spotReach(spot: StorySpot, center: readonly [number, number, number], radius: number, viewer: readonly [number, number, number]): boolean {
  const at = spot.at ?? [0, 0, 0];
  const px = center[0] + at[0] * radius;
  const py = center[1] + at[1] * radius;
  const pz = center[2] + at[2] * radius;
  const reach = Math.max(spot.near * radius, spot.min ?? (spot.origin ? 0 : 60));
  return Math.hypot(viewer[0] - px, viewer[1] - py, viewer[2] - pz) <= reach;
}

/** Entries the viewer can currently be at the spot for — those with no spot (Eternity) are always eligible. */
export function eligibleHere(world: string, how: "regard" | "listen", reaches: (t: StoryTrigger) => boolean): StoryTrigger[] {
  return STORY_TRIGGERS.filter((t) => t.how === how && t.world === world && (!t.spot || reaches(t)));
}
