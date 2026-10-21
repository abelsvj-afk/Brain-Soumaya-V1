import type { ToolContext } from "./tools/types.js";

/**
 * Telegram Parity Phase 5-B: in-memory session state for the multi-turn
 * conversational games (memory_quiz + constellation_tour).
 *
 * WHY IN-MEMORY IS ACCEPTABLE HERE (explicit design decision): a game
 * session is short-lived conversational scaffolding — the current question,
 * the in-session score, the tour's visited path. It is NOT brain data: no
 * memory, correction, or user-model fact ever lives only here. Losing a
 * session on server restart costs the user one half-finished game, exactly
 * like the Telegram history store (telegram/bot.ts) losing the short-term
 * thread on restart while the brain itself is unaffected. Durable facts
 * produced during a game (a correction) leave through the EXISTING durable
 * path — capture_memory's approval-gated ingest — never through this store.
 * No new table / data store is introduced for game state.
 *
 * Keying discipline mirrors the Telegram history store: sessions are keyed
 * by (spaceId, principal) as `${spaceId} ${principal}` so two brains, and
 * two channels/principals inside one brain, can never bleed into each
 * other. The principal is server-provided (agentLoop passes it into
 * ToolContext; the model never supplies it), so a session can only ever be
 * reached by the conversation that started it.
 *
 * Idle expiry: a session untouched for GAME_SESSION_IDLE_MS is discarded
 * on next access (and by the sweep). Expiry is elapsed-time math on the
 * injected clock (tc.now), never calendar-day math.
 */

/** Idle expiry for game sessions: 30 minutes untouched → discarded. */
export const GAME_SESSION_IDLE_MS = 30 * 60 * 1000;

/** The server-provided identity a session belongs to (never model input). */
export function principalOf(tc: ToolContext): string {
  return tc.principal ?? "unknown-principal";
}

/** Session key: (spaceId, principal), mirroring the bot history store. */
export function gameSessionKey(spaceId: string, principal: string): string {
  return `${spaceId} ${principal}`;
}

// ---------------------------------------------------------------------------
// Quiz session
// ---------------------------------------------------------------------------

export type QuizQuestionKind = "connection" | "cloze" | "recall";

/**
 * One quiz question, generated server-side from ONE real node. The expected
 * answer is stored ONLY here (server-side) — it is never included in the
 * tool result the model sees, so the model cannot leak it before grading.
 */
export interface QuizQuestion {
  nodeId: number;
  nodeLabel: string;
  kind: QuizQuestionKind;
  /** The exact question text to ask the user, verbatim. */
  question: string;
  /** The checkable right answer, derived from the node's own data. */
  expectedAnswer: string;
  /** Significant tokens of the expected answer, for tolerant grading. */
  expectedTokens: string[];
}

export interface QuizPerf {
  attempts: number;
  correct: number;
  wrong: number;
}

export interface QuizCorrection {
  nodeId: number;
  nodeLabel: string;
  /** The corrected statement, in the user's own words. */
  text: string;
  at: number;
}

export interface QuizSession {
  spaceId: string;
  principal: string;
  /** The question currently awaiting an answer (null once finished). */
  current: QuizQuestion | null;
  /** The most recently presented question (the correction target once the
   *  quiz has finished and `current` is null). */
  lastQuestion: QuizQuestion | null;
  /** Node ids not yet presented, in ask order (retries interleaved — see
   *  the spaced-repetition rule in memoryQuiz.ts). */
  upcomingNodeIds: number[];
  /** How many questions have been presented so far (1-based for display). */
  questionNumber: number;
  totalAnswered: number;
  correctCount: number;
  /** Per-memory performance, IN-SESSION ONLY (see header: no durable
   *  per-memory quiz store exists, so nothing is tracked across sessions). */
  performance: Map<number, QuizPerf>;
  /** Corrections the user stated during this session. Each one is routed
   *  to capture_memory as a proposal by the model; this list is only the
   *  session's own bookkeeping — it is never written to the brain here. */
  corrections: QuizCorrection[];
  startedAt: number;
  lastActiveAt: number;
}

// ---------------------------------------------------------------------------
// Constellation tour session
// ---------------------------------------------------------------------------

export interface TourStep {
  fromId: number;
  toId: number;
  /** The STORED relationship of the real edge that was traversed. */
  relationship: string;
  /** "outgoing": fromId —rel→ toId; "incoming": toId —rel→ fromId. */
  direction: "outgoing" | "incoming";
}

