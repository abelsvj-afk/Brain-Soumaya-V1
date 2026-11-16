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

// --- Roaming: free flight in the world they are in (every cast member that has a ship and is not the Station controller on her berth) ---
// No circle: each person chooses their own places and flies between them. The owner asked for free-roam (docs/specs/npcs-alive-2026-10-30.md);
// the lap never delivered it, so the lap is gone — a waypoint wander instead.

export interface RoamAnchor {
  center: [number, number, number];
  radius: number;
}

/** One leg lasts 40–70 s per NPC (their own pace, so a crowd never moves in step); ~70% flying, ~30% lingering where they arrived. */
const ROAM_LEG_MIN_MS = 40_000;
const ROAM_LEG_SPAN_MS = 30_000;
const ROAM_TRAVEL = 0.7;
/** Destinations stay inside 90% of the anchor radius — the fence. */
const ROAM_REACH = 0.9;
const hash01 = (seed: string) => {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) x = Math.imul(x ^ seed.charCodeAt(i), 16777619);
  x ^= x >>> 15;
  x = Math.imul(x, 2246822507);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

/** Smoothstep easing (zero slope at both ends, so a leg starts and stops without a jolt). */
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** A chosen place inside the anchor disc: seeded, so the same leg always means the same place. Uniform over the disc's area. */
function roamDestination(leg: number, id: string, anchor: RoamAnchor): [number, number, number] {
  const r = anchor.radius * ROAM_REACH * Math.sqrt(hash01(`${id}|leg${leg}|r`));
  const a = hash01(`${id}|leg${leg}|a`) * Math.PI * 2;
  return [anchor.center[0] + Math.cos(a) * r, anchor.center[1], anchor.center[2] + Math.sin(a) * r];
}

/**
 * Free flight: fly to a chosen place, linger there, choose another. Pure and clock-driven — a reload resumes mid-leg. Under reduced motion, or
 * while stopped (the kill switch: a stopped NPC does nothing), they hold at their start point (still found, tagged and met).
 */
export function roamAt(
  nowMs: number,
  id: string,
  anchor: RoamAnchor,
  opts: { reducedMotion?: boolean; stopped?: boolean } = {},
): { pos: [number, number, number]; rotationY: number } {
  const legMs = ROAM_LEG_MIN_MS + ROAM_LEG_SPAN_MS * hash01(`${id}|leg`);
  const bobPhase = hash01(`${id}|bob`) * Math.PI * 2;
  const at = (t: number): { pos: [number, number, number]; rotationY: number } => {
    const k = Math.floor(t / legMs);
    const u = (t - k * legMs) / legMs;
    const from = roamDestination(k - 1, id, anchor);
    const to = roamDestination(k, id, anchor);
    const v = smooth(Math.min(1, u / ROAM_TRAVEL));
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    return {
      pos: [
        from[0] + dx * v,
        anchor.center[1] + Math.sin(t / 3000 + bobPhase) * anchor.radius * 0.02,
        from[2] + dz * v,
      ],
      // The nose follows the leg (and keeps facing that way while lingering), never a fixed circle.
      rotationY: Math.hypot(dx, dz) > 1e-6 ? Math.atan2(-dx, -dz) : 0,
    };
  };
  return at(opts.reducedMotion || opts.stopped ? 0 : nowMs);
}

// --- Patrol: docked → leave → wander her patrol → return, on a wall-clock cycle ---
// She keeps her job — still patrols the Station, still returns to her berth on schedule — but the patrolling phase is a free wander
// inside the patrol disc now, not one perfect circle.

export const PATROL_PERIOD_MS = 5 * 60_000;
/** Cycle fractions: docked, leaving, patrolling, returning (sum 1). */
const DOCKED = 0.3;
const LEAVING = 0.06;
const RETURNING = 0.06;
const PATROL_END = 1 - RETURNING;

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
/** Legs of the wander inside one patrolling phase. */
const PATROL_LEGS = 3;

function polar(radius: number, angle: number, y: number): [number, number, number] {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

/** Heading about Y with the nose (−Z) along the direction of travel (dx, dz). */
const noseYaw = (dx: number, dz: number) => Math.atan2(-dx, -dz);

const lerp3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Heading from a to b, or the fallback when the two are (nearly) the same place. */
const yawOf = (a: [number, number, number], b: [number, number, number], fallback: number): number => {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dz) > 1e-6 ? noseYaw(dx, dz) : fallback;
};

