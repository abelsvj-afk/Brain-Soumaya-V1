import { useState } from "react";
import { type GraphNode, type Fuel } from "@brain/shared";
import { type Health, describeLlmStatus } from "../api/client.js";
import { type DockTab } from "./RightDock.js";
import { isReminderDue } from "../utils/dueReminders.js";
import { formatDueLocal } from "./cl1a.helpers.js";

interface NotificationsBarProps {
  fuel: Fuel | null;
  nodes: GraphNode[];
  health: Health | null;
  onFocusNode: (id: number) => void;
  onOpenTab: (tab: DockTab) => void;
  /** Open the "Ways to earn Fuel" cheat-sheet (from the low-fuel alert). */
  onEarnFuel?: () => void;
}

const DISMISS_KEY = "brain.dismissedAlerts";

export function NotificationsBar({ fuel, nodes, health, onFocusNode, onOpenTab, onEarnFuel }: NotificationsBarProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); }
  });
  const dismiss = (id: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });

  const alerts: { id: string; type: "warning" | "info" | "error"; text: string; icon: string; actionText?: string; onClick?: () => void }[] = [];

  // 1. Low Fuel Alert (under 15 units)
  if (fuel && fuel.fuel < 15) {
    alerts.push({
      id: "low-fuel",
      type: "warning",
      icon: "⛽",
      text: `Low fuel (${Math.round(fuel.fuel)}/${fuel.capacity}). Soumaya will pause background maintenance soon.`,
      actionText: "Ways to earn",
      onClick: () => {
        if (onEarnFuel) onEarnFuel();
        else onOpenTab("actions");
      }
    });
  }

  // 2. LLM Degraded/Offline Alert — same wording the Soumaya tab's diagnostics box
  // uses (describeLlmStatus), so the two surfaces never say different things about
  // the same underlying state. Specific to WHY, not one generic line, so "it's not
  // working" has an actual answer (see resilient.ts's DegradeReason).
  if (health && health.llm && (health.llm.degraded || !health.llm.available)) {
    const status = describeLlmStatus(health);
    alerts.push({
      id: "llm-degraded",
      type: "error",
      icon: status.icon,
      text: status.text,
      actionText: "Diagnostics",
      onClick: () => {
        onOpenTab("soumaya");
      }
    });
  }

  // 3. Pending Questions Alert
  const pendingNodes = nodes.filter(n => n.researchQuestions && n.researchQuestions.length > 0);
  if (pendingNodes.length > 0) {
    alerts.push({
      id: "pending-questions",
      type: "info",
      icon: "🛸",
      text: `${pendingNodes.length} memory deep-dive${pendingNodes.length === 1 ? "" : "s"} awaiting clarification.`,
      actionText: "Resolve",
      onClick: () => {
        onFocusNode(pendingNodes[0]!.id);
      }
    });
  }

  // 4. Due reminders — the one moment a reminder matters. (The Agenda used to be
  // the only surface and it HID reminders once due; nothing else ever alerted.)
  const nowMs = Date.now();
  const dueReminders = nodes.filter((n) => isReminderDue(n, nowMs));
  if (dueReminders.length > 0) {
    // IM-06: the due time exists in the data (remindAt) — render it locally
    // instead of dropping it, so "due" says WHEN it came due.
    const earliest = dueReminders.map((n) => n.remindAt ?? "").filter(Boolean).sort()[0];
    const dueWhen = earliest ? formatDueLocal(earliest) : "";
    alerts.push({
      id: "due-reminders",
      type: "info",
      icon: "🔔",
      text:
        dueReminders.length === 1
          ? `Reminder due: "${dueReminders[0]!.label.slice(0, 40)}"${dueWhen ? ` · due ${dueWhen}` : ""}`
          : `${dueReminders.length} reminders due${dueWhen ? ` · earliest ${dueWhen}` : ""}.`,
      actionText: "Agenda",
      onClick: () => {
        onOpenTab("actions");
      },
    });
  }

  // 5. Overdue Actions Alert
  const now = Date.now();
  const overdueActions = nodes.filter(n => {
    if (n.kind !== "action" || !n.expiresAt) return false;
    const isoDate = n.expiresAt.includes("Z") ? n.expiresAt : n.expiresAt.replace(" ", "T") + "Z";
    return Date.parse(isoDate) <= now;
  });
  if (overdueActions.length > 0) {
    const earliestExp = overdueActions.map((n) => n.expiresAt ?? "").filter(Boolean).sort()[0];
    const expWhen = earliestExp ? formatDueLocal(earliestExp) : "";
    alerts.push({
      id: "overdue-actions",
      type: "warning",
      icon: "⏰",
      text: `${overdueActions.length} action item${overdueActions.length === 1 ? "" : "s"} overdue${expWhen ? ` · since ${expWhen}` : ""}.`,
      actionText: "Agenda",
      onClick: () => {
        onOpenTab("actions");
      }
    });
  }

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="notifications-bar">
      {visible.map((alert) => (
        <div key={alert.id} className={`notification-chip ${alert.type}`}>
          <span className="nc-icon">{alert.icon}</span>
          <span className="nc-text">{alert.text}</span>
          {alert.actionText && alert.onClick && (
            <button className="nc-action-btn" onClick={alert.onClick}>
              {alert.actionText} →
            </button>
          )}
          <button className="nc-dismiss" onClick={() => dismiss(alert.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
