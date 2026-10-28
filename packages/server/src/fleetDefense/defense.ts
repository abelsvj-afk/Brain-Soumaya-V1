import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import {
  FLEET_DEFENSE_INVADERS_BY_SIZE,
  FLEET_DEFENSE_RELEASE_KINDS,
  FLEET_DEFENSE_RELEASE_SIZES,
  FLEET_DEFENSE_SIZE_LABELS,
  type FleetDefenseOverview,
  type FleetDefenseRelease,
  type FleetDefenseState,
  type FleetDefenseTickMode,
} from "@brain/shared";
import { FleetDefenseRepo, type OfferReleaseInput } from "./repo.js";
import { advanceTick, outcomeLine, validLane } from "./engine.js";

/**
 * The defense service (Wave 2, fleet defense) — the only place
 * releases are offered, fleets summoned, and ticks played. The
 * engine owns the board; this layer owns the rules around it:
 *
 * - a defense can only ever start from a user-marked release (no
 *   release, no fleet — C1);
 * - one active defense per release;
 * - a helm tick names a real lane; an autonomous tick names none;
 * - winning clears the release and writes the codex line to the
 *   log; losing returns the release to `offered` — the charge
 *   stays, nothing is lost, every brain fact unchanged;
 * - the linked brain record is never written, never deleted, never
 *   touched at all. The only writes are the release row, the
 *   defense row, and the log — all worlds-layer, all in one
 *   transaction per action, so a defense is never half-recorded.
 *
 * Ticks are LAZY: the defense advances when the client asks for a
 * tick, never on a timer. The server holds the board; the client
 * renders it and decides nothing.
 */

export class FleetDefenseError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_RELEASE"
      | "UNKNOWN_DEFENSE"
      | "RELEASE_NOT_OFFERED"
      | "DEFENSE_ALREADY_ACTIVE"
      | "DEFENSE_NOT_ACTIVE"
      | "INVALID_INPUT"
      | "NODE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "FleetDefenseError";
  }
}

const MAX_LABEL_LENGTH = 200;

/** Validate an offer before it is stored. The label is the user's
 *  own plain words for what they are letting go of — it must be
 *  present, because a release about nothing cannot be defended. */
export function validateOffer(input: unknown): OfferReleaseInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !(FLEET_DEFENSE_RELEASE_KINDS as readonly string[]).includes(kind)) {
    throw new FleetDefenseError(
      "INVALID_INPUT",
      "Say what kind of thing this is — an emotion, an archived memory, or a debt.",
    );
  }
  const size = o.size;
  if (typeof size !== "string" || !(FLEET_DEFENSE_RELEASE_SIZES as readonly string[]).includes(size)) {
    throw new FleetDefenseError(
      "INVALID_INPUT",
      "Say how big this feels — small, steady, or big.",
    );
  }
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!label) {
    throw new FleetDefenseError(
      "INVALID_INPUT",
      "Name what you are letting go of, in your own words.",
    );
  }
  if (label.length > MAX_LABEL_LENGTH) {
    throw new FleetDefenseError(
      "INVALID_INPUT",
      `Keep the name under ${MAX_LABEL_LENGTH} characters.`,
    );
  }
  let nodeId: number | null = null;
  if (o.nodeId !== undefined && o.nodeId !== null) {
    if (typeof o.nodeId !== "number" || !Number.isInteger(o.nodeId) || o.nodeId <= 0) {
      throw new FleetDefenseError("INVALID_INPUT", "That memory link isn't a real memory.");
    }
    nodeId = o.nodeId;
  }
  return { kind: kind as OfferReleaseInput["kind"], size: size as OfferReleaseInput["size"], label, nodeId };
}

/** Offer a release — the explicit user marking a defense starts
 *  from. The fleet is NOT summoned here; summoning is the separate
 *  start step, so offering and defending stay two deliberate acts. */
export function offerRelease(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: unknown,
  nowMs: number = Date.now(),
): FleetDefenseRelease {
  const offer = validateOffer(input);
  const repo = new FleetDefenseRepo(h, spaceId);
  if (offer.nodeId !== null && !repo.nodeExists(offer.nodeId)) {
    throw new FleetDefenseError("NODE_NOT_FOUND", "That memory isn't in this brain.");
  }
  const run = h.sqlite.transaction((): FleetDefenseRelease => {
    const release = repo.offerRelease(offer, nowMs);
    repo.appendLog(
      "offered",
      `Offered for release — ${offer.label} (${offer.size}).`,
      { releaseId: release.id },
      nowMs,
    );
    return release;
  });
  return run.immediate();
}

/** Summon the fleet for an offered release: one wave, composed from
 *  the release size, one active defense. The fleet size is shown in
 *  plain words before the defense starts — the start response
 *  carries the composed wave, so the panel never guesses. */
