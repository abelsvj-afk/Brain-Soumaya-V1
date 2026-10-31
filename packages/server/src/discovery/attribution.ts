/**
 * Discovery-context ATTRIBUTION — a test mechanism, not a security boundary
 * (docs/specs/unified-discovery-architecture-2026-10-31.md §2 "Attribution is not authorization", §15 P1-ARCH layer 2).
 *
 * `DiscoveryLedger` and `DiscoveryReader` run their statements inside `withDiscoveryContext`, so that a TEST can tell which module issued a statement that mentions `story_finds`.
 * The marker grants no write permission, changes no query's behaviour, and is never proof that anything was authorized. Production code must never read it to decide whether
 * to run, allow or reject a statement: only `isDiscoveryContextActive` reads it, and a test (discoveryArchitecture.test.ts, A14) proves that nothing outside the test-only
 * statement wrapper imports it. It is also independent of the database capability functions (capability.ts, A15).
 */

let depth = 0;

export function withDiscoveryContext<T>(fn: () => T): T {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
  }
}

/** TEST-ONLY reader of the marker. Do not import this from production code. */
export function isDiscoveryContextActive(): boolean {
  return depth > 0;
}
