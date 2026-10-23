import type { AppContext } from "../../context.js";
import type { NotifyMeta } from "../notify/policy.js";
import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { TOOLS } from "./registry.js";
import { researchEnabled } from "../../maintenance/agent.js";
import { NoRecipientsError } from "../notify/sendErrors.js";

/**
 * The tool-router (docs/SOUMAYA_TOOLS.md). Each run, it lets every allowed tool
 * DETECT opportunities (deterministic, offline-safe) and executes them, logging each
 * action to `agent_logs` so there's an in-app record regardless of delivery channel.
 *
 * This is the offline spine. The LLM function-calling layer (when Research Mode +
 * budget + a key are present) will later CHOOSE invocations from a state briefing
 * instead of running every detector — it slots in right here without touching tools.
 */

const PER_TOOL_CAP = 8; // safety bound on how much one tool can do per tick

export interface RouterOptions {
  /** Deliver a message to the user (Telegram if linked). Defaults to a no-op. */
  notify?: (spaceId: string, text: string, meta?: NotifyMeta) => Promise<void>;
  /** Injected clock for tests. */
  now?: number;
}

function logAction(ctx: AppContext, spaceId: string, tool: string, reason: string, result: ToolResult, now: number): void {
  try {
    // Stamp with the tick's clock so per-day tool guards (which compare against `now`)
    // stay consistent with the log — and so tests with an injected clock behave.
    // A tool with no galaxy body to attach to (e.g. bill_risk) sets `message` — the
    // real user-facing text — and that's logged verbatim so the web app's in-app event
    // bridge (App.tsx) can toast it even for a user with no external channel linked.
    const description = result.message ?? `${result.summary} — ${reason}`;
    // Phase X: `result.targets` (optional, defaults to none) lets a tool record which
    // entity it concerned — every pre-existing tool leaves it unset, so this is
    // byte-identical to the old hardcoded '[]' for all of them.
    ctx.handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(spaceId, `tool:${tool}`, description, JSON.stringify(result.targets ?? []), new Date(now).toISOString());
  } catch {
    /* best-effort logging */
  }
}

/** A short, factual state briefing for the LLM router (no LLM call — pure DB reads). */
function buildBriefing(ctx: AppContext, spaceId: string): string {
  const s = ctx.handle.sqlite;
  const mem = (s.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id=? AND deleted_at IS NULL AND (kind IS NULL OR kind='memory')`).get(spaceId) as { c: number }).c;
  const recent = s
    .prepare(`SELECT label FROM nodes WHERE space_id=? AND deleted_at IS NULL AND (kind IS NULL OR kind='memory') ORDER BY created_at DESC LIMIT 5`)
    .all(spaceId) as { label: string }[];
  return `Memories: ${mem}. Recent: ${recent.map((r) => `"${r.label}"`).join(", ") || "none"}.`;
}

/** Run the router for one space. Returns the results of every tool action taken. */
export async function runToolRouter(ctx: AppContext, spaceId: string, opts: RouterOptions = {}): Promise<ToolResult[]> {
  const now = opts.now ?? Date.now();
  const tc: ToolContext = {
    ctx,
    spaceId,
    now,
    notify: async (text: string, meta?: NotifyMeta) => {
      // RE-02: with no delivery channel configured, say so honestly
      // (NoRecipientsError) instead of silently no-oping — a tool that
      // owns a firing decision (reminder) defers on this signal instead
      // of consuming its event; other tools already catch notify errors
      // and simply record delivered=false.
      if (!opts.notify) {
        throw new NoRecipientsError("no delivery channel configured");
      }
      await opts.notify(spaceId, text, meta);
    },
  };

  // Phase 1 — gather DETERMINISTIC candidates from every allowed tool (offline-safe).
  const candidates: { tool: Tool; inv: ToolInvocation }[] = [];
  for (const tool of TOOLS) {
    if (tool.guard && !tool.guard(tc)) continue;
    try {
      for (const inv of tool.detect(tc).slice(0, PER_TOOL_CAP)) candidates.push({ tool, inv });
    } catch (e) {
      console.error(`[tools] ${tool.name} detect failed:`, e);
    }
  }
  if (candidates.length === 0) return [];

  // Phase 2 — optional agentic curation. When Research Mode is on + a working LLM
  // router exists, Soumaya CHOOSES which candidates are worth doing now (curbs noise).
  // She can only pick from the validated deterministic candidates — never invent one —
  // so this adds judgement without adding risk. Any failure keeps every candidate.
  let chosen = candidates;
  if (typeof ctx.llm.route === "function" && candidates.length > 1 && researchEnabled(ctx, spaceId) && !ctx.usage.overBudget?.()) {
    try {
      const idxs = await ctx.llm.route(buildBriefing(ctx, spaceId), candidates.map((c) => ({ tool: c.inv.tool, reason: c.inv.reason })));
      const picked = new Set(idxs.filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length));
      if (picked.size > 0) chosen = candidates.filter((_, i) => picked.has(i));
    } catch (e) {
      console.error("[tools] llm route failed; running all candidates:", e);
    }
  }

  // Phase 3 — execute the chosen actions, logging each.
  const results: ToolResult[] = [];
  for (const { tool, inv } of chosen) {
    try {
      const r = await tool.run(tc, inv.args);
      logAction(ctx, spaceId, tool.name, inv.reason, r, now);
      results.push(r);
    } catch (e) {
      console.error(`[tools] ${tool.name} run failed:`, e);
    }
  }
  return results;
}
