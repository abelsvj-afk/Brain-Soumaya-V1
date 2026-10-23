/**
 * Worlds feature gate (Phase 2, P2-3). The app has no feature-flag
 * system, so the worlds travel layer ships dark behind this constant:
 * while false, no travel UI mounts, no scene loads, and no travel API
 * calls are made. It is flipped only by the P2-4 dark-launch step, as
 * its own deliberate change — never as a side effect of other work.
 */
export const WORLDS_TRAVEL_ENABLED = false;
