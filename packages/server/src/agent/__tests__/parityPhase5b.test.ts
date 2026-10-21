import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { validateArgs } from "../tools/validation.js";
import { memoryQuizTool, generateQuestion, gradeAnswer } from "../tools/memoryQuiz.js";
import { constellationTourTool } from "../tools/constellationTour.js";
import { AGENT_TOOLS } from "../tools/registry.js";
import { agentLoop, getAgentTool } from "../loop.js";
import {
  getQuizSession,
  getTourSession,
  clearAllGameSessions,
  sweepExpiredGameSessions,
  GAME_SESSION_IDLE_MS,
} from "../gameSessions.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";

/**
 * Telegram Parity Phase 5-B — multi-turn conversational games
 * (memory_quiz + constellation_tour).
 *
 * FALSIFICATION BY CONSTRUCTION: on the pre-5-B code neither tool module
 * nor agent/gameSessions.ts exists and AGENT_TOOLS holds 19 tools — this
 * suite cannot even be collected there.
 *
 * Seeded brain (per test, in-memory): a connected cluster A—B—C with a
 * branch A—D, plus an isolated memory E, in SPACE; a separate two-node
 * cluster in OTHER that must never leak in.
 *
 *   A "Samsonite Warehouse Job" —relates_to→ B, —supports→ D, ←depends_on— C
 *   B "CNA License Renewal"     —builds_on→  C
 *   C "Morning Prayer Routine"
 *   D "Plasma Donation Card"
 *   E "Quiet Evening Journal"   (isolated; cloze material)
 */

let handle: DbHandle;
let ctx: AppContext;
const SPACE = "p5b-space";
const OTHER = "p5b-other-space";
const NOW = Date.parse("2026-10-15T16:00:00.000Z");
const P1 = "telegram:1";
const P2 = "telegram:2";

let A = 0;
let B = 0;
let C = 0;
let D = 0;
let E = 0;
let OX = 0;
let OY = 0;

function insertNode(o: { label: string; content: string; kind?: string; spaceId?: string }): number {
  const r = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, kind) VALUES (?, ?, 'memory', ?, ?)`)
    .run(o.spaceId ?? SPACE, o.label, o.content, o.kind ?? "memory");
  return Number(r.lastInsertRowid);
}

function insertEdge(source: number, target: number, relationship: string, spaceId = SPACE): void {
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, ?, 1)`)
    .run(spaceId, source, target, relationship);
}

function seedBrain(): void {
  A = insertNode({
    label: "Samsonite Warehouse Job",
    content: "Sajacous started the Samsonite warehouse job in Jacksonville stacking pallets on the night shift.",
  });
  B = insertNode({
    label: "CNA License Renewal",
    content: "The CNA license renewal needs an eighty five dollar money order mailed to Tallahassee.",
  });
  C = insertNode({
    label: "Morning Prayer Routine",
    content: "Every morning begins with prayer scripture and a short walk before the bus ride.",
  });
  D = insertNode({
    label: "Plasma Donation Card",
    content: "The plasma donation card holds the money earned from donating twice a week.",
  });
  E = insertNode({
    label: "Quiet Evening Journal",
    content: "Reflections on gratitude and patience written quietly before bedtime.",
  });
  insertEdge(A, B, "relates_to");
  insertEdge(A, D, "supports");
  insertEdge(B, C, "builds_on");
  insertEdge(C, A, "depends_on");

  OX = insertNode({ label: "Other Space Alpha", content: "Alpha fact from the other space.", spaceId: OTHER });
  OY = insertNode({ label: "Other Space Beta", content: "Beta fact from the other space.", spaceId: OTHER });
  insertEdge(OX, OY, "relates_to", OTHER);
}

const tc = (over: Partial<ToolContext> = {}): ToolContext => ({
  ctx,
  spaceId: SPACE,
  now: NOW,
  notify: async () => {},
  principal: P1,
  ...over,
});

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: undefined as never,
  };
  clearAllGameSessions();
  seedBrain();
});

afterEach(() => handle.sqlite.close());

