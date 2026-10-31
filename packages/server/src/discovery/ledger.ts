import type { DbHandle } from "../db/client.js";
import { withDiscoveryContext } from "./attribution.js";
import { DiscoveryReader } from "./reader.js";

/**
 * DiscoveryLedger — the only WRITER of the story_finds table (docs/specs/unified-discovery-architecture-2026-10-31.md §2, §4).
 * The one exception is whole-account deletion in auth/spaces.ts. Import, upgrade and classification arrive in later phases; Phase 1 has two writes:
 *
 *  - admit: a live, online find. It reads the state FIRST, inside one immediate transaction, then branches — it never relies on SQLite conflict handling. An absent entry is written as
 *    trust "accepted" with basis "live:v1" ("accepted" = admitted under the server-side rules in force, NOT physically verified). Any existing row (whatever its trust) is left
 *    untouched and reported as not new. Nothing here ever lowers or rewrites trust.
 *  - markRecalled: bump an entry's recall (retrieval makes memory).
 *
 * trust_at and found_at are only ever produced by Date#toISOString here, never taken from a client.
 */
export interface Admitted {
  entryId: string;
  foundAt: string;
  isNew: boolean;
}

const INSERT_LIVE = `INSERT INTO story_finds (space_id, entry_id, found_at, source, trust, trust_at, trust_basis) VALUES (?, ?, ?, ?, 'accepted', ?, 'live:v1')`;
const MARK_RECALLED = `UPDATE story_finds SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE space_id = ? AND entry_id = ?`;

export class DiscoveryLedger {
  private readonly reader: DiscoveryReader;
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string,
  ) {
    this.reader = new DiscoveryReader(h, spaceId);
  }

  admit(entryId: string, source: string, nowMs: number): Admitted {
    return withDiscoveryContext(() =>
      this.h.sqlite
        .transaction((): Admitted => {
          const existing = this.reader.foundAt(entryId);
          if (existing !== undefined) return { entryId, foundAt: existing, isNew: false };
          const iso = new Date(nowMs).toISOString();
          this.h.sqlite.prepare(INSERT_LIVE).run(this.spaceId, entryId, iso, source, iso);
          return { entryId, foundAt: iso, isNew: true };
        })
        .immediate(),
    );
  }

  markRecalled(entryId: string, nowMs: number): void {
    withDiscoveryContext(() => {
      this.h.sqlite.prepare(MARK_RECALLED).run(new Date(nowMs).toISOString(), this.spaceId, entryId);
    });
  }
}
