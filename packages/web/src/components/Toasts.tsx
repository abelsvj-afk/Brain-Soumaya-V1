import { useEffect, useRef, useState } from "react";
import { playSfx } from "../graph/sfx.js";
import { formatToastTime, toastPriorityLabel } from "./cl1a.helpers.js";

/**
 * Lightweight celebratory toast system (gamification Wave 1). Fire from anywhere
 * with `pushToast(...)`; the <Toasts/> overlay renders + auto-dismisses them.
 * Deliberately dependency-free + offline-safe — pure in-app, no network.
 */
/** Where a clickable notification takes you when tapped. */
export interface ToastAction {
  kind: "focus" | "tab" | "panel" | "chat";
  value?: string | number;
}

export interface Toast {
  id: number;
  text: string;
  icon: string;
  ttl: number;
  priority?: "low" | "normal" | "high";
  action?: ToastAction;
  /** IM-05: when the toast fired — rendered as a local time on the live toast. */
  createdAt: number;
}

export interface InboxNotification {
  id: string;
  text: string;
  icon: string;
  timestamp: number;
  seen: boolean;
  seenAt: number | null;
  priority: "low" | "normal" | "high";
  /** Where tapping this notification later (from the Inbox, once archived) takes
   *  you — the transient Toast carries this, but it used to be dropped the moment
   *  a toast was logged, making every archived notification permanently unclickable. */
  action?: ToastAction;
  /** IM-75: snoozed until this epoch-ms instant — hidden from Unseen until then. */
  snoozedUntil?: number | null;
}

/** How many notifications the inbox log keeps. Defined once — InboxPanel used to
 *  render the list assuming it was bounded by this number without knowing it. */
export const INBOX_CAP = 100;

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let nextId = 1;

// Transient-display gate: while paused (e.g. the Observatory home is open over the
// galaxy), toasts are buffered instead of shown — they still get logged to the
// inbox — then flushed once unpaused, so a celebration never hides behind the cards.
let paused = false;
// Focus mode (#2) QUIETS non-essential toasts: low/normal are buffered for a calm
// reading session; only high-priority (she's hailing, rank-up) still breaks through.
let quiet = false;
const buffer: Toast[] = [];
// Unbounded buffering used to mean a long pause (or a stuck quiet mode) could pile
// up an ever-growing queue that all landed at once on flush. Cap it and drop the
// oldest non-high entries first — a high-priority toast is rare and worth keeping.
const MAX_BUFFER = 30;
/** First-run calm (docs/specs/first-run-calm-2026-10-30.md): a held queue releases at most this many at once; the rest
 *  are already in the Inbox and are summarised by one note that opens it. */
export const FLUSH_MAX = 2;
/** At most this many toasts on screen at once. */
export const VISIBLE_MAX = 3;
function maybeFlush(): void {
  if (paused || buffer.length === 0) return;
  // The buffer can hold a mix of "paused-buffered" (any priority) and
  // "quiet-buffered" (low/normal only) entries. Unpausing while STILL quiet must
  // only release what quiet mode would show live — releasing everything used to
  // reveal quiet-gated toasts the moment pause lifted, even though quiet was
  // never turned off.
  const releasable = quiet ? buffer.filter((t) => t.priority === "high") : buffer.slice();
  if (releasable.length === 0) return;
  const releasedIds = new Set(releasable.map((t) => t.id));
  for (let i = buffer.length - 1; i >= 0; i--) {
    const entry = buffer[i];
    if (entry && releasedIds.has(entry.id)) buffer.splice(i, 1);
  }
  // Show the most important, then the newest — never a wall of them. Every one is already in the Inbox.
  const rank = (t: Toast) => (t.priority === "high" ? 2 : t.priority === "normal" ? 1 : 0);
  // Ids grow with every push, so they order "newest" even when several land in the same millisecond.
  const shown = [...releasable].sort((a, b) => rank(b) - rank(a) || b.id - a.id).slice(0, FLUSH_MAX);
  shown.sort((a, b) => a.id - b.id);
  const rest = releasable.length - shown.length;
  for (const t of shown) {
    for (const l of listeners) l(t);
    playSfx(t.priority === "high" ? "achievement" : "notify"); // flushed toasts used to play no sound at all
  }
  if (rest > 0) {
    const note: Toast = {
      id: nextId++,
      text: `${rest} more in your Inbox`,
      icon: "📥",
      ttl: 6000,
      priority: "low",
      action: { kind: "tab", value: "inbox" },
      createdAt: Date.now(),
    };
    for (const l of listeners) l(note);
  }
}
export function setToastsPaused(p: boolean): void {
  if (p === paused) return;
  paused = p;
  if (!paused) maybeFlush();
}
export function setToastsQuiet(q: boolean): void {
  if (q === quiet) return;
  quiet = q;
  if (!quiet) maybeFlush();
}

