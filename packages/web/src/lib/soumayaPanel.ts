import type { ChatMood, Fuel, Streak } from "@brain/shared";
import { humanizeJobType } from "./jobLabels.js";
import type { AgentLog, Undertaking } from "../api/client.js";

/**
 * CL-7 helpers for the Soumaya tab (IM-64/65/66/70) — pure functions so the
 * panel's honesty properties are unit-testable without rendering.
 */

/* ------------------------------------------------------------------ IM-70 */

/**
 * Friendly labels for agent-log actions. Log actions arrive as plumbing
 * tokens: bare job types ("synthesis"), tool runs ("tool:bill_risk"),
 * intelligence events ("intelligence:clarification"), and lifecycle words
 * ("goal_completed", "dream", "undertaking"…). Rendering one raw/uppercased
 * leaks the plumbing; every token goes through this map or a de-snaked
 * fallback — never out raw.
 */
export const LOG_ACTION_LABELS: Record<string, string> = {
  dream: "Dream cycle",
  undertaking: "Undertaking",
  upkeep: "Upkeep",
  consolidated: "Consolidated a belief",
  goal_completed: "Goal completed",
  event_passed: "Event passed",
  idea_promoted: "Idea promoted",
  idea_faded: "Idea faded",
  idea_merged: "Ideas merged",
  idea_split: "Idea split",
  people_merged: "People merged",
  skill_leveled: "Skill levelled up",
  intention_fulfilled: "Intention fulfilled",
  intention_expired: "Intention expired",
  action_expired: "Action expired",
  potential_contradiction: "Possible contradiction",
  knowledge_check: "Knowledge check",
  // tool: actions (the autonomous tool router)
  fire_reminder: "Reminder fired",
  create_task: "Task created",
  surface_orphan: "Orphan surfaced",
  review_nudge: "Recall nudge",
  check_in: "Check-in",
  web_lookup: "Web lookup",
  weekly_review: "Weekly review",
  chart_discovery: "Codex discovery charted",
  bill_risk: "Bill-risk warning",
  goal_trend: "Goal funding trend",
  finance_freshness: "Money freshness check",
  // intelligence: actions
  clarification: "Asked for clarification",
};

