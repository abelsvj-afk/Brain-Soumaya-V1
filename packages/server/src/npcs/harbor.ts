import type { DbHandle } from "../db/client.js";
import { EconomyRepo } from "../economy.js";
import { TravelRepo, TRAVEL_WORLD_KEYS } from "../repositories/travel.repo.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import {
  FUEL_REGEN_PER_HOUR,
  PEOPLE_GATE_MIN_MEMORIES_EACH,
  PEOPLE_GATE_MIN_PEOPLE,
  PEOPLE_GATE_MIN_SHARED_MEMORIES,
  WARP_COST,
  type NpcQuestionKind,
} from "@brain/shared";
import { NpcRepo, localDateKey } from "./repo.js";
import { checkNpcEternityGate } from "./gate.js";

/**
 * The harbor controller (roster #1 — design note §4): one job, help
 * you arrive. Routes, arrivals, traffic. Answers when asked; never
 * directs.
 *
 * The controller's Decide step is a DETERMINISTIC policy over live
 * server state — not a model call. The model/key question (note §7
 * Q1) is still the owner's, so no key is procured and no answer is
 * ever improvised: every word the controller speaks comes from the
 * ledger, the fuel gauge, or the chart. The decider is swappable —
 * when the owner settles Q1, a model-backed decider can take this
 * policy's place behind the same fence. Until then the loop is still
 * the loop: Perceive → Decide → Act → Log, provably, with doing
 * nothing a logged non-act.
 *
 * The controller never writes to a brain (it reads the travel ledger
 * and the fuel gauge only), never leaves the Station, never claims a
 * route is open that the server hasn't opened, and never narrates a
 * relic holding it doesn't have.
 */

export interface HarborPerception {
  nowMs: number;
  /** Where the visitor's brain is, from the travel ledger. */
  currentWorld: string;
  activeJourney: { id: string; kind: string; origin: string; destination: string; state: string } | null;
  /** The latest journey that ARRIVED at the Station, if any. */
  latestStationArrival: { id: string; kind: string; origin: string; arrivedAtMs: number } | null;
  /** Journeys that arrived at the Station on the space-local day. */
  stationArrivalsToday: number;
  /** Journeys in transit to the Station right now. */
  inboundToStation: number;
  fuel: number;
  fuelCap: number;
  peopleGateOpen: boolean;
  /** The NPC's own gate verdict (its separate-pool holdings only). */
  gate: ReturnType<typeof checkNpcEternityGate>;
  /** Whether the controller already welcomed this arrival. */
  alreadyWelcomedArrivalId: string | null;
  /** Whether the controller already explored today (space-local day). */
  exploredToday: boolean;
}

/** A fresh arrival is welcomeable for an hour after it lands — after
 *  that the moment has passed and a welcome would be stale. */
export const WELCOME_WINDOW_MS = 60 * 60 * 1000;

const WORLD_NAMES: Record<string, string> = {
  home: "Home",
  "great-station": "the Great Station",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  people: "the People",
  "quiet-archive": "Quiet/Archive",
};

function worldName(key: string): string {
  return WORLD_NAMES[key] ?? key;
}

/** Plain-language "how long ago" — minutes or hours, never a clock
 *  time, never UTC. */
export function agoPlain(atMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - atMs) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour ago" : `about ${hours} hours ago`;
}

