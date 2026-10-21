import { FLEET } from "./fleet.js";

/**
 * CL-1b (IM-19/20/21/24) — in-scene identity for the galaxy's living actors.
 *
 * The names and lore used here already exist in the app (visitors.ts variant
 * names, the FLEET roster in fleet.ts, the Aura-beacon lore in satellites.ts,
 * the Legend) — they were simply never attached to the objects a user is
 * actually looking at. These pure helpers shape that existing copy for the
 * shell overlays (GalaxyHud) so the shaping is unit-testable without WebGL.
 */

/** What Graph3D reports about the visitor / fleet craft currently followed. */
export type SceneIdentity =
  | { kind: "visitor"; variantName: string; targetId: number | null; targetLabel: string | null }
  | { kind: "fleet"; unitId: string; detail: string; targetLabel: string | null };

export interface IdentityCard {
  icon: string;
  title: string;
  /** Where it is / what it's doing right now (live, from the scene). */
  line: string;
  /** The standing lore line for this kind of craft. */
  lore: string;
}

/** The station's name — single source is the FLEET roster (fleet.ts). */
export const STATION_NAME = FLEET.find((u) => u.id === "station")?.name ?? "Waystation Soumaya-Prime";

/**
 * Visitor lore by variant name (visitors.ts: FRIENDLY / NEUTRAL / OMINOUS).
 * Copy is grounded in visitors.ts's own header (warm memories draw a luminous
 * traveler; heavy ones a darker wanderer) and satellites.ts's beacon lore
 * (drifters fear the beams — they scramble a wanderer's bearings).
 */
const VISITOR_LORE: Record<string, string> = {
  "Luminous Traveler": "Drawn to warm, bright memories. It loiters a while to bask, then drifts on.",
  Drifter: "A neutral passer-by, drawn to whichever memory looks most interesting right now.",
  "Void Wanderer":
    "Drawn to heavy memories. It keeps clear of the Aura beacons — their beams foul its bearings.",
};

export function visitorCard(variantName: string, targetLabel: string | null): IdentityCard {
  return {
    icon: "👽",
    title: variantName,
    line: targetLabel ? `Loitering near “${targetLabel}”` : "Drifting through your galaxy",
    lore: VISITOR_LORE[variantName] ?? "A drifter drawn to your most interesting memories.",
  };
}

/** The Escort has no FLEET roster row (it is Soumaya's personal wing, not a
 *  roster unit) — its identity comes from subAgents.ts's own description. */
const ESCORT = {
  name: "Escort",
  role: "Her personal wing",
  lore: "Flies formation on Soumaya's ship, under her direct command.",
};

export function fleetCard(unitId: string, detail: string, targetLabel: string | null): IdentityCard {
  const unit = FLEET.find((u) => u.id === unitId);
  const name = unit?.name ?? (unitId === "escort" ? ESCORT.name : unitId);
  const lore = unit?.lore ?? (unitId === "escort" ? ESCORT.lore : "");
  const role = unit?.role ?? (unitId === "escort" ? ESCORT.role : "");
  return {
    icon: unit?.icon ?? "🛸",
    title: role ? `${name} · ${role}` : name,
    line: detail || (targetLabel ? `Attending “${targetLabel}”` : "On patrol"),
    lore,
  };
}

/** Structural minimum of Graph3D's FleetStatus beacon entry. */
export interface BeaconStatusLike {
  active: boolean;
  detail: string;
  targets?: { id: number; label: string }[];
  pending?: number;
}

export interface BeaconReadoutData {
  detail: string;
  targets: { id: number; label: string }[];
  pending: number;
}

/**
 * IM-20 — the beacon readout for the shell: non-null only when a beacon is
 * actually deployed (or dispatching), so the beam's meaning is readable where
 * the beam is seen instead of only inside the Fleet panel.
 */
export function beaconReadout(
  status: Record<string, BeaconStatusLike> | null | undefined,
): BeaconReadoutData | null {
  const beacon = status?.beacon;
  if (!beacon) return null;
  const targets = beacon.targets ?? [];
  const pending = beacon.pending ?? 0;
  if (!beacon.active && targets.length === 0 && pending === 0) return null;
  return { detail: beacon.detail, targets, pending };
}

/** IM-21 — one-line audio state for the shell (sounds = SFX + ship engine,
 *  which share the sfx gate in engineAudio.ts). */
export function audioSummary(s: { sfx: boolean; voice: boolean; music: boolean }): {
  text: string;
  allOff: boolean;
} {
  const parts = [
    `Sounds ${s.sfx ? "on" : "off"}`,
    `Voice ${s.voice ? "on" : "off"}`,
    `Music ${s.music ? "on" : "off"}`,
  ];
  return { text: parts.join(" · "), allOff: !s.sfx && !s.voice && !s.music };
}

/** Human label for a Thought.source — the same wording the Legend uses for
 *  MindSpace mote colours (IM-25's legend must agree with it). */
export function thoughtSourceLabel(source: string): string {
  switch (source) {
    case "manual":
      return "Spontaneous";
    case "chat":
      return "From chat";
    case "goal":
      return "Goal pull";
    case "priority":
      return "Urgent drive";
    case "emotion":
      return "Feeling";
    default:
      return source;
  }
}

/** IM-24 — the user-visible line for a glTF model that failed to load and was
 *  swapped for its procedural stand-in (shown in Settings → diagnostics). */
export function modelFallbackLine(asset: string): string {
  return `${asset} couldn't load — showing the built-in stand-in instead.`;
}
