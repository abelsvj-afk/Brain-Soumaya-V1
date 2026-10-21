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
import { brainStatsTool } from "./brainStats.js";
import { peopleLookupTool } from "./peopleLookup.js";
import { entityLookupTool } from "./entityLookup.js";
import { agendaListTool } from "./agendaList.js";
import { journeysListTool } from "./journeysList.js";
import { insightsListTool } from "./insightsList.js";
import { captureMemoryTool } from "./captureMemory.js";
import { storyTimeTool } from "./storyTime.js";
import { dreamPlaybackTool } from "./dreamPlayback.js";
import { memoryQuizTool } from "./memoryQuiz.js";
import { constellationTourTool } from "./constellationTour.js";
import { briefMeTool } from "./briefMe.js";
import { relationshipRadarTool } from "./relationshipRadar.js";
import { onThisDayTool } from "./onThisDay.js";
import { prepareMeTool } from "./prepareMe.js";

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
  captureMemoryTool,
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
  brainStatsTool,
  peopleLookupTool,
  entityLookupTool,
  agendaListTool,
  journeysListTool,
  insightsListTool,
  storyTimeTool,
  dreamPlaybackTool,
  memoryQuizTool,
  constellationTourTool,
  briefMeTool,
  relationshipRadarTool,
  onThisDayTool,
  prepareMeTool,
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
  // Telegram Parity Phase 1 (owner decision): exact-answer READ tools — the
  // loop previously had no way to count, list people, or look up an entity,
  // so it invented answers (findings §1–§3). All read-only, no approval.
  { tool: brainStatsTool, isWrite: false },
  { tool: peopleLookupTool, isWrite: false },
  { tool: entityLookupTool, isWrite: false },
  // Telegram Parity Phase 4 (owner decision): tab parity — the seven
  // router-only analysis tools are promoted to model-callable READ tools
  // (each gained a conversational no-arg path; their router detect()/run()
  // behavior is unchanged and they remain in TOOLS above), plus list tools
  // for the Agenda / Journeys / Insights tabs. All read-only, no approval.
  // NOTE: chart_discovery's conversational path is list-only (it never
  // records a Codex entry); recording still happens only via the router.
  { tool: billRiskTool, isWrite: false },
  { tool: goalFundingTrendTool, isWrite: false },
  { tool: financeFreshnessTool, isWrite: false },
  { tool: weeklyReviewTool, isWrite: false },
  { tool: orphanTool, isWrite: false },
  { tool: chartDiscoveryTool, isWrite: false },
  { tool: reviewNudgeTool, isWrite: false },
  { tool: agendaListTool, isWrite: false },
  { tool: journeysListTool, isWrite: false },
  { tool: insightsListTool, isWrite: false },
  // Telegram Parity Phase 5-A (owner decision): assembled READ tools —
  // brief_me (reminders/bills/streak/goals + a deterministic-rule focus),
  // relationship_radar (longest-silent people), on_this_day (past-year
  // memories + month-old decisions, space-local days), prepare_me (person
  // / topic dossier). All compose existing sources; all read-only.
  { tool: briefMeTool, isWrite: false },
  { tool: relationshipRadarTool, isWrite: false },
  { tool: onThisDayTool, isWrite: false },
  { tool: prepareMeTool, isWrite: false },
  // Telegram Parity Phase 5-B: multi-turn conversational games. Both are
  // READ tools — their state is in-memory game scaffolding only
  // (agent/gameSessions.ts); the quiz NEVER writes a memory itself (a
  // correction is routed to a capture_memory proposal, approval-gated
  // like every conversational write), and the tour only reads edges.
  { tool: memoryQuizTool, isWrite: false },
  { tool: constellationTourTool, isWrite: false },
  { tool: reminderTool, isWrite: true },
  { tool: taskCreatorTool, isWrite: true },
  // Telegram Parity Phase 2 (owner decision D3): conversational capture —
  // "remember this: …" without the /log prefix. A WRITE like the other two:
  // proposing it creates a pending approval and nothing is ingested until
  // the owner says "yes". /log stays the immediate owner-typed command path.
  { tool: captureMemoryTool, isWrite: true },
  // Telegram Parity Phase 5-C (narration & read-back): story_time is a READ
  // (a first-ever telling persists its generated chapter via the lore
  // engine's own first-view path, exactly as the app does; it never edits
  // the memory). dream_playback is flagged as a WRITE — see its header:
  // pure playback is a read, but its "that's wrong" correction path records
  // a stated correction through the approval-gated capture/ingest intake
  // (D3), and the loop gates per-tool, not per-args. It NEVER edits a
  // belief (INV-KC-1): the correction lands as a stated record alongside
  // the belief, which stays byte-unchanged.
  { tool: storyTimeTool, isWrite: false },
  { tool: dreamPlaybackTool, isWrite: true },
];
