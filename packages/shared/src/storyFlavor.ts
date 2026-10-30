import { CURRENT_KEYS, NEUTRAL_CURRENTS, type CurrentKey, type Currents } from "./society.js";
import { hourBand, type HourBand } from "./storyTriggers.js";
import type { Register, Variants } from "./story.js";

/**
 * The Flavour layer (docs/lore/DRAFT_6_THE_LOOM.md §3–7, docs/specs/story-flavor-engine-2026-10-30.md). Flavour is WHO YOU ARE IN THIS GAME — the brain's colour (the
 * society's currents) plus how you play (five non-moral leanings) plus the Hour — and it decides HOW the locked story is voiced. It can never hide, add, change or reorder
 * a fact: every function here either picks among authored variants of the same claim or orders things that are ALL still returned. A mirror, not a verdict.
 *
 * Pure and deterministic: the same inputs give the same output on server and web, so there is nothing to keep in step.
 */

export const LEANS = ["wanderer", "keeper", "builder", "questioner", "ritualist"] as const;
export type Lean = (typeof LEANS)[number];

/** Counts only — never content. All are over a recent window (30–90 days) and read from existing tables; none is memory text. */
export interface PlayCounts {
  /** Arrivals in any world. */
  worldVisits: number;
  /** Different worlds arrived in. */
  distinctWorlds: number;
  /** Recall gradings. */
  recalls: number;
  /** Memories captured. */
  captures: number;
  /** Missions / Journeys closed. */
  closures: number;
  /** Chat turns with Soumaya. */
  chatTurns: number;
  /** Regards, listens and Concordance links. */
  noticings: number;
  /** Days on which the player came back in the same Hour band as the day before. */
  sameHourReturns: number;
}

export const NEUTRAL_COUNTS: Readonly<PlayCounts> = {
  worldVisits: 0,
  distinctWorlds: 0,
  recalls: 0,
  captures: 0,
  closures: 0,
  chatTurns: 0,
  noticings: 0,
  sameHourReturns: 0,
};

const sat = (n: number, k: number) => n / (n + k); // saturating 0..1: more is more, never unbounded

/** How strongly each way of playing shows (0..1 each). Thin evidence reads as nothing — the neutral key follows. */
export function scoreLeanings(c: PlayCounts): Record<Lean, number> {
  return {
    wanderer: sat(c.distinctWorlds * 2 + c.worldVisits * 0.5, 6),
    keeper: sat(c.recalls * 1.5 + c.sameHourReturns * 0.5, 10),
    builder: sat(c.closures * 2 + c.captures * 0.4, 12),
    questioner: sat(c.chatTurns * 0.5 + c.noticings * 1.5, 12),
    ritualist: sat(c.sameHourReturns * 2, 8),
  };
}

/**
 * The top two leanings. `prev` gives hysteresis: a leaning already held keeps its place unless another beats it by `margin`, so flavour drifts like weather and never flickers
 * from one day to the next. With no real evidence (best score under `floor`) the result is the neutral pair.
 */
export function topLeanings(scores: Record<Lean, number>, prev?: readonly [Lean, Lean], margin = 0.08, floor = 0.15): [Lean, Lean] {
  const ranked = [...LEANS].sort((a, b) => scores[b] - scores[a] || LEANS.indexOf(a) - LEANS.indexOf(b));
  if (scores[ranked[0]!] < floor) return ["keeper", "wanderer"]; // neutral; chosen only because something must be, and it implies nothing
  if (!prev) return [ranked[0]!, ranked[1]!];
  const held = prev.filter((l) => scores[l] + margin >= scores[ranked[0]!]);
  const out: Lean[] = [...held];
  for (const l of ranked) if (out.length < 2 && !out.includes(l)) out.push(l);
  return [out[0]!, out[1]!];
}

export interface FlavorKey {
  tide: { first: CurrentKey; second: CurrentKey };
  lean: [Lean, Lean];
  hour: HourBand;
  register: Register;
}