export interface TourSession {
  spaceId: string;
  principal: string;
  currentNodeId: number;
  /** Ordered path, start first, current last. Never repeats a node. */
  visitedNodeIds: number[];
  /** The real edge traversed for each move (steps[i] leads into
   *  visitedNodeIds[i+1]). */
  steps: TourStep[];
  startedAt: number;
  lastActiveAt: number;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const quizSessions = new Map<string, QuizSession>();
const tourSessions = new Map<string, TourSession>();

function isExpired(lastActiveAt: number, now: number): boolean {
  return now - lastActiveAt > GAME_SESSION_IDLE_MS;
}

/** Fetch the quiz session for (spaceId, principal); an idle-expired session
 *  is discarded and reported as absent. A live fetch counts as activity. */
export function getQuizSession(spaceId: string, principal: string, now: number): QuizSession | undefined {
  const key = gameSessionKey(spaceId, principal);
  const s = quizSessions.get(key);
  if (!s) return undefined;
  if (isExpired(s.lastActiveAt, now)) {
    quizSessions.delete(key);
    return undefined;
  }
  s.lastActiveAt = now;
  return s;
}

export function setQuizSession(session: QuizSession): void {
  quizSessions.set(gameSessionKey(session.spaceId, session.principal), session);
}

export function deleteQuizSession(spaceId: string, principal: string): void {
  quizSessions.delete(gameSessionKey(spaceId, principal));
}

/** Fetch the tour session for (spaceId, principal); same expiry contract. */
export function getTourSession(spaceId: string, principal: string, now: number): TourSession | undefined {
  const key = gameSessionKey(spaceId, principal);
  const s = tourSessions.get(key);
  if (!s) return undefined;
  if (isExpired(s.lastActiveAt, now)) {
    tourSessions.delete(key);
    return undefined;
  }
  s.lastActiveAt = now;
  return s;
}

export function setTourSession(session: TourSession): void {
  tourSessions.set(gameSessionKey(session.spaceId, session.principal), session);
}

export function deleteTourSession(spaceId: string, principal: string): void {
  tourSessions.delete(gameSessionKey(spaceId, principal));
}

/** Discard every idle-expired session. Returns how many were removed. */
export function sweepExpiredGameSessions(now: number): number {
  let removed = 0;
  for (const [key, s] of [...quizSessions]) {
    if (isExpired(s.lastActiveAt, now)) {
      quizSessions.delete(key);
      removed++;
    }
  }
  for (const [key, s] of [...tourSessions]) {
    if (isExpired(s.lastActiveAt, now)) {
      tourSessions.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Test/maintenance helper: drop ALL game sessions (both games). */
export function clearAllGameSessions(): void {
  quizSessions.clear();
  tourSessions.clear();
}

// ---------------------------------------------------------------------------
// Shared graph reads (the same edge semantics entity_lookup reports:
// both directions, stored relationship values, live nodes only)
// ---------------------------------------------------------------------------

export interface LiveNeighbor {
  otherId: number;
  otherLabel: string;
  otherType: string;
  relationship: string;
  weight: number;
  direction: "outgoing" | "incoming";
}

type Sqlite = {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => unknown[];
  };
};

/**
 * Every live neighbor of a node, both directions, in deterministic order
 * (outgoing first, then incoming; each by edge id). This is the ONLY source
 * of connections for the tour and for quiz connection questions — a step or
 * question that is not in this list does not exist.
 */
export function listNeighbors(sqlite: Sqlite, spaceId: string, nodeId: number): LiveNeighbor[] {
  const out = sqlite
    .prepare(
      `SELECT e.relationship AS relationship, e.weight AS weight,
              n.id AS otherId, n.label AS otherLabel, n.type AS otherType
       FROM edges e JOIN nodes n ON n.id = e.target
       WHERE e.space_id = ? AND e.source = ? AND n.deleted_at IS NULL AND n.superseded_at IS NULL
       ORDER BY e.id ASC`,
    )
    .all(spaceId, nodeId) as Omit<LiveNeighbor, "direction">[];
  const inc = sqlite
    .prepare(
      `SELECT e.relationship AS relationship, e.weight AS weight,
              n.id AS otherId, n.label AS otherLabel, n.type AS otherType
       FROM edges e JOIN nodes n ON n.id = e.source
       WHERE e.space_id = ? AND e.target = ? AND n.deleted_at IS NULL AND n.superseded_at IS NULL
       ORDER BY e.id ASC`,
    )
    .all(spaceId, nodeId) as Omit<LiveNeighbor, "direction">[];
  return [
    ...out.map((n) => ({ ...n, direction: "outgoing" as const })),
    ...inc.map((n) => ({ ...n, direction: "incoming" as const })),
  ];
}

/** The real edge between two nodes (either direction), or undefined. */
export function findEdgeBetween(
  sqlite: Sqlite,
  spaceId: string,
  fromId: number,
  toId: number,
): LiveNeighbor | undefined {
  return listNeighbors(sqlite, spaceId, fromId).find((n) => n.otherId === toId);
}
