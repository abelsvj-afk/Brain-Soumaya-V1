import { randomUUID } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { EconomyRepo } from "../economy.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import {
  MISSION_DESTINATIONS,
  MISSION_MAX_ACTIVE,
  MISSION_MAX_DURATION_MINUTES,
  MISSION_MAX_FLEET_SIZE,
  MISSION_MIN_DURATION_MINUTES,
  MISSION_MIN_FLEET_SIZE,
  MISSION_ORIGIN,
  missionDispatchCost,
  type Mission,
  type MissionLogEntry,
  type MissionsOverview,
  type MissionKind,
} from "@brain/shared";
import { MissionRepo, missionPhaseTimes, shipsForDispatch, type MissionRow } from "./repo.js";
import { buildScoutingReport } from "./reports.js";

/**
 * Fleet missions — the loop.
 *
 * A mission follows the travel ledger's shape with a fleet pilot:
 * dispatch (propose-for-yes — the dispatch tap IS the approve) →
 * outbound → arrived (the work: arrive, or report) → returning →
 * completed. Failure and recall are terminal too, and cost NOTHING
 * (AD2) — no fuel (missions are free, AD1), no cargo, no progress.
 * A failed mission returns empty-handed; a recalled one returns
 * without its outcome. Both say so in plain words, never silently.
 *
 * Everything is LAZY, like travel and fuel regen: the settle runs
 * when the client reads the overview, never on a timer. There is no
 * model call anywhere — reports are assembled from verified facts,
 * outcomes are deterministic. The server owns every outcome; the
 * client renders what the server returns.
 *
 * The fence, in one place, before any dispatch:
 * - the kind must be one of the two that ship (journey, scouting);
 * - the destination must be a mission destination, and never home
 *   (the fleet is based at home);
 * - People needs its gate open, at dispatch AND at arrival;
 * - a stopped fleet dispatches nothing;
 * - no mission ever writes to a brain: the only writes are the
 *   mission row and the log line.
 */

export class MissionError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_MISSION"
      | "INVALID_CLIENT_KEY"
      | "INVALID_KIND"
      | "UNKNOWN_DESTINATION"
      | "INVALID_DURATION"
      | "INVALID_FLEET_SIZE"
      | "FLEET_STOPPED"
      | "TOO_MANY_ACTIVE"
      | "DESTINATION_BUSY"
      | "PEOPLE_GATE_CLOSED"
      | "MISSION_NOT_ACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "MissionError";
  }
}

const WORLD_NAMES: Record<string, string> = {
  home: "Home",
  "great-station": "the Great Station",
  people: "the People",
  "quiet-archive": "Quiet/Archive",
  scale: "Scale",
};

function worldName(key: string): string {
  return WORLD_NAMES[key] ?? key;
}

export interface DispatchInput {
  clientKey: string;
  kind: MissionKind;
  destination: string;
  durationMinutes: number;
  fleetSize: number;
}

function validateDispatch(input: DispatchInput): void {
  if (!input.clientKey) {
    throw new MissionError("INVALID_CLIENT_KEY", "A dispatch needs a client key.");
  }
  if (input.kind !== "journey" && input.kind !== "scouting") {
    throw new MissionError("INVALID_KIND", "A mission journeys or scouts — nothing else flies yet.");
  }
  if (!MISSION_DESTINATIONS.includes(input.destination) || input.destination === MISSION_ORIGIN) {
    throw new MissionError(
      "UNKNOWN_DESTINATION",
      "The fleet flies to the Great Station, Scale, the People, and Quiet/Archive — the fleet flies from home to a world, never to home itself, and never to a private world.",
    );
  }
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < MISSION_MIN_DURATION_MINUTES ||
    input.durationMinutes > MISSION_MAX_DURATION_MINUTES
  ) {
    throw new MissionError(
      "INVALID_DURATION",
      `A voyage lasts ${MISSION_MIN_DURATION_MINUTES} to ${MISSION_MAX_DURATION_MINUTES} minutes — short voyages, not days.`,
    );
  }
  if (!Number.isInteger(input.fleetSize) || input.fleetSize < MISSION_MIN_FLEET_SIZE || input.fleetSize > MISSION_MAX_FLEET_SIZE) {
    throw new MissionError(
      "INVALID_FLEET_SIZE",
      `A mission flies ${MISSION_MIN_FLEET_SIZE} to ${MISSION_MAX_FLEET_SIZE} ships.`,
    );
  }
}

/**
 * Dispatch a mission: the approve step. Validates, creates the
 * mission outbound, and logs it — all in ONE transaction. A retry
 * with the same client key returns the original mission, whatever
 * parameters the retry carries (the travel F-01 replay contract).
 * Missions are free (AD1): no fuel is debited, and no balance can
 * refuse a dispatch.
 */