/** Strongest and second-strongest current; ties broken by the fixed order. Thin evidence (low confidence) falls toward the neutral society's own ordering. */
export function dominantCurrents(currents: Currents, confidence = 1): { first: CurrentKey; second: CurrentKey } {
  const blend = (k: CurrentKey) => NEUTRAL_CURRENTS[k] + (currents[k] - NEUTRAL_CURRENTS[k]) * Math.max(0, Math.min(1, confidence));
  const ranked = [...CURRENT_KEYS].sort((a, b) => blend(b) - blend(a) || CURRENT_KEYS.indexOf(a) - CURRENT_KEYS.indexOf(b));
  return { first: ranked[0]!, second: ranked[1]! };
}

const GRAVE: ReadonlySet<CurrentKey> = new Set(["reverence", "weight"]);
const WARM: ReadonlySet<CurrentKey> = new Set(["giving", "peace", "appetite"]);

function hash01(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0) / 4294967295;
}

/**
 * The register a brain is voiced in today: grave for reverence/weight, warm for giving/peace/appetite, plain for ambition/friction — and about one day in six it steps back to
 * plain (weather, not fate). The same brain on the same day always gets the same answer.
 */
export function registerFor(tide: { first: CurrentKey; second: CurrentKey }, brainId: string, dayKey: string): Register {
  const base: Register = GRAVE.has(tide.first) ? "grave" : WARM.has(tide.first) ? "warm" : "plain";
  if (base === "plain") return "plain";
  return hash01(`${brainId}|${dayKey}|reg`) < 1 / 6 ? "plain" : base;
}

export const NEUTRAL_TIDE = { first: "reverence", second: "giving" } as const satisfies { first: CurrentKey; second: CurrentKey };

/** The key flavour off / unknown / failed always yields: plain everywhere, so the complete canon is voiced. */
export function neutralFlavor(now: Date = new Date()): FlavorKey {
  return { tide: { ...NEUTRAL_TIDE }, lean: ["keeper", "wanderer"], hour: hourBand(now), register: "plain" };
}

export function flavorKey(input: { currents: Currents; confidence: number; counts: PlayCounts; prevLean?: readonly [Lean, Lean]; brainId: string; dayKey: string; now?: Date }): FlavorKey {
  const tide = dominantCurrents(input.currents, input.confidence);
  return {
    tide,
    lean: topLeanings(scoreLeanings(input.counts), input.prevLean),
    hour: hourBand(input.now ?? new Date()),
    register: registerFor(tide, input.brainId, input.dayKey),
  };
}

/** Pick the register's wording; falls back to `plain`, which every Variants has. The CLAIM is identical in all of them (a test pins it). */
export function pickText(v: Variants, register: Register): string {
  return v[register] ?? v.plain;
}

/** Which of the eight doors a tide surfaces FIRST on the rim and in rumours (Draft 6 §4). Emphasis only: every door is always returned. */
export const FIRST_DOOR: Readonly<Record<CurrentKey, string>> = {
  reverence: "sight.open-alcove",
  giving: "obj.kiths-drawing",
  ambition: "sight.missing-stratum",
  appetite: "sight.hung-star",
  friction: "obj.dorrows-page",
  weight: "obj.sleepwalkers-lantern",
  peace: "sight.dead-bough",
};

/** The same set in a flavour-leaning order. Never drops, adds or duplicates one. */
export function surfaceOrder(doors: readonly string[], key: FlavorKey): string[] {
  const first = FIRST_DOOR[key.tide.first];
  const second = FIRST_DOOR[key.tide.second];
  const rank = (d: string) => (d === first ? 0 : d === second ? 1 : 2);
  return doors.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
}

/** The form the quiet stranger at the dock takes (Draft 6 §4). Unnamed in every form. */
export const COMPANION_FORM: Readonly<Record<CurrentKey, string>> = {
  reverence: "an old person with warm hands",
  giving: "a woman carrying a basket",
  ambition: "a traveller with a pack and a map",
  appetite: "a stranger with a flask",
  friction: "a quiet soldier off duty",
  weight: "a child with a flask",
  peace: "someone mending a net",
};
