/**
 * NPC presence (docs/specs/npcs-alive-2026-10-30.md): where an NPC is, whether you are near, and who you have met.
 * Pure (no three.js, no DOM except the small localStorage store, which swallows a blocked storage) so it is unit-tested.
 * This is PRESENTATION — a ship's idle patrol and ambient description. It adds no act, no speech and no server state, so the
 * NPC fence (shared/npcs.ts) is untouched: the harbor controller still only answers, Eternity alone initiates.
 */

import { castIn, type CastMember, type NpcDayScript, type NpcSituation } from "@brain/shared";

export type NpcKey = string;

/** The cast members who are in a world right now (shared/npcs.ts `npcLocation` — pure, clock-driven, the same for every viewer). Never a personal brain. */
export const npcsIn = (world: string | null | undefined, nowMs: number = Date.now()): CastMember[] => castIn(world, nowMs);

/** What someone is doing, in words (never colour alone): at home they keep to their job; away they are visiting. */
export function npcActivity(member: CastMember, location: string, phase: PatrolPhase | "roaming" | null): string {
  if (member.id === "harbor-controller" && location === member.home) return phase ? patrolLabel(phase as PatrolPhase) : "docked at her berth";
  if (location !== member.home) return "visiting from afar";
  return "about their work";
}

/** The icon a Who's-here tile wears. */
export const npcIcon = (member: CastMember): string => (member.id === "eternity" ? "i:stillness" : member.id === "harbor-controller" ? "i:harbor" : "i:soumaya");

// --- Roaming: a slow lap of the world they are in (every cast member that has a ship and is not the Station controller on her berth) ---

export interface RoamAnchor {
  center: [number, number, number];
  radius: number;
}

const ROAM_PERIOD_MS = 4 * 60_000;
const hash01 = (seed: string) => {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

/**
 * A continuous lap round the world's anchor (centre + radius): its own start angle and period per NPC (so a crowd never moves in step), a gentle bob, the nose along
 * the path. Pure and clock-driven — a reload resumes mid-lap. Under reduced motion they hold at their start point (still found, tagged and met).
 */
export function roamAt(
  nowMs: number,
  id: string,
  anchor: RoamAnchor,
  opts: { reducedMotion?: boolean } = {},
): { pos: [number, number, number]; rotationY: number } {
  const period = ROAM_PERIOD_MS * (0.75 + 0.6 * hash01(`${id}|period`));
  const dir = hash01(`${id}|dir`) < 0.5 ? 1 : -1;
  const a0 = hash01(`${id}|angle`) * Math.PI * 2;
  const rr = anchor.radius * (0.85 + 0.25 * hash01(`${id}|r`));
  const at = (t: number): [number, number, number] => {
    const a = a0 + dir * Math.PI * 2 * (t / period);
    return [anchor.center[0] + Math.cos(a) * rr, anchor.center[1] + Math.sin(a * 3 + a0) * anchor.radius * 0.06, anchor.center[2] + Math.sin(a) * rr];
  };
  const t = opts.reducedMotion ? 0 : ((nowMs % period) + period) % period;
  const pos = at(t);
  const ahead = at(t + 400);
  const dx = ahead[0] - pos[0];
  const dz = ahead[2] - pos[2];
  return { pos, rotationY: Math.hypot(dx, dz) > 1e-6 ? Math.atan2(-dx, -dz) : 0 };
}

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

/** The situation an encounter is, for the daily script (shared/npcs.ts scriptSpecsFor). */
export function encounterSituation(member: CastMember, location: string, phase: PatrolPhase | "roaming" | null, first: boolean): NpcSituation {
  if (first) return "encounter_first";
  if (member.id === "eternity") return "encounter_arrival";
  if (member.id === "harbor-controller") {
    if (location !== member.home) return "encounter_near";
    return phase === "patrolling" || phase === "leaving" ? "encounter_patrolling" : "encounter_docked";
  }
  return location === member.home ? "encounter_near" : "encounter_visiting";
}

/**
 * What an encounter says. They SPEAK (owner 2026-10-30): when today's batched script has variants for the situation one is chosen by meeting count (so repeat meetings
 * read differently); otherwise the character's own offline greeting. A first meeting names who they are. Shown as `Name: “line”`.
 */
export function encounterLine(
  member: CastMember,
  location: string,
  phase: PatrolPhase | "roaming" | null,
  first: boolean,
  script?: NpcDayScript | null,
  count = 1,
): string {
  const scripted = script?.source === "model" ? script.lines[member.id]?.[encounterSituation(member, location, phase, first)] : undefined;
  const pickLine = (lines: readonly string[]) => lines[Math.max(0, count - 1) % lines.length]!;
  const line =
    scripted && scripted.length > 0
      ? pickLine(scripted)
      : first
        ? member.intro
        : member.greetings.length > 0
          ? pickLine(member.greetings)
          : `${member.name} is here.`;
  return `${member.name}: “${line.replace(/^["“]|["”]$/g, "")}”`;
}
