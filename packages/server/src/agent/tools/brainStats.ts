import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";

/**
 * Telegram Parity Phase 1: exact brain counts as a conversational tool.
 *
 * Why this exists (findings §2): the agent loop had NO count path — no count
 * tool, no telemetry in its prompt, and `memory_search` caps at 8 results.
 * Asked "how many memories do I have?", the model invented a number ("39"
 * against a real 200+). This tool returns EXACT counts, every one labeled,
 * so a subset count can never be passed off as the total again.
 *
 * Count semantics (owner decision D1): the headline is ALL LIVE NODES — the
 * exact semantics of the in-app telemetry in `chat/graphrag.ts`, which reads
 * `nodesRepo.all()`: non-deleted, non-archived, current-truth (not
 * superseded) nodes in this space. The breakdowns beneath it are computed
 * over that same live set, so the parts always sum to the headline. Counts
 * that live outside the live set (archived, episodes, journeys, edges) are
 * labeled with their own semantics instead of being folded into the total.
 *
 * Read-only. No approval required. Space isolation: every read is scoped to
 * tc.spaceId from the server-provided ToolContext; the model never supplies
 * a space id.
 */

export const brainStatsTool: Tool = {
  name: "brain_stats",
  description:
    "Get EXACT counts of what is in the user's brain: total live nodes (memories and everything else), breakdowns by kind and by type, people count, edges, episodes, journeys, active tasks, and archived count. Use this for ANY question about how many of something the user has — never estimate or tally a count from memory_search results.",
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
    const nodesRepo = new NodesRepo(tc.ctx.handle, tc.spaceId);

    // Headline + breakdowns: the telemetry-matching live set (see header).
    const live = nodesRepo.all();
    const totalLive = live.length;

    const byKind = new Map<string, number>();
    const byType = new Map<string, number>();
    let peopleCount = 0;
    let personTypeCount = 0;
    let activeTasks = 0;
    for (const n of live) {
      // A NULL kind is a plain memory (the router briefing's definition:
      // kind IS NULL OR kind = 'memory'); label it as such, never as "null".
      const kindKey = n.kind ?? "memory";
      byKind.set(kindKey, (byKind.get(kindKey) ?? 0) + 1);
      byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
      if (n.kind === "person_entity") peopleCount++;
      if (n.type === "person") personTypeCount++;
      if (n.kind === "action") activeTasks++;
    }

    const count = (sql: string): number =>
      (s.prepare(sql).get(tc.spaceId) as { c: number }).c;

    // Archived: nodesRepo.archived() semantics — non-deleted, status =
    // 'archived' (a history count; archived rows sit OUTSIDE the live total).
    const archivedCount = nodesRepo.archived().length;
    // Edges between live nodes only (an edge touching a deleted node is not
    // a live connection). 'supports' interaction edges are included — this
    // is every stored relationship in the space, not only the extraction
    // RELATIONSHIP_TYPES subset.
    const edgeCount = count(
      `SELECT COUNT(*) AS c FROM edges e
       JOIN nodes a ON a.id = e.source AND a.deleted_at IS NULL
       JOIN nodes b ON b.id = e.target AND b.deleted_at IS NULL
       WHERE e.space_id = ?`,
    );
    // Episodes: lived-event narratives; forgotten (redacted) ones excluded.
    const episodeCount = count(
      `SELECT COUNT(*) AS c FROM episodes WHERE space_id = ? AND forgotten_at IS NULL`,
    );
    const journeyTotal = count(`SELECT COUNT(*) AS c FROM journeys WHERE space_id = ?`);
    const journeyActive = count(
      `SELECT COUNT(*) AS c FROM journeys WHERE space_id = ? AND status = 'active'`,
    );

    const kindLines = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, c]) => `  - kind "${k}": ${c}`);
    const typeLines = [...byType.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t, c]) => `  - type "${t}": ${c}`);

    const lines = [
      "BRAIN STATISTICS (exact counts from the database — report these numbers as-is; do not round, estimate, or substitute a subset for the total):",
      `Total live nodes (headline — ALL live nodes in the brain: memories + people + goals + actions + everything else; excludes archived, deleted, and superseded nodes): ${totalLive}`,
      `Memories only (live nodes of kind "memory", incl. kind-unset plain memories): ${byKind.get("memory") ?? 0}`,
      "Live nodes by kind:",
      ...kindLines,
      "Live nodes by type:",
      ...typeLines,
      `People tracked (live nodes of kind "person_entity" — the Mind-tab roster): ${peopleCount}`,
      ...(personTypeCount !== peopleCount
        ? [`Nodes of type "person" (extraction-typed; a different set from tracked people above): ${personTypeCount}`]
        : []),
      `Edges (connections between live nodes, both directions counted once per stored edge): ${edgeCount}`,
      `Episodes (lived-event narratives, excluding forgotten/redacted ones): ${episodeCount}`,
      `Journeys (total): ${journeyTotal} (of which active: ${journeyActive})`,
      `Active tasks (live nodes of kind "action"): ${activeTasks}`,
      `Archived nodes (kept but out of the live view; NOT included in the total above): ${archivedCount}`,
    ];

    return {
      ok: true,
      // summary is content-free (it reaches agent_logs); the labeled payload
      // lives in `message`, which only the agent loop consumes.
      summary: `brain_stats: ${totalLive} live nodes, ${peopleCount} people, ${edgeCount} edges`,
      message: lines.join("\n"),
    };
  },
};
