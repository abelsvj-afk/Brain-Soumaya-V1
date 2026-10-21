import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { mentions } from "../../analysis/cognitiveTokens.js";

/**
 * Telegram Parity Phase 1: one entity + its graph connections, exactly.
 *
 * "What do I know about X / how is X connected?" cannot be answered from
 * top-K retrieval prose (findings §1/§3): retrieval surfaces a sample and
 * the model presents it as the whole picture. This tool resolves ONE node
 * (by id, or by literal label match) and returns it with its edges in BOTH
 * directions — outgoing (this node → others) and incoming (others → this
 * node) — read straight from the graph.
 *
 * Edge relationships are reported with their STORED relationship values.
 * Note: the stored set is wider than @brain/shared's RELATIONSHIP_TYPES
 * (the extraction vocabulary) — it also contains structural relationships
 * like 'supports' (a memory mentioning a person) — so nothing is filtered
 * out; hiding 'supports' would hide exactly the person connections this
 * tool exists to show.
 *
 * Label resolution is literal (never vector search): exact case-insensitive
 * label first, then a whole-word/phrase `mentions` match over labels of
 * live nodes. Multiple candidates are reported back for disambiguation
 * rather than silently picking one.
 *
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const MAX_EDGES_PER_DIRECTION = 50;

interface EdgeRow {
  relationship: string;
  weight: number;
  otherId: number;
  otherLabel: string;
  otherType: string;
  otherKind: string | null;
}

export const entityLookupTool: Tool = {
  name: "entity_lookup",
  description:
    "Look up ONE specific thing in the user's brain (a memory, person, goal, or any other node) and get its full stored content plus ALL its graph connections in both directions (what it points to, and what points to it). Give either its numeric id (from memory_search, people_lookup, or brain_stats results) or its exact label. Use for 'what do I know about X' and 'how is X connected' questions — do not reconstruct an entity's connections from search samples.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "The node's numeric id, when known (preferred — unambiguous).",
      },
      label: {
        type: "string",
        description: "The node's label (title/name), matched literally when no id is given.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const s = tc.ctx.handle.sqlite;
    const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
    const idArg = typeof args.id === "number" && Number.isInteger(args.id) ? args.id : null;
    const labelArg = String(args.label ?? "").trim();

    if (idArg === null && !labelArg) {
      return { ok: false, summary: "entity_lookup: neither id nor label given" };
    }

    // ----- Resolve the node. -----
    let node = idArg !== null ? repo.getById(idArg) : undefined;
    if (idArg !== null && !node) {
      return {
        ok: true,
        summary: `entity_lookup: node #${idArg} not found`,
        message: `ENTITY LOOKUP: no node with id ${idArg} exists in this brain (it may be deleted, or the id came from somewhere else). Say so — do not invent a substitute.`,
      };
    }
    if (!node && labelArg) {
      const candidates = repo
        .all()
        .filter(
          (n) =>
            n.label.toLowerCase() === labelArg.toLowerCase() || mentions(n.label, labelArg),
        );
      if (candidates.length === 0) {
        return {
          ok: true,
          summary: "entity_lookup: label not found",
          message: `ENTITY LOOKUP: no live node is labeled "${labelArg}". Say so honestly — do not guess a similar entity.`,
        };
      }
      if (candidates.length > 1) {
        return {
          ok: true,
          summary: `entity_lookup: label ambiguous (${candidates.length} candidates)`,
          targets: candidates.map((c) => c.id),
          message:
            `ENTITY LOOKUP: "${labelArg}" matches ${candidates.length} different nodes — ask the user which one they mean, or call again with an id:\n` +
            candidates.map((c) => `- #${c.id} [${c.type}] ${c.label}`).join("\n"),
        };
      }
      node = candidates[0];
    }
    if (!node) return { ok: false, summary: "entity_lookup: unresolved" };

    // ----- Edges in BOTH directions (stored relationship values, unfiltered). -----
    const outgoing = s
      .prepare(
        `SELECT e.relationship AS relationship, e.weight AS weight,
                n.id AS otherId, n.label AS otherLabel, n.type AS otherType, n.kind AS otherKind
         FROM edges e JOIN nodes n ON n.id = e.target
         WHERE e.space_id = ? AND e.source = ? AND n.deleted_at IS NULL
         ORDER BY e.id ASC LIMIT ?`,
      )
      .all(tc.spaceId, node.id, MAX_EDGES_PER_DIRECTION) as EdgeRow[];
    const incoming = s
      .prepare(
        `SELECT e.relationship AS relationship, e.weight AS weight,
                n.id AS otherId, n.label AS otherLabel, n.type AS otherType, n.kind AS otherKind
         FROM edges e JOIN nodes n ON n.id = e.source
         WHERE e.space_id = ? AND e.target = ? AND n.deleted_at IS NULL
         ORDER BY e.id ASC LIMIT ?`,
      )
      .all(tc.spaceId, node.id, MAX_EDGES_PER_DIRECTION) as EdgeRow[];
    const totalEdges = (
      s
        .prepare(
          `SELECT COUNT(*) AS c FROM edges e
           JOIN nodes a ON a.id = e.source AND a.deleted_at IS NULL
           JOIN nodes b ON b.id = e.target AND b.deleted_at IS NULL
           WHERE e.space_id = ? AND (e.source = ? OR e.target = ?)`,
        )
        .get(tc.spaceId, node.id, node.id) as { c: number }
    ).c;

    const edgeLine = (e: EdgeRow) =>
      `  - ${e.relationship} → #${e.otherId} [${e.otherType}${e.otherKind ? `/${e.otherKind}` : ""}] ${e.otherLabel}`;
    const edgeLineIn = (e: EdgeRow) =>
      `  - #${e.otherId} [${e.otherType}${e.otherKind ? `/${e.otherKind}` : ""}] ${e.otherLabel} —${e.relationship}→ this node`;

    const lines = [
      `ENTITY #${node.id}: ${node.label}`,
      `Type: ${node.type}${node.kind ? `; kind: ${node.kind}` : ""}${node.status ? `; status: ${node.status}` : ""}; created: ${node.createdAt.slice(0, 10)}`,
      ...(node.aliases && node.aliases.length > 0 ? [`Also known as: ${node.aliases.join(", ")}`] : []),
      `Content: ${node.content.slice(0, 1000)}`,
      `Outgoing connections (this node → others): ${outgoing.length === 0 ? "none" : ""}`,
      ...outgoing.map(edgeLine),
      `Incoming connections (others → this node): ${incoming.length === 0 ? "none" : ""}`,
      ...incoming.map(edgeLineIn),
      ...(totalEdges > outgoing.length + incoming.length
        ? [`(Showing ${outgoing.length + incoming.length} of ${totalEdges} connections — capped at ${MAX_EDGES_PER_DIRECTION} per direction.)`]
        : []),
    ];

    return {
      ok: true,
      summary: `entity_lookup: node #${node.id}, ${totalEdges} connection(s)`,
      targets: [node.id],
      message: lines.join("\n"),
    };
  },
};
