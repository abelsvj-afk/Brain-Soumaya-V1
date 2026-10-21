import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { actionFiredToday } from "../../communication/context.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { EdgesRepo } from "../../repositories/edges.repo.js";
import { EconomyRepo, FUEL_JOB_COST } from "../../economy.js";
import { researchEnabled } from "../../maintenance/agent.js";

/**
 * Live web lookup (SOUMAYA_TOOLS.md tool #4). When a memory explicitly asks to look
 * something up, Soumaya searches the live web (grounded) and attaches a cited answer.
 * GATED: only with Research Mode ON + a working provider + USD budget + Fuel — never
 * offline. When the provider can't ground (no key / blocked), the tool simply no-ops.
 */

// Explicit, imperative lookup intent only — never triggers on personal reflection.
const LOOKUP_RE = /\b(look ?up|find out|search (?:for|up)|google (?:it|this)?|research this|can you find|find me|what'?s the (?:latest|current|price)|current price of)\b/i;
const LOOKBACK_MS = 1000 * 60 * 60 * 24 * 3;

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

export const webLookupTool: Tool = {
  name: "web_lookup",
  description:
    "When a memory explicitly asks to look something up, search the live web and attach a concise cited answer. Requires Research Mode + budget + Fuel.",
  parameters: { type: "object", properties: { nodeId: { type: "number" }, query: { type: "string" } }, required: ["nodeId", "query"] },

  guard(tc: ToolContext): boolean {
    // Opt-in, budgeted, fuelled — the same gates as any expansion job.
    if (!researchEnabled(tc.ctx, tc.spaceId)) return false;
    if (tc.ctx.usage.overBudget?.()) return false;
    if (!new EconomyRepo(tc.ctx.handle, tc.spaceId).canRunJob()) return false;
    return typeof tc.ctx.llm.webLookup === "function";
  },

  detect(tc: ToolContext): ToolInvocation[] {
    // Once per SPACE-local day (owner rule 2026-10-21 — the guard follows
    // the user's own day, never the UTC day of the stored timestamp).
    if (actionFiredToday(tc.ctx.handle, tc.spaceId, "tool:web_lookup", new Date(tc.now))) return [];
    const rows = tc.ctx.handle.sqlite
      .prepare(
        `SELECT id, label, content, created_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
         ORDER BY created_at DESC LIMIT 40`,
      )
      .all(tc.spaceId) as MemRow[];
    for (const m of rows) {
      if (toMs(m.created_at) < tc.now - LOOKBACK_MS) break;
      const text = `${m.label}. ${m.content}`;
      if (!LOOKUP_RE.test(text)) continue;
      // Dedup: skip if a lookup result already derives from this memory.
      const already = tc.ctx.handle.sqlite
        .prepare(
          `SELECT 1 FROM edges e JOIN nodes a ON a.id = e.source
           WHERE e.space_id = ? AND e.target = ? AND e.relationship = 'relates_to' AND a.origin = 'agent' AND a.label LIKE 'Looked up:%'`,
        )
        .get(tc.spaceId, m.id);
      if (already) continue;
      return [{ tool: "web_lookup", args: { nodeId: m.id, query: m.content || m.label }, reason: `you asked to look something up` }];
    }
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const nodeId = Number(args.nodeId);
    const query = String(args.query ?? "").trim();
    if (!query || !tc.ctx.llm.webLookup) return { ok: false, summary: "web lookup unavailable" };

    const result = await tc.ctx.llm.webLookup(query);
    if (!result) return { ok: false, summary: "web lookup returned nothing (offline/blocked)" };

    // Charge Fuel like any expansion job now that real work happened.
    new EconomyRepo(tc.ctx.handle, tc.spaceId).spend(FUEL_JOB_COST);

    const short = query.replace(/\s+/g, " ").slice(0, 48);
    const label = `Looked up: ${short}`;
    const body = result.sources.length ? `${result.text}\n\nSources:\n${result.sources.map((s) => `• ${s}`).join("\n")}` : result.text;
    const vec = await tc.ctx.embeddings.embed(`${label}. ${result.text}`);
    const note = new NodesRepo(tc.ctx.handle, tc.spaceId).create(
      { label, type: "knowledge", content: body, importance: 0.3, origin: "agent", agent: "soumaya" } as never,
      vec,
    );
    new EdgesRepo(tc.ctx.handle, tc.spaceId).create({ source: note.id, target: nodeId, relationship: "relates_to", weight: 0.7 });

    const msg = `🔎 I looked that up: ${result.text.slice(0, 240)}${result.text.length > 240 ? "…" : ""}`;
    let delivered = false;
    try {
      await tc.notify(msg);
      delivered = true;
    } catch {
      /* router logs it regardless */
    }
    return { ok: true, summary: `looked up "${short}" (${result.sources.length} source(s))`, delivered, message: msg };
  },
};