/**
 * The one definition of the inbox storage key. `pushToast` writes to the canonical
 * `brain.spaceId` bucket (set at login) while InboxPanel used to build the key from a
 * prop — two sources for the same key, one prop-plumbing mistake away from the writer
 * and reader pointing at different buckets. Callers pass the id they have; passing
 * nothing resolves the canonical one.
 */
export function notificationsKey(spaceId?: string): string {
  const id = spaceId ?? (() => {
    try {
      return localStorage.getItem("brain.spaceId") || "default";
    } catch {
      return "default";
    }
  })();
  return `brain.notifications.${id}`;
}

/** Read the inbox log from storage. Always the source of truth — never React state. */
export function readNotifications(spaceId?: string): InboxNotification[] {
  try {
    const raw = localStorage.getItem(notificationsKey(spaceId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as InboxNotification[]) : [];
  } catch {
    return [];
  }
}

/** Persist the inbox log and tell every listener (this tab) to re-read. */
export function writeNotifications(list: InboxNotification[], spaceId?: string): void {
  try {
    localStorage.setItem(notificationsKey(spaceId), JSON.stringify(list.slice(-INBOX_CAP)));
    window.dispatchEvent(new Event("brain-notifications-updated"));
  } catch (e) {
    console.error("Failed to write notifications", e);
  }
}

/**
 * Retention (IM-73, honest policy): notifications are NEVER deleted by age —
 * seen or unseen, they persist until the user clears them. The only bound is
 * INBOX_CAP: the log keeps the most recent INBOX_CAP entries (enforced on every
 * write by writeNotifications). This used to delete seen items 5 minutes after
 * they were read and unseen normal items after 24h, so "History" was a
 * ≤5-minute window the panel copy never disclosed. Cleanup now only trims an
 * over-cap log (e.g. one written before the cap, or by an older build).
 */
export function cleanupNotifications(spaceId: string): void {
  try {
    const list = readNotifications(spaceId);
    if (list.length <= INBOX_CAP) return;
    // Only write + announce when something actually changed. Cleanup used to write
    // silently, so a panel that had already loaded kept stale rows in state — and the
    // next Mark-All-Read/Clear-History wrote that stale array straight back, RESURRECTING
    // everything cleanup had just trimmed. Announcing makes readers re-sync.
    writeNotifications(list, spaceId); // writeNotifications applies the cap
  } catch (e) {
    console.error("Failed to cleanup notifications", e);
  }
}

/** Show a transient toast (top-center). Default to 8 seconds. */
export function pushToast(
  text: string,
  icon = "✨",
  ttl = 8000,
  priority: "low" | "normal" | "high" = "normal",
  action?: ToastAction,
): void {
  // Duplicate-spam guard, checked BEFORE anything is shown/logged — this used to
  // run only against the inbox log, after the transient toast had already been
  // shown/sounded, so a rapid duplicate would display (and chime) twice while
  // only ever being logged once.
  let list: InboxNotification[] = [];
  try {
    list = readNotifications();
    const lastMsg = list[list.length - 1];
    if (lastMsg && lastMsg.text === text && Date.now() - lastMsg.timestamp < 1000) return;
  } catch {
    list = [];
  }

  const t: Toast = { id: nextId++, text, icon, ttl, priority, action, createdAt: Date.now() };
  // Buffer when paused, or when quieted (focus mode) unless it's high-priority.
  if (paused || (quiet && priority !== "high")) {
    buffer.push(t); // still logged to inbox below
    if (buffer.length > MAX_BUFFER) {
      const dropIdx = buffer.findIndex((b) => b.priority !== "high");
      buffer.splice(dropIdx === -1 ? 0 : dropIdx, 1);
    }
  } else {
    for (const l of listeners) l(t);
    playSfx(priority === "high" ? "achievement" : "notify"); // audible cue when shown
  }

  // Write to the notification inbox log (scoped to space, via the shared key helper
  // so the writer and the inbox reader can never point at different buckets).
  try {
    const newNote: InboxNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      text,
      icon,
      timestamp: Date.now(),
      seen: false,
      seenAt: null,
      priority,
      action,
    };
    list.push(newNote);
    writeNotifications(list);
  } catch (e) {
    console.error("Failed to append to notification inbox", e);
  }
}

