import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerNotification } from "@brain/shared";
import {
  type InboxNotification,
  type ToastAction,
  cleanupNotifications,
  readNotifications,
  writeNotifications,
  INBOX_CAP,
} from "./Toasts.js";
import {
  listServerNotifications,
  markServerNotificationSeen,
  markAllServerNotificationsSeen,
  clearSeenServerNotifications,
  deleteServerNotification,
  snoozeServerNotification,
  SERVER_INBOX_CAP,
} from "../api/notifications.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { playSfx } from "../graph/sfx.js";

/**
 * The Inbox (IM-73..77): two logs, one view.
 *  - the LOCAL toast log (this device, localStorage, INBOX_CAP entries), and
 *  - the SERVER inbox (IM-74): notifications Soumaya recorded while the user
 *    was away — digest delivered, insight created, discovery charted,
 *    bill-risk warning.
 * They are merged newest-first and deduped: the app's agent-log polling echoes
 * a proactive event (e.g. a bill-risk warning) into a local toast with the
 * same text shortly after the server recorded it — the server copy wins, so
 * the same event never shows twice.
 *
 * Retention (disclosed in the panel copy, Q7 interim default): nothing is
 * deleted automatically. Items stay until the user clears them; each log is
 * bounded only by its cap (device 100 / server 500, oldest let go past it).
 */

