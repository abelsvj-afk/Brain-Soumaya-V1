import { worldsSnapshotText } from "../worlds/awareness.js";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { knnProfiles } from "../db/vec.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { InstructionProfilesRepo } from "../repositories/instructions.repo.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import type { InstructionProfileRow } from "../db/schema.js";
import { refreshPersona } from "../persona/derive.js";
import { deriveBehavior } from "../persona/behavior.js";
import { getGroundedInsight } from "../identity.js";
import { financialSnapshotText } from "../finance/snapshot.js";
import { peopleSnapshotText } from "../analysis/people.js";
import { cognitiveSnapshotText } from "../analysis/cognitive.js";
import { temporalSnapshotText } from "../analysis/temporalContext.js";
import { intelligenceSnapshotText } from "../analysis/intelligence.js";
import { emotionalSnapshotText } from "../analysis/emotional.js";
import { interactionPreferenceSnapshotText } from "../analysis/interactionPreferences.js";
import { resolveClarificationFromMessage } from "../analysis/clarificationResolution.js";
import { proactiveContextSnapshotText, type ProactiveContextInput } from "../analysis/proactiveContext.js";
import { UsageTracker } from "../usage.js";
import { EconomyRepo } from "../economy.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";

/** Min similarity for an 'auto' instruction profile to be intent-routed in. */
export const AUTO_PROFILE_THRESHOLD = 0.35;

export interface BuildCompanionContextOptions {
  /**
   * The current message's embedding — used ONLY to intent-route 'auto'
   * instruction profiles (knnProfiles at AUTO_PROFILE_THRESHOLD). Absent →
   * 'always' profiles only. Callers that cannot embed (or whose embedding
   * failed) omit it and degrade to always-only: fail-open by contract.
   */
  questionVec?: Float32Array;
  /**
   * The answering LLM, used ONLY for the telemetry block's qualitative
   * status lines (available / degraded / cooldown-until — never figures).
   * Absent → telemetry renders the plain "active, no cooldown" state.
   */
  llm?: LlmProvider;
  /**
   * Node ids already retrieved for this message (web chat's GraphRAG set).
   * Bounds the intelligence + emotional snapshots exactly as chat() did.
   * Absent → intelligence falls back to its full-space read (its own
   * documented omitted-caller behavior) and the emotional snapshot — which
   * is bounded-context-only by design — contributes nothing.
   */
  retrievedIds?: number[];
  /**
   * Clarification resolution (web chat only): when the current message may
   * ANSWER a pending clarification, resolving it writes the confirmed fact
   * and surfaces it in this turn's context. The agent loop deliberately
   * does NOT pass this in Phase 0 — its callers never supplied it before,
   * and silently consuming a Telegram "yes" as a clarification answer
   * mid-approval-flow is a behavior change beyond this phase's scope.
   */
  clarification?: {
    deps: { embeddings: EmbeddingProvider; llm: LlmProvider };
    question: string;
  };
  /**
   * Proactive → Chat handoff target (web chat only, same rationale as
   * `clarification`): set ONLY when the user opened chat from a real
   * proactive delivery. Re-validated inside the builder; invalid/stale/
   * cross-space values contribute nothing.
   */
  proactiveContext?: ProactiveContextInput | null;
}

export interface CompanionContext {
  /**
   * The full system-context stack, in the web chat's original order:
   * telemetry → behavior → finance → people → cognitive → temporal →
   * intelligence → emotional → learned preferences → [clarification] →
   * [proactive] → grounded-insight discipline → AVAILABLE MODES last
   * (models weight the end of the prompt most — instruction profiles were
   * being buried by the telemetry block before this ordering was set).
   *
   * This is TRUSTED system context, assembled from the space's own data.
   * It is NOT the channel for auto-retrieved memories: those stay in the
   * caller's separate, PR #72-framed untrusted-data block, never merged in.
   */
  systemExtra: string;
  /** "About Me" persona (auto-derived; she's aware of it, never becomes them). */
  persona?: string;
  /** The instruction profiles chosen for this turn (always + routed auto). */
  chosenProfiles: InstructionProfileRow[];
}

