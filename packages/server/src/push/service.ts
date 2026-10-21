/**
 * Web push (Immersion Round 3, CL3 — minimal TRUE push, owner decision Q4).
 *
 * Unconfigured-off by design: unless ALL of VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY and VAPID_SUBJECT are set in the environment, the
 * feature does not exist — config reports disabled, subscribe refuses, and
 * the send path is a strict no-op (zero behavior change). This mirrors the
 * repo's other opt-in channels (Telegram stays silent without its token).
 *
 * Env is read on EVERY call (never cached at module load) so operators —
 * and tests — can flip configuration without a code change.
 */

import webpush from "web-push";
import type { DbHandle } from "../db/client.js";
import { PushSubscriptionsRepo, type PushSubscriptionRow } from "../repositories/pushSubscriptions.repo.js";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The full VAPID triple, or null when push is not configured. */
export function getVapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function isPushEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getVapidConfig(env) !== null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App-relative URL the service worker opens on click. */
  url?: string;
}

/** The web-push subscription shape the sender consumes. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Sends ONE notification. Injectable so tests never touch a real push
 * service; the default implementation is the `web-push` package.
 */
export type PushSender = (target: PushTarget, payloadJson: string, config: VapidConfig) => Promise<void>;

const defaultSender: PushSender = async (target, payloadJson, config) => {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  await webpush.sendNotification(target, payloadJson);
};

/** HTTP status carried by a web-push failure, when there is one. */
function statusCodeOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const sc = (err as { statusCode?: unknown }).statusCode;
    return typeof sc === "number" ? sc : undefined;
  }
  return undefined;
}

export interface SendPushResult {
  /** True when VAPID is unconfigured — nothing was attempted. */
  skipped: boolean;
  sent: number;
  /** Subscriptions deleted because the push service says they're gone. */
  pruned: number;
  /** Sends that failed for a non-dead reason (subscription kept). */
  failed: number;
}

/**
 * Dispatch a notification to every subscription of one space.
 * Never throws: a push failure must never break the firing path that
 * called it. Dead endpoints (404/410) are pruned; any other failure keeps
 * the subscription for a later retry.
 */
export async function sendPushToSpace(
  handle: DbHandle,
  spaceId: string,
  payload: PushPayload,
  opts: { config?: VapidConfig | null; sender?: PushSender } = {},
): Promise<SendPushResult> {
  const config = opts.config !== undefined ? opts.config : getVapidConfig();
  if (!config) return { skipped: true, sent: 0, pruned: 0, failed: 0 };

  const repo = new PushSubscriptionsRepo(handle, spaceId);
  const subs: PushSubscriptionRow[] = repo.listForSpace();
  if (subs.length === 0) return { skipped: false, sent: 0, pruned: 0, failed: 0 };

  const sender = opts.sender ?? defaultSender;
  const payloadJson = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
  });

  let sent = 0;
  let pruned = 0;
  let failed = 0;
  for (const sub of subs) {
    try {
      await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payloadJson, config);
      sent++;
    } catch (err) {
      const sc = statusCodeOf(err);
      if (sc === 404 || sc === 410) {
        // Gone for good — the browser unsubscribed or the subscription
        // expired. Prune so we never pay for this endpoint again.
        repo.deleteByEndpoint(sub.endpoint, { scopedToSpace: false });
        pruned++;
      } else {
        failed++;
      }
    }
  }
  return { skipped: false, sent, pruned, failed };
}
