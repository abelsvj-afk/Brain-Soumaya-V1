import { type ChatDegradedReason, type ChatMood, type ChatResponse, type NodeRef, CHAT_MOODS, toneFrom } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { knn, knnDocs } from "../db/vec.js";
import { keywordSearch, fuseRrf } from "../db/fts.js";
import { multiHopNeighbors } from "../graph/traversal.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { KnowledgeRepo } from "../repositories/knowledge.repo.js";
import { soulTextFor } from "../identity.js";
import { recordPreferenceSignal } from "../analysis/interactionPreferences.js";
import { type ProactiveContextInput } from "../analysis/proactiveContext.js";
import { buildNavigationCandidateList, resolveNavigationIntent } from "../analysis/galaxyEntity.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { getPreferences } from "../agent/notify/policy.js";
import { buildCompanionContext } from "./companionContext.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { AnswerResult, LlmProvider } from "../llm/adapter.js";
import { HeuristicProvider } from "../llm/heuristic.js";

export interface ChatOptions {
  /** Semantic seed nodes from KNN. */
  k: number;
  /** Hops to expand around each seed (the GraphRAG neighborhood step). */
  depth: number;
  /** Knowledge-document chunks to retrieve (AI Companion RAG). */
  kDocs: number;
}

export const DEFAULT_CHAT: ChatOptions = { k: 6, depth: 1, kDocs: 4 };

/**
 * Finding 8: a chat turn has a real end-to-end budget. The embedding step is
 * time-boxed on its own (a hung embed used to hang the whole turn forever —
 * it runs BEFORE the answer call, outside the resilient provider's timeout);
 * the whole turn then has a deadline after which it completes as a degraded
 * offline reply (flagged, Finding 2) instead of hanging until the provider's
 * 20s timeout or the client's old 60s cap. Both are env-overridable for tests
 * and ops, with production defaults of 2.5s / 9s.
 */
export const CHAT_EMBED_TIMEOUT_MS = Number(process.env.CHAT_EMBED_TIMEOUT_MS ?? 2_500);
export const CHAT_TURN_DEADLINE_MS = Number(process.env.CHAT_TURN_DEADLINE_MS ?? 9_000);

