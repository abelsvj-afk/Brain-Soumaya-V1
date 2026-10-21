/**
 * Web-push client helpers (Immersion Round 3, CL3).
 *
 * Feature-detection is the contract: push UI may exist ONLY when the
 * browser supports service workers + PushManager AND the server reports
 * push enabled (VAPID configured). Every helper here fails soft (null /
 * false) so a missing capability can never throw into the UI.
 */

import { API, afetch } from "../api/http.js";

export interface PushConfig {
  enabled: boolean;
  vapidPublicKey: string | null;
}

/** True only when this browser can actually receive web push. */
export function isPushSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof PushManager !== "undefined" &&
      typeof Notification !== "undefined"
    );
  } catch {
    return false;
  }
}

/** Current Notification permission, or "unsupported" when unavailable. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

/** Convert a base64url VAPID public key to the Uint8Array subscribe() wants. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Server push config; null when the server can't be reached. */
export async function fetchPushConfig(): Promise<PushConfig | null> {
  try {
    const res = await afetch(`${API}/push/config`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<PushConfig>;
    return {
      enabled: body.enabled === true,
      vapidPublicKey: typeof body.vapidPublicKey === "string" ? body.vapidPublicKey : null,
    };
  } catch {
    return null;
  }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (!isPushSupported()) return null;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** The browser's current push subscription, if any. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribe this browser and register the subscription with the server.
 * Assumes notification permission was already granted by the caller.
 * Returns the subscription, or null on any failure (nothing is stored
 * server-side unless the browser subscription itself succeeded).
 */
export async function subscribePush(vapidPublicKey: string): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  try {
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      }));
    const json = sub.toJSON();
    const res = await afetch(`${API}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...json, userAgent: navigator.userAgent }),
    });
    if (!res.ok) {
      // Server refused (e.g. push was disabled after config loaded) — undo
      // the browser subscription so local and server state can't diverge.
      if (!existing) await sub.unsubscribe().catch(() => {});
      return null;
    }
    return sub;
  } catch {
    return null;
  }
}

/** Unsubscribe this browser and tell the server to drop the endpoint. */
export async function unsubscribePush(): Promise<boolean> {
  const sub = await getExistingSubscription();
  if (!sub) return true; // nothing subscribed — already the desired state
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    return false;
  }
  try {
    await afetch(`${API}/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* browser is unsubscribed; a stale server row self-prunes on next 410 */
  }
  return true;
}
