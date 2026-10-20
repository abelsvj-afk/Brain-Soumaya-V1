import type { AppContext } from "../context.js";
import type { LlmLoopMessage, LlmToolDefinition, LlmToolResult } from "../llm/adapter.js";
import { composeSystem } from "../llm/prompts.js";
import { soulTextFor } from "../identity.js";
import type { Tool, ToolContext } from "./tools/types.js";
import { AGENT_TOOLS } from "./tools/registry.js";
import { validateArgs } from "./tools/validation.js";
import { composeUserModelBlock } from "./userModel.js"; // W2: user-model context block (§7.2)
import { maybeRecordStated } from "./userModel.js"; // W2: stated-write trigger (§4.8)
import { captureEpisode } from "./episodic.js"; // W2: episode capture triggers (§5.1)
import {
  requestApproval,
  confirmApproval,
  denyApproval,
  executeApproval,
  findPendingApproval,
} from "./approvals.js";

/**
 * Phase 1 agent loop: Soumaya can call tools mid-conversation.
 *
 * Bounds (all server-enforced, never model-controlled):
 * - MAX_ITERATIONS = 6 model/tool round-trips per user turn.
 * - MAX_CALLS_PER_RESPONSE = 4 proposed tool calls per model response
 *   (counts PROPOSED calls — resource control).
 * - MAX_EXECUTIONS_PER_TURN = 12 actual tool executions per turn.
 *
 * Batch semantics (strict, in-order, no reordering):
 * - Calls are processed in the model's proposed order.
 * - Read calls execute immediately (after validate + guard).
 * - The first write call STOPS the batch: an approval is created and the
 *   remaining calls are marked deferred (blocked_behind_write). They are NOT
 *   queued — after the write resolves, the model re-decides.
 * - Every proposed call gets an explicit outcome (executed / deferred /
 *   rejected) fed back to the model, so it never repeats completed work
 *   unknowingly.
 *
 * Write approvals: the model NEVER executes a write directly. requestApproval()
 * creates a pending approval; the model is told to ask the user. The user's
 * next message is checked for confirmation by the caller (see
 * maybeConfirmPending). Only confirmApproval() + executeApproval() run it.
 */

export const MAX_ITERATIONS = 6;
export const MAX_CALLS_PER_RESPONSE = 4;
export const MAX_EXECUTIONS_PER_TURN = 12;

export interface AgentLoopInput {
  ctx: AppContext;
  spaceId: string;
  /** "telegram:<chatId>" or "web:<userId>" — binds approvals to the requester. */
  principal: string;
  userMessage: string;
  history: { role: "you" | "soumaya"; text: string }[];
  now: number;
  notify: (text: string) => Promise<void>;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  text: string;
  /** Set when the turn ended asking the user to confirm a write. */
  pendingApprovalId?: number;
  /** W2 §5.1: set when the loop's return path already captured this turn's
      episode — callers that would otherwise capture must skip (no doubles). */
  episodeCaptured?: boolean;
}

type CallOutcome =
  | { status: "executed"; callId: string; name: string; result: string }
  | { status: "deferred"; callId: string; name: string; reason: string; approvalId?: number }
  | { status: "rejected"; callId: string; name: string; reason: string };

function buildSystemExtra(): string {
  const lines = AGENT_TOOLS.map(
    ({ tool, isWrite }) =>
      `- ${tool.name}: ${tool.description}${isWrite ? " [WRITE — requires the user's explicit confirmation; you cannot run it yourself]" : ""}`
  );
  return (
    "You have tools you can call during this conversation. Use them when they genuinely help — " +
    "don't call tools for chit-chat.\n" +
    "TOOLS:\n" +
    lines.join("\n") +
    "\n\nRules:\n" +
    "- Call a tool by name with arguments matching its schema. You may propose up to 4 calls per response.\n" +
    "- WRITE tools never execute immediately: proposing one creates a confirmation request. " +
    'Tell the user what you want to do and ask them to say "yes". Do NOT claim it is done until confirmed.\n' +
    "- If a tool result says an approval is pending, your next message must be the confirmation question — nothing else."
  );
}

