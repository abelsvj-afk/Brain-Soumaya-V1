import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NotificationsRepo } from "./notifications.repo.js";

/**
 * Codex discoveries Soumaya charts on her own (her "field notes"). Each is keyed so a
 * given phenomenon is only ever recorded once per brain. Space-scoped like every repo.
 */
export interface CodexDiscovery {
  key: string;
  title: string;
  lore: string;
  icon: string;
  focusId: number | null;
  createdAt: string;
}

export class CodexDiscoveriesRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  list(): CodexDiscovery[] {
    return this.handle.sqlite
      .prepare(
        `SELECT key, title, lore, icon, focus_id AS focusId, created_at AS createdAt
         FROM codex_discoveries WHERE space_id = ? ORDER BY id DESC`,
      )
      .all(this.spaceId) as CodexDiscovery[];
  }

  has(key: string): boolean {
    return !!this.handle.sqlite
      .prepare(`SELECT 1 FROM codex_discoveries WHERE space_id = ? AND key = ?`)
      .get(this.spaceId, key);
  }

  /** Record a discovery (idempotent by key). Returns true if it was newly added. */
  add(d: { key: string; title: string; lore: string; icon?: string; focusId?: number | null }): boolean {
    const added =
      this.handle.sqlite
        .prepare(
          `INSERT OR IGNORE INTO codex_discoveries (space_id, key, title, lore, icon, focus_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(this.spaceId, d.key, d.title, d.lore, d.icon ?? "✦", d.focusId ?? null).changes > 0;
    if (added) {
      // IM-74 producer: a newly charted discovery is a real away-event — mirror
      // it into the server Inbox. Best-effort only; the Codex is the source of
      // truth and must never fail because the Inbox did.
      try {
        new NotificationsRepo(this.handle, this.spaceId).record({
          source: "discovery",
          text: d.title,
          icon: d.icon ?? "✦",
          dedupeKey: `discovery:${d.key}`,
        });
      } catch { /* inbox is a mirror, never a gate */ }
    }
    return added;
  }
}
