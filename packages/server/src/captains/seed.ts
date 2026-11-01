import {
  CAPTAIN_LEG_DRIFT_STEPS,
  CAPTAIN_LEG_WARP_STEPS,
  CAPTAIN_TRAVEL_WORLDS,
  type CaptainId,
  type CaptainWorld,
} from "@brain/shared";
import { localDateKey } from "../npcs/repo.js";

/**
 * The captains' seeded determinism (NPC-Player Layer L1, design §3):
 * every step of a captain's life is a pure function of a seed keyed
 * by (captain, step) plus the state going in — the same inputs
 * always produce the same life, replayable in tests and auditable
 * after the fact. No Math.random, no Date.now inside this module:
 * time and identity arrive as arguments.
 *
 * The day plan is the session rhythm (design §8.5): 2–4 visits to
 * the travel-open worlds per space-local day, each 1–3 hours. The
 * plan is derived from the day key alone, so any read of any moment
 * in the day agrees on when her visits were — the engine never
 * stores a plan, it re-derives it.
 *
 * P1 (spec §5.1): the plan is LEG-BASED. Each visit also names the
 * journey TO it — the origin world (the previous visit's world, or
 * the home anchor world for the day's first visit) and the leg kind
 * that journey takes. Same-world consecutive visits travel by a
 * same-world hop (no leg opens — she is already there). Inter-world
 * journeys are priced like the player's chart: warp when her own
 * fuel comfortably covers it (seeded), drift otherwise — drift is
 * always available, so no plan can strand her (invariant I-6b).
 */

/** FNV-1a over the parts, finished with a mulberry32 stream. Pure,
 *  platform-stable (Math.imul arithmetic only). */
