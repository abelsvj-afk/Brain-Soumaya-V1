import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { knn } from "../../db/vec.js";
import { keywordSearch, fuseRrf } from "../../db/fts.js";
import { multiHopNeighbors } from "../../graph/traversal.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";

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
    "Search the user's memories (the knowledge graph). Use when the user asks about something they may have told the brain before, or when you need context from past memories to answer. Returns matching memories with their labels, types, and content.",
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
    const vecSeeds = knn(s, vec, limit, tc.spaceId);
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
    if (nodes.length === 0) {
      return { ok: true, summary: "memory_search: 0 results" };
    }
    const lines = nodes.map(
      (n) => `#${n.id} [${n.type}] ${n.label}: ${n.content.slice(0, 300)}`
    );
    return {
      ok: true,
      // summary is content-free (it reaches agent_logs); the payload lives in
      // `message`, which only the agent loop consumes — never the audit log.
      summary: `memory_search: ${nodes.length} results`,
      targets: nodes.map((n) => n.id),
      message: lines.join("\n"),
    };
  },
};
