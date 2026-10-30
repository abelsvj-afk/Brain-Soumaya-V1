/**
 * NPC presence (docs/specs/npcs-alive-2026-10-30.md): where an NPC is, whether you are near, and who you have met.
 * Pure (no three.js, no DOM except the small localStorage store, which swallows a blocked storage) so it is unit-tested.
 * This is PRESENTATION — a ship's idle patrol and ambient description. It adds no act, no speech and no server state, so the
 * NPC fence (shared/npcs.ts) is untouched: the harbor controller still only answers, Eternity alone initiates.
 */

import type { NpcDayScript, NpcSituation } from "@brain/shared";

export type NpcKey = "harbor-controller" | "eternity";

export interface NpcPresence {
  id: NpcKey;
  /** The world they live in — they never appear anywhere else (the fence). */
  world: string;
  name: string;
  /** Icon name (components/icons) or an emoji. */
  icon: string;
  /** What they are for, in plain words (the Who's-here tile + first meeting). */
  role: string;
  /** A name on the scene object this presence follows, when it has a body the host can find. */
  objectName?: string;
}

export const NPC_PRESENCES: readonly NpcPresence[] = [
  {
    id: "harbor-controller",
    world: "great-station",
    name: "Harbor controller",
    icon: "i:harbor",
    role: "she is who you ask about routes and arrivals",
    objectName: "harbor-controller-ship",
  },
  {
    id: "eternity",
    world: "eternity",
    name: "Eternity",
    icon: "i:stillness",
    role: "he blesses and comforts, rarely, in his own time — answer him with his gestures",
  },
];

export const npcsIn = (world: string | null | undefined): NpcPresence[] => NPC_PRESENCES.filter((n) => n.world === world);

// --- Patrol: docked → leave → one lap → return, on a wall-clock cycle ---

export const PATROL_PERIOD_MS = 5 * 60_000;
/** Cycle fractions: docked, leaving, lap, returning (sum 1). */
const DOCKED = 0.3;
const LEAVING = 0.06;
const RETURNING = 0.06;
const LAP_END = 1 - RETURNING;

export interface PatrolBerth {
  radius: number;
  angle: number;
  y: number;
}
export type PatrolPhase = "docked" | "leaving" | "patrolling" | "returning";

export interface PatrolPose {
  phase: PatrolPhase;
  /** Station-local position (the controller's mesh is a child of the Station's rotating frame). */
  pos: [number, number, number];
  /** Rotation about Y so the ship's −Z nose points along its heading (same convention as mooringPose). */
  rotationY: number;
}

