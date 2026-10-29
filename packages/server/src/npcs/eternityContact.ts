import type { DbHandle } from "../db/client.js";
import type { EternalVoice } from "./eternityVoiceProvider.js";
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

/**
 * When his voice fails (free-tier rate limit, a timeout, no answer) he does not settle for a canned line at once: he tries
 * again in a few minutes — 3, then 6, then 12 — and only after that speaks his own lines. Kept in memory: a restart simply
 * starts the attempts again, and the once-a-day lock still holds.
 */
export const VOICE_RETRY_DELAYS_MS = [3 * 60_000, 6 * 60_000, 12 * 60_000];
const pendingVoice = new Map<string, { attempts: number; nextAt: number }>();
/** Tests only. */
export function resetEternityVoiceRetries(): void {
  pendingVoice.clear();
}

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
  deps: { voice?: Pick<EternalVoice, "eternalVoice"> | null; notify?: Notify },
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
  const wakeRetrying = pendingVoice.has(`${spaceId}|${day}|wake`);
  if (
    !woke &&
    hhmm >= ETERNITY_WAKE_TIME &&
    (hhmm <= ETERNITY_WAKE_LATEST || wakeRetrying) &&
    !inbox.hasDedupeKey(`eternity-wake:${day}`)
  ) {
    occasion = "wake";
  } else if (!visited && hhmm >= ETERNITY_WAKE_TIME && !inbox.hasDedupeKey(`eternity-visit:${day}`)) {
    const actedToday = today.some((e) => e.kind === "gesture" || e.kind === "reorder-light");
    if (actedToday) occasion = "visitation";
  }
  if (!occasion) return { sent: null, reason: "nothing due" };
  checkFence(def, "speak", def.world);
  if (!repo.budgetAllows(def.id, "speak", nowMs, def)) return { sent: null, reason: "budget" };

  const retryKey = `${spaceId}|${day}|${occasion}`;
  const pending = pendingVoice.get(retryKey);
  if (pending && nowMs < pending.nextAt) {
    return { sent: null, reason: `voice retry in ${Math.ceil((pending.nextAt - nowMs) / 60_000)} min` };
  }
  const attempts = (pending?.attempts ?? 0) + 1;
  const lastTry = attempts > VOICE_RETRY_DELAYS_MS.length;
  const memories = eternityMemories(h, spaceId, nowMs);
  const spoken = await speakAsEternity(deps.voice, occasion, memories, hhmm, retryKey, { fallback: lastTry });
  if (!spoken) {
    const delay = VOICE_RETRY_DELAYS_MS[attempts - 1]!;
    pendingVoice.set(retryKey, { attempts, nextAt: nowMs + delay });
    return { sent: null, reason: `voice unavailable — retry in ${delay / 60_000} min` };
  }
  pendingVoice.delete(retryKey);
  const { line, source } = spoken;
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
