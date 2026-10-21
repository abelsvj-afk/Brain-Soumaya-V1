import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { getPreferences, localDay } from "../notify/policy.js";

/**
 * Telegram Parity Phase 4: the Agenda tab as a conversational tool.
 *
 * The Phase 0 companion snapshot only surfaces active action items as a
 * prompt block; there was no exact, paginated agenda path the model could
 * call ("what's on my agenda / what's due?"). This tool reads the SAME
 * sources the app uses — live nodes of kind 'action' (NodesRepo.all()
 * semantics: non-deleted, non-archived, current-truth) for the action list,
 * and nodes carrying `remind_at` (the daily digest's own reminder source)
 * for due/upcoming reminders — and returns them with exact totals and
 * honest truncation notes (never a subset presented as the whole).
 *
 * Day grouping follows the SPACE timezone (owner's hard rule): "due today"
 * is computed with localDay() in the space's timezone, never a UTC day.
 *
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}
function clampOffset(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

interface ReminderRow {
  id: number;
  label: string;
  remind_at: string;
}

export const agendaListTool: Tool = {
  name: "agenda_list",
  description:
    "List the user's agenda exactly: active action items plus reminders that are due or upcoming. Use for 'what's on my agenda', 'what do I need to do', and 'what's due' questions. Paginated with limit/offset; truncation is stated in the result — report the totals as-is and never present a page as the whole agenda.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max items per section (1-50, default 20)." },
      offset: { type: "integer", description: "Items to skip per section for paging (default 0)." },
    },
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const limit = clampLimit(args.limit);
    const offset = clampOffset(args.offset);
    const s = tc.ctx.handle.sqlite;

    // --- Active actions: the companion snapshot's own source/shape. ---
    const actions = new NodesRepo(tc.ctx.handle, tc.spaceId)
      .all()
      .filter((n) => n.kind === "action")
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.id - b.id);
    const actionPage = actions.slice(offset, offset + limit);

    // --- Reminders: every live node carrying remind_at, earliest first. ---
    const reminders = s
      .prepare(
        `SELECT id, label, remind_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL AND remind_at IS NOT NULL
         ORDER BY remind_at ASC`,
      )
      .all(tc.spaceId) as ReminderRow[];
    const due = reminders.filter((r) => Date.parse(r.remind_at) <= tc.now);
    const upcoming = reminders.filter((r) => Date.parse(r.remind_at) > tc.now);
    const duePage = due.slice(offset, offset + limit);
    const upcomingPage = upcoming.slice(offset, offset + limit);

    // "Due today" in the SPACE timezone (never a UTC day boundary).
    let tz = "America/New_York";
    try {
      tz = getPreferences(s, tc.spaceId).timezone;
    } catch {
      /* fail open to the default prefs timezone */
    }
    const todayLocal = localDay(new Date(tc.now), tz);
    const dueToday = due.filter((r) => {
      const t = Date.parse(r.remind_at);
      return Number.isFinite(t) && localDay(new Date(t), tz) === todayLocal;
    }).length;

    const pageNote = (total: number, shown: number): string =>
      total > offset + shown
        ? ` (showing ${shown} of ${total} — call agenda_list with offset ${offset + shown} for the rest)`
        : total > shown || offset > 0
          ? ` (showing ${shown} of ${total})`
          : "";

    const lines = [
      "AGENDA (exact, from the brain — report the totals as-is; a page is never the whole agenda):",
      `Active action items: ${actions.length}${pageNote(actions.length, actionPage.length)}`,
      ...actionPage.map((a) => `  - [ ] #${a.id} "${a.label}" (priority weight: ${a.importance ?? 0.4})`),
      ...(actions.length === 0 ? ["  (none)"] : []),
      `Reminders due (at or before now): ${due.length}, of which due today (${todayLocal}, space timezone ${tz}): ${dueToday}${pageNote(due.length, duePage.length)}`,
      ...duePage.map((r) => `  - ⏰ #${r.id} "${r.label}" — was due ${r.remind_at}`),
      `Reminders upcoming: ${upcoming.length}${pageNote(upcoming.length, upcomingPage.length)}`,
      ...upcomingPage.map((r) => `  - 🔔 #${r.id} "${r.label}" — due ${r.remind_at}`),
    ];

    return {
      ok: true,
      summary: `agenda_list: ${actions.length} action(s), ${due.length} reminder(s) due, ${upcoming.length} upcoming`,
      message: lines.join("\n"),
    };
  },
};
