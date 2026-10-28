import type { AwayDigest, AwayAction } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { buildDormantList } from "./dormant.js";

/**
 * "While you were away" companion digest (see docs/specs/away-digest.md). Reads what
 * changed since the brain's `last_seen_at`: what Soumaya did autonomously (from
 * agent_logs), plus what now needs the user (contradictions, expired actions, due
 * reminders, a resurfaced memory, cooling). Heuristic + offline; read-only (the
 * `/seen` route advances the window separately).
 */

const EMPTY = (since: string | null, awayMs: number): AwayDigest => ({
  since,
  awayMs,
  greeting: "",
  agentActions: [],
  newContradictions: 0,
  expiredActions: 0,
  dueReminders: [],
  resurfaced: null,
  cooling: 0,
  isEmpty: true,
});

const count = (h: DbHandle, sql: string, ...p: unknown[]): number =>
  (h.sqlite.prepare(sql).get(...p) as { c: number } | undefined)?.c ?? 0;

/** Read the previous visit timestamp (null if never seen). */
export function getLastSeen(h: DbHandle, spaceId: string): string | null {
  const r = h.sqlite.prepare(`SELECT last_seen_at FROM space_meta WHERE space_id = ?`).get(spaceId) as
    | { last_seen_at: string | null }
    | undefined;
  return r?.last_seen_at ?? null;
}

/** Advance the window to now (called on dismiss / baseline). */
export function markSeen(h: DbHandle, spaceId: string, nowIso: string): void {
  h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(spaceId);
  h.sqlite.prepare(`UPDATE space_meta SET last_seen_at = ? WHERE space_id = ?`).run(nowIso, spaceId);
}

// Human phrasing per autonomous job type (routine upkeep is omitted from the digest).
const ACTION_LABEL: Record<string, (n: number) => string> = {
  synthesis: (n) => `connected ${n} related ${n === 1 ? "memory" : "memories"}`,
  research: (n) => `researched ${n} ${n === 1 ? "memory" : "memories"}`,
  merging: (n) => `fused ${n} duplicate ${n === 1 ? "memory" : "memories"}`,
  sector_vibe: (n) => `charted ${n} ${n === 1 ? "sector" : "sectors"}`,
  daily_log: () => `wrote a daily log`,
};

export function buildAwayDigest(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  nowMs: number = Date.now(),
): AwayDigest {
  const since = getLastSeen(h, spaceId);
  const awayMs = since ? Math.max(0, nowMs - Date.parse(since)) : 0;
  if (!since) return EMPTY(null, 0); // first ever visit — nothing to report

  // What Soumaya did since `since`, grouped by type. NB: agent_logs.created_at is
  // SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS") while `since` is ISO ("…T…Z") — a
  // raw string compare never matches, so normalize BOTH via datetime().
  const rows = h.sqlite
    .prepare(`SELECT action, COUNT(*) c FROM agent_logs WHERE space_id = ? AND datetime(created_at) > datetime(?) GROUP BY action`)
    .all(spaceId, since) as { action: string; c: number }[];
  const agentActions: AwayAction[] = [];
  for (const r of rows) {
    const fmt = ACTION_LABEL[r.action];
    if (fmt) agentActions.push({ type: r.action, count: r.c, label: fmt(r.c) });
  }

  const newContradictions = count(
    h,
    `SELECT COUNT(*) c FROM insights WHERE space_id = ? AND kind = 'contradiction' AND datetime(created_at) > datetime(?)`,
    spaceId,
    since,
  );
  const expiredActions = count(
    h,
    `SELECT COUNT(*) c FROM agent_logs WHERE space_id = ? AND action = 'action_expired' AND datetime(created_at) > datetime(?)`,
    spaceId,
    since,
  );
  const nowIso = new Date(nowMs).toISOString();
  const dueReminders = (
    h.sqlite
      .prepare(
        `SELECT id, label FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND remind_at IS NOT NULL
         AND (kind IS NULL OR kind != 'life_vision')
         AND datetime(remind_at) > datetime(?) AND datetime(remind_at) <= datetime(?) ORDER BY remind_at DESC LIMIT 5`,
      )
      .all(spaceId, since, nowIso) as { id: number; label: string }[]
  ).map((r) => ({ id: r.id, label: r.label }));
  const cooling = count(
    h,
    `SELECT COUNT(*) c FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND last_tended_at IS NOT NULL
     AND julianday('now') - julianday(last_tended_at) > 14`,
    spaceId,
  );
  const dormant = buildDormantList(h, spaceId, nowMs)[0] ?? null;
  const resurfaced = dormant ? { id: dormant.nodeId, label: dormant.label, dormantDays: dormant.dormantDays } : null;

  const isEmpty =
    agentActions.length === 0 &&
    newContradictions === 0 &&
    expiredActions === 0 &&
    dueReminders.length === 0 &&
    !resurfaced &&
    cooling === 0;

  // In-character greeting.
  const did = agentActions.reduce((s, a) => s + a.count, 0);
  const greeting = isEmpty
    ? "All quiet while you were away — your galaxy is holding steady."
    : did > 0
      ? `Welcome back. While you were away I kept tending your galaxy.`
      : `Welcome back — a few things are waiting for you.`;

  return {
    since,
    awayMs,
    greeting,
    agentActions,
    newContradictions,
    expiredActions,
    dueReminders,
    resurfaced,
    cooling,
    isEmpty,
  };
}
