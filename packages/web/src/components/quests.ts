import { COOLING_ENTROPY, type GraphNode } from "@brain/shared";

/**
 * Daily quests / tend list (gamification Wave 2; completed as a CLIENT-ONLY
 * system in Immersion Round 3, owner decision Q1). A few concrete,
 * click-through nudges derived live from the brain's state — "feed it
 * today", "warm a cooling memory", "reconnect a drifting one". There is no
 * server Quest Board and no `/api/quests/*` (the board in
 * `plans/streaks-and-quests-spec.md` was never built and is not promised
 * anywhere in the UI), and completing a quest earns NO fuel — the per-day
 * fuel reward deferred in TASKS.md remains unshipped, so nothing here
 * claims one.
 *
 * Honest completion (Round 3 fix). The v1 derivation hardcoded
 * `done: false` for the warm/connect quests: a quest only ever vanished
 * when its whole pool emptied, so warming the named memory just promoted
 * the next cooling one — the quest could never be seen complete, and a
 * drifting memory that gained a link silently disappeared instead of
 * completing. The fix is a STABLE DAILY TARGET plus a verifiable
 * resolution, both from client-available state:
 *
 * - The first derivation of a (space-local) day baselines ONE target per
 *   pool — the coldest cooling memory, the most neglected drifting one —
 *   and that target is persisted for the day (see QuestDayState), so the
 *   quest names the same memory all day instead of treadmilling.
 * - "warm" is done when its target actually warmed: its entropy fell
 *   below COOLING_ENTROPY, or it was tended today (`lastTendedAt` on the
 *   current space-local day — visiting a memory tends it, App.goTo →
 *   POST /nodes/:id/tend). A DIFFERENT memory being tended does not
 *   complete it.
 * - "connect" is done only when its target actually reconnected: its
 *   degree rose above 0. Merely visiting a drifting memory tends it but
 *   does NOT link it, so a visit alone never completes this quest.
 * - A completed quest stays in the list showing ✓ for the rest of the
 *   day; it does not vanish and is not replaced by the next pool member.
 *
 * Day boundaries are always the space-local day (questLocalDay — the same
 * en-CA formatToParts algorithm as ReviewPanel.spaceLocalDay and the
 * server's localDay), never a UTC day. `fedToday` arrives from the server
 * streak, which is itself computed on the space-local day (streak.ts).
 */
export interface Quest {
  id: string;
  icon: string;
  text: string;
  done: boolean;
  /** Fly to this memory when tapped. */
  focusId?: number;
  /** Or trigger an app action instead of focusing a node. */
  action?: "capture" | "insights";
}

/**
 * Local YYYY-MM-DD in the given IANA timezone. Same algorithm as
 * ReviewPanel's `spaceLocalDay` (IM-113) and the server's `localDay()`:
 * en-CA formatToParts in the target zone; the web falls back to the
 * device's own zone, which is what the space timezone is set from.
 */
export function questLocalDay(
  d: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // Unknown/invalid zone — fall back to the runtime's own local calendar day.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

/**
 * The baselined targets for one space-local day. Persisted client-side
 * (localStorage, one record per brain — see questDayStorageKey) so the
 * day's quests are stable across reloads; a record from any other day is
 * ignored and re-baselined, so nothing here needs a cleanup sweep.
 */
export interface QuestDayState {
  /** Space-local day this state belongs to (questLocalDay). */
  day: string;
  warmTargetId?: number;
  connectTargetId?: number;
}

export function questDayStorageKey(spaceId: string): string {
  return `brain.quests.${spaceId}`;
}

/** Read the persisted QuestDayState (any day — the resolver checks the day). */
export function loadQuestDayState(key: string): QuestDayState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuestDayState;
    return parsed && typeof parsed.day === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveQuestDayState(key: string, state: QuestDayState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* storage unavailable — quests still derive, just without a stable target */
  }
}

/** Parse a stored timestamp the way the lore engine does: a naive
 *  "YYYY-MM-DD HH:MM:SS" (SQLite) value is UTC; ISO values parse as-is. */