/** Object.assign (not spread): spread drops the provider's prototype methods. */
function providerWith(callWithTools: (input: LlmToolCallInput) => Promise<LlmToolResult>): LlmProvider {
  return Object.assign(new HeuristicProvider(), { callWithTools }) as LlmProvider;
}

function edgeExists(source: number, target: number, relationship: string, spaceId = SPACE): boolean {
  const row = handle.sqlite
    .prepare(`SELECT COUNT(*) c FROM edges WHERE space_id = ? AND source = ? AND target = ? AND relationship = ?`)
    .get(spaceId, source, target, relationship) as { c: number };
  return row.c === 1;
}

// ---------------------------------------------------------------------------
// Registration & schemas
// ---------------------------------------------------------------------------

describe("Phase 5-B registration", () => {
  it("both game tools are in AGENT_TOOLS as READ tools and in the full registry", () => {
    expect(getAgentTool("memory_quiz")).toBe(memoryQuizTool);
    expect(getAgentTool("constellation_tour")).toBe(constellationTourTool);
    for (const name of ["memory_quiz", "constellation_tour"]) {
      expect(AGENT_TOOLS.find((e) => e.tool.name === name)?.isWrite).toBe(false);
    }
    // Writes are untouched BY THIS PHASE (5-B adds none). Coordinator
    // reconciliation at integration: on the merged tree Phase 5-C's
    // dream_playback is also a write (flagged correction path), so the
    // combined write set asserted here includes it; the canonical pin
    // lives in phase1.test.ts §7.
    const writes = AGENT_TOOLS.filter((e) => e.isWrite).map((e) => e.tool.name).sort();
    expect(writes).toEqual(["capture_memory", "create_task", "dream_playback", "fire_reminder"]);
  });

  it("both are loop-only (detect never proposes them to the router)", () => {
    expect(memoryQuizTool.detect(tc())).toEqual([]);
    expect(constellationTourTool.detect(tc())).toEqual([]);
  });

  it("schemas validate: action is a required enum", () => {
    expect(validateArgs(memoryQuizTool, { action: "start" }).ok).toBe(true);
    expect(validateArgs(memoryQuizTool, { action: "answer", answer: "x" }).ok).toBe(true);
    expect(validateArgs(memoryQuizTool, { action: "dance" }).ok).toBe(false);
    expect(validateArgs(memoryQuizTool, {}).ok).toBe(false);
    expect(validateArgs(constellationTourTool, { action: "start", label: "x" }).ok).toBe(true);
    expect(validateArgs(constellationTourTool, { action: "teleport" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// memory_quiz — grounded questions, scoring, spaced repetition
// ---------------------------------------------------------------------------

describe("memory_quiz", () => {
  it("start asks a question whose correct answer is in the seeded data (and does not leak it)", async () => {
    const r = await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("MEMORY QUIZ");
    expect(r.message).toContain("Question 1");
    const s = getQuizSession(SPACE, P1, NOW)!;
    expect(s).toBeDefined();
    // Best-connected memory first: A, whose lowest-id neighbor is B.
    expect(s.current?.nodeId).toBe(A);
    expect(s.current?.kind).toBe("connection");
    // The checkable right answer IS a seeded fact: B's exact label.
    expect(s.current?.expectedAnswer).toBe("CNA License Renewal");
    const seeded = handle.sqlite.prepare(`SELECT label FROM nodes WHERE id = ?`).get(B) as { label: string };
    expect(s.current?.expectedAnswer).toBe(seeded.label);
    // The presented question must not contain the (still secret) answer.
    expect(r.message).not.toContain("CNA License Renewal");
    expect(s.upcomingNodeIds).toEqual([B, C, D, E]);
  });

  it("questions are generated from real node data: connection for linked nodes, cloze for an isolated one", () => {
    const repo = new NodesRepo(handle, SPACE);
    const qA = generateQuestion(handle.sqlite as never, SPACE, repo.getById(A)!);
    expect(qA.kind).toBe("connection");
    expect(qA.expectedAnswer).toBe("CNA License Renewal");
    // The connection it asks about is a real stored edge.
    expect(edgeExists(A, B, "relates_to")).toBe(true);
    const qE = generateQuestion(handle.sqlite as never, SPACE, repo.getById(E)!);
    expect(qE.kind).toBe("cloze");
    // The blanked word is verbatim from E's own content ("Reflections").
    expect(qE.expectedAnswer).toBe("Reflections");
    expect(repo.getById(E)!.content).toContain(qE.expectedAnswer);
    expect(qE.question).toContain("_____");
    expect(qE.question).not.toContain("Reflections on gratitude");
    // Grading is exact-token based against that stored answer.
    expect(gradeAnswer("reflections", qE)).toBe(true);
    expect(gradeAnswer("bananas", qE)).toBe(false);
  });

  it("scores a right and a wrong answer; the wrongly-answered memory resurfaces before fresh ones", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });

    // Q1 (A): WRONG answer.
    const wrong = await memoryQuizTool.run(tc(), { action: "answer", answer: "the moon, probably" });
    expect(wrong.message).toContain("Not quite");
    expect(wrong.message).toContain("Score: 0/1");
    let s = getQuizSession(SPACE, P1, NOW)!;
    // Spaced repetition: A was reinserted ahead of every fresh memory —
    // one intervening question (B, now current), then A, then fresh C/D/E.
    expect(s.current?.nodeId).toBe(B);
    expect(s.upcomingNodeIds).toEqual([A, C, D, E]);
    expect(s.performance.get(A)).toEqual({ attempts: 1, correct: 0, wrong: 1 });

    // Q2 (B): its connection question's answer is A's label — RIGHT.
    expect(s.current?.expectedAnswer).toBe("Samsonite Warehouse Job");
    const right = await memoryQuizTool.run(tc(), { action: "answer", answer: "Samsonite Warehouse Job" });
    expect(right.message).toContain("Correct!");
    expect(right.message).toContain("Score: 1/2");
    s = getQuizSession(SPACE, P1, NOW)!;
    // A resurfaces NOW — before the fresh memories C, D, E are asked.
    expect(s.current?.nodeId).toBe(A);
    expect(s.upcomingNodeIds).toEqual([C, D, E]);

    // Q3 (A again): RIGHT this time.
    const retry = await memoryQuizTool.run(tc(), { action: "answer", answer: "CNA License Renewal" });
    expect(retry.message).toContain("Correct!");
    expect(retry.message).toContain("Score: 2/3");
    s = getQuizSession(SPACE, P1, NOW)!;
    expect(s.performance.get(A)).toEqual({ attempts: 2, correct: 1, wrong: 1 });

    // End: recap reports the in-session score and per-memory results.
    const end = await memoryQuizTool.run(tc(), { action: "end" });
    expect(end.message).toContain("2/3 correct");
    expect(end.message).toContain('"Samsonite Warehouse Job": 1 correct, 1 wrong, 2 attempt(s)');
    expect(getQuizSession(SPACE, P1, NOW)).toBeUndefined();
  });

  it("status re-reads score + current question without grading anything", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 3 });
    const st = await memoryQuizTool.run(tc(), { action: "status" });
    expect(st.message).toContain("Score: 0/0");
    expect(st.message).toContain("Question 1");
    const s = getQuizSession(SPACE, P1, NOW)!;
    expect(s.totalAnswered).toBe(0);
  });

  it("no memories → honest empty start, no invented questions", async () => {
    const empty = tc({ spaceId: "p5b-empty-space", principal: P1 });
    const r = await memoryQuizTool.run(empty, { action: "start" });
    expect(r.message).toContain("no memories in this brain");
    expect(getQuizSession("p5b-empty-space", P1, NOW)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// memory_quiz corrections — INV-KC-1: proposal only, zero direct mutation
// ---------------------------------------------------------------------------

describe("memory_quiz corrections (INV-KC-1)", () => {
  const CORRECTION = "The Samsonite job is actually in Ocala, not Jacksonville";

  function brainSnapshot() {
    const nodes = handle.sqlite
      .prepare(`SELECT id, label, content FROM nodes WHERE space_id = ? ORDER BY id`)
      .all(SPACE) as { id: number; label: string; content: string }[];
    const userModel = handle.sqlite
      .prepare(`SELECT COUNT(*) c FROM user_model WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    const approvals = handle.sqlite
      .prepare(`SELECT COUNT(*) c FROM tool_approvals WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    return { nodes, userModelCount: userModel.c, approvalCount: approvals.c };
  }

  it("a correction turn mutates NOTHING directly and returns a capture_memory directive", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    const before = brainSnapshot();
    const r = await memoryQuizTool.run(tc(), { action: "correct", correction: CORRECTION });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("INV-KC-1");
    expect(r.message).toContain("NOT edited");
    expect(r.message).toContain("capture_memory");
    expect(r.message).toContain(CORRECTION);
    // Zero direct mutation: nodes byte-identical, user model untouched,
    // and the quiz tool itself created NO approval (it is a READ tool).
    const after = brainSnapshot();
    expect(after.nodes).toEqual(before.nodes);
    expect(after.userModelCount).toBe(before.userModelCount);
    expect(after.approvalCount).toBe(0);
    // The correction is only session bookkeeping.
    const s = getQuizSession(SPACE, P1, NOW)!;
    expect(s.corrections).toHaveLength(1);
    expect(s.corrections[0]).toMatchObject({ nodeId: A, text: CORRECTION });
  });

  it("through the loop, the correction becomes a capture_memory PROPOSAL (pending approval), still zero mutation", async () => {
    const principal = "telegram:quiz";
    await memoryQuizTool.run(tc({ principal }), { action: "start", count: 5 });
    const before = brainSnapshot();

    let stage = 0;
    ctx.llm = providerWith(async (input) => {
      stage++;
      if (stage === 1) {
        return { text: null, calls: [{ id: "q1", name: "memory_quiz", args: { action: "correct", correction: CORRECTION } }] };
      }
      if (stage === 2) {
        // The model follows the quiz tool's directive: extract the exact
        // capture text it was told to propose.
        const msg = [...input.messages].reverse().find((m) => m.role === "tool" && m.name === "memory_quiz");
        if (!msg || msg.role !== "tool") throw new Error("no memory_quiz tool result");
        const m = /\{"text":\s*("(?:[^"\\]|\\.)*")\}/.exec(msg.result);
        if (!m) throw new Error("directive carried no capture text");
        return { text: null, calls: [{ id: "c1", name: "capture_memory", args: { text: JSON.parse(m[1]!) as string } }] };
      }
      return { text: `I'll save this: "${CORRECTION}" — say "yes" to confirm.`, calls: [] };
    });

    const r = await agentLoop({
      ctx, spaceId: SPACE, principal,
      userMessage: "that memory is wrong — the job is in Ocala, not Jacksonville",
      history: [], now: NOW, notify: async () => {},
    });
    expect(r.pendingApprovalId).toBeDefined();
    const approval = handle.sqlite
      .prepare(`SELECT tool, args_json, status FROM tool_approvals WHERE id = ?`)
      .get(r.pendingApprovalId!) as { tool: string; args_json: string; status: string };
    expect(approval.tool).toBe("capture_memory");
    expect(approval.status).toBe("pending");
    expect(JSON.parse(approval.args_json)).toEqual({ text: CORRECTION });
    // Proposal only: the brain is byte-identical until the owner says yes.
    const after = brainSnapshot();
    expect(after.nodes).toEqual(before.nodes);
    expect(after.userModelCount).toBe(before.userModelCount);
  });
});

// ---------------------------------------------------------------------------
// constellation_tour — real edges only, no repeats, path recap
// ---------------------------------------------------------------------------

describe("constellation_tour", () => {
  it("starts at a named node, steps only along real edges, never repeats, end recaps the actual path", async () => {
    const start = await constellationTourTool.run(tc(), { action: "start", label: "Samsonite Warehouse Job" });
    expect(start.message).toContain("Samsonite Warehouse Job");
    let s = getTourSession(SPACE, P1, NOW)!;
    expect(s.visitedNodeIds).toEqual([A]);
    expect(s.currentNodeId).toBe(A);

    // next: from A, B and C both have degree 2 — lowest id wins → B.
    const step1 = await constellationTourTool.run(tc(), { action: "next" });
    expect(step1.message).toContain("relates_to");
    s = getTourSession(SPACE, P1, NOW)!;
    expect(s.visitedNodeIds).toEqual([A, B]);
    expect(s.currentNodeId).toBe(B);

    // jump to D from B: NO real edge B—D → refused, no move, no invention.
    const badJump = await constellationTourTool.run(tc(), { action: "jump", label: "Plasma Donation Card" });
    expect(badJump.message).toContain("NO stored connection");
    s = getTourSession(SPACE, P1, NOW)!;
    expect(s.currentNodeId).toBe(B);
    expect(s.visitedNodeIds).toEqual([A, B]);

    // jump to C from B: real edge B —builds_on→ C, unvisited → moves.
    const jump = await constellationTourTool.run(tc(), { action: "jump", label: "Morning Prayer Routine" });
    expect(jump.message).toContain("builds_on");
    s = getTourSession(SPACE, P1, NOW)!;
    expect(s.visitedNodeIds).toEqual([A, B, C]);

    // jump back to A: already visited → refused (visits never repeat).
    const revisit = await constellationTourTool.run(tc(), { action: "jump", id: A });
    expect(revisit.message).toContain("already visited");
    s = getTourSession(SPACE, P1, NOW)!;
    expect(s.visitedNodeIds).toEqual([A, B, C]);

    // EVERY recorded step is a real stored edge, in the recorded direction.
    for (const step of s.steps) {
      if (step.direction === "outgoing") {
        expect(edgeExists(step.fromId, step.toId, step.relationship)).toBe(true);
      } else {
        expect(edgeExists(step.toId, step.fromId, step.relationship)).toBe(true);
      }
    }
    expect(new Set(s.visitedNodeIds).size).toBe(s.visitedNodeIds.length);

    // next from C: both neighbors (B via incoming, A via outgoing) visited → stays.
    const stuck = await constellationTourTool.run(tc(), { action: "next" });
    expect(stuck.message).toContain("already been");
    s = getTourSession(SPACE, P1, NOW)!;
    expect(s.currentNodeId).toBe(C);
    expect(s.visitedNodeIds).toEqual([A, B, C]);

    // end: recaps the ACTUAL path, in order, with the real relationships.
    const end = await constellationTourTool.run(tc(), { action: "end" });
    expect(end.message).toContain("Samsonite Warehouse Job");
    expect(end.message).toContain("CNA License Renewal");
    expect(end.message).toContain("Morning Prayer Routine");
    expect(end.message).toContain("relates_to");
    expect(end.message).toContain("builds_on");
    const endMsg = end.message!;
    expect(endMsg.indexOf("Samsonite Warehouse Job")).toBeLessThan(endMsg.indexOf("CNA License Renewal"));
    expect(endMsg.indexOf("CNA License Renewal")).toBeLessThan(endMsg.indexOf("Morning Prayer Routine"));
    expect(getTourSession(SPACE, P1, NOW)).toBeUndefined();
  });

  it("start with no target picks the best-connected node (her pick)", async () => {
    const r = await constellationTourTool.run(tc({ principal: P2 }), { action: "start" });
    expect(r.message).toContain("Samsonite Warehouse Job"); // A: degree 3, the cluster hub
    const s = getTourSession(SPACE, P2, NOW)!;
    expect(s.currentNodeId).toBe(A);
  });

  it("start at an unknown label is an honest refusal — no session, no substitute", async () => {
    const r = await constellationTourTool.run(tc({ principal: P2 }), { action: "start", label: "Atlantis" });
    expect(r.message).toContain("can't start there");
    expect(getTourSession(SPACE, P2, NOW)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session isolation (two principals, two spaces) + idle expiry
// ---------------------------------------------------------------------------

describe("game session isolation & expiry", () => {
  it("two principals in one space hold independent quiz sessions", async () => {
    await memoryQuizTool.run(tc({ principal: P1 }), { action: "start", count: 5 });
    await memoryQuizTool.run(tc({ principal: P2 }), { action: "start", count: 5 });
    // P1 answers wrong; P2's session is untouched.
    await memoryQuizTool.run(tc({ principal: P1 }), { action: "answer", answer: "nonsense words here" });
    const s1 = getQuizSession(SPACE, P1, NOW)!;
    const s2 = getQuizSession(SPACE, P2, NOW)!;
    expect(s1.totalAnswered).toBe(1);
    expect(s1.correctCount).toBe(0);
    expect(s2.totalAnswered).toBe(0);
    expect(s2.current?.nodeId).toBe(A);
    expect(s2.upcomingNodeIds).toEqual([B, C, D, E]);
  });

  it("two spaces with the same principal hold independent sessions (no cross-space leak)", async () => {
    await memoryQuizTool.run(tc({ principal: P1 }), { action: "start", count: 5 });
    await memoryQuizTool.run(tc({ principal: P1, spaceId: OTHER }), { action: "start", count: 5 });
    const here = getQuizSession(SPACE, P1, NOW)!;
    const there = getQuizSession(OTHER, P1, NOW)!;
    expect(here.current?.nodeId).toBe(A);
    expect(there.current?.nodeId).toBe(OX);
    expect(there.current?.expectedAnswer).toBe("Other Space Beta");
    // The tour in OTHER starts at OTHER's hub, not SPACE's.
    await constellationTourTool.run(tc({ principal: P1, spaceId: OTHER }), { action: "start" });
    const tourThere = getTourSession(OTHER, P1, NOW)!;
    expect(tourThere.currentNodeId).toBe(OX);
    expect(getTourSession(SPACE, P1, NOW)).toBeUndefined();
  });

  it("quiz and tour sessions for the same (space, principal) coexist independently", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    await constellationTourTool.run(tc(), { action: "start", label: "Samsonite Warehouse Job" });
    expect(getQuizSession(SPACE, P1, NOW)?.current?.nodeId).toBe(A);
    expect(getTourSession(SPACE, P1, NOW)?.currentNodeId).toBe(A);
    await constellationTourTool.run(tc(), { action: "end" });
    expect(getTourSession(SPACE, P1, NOW)).toBeUndefined();
    expect(getQuizSession(SPACE, P1, NOW)).toBeDefined(); // quiz untouched
  });

  it("idle expiry: a session untouched past the idle window is gone (quiz + tour + sweep)", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    await constellationTourTool.run(tc(), { action: "start" });
    const later = NOW + GAME_SESSION_IDLE_MS + 1;
    expect(getQuizSession(SPACE, P1, later)).toBeUndefined();
    expect(getTourSession(SPACE, P1, later)).toBeUndefined();

    // Through the tools: an expired quiz answers like no quiz at all.
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    const stale = await memoryQuizTool.run(tc({ now: later }), { action: "status" });
    expect(stale.message).toContain("no quiz is running");

    // The sweep removes whatever expiry-on-access hasn't reached yet.
    await memoryQuizTool.run(tc({ principal: P2 }), { action: "start", count: 5 });
    await constellationTourTool.run(tc({ principal: P2 }), { action: "start" });
    expect(sweepExpiredGameSessions(later)).toBe(2);
    expect(getQuizSession(SPACE, P2, NOW)).toBeUndefined();
    expect(getTourSession(SPACE, P2, NOW)).toBeUndefined();
  });

  it("a session used within the idle window survives (activity refreshes it)", async () => {
    await memoryQuizTool.run(tc(), { action: "start", count: 5 });
    const soon = NOW + GAME_SESSION_IDLE_MS - 1000;
    const st = await memoryQuizTool.run(tc({ now: soon }), { action: "status" });
    expect(st.message).toContain("MEMORY QUIZ STATUS");
    // Refreshed at `soon`, so it is still alive a full window later minus a hair.
    expect(getQuizSession(SPACE, P1, soon + GAME_SESSION_IDLE_MS - 1000)).toBeDefined();
  });
});