/** Race a promise against a deadline; rejects with a plain Error on timeout
 *  (the loser keeps running in the background — callers only use this for
 *  steps whose late result can be safely discarded). */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
  /**
   * In-chat attachments (IM-106): files the user attached to THIS message in
   * the web chat, already extracted to text client-side. One-turn context only
   * — never stored, never embedded into retrieval (the question alone drives
   * retrieval, so an attachment can't drag in unrelated memories), just shown
   * to the model as something the user shared right now. `null`/omitted (the
   * default, every existing caller incl. Telegram/agent paths) = prior
   * behaviour exactly.
   */
  attachments: { name: string; text: string }[] | null = null,
): Promise<ChatResponse> {
  const turnStart = Date.now();
  // Finding 8: the embedding step is time-boxed. On timeout/failure the turn
  // proceeds DEGRADED with keyword-only retrieval (vec = null → no vector
  // seeds, no doc RAG) rather than hanging or failing — and the reply is
  // flagged so the client can say so (Finding 2).
  let vec: Float32Array | null = null;
  let embedFailure: "timeout" | "error" | null = null;
  try {
    vec = await withDeadline(deps.embeddings.embed(question), CHAT_EMBED_TIMEOUT_MS, "chat embedding");
  } catch (err) {
    embedFailure = err instanceof Error && err.message.includes("timed out") ? "timeout" : "error";
  }
  // Hybrid seeds: vector KNN fused with BM25 keyword hits (RRF) — questions that
  // name a person/place/thing verbatim now reliably pull the right memories even
  // when the embedding misses them.
  const vecSeeds = vec ? knn(h.sqlite, vec, opts.k, spaceId) : [];
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
  const docHits = (vec ? knnDocs(h.sqlite, vec, opts.kDocs, spaceId) : []).filter(
    (d) => d.similarity >= KNOWLEDGE_THRESHOLD,
  );
  const chunks = knowledgeRepo.chunksByIds(docHits.map((d) => d.chunkId));
  const knowledge =
    chunks.length > 0 ? chunks.map((c) => `[${c.docName}] ${c.content}`).join("\n\n") : undefined;

  // --- Shared companion context (Telegram Parity Phase 0) ---
  // The whole system-context stack — instruction profiles, telemetry with
  // exact counts, behavior, the finance/people/cognitive/temporal/
  // intelligence/emotional snapshots, learned preferences, the
  // grounded-insight discipline block, and the About-Me persona — is built
  // by ONE shared builder (chat/companionContext.ts) that the agent loop
  // (Telegram + /api/chat/agent) also consumes, so the channels cannot
  // drift apart again. chat() passes everything its turn has that the loop
  // does not: the already-computed question embedding (auto-profile
  // routing), the retrieved id set (bounds the intelligence/emotional
  // snapshots), clarification resolution, and the proactive handoff.
  const { systemExtra, persona, chosenProfiles: chosen } = await buildCompanionContext(h, spaceId, {
    questionVec: vec ?? undefined,
    llm: deps.llm,
    retrievedIds: [...ids],
    clarification: { deps, question },
    proactiveContext,
  });

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

  const attachmentText =
    attachments && attachments.length > 0
      ? attachments.map((a) => `[${a.name}]\n${a.text}`).join("\n\n")
      : undefined;
  const answerOpts = {
    soul: soulTextFor(h.sqlite, spaceId) || undefined,
    timezone,
    systemExtra,
    persona,
    knowledge,
    attachments: attachmentText,
    history: turns.length > 0 ? turns.join("\n") : undefined,
    justAsked,
    galaxyCandidates: galaxyCandidates.length > 0 ? galaxyCandidates : undefined,
  };
  // Finding 8: the answer call gets whatever remains of the turn deadline.
  // Past it, the turn completes with the offline heuristic over the SAME
  // retrieved context (fast, local, deterministic) and is flagged degraded —
  // the user gets an honest limited reply in ~the deadline instead of a
  // spinner until the provider's 20s timeout or forever.
  let raw: AnswerResult;
  let turnTimedOut = false;
  const remainingMs = Math.max(1_000, CHAT_TURN_DEADLINE_MS - (Date.now() - turnStart));
  try {
    raw = await withDeadline(deps.llm.answer(question, context, answerOpts), remainingMs, "chat turn");
  } catch {
    turnTimedOut = true;
    raw = await new HeuristicProvider().answer(question, context, answerOpts);
  }
  const { answer, citations, mood } = raw;

  // Finding 2: was THIS reply actually produced by the offline fallback? In
  // priority order — the turn deadline fired; no cloud key exists at all (the
  // heuristic IS the provider); the resilient wrapper served this call from
  // its fallback (per-call record, covers non-cooldown fallbacks); the
  // provider is in an active cooldown; the embedding step failed and
  // retrieval was keyword-only. Absent all of those, this was a real cloud
  // answer and no flag is attached.
  // NOTE the order: the per-call record is checked BEFORE `available` — a
  // fatal error trips the resilient cooldown DURING this call, after which
  // `available` reads false and would misreport the turn as "offline" (no
  // key) when the truth is the recorded quota/auth/timeout reason.
  let degradedReason: ChatDegradedReason | undefined;
  if (turnTimedOut) degradedReason = "timeout";
  else if (deps.llm.lastAnswerDegradedReason) degradedReason = deps.llm.lastAnswerDegradedReason;
  else if (deps.llm.degraded) degradedReason = deps.llm.degradedReason ?? "error";
  else if (deps.llm.available === false) degradedReason = "offline";
  else if (embedFailure) degradedReason = embedFailure;
  const degraded = degradedReason ? { reason: degradedReason } : undefined;

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
    degraded,
  };
}