function parseStoredMs(ts: string): number {
  const iso = ts.includes("Z") || ts.includes("+") ? ts : `${ts.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

/** Was this memory tended on the given space-local day? */
function tendedOnDay(n: GraphNode, day: string, timeZone?: string): boolean {
  if (!n.lastTendedAt) return false;
  const ms = parseStoredMs(n.lastTendedAt);
  if (!Number.isFinite(ms)) return false;
  return questLocalDay(new Date(ms), timeZone) === day;
}

export interface DailyQuestsOptions {
  /** Yesterday's / earlier today's baselined targets, if persisted. */
  dayState?: QuestDayState | null;
  now?: Date;
  timeZone?: string;
}

export interface DailyQuestsResult {
  quests: Quest[];
  /** The day state to persist (targets baselined / carried for `day`). */
  dayState: QuestDayState;
}

/**
 * Derive today's quests plus the day state that keeps their targets
 * stable. Pure: storage is the caller's job (loadQuestDayState /
 * saveQuestDayState), which keeps every completion rule testable.
 */
export function resolveDailyQuests(
  memories: GraphNode[],
  fedToday: boolean,
  opts: DailyQuestsOptions = {},
): DailyQuestsResult {
  const now = opts.now ?? new Date();
  const day = questLocalDay(now, opts.timeZone);
  const stored = opts.dayState && opts.dayState.day === day ? opts.dayState : null;
  const dayState: QuestDayState = { day };
  if (stored?.warmTargetId != null) dayState.warmTargetId = stored.warmTargetId;
  if (stored?.connectTargetId != null) dayState.connectTargetId = stored.connectTargetId;

  const quests: Quest[] = [
    {
      id: "log",
      icon: "✍️",
      text: fedToday ? "Fed your brain today" : "Log a memory today",
      done: fedToday,
      action: "capture",
    },
  ];

  const byId = new Map(memories.map((n) => [n.id, n]));

  // — Warm a cooling memory. Target: today's baselined memory, else the
  // coldest cooling one. Done when THAT memory warmed (see header).
  const cooling = memories
    .filter((n) => (n.entropy ?? 0) >= COOLING_ENTROPY)
    .sort((a, b) => (b.entropy ?? 0) - (a.entropy ?? 0));
  let warmTarget =
    dayState.warmTargetId != null ? byId.get(dayState.warmTargetId) : undefined;
  if (!warmTarget && cooling.length > 0) {
    warmTarget = cooling[0]!;
    dayState.warmTargetId = warmTarget.id;
  }
  if (warmTarget) {
    const done =
      (warmTarget.entropy ?? 0) < COOLING_ENTROPY || tendedOnDay(warmTarget, day, opts.timeZone);
    quests.push({
      id: "warm",
      icon: "❄️",
      text: done
        ? "Warmed a cooling memory today"
        : `Warm a cooling memory · ${cooling.length} drifting cold`,
      done,
      focusId: warmTarget.id,
    });
  } else if (dayState.warmTargetId != null) {
    // Baselined target is gone (deleted/archived out of the list) and
    // nothing is cooling — no honest quest remains for this pool.
    delete dayState.warmTargetId;
  }

  // — Reconnect a drifting memory. Target: today's baselined memory, else
  // the most neglected unlinked one. Done ONLY when it gained a link;
  // visiting/tending it does not reconnect it.
  const drifting = memories
    .filter((n) => (n.degree ?? 0) === 0)
    .sort((a, b) =>
      (a.lastTendedAt ?? a.createdAt ?? "").localeCompare(b.lastTendedAt ?? b.createdAt ?? ""),
    );
  let connectTarget =
    dayState.connectTargetId != null ? byId.get(dayState.connectTargetId) : undefined;
  if (!connectTarget && drifting.length > 0) {
    connectTarget = drifting[0]!;
    dayState.connectTargetId = connectTarget.id;
  }
  if (connectTarget) {
    const done = (connectTarget.degree ?? 0) > 0;
    quests.push({
      id: "connect",
      icon: "🪐",
      text: done
        ? "Reconnected a drifting memory today"
        : `Reconnect a drifting memory · ${drifting.length} unlinked`,
      done,
      focusId: connectTarget.id,
    });
  } else if (dayState.connectTargetId != null) {
    delete dayState.connectTargetId;
  }

  return { quests: quests.slice(0, 3), dayState };
}

/** Back-compatible wrapper: just the quest list. */
export function dailyQuests(
  memories: GraphNode[],
  fedToday: boolean,
  opts: DailyQuestsOptions = {},
): Quest[] {
  return resolveDailyQuests(memories, fedToday, opts).quests;
}

/** True when there is at least one quest and every one is complete. */
export function allQuestsDone(quests: Quest[]): boolean {
  return quests.length > 0 && quests.every((q) => q.done);
}
