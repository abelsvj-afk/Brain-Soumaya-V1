import type { FleetDefenseStatus } from "@brain/shared";

/**
 * The defense engine, server side (Wave 2, fleet defense) — a thin
 * re-export of the shared engine plus the real-defense outcome line.
 *
 * The board math lives in `@brain/shared` (`fleetDefenseEngine.ts`)
 * so the web's Scale practice round runs the SAME engine from
 * client-side ephemeral state, without a second engine and without
 * a server route. Practice never reaches this file: it has no
 * release, no codex line, and nothing to map an outcome onto.
 * Everything re-exported here behaves exactly as before the move;
 * `advanceTick`'s `practice` flag defaults off.
 */
export {
  advanceTick,
  autonomousLane,
  validLane,
  type TickAction,
  type TickResult,
} from "@brain/shared";

/** The outcome line recorded when a REAL defense resolves — the
 *  codex line on a win, the quiet "not yet" on a loss. Both name the
 *  release in plain words; neither names a penalty, because there
 *  is none. Practice rounds never use this: a practice win clears
 *  nothing, so there is no codex line to record. */
export function outcomeLine(status: FleetDefenseStatus, label: string): string {
  if (status === "won") {
    return `On this day, the fleet dispersed and the charge was let go — ${label}.`;
  }
  return `The fleet dispersed before the charge was cleared — ${label} stays, and the defense can be tried again later. Nothing was lost.`;
}
