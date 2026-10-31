import { WORLD_CHART } from "../lib/routeBoard.js";
/**
 * One line per world saying what it is for and one thing to do (audit X4, docs/AUDIT_SPEED_UI_UX_2026-10-29.md): the worlds
 * taught nothing about themselves. Shown once per world, on the first arrival, in the slot the look-around hint uses.
 */
export const WORLD_PURPOSE: Readonly<Record<string, string>> = {
  "great-station": "The Great Station is your harbor. Fly to its places, or step inside to see your fleet and your board.",
  "growing-place": "The Growing Place grows your Journeys as groves. Tap the ground to walk, and tap a grove to tend its missions.",
  "deep-past": "The Deep Past holds your older memories, the oldest at the bottom. Use Descend to walk down through time.",
  people: "The People world shows the people in your life as warm lights. Tap one to see what you share.",
  "quiet-archive": "Quiet is where memories you set aside rest. Nothing here asks anything of you.",
  "the-long-morning": "The Long Morning is a world of warm light with no horizon. Stand in the ring and be still; the light leans toward you.",
  "the-yard": "The Unlit Hulls is a vast, dim shipyard. Walk the slips and the desk; nothing here asks for a name.",
  "the-siege": "The Siege of the First Light is a broad pale field. Wander its ranks and its table; nothing here asks you to say who was right.",
  "the-unmade-hour": "The Unmade Hour is a wide, pale floor that keeps no marks of you. Stand where the steps stop; nothing here needs an answer.",
  "the-village": "The Village is a small hillside place at night, every window lit. Walk it slowly; nothing here asks you to decide.",
  "road-to-the-seam": "The Road to the Seam is a long way under the Station. Walk it as far as you like; it goes on, and nothing here is in a hurry.",
  "faded-ward": "The Faded Ward is a long hall of resting people. Walk it slowly; nothing here asks anything of you.",
  scale: "Scale puts real objects at true size beside your ship. Fly to one to feel how big it is.",
  eternity: "This is Eternity's world. Use his gestures and tools, and he may answer in his own time.",
};

export const purposeSeenKey = (world: string): string => `worlds.purposeSeen.${world}`;

export function worldPurpose(world: string | undefined): string | null {
  return (world && WORLD_PURPOSE[world]) || null;
}

/** A world's display name ("The Growing Place"); the key itself for one the chart doesn't know. */
export function placeName(world: string): string {
  return WORLD_CHART.find((w) => w.key === world)?.name ?? world;
}
