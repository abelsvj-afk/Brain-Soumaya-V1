import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NpcRepo, localDateKey } from "../npcs/repo.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import {
  BUYERS,
  CAPTAIN_ADVANCE_STEP_MS,
  CAPTAIN_AFFINITY_CONVOY,
  CAPTAIN_AFFINITY_TOW_ASSIST,
  CAPTAIN_TRAVEL_WORLDS,
  DIRECTOR_COOLDOWN_STEPS,
  DIRECTOR_DAILY_CAP,
  DIRECTOR_QUIET_MAX_ACTS,
  DIRECTOR_QUIET_WINDOW_STEPS,
  DIRECTOR_RUSH_FRACTION,
  captainDefinition,
  postedPrice,
  type CaptainId,
  type CaptainWorld,
  type GameBuyerId,
  type GameGood,
} from "@brain/shared";
import { rngFor } from "./seed.js";
import { NpcEconomy } from "./npcEconomy.js";
import { addAffinity } from "./affinity.js";

/**
 * P3 — Director-lite (Layer §8.4; settled Q3/Q4; scope ruled R8,
 * mechanics R9/R10, switch storage R14). The Director keeps the
 * public worlds feeling lived-in: when the player is present in a
 * public world and the captains' life has gone quiet, it stages
 * at most ONE small incident — a lane closure, a buying rush in
 * the NPC pool, a distress tow, a convoy arrival — logged as an
 * npc_log record with "Director" as its plain-language cause
 * source. Hard lines (Q3): nothing is destroyed or lost, nobody
 * dies, no incident names or touches the player, a private world,
 * or Eternity. Lost-newcomer and far-captain incidents are P4's —
 * the far register does not exist yet (S-P3-7).
 *
 * Evaluation happens INSIDE advances (the engine's lazy
 * discipline — no timers), is fully seeded (rngFor), and respects
 * the cooldown and the per-local-day cap. OFF short-circuits
 * before any draw and means zero — no incidents, no rush
 * allowances, no closures, at state level (A4/A6).
 */

export type DirectorIncidentKind = "lane-closure" | "buying-rush" | "tow" | "convoy";

export interface DirectorIncident {
  kind: DirectorIncidentKind;
  /** The captain whose log carries the incident line. */
  captainId: CaptainId;
  /** The npc_log kind the engine logs the incident under. */
  actKind: "wait" | "arrive" | "travel";
  act: string;
  cause: string;
}

export interface DirectorState {
  enabled: boolean;
  lastIncidentAtMs: number | null;
  incidentsDay: string | null;
  incidentsToday: number;
  closedFrom: CaptainWorld | null;
  closedTo: CaptainWorld | null;
  closedDay: string | null;
}

interface DirectorDbRow {
  enabled: number;
  last_incident_at_ms: number | null;
  incidents_day: string | null;
  incidents_today: number;
  closed_from: string | null;
  closed_to: string | null;
  closed_day: string | null;
}

const WORLD_PLAIN: Record<string, string> = {
  "great-station": "the Great Station",
  scale: "Scale",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  "quiet-archive": "the Quiet Archive",
};

function worldPlain(w: string): string {
  return WORLD_PLAIN[w] ?? w;
}

export function getDirectorState(h: DbHandle, spaceId: string = DEFAULT_SPACE): DirectorState {
  const row = h.sqlite
    .prepare(
      `SELECT enabled, last_incident_at_ms, incidents_day, incidents_today, closed_from, closed_to, closed_day
         FROM npc_director_state WHERE space_id = ?`,
    )
    .get(spaceId) as DirectorDbRow | undefined;
  if (!row) {
    return { enabled: true, lastIncidentAtMs: null, incidentsDay: null, incidentsToday: 0, closedFrom: null, closedTo: null, closedDay: null };
  }
  return {
    enabled: row.enabled === 1,
    lastIncidentAtMs: row.last_incident_at_ms,
    incidentsDay: row.incidents_day,
    incidentsToday: row.incidents_today,
    closedFrom: (row.closed_from as CaptainWorld | null) ?? null,
    closedTo: (row.closed_to as CaptainWorld | null) ?? null,
    closedDay: row.closed_day,
  };
}

function saveDirectorState(h: DbHandle, spaceId: string, st: DirectorState, nowMs: number): void {
  h.sqlite
    .prepare(
      `INSERT INTO npc_director_state
         (space_id, enabled, last_incident_at_ms, incidents_day, incidents_today, closed_from, closed_to, closed_day, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id) DO UPDATE SET
         enabled = excluded.enabled, last_incident_at_ms = excluded.last_incident_at_ms,
         incidents_day = excluded.incidents_day, incidents_today = excluded.incidents_today,
         closed_from = excluded.closed_from, closed_to = excluded.closed_to,
         closed_day = excluded.closed_day, updated_at = excluded.updated_at`,
    )
    .run(
      spaceId, st.enabled ? 1 : 0, st.lastIncidentAtMs, st.incidentsDay, st.incidentsToday,
      st.closedFrom, st.closedTo, st.closedDay, new Date(nowMs).toISOString(),
    );
}

