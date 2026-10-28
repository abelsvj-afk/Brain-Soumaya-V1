import {
  FLEET_DEFENSE_LANES,
  type FleetDefenseInvader,
  type FleetDefenseStatus,
  type FleetDefenseTickMode,
} from "./fleetDefense.js";

/**
 * The defense engine — pure functions over the board, no database,
 * no clock. Shared so BOTH sides run the same board math: the
 * server's real defense and the web's Scale practice round (which
 * is ephemeral client state — it never touches the server, a
 * release, or a brain record).
 *
 * The board is three lanes; an invader starts a few steps out from
 * the charge and advances one step per tick. One tick is one round
 * of defensive fire (one lane) followed by the invaders' advance —
 * the Space Invaders shape at its simplest: incoming ships,
 * defensive fire, positions that matter (fleet defense design §4).
 *
 * The rules, stated plainly:
 * - Fire disperses the NEAREST live invader in the chosen lane.
 *   A lane with no live invader is a shot flown wide — the tick
 *   still counts and the invaders still advance.
 * - Soumaya on her own fires at the lane whose live invader is
 *   closest to the charge (ties: the lowest lane). Deterministic —
 *   the same board always plays the same autonomous round, so the
 *   autonomous mode is testable and never a surprise.
 * - An invader that reaches distance 0 got through: the defense is
 *   lost. The fleet disperses, the charge stays, nothing is lost.
 * - Every invader dispersed: the defense is won.
 * - Nothing here touches the brain, a release, or a log. The
 *   server's service layer (defense.ts) maps the outcome onto the
 *   release for a REAL defense; a practice round maps its outcome
 *   onto nothing at all.
 */

export interface TickAction {
  mode: FleetDefenseTickMode;
  /** The lane the player fires down, 1–3. Required for a helm tick;
   *  ignored for an autonomous tick (Soumaya picks her own lane). */
  lane?: number;
}

export interface TickResult {
  invaders: FleetDefenseInvader[];
  status: FleetDefenseStatus;
  /** The lane fired down this tick (Soumaya's pick, or the helm's). */
  laneFired: number;
  /** The tick in one plain sentence — what happened. */
  line: string;
}

/** The lane Soumaya fires down on her own: the closest live
 *  invader to the charge; ties break to the lowest lane. */
export function autonomousLane(invaders: readonly FleetDefenseInvader[]): number {
  let bestLane = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const inv of invaders) {
    if (inv.dispersed) continue;
    if (inv.distance < bestDistance || (inv.distance === bestDistance && inv.lane < bestLane)) {
      bestDistance = inv.distance;
      bestLane = inv.lane;
    }
  }
  return bestLane;
}

/**
 * One tick of the defense. Fire first, then the surviving invaders
 * advance one step. Returns the new board, the defense status, and
 * the plain-words line for the round.
 *
 * `practice` only rewords the outcome lines: a real defense clears
 * the charge on a win and disperses the fleet on a loss, while a
 * practice round disperses a practice fleet and clears nothing.
 * Default off, so the server's real-defense lines are
 * byte-identical to before the move.
 */
export function advanceTick(
  invaders: readonly FleetDefenseInvader[],
  action: TickAction,
  opts?: { practice?: boolean },
): TickResult {
  const lane = action.mode === "autonomous" ? autonomousLane(invaders) : (action.lane ?? 1);
  const who = action.mode === "autonomous" ? "Soumaya" : "You";

  // Fire: disperse the nearest live invader in the chosen lane.
  const next: FleetDefenseInvader[] = invaders.map((i) => ({ ...i }));
  let hit: FleetDefenseInvader | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const inv of next) {
    if (inv.dispersed || inv.lane !== lane) continue;
    if (inv.distance < nearest) {
      nearest = inv.distance;
      hit = inv;
    }
  }
  if (hit) hit.dispersed = true;

  // Advance: every live invader closes one step on the charge.
  let breached: FleetDefenseInvader | null = null;
  for (const inv of next) {
    if (inv.dispersed) continue;
    inv.distance -= 1;
    if (inv.distance <= 0 && !breached) breached = inv;
  }

  const allDispersed = next.every((i) => i.dispersed);
  const status: FleetDefenseStatus = allDispersed ? "won" : breached ? "lost" : "active";

  const laneWord = `lane ${lane}`;
  let line: string;
  if (hit && status === "won") {
    line = opts?.practice
      ? `${who} fired down ${laneWord} and dispersed the last invader — the ${hit.shipName}. The practice fleet is dispersed — nothing was cleared.`
      : `${who} fired down ${laneWord} and dispersed the last invader — the ${hit.shipName}. The charge is cleared.`;
  } else if (hit && breached) {
    line = opts?.practice
      ? `${who} fired down ${laneWord} and dispersed the ${hit.shipName}, but the ${breached.shipName} reached the charge. The practice fleet disperses — nothing is lost.`
      : `${who} fired down ${laneWord} and dispersed the ${hit.shipName}, but the ${breached.shipName} reached the charge. The fleet disperses — nothing is lost.`;
  } else if (hit) {
    line = `${who} fired down ${laneWord} and dispersed the ${hit.shipName}.`;
  } else if (breached) {
    line = opts?.practice
      ? `${who} fired down ${laneWord} — the shot flew wide — and the ${breached.shipName} reached the charge. The practice fleet disperses — nothing is lost.`
      : `${who} fired down ${laneWord} — the shot flew wide — and the ${breached.shipName} reached the charge. The fleet disperses — nothing is lost.`;
  } else {
    line = `${who} fired down ${laneWord} — the shot flew wide. The fleet closes in.`;
  }
  return { invaders: next, status, laneFired: lane, line };
}

/** Guards the helm lane: 1–3, nothing else is a lane. */
export function validLane(lane: unknown): lane is number {
  return (
    typeof lane === "number" &&
    Number.isInteger(lane) &&
    lane >= 1 &&
    lane <= FLEET_DEFENSE_LANES
  );
}