export function Toasts() {
  const [items, setItems] = useState<(Toast & { remaining: number })[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const hoveredIdRef = useRef<number | null>(null);
  const [overflowCount, setOverflowCount] = useState(0);
  const droppedIdsRef = useRef<Set<number>>(new Set());
  const overflowTimerRef = useRef<number | null>(null);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    const add: Listener = (t) => {
      setItems((cur) => {
        const merged = [...cur, { ...t, remaining: t.ttl }];
        // Silently dropping the overflow (a burst of >4 celebrations landing at
        // once) left no trace anything happened at all. Note it instead — each
        // dropped id counted exactly once even if this updater re-runs (e.g.
        // React StrictMode's double-invoke in dev).
        if (merged.length > VISIBLE_MAX) {
          for (const dropped of merged.slice(0, merged.length - VISIBLE_MAX)) {
            if (!droppedIdsRef.current.has(dropped.id)) {
              droppedIdsRef.current.add(dropped.id);
              setOverflowCount((c) => c + 1);
            }
          }
        }
        return merged.slice(-VISIBLE_MAX);
      });
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  useEffect(() => {
    if (overflowCount === 0) return;
    if (overflowTimerRef.current) window.clearTimeout(overflowTimerRef.current);
    overflowTimerRef.current = window.setTimeout(() => setOverflowCount(0), 5000);
    return () => {
      if (overflowTimerRef.current) window.clearTimeout(overflowTimerRef.current);
    };
  }, [overflowCount]);

  // Periodic interval countdown: pause countdown if the toast is hovered. A single
  // interval created once — reading hoveredId via a ref, not a dependency — so
  // hovering doesn't tear down and recreate the interval on every enter/leave
  // (which used to reset its 200ms phase and let a toast linger past its real TTL
  // whenever the pointer moved across toasts, e.g. toward the × button).
  useEffect(() => {
    const timer = setInterval(() => {
      setItems((cur) => {
        return cur
          .map((item) => {
            if (hoveredIdRef.current === item.id) {
              return item; // pause timer for hovered toast
            }
            return { ...item, remaining: item.remaining - 200 };
          })
          .filter((item) => item.remaining > 0);
      });
    }, 200);
    return () => clearInterval(timer);
  }, []);

  const removeToast = (id: number) => {
    setItems((cur) => cur.filter((x) => x.id !== id));
    if (hoveredId === id) setHoveredId(null);
  };

  const runAction = (t: Toast & { remaining: number }) => {
    if (!t.action) return;
    try { window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: t.action })); } catch { /* no window */ }
    removeToast(t.id);
  };

  // Batch I (REG-072 / GH-21): the overflow chip is a real link — the
  // same tab action every actionable toast dispatches. The App listener
  // already routes kind:"tab" to the dock; Inbox is a dock tab.
  const openInbox = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("brain-toast-action", { detail: { kind: "tab", value: "inbox" } }),
      );
    } catch { /* no window */ }
  };

  if (items.length === 0 && overflowCount === 0) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.action ? "actionable" : ""} ${t.priority ? `priority-${t.priority}` : ""}`}
          onMouseEnter={() => setHoveredId(t.id)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={t.action ? () => runAction(t) : undefined}
          onKeyDown={
            t.action
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    runAction(t);
                  }
                }
              : undefined
          }
          role={t.action ? "button" : undefined}
          tabIndex={t.action ? 0 : undefined}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1 }}>
            <span className="toast-ic">{t.icon}</span>
            <span className="toast-msg">{t.text}</span>
            {toastPriorityLabel(t.priority) && (
              <span className={`toast-priority priority-${t.priority}`}>{toastPriorityLabel(t.priority)}</span>
            )}
            <time className="toast-time" dateTime={new Date(t.createdAt).toISOString()}>{formatToastTime(t.createdAt)}</time>
            {t.action && <span className="toast-go" aria-hidden>›</span>}
          </div>
          <button
            className="toast-dismiss"
            onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
      {overflowCount > 0 && (
        <div
          className="toast toast-overflow actionable"
          role="button"
          tabIndex={0}
          onClick={openInbox}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openInbox();
            }
          }}
          title="Open the Inbox to see them all"
        >
          <span className="toast-ic" aria-hidden>➕</span>
          <span className="toast-msg">
            {overflowCount} more notification{overflowCount === 1 ? "" : "s"} — see Inbox
          </span>
        </div>
      )}
    </div>
  );
}
