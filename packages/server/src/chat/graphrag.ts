import { type ChatMood, type ChatResponse, type NodeRef, CHAT_MOODS, toneFrom } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { knn, knnDocs, knnProfiles } from "../db/vec.js";
import { keywordSearch, fuseRrf } from "../db/fts.js";
import { multiHopNeighbors } from "../graph/traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { InstructionProfilesRepo } from "../repositories/instructions.repo.js";
import { KnowledgeRepo } from "../repositories/knowledge.repo.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import { refreshPersona } from "../persona/derive.js";
import { deriveBehavior } from "../persona/behavior.js";
import { soulTextFor, getGroundedInsight } from "../identity.js";
import { financialSnapshotText } from "../finance/snapshot.js";
import { peopleSnapshotText } from "../analysis/people.js";
import { cognitiveSnapshotText } from "../analysis/cognitive.js";
import { temporalSnapshotText } from "../analysis/temporalContext.js";
import { intelligenceSnapshotText } from "../analysis/intelligence.js";
import { emotionalSnapshotText } from "../analysis/emotional.js";
import { interactionPreferenceSnapshotText, recordPreferenceSignal } from "../analysis/interactionPreferences.js";
import { resolveClarificationFromMessage } from "../analysis/clarificationResolution.js";
import { proactiveContextSnapshotText, type ProactiveContextInput } from "../analysis/proactiveContext.js";
import { buildNavigationCandidateList, resolveNavigationIntent } from "../analysis/galaxyEntity.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { UsageTracker } from "../usage.js";
import { EconomyRepo } from "../economy.js";
import { getPreferences } from "../agent/notify/policy.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";

export interface ChatOptions {
  /** Semantic seed nodes from KNN. */
  k: number;
  /** Hops to expand around each seed (the GraphRAG neighborhood step). */
  depth: number;
  /** Knowledge-document chunks to retrieve (AI Companion RAG). */
  kDocs: number;
}

export const DEFAULT_CHAT: ChatOptions = { k: 6, depth: 1, kDocs: 4 };

/** Min similarity for an 'auto' instruction profile to be intent-routed in. */
const AUTO_PROFILE_THRESHOLD = 0.35;
/** A knowledge-doc chunk must be at least this related to the message to be
 *  injected — otherwise docs leak into every reply regardless of topic. */
const KNOWLEDGE_THRESHOLD = 0.3;
// Explicit Journey-scoped retrieval experiment (docs/specs/journey-aware-retrieval-experiment.md,
// following the measured Class B gap in docs/specs/journey-aware-retrieval-audit.md). A Journey's
// own `journey_link`-linked memory ids never enter GraphRAG's seed->hop candidate set on their
// own — this is the one additive candidate source, gated on an EXPLICIT, caller-supplied
// journeyId (never inferred from question text; the audit's own ambiguity finding argues
// directly against free-text Journey guessing). Cap picked deliberately close to (but distinct
// from) opts.k(=6) — a Journey's own story is a real, bounded signal, not license to dump its
// entire history into every turn; 8 is enough to plausibly span early/mid/late memories (the
// audit's own temporal scenario used 3) without meaningfully growing the context budget.
const JOURNEY_CANDIDATE_CAP = 8;

/**
 * GraphRAG: embed the question -> KNN seeds -> expand neighborhoods via recursive
 * CTE -> assemble subgraph context -> LLM answers with node citations.
 */
