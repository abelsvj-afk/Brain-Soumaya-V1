import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { vecSearchCurrent } from "../../db/vec.js";
import { keywordSearch, fuseRrf } from "../../db/fts.js";
import { multiHopNeighbors } from "../../graph/traversal.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { episodeSearch } from "../episodic.js"; // W2: episodes as parallel namespace (§7.1)

/**
 * Phase 1 agent loop: memory search as a tool. Wraps the same hybrid
 * retrieval chat() uses (vector KNN + BM25 keyword, RRF-fused, multi-hop
 * expansion) WITHOUT the LLM answer generation — the loop needs raw memories
 * to reason over, not a pre-written reply.
 *
 * Space isolation: every primitive takes tc.spaceId from the server-provided
 * ToolContext. The model NEVER supplies a space id. Cross-space retrieval is
 * impossible by construction (acceptance-tested).
 *
 * Read-only. No approval required.
 */

const MAX_RESULTS = 8;

export const memorySearchTool: Tool = {
  name: "memory_search",
  description:
    "Search the user's memories (the knowledge graph) AND past episodes (lived events: what happened, when, what it was like). Use when the user asks about something they may have told the brain before, or when you need context from past memories to answer. Returns matching memories with their labels, types, and content, plus matching episodes in a separate labeled section — facts and narratives, never merged.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to search for — a question or keywords describing the memories you need.",
      },
      limit: {
        type: "integer",
        description: "Max memories to return (1-8, default 5).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, summary: "empty search query" };
    const limit = Math.min(MAX_RESULTS, Math.max(1, Number(args.limit ?? 5) || 5));

    const vec = await tc.ctx.embeddings.embed(query);
    const s = tc.ctx.handle.sqlite;
    // All three primitives are space-scoped: tc.spaceId comes from the server,
    // never from the model. There is no code path that reads another space.
    // W1: vecSearchCurrent applies the current-truth filter (superseded_at IS
    // NULL) at seed time — superseded nodes never win similarity ranking.
    const vecSeeds = vecSearchCurrent(s, tc.spaceId, vec, limit);
    const kwSeeds = keywordSearch(s, tc.spaceId, query, limit);
    const seedIds = fuseRrf(vecSeeds, kwSeeds, limit);

    const ids = new Set<number>();
    for (const sid of seedIds) {
      ids.add(sid);
      for (const hop of multiHopNeighbors(s, sid, 1)) ids.add(hop.nodeId);
      if (ids.size >= limit * 2) break;
    }

    const nodesRepo = new NodesRepo(tc.ctx.handle, tc.spaceId);
    const nodes = nodesRepo.byIds([...ids].slice(0, limit * 2)).slice(0, limit);

    // W2 §7.1: episodes are a PARALLEL namespace, never merged with nodes.
    // vec KNN over enrichment embeddings + canonical scorer rerank (§3.6).
    // Fail-open: an episode-retrieval failure must never break node search.
    let epLines: string[] = [];
    try {
      const hits = await episodeSearch(tc.ctx.handle, tc.spaceId, vec, limit);
      // Labeled distinctly per §7.1: episodes are narratives, not truth claims.
      epLines = hits.map(
        (h) =>
          `episode#${h.episodeId} [${h.episode.kind}] ${h.episode.summary.slice(0, 300)} (occurred ${h.episode.occurred_at})`
      );
    } catch {
      epLines = [];
    }

    const nodeLines = nodes.map(
      (n) => `#${n.id} [${n.type}] ${n.label}: ${n.content.slice(0, 300)}`
    );
    const sections: string[] = [];
    if (nodeLines.length > 0) sections.push(`## Facts (nodes)\n${nodeLines.join("\n")}`);
    if (epLines.length > 0)
      sections.push(
        `## Episodes (what happened / what it was like — NOT what is true now)\n${epLines.join("\n")}`
      );

    if (sections.length === 0) {
      return { ok: true, summary: "memory_search: 0 results" };
    }
    return {
      ok: true,
      // summary is content-free (it reaches agent_logs); the payload lives in
      // `message`, which only the agent loop consumes — never the audit log.
      summary: `memory_search: ${nodes.length} nodes, ${epLines.length} episodes`,
      targets: nodes.map((n) => n.id),
      message: sections.join("\n\n"),
    };
  },
};
