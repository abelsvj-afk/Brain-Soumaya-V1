import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { EmotionalPattern } from "@brain/shared";
import { soulTextFor } from "../identity.js";
import { deriveBehavior } from "../persona/behavior.js";
import {
  InteractionPreferencesRepo,
  type InteractionPreferenceRow,
} from "../repositories/interactionPreferences.repo.js";
import { SURFACE_CONFIDENCE_THRESHOLD, MIN_EVIDENCE_TO_SURFACE } from "../analysis/interactionPreferences.js";
import { buildEmotionalTrajectory, buildEmotionalTrajectoryAmong } from "../analysis/emotional.js";

/**
 * Shared Soumaya Communication boundary (Phase S,
 * docs/specs/soumaya-shared-communication.md). Phase R found that Chat already assembles a
 * real communication-strategy layer (soul/identity, derived behavior, learned interaction
 * preferences, bounded emotional context) but every proactive surface is disconnected from
 * all of it. This module is that layer's SHARED READ — not a new intelligence system, not a
 * new source of truth, not a competing preference/personality store. Every field here is
 * produced by an already-existing, already-locked function; this module only bundles their
 * outputs behind one reusable, read-only, space-scoped call.
 *
 * WHAT THIS IS NOT: a giant "everything about the user" dump. It carries exactly the four
 * inputs Chat's own prompt assembly (`chat/graphrag.ts`) already treats as communication
 * inputs (as opposed to fact/content inputs) — nothing about Journeys, Money, Wealth, People,
 * or memory content lives here. A caller that needs THOSE still goes to the same
 * *SnapshotText functions/repos Chat already uses for facts; this module is deliberately
 * narrower than that.
 *
 * Zero LLM calls. Every field is either a cheap deterministic SQL read/aggregate (already
 * proven cheap — `refreshPersona`/`deriveBehavior`/`interactionPreferenceSnapshotText` are all
 * already called on every chat turn) or, for `emotionalPatterns`, a bounded read the caller
 * explicitly opts into (see `CommunicationContextOptions` below) — this function never
 * silently pays for a full-space scan.
 */

export interface CommunicationContext {
  spaceId: string;
  /** Soumaya's own stable identity/voice text (soul.md, or this space's override) — the
   *  SAME text `composeSystem()` injects into every chat turn under "YOUR DEEPER CHARACTER".
   *  Included for parity with Chat and for any future LLM-backed proactive generator; a
   *  purely deterministic template consumer (like this phase's bill-risk pilot) may ignore
   *  it outright — identity doesn't change WHAT a template says, only how an LLM would. */
  soul: string;
  /** Deterministic "how to be with them right now" delivery guidance (persona/behavior.ts,
   *  UNCHANGED, called exactly as chat/graphrag.ts already calls it) — "" when there isn't
   *  enough history to say anything. Opaque prose by design (see persona/behavior.ts's own
   *  doc comment) — a caller should not string-match it; use `emotionalPatterns` below for a
   *  structured signal instead. */
  behaviorGuidance: string;
  /** Learned communication preferences that have ALREADY cleared interactionPreferences.ts's
   *  own evidence bar (same SURFACE_CONFIDENCE_THRESHOLD/MIN_EVIDENCE_TO_SURFACE constants
   *  interactionPreferenceSnapshotText() itself uses — imported, not re-derived) — empty when
   *  none have. This is the existing open-taxonomy preference system's rows, verbatim; this
   *  module does not interpret, rename, or bucket them. */
  preferences: InteractionPreferenceRow[];
  /** Bounded, currently-relevant emotional pattern context (analysis/emotional.ts's own
   *  `EmotionalPattern[]`, UNCHANGED detection logic) — null when nothing patterned is
   *  currently in scope. Never a single memory's raw valence (see emotional.ts's own
   *  doc comment) — only a real, repeated, already-detected pattern. Consumers must treat
   *  this the same way emotionalSnapshotText's own hedge already requires: a recurring
   *  SIGNAL to shape TONE, never a fact to assert about the user or a reason to claim
   *  certainty the pattern detector itself doesn't establish. */
  emotionalPatterns: EmotionalPattern[] | null;
}

export interface CommunicationContextOptions {
  /** Chat's own bounded scope: the already-retrieved context node ids for THIS message.
   *  When provided (even as an empty array), emotional pattern detection is scoped to
   *  exactly these ids — the same cost-bounded behavior `emotionalSnapshotText` already
   *  guarantees for the chat hot path. */
  relevantNodeIds?: number[];
  /** Proactive/background callers are NOT the chat hot path (same precedent already
   *  established for the Digest panel's own `buildEmotionalTrajectory` call) — set this to
   *  opt into a full-space emotional read when `relevantNodeIds` isn't meaningful (e.g. a
   *  proactive job with no retrieved-memory concept of its own, like bill-risk). Ignored if
   *  `relevantNodeIds` is provided. Defaults to false, so simply omitting both options is a
   *  safe, cheap no-op for `emotionalPatterns` (returns null, no query at all). */
  includeFullSpaceEmotionalTrajectory?: boolean;
}

/**
 * Build the shared communication context for one space. Read-only, deterministic, no LLM
 * calls, space-scoped by construction (every underlying read already takes `spaceId` and
 * scopes its own query — this function adds no new scoping logic, it only threads the same
 * `spaceId` through to each of the four existing readers).
 */
export function buildCommunicationContext(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  opts: CommunicationContextOptions = {},
): CommunicationContext {
  const soul = soulTextFor(handle.sqlite, spaceId);
  const behaviorGuidance = deriveBehavior(handle, spaceId);
  const preferences = new InteractionPreferencesRepo(handle, spaceId)
    .list()
    .filter((r) => r.confidence >= SURFACE_CONFIDENCE_THRESHOLD && r.evidenceCount >= MIN_EVIDENCE_TO_SURFACE);

  let emotionalPatterns: EmotionalPattern[] | null = null;
  if (opts.relevantNodeIds) {
    const trajectory = buildEmotionalTrajectoryAmong(handle, spaceId, opts.relevantNodeIds);
    emotionalPatterns = trajectory.patterns.length > 0 ? trajectory.patterns : null;
  } else if (opts.includeFullSpaceEmotionalTrajectory) {
    const trajectory = buildEmotionalTrajectory(handle, spaceId);
    emotionalPatterns = trajectory.patterns.length > 0 ? trajectory.patterns : null;
  }

  return { spaceId, soul, behaviorGuidance, preferences, emotionalPatterns };
}

/**
 * How many times an action has already fired for this space in the last `sinceDays` days —
 * a generic, reusable "have we already told them about this recently" read against the
 * EXISTING `agent_logs` table (no new table, no new column), mirroring the exact query shape
 * `billRiskTool.detect()`'s own once-a-day guard already uses. Any proactive surface can use
 * this to avoid re-explaining the same thing from scratch on every firing — a communication
 * concern (how much has already been said), not a detection concern (whether to fire again),
 * which is why it lives here rather than in any tool's own detection logic.
 */
export function recentActionCount(handle: DbHandle, spaceId: string, action: string, sinceDays: number, now: Date = new Date()): number {
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();
  // julianday() on both sides: agent_logs.created_at mixes the column default's
  // space format with the router's ISO-Z writes, and a raw string comparison
  // silently drops same-day space-format rows (audit gap #6 — same fix as
  // goalFundingTrend's cooldown read).
  const row = handle.sqlite
    .prepare(`SELECT COUNT(*) AS c FROM agent_logs WHERE space_id = ? AND action = ? AND julianday(created_at) >= julianday(?)`)
    .get(spaceId, action, since) as { c: number };
  return row.c;
}
