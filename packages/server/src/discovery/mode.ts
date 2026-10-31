import type { RawDb } from "../db/vec.js";

/**
 * Discovery enforcement mode (docs/specs/unified-discovery-architecture-2026-10-31.md §9, Phase 1 ruling S3).
 *
 * `DISCOVERY_ENFORCE` is a brake, not an authority: the effective mode is the lower of the request and what the database permits. Nothing in Phase 1 lets the database permit
 * anything above `off` (the readiness check reads tables that first exist in P6), so `effectiveMode` returns `off` for EVERY possible input — including "shadow" and "on".
 */
export type DiscoveryMode = "off" | "shadow" | "on";

export function effectiveMode(_requested?: string | null): "off" {
  return "off";
}

export interface DiscoveryEnvironment {
  sqliteVersion: string;
  journalMode: string;
  trustedSchema: string;
  capability: "registered" | "missing";
}

/**
 * Read-only facts about the running SQLite, for the boot log (spec S3). It issues SELECTs and argument-less PRAGMAs only, writes nothing, and triggers no enforcement, repair or
 * migration. It exists so the production blockers "which SQLite, which journal mode, may triggers call functions" can be read from the Fly logs without a census.
 */
export function readDiscoveryEnvironment(sqlite: RawDb): DiscoveryEnvironment {
  const text = (fn: () => unknown): string => {
    try {
      const v = fn();
      return v === undefined || v === null ? "unknown" : String(v);
    } catch {
      return "unknown";
    }
  };
  const capability = (() => {
    try {
      return (sqlite.prepare(`SELECT discovery_cap() AS c`).get() as { c: number } | undefined)?.c === 1 ? "registered" : "missing";
    } catch {
      return "missing";
    }
  })() as "registered" | "missing";
  return {
    sqliteVersion: text(() => (sqlite.prepare(`SELECT sqlite_version() AS v`).get() as { v: string }).v),
    journalMode: text(() => sqlite.pragma("journal_mode", { simple: true })),
    trustedSchema: text(() => sqlite.pragma("trusted_schema", { simple: true })),
    capability,
  };
}

/** One diagnostic line. The requested value is quoted and truncated so a stray environment value cannot inject log lines. */
export function formatDiscoveryBootLine(env: DiscoveryEnvironment, requested?: string | null): string {
  const asked = requested === undefined || requested === null ? "(unset)" : JSON.stringify(requested.slice(0, 40));
  return `[discovery] sqlite=${env.sqliteVersion} journal=${env.journalMode} trusted_schema=${env.trustedSchema} capability=${env.capability} requested=${asked} effective=${effectiveMode(requested)} (Phase 1: diagnostic only — no enforcement exists)`;
}