export const PATROL_RADIUS = 330;
export const PATROL_LIFT = 38;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function polar(radius: number, angle: number, y: number): [number, number, number] {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

/** Heading about Y with the nose (−Z) along the direction of travel (dx, dz). */
const noseYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export function patrolAt(nowMs: number, berth: PatrolBerth, opts: { reducedMotion?: boolean } = {}): PatrolPose {
  const berthPose = (): PatrolPose => ({
    phase: "docked",
    pos: polar(berth.radius, berth.angle, berth.y),
    rotationY: noseYaw(Math.cos(berth.angle), Math.sin(berth.angle)),
  });
  if (opts.reducedMotion) return berthPose();
  const f = (((nowMs % PATROL_PERIOD_MS) + PATROL_PERIOD_MS) % PATROL_PERIOD_MS) / PATROL_PERIOD_MS;
  if (f < DOCKED) return berthPose();
  // The path is a function of one parameter so every phase boundary is continuous: lap angle runs from the berth angle round one full turn.
  const at = (u: number, lift: number, out: number): [number, number, number] => {
    const a = berth.angle + u * Math.PI * 2;
    return polar(berth.radius + (PATROL_RADIUS - berth.radius) * out, a, berth.y + PATROL_LIFT * lift);
  };
  let u: number;
  let lift: number;
  let out: number;
  let phase: PatrolPhase;
  if (f < DOCKED + LEAVING) {
    phase = "leaving";
    const k = smooth((f - DOCKED) / LEAVING);
    u = 0;
    lift = k;
    out = k;
  } else if (f < LAP_END) {
    phase = "patrolling";
    u = (f - (DOCKED + LEAVING)) / (LAP_END - (DOCKED + LEAVING));
    lift = 1 + 0.35 * Math.sin(u * Math.PI * 4); // a gentle bob
    out = 1;
  } else {
    phase = "returning";
    const k = smooth((f - LAP_END) / RETURNING);
    u = 1;
    lift = 1 - k;
    out = 1 - k;
  }
  const pos = at(u, lift, out);
  // Heading from a short look-ahead along the same path (the nose follows the route).
  const ahead = at(u + 0.004, lift, out);
  const dx = ahead[0] - pos[0];
  const dz = ahead[2] - pos[2];
  const rotationY = Math.hypot(dx, dz) > 1e-6 ? noseYaw(dx, dz) : berthPose().rotationY;
  return { phase, pos, rotationY };
}

export const patrolLabel = (p: PatrolPhase): string =>
  p === "docked" ? "docked at her berth" : p === "patrolling" ? "patrolling the Station" : p === "leaving" ? "casting off" : "returning to her berth";

// --- Encounters: near/far with hysteresis, so standing at the edge never flickers ---

export const NEAR_ENTER = 300;
export const NEAR_EXIT = 380;

export function encounterStep(wasNear: boolean, dist: number): { near: boolean; entered: boolean } {
  const near = wasNear ? dist < NEAR_EXIT : dist < NEAR_ENTER;
  return { near, entered: near && !wasNear };
}

// --- Who you have met (presentation memory, per brain) ---

export interface Meeting {
  count: number;
  firstAt: number;
  lastAt: number;
}
const metKey = (spaceId: string | null) => `npc.met.${spaceId ?? "local"}`;
export const ENCOUNTER_COOLDOWN_MS = 20 * 60_000;

export function readMet(spaceId: string | null): Partial<Record<NpcKey, Meeting>> {
  try {
    const raw = localStorage.getItem(metKey(spaceId));
    const j: unknown = raw ? JSON.parse(raw) : null;
    return j && typeof j === "object" ? (j as Partial<Record<NpcKey, Meeting>>) : {};
  } catch {
    return {};
  }
}

/** Record an encounter unless one happened inside the cooldown. `first` is true only for the very first meeting ever. */
export function recordMeeting(
  spaceId: string | null,
  id: NpcKey,
  nowMs: number = Date.now(),
): { recorded: boolean; first: boolean; count: number } {
  const all = readMet(spaceId);
  const prev = all[id];
  if (prev && nowMs - prev.lastAt < ENCOUNTER_COOLDOWN_MS) return { recorded: false, first: false, count: prev.count };
  const next: Meeting = { count: (prev?.count ?? 0) + 1, firstAt: prev?.firstAt ?? nowMs, lastAt: nowMs };
  try {
    localStorage.setItem(metKey(spaceId), JSON.stringify({ ...all, [id]: next }));
  } catch {
    /* blocked storage: the meeting is felt now and simply not remembered */
  }
  return { recorded: true, first: !prev, count: next.count };
}

/** The situation an encounter is, for the daily script (shared/npcs.ts NPC_SCRIPT_SPECS). */
export function encounterSituation(npc: NpcPresence, phase: PatrolPhase | null, first: boolean): NpcSituation {
  if (first) return "encounter_first";
  if (npc.id === "harbor-controller") return phase === "patrolling" || phase === "leaving" ? "encounter_patrolling" : "encounter_docked";
  return "encounter_arrival";
}

/**
 * The one ambient line for an encounter — description, never the NPC's own speech (she only answers). When today's batched script has
 * variants for the situation, one is chosen by meeting count (so repeat meetings read differently); otherwise the plain offline line.
 */
export function encounterLine(
  npc: NpcPresence,
  phase: PatrolPhase | null,
  first: boolean,
  script?: NpcDayScript | null,
  count = 1,
): string {
  const scripted = script?.source === "model" ? script.lines[npc.id]?.[encounterSituation(npc, phase, first)] : undefined;
  if (scripted && scripted.length > 0) return scripted[Math.max(0, count - 1) % scripted.length]!;
  if (first) return `You've met ${npc.name === "Eternity" ? "Eternity" : `the ${npc.name}`} — ${npc.role}.`;
  if (npc.id === "harbor-controller") {
    return phase === "patrolling" || phase === "leaving"
      ? "The Harbor controller sweeps past on patrol. Tap her tag to talk."
      : "The Harbor controller is moored at her berth. Tap her tag to talk.";
  }
  return `${npc.name} is here. Answer him with his gestures.`;
}
