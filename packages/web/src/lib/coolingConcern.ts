/**
 * Mass-cooling concern signal (IM-139) — derives Soumaya's concerned reaction
 * from REAL cooling data: a memory is cooling when its entropy is at/above
 * the shared COOLING_ENTROPY threshold (the same signal the ❄️ badge, the
 * Browse cooling filter and the Aura beacons use). Nothing here is invented:
 * no cooling memories → no concern, ever.
 *
 * "Mass" cooling = a real crowd, not one neglected note: at least
 * MASS_COOLING_MIN_COUNT memories cooling AND at least MASS_COOLING_MIN_FRAC
 * of all memories. Both bars must be crossed — a tiny galaxy with 2 of 3
 * memories cold is a nudge to tend, not a mass event.
 */
import { COOLING_ENTROPY } from "@brain/shared";

export const MASS_COOLING_MIN_COUNT = 4;
export const MASS_COOLING_MIN_FRAC = 0.3;

export interface CoolingConcern {
  coolingCount: number;
  total: number;
  coolingFrac: number;
  massCooling: boolean;
  /** Her line, in her voice, carrying the real numbers. Null when not mass cooling. */
  message: string | null;
}

export function deriveCoolingConcern(
  nodes: readonly { kind?: string; entropy?: number }[],
): CoolingConcern {
  const memories = nodes.filter((n) => n.kind !== "action");
  const total = memories.length;
  const coolingCount = memories.filter((n) => (n.entropy ?? 0) >= COOLING_ENTROPY).length;
  const coolingFrac = total > 0 ? coolingCount / total : 0;
  const massCooling = coolingCount >= MASS_COOLING_MIN_COUNT && coolingFrac >= MASS_COOLING_MIN_FRAC;
  return {
    coolingCount,
    total,
    coolingFrac,
    massCooling,
    message: massCooling
      ? `I'm worried — ${coolingCount} of your memories are cooling. Tend one and they'll warm back up.`
      : null,
  };
}

/** Reaction lines for new-connection events (moved from App's toast copy so
 *  the in-world speech bubble and the toast speak with one voice). */
export function connectionReaction(linkCount: number): string | null {
  if (linkCount >= 3) return `Oh, this one lights up — it ties into ${linkCount} of your memories.`;
  if (linkCount === 2) return "I felt two threads connect to this.";
  if (linkCount === 1) return "There — a new thread linked up.";
  return null;
}
