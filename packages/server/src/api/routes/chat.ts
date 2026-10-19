import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { chat, DEFAULT_CHAT } from "../../chat/graphrag.js";
import { recordProactiveDiscussion } from "../../analysis/proactiveContext.js";
import { spaceOf } from "../middleware.js";
import { agentLoop, maybeConfirmPending } from "../../agent/loop.js";
import type { ToolContext } from "../../agent/tools/types.js";

const ChatBody = z.object({
  question: z.string().min(1).max(2000),
  // Recent turns (oldest first) so she carries the conversation instead of
  // treating every message as a fresh stranger's question.
  history: z
    .array(z.object({ role: z.enum(["you", "soumaya"]), text: z.string().max(4000) }))
    .max(16)
    .optional(),
  // Explicit Journey-scoped retrieval experiment (docs/specs/journey-aware-retrieval-experiment.md).
  // Only ever a real, user-selected Journey id — chat() itself re-validates it belongs to this
  // space (JourneysRepo.get is space-scoped) before using it for anything; an invalid or
  // cross-space id here just contributes zero extra candidates, never an error.
  journeyId: z.number().int().positive().optional(),
  // Proactive -> Chat handoff (Phase Y, docs/specs/soumaya-proactive-chat-handoff.md;
  // Phase Z adds "bill_risk", docs/specs/soumaya-bill-risk-proactive-source.md).
  // Only ever set when the user opened Chat from a real proactive delivery (a toast
  // click) — chat() itself re-validates `targetId` against this space's real data
  // before using it for anything; an invalid/stale/cross-space value contributes
  // nothing, never an error, same contract as journeyId above. The literal source
  // enum is the ONLY per-source surface this contract needs — {source, targetId}
  // itself is unchanged from Phase Y.
  proactiveContext: z.object({ source: z.enum(["goal_trend", "bill_risk"]), targetId: z.number().int().positive() }).optional(),
});

const DistillBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["you", "soumaya"]), text: z.string() }))
    .min(1)
    .max(80),
});

/** Offline fallback: the user's own substantive lines, deduped, newest first. */
function heuristicDistill(messages: { role: string; text: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "you") continue;
    const t = m.text.trim();
    if (t.length < 25 || t.endsWith("?")) continue; // skip short bits + questions
    const key = t.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.length > 200 ? `${t.slice(0, 197)}…` : t);
  }
  return out.slice(-3);
}

export function chatRoutes(ctx: AppContext): Router {
  const r = Router();

  // POST /api/chat/distill { messages } -> 0–3 memory-worthy notes from a chat.
  // LLM when available; heuristic fallback otherwise. The client shows these for
  // the user to approve before any are saved.
  r.post("/distill", async (req, res) => {
    const parsed = DistillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { messages: [{role,text}] }" });
      return;
    }
    const msgs = parsed.data.messages;
    let summaries: string[] = [];
    if (ctx.llm.distill) {
      try {
        const transcript = msgs.map((m) => `${m.role === "you" ? "User" : "Soumaya"}: ${m.text}`).join("\n");
        summaries = await ctx.llm.distill(transcript);
      } catch {
        summaries = heuristicDistill(msgs);
      }
    } else {
      summaries = heuristicDistill(msgs);
    }
    summaries = summaries.map((s) => s.trim()).filter(Boolean).slice(0, 3);
    res.json({ summaries });
  });
  // POST /api/chat  { question } -> GraphRAG answer with citations
  r.post("/", async (req, res) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { question: string }" });
      return;
    }
    const result = await chat(
      ctx.handle,
      { embeddings: ctx.embeddings, llm: ctx.llm },
      parsed.data.question,
      DEFAULT_CHAT,
      spaceOf(res),
      parsed.data.history ?? [],
      parsed.data.journeyId ?? null,
      parsed.data.proactiveContext ?? null,
    );
    // Phase AB (docs/specs/soumaya-proactive-discussion-occurrence.md): only reached once
    // chat() has already returned a real answer for this turn — the smallest defensible
    // definition of "a proactive-context Chat interaction occurred." Re-validates the SAME
    // way chat() itself just did; a failure or invalid/stale/cross-space target writes
    // nothing and never affects this response (see the function's own doc comment).
    if (parsed.data.proactiveContext) {
      recordProactiveDiscussion(ctx.handle, spaceOf(res), parsed.data.proactiveContext);
    }
    res.json(result);
  });

  // POST /api/chat/agent { question, history? } -> agentic answer with tools.
  // Phase 1: the agent loop (function-calling) instead of single-shot GraphRAG.
  // The existing POST / route above is untouched (legacy fallback).
  r.post("/agent", async (req, res) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { question: string }" });
      return;
    }
    const spaceId = spaceOf(res);
    // On web, the space IS the identity (name+passcode login) — the principal
    // binds approvals to this brain's owner.
    const principal = `web:${spaceId}`;
    const tc: ToolContext = {
      ctx,
      spaceId,
      now: Date.now(),
      notify: async () => {}, // web has no push channel; in-app surfaces it
    };
    // A "yes"/"no" here may confirm or deny a pending write approval.
    const confirmation = await maybeConfirmPending(ctx, spaceId, principal, parsed.data.question, tc);
    if (confirmation !== null) {
      res.json({ answer: confirmation, citations: [], agent: true });
      return;
    }
    const result = await agentLoop({
      ctx,
      spaceId,
      principal,
      userMessage: parsed.data.question,
      history: parsed.data.history ?? [],
      now: Date.now(),
      notify: async () => {},
    });
    res.json({ answer: result.text, citations: [], agent: true, pendingApprovalId: result.pendingApprovalId ?? null });
  });
  return r;
}
