import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";

/**
 * Web-push subscriptions (Immersion Round 3, CL3). One row per browser
 * PushSubscription endpoint; the endpoint is globally UNIQUE, so
 * re-subscribing the same browser upserts its keys and owning space.
 * This repo owns all SQL for the table (repo convention).
 */
export interface PushSubscriptionRow {
  id: number;
  spaceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
}

interface RawRow {
  id: number;
  space_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
}

function toRow(r: RawRow): PushSubscriptionRow {
  return {
    id: r.id,
    spaceId: r.space_id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  };
}

export class PushSubscriptionsRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /** Insert a subscription, or refresh keys/owner if the endpoint exists. */
  upsert(input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }): PushSubscriptionRow {
    this.h.sqlite
      .prepare(
        `INSERT INTO push_subscriptions (space_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           space_id = excluded.space_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent`,
      )
      .run(this.spaceId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null);
    const row = this.h.sqlite
      .prepare(`SELECT * FROM push_subscriptions WHERE endpoint = ?`)
      .get(input.endpoint) as RawRow;
    return toRow(row);
  }

  /** All subscriptions belonging to this space. */
  listForSpace(): PushSubscriptionRow[] {
    return (
      this.h.sqlite
        .prepare(`SELECT * FROM push_subscriptions WHERE space_id = ? ORDER BY id ASC`)
        .all(this.spaceId) as RawRow[]
    ).map(toRow);
  }

  /**
   * Delete by endpoint. Used both for explicit unsubscribe (space-scoped —
   * a brain can only remove its own subscriptions) and by the send path to
   * prune dead endpoints (404/410 from the push service), where the row's
   * owning space is already known from listForSpace().
   */
  deleteByEndpoint(endpoint: string, opts: { scopedToSpace?: boolean } = {}): boolean {
    const scoped = opts.scopedToSpace ?? true;
    const res = scoped
      ? this.h.sqlite
          .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND space_id = ?`)
          .run(endpoint, this.spaceId)
      : this.h.sqlite.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
    return res.changes > 0;
  }
}
