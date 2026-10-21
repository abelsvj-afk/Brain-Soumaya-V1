import type { IntelligenceClaim, ClarificationCandidate, ProvenanceRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { CausalLink } from "@brain/shared";
import { InsightsRepo } from "../repositories/insights.repo.js";
import { IntelligenceClarificationsRepo } from "../repositories/intelligenceClarifications.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { buildEvolutionLinks, buildEvolutionLinksAmong } from "./temporalChains.js";
import { possibleDownstreamEffects } from "./causal.js";
import { resolveSupersession, type SupersessionKind } from "./supersession.js";
import { spaceTimezone } from "../agent/notify/policy.js";
/** The space's timezone for user-facing date labels (owner rule 2026-10-21). */
const spaceTz = (handle: DbHandle, spaceId: string): string => spaceTimezone(handle.sqlite, spaceId);


/**
 * Maya Intelligence — deterministic claim formation and clarification gating
 * (docs/specs/maya-intelligence-architecture.md). This module produces NO new facts: every
 * claim it returns is a reframing of something an EXISTING system already detected —
 * `synthesis/contradictions.ts`'s persisted `insights` rows, or
 * `analysis/temporalChains.ts`'s evolution-link computation. This module writes NO domain
 * facts anywhere — the one exception is `recordClarificationAsked()`, an `agent_logs` cooldown
 * entry structurally identical to what `agent/tools/router.ts`'s `logAction()` already writes
 * for every tool invocation (operational/telemetry state, not a fact about the user's life). No
 * LLM calls happen here either — the LLM already did its judgment work upstream (in
 * `detectContradiction`); this module only reframes an already-formed verdict into the shared
 * epistemic vocabulary.
 */

const CONTRADICTION_SCAN_LIMIT = 50;
const MAX_CONTRADICTION_CLAIMS = 3;
const MAX_CONTINUITY_CLAIMS = 2;
/** `analysis/temporalChains.ts`'s own strength bands (weak/medium/strong) — reused verbatim as
 *  the bar for "worth surfacing as a persisting-theme observation," not a new number. */
const CONTINUITY_MIN_STRENGTH: Array<"medium" | "strong"> = ["medium", "strong"];

/**
 * Open contradictions. `synthesis/contradictions.ts` already detects genuine conflicts (via
 * `llm.detectContradiction`, run on every provider including the offline heuristic) and
 * persists them as `insights` rows (`kind:"contradiction"`); they are hard-deleted once the
 * user resolves them (`POST /api/digest/insights/:id/resolve`), so every row still present is,
 * by construction, still open — this function adds nothing to detection, only reframing.
 *
 * Epistemic framing: the CONFLICT ITSELF ("A and B can't both be true") is an `"observation"` —
 * directly visible once both memories are read, not a guess. The insight's own `text` (the
 * LLM's one-line reconciliation attempt, e.g. "the accident may have made the vehicle
 * unavailable") is kept as the claim's `statement`, but the claim is never marked `"fact"`:
 * reconciling *why* two things conflict is inherently a hypothesis until the user confirms it —
 * this function never states the reconciliation as settled.
 */
export function openContradictionClaims(handle: DbHandle, spaceId: string = DEFAULT_SPACE): IntelligenceClaim[] {
  const insights = new InsightsRepo(handle, spaceId).recent(CONTRADICTION_SCAN_LIMIT);
  return insights
    .filter((i) => i.kind === "contradiction")
    .slice(0, MAX_CONTRADICTION_CLAIMS)
    .map((i) => ({
      id: `insight:${i.id}`,
      status: "observation",
      statement: i.text,
      confidence: Math.max(0, Math.min(1, i.score)),
      domain: "mind",
      evidence: i.nodes.map((n): ProvenanceRef => ({ domain: "memory", kind: "node", id: n.id, label: n.label })),
      createdAt: i.createdAt,
    }));
}

/**
 * Thought continuity. `analysis/temporalChains.ts`'s `buildEvolutionLinks()` already finds
 * same-theme memories ≥14 days apart (already wired to `GET /api/digest/evolution` and the
 * Digest panel) — this function reuses that EXACT computation rather than re-deriving
 * similarity itself, and reframes its strongest links as `"observation"` claims ("this theme
 * has persisted across time"). Deliberately does not materialize these as graph edges — that
 * is a separate, already-flagged follow-up noted in `temporalChains.ts`'s own doc comment
 * ("materializing as `evolves_into` edges"), not part of this pass.
 *
 * Maya Longitudinal Intelligence Phase A (docs/specs/maya-longitudinal-intelligence.md): when
 * `contextNodeIds` is given (the chat hot path always provides it — the SAME bounded GraphRAG
 * context set `chat/graphrag.ts` already built for this message), evolution-link construction
 * is bounded to those nodes via `buildEvolutionLinksAmong` instead of scanning every memory in
 * the space. Omitting it (every OTHER existing caller — the digest route, this file's own
 * tests) reproduces the exact prior full-space behavior via `buildEvolutionLinks`, unchanged.
 */
export function thoughtContinuityClaims(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  contextNodeIds?: number[],
): IntelligenceClaim[] {
  const links =
    contextNodeIds && contextNodeIds.length > 0
      ? buildEvolutionLinksAmong(handle, spaceId, contextNodeIds)
      : buildEvolutionLinks(handle, spaceId);
  return links
    .filter((l) => CONTINUITY_MIN_STRENGTH.includes(l.strength as "medium" | "strong"))
    .slice(0, MAX_CONTINUITY_CLAIMS)
    .map((l) => ({
      id: `evolution:${l.fromId}:${l.toId}`,
      status: "observation",
      statement: `"${l.fromLabel}" and "${l.toLabel}" — ${l.reason}`,
      confidence: l.strength === "strong" ? 0.85 : 0.65,
      domain: "mind",
      evidence: [
        { domain: "memory", kind: "node", id: l.fromId, label: l.fromLabel },
        { domain: "memory", kind: "node", id: l.toId, label: l.toLabel },
      ],
      createdAt: new Date().toISOString(),
    }));
}

/** Bounded like every other cap in this module (`MAX_CONTRADICTION_CLAIMS`,
 *  `MAX_CONTINUITY_CLAIMS`) — this is a SECONDARY signal layered on top of already-capped
 *  inputs, so it stays conservative. */
const MAX_SUPERSESSION_CLAIMS = 2;

/**
 * Direction-of-currency claims (docs/specs/maya-longitudinal-intelligence.md, Phase A) — the
 * real producer of `"outdated"`/`"contradicted"` this pass's audit found missing. ADDITIVE to
 * (never replacing) `openContradictionClaims`'s/`thoughtContinuityClaims`'s own `"observation"`
 * framing: for each already-detected relationship whose two evidence memories have a
 * confidently-resolvable date order (`resolveSupersession`, pure arithmetic, no LLM call), this
 * ALSO produces one stronger claim naming the superseded side — `"contradicted"` for a genuine,
 * already-LLM-verified conflict; `"outdated"` for a same-theme evolution pair (a legitimate
 * change over time, never mislabeled as a conflict just for having changed). Never invents
 * evidence, never touches either memory's content — only ever ADDS a label to a NEW, transient
 * claim. When direction can't be established confidently, the pair is silently skipped (the
 * underlying claim's existing `"observation"` status is left exactly as it was).
 */
export function supersessionClaims(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  contextNodeIds?: number[],
): IntelligenceClaim[] {
  const nodesRepo = new NodesRepo(handle, spaceId);
  const out: IntelligenceClaim[] = [];

  const fromPair = (evidence: ProvenanceRef[], kind: SupersessionKind, baseConfidence: number): void => {
    if (out.length >= MAX_SUPERSESSION_CLAIMS) return;
    const [refA, refB] = evidence;
    if (!refA || !refB || refA.domain !== "memory" || refB.domain !== "memory") return;
    const a = nodesRepo.getById(refA.id);
    const b = nodesRepo.getById(refB.id);
    if (!a || !b) return;
    const result = resolveSupersession(a, b, kind, spaceTz(handle, spaceId));
    if (!result) return;
    out.push({
      id: `supersession:${result.superseded.id}:${result.current.id}`,
      status: result.status,
      statement: `"${result.superseded.label}" — ${result.reason}`,
      confidence: baseConfidence,
      domain: "mind",
      evidence: [result.superseded, result.current],
      createdAt: new Date().toISOString(),
    });
  };

  for (const claim of openContradictionClaims(handle, spaceId)) {
    if (out.length >= MAX_SUPERSESSION_CLAIMS) break;
    fromPair(claim.evidence, "contradiction", claim.confidence);
  }
  if (out.length < MAX_SUPERSESSION_CLAIMS) {
    for (const claim of thoughtContinuityClaims(handle, spaceId, contextNodeIds)) {
      if (out.length >= MAX_SUPERSESSION_CLAIMS) break;
      fromPair(claim.evidence, "continuity", claim.confidence);
    }
  }

  return out;
}

/** A claim, reframed as something worth possibly asking about. Priority favors a genuine
 *  conflict (observation, from contradiction detection) over a merely-persisting theme —
 *  contradictions materially affect correctness; a recurring topic is lower-stakes curiosity. */
function toCandidate(claim: IntelligenceClaim): ClarificationCandidate {
  const isContradiction = claim.id.startsWith("insight:");
  const basePriority = isContradiction ? 0.6 : 0.3;
  return {
    claim,
    question: isContradiction
      ? `I noticed something that might not add up — ${claim.statement} Want to fill me in?`
      : `You've come back to this a few times: ${claim.statement} Has your thinking changed?`,
    priority: Math.min(1, basePriority + claim.confidence * 0.4),
    reason: isContradiction ? "unresolved contradiction between two memories" : "a theme keeps recurring across time",
  };
}

/** A candidate must clear this bar to be worth a question at all — most detected uncertainty
 *  is background context, not something worth interrupting the user about. NEW — no existing
 *  "is this worth asking about" threshold exists anywhere in the repo for anything other than
 *  bill risk's budget-magnitude check (a different kind of decision entirely); this is the
 *  smallest explicit value that still filters out low-confidence noise. */
const MIN_CLARIFICATION_PRIORITY = 0.5;

/**
 * Pure ranking + gate — given candidates and whether a clarification was already surfaced
 * recently, picks at most one. Deliberately has NO database access, mirroring how
 * `agent/tools/*.ts` already separate deterministic decision logic from the DB-backed cooldown
 * read (see `clarificationAskedRecently` below) — this keeps the actual decision rule fully
 * unit-testable without a database.
 */
export function selectClarification(candidates: ClarificationCandidate[], cooldownActive: boolean): ClarificationCandidate | null {
  if (cooldownActive || candidates.length === 0) return null;
  const [best] = [...candidates].sort((a, b) => b.priority - a.priority);
  return best && best.priority >= MIN_CLARIFICATION_PRIORITY ? best : null;
}

/** NEW — no existing precedent for a "clarification" cadence specifically (this is a
 *  conversational, chat-reactive gate, not a daily autonomous nudge like the other tools'
 *  once-per-day pattern) — 3 days is the smallest explicit value that keeps this from
 *  resurfacing the same suggestion every single message without being so long it goes stale. */
const CLARIFICATION_COOLDOWN_DAYS = 3;

/** Same `agent_logs`-lookback idiom this codebase already uses for every tool cooldown
 *  (`agent/tools/billRisk.ts`, `financeFreshness.ts`, etc.) — reused for consistency rather
 *  than inventing a new cooldown mechanism, even though (per this feature's own architecture
 *  doc) that idiom is itself duplicated across ~8 files with no shared helper; this is
 *  deliberately not the pass to finally factor that out. */
export function clarificationAskedRecently(handle: DbHandle, spaceId: string, nowMs: number): boolean {
  const cutoff = new Date(nowMs - CLARIFICATION_COOLDOWN_DAYS * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const row = handle.sqlite
    .prepare(`SELECT 1 FROM agent_logs WHERE space_id = ? AND action = 'intelligence:clarification' AND created_at >= ? LIMIT 1`)
    .get(spaceId, cutoff);
  return !!row;
}

/** Records that a clarification was surfaced, so the cooldown above holds for the next
 *  `CLARIFICATION_COOLDOWN_DAYS`. Called only when `intelligenceSnapshotText` actually includes
 *  a suggested question in the chat context — an approximation (we can't observe whether the
 *  LLM actually voiced it in her reply, the same practical limit this codebase's existing
 *  `justAsked` chat-history heuristic already accepts) that errs toward NOT repeating the same
 *  suggestion rather than risking it every turn. */
function recordClarificationAsked(handle: DbHandle, spaceId: string, candidate: ClarificationCandidate): void {
  handle.sqlite
    .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES (?, 'intelligence:clarification', ?, '[]', CURRENT_TIMESTAMP)`)
    .run(spaceId, candidate.reason);
}

const fmtClaim = (c: IntelligenceClaim): string => c.statement;
const fmtCausal = (c: CausalLink): string => c.effectDescription;

/**
 * Chat-facing renderer — same null-when-empty, best-effort contract as the other four snapshot
 * functions `chat/graphrag.ts` already calls (finance/people/cognitive/temporal). Narrates open
 * contradictions and persisting themes as explicitly-framed OBSERVATIONS (never as settled
 * fact), possible downstream effects (Part I1 causal reasoning — always "possible", never
 * asserted causation), and — only when a candidate clears the clarification gate — appends ONE
 * suggested question for Soumaya to ask NATURALLY if it fits the conversation, never a scripted
 * line she must recite verbatim.
 */
export function intelligenceSnapshotText(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  now: Date = new Date(),
  /** Maya Longitudinal Intelligence Phase A — the SAME bounded GraphRAG context ids
   *  `chat/graphrag.ts` already computed for this message, threaded through to
   *  `thoughtContinuityClaims`/`supersessionClaims` so evolution-link construction never
   *  scans the whole memory graph on the chat hot path. Omitted by every other caller
   *  (tests), which reproduces the exact prior full-space behavior. */
  contextNodeIds?: number[],
): string | null {
  const contradictions = openContradictionClaims(handle, spaceId);
  const continuity = thoughtContinuityClaims(handle, spaceId, contextNodeIds);
  const causal = contradictions.flatMap((c) => possibleDownstreamEffects(handle, spaceId, c, now, contextNodeIds)).slice(0, 3);
  const superseded = supersessionClaims(handle, spaceId, contextNodeIds);
  if (contradictions.length === 0 && continuity.length === 0) return null;

  const lines = ["INTELLIGENCE NOTES (deterministic observations — these are NOT settled facts; never state them as certain):"];
  if (contradictions.length) {
    lines.push(`- Possible contradiction (unresolved): ${contradictions.map(fmtClaim).join("; ")}.`);
  }
  if (continuity.length) {
    lines.push(`- Persisting theme: ${continuity.map(fmtClaim).join("; ")}.`);
  }
  if (superseded.length) {
    // "outdated"/"contradicted" claims: a real, deterministic direction-of-currency verdict,
    // not a settled deletion of the earlier memory — phrased so the LLM never mistakes this
    // for permission to say the older statement never happened.
    lines.push(`- No longer current (a later statement supersedes it — the earlier memory itself is still historically true, just not a description of now): ${superseded.map(fmtClaim).join("; ")}.`);
  }
  if (causal.length) {
    lines.push(`- Possible downstream effect (correlation only, NOT proven causation — never say "X caused Y", only "the timing coincides"): ${causal.map(fmtCausal).join(" ")}`);
  }

  const candidates = [...contradictions, ...continuity].map(toCandidate);
  const cooldownActive = clarificationAskedRecently(handle, spaceId, now.getTime());
  const chosen = selectClarification(candidates, cooldownActive);
  if (chosen) {
    lines.push(`- If it fits naturally, you may ask (in your own words, not verbatim): "${chosen.question}"`);
    recordClarificationAsked(handle, spaceId, chosen);
    // I2 (docs/specs/maya-intelligence-architecture.md) — the candidate becoming an actual
    // PENDING row is what closes the lifecycle: without this, `resolveClarificationFromMessage`
    // (analysis/clarificationResolution.ts) would never have anything to match a future answer
    // against. The agent_logs cooldown above already prevents this from firing again for the
    // same window, so this can't spam duplicate pending rows in normal operation.
    new IntelligenceClarificationsRepo(handle, spaceId).create({
      claimId: chosen.claim.id,
      domain: chosen.claim.domain,
      question: chosen.question,
      evidence: chosen.claim.evidence,
    });
  }

  return lines.join("\n");
}
