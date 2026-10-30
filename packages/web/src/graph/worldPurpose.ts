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
