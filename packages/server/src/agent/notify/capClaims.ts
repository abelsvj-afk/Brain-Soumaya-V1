/**
 * ADR-018 §2.1 / A2: shared atomic delivery ledger (`notification_cap_claims`).
 *
 * This is the SOLE cap-counting authority for proactive notifications across
 * Telegram + web push (ADR-018 D1): the per-space `dailyProactiveCap` is one
 * allowance across all channels for the space-local day, not one per channel.
 * The two channel outboxes remain channel-specific payload/lifecycle stores;
 * neither counts the cap from its own rows anymore (their `cap_day` columns
 * are inert legacy — never read for counting).
 *
 * Placement (A1): a sibling module in agent/notify/ importing ONLY the RawDb
 * type. It never imports either channel's outbox; each channel's claim path
 * calls into here with primitives (spaceId, channel, deliveryKey, localDay,
 * capExempt) plus a `flip` callback performing that channel's conditional
 * outbox status UPDATE. The flip runs INSIDE the claim transaction, so the
 * slot reservation and the outbox transition commit or roll back together.
 *
 * Lifecycle (A2):
 * - reserved: slot held while the send is in flight — counts toward the cap.
 * - sent: confirmed delivery — retains the slot for that local day.
 * - ambiguous: send outcome unknown — retains the slot, terminal.
 * - released: definite failure / drop / pre-send recovery — frees the slot;
 *   a same-day retry reactivates the SAME ledger row (no double-count).
 * A retry crossing a local-day boundary creates a claim for the new day
 * (the ledger PK includes local_day).
 */

import type { RawDb } from "../../db/vec.js";

export type CapChannel = "telegram" | "push";

export type CapClaimState = "reserved" | "sent" | "ambiguous" | "released";

export interface TryClaimInput {
  spaceId: string;
  channel: CapChannel;
  /** Stable channel outbox identity (notif_key for Telegram, push_key for push). */
  deliveryKey: string;
  /** Space-local YYYY-MM-DD the claim counts against. */
  localDay: string;
  /** Global daily cap for the space (ignored when capExempt is true). */
  cap: number;
  /** Fresh qualifying urgent deliveries are cap-exempt (Option A): they are
   *  recorded for idempotency/audit but excluded from the count. */
  capExempt: boolean;
}

/**
 * Count retained non-exempt claims for a space-local day: states
 * reserved | sent | ambiguous with cap_exempt = 0. This is the one cap
 * predicate both channels share (ADR-018 criterion 13).
 */
export function countActiveClaims(sqlite: RawDb, spaceId: string, localDay: string): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_cap_claims
       WHERE space_id = ? AND local_day = ? AND cap_exempt = 0
         AND state IN ('reserved', 'sent', 'ambiguous')`
    )
    .get(spaceId, localDay) as { c: number };
  return row.c;
}

/**
 * Atomically reserve a cap slot AND flip the channel outbox row to its
 * sending state. Runs entirely inside one SQLite transaction:
 *   1. Idempotency: an existing claim for the PK in reserved | sent |
 *      ambiguous state blocks the claim (false) — the same delivery can
 *      never reserve two slots, and a sent/ambiguous delivery can never
 *      be reclaimed.
 *   2. Cap check (non-exempt only): countActiveClaims >= cap → false.
 *      A 'released' row does not block: it is reactivated below.
 *   3. flip(): the channel's conditional outbox UPDATE; false → no claim.
 *   4. Claim write: INSERT a 'reserved' row, or UPDATE a 'released' row
 *      back to 'reserved' with the CURRENT capExempt evaluation.
 * Any throw rolls the whole transaction back — flip included — so a failed
 * claim leaves neither a reservation nor a half-flipped outbox row.
 */
export function tryClaim(sqlite: RawDb, input: TryClaimInput, flip: () => boolean): boolean {
  const run = sqlite.transaction((): boolean => {
    const existing = sqlite
      .prepare(
        `SELECT state FROM notification_cap_claims
         WHERE space_id = ? AND channel = ? AND delivery_key = ? AND local_day = ?`
      )
      .get(input.spaceId, input.channel, input.deliveryKey, input.localDay) as
      | { state: CapClaimState }
      | undefined;
    if (existing && existing.state !== "released") return false;

    if (!input.capExempt && countActiveClaims(sqlite, input.spaceId, input.localDay) >= input.cap) {
      return false;
    }

    if (!flip()) return false;

    if (existing) {
      // Reactivate the released row: same ledger row, fresh exemption
      // evaluation, refreshed updated_at. Still exactly one row per PK.
      sqlite
        .prepare(
          `UPDATE notification_cap_claims
           SET state = 'reserved', cap_exempt = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE space_id = ? AND channel = ? AND delivery_key = ? AND local_day = ?`
        )
        .run(
          input.capExempt ? 1 : 0,
          input.spaceId,
          input.channel,
          input.deliveryKey,
          input.localDay
        );
    } else {
      sqlite
        .prepare(
          `INSERT INTO notification_cap_claims
             (space_id, local_day, channel, delivery_key, state, cap_exempt)
           VALUES (?, ?, ?, ?, 'reserved', ?)`
        )
        .run(input.spaceId, input.localDay, input.channel, input.deliveryKey, input.capExempt ? 1 : 0);
    }
    return true;
  });
  return run();
}

/**
 * Transition a reserved claim to its post-send state. Only a claim still in
 * 'reserved' moves; returns true iff exactly one row changed.
 *
 * No matching reserved claim is a SILENT NO-OP (A2/Q1): rows that were
 * in-flight when the ledger landed hold only a legacy cap_day reservation
 * and have no ledger counterpart — their lifecycle transitions proceed as
 * plain outbox state transitions and are never retroactively granted a
 * claim. Deliberately NOT scoped by local_day: at most one reserved claim
 * exists per (space, channel, delivery), so the transition finds it
 * regardless of which local day it was reserved under.
 */
export function transitionClaim(
  sqlite: RawDb,
  key: { spaceId: string; channel: CapChannel; deliveryKey: string },
  to: "sent" | "released" | "ambiguous"
): boolean {
  const r = sqlite
    .prepare(
      `UPDATE notification_cap_claims
       SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE space_id = ? AND channel = ? AND delivery_key = ? AND state = 'reserved'`
    )
    .run(to, key.spaceId, key.channel, key.deliveryKey);
  return r.changes === 1;
}
