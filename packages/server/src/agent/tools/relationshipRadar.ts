import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { personProfile, recentPeopleSummaries } from "../../analysis/people.js";
import { parseTolerantMs } from "../../lib/time.js";

/**
 * Telegram Parity Phase 5-A: relationship radar (`relationship_radar`).
 *
 * People ranked by time since last interaction, LONGEST-SILENT FIRST, each
 * with a one-line last-interaction summary. Composed entirely from the
 * existing people machinery Phase 1's `people_lookup` exposes:
 *  - `recentPeopleSummaries()` supplies the roster (interaction count, last
 *    interaction instant, tone) in ONE aggregated query — this tool re-sorts
 *    it longest-silent first (people never interacted with have been silent
 *    the longest, so they lead), and
 *  - `personProfile()` supplies each shown person's most recent interaction
 *    (its label) for the one-line summary — called only for the page shown,
 *    never for the whole roster.
 *
 * Paginated with honest truncation (a page is never presented as everyone).
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DAY_MS = 86_400_000;

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

export const relationshipRadarTool: Tool = {
  name: "relationship_radar",
  description:
    "Rank the user's tracked people by how long it has been since the last interaction with each of them — longest-silent first — with a one-line summary of the last interaction. Use for 'who haven't I talked to in a while', 'who am I drifting from', or 'who should I reach out to' questions. Paginated with limit/offset; truncation is stated in the result.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max people to return (1-200, default 20)." },
      offset: { type: "integer", description: "People to skip for paging (default 0)." },
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

    const summaries = recentPeopleSummaries(tc.ctx.handle, tc.spaceId, 100_000);
    if (summaries.length === 0) {
      return {
        ok: true,
        summary: "relationship_radar: no tracked people",
        message: "RELATIONSHIP RADAR: the user does not track any people yet, so there is no one to rank. Say so honestly.",
      };
    }

    // Longest-silent first: never-interacted (lastAt null) leads, then the
    // oldest last interaction; ties break by fewer interactions, then id —
    // fully deterministic.
    const sorted = summaries.slice().sort((a, b) => {
      if (a.lastAt === null && b.lastAt !== null) return -1;
      if (a.lastAt !== null && b.lastAt === null) return 1;
      if (a.lastAt !== null && b.lastAt !== null) {
        const d = parseTolerantMs(a.lastAt) - parseTolerantMs(b.lastAt);
        if (d !== 0) return d;
      }
      return a.interactionCount - b.interactionCount || a.id - b.id;
    });
    const page = sorted.slice(offset, offset + limit);

    const lines = [
      `RELATIONSHIP RADAR (tracked people ranked by time since last interaction, longest-silent first — ${sorted.length} tracked in total):`,
    ];
    for (const p of page) {
      const profile = personProfile(tc.ctx, tc.spaceId, p.id);
      const last = profile?.interactions[0];
      if (!p.lastAt || !last) {
        lines.push(
          `- #${p.id} ${p.label}: no interaction recorded yet — silent the longest (tone: ${p.tone}, ${p.interactionCount} interaction(s) on record)`,
        );
        continue;
      }
      const ms = parseTolerantMs(p.lastAt);
      const days = Number.isFinite(ms) ? Math.max(0, Math.floor((tc.now - ms) / DAY_MS)) : null;
      lines.push(
        `- #${p.id} ${p.label}: last interaction ${days === null ? `on ${p.lastAt.slice(0, 10)}` : `${days} day(s) ago (${p.lastAt.slice(0, 10)})`} — "${last.label}" (${p.interactionCount} interaction(s) total, tone: ${p.tone})`,
      );
    }
    if (sorted.length > offset + page.length) {
      lines.push(
        `(Showing ${page.length} of ${sorted.length} tracked people — call relationship_radar with offset ${offset + page.length} for the rest.)`,
      );
    } else if (offset > 0) {
      lines.push(`(Showing ${page.length} of ${sorted.length} tracked people.)`);
    }

    return {
      ok: true,
      summary: `relationship_radar: ${page.length} of ${sorted.length} people, longest-silent first`,
      targets: page.map((p) => p.id),
      message: lines.join("\n"),
    };
  },
};
