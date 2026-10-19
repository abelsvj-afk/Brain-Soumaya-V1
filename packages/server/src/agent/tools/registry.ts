import type { Tool } from "./types.js";
import { reminderTool } from "./reminder.js";
import { taskCreatorTool } from "./taskCreator.js";
import { orphanTool } from "./orphan.js";
import { reviewNudgeTool } from "./reviewNudge.js";
import { checkinTool } from "./checkin.js";
import { webLookupTool } from "./webLookup.js";
import { weeklyReviewTool } from "./weeklyReview.js";
import { chartDiscoveryTool } from "./chartDiscovery.js";
import { billRiskTool } from "./billRisk.js";
import { financeFreshnessTool } from "./financeFreshness.js";
import { goalFundingTrendTool } from "./goalFundingTrend.js";
import { memorySearchTool } from "./memorySearch.js";

/**
 * The tools Soumaya can call on her own (docs/SOUMAYA_TOOLS.md). Add new tools here;
 * the router picks them up automatically. Order is the deterministic execution order.
 *
 * Phase 1 agent loop: the loop uses AGENT_TOOLS (a subset), not the full registry.
 * memorySearch is loop-only (its detect() returns [] so the router never fires it).
 */
export const TOOLS: Tool[] = [
  reminderTool,
  taskCreatorTool,
  orphanTool,
  reviewNudgeTool,
  checkinTool,
  webLookupTool,
  weeklyReviewTool,
  chartDiscoveryTool,
  billRiskTool,
  financeFreshnessTool,
  goalFundingTrendTool,
  memorySearchTool,
];

/**
 * Phase 1 agent loop tool set. Read tools execute automatically; write tools
 * (isWrite: true) require an explicit user approval per the approvals module.
 * This is the ONLY list the loop may offer to the model.
 */
export interface AgentToolEntry {
  tool: Tool;
  /** True → requestApproval() before execution; never auto-executed. */
  isWrite: boolean;
}

export const AGENT_TOOLS: AgentToolEntry[] = [
  { tool: memorySearchTool, isWrite: false },
  { tool: webLookupTool, isWrite: false },
  { tool: checkinTool, isWrite: false },
  { tool: reminderTool, isWrite: true },
  { tool: taskCreatorTool, isWrite: true },
];
