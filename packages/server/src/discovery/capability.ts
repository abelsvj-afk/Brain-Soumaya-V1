import type { RawDb } from "../db/vec.js";

/**
 * The application's database capability functions (docs/specs/unified-discovery-architecture-2026-10-31.md §6.1).
 *
 * A connection that holds these can pass the future `story_finds` guard triggers; a connection that does not (the sqlite3 shell, a script, an older build) cannot even prepare a
 * statement that fires them ("no such function"). In Phase 1 NO trigger exists yet, so registering them changes nothing a caller can see — it only lays the foundation, and lets
 * the boot log show that the registration works.
 *
 *  - `discovery_cap()` always returns 1. It is deliberately NOT tied to the attribution marker (attribution.ts): the marker is a test aid and authorizes nothing.
 *  - `discovery_delete_ok(space_id)` returns 1 only while the account-deletion window is open for that exact space. Phase 1 has no window (it arrives with the P6 change to
 *    `deleteSpace`, spec §6.1), so it returns 0 for every input.
 */
export function registerDiscoveryCapability(sqlite: RawDb): void {
  sqlite.function("discovery_cap", () => 1);
  sqlite.function("discovery_delete_ok", (_spaceId: unknown) => 0);
}
