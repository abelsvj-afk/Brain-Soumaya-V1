import { WARP_COST, type CaptainDefinition, type CaptainWorld } from "@brain/shared";
import { rngFor } from "./seed.js";

/**
 * The captain decider (NPC-Player Layer L1, design §4): utility
 * scoring over five drives, computed at decision points only —
 * never per frame, never on a timer.
 *
 * The decider sits behind the `CaptainDecider` interface, exactly
 * as the harbor controller's policy sits behind `decide()` in
 * npcs/harbor.ts. That seam is a SETTLED requirement: the
 * civilization addendum's D-2 fork was ruled mid-build
 * (2026-10-31 ~20:42 EDT — the synthesis adopted: an LLM proposes
 * intentions for the named cohort behind this same fence; the far
 * register stays deterministic). An intention-proposer can take
 * this implementation's place behind the same fence without
 * redesign — but it is NOT built in L1: the provider was settled
 * later the same evening (Gemini, the owner's own key, design
 * §13.8), yet the key arrives only via a secure secret flow at a
 * future build and is unavailable here, so L1's implementation is
 * the deterministic utility decider the synthesis keeps. Same
 * perception in, same decision out, and the winning considerations
 * are returned as the plain-language cause the log records.
 *
 * Scoring (design §4.2): each candidate act is scored by its
 * considerations — a response curve over a 0..1 input, raised to a
 * trait-weighted exponent — aggregated MULTIPLICATIVELY, so a hard
 * zero (fuel below a warp's price) kills an act outright. Drift is
 * always available, so a captain is never stranded.
 *
 * P1: perception carries the DESTINATION SET for the captain's
 * current world (the D-1 travel set minus here) plus the open leg,
 * if any — L1's binary `otherWorld` is deleted (spec §5.1, C6). A
 * travel decision names a destination from that set or it does not
 * happen; the engine owns the facts and turns the decision into a
 * leg (spec §5.2).
 */

export interface CaptainPerception {
  /** The step being decided (seeded determinism keys off its start). */
  stepStartMs: number;
  /** The world the captain is in. */
  world: CaptainWorld;
  /** The travel-set destinations reachable from here (every
   *  travel-open world except the current one), in travel-set
   *  order. A travel decision must name one of these. */
  destinations: readonly CaptainWorld[];
  /** Plain names for the destinations, keyed by world key. */
  destinationNames: Readonly<Record<string, string>>;
  /** The open leg, when one is open (the decider is only consulted
   *  inside live sessions in P1, so this is normally null — it is
   *  carried so the perception shape is complete for later
   *  increments). */
  openLeg: { to: CaptainWorld; kind: "warp" | "drift" | "home" } | null;
  /** 0 at session start, 1 at the planned end. */
  sessionAgeRatio: number;
  /** Whole advance steps remaining in this session, including this one. */
  stepsLeftInSession: number;
  fuel: number;
  /** The visitor is in the captain's world, not in transit. */
  playerPresent: boolean;
  /** The captain has already greeted this player visit. */
  greetedThisVisit: boolean;
  /** Drive inputs (0..1), computed by the engine's perception. */
  curiosity: number;
  sociability: number;
}

export type CaptainDecision =
  | { act: "greet"; cause: string }
  | { act: "travel"; travelKind: "warp" | "drift"; toWorld: CaptainWorld; cause: string }
  | { act: "depart"; cause: string }
  | { act: "wait"; cause: string };

export interface CaptainDecider {
  decide(def: CaptainDefinition, p: CaptainPerception): CaptainDecision;
}

// --- response curves (design §4.2) ---

const linear = (x: number): number => Math.min(1, Math.max(0, x));
const logistic = (x: number): number => 1 / (1 + Math.exp(-10 * (linear(x) - 0.5)));
const quadratic = (x: number): number => linear(x) * linear(x);

interface Consideration {
  value: number;
  weight: number;
  plain: string;
}

function score(considerations: readonly Consideration[], jitter: number): number {
  let s = 1;
  for (const c of considerations) {
    if (c.value <= 0) return 0; // a hard zero kills the act
    s *= Math.pow(c.value, c.weight);
  }
  return s * (1 + jitter * 0.015);
}

/** The two considerations that most carried a winning act, as the
 *  plain-language cause (highest weighted contribution first). */