export function dispatchMission(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: DispatchInput,
  nowMs: number = Date.now(),
): Mission {
  validateDispatch(input);
  const run = h.sqlite.transaction((): Mission => {
    const repo = new MissionRepo(h, spaceId);
    const existing = repo.missionByClientKey(input.clientKey);
    if (existing) return repo.toMission(existing);
    if (repo.fleetStopped()) {
      throw new MissionError("FLEET_STOPPED", "The fleet is stopped — it dispatches nothing while stopped.");
    }
    if (input.destination === "people" && !new TravelRepo(h, spaceId).peopleGateOpen()) {
      throw new MissionError(
        "PEOPLE_GATE_CLOSED",
        "The People isn't open yet — the fleet can't fly there until the gate opens.",
      );
    }
    if (repo.activeCount() >= MISSION_MAX_ACTIVE) {
      throw new MissionError(
        "TOO_MANY_ACTIVE",
        `Only ${MISSION_MAX_ACTIVE} missions fly at once — wait for one to come home.`,
      );
    }
    if (repo.activeTo(input.destination) > 0) {
      throw new MissionError(
        "DESTINATION_BUSY",
        `A fleet is already out to ${worldName(input.destination)} — one mission per world at a time.`,
      );
    }
    const cost = missionDispatchCost(input.fleetSize, input.durationMinutes);
    const ships = shipsForDispatch(repo.missionCount(), input.fleetSize);
    const id = randomUUID();
    const createdAt = new Date(nowMs).toISOString();
    const row = repo.insertMission({
      id,
      clientKey: input.clientKey,
      kind: input.kind,
      destination: input.destination,
      origin: MISSION_ORIGIN,
      fleetSize: input.fleetSize,
      ships,
      durationMinutes: input.durationMinutes,
      fuelCost: cost,
      state: "outbound",
      createdAt,
      departedAt: createdAt,
      completedAt: null,
      outcome: null,
      report: null,
    });
    const shipWords = ships.length === 1 ? ships[0]! : `${ships.slice(0, -1).join(", ")} and ${ships[ships.length - 1]!}`;
    const kindWords = input.kind === "journey" ? "a journey" : "a scouting run";
    repo.appendLog(
      id,
      "dispatch",
      `Dispatched ${shipWords} to ${worldName(input.destination)} — ${kindWords}, ${input.durationMinutes} minutes. Free.`,
      "You sent the fleet — nothing dispatches without your tap.",
      nowMs,
    );
    return repo.toMission(row);
  });
  return run.immediate();
}

/** The work a mission does on arrival, by kind. Runs inside the
 *  arrival transition's transaction, after this call has claimed
 *  the transition — so a concurrent settle can never double-work it. */
function doArrivalWork(h: DbHandle, spaceId: string, row: MissionRow, nowMs: number): void {
  const repo = new MissionRepo(h, spaceId);
  const name = worldName(row.destination);
  if (row.kind === "scouting") {
    const facts = repo.scoutFacts(row.destination, nowMs);
    const report = buildScoutingReport(row.destination, facts, nowMs);
    repo.setOutcome(row.id, `Reported from ${name}.`, report);
    // The report itself is a log line (AD5): the fleet's words, kept.
    repo.appendLog(row.id, "report", report, "The fleet looked and wrote down what it saw — nothing more.", nowMs);
  } else {
    // A journey's arrival line is the settle's "arrive" log below —
    // one plain-words arrival line, not two.
    repo.setOutcome(row.id, `Arrived at ${name}.`);
  }
}

/**
 * Advance every active mission to where `nowMs` puts it (lazy settle,
 * the travel pattern). Each transition is claimed with a guarded
 * update — the call that wins the claim does the work; a concurrent
 * settle observes the committed state and never re-works it.
 */
