import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import type { GraphNode } from "@brain/shared";
import {
  getQuizSession,
  setQuizSession,
  deleteQuizSession,
  principalOf,
  listNeighbors,
  type QuizQuestion,
  type QuizSession,
} from "../gameSessions.js";

/**
 * Telegram Parity Phase 5-B: memory_quiz — a multi-turn recall game over
 * HIS OWN memories, driven by the model across turns via the `action`
 * argument (start / answer / next / correct / end / status). Session state
 * lives server-side in agent/gameSessions.ts (in-memory, keyed by
 * (spaceId, principal), idle-expired) — this tool is in the AGENT layer,
 * so Telegram and the web agent route play the identical game through
 * agentLoop(); nothing here is Telegram-specific.
 *
 * Questions are GENERATED FROM REAL NODE DATA with a checkable right
 * answer — never free-invented facts:
 * - connection: the node has a real edge; the answer is the neighbor's
 *   label (the edge is read from the graph, both directions).
 * - cloze: a distinctive long word is blanked out of the node's own
 *   content; the answer is that word, verbatim from the content.
 * - recall: the node's own content is quoted; the answer is its label.
 * The expected answer stays server-side (in the session) and is only
 * revealed AFTER the user answers — the tool result that presents a
 * question never contains it, so the model cannot leak it early.
 *
 * Spaced repetition (IN-SESSION ONLY — no durable per-memory quiz store
 * exists in this codebase, so performance is deliberately not tracked
 * across sessions): a wrong answer reinserts the memory into the queue
 * with at most one intervening question, ahead of every fresh (never
 * asked) memory; a correct answer retires it for the session.
 *
 * Corrections (INV-KC-1, hard rule): this tool NEVER edits a node or the
 * user model — it is a READ tool. When the user says an answer / the
 * memory itself is wrong, action "correct" records the statement in the
 * session and returns an explicit directive: the MODEL must propose
 * capture_memory with the corrected statement, which is approval-gated
 * like every conversational write (owner decision D3). Nothing is saved
 * until the owner says "yes", and the original memory is never touched
 * by the quiz.
 */

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const MAX_POOL = 25;

type SqliteLike = Parameters<typeof listNeighbors>[0];

function clampCount(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_COUNT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.floor(n));
}