function causeOf(considerations: readonly Consideration[], fallback: string): string {
  const ranked = [...considerations]
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .slice(0, 2)
    .map((c) => c.plain);
  return ranked.length > 0 ? `${ranked.join("; ")}.` : fallback;
}

const has = (def: CaptainDefinition, trait: "Sociable" | "Restless" | "Cautious"): boolean =>
  (def.traits as readonly string[]).includes(trait);

export const utilityDecider: CaptainDecider = {
  decide(def, p) {
    const rng = rngFor(def.id, "decide", p.stepStartMs);
    const rest = quadratic(p.sessionAgeRatio);
    // Duty and ambition have no L1 instruments (commissions are L2,
    // the economy L3) — they enter honestly as mild constants: the
    // captain's duty in L1/P1 is to finish the visit underway.
    const duty = 0.5;

    const candidates: { decision: CaptainDecision; value: number }[] = [];

    const addWait = () => {
      const value = 0.3 + 0.35 * rest;
      candidates.push({
        decision: {
          act: "wait",
          cause:
            rest > 0.5
              ? "The visit had run long; staying docked and quiet was the honest choice."
              : "Nothing pulled harder than staying put — waiting is behaving correctly.",
        },
        value,
      });
    };

    if (p.playerPresent && !p.greetedThisVisit) {
      const considerations: Consideration[] = [
        {
          value: logistic(p.sociability),
          weight: 1.5 * (has(def, "Sociable") ? 1.3 : 1),
          plain: "sociability ran high — you were here and no hello had been said this visit",
        },
        { value: 1 - rest, weight: 0.5, plain: "rest was still low" },
      ];
      candidates.push({
        decision: { act: "greet", cause: causeOf(considerations, "Saying hello was the sociable thing to do.") },
        value: score(considerations, rng()),
      });
    }

    if (p.stepsLeftInSession >= 1 && p.destinations.length > 0) {
      // One travel candidate per destination would drown the day in
      // legs; the decider weighs ONE seeded destination — the draw
      // is part of the perception step's seed, so the life stays
      // deterministic — against staying.
      const dest = p.destinations[Math.floor(rng() * p.destinations.length) % p.destinations.length]!;
      const destName = p.destinationNames[dest] ?? dest;
      const curiosityConsideration: Consideration = {
        value: linear(p.curiosity),
        weight: 1.0 * (has(def, "Restless") ? 1.3 : 1),
        plain: `curiosity pulled toward ${destName}`,
      };
      const restInverse: Consideration = {
        value: 1 - rest * 0.8,
        weight: 0.6 * (has(def, "Cautious") ? 1.3 : 1),
        plain: "the visit still had energy in it",
      };
      if (p.fuel >= WARP_COST) {
        const considerations: Consideration[] = [
          curiosityConsideration,
          restInverse,
          {
            value: logistic(p.fuel / 60),
            weight: 0.4,
            plain: "the captain's own fuel comfortably covered a warp",
          },
        ];
        candidates.push({
          decision: {
            act: "travel",
            travelKind: "warp",
            toWorld: dest,
            cause: causeOf(considerations, "Another world called louder than this one."),
          },
          value: score(considerations, rng()),
        });
      }
      if (p.stepsLeftInSession >= 2) {
        const considerations: Consideration[] = [curiosityConsideration, { ...restInverse, weight: 0.4 }];
        candidates.push({
          decision: {
            act: "travel",
            travelKind: "drift",
            toWorld: dest,
            cause: causeOf(considerations, "The slow way over was time enough."),
          },
          value: score(considerations, rng()) * 0.9,
        });
      }
    }

    if (p.sessionAgeRatio >= 0.45) {
      const considerations: Consideration[] = [
        { value: rest, weight: 1.7, plain: "rest was winning — the visit had run its course" },
        { value: 1 - duty * 0.5, weight: 0.4, plain: "nothing unfinished held the captain here" },
      ];
      candidates.push({
        decision: { act: "depart", cause: causeOf(considerations, "It was time to head out.") },
        value: score(considerations, rng()),
      });
    }

    addWait();

    // Highest score wins; ties hold the earlier (more social) entry.
    let best = candidates[0];
    for (const c of candidates) {
      if (best === undefined || c.value > best.value) best = c;
    }
    if (!best) throw new Error("The captain decider produced no candidate — wait must always be one.");
    return best.decision;
  },
};
