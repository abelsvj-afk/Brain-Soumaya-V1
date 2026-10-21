import { useEffect, useState } from "react";
import {
  fetchPushConfig,
  getExistingSubscription,
  isPushSupported,
  notificationPermission,
  subscribePush,
  unsubscribePush,
} from "../lib/pushClient.js";

/**
 * Web-push subscribe/unsubscribe toggle (Immersion Round 3, CL3).
 *
 * Self-contained: renders its OWN Settings section, or NOTHING at all.
 * It renders null while checking, when the browser lacks serviceWorker /
 * PushManager support, and when the server reports push disabled (VAPID
 * unconfigured) — no dead buttons, no placeholder UI, no console errors.
 * The only mount point is <PushToggle /> in SettingsPanel.
 */
export function PushToggle() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isPushSupported()) return;
        const cfg = await fetchPushConfig();
        if (cancelled) return;
        if (!cfg?.enabled || !cfg.vapidPublicKey) return;
        const sub = await getExistingSubscription();
        if (cancelled) return;
        setVapidPublicKey(cfg.vapidPublicKey);
        setSubscribed(!!sub);
        setDenied(notificationPermission() === "denied");
        setVisible(true);
      } catch {
        /* push stays invisible on any failure — never an error surface */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready || !visible) return null;

  const toggle = async () => {
    if (busy || denied) return;
    setBusy(true);
    setMsg("");
    try {
      if (subscribed) {
        const ok = await unsubscribePush();
        if (ok) setSubscribed(false);
        else setMsg("Couldn't unsubscribe in this browser — try again.");
      } else {
        if (!vapidPublicKey) return;
        let perm: NotificationPermission = notificationPermission() as NotificationPermission;
        if (perm === "default") {
          perm = await Notification.requestPermission();
        }
        if (perm === "denied") {
          setDenied(true);
          setMsg("Notifications are blocked for this site in your browser settings.");
          return;
        }
        if (perm !== "granted") return;
        const sub = await subscribePush(vapidPublicKey);
        if (sub) setSubscribed(true);
        else setMsg("Couldn't turn on push notifications — try again.");
      }
    } catch {
      setMsg("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3>🔔 Notifications</h3>
      <label className="settings-toggle">
        <span>
          Push notifications
          <em>
            {denied
              ? "Blocked in your browser settings — allow notifications for this site to use push."
              : subscribed
                ? "On — reminders are pushed to this device, even when the app is closed."
                : "Off — reminders stay in the app. Turn on to get them pushed to this device."}
          </em>
        </span>
        <button
          className={`switch ${subscribed ? "on" : ""}`}
          onClick={toggle}
          disabled={busy || denied}
          aria-pressed={subscribed}
          aria-label="Push notifications"
        >
          <span className="knob" />
        </button>
      </label>
      {msg && (
        <p className="settings-note" role="alert" style={{ fontSize: "12px", opacity: 0.85, margin: "6px 0 0" }}>
          {msg}
        </p>
      )}
    </section>
  );
}