/** Lowercase, punctuation → space, collapsed — the grading normal form. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Significant tokens (len ≥ 3) of a phrase, deduped, in order. */
export function significantTokens(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of normalizeAnswer(s).split(" ")) {
    if (t.length >= 3 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Grade a user's answer against the stored expected answer. Deterministic
 * and checkable: exact normalized containment, or significant-token
 * coverage (all tokens for a 1-token answer; ≥60% for longer answers).
 */
export function gradeAnswer(userAnswer: string, q: QuizQuestion): boolean {
  const na = normalizeAnswer(userAnswer);
  const ne = normalizeAnswer(q.expectedAnswer);
  if (!na || !ne) return false;
  if (ne.length >= 3 && na.includes(ne)) return true;
  const tokens = q.expectedTokens;
  if (tokens.length === 0) return false;
  const answerTokens = new Set(na.split(" "));
  const present = tokens.filter((t) => answerTokens.has(t)).length;
  if (tokens.length === 1) return present === 1;
  return present / tokens.length >= 0.6;
}

/**
 * Build the question for ONE node from its own data (see header). Neighbor
 * choice is deterministic (lowest neighbor id) so a retry asks the same
 * question.
 */
export function generateQuestion(sqlite: SqliteLike, spaceId: string, node: GraphNode): QuizQuestion {
  const neighbors = listNeighbors(sqlite, spaceId, node.id);
  if (neighbors.length > 0) {
    const n = [...neighbors].sort((a, b) => a.otherId - b.otherId)[0]!;
    const expectedAnswer = n.otherLabel;
    return {
      nodeId: node.id,
      nodeLabel: node.label,
      kind: "connection",
      question:
        n.direction === "outgoing"
          ? `Your memory "${node.label}" links out with a "${n.relationship}" connection. What is it connected to? (Give the connected memory's title.)`
          : `Another memory links into "${node.label}" with a "${n.relationship}" connection. Which memory is it? (Give its title.)`,
      expectedAnswer,
      expectedTokens: significantTokens(expectedAnswer),
    };
  }
  // Cloze: blank the longest word (≥6 letters) of the node's own content.
  const content = node.content.trim();
  let best: { word: string; index: number } | null = null;
  for (const m of content.matchAll(/[A-Za-z]{6,}/g)) {
    if (!best || m[0].length > best.word.length) best = { word: m[0], index: m.index ?? 0 };
  }
  if (best) {
    const excerpt = content.length > 240 ? `${content.slice(0, 240)}…` : content;
    const blanked =
      best.index < excerpt.length
        ? excerpt.slice(0, best.index) + "_____" + excerpt.slice(best.index + best.word.length)
        : excerpt;
    return {
      nodeId: node.id,
      nodeLabel: node.label,
      kind: "cloze",
      question: `From your memory "${node.label}": "${blanked}" — what word is missing?`,
      expectedAnswer: best.word,
      expectedTokens: significantTokens(best.word),
    };
  }
  return {
    nodeId: node.id,
    nodeLabel: node.label,
    kind: "recall",
    question: `One of your memories says: "${content.slice(0, 200)}" — what is that memory's exact title?`,
    expectedAnswer: node.label,
    expectedTokens: significantTokens(node.label),
  };
}

function scoreLine(s: QuizSession): string {
  return `Score: ${s.correctCount}/${s.totalAnswered} correct so far.`;
}

function presentQuestion(s: QuizSession): string {
  if (!s.current) return "";
  const remaining = s.upcomingNodeIds.length;
  // NOTE: no node label/id in this header — for "recall" questions the label
  // IS the answer, and this block is what gets presented to the user.
  return (
    `Question ${s.questionNumber}:\n` +
    `${s.current.question}\n` +
    `(Answer in your own words — or say the memory itself is wrong and give the correction. ` +
    `${remaining} more ${remaining === 1 ? "memory waits" : "memories wait"} after this one.)`
  );
}

/** Pop the next queued node into `current` (generating its question), or
 *  mark the quiz finished when the queue is empty. */
function advance(tc: ToolContext, s: QuizSession): void {
  const nextId = s.upcomingNodeIds.shift();
  if (nextId === undefined) {
    s.current = null;
    return;
  }
  const node = new NodesRepo(tc.ctx.handle, tc.spaceId).getById(nextId);
  if (!node) {
    // The memory vanished mid-quiz (deleted elsewhere) — skip it silently.
    advance(tc, s);
    return;
  }
  s.current = generateQuestion(tc.ctx.handle.sqlite as SqliteLike, tc.spaceId, node);
  s.lastQuestion = s.current;
  s.questionNumber++;
}

function finishedBlock(tc: ToolContext, s: QuizSession): string {
  const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
  const lines = [
    `🏁 Quiz complete — final ${scoreLine(s).replace(" so far", "")}`,
  ];
  if (s.performance.size > 0) {
    lines.push("Per-memory results (this session):");
    for (const [nodeId, perf] of [...s.performance.entries()].sort((a, b) => a[0] - b[0])) {
      const label = repo.getById(nodeId)?.label ?? `#${nodeId}`;
      lines.push(
        `  - #${nodeId} "${label}": ${perf.correct} correct, ${perf.wrong} wrong, ${perf.attempts} attempt(s)`,
      );
    }
  }
  if (s.corrections.length > 0) {
    lines.push(
      `Corrections stated: ${s.corrections.length} — each one goes through capture_memory with your "yes"; the originals were not edited.`,
    );
  }
  lines.push(`Call memory_quiz with action "end" for the recap, or action "start" to play again.`);
  return lines.join("\n");
}

export const memoryQuizTool: Tool = {
  name: "memory_quiz",
  description:
    "Play a multi-turn recall quiz drawn from the user's OWN memories. Drive it with the action argument across turns: action \"start\" begins a quiz (optional count 1-10) and presents the first question — present it verbatim and do NOT invent or reveal any answer; the user answers in chat, then call action \"answer\" with their exact answer text to grade it (the tool holds the real answer server-side). A wrong answer makes that memory resurface soon (spaced repetition, in-session). Action \"next\" skips to the next question. If the user says a memory or its answer is WRONG, call action \"correct\" with their corrected statement in \"correction\" — the tool will instruct you to propose capture_memory for it (approval-gated); the quiz itself never edits a memory. Action \"status\" re-reads the score and current question; action \"end\" closes the quiz with a recap.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "answer", "next", "correct", "end", "status"],
        description: "Which step of the quiz this call is.",
      },
      answer: {
        type: "string",
        description: "For action \"answer\": the user's answer, in their exact words.",
      },
      correction: {
        type: "string",
        description:
          "For action \"correct\": the corrected statement, in the user's own words — what the memory SHOULD say.",
      },
      count: {
        type: "integer",
        description: "For action \"start\": how many memories to quiz on (1-10, default 5).",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const action = String(args.action ?? "");
    const principal = principalOf(tc);
    const sqlite = tc.ctx.handle.sqlite as SqliteLike;

    // ----- start ------------------------------------------------------------
    if (action === "start") {
      const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
      const live = repo.all();
      let pool = live.filter((n) => (n.kind == null || n.kind === "memory") && n.content.trim().length > 0);
      if (pool.length === 0) pool = live.filter((n) => n.content.trim().length > 0);
      if (pool.length === 0) {
        return {
          ok: true,
          summary: "memory_quiz: no memories to quiz on",
          message:
            "MEMORY QUIZ: there are no memories in this brain to quiz on yet. Say so honestly — do not invent questions.",
        };
      }
      // Deterministic order: best-connected first (they make the richest
      // questions), then most important, then lowest id.
      const degree = new Map(pool.map((n) => [n.id, listNeighbors(sqlite, tc.spaceId, n.id).length]));
      pool.sort(
        (a, b) =>
          (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
          (b.importance ?? 0) - (a.importance ?? 0) ||
          a.id - b.id,
      );
      const count = clampCount(args.count);
      const selected = pool.slice(0, Math.min(MAX_POOL, count));
      const session: QuizSession = {
        spaceId: tc.spaceId,
        principal,
        current: null,
        lastQuestion: null,
        upcomingNodeIds: selected.map((n) => n.id),
        questionNumber: 0,
        totalAnswered: 0,
        correctCount: 0,
        performance: new Map(),
        corrections: [],
        startedAt: tc.now,
        lastActiveAt: tc.now,
      };
      advance(tc, session);
      setQuizSession(session);
      return {
        ok: true,
        summary: `memory_quiz: started, ${selected.length} memories queued`,
        targets: session.current ? [session.current.nodeId] : [],
        message:
          `MEMORY QUIZ — every question comes from your own memories, with the real answer held back until you reply.\n` +
          presentQuestion(session) +
          `\n${scoreLine(session)}`,
      };
    }

    const session = getQuizSession(tc.spaceId, principal, tc.now);
    if (!session) {
      if (action === "correct") {
        // No quiz running, but the correction rule still applies: never a
        // silent edit — it goes through capture_memory with approval.
        const correction = String(args.correction ?? "").trim();
        if (!correction) return { ok: false, summary: "memory_quiz correct: no correction text" };
        return {
          ok: true,
          summary: "memory_quiz: correction routed to capture_memory (no active quiz)",
          message:
            `CORRECTION — routed, NOT applied (INV-KC-1): no quiz is active, and corrections are never silent edits.\n` +
            `NEXT STEP FOR THE MODEL: propose capture_memory with args {"text": ${JSON.stringify(correction)}} in this same turn. ` +
            `Quote the text back and ask the user to say "yes" — capture_memory is a WRITE and nothing is saved until he confirms.`,
        };
      }
      return {
        ok: true,
        summary: "memory_quiz: no active session",
        message:
          `MEMORY QUIZ: no quiz is running for this conversation (it may have ended or sat idle too long). ` +
          `Call memory_quiz with action "start" to begin one.`,
      };
    }

    // ----- answer -----------------------------------------------------------
    if (action === "answer") {
      const answerText = String(args.answer ?? "").trim();
      if (!answerText) return { ok: false, summary: "memory_quiz answer: empty answer" };
      const q = session.current;
      if (!q) {
        return {
          ok: true,
          summary: "memory_quiz: answer with no question waiting",
          message: `MEMORY QUIZ: no question is waiting for an answer.\n${finishedBlock(tc, session)}`,
        };
      }
      const correct = gradeAnswer(answerText, q);
      const perf = session.performance.get(q.nodeId) ?? { attempts: 0, correct: 0, wrong: 0 };
      perf.attempts++;
      session.totalAnswered++;
      let verdict: string;
      if (correct) {
        perf.correct++;
        session.correctCount++;
        verdict = `✓ Correct! The memory "${q.nodeLabel}" — the answer was "${q.expectedAnswer}".`;
        session.performance.set(q.nodeId, perf);
        advance(tc, session);
      } else {
        perf.wrong++;
        session.performance.set(q.nodeId, perf);
        verdict =
          `✗ Not quite. The memory "${q.nodeLabel}" says the answer is "${q.expectedAnswer}". ` +
          `That one's coming back soon so it sticks.`;
        // Spaced repetition: reinsert ahead of every fresh memory, with at
        // most one intervening question (position 1 when another question
        // is queued, otherwise it is simply next).
        session.upcomingNodeIds.splice(Math.min(1, session.upcomingNodeIds.length), 0, q.nodeId);
        advance(tc, session);
      }
      setQuizSession(session);
      const tail = session.current ? `\n\n${presentQuestion(session)}` : `\n\n${finishedBlock(tc, session)}`;
      return {
        ok: true,
        summary: `memory_quiz: answer ${correct ? "correct" : "wrong"} (${session.correctCount}/${session.totalAnswered})`,
        targets: [q.nodeId],
        message: `${verdict}\n${scoreLine(session)}${tail}`,
      };
    }

    // ----- next (skip) --------------------------------------------------------
    if (action === "next") {
      if (!session.current) {
        return {
          ok: true,
          summary: "memory_quiz: next with no question waiting",
          message: `MEMORY QUIZ: no question is waiting.\n${finishedBlock(tc, session)}`,
        };
      }
      // A skipped memory goes to the BACK of the queue (seen again after
      // the fresh ones) — it is not graded.
      session.upcomingNodeIds.push(session.current.nodeId);
      const skippedLabel = session.current.nodeLabel;
      advance(tc, session);
      setQuizSession(session);
      const tail = session.current ? presentQuestion(session) : finishedBlock(tc, session);
      return {
        ok: true,
        summary: "memory_quiz: skipped to next question",
        message: `Skipped "${skippedLabel}" — it'll come around again at the end.\n${scoreLine(session)}\n\n${tail}`,
      };
    }

    // ----- correct (INV-KC-1) -------------------------------------------------
    if (action === "correct") {
      const correction = String(args.correction ?? "").trim();
      if (!correction) return { ok: false, summary: "memory_quiz correct: no correction text" };
      const target = session.current ?? session.lastQuestion;
      if (target) {
        session.corrections.push({ nodeId: target.nodeId, nodeLabel: target.nodeLabel, text: correction, at: tc.now });
      }
      setQuizSession(session);
      // READ tool: mutate NOTHING in the brain. The correction leaves only
      // as a model-proposed capture_memory (approval-gated write).
      return {
        ok: true,
        summary: "memory_quiz: correction routed to capture_memory proposal (no direct mutation)",
        targets: target ? [target.nodeId] : [],
        message:
          `CORRECTION — routed, NOT applied (INV-KC-1): ` +
          (target
            ? `the user says memory #${target.nodeId} "${target.nodeLabel}" is wrong. `
            : `the user says that memory is wrong. `) +
          `The quiz has NOT edited the memory or the user model — it never does.\n` +
          `Corrected statement (the user's own words): "${correction}"\n` +
          `NEXT STEP FOR THE MODEL: propose capture_memory with args {"text": ${JSON.stringify(correction)}} in this same turn. ` +
          `Quote the corrected statement back verbatim and ask the user to say "yes" — capture_memory is a WRITE: nothing is saved until he confirms, ` +
          `and the original memory stays exactly as it is unless he later changes it himself.\n` +
          `${scoreLine(session)} — the quiz continues unchanged.`,
      };
    }

    // ----- status -------------------------------------------------------------
    if (action === "status") {
      const body = session.current
        ? `${scoreLine(session)}\n\n${presentQuestion(session)}`
        : `${scoreLine(session)}\n\n${finishedBlock(tc, session)}`;
      return {
        ok: true,
        summary: `memory_quiz: status (${session.correctCount}/${session.totalAnswered})`,
        message: `MEMORY QUIZ STATUS:\n${body}`,
      };
    }

    // ----- end ------------------------------------------------------------------
    if (action === "end") {
      const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
      const lines = [
        `MEMORY QUIZ — final recap: ${session.correctCount}/${session.totalAnswered} correct.`,
      ];
      if (session.performance.size > 0) {
        lines.push("Per-memory results (this session only — quiz performance is not kept across sessions):");
        for (const [nodeId, perf] of [...session.performance.entries()].sort((a, b) => a[0] - b[0])) {
          const label = repo.getById(nodeId)?.label ?? `#${nodeId}`;
          lines.push(`  - #${nodeId} "${label}": ${perf.correct} correct, ${perf.wrong} wrong, ${perf.attempts} attempt(s)`);
        }
      }
      if (session.corrections.length > 0) {
        lines.push(`Corrections you stated (${session.corrections.length}):`);
        for (const c of session.corrections) {
          lines.push(`  - for #${c.nodeId} "${c.nodeLabel}": "${c.text}" — routed to capture_memory for your approval; the original was not edited.`);
        }
      }
      deleteQuizSession(tc.spaceId, principal);
      return {
        ok: true,
        summary: `memory_quiz: ended (${session.correctCount}/${session.totalAnswered})`,
        message: lines.join("\n"),
      };
    }

    return { ok: false, summary: `memory_quiz: unknown action "${action}"` };
  },
};