function toToolDefinitions(): LlmToolDefinition[] {
  return AGENT_TOOLS.map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function outcomeText(o: CallOutcome): string {
  switch (o.status) {
    case "executed":
      return `[${o.name}] done: ${o.result}`;
    case "deferred":
      return `[${o.name}] deferred (${o.reason})${o.approvalId ? ` — approval #${o.approvalId} created; ask the user to confirm` : ""}`;
    case "rejected":
      return `[${o.name}] not run: ${o.reason}`;
  }
}

/** Confirmation-shaped messages ("yes", "yeah", "confirm", "do it", ...). */
const CONFIRM_RE = /^(yes|yeah|yep|sure|ok|okay|confirm|do it|go ahead|please do)\.?$/i;
const DENY_RE = /^(no|nope|nah|cancel|don't|dont|never mind|nevermind)\.?$/i;

/**
 * Check whether this user message confirms or denies a pending approval.
 * Called by chat/telegrAM entry points BEFORE the agent loop. Returns the
 * execution result text when it handled the message, null otherwise.
 *
 * Only acts when there is EXACTLY ONE pending approval for this
 * principal+space — ambiguity means asking, not guessing.
 */
export async function maybeConfirmPending(
  ctx: AppContext,
  spaceId: string,
  principal: string,
  userMessage: string,
  tc: ToolContext,
): Promise<string | null> {
  const text = userMessage.trim();
  const isConfirm = CONFIRM_RE.test(text);
  const isDeny = DENY_RE.test(text);
  if (!isConfirm && !isDeny) return null;

  const pending = findPendingApproval(ctx, spaceId, principal);
  if (!pending) return null;

  if (isDeny) {
    const d = denyApproval(ctx, spaceId, principal, pending.id, tc.now);
    return d.ok ? "Got it — I won't do that." : `I couldn't cancel that (${d.error}).`;
  }
  const c = confirmApproval(ctx, spaceId, principal, pending.id, tc.now);
  if (!c.ok || !c.approval) {
    return `I couldn't confirm that (${c.error}).`;
  }
  const exec = await executeApproval(tc, c.approval);
  if (exec.ok && exec.result) {
    return exec.result.message ?? exec.result.summary;
  }
  return `I tried, but it didn't go through: ${exec.error ?? "unknown error"}.`;
}

export async function agentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { ctx, spaceId, principal, now } = input;
  const tc: ToolContext = { ctx, spaceId, now, notify: input.notify };

  // W2 §4.8: conservative stated-write trigger. Evaluated on the user's raw
  // message at turn start — the assertion is HIS, independent of whatever the
  // loop later replies. maybeRecordStated() never throws and never blocks.
  // When it fires, it captures an episode synchronously (for INV-EV-1
  // evidence); we remember that ID so the return-path capture skips (no
  // double-capture, §5.1).
  let statedEpisodeId: number | null = null;
  try {
    statedEpisodeId = maybeRecordStated(ctx.handle, spaceId, input.userMessage);
  } catch {
    statedEpisodeId = null;
  }

  const soul = soulTextFor(ctx.handle.sqlite, spaceId);
  // W2 §7.2 / §6.4: the user-model block is additive, best-effort conversational
  // context. composeUserModelBlock() fails OPEN by contract: it returns "" when
  // the user model is unavailable or any read fails, and it never throws.
  const userModelBlock = composeUserModelBlock(ctx.handle, spaceId);
  const systemInstruction = composeSystem({
    soul: soul ?? undefined,
    systemExtra: buildSystemExtra() + (userModelBlock ? `\n\n${userModelBlock}` : ""),
  });

  const toolDefs = toToolDefinitions();
  const messages: LlmLoopMessage[] = [
    ...input.history.map((h): LlmLoopMessage =>
      h.role === "you" ? { role: "user", text: h.text } : { role: "model", text: h.text }
    ),
    { role: "user", text: input.userMessage },
  ];

  let executions = 0;
  let pendingApprovalId: number | undefined;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    if (!ctx.llm.callWithTools) {
      // No function-calling on this provider — degrade to plain text.
      // (All three providers implement it; this is a safety net.)
      break;
    }
    let res: LlmToolResult;
    try {
      res = await ctx.llm.callWithTools({
        systemInstruction,
        messages,
        tools: toolDefs,
        signal: input.signal,
      });
    } catch (err) {
      return { text: `I hit a snag reaching my tools (${(err as Error).message.slice(0, 120)}). Try again in a moment.` };
    }

    if (res.text !== null || res.calls.length === 0) {
      const text = res.text ?? "I don't have a good answer for that yet.";
      captureTurnEpisode(ctx, spaceId, input.userMessage, text, {
        toolExecutions: executions,
        approvalPending: pendingApprovalId !== undefined,
        alreadyCapturedId: statedEpisodeId,
      });
      return { text, pendingApprovalId, episodeCaptured: true };
    }

    // --- Process the proposed calls: strict in-order, bounded. ---
    const outcomes: CallOutcome[] = [];
    const proposed = res.calls;
    const processable = proposed.slice(0, MAX_CALLS_PER_RESPONSE);
    let stoppedForApproval = false;

    // Record the assistant's tool_calls message BEFORE any tool results.
    // OpenAI (and strict providers) reject "tool" messages that aren't
    // preceded by the assistant message containing the matching tool_calls.
    messages.push({ role: "model", text: null, toolCalls: processable });

    for (const call of processable) {
      if (stoppedForApproval) {
        outcomes.push({
          status: "deferred",
          callId: call.id,
          name: call.name,
          reason: "blocked_behind_write",
        });
        continue;
      }
      const entry = AGENT_TOOLS.find((e) => e.tool.name === call.name);
      if (!entry) {
        outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: "unknown tool" });
        continue;
      }
      const tool: Tool = entry.tool;
      const v = validateArgs(tool, call.args);
      if (!v.ok) {
        outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: v.error ?? "invalid args" });
        continue;
      }
      if (tool.guard && !tool.guard(tc)) {
        outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: "tool not available right now" });
        continue;
      }

      if (entry.isWrite) {
        // WRITE: never execute directly. Create the approval and stop the batch.
        // One pending approval at a time: a second write proposal while one is
        // pending would brick confirmation (findPendingApproval needs exactly one).
        if (pendingApprovalId !== undefined) {
          outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: `approval #${pendingApprovalId} is already pending; confirm or deny it first` });
          continue;
        }
        const req = requestApproval(tc, tool, call.args, principal);
        if (!req.ok) {
          outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: req.error ?? "approval failed" });
          continue;
        }
        pendingApprovalId = req.approvalId;
        outcomes.push({
          status: "deferred",
          callId: call.id,
          name: call.name,
          reason: "awaiting_approval",
          approvalId: req.approvalId,
        });
        stoppedForApproval = true;
        continue;
      }

      // READ: execute immediately, bounded by the per-turn cap.
      if (executions >= MAX_EXECUTIONS_PER_TURN) {
        outcomes.push({ status: "rejected", callId: call.id, name: call.name, reason: "per-turn execution cap reached" });
        stoppedForApproval = true; // stop the batch; don't silently skip ahead
        continue;
      }
      executions++;
      let toolResult: string;
      try {
        const r = await tool.run(tc, call.args);
        toolResult = r.message ?? r.summary;
        // Audit: templated, content-free. The payload (message) goes to the
        // model only — never to agent_logs.
        auditToolRun(ctx, spaceId, tool.name, r.ok);
      } catch (err) {
        toolResult = `error: ${(err as Error).message.slice(0, 200)}`;
        auditToolRun(ctx, spaceId, tool.name, false);
      }
      outcomes.push({ status: "executed", callId: call.id, name: call.name, result: toolResult });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, result: toolResult });
    }

    // Over-cap proposals get explicit outcomes (the model must know).
    for (const call of proposed.slice(MAX_CALLS_PER_RESPONSE)) {
      outcomes.push({
        status: "rejected",
        callId: call.id,
        name: call.name,
        reason: `over per-response cap of ${MAX_CALLS_PER_RESPONSE} proposed calls`,
      });
    }

    // Feed non-executed outcomes back, one tool message per call with its
    // REAL call id (a fake id breaks OpenAI's tool_call_id matching).
    // Executed ones were already appended above.
    for (const o of outcomes) {
      if (o.status === "executed") continue;
      messages.push({ role: "tool", toolCallId: o.callId, name: o.name, result: outcomeText(o) });
    }

    if (stoppedForApproval) {
      // The model's next message must be the confirmation question. Give it
      // one more iteration to formulate it in its own voice.
      continue;
    }
  }

  // Fell through: iteration cap reached, or provider lacks function-calling.
  const lastModel = [...messages].reverse().find((m) => m.role === "model");
  if (pendingApprovalId !== undefined) {
    // We stopped for an approval but the model never asked. Ask directly.
    const text = `I have something ready that needs your go-ahead (approval #${pendingApprovalId}). Say "yes" to confirm or "no" to skip it.`;
    captureTurnEpisode(ctx, spaceId, input.userMessage, text, {
      toolExecutions: executions,
      approvalPending: true,
      alreadyCapturedId: statedEpisodeId,
    });
    return { text, pendingApprovalId, episodeCaptured: true };
  }
  if (lastModel) {
    captureTurnEpisode(ctx, spaceId, input.userMessage, lastModel.text ?? "", {
      toolExecutions: executions,
      approvalPending: pendingApprovalId !== undefined,
      alreadyCapturedId: statedEpisodeId,
    });
    return { text: lastModel.text, pendingApprovalId, episodeCaptured: true };
  }
  const text =
    "I started on that but ran out of steps — try asking in a smaller piece and I'll pick it up.";
  captureTurnEpisode(ctx, spaceId, input.userMessage, text, {
    toolExecutions: executions,
    approvalPending: pendingApprovalId !== undefined,
    alreadyCapturedId: statedEpisodeId,
  });
  return { text, pendingApprovalId, episodeCaptured: true };
}

