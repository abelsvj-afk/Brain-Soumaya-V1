import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { getPreferences, localDay, DEFAULT_PREFS } from "../notify/policy.js";
import { parseTolerantMs } from "../../lib/time.js";

/**
 * Telegram Parity Phase 5-A: on this day (`on_this_day`).
 *
 * Two assembled sections, both computed on SPACE-LOCAL calendar days —
 * the owner's hard rule: NO UTC day boundaries anywhere. "Today" is the
 * space's local today via `localDay()` in the space timezone (the repo's
 * space-timezone helper, `agent/notify/policy.ts`); every memory/decision
 * date is likewise converted to its space-local day before any comparison.
 *
 *  1. Memories whose date falls on today's calendar date (same month-day)
 *     in PAST years. A memory's date is its `occurred_at` when set (the
 *     day the event happened), else its `created_at`.
 *  2. Decisions from ABOUT A MONTH AGO — a stated window: nodes typed
 *     `type = 'decision'` (the graph's decision typing — the extraction
 *     taxonomy's decision type, see the heuristic/LLM classifiers) whose
 *     space-local day is 25–35 local days before today — each presented
 *     with a "did it stick?" follow-up prompt.
 *
 * Sections with no matches say so honestly. Read-only, space-scoped.
 */

const DAY_MS = 86_400_000;
/** The stated "about a month ago" window, in space-local days. */
export const DECISION_WINDOW_MIN_DAYS = 25;
export const DECISION_WINDOW_MAX_DAYS = 35;

interface NodeRow {
  id: number;
  label: string;
  type: string;
  kind: string | null;
  content: string;
  created_at: string;
  occurred_at: string | null;
}

/** Whole days between two YYYY-MM-DD local-day strings (anchor at UTC noon
 *  so DST can never skew the count — the streak machinery's own trick). */
function localDayDiff(earlierDay: string, laterDay: string): number {
  const a = Date.parse(`${earlierDay}T12:00:00Z`);
  const b = Date.parse(`${laterDay}T12:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export const onThisDayTool: Tool = {
  name: "on_this_day",
  description:
    "Show what happened on this calendar date in past years (memories dated with today's month and day in earlier years), plus decisions made about a month ago (25-35 days back) with a 'did it stick?' follow-up prompt for each. All dates are computed in the brain's own local timezone — never UTC. Use for 'on this day', 'what happened a year ago today', or 'what did I decide last month' questions.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> {
    const s = tc.ctx.handle.sqlite;
    let tz = DEFAULT_PREFS.timezone;
    try {
      tz = getPreferences(s, tc.spaceId).timezone;
    } catch {
      /* fail open to the default prefs timezone */
    }
    const todayLocal = localDay(new Date(tc.now), tz);
    const todayMonthDay = todayLocal.slice(5); // MM-DD
    const todayYear = todayLocal.slice(0, 4);

    const rows = s
      .prepare(
        `SELECT id, label, type, kind, content, created_at, occurred_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL
           AND (status IS NULL OR status != 'archived')
         ORDER BY id ASC`,
      )
      .all(tc.spaceId) as NodeRow[];

    // A node's day = occurred_at when it parses (the event's own day),
    // else created_at — always converted to the SPACE-local day.
    const withLocalDay = rows
      .map((r) => {
        const occMs = parseTolerantMs(r.occurred_at);
        const ms = Number.isFinite(occMs) ? occMs : parseTolerantMs(r.created_at);
        if (!Number.isFinite(ms)) return null;
        return { row: r, local: localDay(new Date(ms), tz) };
      })
      .filter((x): x is { row: NodeRow; local: string } => x !== null);

    // ----- Memories on this calendar date in past years. -----
    const memories = withLocalDay
      .filter(
        ({ row, local }) =>
          (row.kind === null || row.kind === "memory") &&
          row.type !== "decision" &&
          local.slice(5) === todayMonthDay &&
          local.slice(0, 4) < todayYear,
      )
      .sort((a, b) => b.local.localeCompare(a.local) || a.row.id - b.row.id);

    // ----- Decisions from about a month ago (25–35 local days back). -----
    const decisions = withLocalDay
      .filter(({ row }) => row.type === "decision")
      .map((x) => ({ ...x, daysAgo: localDayDiff(x.local, todayLocal) }))
      .filter((x) => x.daysAgo >= DECISION_WINDOW_MIN_DAYS && x.daysAgo <= DECISION_WINDOW_MAX_DAYS)
      .sort((a, b) => b.daysAgo - a.daysAgo || a.row.id - b.row.id);

    const lines = [
      `ON THIS DAY (${todayLocal}, space timezone ${tz} — all date math on space-local days, never UTC):`,
      `Memories from this calendar date (${todayMonthDay}) in past years: ${memories.length}`,
      ...(memories.length === 0
        ? ["  (none — no memory is dated with this month and day in a past year)"]
        : memories.map(
            ({ row, local }) =>
              `  - #${row.id} "${row.label}" (${local}) — ${row.content.slice(0, 200)}`,
          )),
      `Decisions made about a month ago (${DECISION_WINDOW_MIN_DAYS}-${DECISION_WINDOW_MAX_DAYS} local days before today): ${decisions.length}`,
      ...(decisions.length === 0
        ? ["  (none — no decision falls in that window)"]
        : decisions.flatMap(({ row, local, daysAgo }) => [
            `  - #${row.id} "${row.label}" (decided ${local}, ${daysAgo} day(s) ago) — ${row.content.slice(0, 200)}`,
            `    Did it stick? Ask the user whether "${row.label}" is still how things stand, or whether it changed.`,
          ])),
    ];

    return {
      ok: true,
      summary: `on_this_day: ${memories.length} past-year memorie(s), ${decisions.length} month-old decision(s) (${todayLocal} ${tz})`,
      targets: [...memories.map((m) => m.row.id), ...decisions.map((d) => d.row.id)],
      message: lines.join("\n"),
    };
  },
};
