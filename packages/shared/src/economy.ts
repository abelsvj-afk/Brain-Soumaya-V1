/**
 * The Celestial Economy's NUMBERS — shared so the client can label a cost/reward
 * without hardcoding a copy of it.
 *
 * These lived only in `packages/server/src/economy.ts`, so the web app restated them
 * as literals inside user-facing strings ("up to 2 ⛽") and tooltips ("+fuel"). Retune
 * the server and those labels silently start lying. The server still owns all the
 * economy LOGIC (earning, spending, regen, clamping) — this module is only the
 * constants both sides need to agree on.
 */

export const FUEL_START = 25;
export const FUEL_CAP = 200;
/** Fuel spent per autonomous LLM job. */
export const FUEL_JOB_COST = 2;

// --- Earnings ---
export const EARN_MEMORY = 15;
export const EARN_LINK = 2;
export const EARN_ACTION_DONE = 3;
export const EARN_MIND = 6;
export const EARN_THOUGHT = 2;
export const EARN_CODEX_DISCOVERY = 4;
export const EARN_REVIEW = 3;

// --- Worlds travel (Phase 2) ---
/**
 * Fuel charged for one warp between spaces, debited by the server when a
 * departure's cancel window closes (a cancelled departure is never charged).
 * Priced against EARN_MEMORY (15): one captured memory funds a warp with
 * change, and passive regen alone (3.5/hr) funds several warps a day — a
 * quiet week can never strand a brain.
 */
export const WARP_COST = 10;
/**
 * Bonus credited on a completed warp arrival (server-side, once per journey).
 * Deliberately less than WARP_COST: a warp never nets positive, so journeys
 * rebate travel without becoming a fuel farm.
 */
export const EARN_JOURNEY_COMPLETE = 5;
/** Bonus credited on a completed drift arrival — the slow free gait still counts as a journey. */
export const EARN_JOURNEY_DRIFT = 3;

export const FUEL_REGEN_PER_HOUR = 3.5;

/**
 * An action item only pays out `EARN_ACTION_DONE` once it has existed this long —
 * a create-then-delete loop was a free fuel farm. The client needs this to avoid
 * promising fuel for a task the user clears immediately (the Agenda's "+fuel"
 * tooltip did exactly that).
 */
export const ACTION_DONE_MIN_AGE_MINUTES = 10;
