import type { NpcLogEntry } from "@brain/shared";
import { ETERNITY_AUTONOMOUS_GESTURES } from "@brain/shared";

/**
 * Playing Eternity's own acts in the world (docs/specs/eternity-autonomy-2026-10-29.md). The SERVER decides
 * (and logs) every act; the client only plays a fresh, unseen one once. Pure, so it is unit-tested.
 */
export const ETERNITY_FRESH_MS = 15 * 60 * 1000;

export type EternityPlayback = { kind: "gesture"; gesture: string; id: number } | { kind: "tool"; tool: "reorder"; id: number };

/**
 * From the log (newest first): the act to play now, or null. Only `gesture` (an allowed autonomous gesture) and
 * `reorder-light` are ever played; a waits-only log, an old act (> 15 min) or one already seen plays nothing,
 * so re-entering the world never replays him.
 */
export function pickEternityPlayback(log: readonly NpcLogEntry[], lastSeenId: number, nowMs: number): EternityPlayback | null {
  for (const e of log) {
    if (e.id <= lastSeenId) break;
    const age = nowMs - Date.parse(e.createdAt);
    if (!Number.isFinite(age) || age > ETERNITY_FRESH_MS) continue;
    if (e.kind === "gesture" && (ETERNITY_AUTONOMOUS_GESTURES as readonly string[]).includes(e.act)) {
      return { kind: "gesture", gesture: e.act, id: e.id };
    }
    if (e.kind === "reorder-light") return { kind: "tool", tool: "reorder", id: e.id };
  }
  return null;
}

/** The newest log id (so everything up to it counts as seen, waits included). */
export function newestLogId(log: readonly NpcLogEntry[]): number {
  return log.reduce((m, e) => Math.max(m, e.id), 0);
}