export function startDefense(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  releaseId: number,
  nowMs: number = Date.now(),
): FleetDefenseState {
  const repo = new FleetDefenseRepo(h, spaceId);
  const release = repo.getRelease(releaseId);
  if (!release) {
    throw new FleetDefenseError("UNKNOWN_RELEASE", "That release isn't here.");
  }
  if (release.status !== "offered") {
    throw new FleetDefenseError(
      "RELEASE_NOT_OFFERED",
      release.status === "cleared"
        ? "That charge is already cleared — there is nothing left to defend."
        : "That release is already being defended.",
    );
  }
  if (repo.activeDefenseForRelease(releaseId)) {
    throw new FleetDefenseError(
      "DEFENSE_ALREADY_ACTIVE",
      "That release already has a fleet to face.",
    );
  }
  const run = h.sqlite.transaction((): FleetDefenseState => {
    repo.setReleaseStatus(releaseId, "defending", nowMs);
    const defense = repo.createDefense(releaseId, release.size, nowMs);
    repo.appendLog(
      "summoned",
      `A fleet of ${FLEET_DEFENSE_INVADERS_BY_SIZE[release.size]} ships came for ${release.label} — ${FLEET_DEFENSE_SIZE_LABELS[release.size]}. Defending your own galaxy is free.`,
      { defenseId: defense.id, releaseId },
      nowMs,
    );
    return defense;
  });
  return run.immediate();
}

/**
 * Play one tick of a defense. Autonomous and helm switch freely,
 * mid-defense, one tick at a time — neither mode is privileged
 * (design §4, C3). On resolution the release is settled in the
 * same transaction as the defense row: won → cleared with the
 * codex line; lost → offered again, charge intact, nothing lost.
 */
export function tickDefense(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  defenseId: number,
  action: { mode: FleetDefenseTickMode; lane?: unknown },
  nowMs: number = Date.now(),
): FleetDefenseState {
  if (action.mode !== "autonomous" && action.mode !== "helm") {
    throw new FleetDefenseError(
      "INVALID_INPUT",
      "Say who flies this round — Soumaya on her own, or you at the helm.",
    );
  }
  if (action.mode === "helm" && !validLane(action.lane)) {
    throw new FleetDefenseError("INVALID_INPUT", "At the helm, fire down a real lane — 1, 2, or 3.");
  }
  const repo = new FleetDefenseRepo(h, spaceId);
  const defense = repo.getDefense(defenseId);
  if (!defense) {
    throw new FleetDefenseError("UNKNOWN_DEFENSE", "That defense isn't here.");
  }
  if (defense.status !== "active") {
    throw new FleetDefenseError(
      "DEFENSE_NOT_ACTIVE",
      defense.status === "won"
        ? "That defense is already won — the charge is cleared."
        : "That defense already ended — the fleet dispersed. Offer the charge again when you like.",
    );
  }
  const run = h.sqlite.transaction((): FleetDefenseState => {
    const result = advanceTick(defense.invaders, {
      mode: action.mode,
      lane: action.mode === "helm" ? (action.lane as number) : undefined,
    });
    const next: FleetDefenseState = {
      ...defense,
      status: result.status,
      invaders: result.invaders,
      tickCount: defense.tickCount + 1,
      lastMode: action.mode,
      lastLine: result.line,
      outcomeLine: result.status === "active" ? null : outcomeLine(result.status, currentLabel(repo, defense)),
      updatedAt: new Date(nowMs).toISOString(),
    };
    repo.saveDefense(next, nowMs);
    repo.appendLog("tick", result.line, { defenseId, releaseId: defense.releaseId }, nowMs);
    if (result.status === "won") {
      repo.setReleaseStatus(defense.releaseId, "cleared", nowMs);
      repo.appendLog("won", next.outcomeLine ?? result.line, { defenseId, releaseId: defense.releaseId }, nowMs);
    } else if (result.status === "lost") {
      repo.setReleaseStatus(defense.releaseId, "offered", nowMs);
      repo.appendLog("lost", next.outcomeLine ?? result.line, { defenseId, releaseId: defense.releaseId }, nowMs);
    }
    return next;
  });
  return run.immediate();
}

function currentLabel(repo: FleetDefenseRepo, defense: FleetDefenseState): string {
  return repo.getRelease(defense.releaseId)?.label ?? "the charge";
}

export function getDefense(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  defenseId: number,
): FleetDefenseState {
  const defense = new FleetDefenseRepo(h, spaceId).getDefense(defenseId);
  if (!defense) {
    throw new FleetDefenseError("UNKNOWN_DEFENSE", "That defense isn't here.");
  }
  return defense;
}

/** Everything the panel needs in one read. */
export function getOverview(h: DbHandle, spaceId: string = DEFAULT_SPACE): FleetDefenseOverview {
  const repo = new FleetDefenseRepo(h, spaceId);
  const activeDefense = repo.activeDefense();
  const activeRelease = activeDefense ? repo.getRelease(activeDefense.releaseId) : null;
  return {
    releases: repo.listReleases(),
    activeDefense,
    activeRelease,
    history: repo.history(),
    recentLog: repo.recentLog(),
  };
}