/**
 * W2 §5.1: fire-and-forget episode capture for a completed loop turn.
 * "Substantive exchange" = the turn did real work: ≥1 tool execution OR a
 * non-empty final reply. Skipped for pure no-op turns (§5.3: nothing to record).
 * The returned promise is never awaited — the caller delivers the reply while
 * capture runs. Never throws.
 */
function captureTurnEpisode(
  ctx: AppContext,
  spaceId: string,
  userMessage: string,
  resultText: string,
  opts: { toolExecutions: number; approvalPending: boolean; alreadyCapturedId?: number | null },
): void {
  // The stated-write trigger (§4.8) may have already captured this turn's
  // episode synchronously — never double-capture (§5.1).
  if (opts.alreadyCapturedId) return;
  const substantive =
    opts.toolExecutions > 0 || opts.approvalPending || resultText.trim().length > 0;
  if (!substantive) return;
  void Promise.resolve()
    .then(() =>
      captureEpisode(ctx.handle, spaceId, {
        kind: "conversation",
        summary:
          `Conversation turn: user said ${JSON.stringify(userMessage.slice(0, 200))}; ` +
          `assistant replied ${JSON.stringify(resultText.slice(0, 200))}` +
          (opts.toolExecutions > 0 ? ` (${opts.toolExecutions} tool execution(s))` : ""),
      }),
    )
    .catch(() => {});
}

/** Templated audit row for a loop tool execution. Content-free by design. */
function auditToolRun(ctx: AppContext, spaceId: string, toolName: string, ok: boolean): void {
  try {
    ctx.handle.sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', ?, ?, '[]', ?)`
      )
      .run(spaceId, `tool:${toolName}`, `${toolName} ${ok ? "executed" : "failed"} (agent loop)`, JSON.stringify({ kind: "loop_tool", ok }));
  } catch {
    /* audit is best-effort; never break the turn */
  }
}

/** Look up a tool the loop may offer (for tests and callers). */
export function getAgentTool(name: string): Tool | undefined {
  return AGENT_TOOLS.find((e) => e.tool.name === name)?.tool;
}
