import type { NotificationSource, ServerNotification } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Server-backed Inbox notifications (IM-74). One row per REAL away-event —
 * a digest delivered, an insight synthesized, a discovery charted, a bill-risk
 * warning issued — recorded by the producers at their creation points, never
 * fabricated. Space-scoped like every repo.
 *
 * Retention (QUESTIONS Q7 interim default, flagged for owner confirmation):
 * notifications persist until the user clears them. The only automatic removal
 * is the count cap below: past NOTIFICATION_CAP rows per space, the OLDEST are
 * dropped. The Inbox panel copy discloses both halves of this policy.
 */
export const NOTIFICATION_CAP = 500;

interface NotificationRow {
  id: number;
  source: string;
  text: string;
  icon: string;
  priority: string;
  dedupeKey: string | null;
  seenAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

function toNotification(r: NotificationRow): ServerNotification {
  return {
    id: r.id,
    source: r.source as NotificationSource,
    text: r.text,
    icon: r.icon,
    priority: (r.priority === "high" || r.priority === "low" ? r.priority : "normal") as ServerNotification["priority"],
    dedupeKey: r.dedupeKey,
    seen: r.seenAt !== null,
    seenAt: r.seenAt,
    snoozedUntil: r.snoozedUntil,
    createdAt: r.createdAt,
  };
}

const COLS = `id, source, text, icon, priority, dedupe_key AS dedupeKey,
  seen_at AS seenAt, snoozed_until AS snoozedUntil, created_at AS createdAt`;

export class NotificationsRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /**
   * Record an away-event. With a dedupeKey, a second record of the same event
   * is a no-op returning null (the UNIQUE(space_id, dedupe_key) index backs
   * this). Returns the stored notification, or null when deduped.
   */
  record(input: {
    source: NotificationSource;
    text: string;
    icon?: string;
    priority?: ServerNotification["priority"];
    dedupeKey?: string;
  }): ServerNotification | null {
    const res = this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO inbox_notifications (space_id, source, text, icon, priority, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.spaceId, input.source, input.text, input.icon ?? "🔔", input.priority ?? "normal", input.dedupeKey ?? null);
    if (res.changes === 0) return null; // same event already recorded
    this.enforceCap();
    const row = this.h.sqlite
      .prepare(`SELECT ${COLS} FROM inbox_notifications WHERE id = ?`)
      .get(res.lastInsertRowid) as NotificationRow;
    return toNotification(row);
  }

  /** Newest first. Snoozed items are included — the panel decides visibility. */
  list(limit = 200): ServerNotification[] {
    const rows = this.h.sqlite
      .prepare(`SELECT ${COLS} FROM inbox_notifications WHERE space_id = ? ORDER BY id DESC LIMIT ?`)
      .all(this.spaceId, limit) as NotificationRow[];
    return rows.map(toNotification);
  }

  /** Mark one seen. Returns false when the row isn't this space's (or is gone). */
  markSeen(id: number, at: string = new Date().toISOString()): boolean {
    return (
      this.h.sqlite
        .prepare(`UPDATE inbox_notifications SET seen_at = ? WHERE id = ? AND space_id = ? AND seen_at IS NULL`)
        .run(at, id, this.spaceId).changes > 0
    );
  }

  /** Mark every unseen item seen — except actively-snoozed ones: a snooze is a
   *  "remind me later", and a bulk mark-all must not silently consume it.
   *  Returns how many changed. */
  markAllSeen(at: string = new Date().toISOString()): number {
    return this.h.sqlite
      .prepare(
        `UPDATE inbox_notifications SET seen_at = ? WHERE space_id = ? AND seen_at IS NULL
         AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
      )
      .run(at, this.spaceId, at).changes;
  }

  /** Delete one item outright (per-item delete). Space-scoped. */
  remove(id: number): boolean {
    return this.h.sqlite.prepare(`DELETE FROM inbox_notifications WHERE id = ? AND space_id = ?`).run(id, this.spaceId)
      .changes > 0;
  }

  /** Snooze one item until an ISO instant; it resurfaces in Unseen afterwards. */
  snooze(id: number, untilIso: string): boolean {
    return (
      this.h.sqlite
        .prepare(`UPDATE inbox_notifications SET snoozed_until = ? WHERE id = ? AND space_id = ?`)
        .run(untilIso, id, this.spaceId).changes > 0
    );
  }

  /** Clear History: delete this space's seen items. Returns how many. */
  clearSeen(): number {
    return this.h.sqlite
      .prepare(`DELETE FROM inbox_notifications WHERE space_id = ? AND seen_at IS NOT NULL`)
      .run(this.spaceId).changes;
  }

  /** The disclosed cap: past NOTIFICATION_CAP rows, drop the oldest. */
  private enforceCap(): void {
    this.h.sqlite
      .prepare(
        `DELETE FROM inbox_notifications WHERE space_id = ? AND id NOT IN
           (SELECT id FROM inbox_notifications WHERE space_id = ? ORDER BY id DESC LIMIT ?)`,
      )
      .run(this.spaceId, this.spaceId, NOTIFICATION_CAP);
  }
}