/**
 * THE shared companion-context builder (Telegram Parity Phase 0).
 *
 * Extracted mechanically out of chat/graphrag.ts `chat()` so the web chat
 * and the agent loop (Telegram + /api/chat/agent) assemble the SAME context
 * stack from ONE function and cannot silently drift apart again — that drift
 * is the root cause of every parity symptom (no counts, no people roster, no
 * instruction profiles on Telegram). The web chat's assembled system prompt
 * is golden-tested byte-identical to the pre-extraction base code
 * (chat/__tests__/companionContext.test.ts).
 *
 * Every snapshot inside follows the contract they already had in chat():
 * best-effort and null-safe — a failing snapshot adds nothing and never
 * breaks the turn.
 */
export async function buildCompanionContext(
  h: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  opts: BuildCompanionContextOptions = {},
): Promise<CompanionContext> {
  const nodesRepo = new NodesRepo(h, spaceId);

  // Layer 2: the user's custom instruction profiles are AVAILABLE MODES she may
  // adopt — 'always' are candidates every turn, 'auto' are intent-routed in — but
  // she picks the one(s) that FIT the current message (see the prompt), rather
  // than cramming every active role into every reply.
  const active = new InstructionProfilesRepo(h, spaceId).listActive();
  let routedAuto = new Set<number>();
  if (opts.questionVec && active.some((p) => p.mode === "auto")) {
    routedAuto = new Set(
      knnProfiles(h.sqlite, opts.questionVec, 3, spaceId)
        .filter((p) => p.similarity >= AUTO_PROFILE_THRESHOLD)
        .map((p) => p.profileId),
    );
  }
  const chosen = active.filter((p) => p.mode !== "auto" || routedAuto.has(p.id));

  // --- Live Telemetry & App State (for all app tabs/pages context) ---
  const usage = new UsageTracker(h).summary();
  const resilient = (opts.llm ?? {}) as any;
  const llmStatus = {
    model: opts.llm?.model,
    available: resilient.available !== false,
    degraded: resilient.degraded === true,
    disabledUntil: resilient.disabledUntil ? new Date(resilient.disabledUntil).toLocaleTimeString() : null,
  };
  // Deployment-level spend is summarized QUALITATIVELY only: exact dollar figures
  // and which API keys are configured are shared-deployment facts that must not be
  // recited to every tenant's chat.
  const budgetState = usage.overBudget ? "exhausted" : usage.low ? "running low" : "healthy";

  const economy = new EconomyRepo(h, spaceId).toFuel();

  let recentLogs: { action: string; description: string; created_at: string }[] = [];
  try {
    recentLogs = h.sqlite
      .prepare(`SELECT action, description, created_at FROM agent_logs WHERE space_id = ? ORDER BY id DESC LIMIT 5`)
      .all(spaceId) as any[];
  } catch (err) {
    console.error("[chat] failed to fetch agent logs for telemetry:", err);
  }

  const allNodes = nodesRepo.all();
  const totalMemories = allNodes.length;
  const mainHubs = allNodes
    .filter((n) => typeof n.importance === "number" && n.importance >= 0.7)
    .map((n) => `"${n.label}" (Type: ${n.type}, Mass: ${n.importance})`);

  const typeCounts: Record<string, number> = {};
  for (const n of allNodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }

  const activeActions = allNodes.filter((n) => n.kind === "action");

  let recentInsights: string[] = [];
  try {
    recentInsights = new InsightsRepo(h, spaceId).recent(5).map((i) => `- Insight: ${i.text}`);
  } catch (err) {
    console.error("[chat] failed to fetch insights for telemetry:", err);
  }

  const telemetryContext = `
=== CURRENT APP STATE & SYSTEM TELEMETRY (AWARENESS OF ALL APP TABS/PAGES) ===
You have full access to read every tab and page of this application. Here is the current live state of all tabs:

1. COMPANION & SYSTEM SETTINGS TAB:
- Cloud AI Status: ${llmStatus.available ? "ACTIVE & RUNNING" : "DEGRADED (On temporary fallback/cooldown)"}
- AI Error Cooldown: ${llmStatus.degraded ? `YES (quota/billing limit hit, cooling down until ${llmStatus.disabledUntil})` : "None (fully functional)"}
- Shared AI Budget State: ${budgetState}${budgetState !== "healthy" ? " — advise gentler use until it recovers" : ""}

2. SOUMAYA & FLEET TAB:
- Ship Fuel level: ${economy.fuel.toFixed(1)} / ${economy.capacity} units
- Ship Upkeep job cost: ${economy.jobCost} fuel per deep-dive research/scan
- Low Fuel distress trigger: ${economy.fuel < 20 ? "⚠️ CRITICAL LOW FUEL DISTRESS TRIGGERED" : "Optimal (above distress threshold)"}
- Recent Autonomy Log:
${recentLogs.map((l) => `  * [${l.created_at || "recent"}] ${l.action.toUpperCase()}: ${l.description}`).join("\n")}

3. LIST & SECTORS TAB:
- Total Memory Nodes in Space: ${totalMemories}
- Sector/Type Distribution of Memories:
${Object.entries(typeCounts).map(([type, count]) => `  * Type "${type}": ${count} nodes`).join("\n")}
- Celestial Hubs (Mass >= 0.70):
${mainHubs.length > 0 ? mainHubs.map((hub) => `  * ${hub}`).join("\n") : "  * (No high mass hubs cataloged)"}

4. AGENDA / ACTIONS TAB:
- Unresolved Action Items/Tasks:
${activeActions.length > 0 ? activeActions.map((a) => `  * [ ] "${a.label}" (Priority weight: ${a.importance ?? 0.4})`).join("\n") : "  * (No action items pending)"}

5. INSIGHTS / DIGEST TAB:
- Recent Latent Cross-Cluster Insights:
${recentInsights.length > 0 ? recentInsights.join("\n") : "  * (No latent connection insights synthesized yet)"}

Use this telemetry to guide the user! For example:
- If fuel is low (<20) and they ask how you're doing, tell them you're in distress or need them to log memories / clear agenda to refill fuel.
- If the shared AI budget is running low or exhausted (or the provider is on cooldown), say your deep-thinking is resting and will return — never recite dollar figures or key configuration.
- If they ask about their tasks/agenda, summarize the active action items.
- If they ask about sectors/galaxy size, talk about node counts and hubs.
- You can suggest they look at specific tabs (e.g. "Go to the Agenda tab and complete task X to gain fuel", or "Check out the Insights tab to see the latest connections I forged").
`;

  // Telemetry first, then the live behavioral read, the user's custom
  // instructions LAST — models weight the end of a system prompt most, and the
  // big telemetry block was burying the roles (users reported chat "not using"
  // their custom instructions). Behavior sits late too: it shapes DELIVERY.
  let systemExtra = telemetryContext;
  const behavior = deriveBehavior(h, spaceId);
  if (behavior) systemExtra += `\n\n${behavior}`;

  // Financial OS (Stage 2): give her the AGGREGATED money snapshot so she can answer budget
  // questions from real numbers + the user's goals (deterministic math; she only explains).
  // Only when the module has data; only totals/top-lines reach the LLM (decision D5).
  try {
    const finance = financialSnapshotText(h, spaceId);
    if (finance) systemExtra += `\n\n${finance}`;
  } catch {
    /* finance context is best-effort; never break chat */
  }

  // Mind tab (Cognitive Layer): same treatment as Finance above — an AGGREGATED summary
  // of who the user tracks, so she can answer "how are things with X" or "who have I
  // been distant from" from real counts/tone instead of relying on generic top-K
  // retrieval to happen to surface the right person_entity node.
  try {
    const people = peopleSnapshotText(h, spaceId);
    if (people) systemExtra += `\n\n${people}`;
  } catch {
    /* people context is best-effort; never break chat */
  }
  // The Mind tab is more than tracked people — goals, ideas, skills, identity, mental
  // models, intentions, future events, motivations all live there too.
  try {
    const cognitive = cognitiveSnapshotText(h, spaceId);
    if (cognitive) systemExtra += `\n\n${cognitive}`;
  } catch {
    /* cognitive context is best-effort; never break chat */
  }

  // The worlds + Eternity (docs/specs/eternity-autonomy-2026-10-29.md §2a): where the ship is, any journey, which
  // worlds are reachable, and Eternity's own logged acts — so she can talk about them truthfully on web and Telegram.
  try {
    const worlds = worldsSnapshotText(h, spaceId);
    if (worlds) systemExtra += `\n\n${worlds}`;
  } catch {
    /* worlds context is best-effort; never break chat */
  }

  // Temporal/Contextual Reasoning (docs/specs/temporal-contextual-reasoning.md): a bounded,
  // deterministic cross-domain read of what's overdue/upcoming/stale/recently-changed right
  // now (Money, Wealth, Life Vision, Journeys, Mind, People) plus a couple of real
  // period-over-period trends — so she can reason about TIMING (what's due, what's gone
  // stale, what actually changed) instead of treating every fact as equally "now". Same
  // best-effort, null-safe contract as the three snapshots above.
  try {
    const temporal = temporalSnapshotText(h, spaceId);
    if (temporal) systemExtra += `\n\n${temporal}`;
  } catch {
    /* temporal context is best-effort; never break chat */
  }

  // Maya Intelligence (docs/specs/maya-intelligence-architecture.md): open contradictions and
  // persisting themes, reframed from EXISTING detection (synthesis/contradictions.ts's insights,
  // analysis/temporalChains.ts's evolution links) as explicit observations — never asserted as
  // settled fact — plus, when warranted, one gated clarification suggestion. Same best-effort,
  // null-safe contract as the four snapshots above.
  try {
    const intelligence = intelligenceSnapshotText(h, spaceId, undefined, opts.retrievedIds ? [...opts.retrievedIds] : undefined);
    if (intelligence) systemExtra += `\n\n${intelligence}`;
  } catch {
    /* intelligence context is best-effort; never break chat */
  }

  // Maya Longitudinal Intelligence, Phase E (docs/specs/maya-longitudinal-intelligence.md,
  // Section 11): a detected, RECURRING emotional pattern among the memories already retrieved
  // for this message — never a single memory's raw valence, never asserted as a fact about who
  // the user is or what they want. Bounded to the SAME `ids` GraphRAG already computed (no new
  // retrieval); null whenever nothing patterned was found, so most messages inject nothing.
  try {
    const emotional = emotionalSnapshotText(h, spaceId, opts.retrievedIds ? [...opts.retrievedIds] : []);
    if (emotional) systemExtra += `\n\n${emotional}`;
  } catch {
    /* emotional context is best-effort; never break chat */
  }

  // Maya Longitudinal Intelligence, Phase H (docs/specs/maya-longitudinal-intelligence.md,
  // Section 14): LEARNED communication preferences from PAST conversations — additive Layer-2
  // guidance, never a rule, always outranked by an explicit instruction in THIS message. Reads
  // only this space's own small preference table (analysis/interactionPreferences.ts); no scan,
  // no new retrieval. Recording any NEW signal from THIS message happens after the answer call
  // below, once the model has actually responded.
  try {
    const preferences = interactionPreferenceSnapshotText(h, spaceId);
    if (preferences) systemExtra += `\n\n${preferences}`;
  } catch {
    /* preference context is best-effort; never break chat */
  }

  // I2 — clarification → confirmed knowledge (docs/specs/maya-intelligence-architecture.md).
  // If this message answers a pending clarification, it's now a real memory (embedded,
  // linked back to its evidence) — surface it in THIS turn's context so she can acknowledge
  // it naturally instead of the confirmation only becoming visible on some future message.
  // Only for callers that opt in (see BuildCompanionContextOptions.clarification).
  if (opts.clarification) {
    try {
      const resolved = await resolveClarificationFromMessage(h, opts.clarification.deps, opts.clarification.question, spaceId);
      if (resolved) {
        systemExtra += `\n\nCLARIFICATION RESOLVED: the user just confirmed "${resolved.confirmedStatement}" — this is now a settled fact, saved to memory. Acknowledge it naturally if it fits; never re-ask the question you just got an answer to.`;
      }
    } catch {
      /* clarification resolution is best-effort; never break chat */
    }
  }

  // Phase Y — proactive → Chat handoff. Same best-effort, null-safe contract as every
  // snapshot above: a failure here (or an invalid/stale/cross-space target) simply
  // adds nothing, never breaks the turn.
  if (opts.proactiveContext != null) {
    try {
      const proactive = proactiveContextSnapshotText(h, spaceId, opts.proactiveContext);
      if (proactive) systemExtra += `\n\n${proactive}`;
    } catch {
      /* proactive context is best-effort; never break chat */
    }
  }

  // Evidence-based self-insight discipline (docs/ADAPTIVE_SELF_RESEARCH.md). Soumaya's
  // draw is being "unsettlingly accurate in a good way" — that only works through real,
  // specific, checkable observations, NEVER the vague/flattering horoscope lines (the
  // Barnum trap) that feel personal to everyone and collapse the moment they're examined.
  // Toggleable per brain in her chat settings (default ON); OFF relaxes to a looser style.
  if (getGroundedInsight(h.sqlite, spaceId)) systemExtra += `

=== EXTRA REFLECTION RIGOR (grounded-insight mode is ON) ===
This SHARPENS your existing honest, cited recall — it does not replace your voice, your
roles, or your knowledge. When you tell the user something about THEMSELVES, additionally hold to:
• FALSIFIABLE + open to correction: phrase it so they can confirm or push back ("does that land, or am I off?"). A true read can be wrong; a horoscope can't — and their correction makes you sharper.
• CALIBRATED to the evidence you actually have: tentative on a couple of notes, firmer when the pattern repeats — and say which.
• NO Barnum: never a vague, universal, or flattering line that could apply to anyone ("you have a deep need to be understood"). If you can't point to the specific memories behind it, ask instead of asserting.
• SCAFFOLD over spoon-feeding: offer the next useful question, the relevant memory, or the smaller step rather than only a finished answer.
• For a behaviour they want to change, help them form an "if [cue], then [action]" plan tied to a real trigger — not generic encouragement.
• You NOTICE patterns; you never DIAGNOSE — no clinical labels (ADHD, depression, a disorder).`;

  if (chosen.length > 0) {
    systemExtra +=
      "\n\nAVAILABLE MODES — the user configured these custom roles/goal-sets for you. " +
      "Adopt the ONE (or few) that genuinely FIT what they just said, and fully commit " +
      "to it when you do (its tone, focus, method — e.g. if they invoke an 'IQ test' role, " +
      "actually run it). Do NOT cram every mode into every reply, and do NOT name-drop or " +
      "reference a role that doesn't fit the current message — if none fit, just be yourself. " +
      "In `usedRoles`, list the exact name(s) of any role you actually applied this turn " +
      "(empty if none):\n" +
      chosen.map((p, i) => `${i + 1}. ${p.name}: ${p.body}`).join("\n\n");
  }

  // "About Me" awareness (auto-derived; she's aware of who you are, never becomes you).
  const persona = refreshPersona(h, spaceId) || undefined;

  return { systemExtra, persona, chosenProfiles: chosen };
}