export function perceive(h: DbHandle, spaceId: string, nowMs: number = Date.now()): HarborPerception {
  const travel = new TravelRepo(h, spaceId);
  const repo = new NpcRepo(h, spaceId);
  const state = travel.getState(nowMs);
  const tz = spaceTimezone(h.sqlite, spaceId);
  const today = localDateKey(tz, nowMs);
  const npcState = repo.state("harbor-controller");
  const holdings = repo.holdings("harbor-controller");
  const gate = checkNpcEternityGate(holdings, repo.gateOpen("harbor-controller"));

  const arrivalRows = h.sqlite
    .prepare(
      `SELECT id, kind, origin, arrived_at FROM travel_journeys
       WHERE space_id = ? AND state = 'arrived' AND destination = 'great-station'
       ORDER BY arrived_at DESC, rowid DESC`,
    )
    .all(spaceId) as { id: string; kind: string; origin: string; arrived_at: string }[];
  const latest = arrivalRows[0];
  const arrivalsToday = arrivalRows.filter((r) => localDateKey(tz, Date.parse(r.arrived_at)) === today).length;
  const inbound = (
    h.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM travel_journeys
         WHERE space_id = ? AND state IN ('arming','in_transit','returning') AND destination = 'great-station'`,
      )
      .get(spaceId) as { n: number }
  ).n;

  const fuel = new EconomyRepo(h, spaceId).toFuel();
  return {
    nowMs,
    currentWorld: state.currentWorld,
    activeJourney: state.activeJourney
      ? {
          id: state.activeJourney.id,
          kind: state.activeJourney.kind,
          origin: state.activeJourney.origin,
          destination: state.activeJourney.destination,
          state: state.activeJourney.state,
        }
      : null,
    latestStationArrival: latest
      ? { id: latest.id, kind: latest.kind, origin: latest.origin, arrivedAtMs: Date.parse(latest.arrived_at) }
      : null,
    stationArrivalsToday: arrivalsToday,
    inboundToStation: inbound,
    fuel: fuel.fuel,
    fuelCap: fuel.capacity,
    peopleGateOpen: state.peopleGateOpen,
    gate,
    alreadyWelcomedArrivalId: npcState.lastWelcomeJourneyId,
    exploredToday: npcState.lastExploreDay === today,
  };
}

// --- the answers: one plain-language answer per question kind ---

export function answerQuestion(kind: NpcQuestionKind, p: HarborPerception): string {
  switch (kind) {
    case "routes": {
      const open = TRAVEL_WORLD_KEYS.filter((w) => w !== p.currentWorld).filter(
        (w) => w !== "people" || p.peopleGateOpen,
      );
      const lines = open.map((w) => {
        const cost = w === "home" ? "free" : `a warp costs ${WARP_COST} fuel, a drift is free`;
        return `— ${worldName(w)}: ${cost}.`;
      });
      const peopleLine = p.peopleGateOpen
        ? ""
        : ` The People isn't open yet — it appears once your brain holds at least ${PEOPLE_GATE_MIN_PEOPLE} people with ${PEOPLE_GATE_MIN_MEMORIES_EACH} linked memories each, and one memory shared between two of them.`;
      return `From ${worldName(p.currentWorld)}, these routes are open:\n${lines.join("\n")}${peopleLine}`;
    }
    case "arrivals": {
      const latest = p.latestStationArrival
        ? `The last arrival here came from ${worldName(p.latestStationArrival.origin)} ${agoPlain(p.latestStationArrival.arrivedAtMs, p.nowMs)}.`
        : "No journey has arrived here yet.";
      const inbound =
        p.inboundToStation === 0
          ? "Nothing is on its way in right now."
          : p.inboundToStation === 1
            ? "One journey is on its way in."
            : `${p.inboundToStation} journeys are on their way in.`;
      return `${latest} ${inbound}`;
    }
    case "traffic": {
      // The lane count lives in the web scene (stationLayout) — the
      // server does not restate a number it doesn't own. Traffic here
      // is what the ledger knows: arrivals and inbound journeys.
      const arrivals =
        p.stationArrivalsToday === 0
          ? "No journeys have arrived here today."
          : p.stationArrivalsToday === 1
            ? "One journey has arrived here today."
            : `${p.stationArrivalsToday} journeys have arrived here today.`;
      const inbound =
        p.inboundToStation === 0
          ? "The lanes are flying their usual rounds, nothing inbound."
          : p.inboundToStation === 1
            ? "The lanes are flying their usual rounds, with one journey inbound."
            : `The lanes are flying their usual rounds, with ${p.inboundToStation} journeys inbound.`;
      return `${arrivals} ${inbound}`;
    }
    case "fuel": {
      const warp = p.fuel >= WARP_COST ? "enough for a warp" : "short of a warp";
      return `You hold ${Math.floor(p.fuel)} fuel of ${p.fuelCap} — ${warp}. A warp costs ${WARP_COST} fuel; drifting home is always free, and fuel comes back at ${FUEL_REGEN_PER_HOUR} an hour.`;
    }
    case "gate":
      return p.gate.missingPlain;
  }
}

/** The welcome the controller speaks when a journey arrives at its
 *  Station — its job-required speech (note §3: a harbor controller
 *  answering an arrival). */
export function welcomeFor(p: HarborPerception): string {
  const from = p.latestStationArrival ? ` from ${worldName(p.latestStationArrival.origin)}` : "";
  return `Welcome to the Great Station${from} — you're here. The routes from here are open whenever you're ready; I'll answer if you ask.`;
}

// --- the policy: what the controller decides to do on a tick ---

export type HarborDecision =
  | { act: "speak"; text: string; cause: string; welcomeJourneyId?: string }
  | { act: "explore"; cause: string }
  | { act: "wait"; cause: string };

/**
 * Decide, deterministically, from perception alone:
 * 1. A question gets an answer (speak).
 * 2. A fresh, unwelcomed arrival at the Station gets a welcome (speak).
 * 3. Once a day, the controller explores — looks for a way onward in
 *    its own world (explore). It finds no relic: none are placed in
 *    the app yet, so the honest outcome is "found nothing".
 * 4. Otherwise it waits — a logged non-act, never a gap.
 */
export function decide(p: HarborPerception, question: NpcQuestionKind | null): HarborDecision {
  if (question) {
    return { act: "speak", text: answerQuestion(question, p), cause: `You asked about ${question}.` };
  }
  const arrival = p.latestStationArrival;
  if (
    arrival &&
    arrival.id !== p.alreadyWelcomedArrivalId &&
    p.nowMs - arrival.arrivedAtMs <= WELCOME_WINDOW_MS
  ) {
    return {
      act: "speak",
      text: welcomeFor(p),
      cause: `A journey arrived here ${agoPlain(arrival.arrivedAtMs, p.nowMs)}.`,
      welcomeJourneyId: arrival.id,
    };
  }
  if (!p.exploredToday) {
    return {
      act: "explore",
      cause: "Its daily look for a way onward — it walks its own world the way a player would, and reports what it finds.",
    };
  }
  return { act: "wait", cause: "Nothing asked, no arrival to answer, its daily look already done — waiting is behaving correctly." };
}

/** The explore outcome when the hunt found nothing, in plain words.
 *  Relics I-5: explores now attempt real claims through the unified
 *  claim core (the loop logs a find itself when one lands); this
 *  string is the honest remainder — an empty pool, a courtesy
 *  deferral, or nothing left in its world that it lacks — and the
 *  controller says so instead of inventing a find. */
export function exploreOutcome(p: HarborPerception): string {
  if (p.gate.open) return "Looked for a way onward — the way is already open for me.";
  return "Looked for a way onward in my own world — found no relic. The way to Eternity stays unfound until I hold the Witness and two others.";
}
