/**
 * Worlds feature gate (Phase 2, P2-3). The app has no feature-flag
 * system, so the worlds travel layer shipped dark behind this constant:
 * while false, no travel UI mounts, no scene loads, and no travel API
 * calls are made. The owner turned it on after P3-1 merged (D-64),
 * as its own deliberate change — never as a side effect of other work.
 */
export const WORLDS_TRAVEL_ENABLED = true;

/**
 * The People gate (Phase 3, P3-3, Q1 — settled by the build-all delegation,
 * 2026-10-26): the gate appears when the brain holds at least three people
 * with at least two linked memories each, plus at least one memory shared
 * between two people — so the space can show a connection, not just
 * isolated clusters. The server enforces it (TravelRepo.peopleGateOpen,
 * re-checked against the database on every departure to People); the
 * client only displays what the server reports, never its own verdict.
 */
export const PEOPLE_GATE_MIN_PEOPLE = 3;
export const PEOPLE_GATE_MIN_MEMORIES_EACH = 2;
export const PEOPLE_GATE_MIN_SHARED_MEMORIES = 1;

/**
 * Eternity's world (Phase 3, Eternity app world, 2026-10-26). The
 * furthest world: the white void where Eternity himself stands. The
 * world is a real app world, not a mockup — its scene lives in
 * `graph/eternityScene.ts` — but reaching it is gated, by the owner's
 * settled B-01 rule (lore §6, relic-buffs note Rev 112):
 *
 * - The gate opens for a traveller holding the Witness Without a Name
 *   (the key) plus any two other relics. Once the gate has opened for
 *   a traveller it stays open to them — the only price after that is
 *   the fuel for the journey.
 * - The journey itself is a three-leg chain through at least two
 *   intermediate worlds (warp 10 per leg, no direct jump); drift legs
 *   are free, as everywhere.
 *
 * The relic holdings themselves live in the relic increment (the buffs
 * note's B-01 wiring — relic discovery + codex do not exist yet, so no
 * traveller holds anything today). This module defines the gate's
 * shape — the holdings interface and the pure predicate — so the
 * travel ledger can enforce the gate now and the relic increment can
 * supply real holdings later without changing the gate. Until that
 * wiring lands the gate is honestly closed: the world ships, nobody
 * can yet open the way to it, and the server says so in plain words.
 */
export const ETERNITY_WORLD_KEY = "eternity";

/** The gate's key relic (lore §6): the Witness Without a Name. */
export const ETERNITY_GATE_KEY_RELIC = "witness-without-a-name";

/** Relics besides the key the gate requires. */
export const ETERNITY_GATE_OTHER_RELICS = 2;

/** Legs in the chain to Eternity's world (home → A → B → Eternity). */
export const ETERNITY_CHAIN_LEGS = 3;

/** Intermediate worlds the chain must pass through. */
export const ETERNITY_CHAIN_INTERMEDIATES = 2;

/**
 * What the gate needs to know about a traveller's relics. The relic
 * increment owns the source of truth (discovery + codex); this is the
 * narrow interface the gate reads — a key flag and a count of other
 * relics held — so no relic-system detail leaks into the travel
 * ledger. The default (no holdings supplied) is "holds nothing".
 */
export interface EternityGateHoldings {
  /** Holds the Witness Without a Name — the gate's key. */
  witnessWithoutName: boolean;
  /** Other relics held (any relics besides the key). */
  otherRelicCount: number;
}

export const NO_ETERNITY_HOLDINGS: EternityGateHoldings = {
  witnessWithoutName: false,
  otherRelicCount: 0,
};

/** The B-01 predicate, pure: key + any two other relics opens the gate. */
export function eternityGateOpens(holdings: EternityGateHoldings): boolean {
  return holdings.witnessWithoutName && holdings.otherRelicCount >= ETERNITY_GATE_OTHER_RELICS;
}