/** The owner switch (R14): stored on the state row, toggled by an
 *  owner act on the captains routes, logged like stop/resume. */
export function setDirectorEnabled(h: DbHandle, spaceId: string, enabled: boolean, nowMs: number): DirectorState {
  const st = getDirectorState(h, spaceId);
  st.enabled = enabled;
  saveDirectorState(h, spaceId, st, nowMs);
  new NpcRepo(h, spaceId).appendLog(
    "harbor-controller",
    "wait",
    enabled ? "Director switched on by the owner." : "Director switched off by the owner.",
    "The owner's Station-panel switch for Director-lite (R14). Off means zero incidents, ever — no rushes, no lane closures, no tows.",
    nowMs,
  );
  return getDirectorState(h, spaceId);
}

/** The live lane closure for a local day, if any (R10). A closure
 *  lives until the next local-day boundary at the latest — a
 *  closure stored under another day key is simply not live. */
export function laneClosureFor(h: DbHandle, spaceId: string, dayKey: string): { from: CaptainWorld; to: CaptainWorld } | null {
  const st = getDirectorState(h, spaceId);
  if (st.closedDay !== dayKey || !st.closedFrom || !st.closedTo) return null;
  return { from: st.closedFrom, to: st.closedTo };
}

export function applyLaneClosure(h: DbHandle, spaceId: string, from: CaptainWorld, to: CaptainWorld, nowMs: number): void {
  const tz = spaceTimezone(h.sqlite, spaceId);
  const st = getDirectorState(h, spaceId);
  st.closedFrom = from;
  st.closedTo = to;
  st.closedDay = localDateKey(tz, nowMs);
  saveDirectorState(h, spaceId, st, nowMs);
}

/** R9: the rush is floor(cap × fraction) of extra premium demand
 *  for the remainder of the local day, in the NPC pool only,
 *  recorded as an allowance — never a price change (the rush moves
 *  demand, never price). Returns the allowance added. */
export function applyBuyingRush(h: DbHandle, spaceId: string, buyerId: GameBuyerId, good: GameGood, nowMs: number): number {
  const buyer = BUYERS.find((b) => b.id === buyerId);
  if (!buyer || buyer.dailyDemandCap === null) return 0;
  const allowance = Math.floor(buyer.dailyDemandCap * DIRECTOR_RUSH_FRACTION);
  if (allowance <= 0) return 0;
  // Pool-level write: any captain's service instance reaches the
  // shared pool (the demand row is keyed by space, not captain).
  const anyCaptain = captainDefinition("bex")!;
  new NpcEconomy(h, spaceId, anyCaptain.id).addRushAllowance(buyerId, good, allowance, nowMs);
  return allowance;
}

/** Non-wait captain acts logged in the quiet window ending now —
 *  the spectacle score's activity input (a wait is the sound of
 *  quiet, so it does not count against quiet). */
