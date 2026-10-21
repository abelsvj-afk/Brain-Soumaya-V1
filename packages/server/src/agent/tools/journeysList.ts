import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { JourneysRepo } from "../../repositories/journeys.repo.js";

/**
 * Telegram Parity Phase 4: the Journeys tab as a conversational tool.
 *
 * Reads the SAME repository the web Journeys tab and its routes use
 * (JourneysRepo.list() — space-scoped, active first, each row carrying its
 * linked-object count). No new store. Paginated with honest truncation
 * notes, in the same shape as the Phase 1 exact-answer tools.
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

export const journeysListTool: Tool = {
  name: "journeys_list",
  description:
    "List the user's Journeys (life chapters) exactly: title, status (active/paused/done), progress, and how many things are linked into each. Use for 'what journeys do I have' and 'how is my <journey> going' questions. Optionally filter by status. Paginated with limit/offset; truncation is stated in the result.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "paused", "done"], description: "Optional status filter. Omit to list all journeys." },
      limit: { type: "integer", description: "Max journeys to return (1-50, default 20)." },
      offset: { type: "integer", description: "Journeys to skip for paging (default 0)." },
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
    const status = typeof args.status === "string" ? args.status : null;

    const all = new JourneysRepo(tc.ctx.handle, tc.spaceId).list();
    const filtered = status ? all.filter((j) => j.status === status) : all;
    const page = filtered.slice(offset, offset + limit);

    const byStatus = (st: string): number => all.filter((j) => j.status === st).length;
    const lines = [
      `JOURNEYS (exact, from the Journeys tab data — ${all.length} total: ${byStatus("active")} active, ${byStatus("paused")} paused, ${byStatus("done")} done${status ? `; filtered to "${status}": ${filtered.length}` : ""}):`,
      ...(filtered.length > offset + page.length
        ? [`Showing ${page.length} of ${filtered.length} — call journeys_list with offset ${offset + page.length} for the rest.`]
        : []),
      ...page.map(
        (j) =>
          `  - #${j.id} ${j.icon ? `${j.icon} ` : ""}"${j.title}" [${j.status}] — progress ${Math.round((j.progress ?? 0) * 100)}%, ${j.linkCount ?? 0} linked item(s), updated ${j.updatedAt.slice(0, 10)}` +
          (j.description ? `\n    ${j.description.slice(0, 200)}` : ""),
      ),
      ...(filtered.length === 0 ? ["  (none — say so honestly; do not invent a journey.)"] : []),
    ];

    return {
      ok: true,
      summary: `journeys_list: ${filtered.length} journey(s)${status ? ` with status "${status}"` : ""} (${all.length} total)`,
      targets: page.map((j) => j.id),
      message: lines.join("\n"),
    };
  },
};
