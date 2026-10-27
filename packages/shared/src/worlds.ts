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
