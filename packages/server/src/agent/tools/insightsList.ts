import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { InsightsRepo } from "../../repositories/insights.repo.js";

/**
 * Telegram Parity Phase 4: the Insights surface as a conversational tool.
 *
 * Reads the SAME repository the digest route and the intelligence snapshot
 * use (InsightsRepo.recent() — space-scoped, newest first, hydrated with
 * the node references each insight spans and its significance tier).
 * No new store. The repo's own read is limit-based (there is no offset
 * API), so paging is expressed through `limit` alone and the result states
 * plainly when more may exist beyond the returned window — the same
 * honest-truncation discipline as the Phase 1 tools.
 *
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function clampLimit(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

export const insightsListTool: Tool = {
  name: "insights_list",
  description:
    "List the user's recent Insights (syntheses and contradictions Soumaya has drawn between their memories), newest first, each with the memories it connects. Use for 'what insights do you have' and 'what patterns have you noticed' questions. Optionally filter by kind (synthesis | contradiction).",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["synthesis", "contradiction"], description: "Optional kind filter. Omit for all insights." },
      limit: { type: "integer", description: "Max insights to return (1-50, default 10)." },
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
    const kind = typeof args.kind === "string" ? args.kind : null;

    // Fetch one past the page so "there is more" is a fact, not a guess.
    const fetched = new InsightsRepo(tc.ctx.handle, tc.spaceId).recent(limit + 1);
    const filteredAll = kind ? fetched.filter((i) => i.kind === kind) : fetched;
    const page = filteredAll.slice(0, limit);
    const moreMayExist = fetched.length > limit;

    const lines = [
      `INSIGHTS (exact, newest first${kind ? `, filtered to kind "${kind}"` : ""} — from the same store the app shows):`,
      ...page.map(
        (i) =>
          `  - #${i.id} [${i.kind}, tier ${i.tier}, score ${i.score.toFixed(2)}, ${i.createdAt.slice(0, 10)}] ${i.text}` +
          (i.nodes.length > 0 ? `\n    Connects: ${i.nodes.map((n) => `#${n.id} "${n.label}"`).join(" ↔ ")}` : ""),
      ),
      ...(page.length === 0 ? ["  (none — say so honestly; do not invent an insight.)"] : []),
      ...(moreMayExist
        ? [`More insights exist beyond these ${page.length} — call insights_list with a larger limit to see more.`]
        : []),
    ];

    return {
      ok: true,
      summary: `insights_list: ${page.length} insight(s)${kind ? ` of kind "${kind}"` : ""}`,
      targets: page.map((i) => i.id),
      message: lines.join("\n"),
    };
  },
};
