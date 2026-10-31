import type { DbHandle } from "../db/client.js";
import { withDiscoveryContext } from "./attribution.js";

/**
 * DiscoveryReader — the READ boundary of the discovery ledger (docs/specs/unified-discovery-architecture-2026-10-31.md §2).
 *
 * Every read of the story_finds table goes through here; no other module may keep its own copy of "what this brain has found" (an architecture test enforces that).
 * Phase 1 is a pure relocation: the statements below are byte-identical (after whitespace normalization) to the ones that were scattered across story.ts, flavor.ts, roads.ts
 * and travel.repo.ts, and every read keeps today's meaning — a row of ANY trust is eligible. The trust columns are not consulted yet (eligibility by trust arrives in P4).
 *
 * The SQL text lives in READ_SQL so a test can compare it with the baseline's (P1-SQL) — do not reword these statements, and do not write comments in this file that quote SQL.
 */
export const READ_SQL = {
  has: `SELECT 1 AS x FROM story_finds WHERE space_id = ? AND entry_id = ?`,
  foundAt: `SELECT found_at FROM story_finds WHERE space_id = ? AND entry_id = ?`,
  list: `SELECT entry_id, found_at, source, last_recalled_at, recall_count FROM story_finds WHERE space_id = ? ORDER BY found_at, entry_id`,
  noticedEntryIds: `SELECT entry_id FROM story_finds WHERE space_id = ? AND source IN ('regard','listen')`,
  noticedSince: `SELECT entry_id, found_at FROM story_finds WHERE space_id = ? AND source IN ('regard','listen') AND found_at >= ?`,
  allEntryIds: `SELECT entry_id FROM story_finds WHERE space_id = ?`,
  countNoticedSince: `SELECT COUNT(*) AS n FROM story_finds WHERE space_id = ? AND source IN ('regard','listen') AND found_at >= ?`,
} as const;

export interface FindRow {
  entry_id: string;
  found_at: string;
  source: string;
  last_recalled_at: string | null;
  recall_count: number;
}

export class DiscoveryReader {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string,
  ) {}

  /** Whether this brain has a row for the entry (any trust). */
  has(entryId: string): boolean {
    return withDiscoveryContext(() => !!this.h.sqlite.prepare(READ_SQL.has).get(this.spaceId, entryId));
  }

  /** When the entry was found, or undefined. */
  foundAt(entryId: string): string | undefined {
    return withDiscoveryContext(() => (this.h.sqlite.prepare(READ_SQL.foundAt).get(this.spaceId, entryId) as { found_at: string } | undefined)?.found_at);
  }

  /** Every row, oldest first — the Book's raw material. */
  list(): FindRow[] {
    return withDiscoveryContext(() => this.h.sqlite.prepare(READ_SQL.list).all(this.spaceId) as FindRow[]);
  }

  /** Entry ids found by stillness (regard or listen) — the once-a-day and first-in-world rules read these. */
  noticedEntryIds(): string[] {
    return withDiscoveryContext(() => (this.h.sqlite.prepare(READ_SQL.noticedEntryIds).all(this.spaceId) as { entry_id: string }[]).map((r) => r.entry_id));
  }

  /** Stillness finds at or after an ISO time. */
  noticedSince(sinceIso: string): { entry_id: string; found_at: string }[] {
    return withDiscoveryContext(() => this.h.sqlite.prepare(READ_SQL.noticedSince).all(this.spaceId, sinceIso) as { entry_id: string; found_at: string }[]);
  }

  /** The ids of everything this brain holds. */
  allEntryIds(): Set<string> {
    return withDiscoveryContext(() => new Set((this.h.sqlite.prepare(READ_SQL.allEntryIds).all(this.spaceId) as { entry_id: string }[]).map((r) => r.entry_id)));
  }

  /** How many stillness finds at or after an ISO time (a count only — the flavour engine never reads more). */
  countNoticedSince(sinceIso: string): number {
    return withDiscoveryContext(() => (this.h.sqlite.prepare(READ_SQL.countNoticedSince).get(this.spaceId, sinceIso) as { n: number } | undefined)?.n ?? 0);
  }

  /**
   * Whether this brain holds every entry of at least one of the sets (a story gate with more than one way in). A failing read answers false, exactly as the travel repository did.
   * Phase 1: any row counts. Eligibility by trust arrives with the enforcement modes (P4).
   */
  holdsAnySet(sets: readonly (readonly string[])[]): boolean {
    return withDiscoveryContext(() => {
      try {
        const has = this.h.sqlite.prepare(READ_SQL.has);
        return sets.some((set) => set.every((id) => !!has.get(this.spaceId, id)));
      } catch {
        return false;
      }
    });
  }
}