export interface MergedInboxItem {
  key: string;
  origin: "local" | "server";
  localId?: string;
  serverId?: number;
  text: string;
  icon: string;
  /** Epoch ms. */
  timestamp: number;
  seen: boolean;
  priority: "low" | "normal" | "high";
  /** Server source ("digest" | "insight" | "discovery" | "bill-risk" | "system"); local items are "device". */
  source: string;
  action?: ToastAction;
  /** Epoch ms until which the item is snoozed, or null. */
  snoozedUntil: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Merge the device log and the server inbox into one deduped, newest-first list. */
export function mergeInboxItems(local: InboxNotification[], server: ServerNotification[]): MergedInboxItem[] {
  const serverItems: MergedInboxItem[] = server.map((n) => {
    const ts = Date.parse(n.createdAt);
    return {
      key: `server:${n.id}`,
      origin: "server" as const,
      serverId: n.id,
      text: n.text,
      icon: n.icon,
      timestamp: Number.isNaN(ts) ? 0 : ts,
      seen: n.seen,
      priority: n.priority,
      source: n.source,
      snoozedUntil: n.snoozedUntil ? Date.parse(n.snoozedUntil) || null : null,
    };
  });
  const localItems: MergedInboxItem[] = [];
  for (const n of local) {
    // Dedupe: a local toast echoing a server-recorded event carries the same
    // text and lands after it (the echo is the app polling the agent log), so
    // an identical server text within the preceding 24h is the same event.
    const echoed = serverItems.some(
      (s) => s.text === n.text && n.timestamp >= s.timestamp && n.timestamp - s.timestamp < DAY_MS,
    );
    if (echoed) continue;
    localItems.push({
      key: `local:${n.id}`,
      origin: "local",
      localId: n.id,
      text: n.text,
      icon: n.icon,
      timestamp: n.timestamp,
      seen: n.seen,
      priority: n.priority,
      source: "device",
      action: n.action,
      snoozedUntil: n.snoozedUntil ?? null,
    });
  }
  return [...serverItems, ...localItems].sort((a, b) => b.timestamp - a.timestamp);
}

export const SOURCE_LABELS: Record<string, string> = {
  digest: "🌅 Daily digest",
  insight: "💡 Insights",
  discovery: "✦ Discoveries",
  "bill-risk": "💸 Bill risk",
  // Fix round 2: the permanent-failure item is a supported category now,
  // not a stopgap value read through a cast — a plain-language System badge.
  system: "⚙️ System",
  device: "📱 This device",
};

function dayLabel(ts: number, now: number): string {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface InboxPanelProps {
  spaceId: string;
}

export function InboxPanel({ spaceId }: InboxPanelProps) {
  const [localNotes, setLocalNotes] = useState<InboxNotification[]>([]);
  const [serverNotes, setServerNotes] = useState<ServerNotification[]>([]);
  const [serverError, setServerError] = useState(false);
  const [filter, setFilter] = useState<"all" | "unseen" | "seen">("unseen");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high">("all");
  const [groupBy, setGroupBy] = useState<"day" | "source">("day");
  const [confirmClear, setConfirmClear] = useState(false);
  const now = Date.now();

  const loadLocal = useCallback(() => {
    setLocalNotes(readNotifications(spaceId));
  }, [spaceId]);

  const loadServer = useCallback(async () => {
    const list = await listServerNotifications();
    if (list === null) {
      setServerError(true);
    } else {
      setServerError(false);
      setServerNotes(list);
    }
  }, []);

  useEffect(() => {
    // Trim an over-cap log BEFORE the first read (retention is cap-only now —
    // nothing is pruned by age; see Toasts.cleanupNotifications).
    cleanupNotifications(spaceId);
    loadLocal();
    void loadServer();

    window.addEventListener("brain-notifications-updated", loadLocal);
    // Real cross-tab sync for the device log.
    window.addEventListener("storage", loadLocal);
    return () => {
      window.removeEventListener("brain-notifications-updated", loadLocal);
      window.removeEventListener("storage", loadLocal);
    };
  }, [spaceId, loadLocal, loadServer]);

  const items = useMemo(() => mergeInboxItems(localNotes, serverNotes), [localNotes, serverNotes]);
  const isSnoozed = useCallback((i: MergedInboxItem) => i.snoozedUntil !== null && i.snoozedUntil > Date.now(), []);
  const unseenList = useMemo(() => items.filter((i) => !i.seen && !isSnoozed(i)), [items, isSnoozed]);
  const seenList = useMemo(() => items.filter((i) => i.seen), [items]);

  // Inbox-zero chime: only on the actual >0 → 0 transition of the merged
  // unseen count, never on a fresh mount that starts empty.
  const prevUnseenCount = useRef<number | null>(null);
  useEffect(() => {
    const count = unseenList.length;
    if (prevUnseenCount.current !== null && prevUnseenCount.current > 0 && count === 0) {
      playSfx("chime");
    }
    prevUnseenCount.current = count;
  }, [unseenList.length]);

  /** Local-log mutations re-read storage first (a toast may have appended
   *  since the last render) — read → modify → write → announce. */
  const mutateLocal = useCallback(
    (fn: (list: InboxNotification[]) => InboxNotification[]) => {
      const next = fn(readNotifications(spaceId));
      writeNotifications(next, spaceId);
      setLocalNotes(next);
    },
    [spaceId],
  );

  const handleMarkSeen = (item: MergedInboxItem) => {
    if (item.origin === "local" && item.localId) {
      mutateLocal((list) => list.map((n) => (n.id === item.localId ? { ...n, seen: true, seenAt: Date.now() } : n)));
    } else if (item.serverId !== undefined) {
      const id = item.serverId;
      void markServerNotificationSeen(id).then((res) => {
        if (res) setServerNotes((cur) => cur.map((n) => (n.id === id ? { ...n, seen: true, seenAt: new Date().toISOString() } : n)));
        else void loadServer();
      });
    }
  };

  const handleDelete = (item: MergedInboxItem) => {
    if (item.origin === "local" && item.localId) {
      mutateLocal((list) => list.filter((n) => n.id !== item.localId));
    } else if (item.serverId !== undefined) {
      const id = item.serverId;
      void deleteServerNotification(id).then((res) => {
        if (res) setServerNotes((cur) => cur.filter((n) => n.id !== id));
        else void loadServer();
      });
    }
  };

  const handleSnooze = (item: MergedInboxItem) => {
    const until = Date.now() + DAY_MS; // snooze for a day; it resurfaces in Unseen after
    if (item.origin === "local" && item.localId) {
      mutateLocal((list) => list.map((n) => (n.id === item.localId ? { ...n, snoozedUntil: until } : n)));
    } else if (item.serverId !== undefined) {
      const id = item.serverId;
      const untilIso = new Date(until).toISOString();
      void snoozeServerNotification(id, untilIso).then((res) => {
        if (res) setServerNotes((cur) => cur.map((n) => (n.id === id ? { ...n, snoozedUntil: untilIso } : n)));
        else void loadServer();
      });
    }
  };

  const handleMarkAllSeen = () => {
    mutateLocal((list) =>
      list.map((n) => (n.seen || (n.snoozedUntil && n.snoozedUntil > Date.now()) ? n : { ...n, seen: true, seenAt: Date.now() })),
    );
    void markAllServerNotificationsSeen().then(() => void loadServer());
  };

  const handleClearHistory = () => {
    setConfirmClear(false);
    mutateLocal((list) => list.filter((n) => !n.seen));
    void clearSeenServerNotifications().then(() => void loadServer());
  };

  // InboxNotification used to drop the `action` field entirely, so every logged
  // notification was permanently inert once it landed here. Reuses the exact
  // event Toasts.tsx's own runAction() dispatches.
  const runAction = (item: MergedInboxItem) => {
    if (!item.action) return;
    try {
      window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: item.action }));
    } catch {
      /* no window */
    }
  };

  const displayed = useMemo(() => {
    let list = filter === "unseen" ? unseenList : filter === "seen" ? seenList : items;
    if (priorityFilter === "high") list = list.filter((i) => i.priority === "high");
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => i.text.toLowerCase().includes(q));
    return list;
  }, [filter, unseenList, seenList, items, priorityFilter, query]);

  const groups = useMemo(() => {
    const out: { label: string; items: MergedInboxItem[] }[] = [];
    const byLabel = new Map<string, MergedInboxItem[]>();
    for (const item of displayed) {
      const label = groupBy === "day" ? dayLabel(item.timestamp, now) : (SOURCE_LABELS[item.source] ?? item.source);
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(item);
      else {
        const fresh: MergedInboxItem[] = [item];
        byLabel.set(label, fresh);
        out.push({ label, items: fresh });
      }
    }
    return out;
    // `now` is render-time only (group boundaries); items drive the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, groupBy]);

  const emptyMessage =
    query.trim() !== ""
      ? "No notifications match your search."
      : filter === "unseen"
        ? "Your inbox is completely clear! 🚀 When Soumaya finishes a digest, spots an insight or discovery, or flags a bill risk while you're away, it will land here."
        : filter === "seen"
          ? "Nothing in history yet. Notifications you've marked seen live here until you clear them."
          : "No notifications yet. Digests, insights, discoveries, and bill-risk warnings Soumaya creates will appear here — along with toasts from this device.";

  return (
    <div className="dock-body notification-inbox">
      <div className="dock-head">
        <h3>🔔 Inbox</h3>
        {unseenList.length > 0 && (
          <button onClick={handleMarkAllSeen} className="mini">
            Mark All Read
          </button>
        )}
      </div>

      <p className="section-desc">
        What Soumaya did while you were away — a finished daily digest, new insights and discoveries, bill-risk
        warnings — plus every toast from this device. Nothing here is deleted automatically: notifications stay
        until you clear them. This device keeps the {INBOX_CAP} most recent; the server inbox keeps the{" "}
        {SERVER_INBOX_CAP} most recent — only past those caps are the oldest let go.
      </p>

      {serverError && (
        <p className="inbox-error" role="alert">
          Couldn't reach the server inbox — showing this device's log only.{" "}
          <button className="mini" onClick={() => void loadServer()}>
            Retry
          </button>
        </p>
      )}

      <div className="inbox-tools">
        <input
          className="inbox-search"
          type="search"
          placeholder="Search notifications…"
          aria-label="Search notifications"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="inbox-select"
          aria-label="Priority filter"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as "all" | "high")}
        >
          <option value="all">All priorities</option>
          <option value="high">Important only</option>
        </select>
        <select
          className="inbox-select"
          aria-label="Group by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "day" | "source")}
        >
          <option value="day">Group by day</option>
          <option value="source">Group by source</option>
        </select>
      </div>

      {/* Filter Tabs */}
      <div className="inbox-tabs">
        <button className={`inbox-tab ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
          All ({items.length})
        </button>
        <button className={`inbox-tab ${filter === "unseen" ? "on" : ""}`} onClick={() => setFilter("unseen")}>
          Inbox
          {unseenList.length > 0 && <span className="inbox-badge">{unseenList.length}</span>}
        </button>
        <button className={`inbox-tab ${filter === "seen" ? "on" : ""}`} onClick={() => setFilter("seen")}>
          History ({seenList.length})
        </button>
      </div>

      {/* List */}
      <div className="inbox-list">
        {displayed.length === 0 ? (
          <div className="inbox-empty">{emptyMessage}</div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="inbox-group">
              <h4 className="inbox-group-head">{group.label}</h4>
              {group.items.map((item) => {
                const isHigh = item.priority === "high";
                const snoozed = isSnoozed(item);
                return (
                  <div
                    key={item.key}
                    className={`inbox-row ${isHigh && !item.seen ? "high" : ""}`}
                    role={item.action ? "button" : undefined}
                    tabIndex={item.action ? 0 : undefined}
                    onClick={item.action ? () => runAction(item) : undefined}
                    onKeyDown={
                      item.action
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              runAction(item);
                            }
                          }
                        : undefined
                    }
                  >
                    <span className="inbox-row-icon">{item.icon}</span>
                    <div className="inbox-row-main">
                      <div className="inbox-row-text">
                        {item.text}
                        {item.action && <span aria-hidden> ›</span>}
                      </div>
                      <div className="inbox-row-meta">
                        <span>
                          {formatRelative(item.timestamp, now)} · {formatAbsolute(item.timestamp)}
                        </span>
                        {isHigh && <span className="inbox-tag important">IMPORTANT</span>}
                        {item.seen && <span className="inbox-tag">Seen</span>}
                        {snoozed && (
                          <span className="inbox-tag">
                            Snoozed until {new Date(item.snoozedUntil!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                        <span className="inbox-tag">{SOURCE_LABELS[item.source] ?? item.source}</span>
                      </div>
                    </div>
                    <div className="inbox-row-actions">
                      {!item.seen && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMarkSeen(item); }}
                          title="Mark as seen"
                          aria-label="Mark as seen"
                        >
                          ✓
                        </button>
                      )}
                      {!item.seen && !snoozed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSnooze(item); }}
                          title="Snooze for a day"
                          aria-label="Snooze for a day"
                        >
                          ⏰
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                        title="Delete notification"
                        aria-label="Delete notification"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {filter === "seen" && seenList.length > 0 && (
        <button onClick={() => setConfirmClear(true)} className="inbox-clear-btn">
          Clear History
        </button>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear History"
          message={`Clear ${seenList.length} seen notification${seenList.length === 1 ? "" : "s"}? This can't be undone.`}
          confirmLabel="Clear History"
          onConfirm={handleClearHistory}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