export function settleMissions(h: DbHandle, spaceId: string = DEFAULT_SPACE, nowMs: number = Date.now()): void {
  const repo = new MissionRepo(h, spaceId);
  for (const row of repo.activeMissions()) {
    const departedMs = row.departedAt ? Date.parse(row.departedAt) : Number.NaN;
    if (!Number.isFinite(departedMs)) continue;
    const times = missionPhaseTimes(departedMs, row.durationMinutes);
    const run = h.sqlite.transaction(() => {
      const fresh = repo.missionById(row.id);
      if (!fresh) return;
      if (fresh.state === "outbound" && nowMs >= times.arriveAtMs) {
        // The People gate can close mid-voyage: the fleet turns back
        // and the mission fails — and failure costs NOTHING (AD2).
        // No fuel was spent (missions are free), no cargo, no
        // progress: the fleet simply returns empty-handed.
        if (fresh.destination === "people" && !new TravelRepo(h, spaceId).peopleGateOpen()) {
          if (!repo.claimTransition(fresh.id, "outbound", "failed")) return;
          repo.setOutcome(
            fresh.id,
            "The way to the People closed while the fleet was out — the fleet turned back and returned empty-handed.",
          );
          repo.setCompleted(fresh.id, nowMs);
          repo.appendLog(
            fresh.id,
            "fail",
            "Turned back — the way to the People closed while the fleet was out, and the fleet returned empty-handed.",
            "The gate is a real constraint: a closed way is a closed way, and the fleet does not fly through it.",
            nowMs,
          );
          return;
        }
        if (!repo.claimTransition(fresh.id, "outbound", "arrived")) return;
        doArrivalWork(h, spaceId, fresh, nowMs);
        repo.appendLog(fresh.id, "arrive", `Arrived at ${worldName(fresh.destination)}.`, "The fleet flew the outbound leg and made landfall.", nowMs);
      }
      const refetched = repo.missionById(row.id);
      if (!refetched) return;
      if (refetched.state === "arrived" && nowMs >= times.departBackAtMs) {
        if (!repo.claimTransition(refetched.id, "arrived", "returning")) return;
        repo.appendLog(refetched.id, "return", "Turned for home.", "The work is done; the fleet sails the return leg.", nowMs);
      }
      const again = repo.missionById(row.id);
      if (!again) return;
      if (again.state === "returning" && nowMs >= times.completeAtMs) {
        if (!repo.claimTransition(again.id, "returning", "completed")) return;
        repo.setCompleted(again.id, nowMs);
        repo.appendLog(again.id, "complete", "Returned home.", "The voyage is over — out, work, and back, on the time set at dispatch.", nowMs);
      }
    });
    run.immediate();
  }
}

/** Recall a mission in flight: the fleet turns back early. The
 *  mission costs nothing (AD2) — it returns without its outcome. A
 *  terminal mission is returned as-is, never errored. */
export function recallMission(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  missionId: string,
  nowMs: number = Date.now(),
): Mission {
  const repo = new MissionRepo(h, spaceId);
  const run = h.sqlite.transaction((): Mission => {
    const row = repo.missionById(missionId);
    if (!row) throw new MissionError("UNKNOWN_MISSION", "No mission with that id exists.");
    if (row.state === "completed" || row.state === "failed" || row.state === "recalled") {
      return repo.toMission(row);
    }
    if (!repo.claimTransition(row.id, row.state, "recalled")) {
      return repo.toMission(repo.missionById(missionId)!);
    }
    repo.appendLog(row.id, "recall", "Recalled — the fleet turned back and returned without its outcome.", "You called the fleet back; nothing was spent, nothing was lost.", nowMs);
    repo.setCompleted(row.id, nowMs);
    repo.setOutcome(row.id, "Recalled — the fleet turned back early and returned without its outcome.");
    return repo.toMission(repo.missionById(missionId)!);
  });
  return run.immediate();
}

/** Stop the fleet: no new dispatch while stopped. Active missions
 *  sail home on schedule — nothing is stranded. */
export function stopFleet(h: DbHandle, spaceId: string = DEFAULT_SPACE, nowMs: number = Date.now()): void {
  const repo = new MissionRepo(h, spaceId);
  const run = h.sqlite.transaction(() => {
    repo.setFleetStopped(true);
    repo.appendLog(null, "stop", "The fleet was stopped.", "You stopped it — a stopped fleet dispatches nothing.", nowMs);
  });
  run.immediate();
}

/** Resume the fleet. The resume is logged the same way. */
export function resumeFleet(h: DbHandle, spaceId: string = DEFAULT_SPACE, nowMs: number = Date.now()): void {
  const repo = new MissionRepo(h, spaceId);
  const run = h.sqlite.transaction(() => {
    repo.setFleetStopped(false);
    repo.appendLog(null, "resume", "The fleet was started again.", "You started it again.", nowMs);
  });
  run.immediate();
}

/** Everything the Fleets panel needs, in one read — after a lazy
 *  settle, so what it shows is current, never stale. */
export function getMissionsOverview(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  nowMs: number = Date.now(),
): MissionsOverview {
  settleMissions(h, spaceId, nowMs);
  const repo = new MissionRepo(h, spaceId);
  const fuel = new EconomyRepo(h, spaceId).toFuel();
  return {
    missions: repo.recentMissions(20).map((r) => repo.toMission(r)),
    fleetStopped: repo.fleetStopped(),
    fuel: { fuel: fuel.fuel, capacity: fuel.capacity },
    log: repo.recentLog(30),
  };
}

export type { MissionLogEntry };
