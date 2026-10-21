import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { type GraphNode, EARN_ACTION_DONE, ACTION_DONE_MIN_AGE_MINUTES } from "@brain/shared";
import { deleteNode, ackReminder, ingestText, updateAgendaItem } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { isReminderDue, parseTolerantMs as ms } from "../utils/dueReminders.js";

interface Props {
  nodes: GraphNode[];
  onFocus: (id: number) => void;
  /** Called after an action is cleared so the galaxy + fuel refresh. */
  onChanged?: () => void;
}

function earnsFuel(n: Pick<GraphNode, "createdAt">): boolean {
  const created = ms(n.createdAt);
  if (Number.isNaN(created)) return false;
  return Date.now() - created >= ACTION_DONE_MIN_AGE_MINUTES * 60_000;
}

const LIST_SHOWN_CAP = 50;

/** "in 5h" / "in 3d" / "overdue 2d" from a future-ish timestamp. */
export function countdown(target: number): { text: string; urgent: boolean; over: boolean } {
  const diff = target - Date.now();
  if (Number.isNaN(target)) return { text: "", urgent: false, over: false };
  if (diff <= 0) {
    const overdueH = -diff / 3.6e6;
    const text =
      overdueH < 1 ? `overdue ${Math.max(1, Math.round(-diff / 6e4))}m` : overdueH < 24 ? `overdue ${Math.round(overdueH)}h` : `overdue ${Math.round(overdueH / 24)}d`;
    return { text, urgent: true, over: true };
  }
  const h = diff / 3.6e6;
  if (h < 1) return { text: `in ${Math.max(1, Math.round(diff / 6e4))}m`, urgent: true, over: false };
  if (h < 24) return { text: `in ${Math.round(h)}h`, urgent: h < 6, over: false };
  return { text: `in ${Math.round(h / 24)}d`, urgent: false, over: false };
}