/**
 * One waypoint of the patrol wander (seeded by the berth, so every station's controller wanders her own way). Waypoint 0 is where leaving
 * ends — the patrol starts there; the rest are chosen places inside the patrol disc, and the last is where returning begins.
 */
function patrolWaypoint(j: number, berth: PatrolBerth): [number, number, number] {
  if (j === 0) return polar(PATROL_RADIUS, berth.angle, berth.y + PATROL_LIFT);
  const seed = `patrol|${berth.angle}|${berth.radius}|${j}`;
  const r = PATROL_RADIUS * 0.9 * Math.sqrt(hash01(`${seed}|r`));
  const a = berth.angle + hash01(`${seed}|a`) * Math.PI * 2;
  return [Math.cos(a) * r, berth.y + PATROL_LIFT * (0.85 + 0.3 * hash01(`${seed}|y`)), Math.sin(a) * r];
}

export function patrolAt(nowMs: number, berth: PatrolBerth, opts: { reducedMotion?: boolean; stopped?: boolean } = {}): PatrolPose {
  const berthPose = (): PatrolPose => ({
    phase: "docked",
    pos: polar(berth.radius, berth.angle, berth.y),
    rotationY: noseYaw(Math.cos(berth.angle), Math.sin(berth.angle)),
  });
  if (opts.reducedMotion || opts.stopped) return berthPose();
  const f = (((nowMs % PATROL_PERIOD_MS) + PATROL_PERIOD_MS) % PATROL_PERIOD_MS) / PATROL_PERIOD_MS;
  if (f < DOCKED) return berthPose();
  const berthPos = berthPose().pos;
  const berthYaw = berthPose().rotationY;
  // The pose is a function of one parameter, so every phase boundary is continuous: leaving ends where the wander starts,
  // the wander ends where returning starts, and returning ends at the berth.
  const poseAt = (ff: number): { pos: [number, number, number]; rotationY: number } => {
    const w = (((ff % 1) + 1) % 1);
    if (w < DOCKED) return { pos: berthPos, rotationY: berthYaw };
    if (w < DOCKED + LEAVING) {
      const k = smooth((w - DOCKED) / LEAVING);
      const w0 = patrolWaypoint(0, berth);
      return { pos: lerp3(berthPos, w0, k), rotationY: yawOf(berthPos, w0, berthYaw) };
    }
    if (w < PATROL_END) {
      const u = (w - (DOCKED + LEAVING)) / (PATROL_END - (DOCKED + LEAVING));
      const j = Math.min(PATROL_LEGS - 1, Math.floor(u * PATROL_LEGS));
      const lu = u * PATROL_LEGS - j;
      const from = patrolWaypoint(j, berth);
      const to = patrolWaypoint(j + 1, berth);
      const v = smooth(Math.min(1, lu / ROAM_TRAVEL));
      const pos = lerp3(from, to, v);
      pos[1] += Math.sin(u * Math.PI * 6) * PATROL_LIFT * 0.15; // a gentle bob
      return { pos, rotationY: yawOf(from, to, berthYaw) };
    }
    const k = smooth((w - PATROL_END) / RETURNING);
    const w3 = patrolWaypoint(PATROL_LEGS, berth);
    return { pos: lerp3(w3, berthPos, k), rotationY: yawOf(w3, berthPos, berthYaw) };
  };
  const { pos, rotationY } = poseAt(f);
  const phase: PatrolPhase = f < DOCKED + LEAVING ? "leaving" : f < PATROL_END ? "patrolling" : "returning";
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

/**
 * Talk is a rendezvous, not a race (Item 3): tapping Talk from far away
 * flies the ship to the NPC's live position first and opens the talk on
 * arrival; near enough (or with no live position to fly to) it opens at
 * once. The viewer is the nearer of the camera and the ship, when flying.
 */
export function talkRange(
  npcPos: readonly [number, number, number] | undefined,
  cameraPos: readonly [number, number, number],
  flightPos: readonly [number, number, number] | null,
): "open" | "approach" | "unknown" {
  if (!npcPos) return "unknown";
  const d = (a: readonly [number, number, number], b: readonly [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const nearest = Math.min(d(cameraPos, npcPos), flightPos ? d(flightPos, npcPos) : Infinity);
  return nearest <= NEAR_ENTER ? "open" : "approach";
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