function recentActivity(h: DbHandle, spaceId: string, nowMs: number): number {
  const from = new Date(nowMs - DIRECTOR_QUIET_WINDOW_STEPS * CAPTAIN_ADVANCE_STEP_MS).toISOString();
  const to = new Date(nowMs).toISOString();
  const row = h.sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM npc_log
        WHERE space_id = ? AND npc_id != 'harbor-controller' AND kind != 'wait'
          AND created_at >= ? AND created_at <= ?`,
    )
    .get(spaceId, from, to) as { c: number };
  return row.c;
}

function activeCaptains(): CaptainId[] {
  return ["veyra", "bex", "junia", "dain", "hollis", "sorrel", "yara", "felix"]
    .map((id) => captainDefinition(id))
    .filter((d) => !!d && d.active)
    .map((d) => d!.id);
}

/**
 * Evaluate the Director for one advance step in which the player
 * is present in a public world. Returns the incident staged (its
 * effects already applied), or null. `forceKind` is a test seam —
 * production never passes it; a forced incident still records its
 * state and respects the OFF switch.
 */
export function evaluateDirector(
  h: DbHandle,
  spaceId: string,
  nowMs: number,
  opts: { presentWorld: CaptainWorld; captainId: CaptainId; forceKind?: DirectorIncidentKind },
): DirectorIncident | null {
  const st = getDirectorState(h, spaceId);
  if (!st.enabled) return null;
  const tz = spaceTimezone(h.sqlite, spaceId);
  const today = localDateKey(tz, nowMs);
  const incidentsToday = st.incidentsDay === today ? st.incidentsToday : 0;
  if (!opts.forceKind) {
    if (incidentsToday >= DIRECTOR_DAILY_CAP) return null;
    if (st.lastIncidentAtMs !== null && nowMs - st.lastIncidentAtMs < DIRECTOR_COOLDOWN_STEPS * CAPTAIN_ADVANCE_STEP_MS) return null;
    if (recentActivity(h, spaceId, nowMs) >= DIRECTOR_QUIET_MAX_ACTS) return null;
  }

  const rng = rngFor("director", spaceId, nowMs);
  const actives = activeCaptains();
  const others = actives.filter((id) => id !== opts.captainId);
  const feasible: DirectorIncidentKind[] = ["lane-closure", "buying-rush"];
  if (others.length >= 1) feasible.push("tow");
  if (actives.length >= 2) feasible.push("convoy");
  const kind = opts.forceKind && feasible.includes(opts.forceKind)
    ? opts.forceKind
    : feasible[Math.floor(rng() * feasible.length)] ?? "buying-rush";

  const captainId = opts.captainId;
  const name = captainDefinition(captainId)?.name ?? captainId;
  let incident: DirectorIncident;

  if (kind === "lane-closure") {
    // One ordered leg pair among the travel worlds; never a pair
    // already closed today, and only one closure lives at a time
    // (so both-directions stacking cannot occur, R10).
    const pairs: [CaptainWorld, CaptainWorld][] = [];
    for (const from of CAPTAIN_TRAVEL_WORLDS) {
      for (const to of CAPTAIN_TRAVEL_WORLDS) {
        if (from !== to) pairs.push([from, to]);
      }
    }
    const [from, to] = pairs[Math.floor(rng() * pairs.length)] ?? ["great-station", "scale"];
    applyLaneClosure(h, spaceId, from, to, nowMs);
    incident = {
      kind,
      captainId,
      actKind: "wait",
      act: `Lane notice: the warp lane from ${worldPlain(from)} to ${worldPlain(to)} is closed for the rest of the day — traffic drifts instead.`,
      cause: "Director: a quiet stretch wanted a little weather in the lanes; drift and the home route stay open, and nobody is stranded.",
    };
  } else if (kind === "buying-rush") {
    const premiumPairs: [GameBuyerId, GameGood][] = [];
    for (const b of BUYERS) {
      if (b.buysAll) continue;
      for (const g of b.premiumGoods) premiumPairs.push([b.id, g]);
    }
    const [buyerId, good] = premiumPairs[Math.floor(rng() * premiumPairs.length)] ?? ["station-foundry", "ore"];
    const allowance = applyBuyingRush(h, spaceId, buyerId, good, nowMs);
    const buyerName = BUYERS.find((b) => b.id === buyerId)?.name ?? buyerId;
    const price = postedPrice(buyerId, good);
    incident = {
      kind,
      captainId,
      actKind: "wait",
      act: `Market word: ${buyerName} is buying ${good} hard today — extra demand on the captains' side of the market${price ? `, still at the posted ${price} Credits` : ""} (+${allowance} units of premium room).`,
      cause: "Director: a quiet market wanted a pulse; the rush lives in the NPC demand pool only and moves demand, never price.",
    };
  } else if (kind === "tow") {
    // The tower is the first other active captain in registry
    // order — a stable discipline, no extra draw.
    const tower = others[0]!;
    const towerName = captainDefinition(tower)?.name ?? tower;
    addAffinity(h, spaceId, captainId, tower, CAPTAIN_AFFINITY_TOW_ASSIST, nowMs);
    incident = {
      kind,
      captainId,
      actKind: "arrive",
      act: `${name} came in on a tow, shaken and sheepish, ${towerName} flying the tow line. Nothing lost — a story gained.`,
      cause: "Director: a hint of danger with nothing destroyed and nobody hurt; the tow is an affinity event between captains.",
    };
  } else {
    const partner = others[0]!;
    const partnerName = captainDefinition(partner)?.name ?? partner;
    addAffinity(h, spaceId, captainId, partner, CAPTAIN_AFFINITY_CONVOY, nowMs);
    incident = {
      kind,
      captainId,
      actKind: "arrive",
      act: `Convoy arrival: ${name} and ${partnerName} came in together, hulls in loose formation, the way road crews do.`,
      cause: "Director: company on the lanes is spectacle enough; co-travel warms the pair's affinity by the ruled step.",
    };
  }

  // Record the incident against the cooldown + daily cap.
  const after = getDirectorState(h, spaceId);
  after.lastIncidentAtMs = nowMs;
  after.incidentsDay = today;
  after.incidentsToday = (after.incidentsDay === today ? incidentsToday : 0) + 1;
  saveDirectorState(h, spaceId, after, nowMs);
  return incident;
}