/** Full user-local timestamp, matching the upcoming-reminders format (IM-52). */
export function formatLocalTime(ts: number): string {
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function formatLocalDate(ts: number): string {
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Day grouping for Agenda rows (IM-53): Overdue / Today / Tomorrow / This week / Later / No date. */
export function dayGroupFor(ts: number, now: number = Date.now()): { key: string; label: string; rank: number } {
  if (Number.isNaN(ts)) return { key: "nodate", label: "No date", rank: 5 };
  const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / 8.64e7);
  if (days < 0) return { key: "overdue", label: "Overdue", rank: 0 };
  if (days === 0) return { key: "today", label: "Today", rank: 1 };
  if (days === 1) return { key: "tomorrow", label: "Tomorrow", rank: 2 };
  if (days <= 7) return { key: "week", label: "This week", rank: 3 };
  return { key: "later", label: "Later", rank: 4 };
}

function toLocalInputValue(ts: number): string {
  if (Number.isNaN(ts)) return "";
  const d = new Date(ts);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function matchesQuery(n: GraphNode, needle: string): boolean {
  if (!needle) return true;
  const hay = `${n.label} ${n.content ?? ""} ${(n.tags ?? []).join(" ")}`.toLowerCase();
  return hay.includes(needle);
}

function RowMeta({ n }: { n: GraphNode }) {
  const created = ms(n.createdAt);
  const snippet = (n.content ?? "").trim();
  return (
    <>
      {snippet && snippet !== n.label && (
        <span className="agenda-snippet" style={{ display: "block", fontSize: "11px", opacity: 0.75 }}>
          {snippet.length > 90 ? `${snippet.slice(0, 90)}…` : snippet}
        </span>
      )}
      {(n.tags?.length || !Number.isNaN(created)) && (
        <span className="agenda-meta" style={{ display: "block", fontSize: "11px", opacity: 0.65 }}>
          {(n.tags ?? []).map((t) => `#${t}`).join(" ")}
          {(n.tags?.length && !Number.isNaN(created)) ? " · " : ""}
          {!Number.isNaN(created) ? `Added ${formatLocalDate(created)}` : ""}
        </span>
      )}
    </>
  );
}

type ConfirmState = { kind: "done" | "dismiss"; id: number; label: string } | null;

export function ActionsPanel({ nodes, onFocus, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "action" | "reminder">("all");
  const [expanded, setExpanded] = useState<{ due: boolean; actions: boolean; upcoming: boolean }>({ due: false, actions: false, upcoming: false });
  const [confirming, setConfirming] = useState<ConfirmState>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editWhen, setEditWhen] = useState("");
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<"action" | "reminder">("action");
  const [newWhen, setNewWhen] = useState("");
  const [creating, setCreating] = useState(false);

  const actionsAll = useMemo(
    () => nodes.filter((n) => n.kind === "action").map((n) => ({ n, due: ms(n.expiresAt) })).sort((a, b) => (a.due || Infinity) - (b.due || Infinity)),
    [nodes],
  );
  const prevActionCount = useRef<number | null>(null);
  useEffect(() => {
    const count = actionsAll.length;
    if (prevActionCount.current !== null && prevActionCount.current > 0 && count === 0) {
      playSfx("milestone");
      pushToast("Agenda Zero — every action item cleared. 🎯", "🎯", 4500);
    }
    prevActionCount.current = count;
  }, [actionsAll.length]);

  const [acked, setAcked] = useState<Set<number>>(new Set());
  useEffect(() => {
    setAcked((prev) => {
      if (prev.size === 0) return prev;
      const stillNeeded = new Set<number>();
      for (const id of prev) {
        const n = nodes.find((x) => x.id === id);
        if (n && n.remindAt) stillNeeded.add(id);
      }
      return stillNeeded.size === prev.size ? prev : stillNeeded;
    });
  }, [nodes]);

  const allReminders = useMemo(
    () => nodes.filter((n) => n.kind !== "action" && n.kind !== "life_vision" && n.remindAt).map((n) => ({ n, at: ms(n.remindAt) })).sort((a, b) => a.at - b.at),
    [nodes],
  );
  const { dueRemindersAll, remindersAll } = useMemo(() => {
    const now = Date.now();
    return {
      dueRemindersAll: allReminders.filter(({ n }) => isReminderDue(n, now) && !acked.has(n.id)),
      remindersAll: allReminders.filter(({ at }) => at > now),
    };
  }, [allReminders, acked]);

  const needle = query.trim().toLowerCase();
  const actions = useMemo(() => (kindFilter === "reminder" ? [] : actionsAll.filter(({ n }) => matchesQuery(n, needle))), [actionsAll, needle, kindFilter]);
  const dueReminders = useMemo(() => (kindFilter === "action" ? [] : dueRemindersAll.filter(({ n }) => matchesQuery(n, needle))), [dueRemindersAll, needle, kindFilter]);
  const reminders = useMemo(() => (kindFilter === "action" ? [] : remindersAll.filter(({ n }) => matchesQuery(n, needle))), [remindersAll, needle, kindFilter]);

  const done = (n: GraphNode) => {
    setConfirming(null);
    // Living Galaxy (IM-140a): the completed task becomes a satellite —
    // dispatched BEFORE the delete so the galaxy can still see its position.
    window.dispatchEvent(new CustomEvent("brain-task-completed", { detail: { id: n.id } }));
    deleteNode(n.id)
      .then(() => {
        playSfx("complete");
        pushToast(earnsFuel(n) ? `"${n.label.slice(0, 30)}" cleared (+${EARN_ACTION_DONE} ⛽)` : `"${n.label.slice(0, 30)}" cleared ✓`, "✅", 3000);
        onChanged?.();
      })
      .catch(() => pushToast("Couldn't clear that — try again.", "⚠️", 3500));
  };

  const ack = (id: number, silentLabel?: string) => {
    setConfirming(null);
    // ackReminder's client contract returns a boolean and never throws on HTTP
    // failure — honour it, otherwise a failed ack would look like success.
    Promise.resolve(ackReminder(id))
      .then((ok) => {
        if (ok === false) { pushToast("Couldn't acknowledge that reminder — try again.", "⚠️", 3500); return; }
        setAcked((s) => new Set(s).add(id));
        pushToast(silentLabel ? `Reminder for "${silentLabel.slice(0, 30)}" dismissed ✓` : "Reminder acknowledged ✓", "🔔", 3000);
        onChanged?.();
      })
      .catch(() => pushToast("Couldn't acknowledge that reminder — try again.", "⚠️", 3500));
  };

  const snooze = (n: GraphNode, field: "remindAt" | "expiresAt", aheadMs: number, label: string) => {
    const when = new Date(Date.now() + aheadMs).toISOString();
    updateAgendaItem(n.id, { [field]: when })
      .then(() => { pushToast(`Snoozed "${n.label.slice(0, 30)}" — ${label} (${formatLocalTime(Date.parse(when))})`, "💤", 3000); onChanged?.(); })
      .catch(() => pushToast("Couldn't snooze that — try again.", "⚠️", 3500));
  };

  const startEdit = (n: GraphNode, currentTs: number) => {
    setEditingId(n.id); setEditLabel(n.label); setEditContent(n.content ?? ""); setEditWhen(toLocalInputValue(currentTs));
  };
  const saveEdit = (n: GraphNode, field: "remindAt" | "expiresAt") => {
    const whenMs = editWhen ? new Date(editWhen).getTime() : NaN;
    const patch: { label?: string; content?: string; remindAt?: string | null; expiresAt?: string | null } = {
      label: editLabel.trim() || n.label,
      content: editContent,
      [field]: Number.isNaN(whenMs) ? null : new Date(whenMs).toISOString(),
    };
    updateAgendaItem(n.id, patch)
      .then(() => { setEditingId(null); pushToast(`"${(patch.label ?? n.label).slice(0, 30)}" updated ✓`, "✏️", 3000); onChanged?.(); })
      .catch(() => pushToast("Couldn't save that edit — try again.", "⚠️", 3500));
  };

  const create = () => {
    const text = newText.trim();
    if (!text) { pushToast("Write what needs doing first.", "⚠️", 3000); return; }
    setCreating(true);
    const finish = (okMsg: string) => { setCreating(false); setNewText(""); setNewWhen(""); pushToast(okMsg, "✅", 3000); onChanged?.(); };
    const fail = () => { setCreating(false); pushToast("Couldn't add that — try again.", "⚠️", 3500); };
    if (newKind === "reminder") {
      const whenMs = newWhen ? new Date(newWhen).getTime() : NaN;
      if (Number.isNaN(whenMs)) { setCreating(false); pushToast("Pick a date and time for the reminder.", "⚠️", 3000); return; }
      ingestText(text, { remindAt: new Date(whenMs).toISOString() })
        .then(() => finish(`Reminder added for ${formatLocalTime(whenMs)} ✓`))
        .catch(fail);
    } else {
      const whenMs = newWhen ? new Date(newWhen).getTime() : NaN;
      const ttlHours = Number.isNaN(whenMs) ? 24 : Math.min(24 * 30, Math.max(1, Math.round((whenMs - Date.now()) / 3.6e6)));
      ingestText(text, { kind: "action", ttlHours })
        .then(() => finish("Action item added ✓"))
        .catch(fail);
    }
  };

  const createForm = (
    <div className="agenda-create" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <h3 className="agenda-h">➕ Add to your agenda</h3>
      <input aria-label="New agenda item" placeholder="What needs doing?" value={newText} onChange={(e) => setNewText(e.target.value)} />
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="New item type" value={newKind} onChange={(e) => setNewKind(e.target.value as "action" | "reminder")}>
          <option value="action">📌 Action item</option>
          <option value="reminder">🔔 Reminder</option>
        </select>
        <input aria-label="New item date and time" type="datetime-local" value={newWhen} onChange={(e) => setNewWhen(e.target.value)} />
        <button className="mini" onClick={create} disabled={creating}>Add</button>
      </div>
    </div>
  );

  const editForm = (n: GraphNode, field: "remindAt" | "expiresAt") => editingId === n.id && (
    <div className="agenda-edit" style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      <input aria-label="Edit label" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
      <textarea aria-label="Edit details" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} />
      <input aria-label="Edit date and time" type="datetime-local" value={editWhen} onChange={(e) => setEditWhen(e.target.value)} />
      <div style={{ display: "flex", gap: "6px" }}>
        <button className="mini" onClick={() => saveEdit(n, field)}>Save changes</button>
        <button className="mini" onClick={() => setEditingId(null)}>Cancel edit</button>
      </div>
    </div>
  );

  const confirmBar = (c: NonNullable<ConfirmState>, onConfirm: () => void) => (
    <div className="agenda-confirm" role="alertdialog" aria-label="Confirm" style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
      <span>{c.kind === "done" ? `Mark "${c.label.slice(0, 30)}" done? This deletes the action item.` : `Dismiss the reminder for "${c.label.slice(0, 30)}"? This cancels it permanently.`}</span>
      <button className="mini" onClick={onConfirm}>{c.kind === "done" ? "Confirm done" : "Confirm dismiss"}</button>
      <button className="mini" onClick={() => setConfirming(null)}>Keep it</button>
    </div>
  );

  const snoozeButtons = (n: GraphNode, field: "remindAt" | "expiresAt") => (
    <>
      <button className="mini" title="Snooze 1 hour" onClick={() => snooze(n, field, 3.6e6, "in 1 hour")}>💤 1h</button>
      <button className="mini" title="Snooze 1 day" onClick={() => snooze(n, field, 8.64e7, "in 1 day")}>💤 1d</button>
    </>
  );

  function grouped<T extends { n: GraphNode }>(items: T[], tsOf: (x: T) => number) {
    const map = new Map<string, { key: string; label: string; rank: number; items: T[] }>();
    for (const item of items) {
      const g = dayGroupFor(tsOf(item));
      if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, rank: g.rank, items: [] });
      map.get(g.key)!.items.push(item);
    }
    return [...map.values()].sort((a, b) => a.rank - b.rank);
  }

  const isEmpty = actionsAll.length === 0 && remindersAll.length === 0 && dueRemindersAll.length === 0;
  if (isEmpty) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
        {createForm}
        <p className="empty" style={{ margin: 0 }}>
          No action items or reminders. Add one above, add a thought and tick "📌 Action item", or set a reminder when you log a memory.
        </p>
        <button className="mini" onClick={() => window.dispatchEvent(new CustomEvent("brain-toast-action", { detail: { kind: "panel", value: "ingest" } }))}>
          ➕ Dump a thought
        </button>
      </div>
    );
  }

  const showList = <T extends { n: GraphNode }>(
    items: T[], expandedFlag: boolean, setFlag: (v: boolean) => void, tsOf: (x: T) => number, renderRow: (x: T) => React.ReactNode,
  ) => {
    const visible = expandedFlag ? items : items.slice(0, LIST_SHOWN_CAP);
    return (
      <>
        {grouped(visible, tsOf).map((g) => (
          <Fragment key={g.key}>
            <li className="agenda-group" style={{ display: "block", fontSize: "11px", opacity: 0.7, fontWeight: 600 }}>{g.label}</li>
            {g.items.map(renderRow)}
          </Fragment>
        ))}
        {items.length > LIST_SHOWN_CAP && !expandedFlag && (
          <li key="more"><button className="mini agenda-more" onClick={() => setFlag(true)}>+{items.length - LIST_SHOWN_CAP} more</button></li>
        )}
        {items.length > LIST_SHOWN_CAP && expandedFlag && (
          <li key="less"><button className="mini agenda-more" onClick={() => setFlag(false)}>Show less</button></li>
        )}
      </>
    );
  };

  return (
    <div className="dock-body">
      {createForm}
      <div className="agenda-tools" style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
        <input aria-label="Search agenda" placeholder="Search agenda…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter agenda" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
          <option value="all">All</option>
          <option value="action">Actions only</option>
          <option value="reminder">Reminders only</option>
        </select>
      </div>
      {needle || kindFilter !== "all" ? (
        actions.length === 0 && dueReminders.length === 0 && reminders.length === 0 && (
          <p className="empty small">No agenda items match your search.</p>
        )
      ) : null}

      {dueReminders.length > 0 && (
        <>
          <h3 className="agenda-h">🔔 Reminders due now ({dueReminders.length})</h3>
          <ul className="agenda-list">
            {showList(dueReminders, expanded.due, (v) => setExpanded((s) => ({ ...s, due: v })), ({ at }) => at, ({ n, at }) => {
              const c = countdown(at);
              return (
                <li key={n.id} className="over" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
                    <button className="agenda-main" onClick={() => onFocus(n.id)} title="Fly to it">
                      <span>
                        <span className="agenda-label">{n.label}</span>
                        <RowMeta n={n} />
                      </span>
                      <span className="agenda-due urgent">due now{c.text ? ` · ${c.text}` : ""}<br /><span style={{ fontSize: "0.85em", opacity: 0.8 }}>{formatLocalTime(at)}</span></span>
                    </button>
                    <button className="mini agenda-done" onClick={() => ack(n.id)} title="Acknowledge — stop reminding">✓</button>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button className="mini" onClick={() => startEdit(n, at)}>Edit</button>
                    {snoozeButtons(n, "remindAt")}
                  </div>
                  {editForm(n, "remindAt")}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(kindFilter !== "reminder") && (
        <>
          <h3 className="agenda-h">📌 Action items {actions.length > 0 && `(${actions.length})`}</h3>
          {actions.length === 0 ? (
            <p className="empty small">{needle || kindFilter !== "all" ? "No matching action items." : "Nothing due — you're clear."}</p>
          ) : (
            <ul className="agenda-list">
              {showList(actions, expanded.actions, (v) => setExpanded((s) => ({ ...s, actions: v })), ({ due }) => due, ({ n, due }) => {
                const c = countdown(due);
                const isConfirming = confirming?.kind === "done" && confirming.id === n.id;
                return (
                  <li key={n.id} className={c.over ? "over" : ""} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
                      <button className="agenda-main" onClick={() => onFocus(n.id)} title="Fly to it">
                        <span>
                          <span className="agenda-label">{n.label}</span>
                          <RowMeta n={n} />
                        </span>
                        {c.text && <span className={`agenda-due ${c.urgent ? "urgent" : ""}`}>⏰ {c.text}<br /><span style={{ fontSize: "0.85em", opacity: 0.8 }}>{formatLocalTime(due)}</span></span>}
                        {!c.text && <span className="agenda-due">No due date</span>}
                      </button>
                      <button className="mini agenda-done" onClick={() => setConfirming({ kind: "done", id: n.id, label: n.label })} title={earnsFuel(n) ? `Mark done (+${EARN_ACTION_DONE} ⛽)` : `Mark done · earns ⛽ after ${ACTION_DONE_MIN_AGE_MINUTES} min`}>✓</button>
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button className="mini" onClick={() => startEdit(n, due)}>Edit</button>
                      {snoozeButtons(n, "expiresAt")}
                    </div>
                    {isConfirming && confirmBar(confirming, () => done(n))}
                    {editForm(n, "expiresAt")}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {reminders.length > 0 && (
        <>
          <h3 className="agenda-h">⏰ Upcoming reminders ({reminders.length})</h3>
          <ul className="agenda-list">
            {showList(reminders, expanded.upcoming, (v) => setExpanded((s) => ({ ...s, upcoming: v })), ({ at }) => at, ({ n, at }) => {
              const c = countdown(at);
              const isConfirming = confirming?.kind === "dismiss" && confirming.id === n.id;
              return (
                <li key={n.id} className={c.over ? "over" : ""} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
                    <button className="agenda-main" onClick={() => onFocus(n.id)} title="Fly to it">
                      <span>
                        <span className="agenda-label">{n.label}</span>
                        <RowMeta n={n} />
                      </span>
                      <span className={`agenda-due ${c.urgent ? "urgent" : ""}`}>{c.text}<br /><span style={{ fontSize: "0.85em", opacity: 0.8 }}>{formatLocalTime(at)}</span></span>
                    </button>
                    <button className="mini agenda-done" onClick={() => setConfirming({ kind: "dismiss", id: n.id, label: n.label })} title="Dismiss — cancel this reminder">✕</button>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button className="mini" onClick={() => startEdit(n, at)}>Edit</button>
                    {snoozeButtons(n, "remindAt")}
                  </div>
                  {isConfirming && confirmBar(confirming, () => ack(n.id, n.label))}
                  {editForm(n, "remindAt")}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
