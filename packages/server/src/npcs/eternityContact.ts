import type { DbHandle } from "../db/client.js";
import type { LlmProvider } from "../llm/adapter.js";
import { ETERNITY_FIGURE, ETERNITY_WAKE_LATEST, ETERNITY_WAKE_TIME } from "@brain/shared";
import { NotificationsRepo } from "../repositories/notifications.repo.js";
import { localTime, spaceTimezone, type NotifyMeta } from "../agent/notify/policy.js";
import { NpcRepo, localDateKey } from "./repo.js";
import { checkFence } from "./loop.js";
import { eternityMemories, speakAsEternity, type EternityOccasion } from "./eternityVoice.js";

/**
 * Eternity reaching out (docs/specs/eternity-autonomy-2026-10-29.md §2c — the owner reversed "no pull", 2026-10-29).
 * Called from the server's minute tick for every brain. At most two contacts a local day:
 *  - WAKE at ETERNITY_WAKE_TIME (sent until ETERNITY_WAKE_LATEST; past it, that day is let be);
 *  - one VISITATION on a day his autonomous loop acted (a gesture or reordering the heavens).
 * Each goes to the in-app inbox (always) and to Telegram through the policy boundary (quiet hours, staleness, the shared
 * cap ledger). The inbox record's dedupe key is the once-per-day lock. A stopped or muted Eternity sends nothing; every
 * message is logged in his log as `speak`, with its cause. He never writes to the brain.
 */

export type Notify = (spaceId: string, text: string, meta?: NotifyMeta) => Promise<void>;

export interface ContactResult {
  sent: EternityOccasion | null;
  reason: string;
}

export const ETERNITY_SIGNATURE = "✦ Eternity —";
const WAKE_CAUSE = "Morning in your timezone";
const VISIT_CAUSE = "He acted in his world today";

export async function runEternityContact(
  h: DbHandle,
  spaceId: string,
  deps: { llm?: LlmProvider; notify?: Notify },
  nowMs: number = Date.now(),
): Promise<ContactResult> {
  const def = ETERNITY_FIGURE;
  const repo = new NpcRepo(h, spaceId);
  if (repo.state(def.id).stopped) return { sent: null, reason: "stopped" };
  if (repo.contactMuted(def.id)) return { sent: null, reason: "muted" };
  const tz = spaceTimezone(h.sqlite, spaceId);
  const now = new Date(nowMs);
  const hhmm = localTime(now, tz);
  const day = localDateKey(tz, nowMs);
  const inbox = new NotificationsRepo(h, spaceId);

  // His own log is the durable record of what he said today (the inbox can be cleared by the user); the inbox
  // dedupe key below is the race lock between overlapping ticks.
  const today = repo.recentLog(def.id).filter((e) => localDateKey(tz, Date.parse(e.createdAt)) === day);
  const woke = today.some((e) => e.kind === "speak" && e.cause.startsWith(WAKE_CAUSE));
  const visited = today.some((e) => e.kind === "speak" && e.cause.startsWith(VISIT_CAUSE));
  let occasion: EternityOccasion | null = null;
  if (!woke && hhmm >= ETERNITY_WAKE_TIME && hhmm <= ETERNITY_WAKE_LATEST && !inbox.hasDedupeKey(`eternity-wake:${day}`)) {
    occasion = "wake";
  } else if (!visited && hhmm >= ETERNITY_WAKE_TIME && !inbox.hasDedupeKey(`eternity-visit:${day}`)) {
    const actedToday = today.some((e) => e.kind === "gesture" || e.kind === "reorder-light");
    if (actedToday) occasion = "visitation";
  }
  if (!occasion) return { sent: null, reason: "nothing due" };
  checkFence(def, "speak", def.world);
  if (!repo.budgetAllows(def.id, "speak", nowMs, def)) return { sent: null, reason: "budget" };

  const memories = eternityMemories(h, spaceId, nowMs);
  const { line, source } = await speakAsEternity(deps.llm, occasion, memories, hhmm, `${spaceId}|${day}|${occasion}`);
  const text = `${ETERNITY_SIGNATURE} ${line}`;
  const key = `eternity-${occasion === "wake" ? "wake" : "visit"}:${day}`;
  // The inbox record is the once-a-day lock: if another tick got here first, stop.
  const rec = inbox.record({ source: "eternity", text, icon: "✦", dedupeKey: key });
  if (!rec) return { sent: null, reason: "already sent" };
  const cause =
    occasion === "wake"
      ? `${WAKE_CAUSE} — he chose to wake you (${source === "voice" ? "his own words, from your recent memories" : "his own lines"}).`
      : `${VISIT_CAUSE} and chose to tell you (${source === "voice" ? "his own words, from your recent memories" : "his own lines"}).`;
  repo.appendLog(def.id, "speak", line, cause, nowMs);
  if (deps.notify) {
    try {
      await deps.notify(spaceId, text, { tool: "eternity_contact", occurrenceId: key });
    } catch {
      /* no linked Telegram chat (or a send problem the boundary already recorded) — the inbox still has it */
    }
  }
  return { sent: occasion, reason: source };
}