export function rngFor(...parts: (string | number)[]): () => number {
  let h = 0x811c9dc5;
  const s = parts.join(":");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Epoch ms of a wall-clock time in a timezone (the space-local day
 *  boundary math — never a UTC boundary). Iterative refinement
 *  against Intl formatting, which settles DST edges in ≤3 passes
 *  for the zones this app runs in. */
export function zonedTimeMs(tz: string, dayKey: string, hour: number, minute = 0): number {
  const [y, m, d] = dayKey.split("-").map((x) => Number(x));
  const want = { y: y ?? 1970, m: m ?? 1, d: d ?? 1, hh: hour, mm: minute };
  let guess = Date.UTC(want.y, want.m - 1, want.d, want.hh, want.mm);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? "0");
    const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const wantAsUtc = Date.UTC(want.y, want.m - 1, want.d, want.hh, want.mm);
    const diff = wantAsUtc - wallAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** The kind of journey a planned leg takes. "home" is the free home
 *  route (destination = the home anchor world); its underlying pace
 *  is carried by the visit's leg steps. */
export type CaptainLegPlanKind = "warp" | "drift" | "home";

/** One planned visit in a captain's day. */
export interface CaptainVisit {
  /** 0-based index within the day. */
  index: number;
  /** Total visits in the day (2–4). */
  total: number;
  world: CaptainWorld;
  startMs: number;
  endMs: number;
  /** The session key stored in state while this visit is live. */
  sessionKey: string;
  /** The world the journey TO this visit departs from: the previous
   *  visit's world, or the home anchor world for the day's first
   *  visit (she starts her day at home). */
  originWorld: CaptainWorld;
  /** The leg kind for the journey to this visit. `null` when the
   *  origin IS this visit's world — a same-world hop opens no leg. */
  legKind: CaptainLegPlanKind | null;
  /** Advance steps the leg to this visit takes (0 when legKind is
   *  null). Warp = CAPTAIN_LEG_WARP_STEPS, drift/home-drift =
   *  CAPTAIN_LEG_DRIFT_STEPS. */
  legSteps: number;
}

/** Visits may only start inside this local window — a captain's day
 *  has edges, like anyone's. */
const DAY_FIRST_HOUR = 6;
const DAY_LAST_END_HOUR = 23;

/**
 * A captain's visits for one space-local day, derived from the seed:
 * 2–4 visits, starts spread across the day window, each 1–3 hours,
 * home-world biased (0.65) but never home-locked. Destinations are
 * drawn from the D-1 travel set only. Pure: the same (captain,
 * dayKey, tz, homeWorld) always yields the same plan — visits AND
 * legs. The home bias input is the ANCHOR world, always (A8-5):
 * callers pass the definition's homeAnchor.world, never the
 * captain's current world.
 */
export function dayPlan(
  captainId: CaptainId,
  dayKey: string,
  tz: string,
  homeWorld: CaptainWorld,
): CaptainVisit[] {
  const rng = rngFor(captainId, "plan", dayKey);
  const total = 2 + Math.floor(rng() * 3); // 2..4
  const awayWorlds = CAPTAIN_TRAVEL_WORLDS.filter((w) => w !== homeWorld);
  const visits: CaptainVisit[] = [];
  const spanHours = DAY_LAST_END_HOUR - DAY_FIRST_HOUR - 3; // room for the last visit's length
  let prevStartHour = -Infinity;
  for (let i = 0; i < total; i++) {
    // Starts are spread by slot so visits cannot pile onto one hour,
    // with a seeded jitter inside each slot.
    const slot = spanHours / total;
    let startHour = DAY_FIRST_HOUR + Math.floor(i * slot) + Math.floor(rng() * Math.max(1, Math.floor(slot) - 1));
    if (startHour <= prevStartHour) startHour = prevStartHour + 2;
    if (startHour > DAY_LAST_END_HOUR - 1) break;
    const duration = 1 + Math.floor(rng() * 3); // 1..3 hours
    let endHour = startHour + duration;
    if (endHour > DAY_LAST_END_HOUR) endHour = DAY_LAST_END_HOUR;
    if (endHour <= startHour) continue;
    let world: CaptainWorld;
    if (rng() < 0.65) {
      world = homeWorld;
    } else {
      // Seeded pick among the other travel-open worlds — the binary
      // "other world" of L1 is gone; the galaxy is the draw.
      world = awayWorlds[Math.floor(rng() * awayWorlds.length)] ?? homeWorld;
    }
    visits.push({
      index: visits.length,
      total,
      world,
      startMs: zonedTimeMs(tz, dayKey, startHour),
      endMs: zonedTimeMs(tz, dayKey, endHour),
      sessionKey: `${dayKey}#${visits.length}`,
      originWorld: homeWorld, // corrected below, once the chain is known
      legKind: null,
      legSteps: 0,
    });
    prevStartHour = startHour;
  }
  // Visits never overlap: a long visit ends where the next begins.
  for (let i = 0; i + 1 < visits.length; i++) {
    const cur = visits[i];
    const nxt = visits[i + 1];
    if (cur && nxt && cur.endMs > nxt.startMs) cur.endMs = nxt.startMs;
  }
  // Chain the legs: each visit's journey departs from the previous
  // visit's world (the day's first departs from home). Leg kinds are
  // seeded per leg: warp when the draw says fast (fuel is checked
  // again by the engine at departure — a plan warp she cannot afford
  // departs as a drift instead, never an error), drift otherwise;
  // a leg whose destination is home rides the free home route.
  let origin: CaptainWorld = homeWorld;
  for (const v of visits) {
    v.originWorld = origin;
    if (origin === v.world) {
      v.legKind = null;
      v.legSteps = 0;
    } else if (v.world === homeWorld) {
      const fast = rng() < 0.4;
      v.legKind = "home";
      v.legSteps = fast ? CAPTAIN_LEG_WARP_STEPS : CAPTAIN_LEG_DRIFT_STEPS;
    } else if (rng() < 0.4) {
      v.legKind = "warp";
      v.legSteps = CAPTAIN_LEG_WARP_STEPS;
    } else {
      v.legKind = "drift";
      v.legSteps = CAPTAIN_LEG_DRIFT_STEPS;
    }
    origin = v.world;
  }
  // The spread loop may have dropped a late visit; renumber totals so
  // every line the captain speaks about her day is honest.
  return visits.map((v) => ({ ...v, total: visits.length }));
}

/** The next planned visit at or after `nowMs`, looking into tomorrow
 *  when today is spent. Used for honest "headed" answers. Leg-aware
 *  (spec §5.1): the returned visit carries its origin and leg, so a
 *  "headed" answer can name the journey, not just the destination. */
export function nextVisit(
  captainId: CaptainId,
  nowMs: number,
  tz: string,
  homeWorld: CaptainWorld,
): CaptainVisit & { dayKey: string } {
  const todayKey = localDateKey(tz, nowMs);
  for (const v of dayPlan(captainId, todayKey, tz, homeWorld)) {
    if (v.endMs > nowMs) return { ...v, dayKey: todayKey };
  }
  const tomorrowMs = zonedTimeMs(tz, todayKey, 12) + 24 * 60 * 60 * 1000;
  const tomorrowKey = localDateKey(tz, tomorrowMs);
  const first = dayPlan(captainId, tomorrowKey, tz, homeWorld)[0];
  if (!first) throw new Error("dayPlan produced no visits — the rhythm constants are broken.");
  return { ...first, dayKey: tomorrowKey };
}