export async function chat(
  h: DbHandle,
  deps: { embeddings: EmbeddingProvider; llm: LlmProvider },
  question: string,
  opts: ChatOptions = DEFAULT_CHAT,
  spaceId: string = DEFAULT_SPACE,
  /** Recent turns (oldest first) so the reply continues the thread instead of
   *  starting an amnesiac one-shot — the #1 "she feels generic" cause. */
  history: { role: "you" | "soumaya"; text: string }[] = [],
  /**
   * Explicit Journey-scoped retrieval experiment. ONLY set when the caller has a verified
   * Journey the user actually selected (e.g. a future "ask about this Journey" UI) — never
   * inferred from `question`'s text. `null`/omitted (the default, every existing caller)
   * reproduces prior behavior exactly: zero extra repository reads, zero extra candidates.
   */
  journeyId: number | null = null,
  /**
   * Proactive → Chat handoff (Phase Y, docs/specs/soumaya-proactive-chat-handoff.md).
   * Set ONLY when the user opened Chat from a real proactive delivery (e.g. Phase X's
   * goal_trend toast) — never inferred from `question`'s text, same discipline as
   * `journeyId` above. `analysis/proactiveContext.ts` re-validates it against THIS
   * space's real data and re-derives the SAME existing intelligence that triggered the
   * proactive event; an invalid/stale/cross-space value silently contributes nothing,
   * never an error, never a broken turn.
   */
  proactiveContext: ProactiveContextInput | null = null,
): Promise<ChatResponse> {
  const vec = await deps.embeddings.embed(question);
  // Hybrid seeds: vector KNN fused with BM25 keyword hits (RRF) — questions that
  // name a person/place/thing verbatim now reliably pull the right memories even
  // when the embedding misses them.
  const vecSeeds = knn(h.sqlite, vec, opts.k, spaceId);
  const kwSeeds = keywordSearch(h.sqlite, spaceId, question, opts.k);
  const seedIds = fuseRrf(vecSeeds, kwSeeds, opts.k);

  const ids = new Set<number>();
  for (const sid of seedIds) {
    ids.add(sid);
    for (const hop of multiHopNeighbors(h.sqlite, sid, opts.depth)) ids.add(hop.nodeId);
  }

  // Explicit Journey-scoped candidates — additive only, never a replacement for the retrieval
  // above. `JourneysRepo.get` is space-scoped (returns null for a wrong-space or nonexistent
  // id), so an invalid/cross-space journeyId silently contributes nothing rather than leaking
  // another space's linked memories or breaking the turn — same "best-effort, never break chat"
  // contract every other snapshot in this function already follows. `ids` is a Set, so a linked
  // memory already surfaced by ordinary retrieval is a no-op add — deduplication is free here,
  // not a separate mechanism. Ranking is untouched: these ids join the SAME candidate pool the
  // seed/hop ids already populate, then flow through the existing, unmodified context-assembly
  // and LLM-citation path below exactly like any other candidate.
  if (journeyId != null) {
    const journeysRepo = new JourneysRepo(h, spaceId);
    if (journeysRepo.get(journeyId)) {
      const linkedNodeIds = journeysRepo
        .links(journeyId)
        .filter((l) => l.kind === "node")
        .slice(0, JOURNEY_CANDIDATE_CAP)
        .map((l) => l.refId);
      for (const id of linkedNodeIds) ids.add(id);
    }
  }

  const nodesRepo = new NodesRepo(h, spaceId);
  const ctxNodes = nodesRepo.byIds([...ids]);
  const context = ctxNodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    content: n.content,
    occurredAt: n.occurredAt ?? n.createdAt,
  }));

  // --- AI Companion layers (reuse the single question embedding `vec`) ---
  // Knowledge-document RAG. RELEVANCE-GATED: only chunks genuinely related to the
  // message are injected, so knowledge docs stop bleeding into every reply when
  // they have nothing to do with the topic.
  const knowledgeRepo = new KnowledgeRepo(h, spaceId);
  const docHits = knnDocs(h.sqlite, vec, opts.kDocs, spaceId).filter(
    (d) => d.similarity >= KNOWLEDGE_THRESHOLD,
  );
  const chunks = knowledgeRepo.chunksByIds(docHits.map((d) => d.chunkId));
  const knowledge =
    chunks.length > 0 ? chunks.map((c) => `[${c.docName}] ${c.content}`).join("\n\n") : undefined;

  // Layer 2: the user's custom instruction profiles are AVAILABLE MODES she may
  // adopt — 'always' are candidates every turn, 'auto' are intent-routed in — but
  // she picks the one(s) that FIT the current message (see the prompt), rather
  // than cramming every active role into every reply.
  const active = new InstructionProfilesRepo(h, spaceId).listActive();
  let routedAuto = new Set<number>();
  if (active.some((p) => p.mode === "auto")) {
    routedAuto = new Set(
      knnProfiles(h.sqlite, vec, 3, spaceId)
        .filter((p) => p.similarity >= AUTO_PROFILE_THRESHOLD)
        .map((p) => p.profileId),
    );
  }
  const chosen = active.filter((p) => p.mode !== "auto" || routedAuto.has(p.id));

  // --- Live Telemetry & App State (for all app tabs/pages context) ---
  const usage = new UsageTracker(h).summary();
  const resilient = deps.llm as any;
  const llmStatus = {
    model: deps.llm.model,
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
${mainHubs.length > 0 ? mainHubs.map((h) => `  * ${h}`).join("\n") : "  * (No high mass hubs cataloged)"}

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
    const intelligence = intelligenceSnapshotText(h, spaceId, undefined, [...ids]);
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
    const emotional = emotionalSnapshotText(h, spaceId, [...ids]);
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
  try {
    const resolved = await resolveClarificationFromMessage(h, deps, question, spaceId);
    if (resolved) {
      systemExtra += `\n\nCLARIFICATION RESOLVED: the user just confirmed "${resolved.confirmedStatement}" — this is now a settled fact, saved to memory. Acknowledge it naturally if it fits; never re-ask the question you just got an answer to.`;
    }
  } catch {
    /* clarification resolution is best-effort; never break chat */
  }

  // Phase Y — proactive → Chat handoff. Same best-effort, null-safe contract as every
  // snapshot above: a failure here (or an invalid/stale/cross-space target) simply
  // adds nothing, never breaks the turn.
  try {
    const proactive = proactiveContextSnapshotText(h, spaceId, proactiveContext);
    if (proactive) systemExtra += `\n\n${proactive}`;
  } catch {
    /* proactive context is best-effort; never break chat */
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

  // Short-term conversational memory: the last few turns, oldest first, trimmed
  // so a long chat can't blow up the prompt.
  const turns = history.slice(-8).map((m) => {
    const text = m.text.length > 600 ? `${m.text.slice(0, 597)}…` : m.text;
    return `${m.role === "you" ? "User" : "Soumaya"}: ${text}`;
  });

  // Did HER last turn already ask something? Detected from history (robust — no
  // reliance on the client): if so we HARD-suppress askBack this turn so she can
  // never interrogate in a loop.
  const lastSoumaya = [...history].reverse().find((m) => m.role === "soumaya");
  const justAsked = !!lastSoumaya && lastSoumaya.text.trim().endsWith("?");

  // Maya Chat → Galaxy Navigation (Model C) — a small, bounded, id-tagged candidate list
  // (a few of the user's own active Journeys/Goals/Bills) she MAY propose navigating to.
  // Cheap (three already-small repo reads, same cost class as the snapshots above) and
  // best-effort: if it fails, she simply gets no candidates this turn, never a broken reply.
  let galaxyCandidates: ReturnType<typeof buildNavigationCandidateList> = [];
  try {
    galaxyCandidates = buildNavigationCandidateList(h, spaceId);
  } catch {
    /* candidate list is best-effort; never break chat */
  }

  // Date/time accuracy (audit gap #10): ground her sense of "now" in THIS
  // space's timezone — the same space_meta.timezone quiet hours and the digest
  // use. Without it the prompt's "now" is UTC-only and relative-date reasoning
  // ("tomorrow", "yesterday") skews by hours, worst near the user's midnight.
  // Best-effort: any read failure leaves the UTC fallback in place.
  let timezone: string | undefined;
  try {
    timezone = getPreferences(h.sqlite, spaceId).timezone;
  } catch {
    timezone = undefined;
  }

  const raw = await deps.llm.answer(question, context, {
    soul: soulTextFor(h.sqlite, spaceId) || undefined,
    timezone,
    systemExtra,
    persona,
    knowledge,
    history: turns.length > 0 ? turns.join("\n") : undefined,
    justAsked,
    galaxyCandidates: galaxyCandidates.length > 0 ? galaxyCandidates : undefined,
  });
  const { answer, citations, mood } = raw;

  // Maya Longitudinal Intelligence, Phase H — record any NEW preference evidence this message
  // just produced. Best-effort, never blocks/breaks the reply; a single mention never changes
  // future behavior by itself (analysis/interactionPreferences.ts enforces the evidence bar).
  if (raw.interactionPreferenceSignal) {
    try {
      recordPreferenceSignal(h, spaceId, raw.interactionPreferenceSignal.signal, raw.interactionPreferenceSignal.value);
    } catch {
      /* preference recording is best-effort; never break chat */
    }
  }
  // Belt to the prompt's rule: if she just asked, drop any askBack she still
  // produced — she must respond with substance, not another question.
  const askBack = justAsked ? undefined : raw.askBack;

  // The model's `navigationCandidates` are UNTRUSTED proposals (kind+id only, no reason, no
  // domain) — `resolveNavigationIntent` is the sole authority: it independently re-resolves
  // each one, space-scoped, in the model's own preferred order, and returns the first real
  // match's descriptor-derived `NavigationIntent`, or nothing at all. A raw LLM id NEVER
  // reaches `ChatResponse` directly — only what this validation step actually confirms exists.
  let navigation: ChatResponse["navigation"];
  try {
    navigation = resolveNavigationIntent(h, spaceId, raw.navigationCandidates) ?? undefined;
  } catch {
    /* navigation resolution is best-effort; never break chat */
  }

  const refById = new Map<number, NodeRef>(
    ctxNodes.map((n) => [n.id, { id: n.id, label: n.label, type: n.type }]),
  );
  const validCitations = citations
    .map((id) => refById.get(id))
    .filter((x): x is NodeRef => x !== undefined);

  // Dramatization: the cited memories anchor *what this is about* (their averaged
  // emotional weight), her answer's wording captures *how she's phrasing it* —
  // blended into a delivery tone the client uses to keep her voice from going flat.
  const cited = ctxNodes.filter((n) => citations.includes(n.id));
  const weighted = (cited.length > 0 ? cited : ctxNodes).filter(
    (n) => typeof n.emotionalWeight === "number",
  );
  const avgEw =
    weighted.length > 0
      ? weighted.reduce((s, n) => s + (n.emotionalWeight ?? 0), 0) / weighted.length
      : undefined;
  const tone = toneFrom(answer, avgEw);

  const validMood = (CHAT_MOODS as readonly string[]).includes(mood ?? "")
    ? (mood as ChatMood)
    : undefined;
  // HONEST applied chips: only the roles she ACTUALLY adopted this turn (from her
  // own report), not every active profile — so the chips stop implying she used
  // all of them on every reply. Fall back to none if she reported nothing.
  const activeNames = new Set(chosen.map((p) => p.name));
  const appliedRoles = (raw.usedRoles ?? []).filter((n) => activeNames.has(n));
  const appliedDocs = [...new Set(chunks.map((c) => c.docName))]; // already relevance-gated
  return {
    answer,
    citations: validCitations,
    contextIds: [...ids],
    tone,
    mood: validMood,
    askBack,
    appliedRoles,
    appliedDocs,
    navigation,
  };
}