function desnake(token: string): string {
  const words = token.replace(/[_-]+/g, " ").trim();
  if (!words) return "Activity";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Humanize any agent-log action token; the raw token never reaches the UI. */
export function humanizeLogAction(action: string): string {
  const raw = (action ?? "").trim();
  if (!raw) return "Activity";
  const bare = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  if (LOG_ACTION_LABELS[bare]) return LOG_ACTION_LABELS[bare];
  if (LOG_ACTION_LABELS[raw]) return LOG_ACTION_LABELS[raw];
  // Bare maintenance job types share the ship-label map (IM-04).
  const job = humanizeJobType(bare);
  // humanizeJobType falls back to a de-snaked form for unknown tokens; for a
  // known job type it returns a present-tense phrase ("Connecting threads") —
  // right for a log line too. Unknown tokens end up de-snaked, never raw.
  return job;
}

/* ------------------------------------------------------------------ IM-65 */

export interface SoumayaPresence {
  /** The live "what she's doing now" sentence — built only from real state. */
  sentence: string;
  eyeState: "idle" | "thinking";
  mood: ChatMood;
  /** Short human label for the mood/mode shown next to the eye. */
  moodLabel: string;
}

/**
 * Derive Soumaya's identity-header presence from REAL panel state (IM-65):
 * the ship's live task list, her active undertaking, the newest agent log,
 * a just-completed undertaking, and the fuel gauge. Nothing here is a
 * hard-coded persona claim — each branch names the state it came from.
 */
export function derivePresence(input: {
  tasks?: { label: string; status: string }[] | undefined;
  undertaking?: Undertaking | null;
  latestLog?: AgentLog | null;
  latestCompleted?: Undertaking | null;
  fuel?: Fuel | null;
}): SoumayaPresence {
  const doing = input.tasks?.find((t) => t.status === "doing");
  const planned = input.tasks?.find((t) => t.status === "planned");
  let sentence: string;
  let eyeState: "idle" | "thinking" = "idle";
  let mood: ChatMood = "neutral";
  let moodLabel = "At rest";

  if (doing) {
    sentence = `Right now she's working on: ${doing.label}`;
    eyeState = "thinking";
    mood = "thoughtful";
    moodLabel = "Focused";
  } else if (input.undertaking && input.undertaking.status === "active") {
    sentence = `She's on day ${input.undertaking.done} of her undertaking — ${input.undertaking.title}. Next flight task: ${planned ? planned.label : "to be charted"}.`;
    mood = "thoughtful";
    moodLabel = "On an undertaking";
  } else if (input.latestCompleted) {
    sentence = `She just wrapped up an undertaking — ${input.latestCompleted.title}. ${planned ? `Next up: ${planned.label}.` : "A new arc will form when there's enough to work on."}`;
    mood = "happy";
    moodLabel = "Fresh off a finish";
  } else if (input.latestLog) {
    sentence = `Her latest work: ${input.latestLog.description}`;
    moodLabel = "Caught up";
  } else if (planned) {
    sentence = `Next up on her flight plan: ${planned.label}.`;
    moodLabel = "Ready";
  } else {
    sentence = "She's holding at the Waystation — no active tasks right now, ready when you are.";
  }

  // A real, checkable worry overrides the decorative mood: an empty tank
  // pauses her autonomous work, so the header should say so.
  if (input.fuel && input.fuel.fuel < input.fuel.jobCost) {
    mood = "concerned";
    moodLabel = "Low on fuel — deep work paused";
  }
  return { sentence, eyeState, mood, moodLabel };
}

/* ------------------------------------------------------------------ IM-66 */

/** Normalize a stored log timestamp (naive SQLite = UTC) to a Date. */
export function logDate(raw: string): Date {
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  return new Date(iso);
}

/** Local day key (YYYY-MM-DD in the viewer's timezone) for grouping. */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "Today · Tue, Oct 21" / "Yesterday · Mon, Oct 20" / "Sun, Oct 19" — local. */
export function logDayLabel(key: string, now = new Date()): string {
  const todayKey = localDayKey(now);
  const yesterdayKey = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const human = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (key === todayKey) return `Today · ${human}`;
  if (key === yesterdayKey) return `Yesterday · ${human}`;
  return human;
}

export interface LogDayGroup {
  key: string;
  label: string;
  logs: AgentLog[];
}

/** Group logs (newest-first input) under local-day headers, newest day first. */
export function groupLogsByDay(logs: AgentLog[], now = new Date()): LogDayGroup[] {
  const groups = new Map<string, AgentLog[]>();
  for (const log of logs) {
    const key = localDayKey(logDate(log.createdAt));
    const arr = groups.get(key);
    if (arr) arr.push(log);
    else groups.set(key, [log]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, dayLogs]) => ({ key, label: logDayLabel(key, now), logs: dayLogs }));
}

/** Full local date + time for a log row — yesterday vs today is unambiguous. */
export function logDateTime(raw: string): string {
  const d = logDate(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Search + action filter for the log list (IM-66). Query matches description + humanized action. */
export function filterLogs(logs: AgentLog[], query: string, action: string): AgentLog[] {
  const q = query.trim().toLowerCase();
  return logs.filter((l) => {
    if (action !== "all" && l.action !== action) return false;
    if (!q) return true;
    return (
      l.description.toLowerCase().includes(q) ||
      humanizeLogAction(l.action).toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q)
    );
  });
}

export const LOG_PAGE_SIZE = 10;

/* ------------------------------------------------------------------ IM-64 */

export interface ConstellationCell {
  date: string;
  /** true = tended · false = not tended (known) · null = no record */
  tended: boolean | null;
  /** Short axis label, e.g. "Tue 21" (the local calendar day of `date`). */
  axis: string;
  isToday: boolean;
}

/**
 * Build the 14 constellation cells from the STREAK endpoint's history (IM-64)
 * — never from the agent-log feed. Dates in the payload are space-local day
 * strings; the axis label is read off the string itself (noon-anchored) so a
 * viewer in another timezone still sees the streak's own calendar.
 */
export function constellationCells(streak: Streak | null): ConstellationCell[] | null {
  if (!streak?.history || streak.history.length === 0) return null;
  // The payload's last day IS the streak's "today" (space-local) — use it as
  // the today marker rather than the viewer's own calendar day.
  const todayKey = streak.history[streak.history.length - 1]!.date;
  return streak.history.map((h) => {
    const [y, m, d] = h.date.split("-").map(Number);
    const anchor = new Date(Date.UTC(y!, m! - 1, d!, 12));
    const axis = anchor.toLocaleDateString(undefined, {
      weekday: "narrow",
      day: "numeric",
      timeZone: "UTC",
    });
    return { date: h.date, tended: h.tended, axis, isToday: h.date === todayKey };
  });
}
