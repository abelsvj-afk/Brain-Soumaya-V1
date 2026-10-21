import { API, afetch } from "./http.js";
import type { ServerNotification } from "@brain/shared";

/** Mirrors NOTIFICATION_CAP in the server's notifications repo: the server
 *  inbox keeps this many notifications per space before the oldest are let
 *  go. The Inbox panel's retention copy quotes this number — keep them in sync. */
export const SERVER_INBOX_CAP = 500;

/**
 * Server Inbox client (IM-74). Thin wrappers over /api/notifications — the
 * notifications Soumaya recorded server-side while the user was away (digest
 * delivered, insight created, discovery charted, bill-risk warning). Fail-soft
 * like the other domain clients: a failed read returns null so the panel can
 * say "couldn't reach the server inbox" instead of pretending it's empty.
 */

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await afetch(`${API}/notifications${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await afetch(`${API}/notifications${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const listServerNotifications = () => getJson<ServerNotification[]>("/");
export const markServerNotificationSeen = (id: number) => send<{ ok: boolean }>(`/${id}/seen`, "POST");
export const markAllServerNotificationsSeen = () => send<{ ok: boolean; marked: number }>("/seen-all", "POST");
export const clearSeenServerNotifications = () => send<{ ok: boolean; cleared: number }>("/clear-seen", "POST");
export const deleteServerNotification = (id: number) => send<{ ok: boolean }>(`/${id}`, "DELETE");
export const snoozeServerNotification = (id: number, untilIso: string) =>
  send<{ ok: boolean }>(`/${id}/snooze`, "POST", { until: untilIso });
