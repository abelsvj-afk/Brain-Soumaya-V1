import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { EdgesRepo } from "../../repositories/edges.repo.js";

/**
 * Autonomous task creation — Soumaya turns a commitment you voiced ("I need to call
 * the landlord", "I'll email them tomorrow") into a real action item on her own,
 * linked back to the memory it came from. Deterministic phrase detection (offline);
 * one action per source memory (deduped via a `relates_to` edge from the action).
 */

// First-person future commitments. Tight on purpose — a false "todo" is annoying.
const COMMIT_RE =
  /\b(i (need|have|want|ought|got) to|i(?:'| wi)ll|i'm going to|i am going to|i gotta|i must|i should|don'?t forget to|remember to|make sure (?:i|to)|note to self)\b/i;

const MAX_PER_TICK = 3;
const LOOKBACK_MS = 1000 * 60 * 60 * 24 * 7; // only scan the last week's memories

interface MemRow {
  id: number;
  label: string;
  content: string;
  created_at: string;
}

function toMs(iso: string): number {
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

/** Pull the clause that carries the commitment, so the task reads like a task. */
function taskLabel(text: string): string {
  const m = text.match(COMMIT_RE);
  const from = m ? Math.max(0, (m.index ?? 0)) : 0;
  const clause = text
    .slice(from)
    .split(/[.!?\n]/)[0]!
    .trim()
    .replace(/^\W+/, "");
  const words = (clause || text).trim().split(/\s+/).slice(0, 10).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const taskCreatorTool: Tool = {
  name: "create_task",
  description:
    "When a memory voices a first-person commitment or to-do, create a linked action item so it isn't forgotten. One task per memory.",
  parameters: {
    type: "object",
    properties: { nodeId: { type: "number" }, label: { type: "string" } },
    required: ["nodeId", "label"],
  },

  detect(tc: ToolContext): ToolInvocation[] {
    const rows = tc.ctx.handle.sqlite
      .prepare(
        `SELECT id, label, content, created_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
         ORDER BY created_at DESC LIMIT 60`,
      )
      .all(tc.spaceId) as MemRow[];
    const out: ToolInvocation[] = [];
    for (const m of rows) {
      if (toMs(m.created_at) < tc.now - LOOKBACK_MS) break; // ordered desc → past the window
      const text = `${m.label}. ${m.content}`;
      if (!COMMIT_RE.test(text)) continue;
      // Dedup: skip if an action already derives from this memory.
      const already = tc.ctx.handle.sqlite
        .prepare(
          `SELECT 1 FROM edges e JOIN nodes a ON a.id = e.source
           WHERE e.space_id = ? AND e.target = ? AND e.relationship = 'relates_to' AND a.kind = 'action'`,
        )
        .get(tc.spaceId, m.id);
      if (already) continue;
      out.push({ tool: "create_task", args: { nodeId: m.id, label: taskLabel(text) }, reason: `you said you'd "${taskLabel(text)}"` });
      if (out.length >= MAX_PER_TICK) break;
    }
    return out;
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const nodeId = Number(args.nodeId);
    const label = String(args.label ?? "").trim();
    if (!label) return { ok: false, summary: "empty task label" };
    const s = tc.ctx.handle.sqlite;
    const src = s.prepare(`SELECT content FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`).get(nodeId, tc.spaceId) as
      | { content: string }
      | undefined;
    if (!src) return { ok: false, summary: `source memory ${nodeId} gone` };

    const expiresAt = new Date(tc.now + 3 * 24 * 3_600_000).toISOString(); // a 3-day soft window
    const vec = await tc.ctx.embeddings.embed(label);
    const action = new NodesRepo(tc.ctx.handle, tc.spaceId).create(
      { label, type: "daily", content: label, importance: 0.12, kind: "action", expiresAt, origin: "agent", agent: "soumaya" } as never,
      vec,
    );
    new EdgesRepo(tc.ctx.handle, tc.spaceId).create({ source: action.id, target: nodeId, relationship: "relates_to", weight: 0.6 });

    const msg = `✅ I made you an action: "${label}"`;
    let delivered = false;
    try {
      await tc.notify(msg, {
        tool: "create_task",
        actionId: action.id,
      });
      delivered = true;
    } catch {
      /* logged by the router regardless */
    }
    return { ok: true, summary: `created action "${label}" from memory ${nodeId}`, delivered, message: msg };
  },
};
