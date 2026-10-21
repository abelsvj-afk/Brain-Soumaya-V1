import type { ExtractionResult, RelationshipType, FinExtractionResult, PaystubExtractionResult, ClarificationInterpretation, GalaxyNavigationKind, GalaxyNavigationCandidate, InteractionPreferenceSignal } from "@brain/shared";

// Re-exported so consumers can name these contract types via the adapter
// module (the LlmProvider methods below return them).
export type { ExtractionResult, ClarificationInterpretation } from "@brain/shared";

/** A previously-stored node passed to the LLM as context for extraction. */
export interface ContextNode {
  id: number;
  label: string;
  type: string;
  content: string;
  /** When the memory happened (falls back to creation time) — lets the model reason
   *  about recency ("that was 3 weeks ago") instead of treating every memory as "now". */
  occurredAt?: string;
}

/** Two candidate endpoints for an associative link decision. */
export interface LinkCandidate {
  label: string;
  content: string;
}

export interface LinkValidation {
  linked: boolean;
  relationship?: RelationshipType;
  /** 0..1 confidence/strength for the edge. */
  weight?: number;
}

/** Verdict from contradiction detection over two same-topic memories. */
export interface ContradictionResult {
  /** True when the two memories genuinely conflict. */
  conflict: boolean;
  /** One-line reconciliation hypothesis (why they diverge / how to resolve). */
  text: string;
  /** 0..1 — how sharp/important the contradiction is. */
  score: number;
}

/**
 * Extra steering layered onto a chat answer (the AI Companion system). All
 * optional so the offline heuristic + existing 2-arg test fakes stay valid.
 */
export interface AnswerOptions {
  /** Soumaya's soul (soul.md body) — deeper character injected into the identity slot. */
  soul?: string;
  /** Blended, priority-ordered active custom instruction profiles (Layer 2). */
  systemExtra?: string;
  /** "About Me": who the user is. Soumaya is AWARE of this, never becomes them. */
  persona?: string;
  /** The space's IANA timezone (space_meta.timezone) — grounds the system
   *  prompt's "now" in the user's local day (date/time accuracy).
   *  `undefined` → the caller supplies no zone (historical UTC-only
   *  rendering, kept for existing callers); `null` → the caller TRIED to
   *  resolve the space's zone and genuinely could not (Packages E2/E7) —
   *  the prompt renders the explicit "local time unavailable" line, never
   *  the UTC rendering, and memory relative-date tags are omitted rather
   *  than computed against an assumed zone. */
  timezone?: string | null;
  /** Retrieved knowledge-document chunks, pre-formatted with doc names. */
  knowledge?: string;
  /** Text the user attached to THIS chat message (in-chat attachment, IM-106),
   *  pre-formatted with file names. One-turn only: never stored, never part of
   *  the knowledge library — it grounds this reply the way a shown document
   *  would. Absent on every non-web-chat caller (agent loop, Telegram). */
  attachments?: string;
  /** Recent conversation turns, pre-formatted ("User: …\nSoumaya: …") — WITHOUT
   *  this every reply is an amnesiac one-shot, which read as "generic chatbot". */
  history?: string;
  /** True when her PREVIOUS turn already ended in a question — hard-forces no
   *  askBack this turn so she can't interrogate the user in a loop. */
  justAsked?: boolean;
  /** Maya Chat → Galaxy Navigation: a small, bounded, id-tagged list of Journeys/Bills/Goals
   *  the model MAY propose navigating to if genuinely relevant — she may choose ONLY from this
   *  exact list, never an arbitrary/invented id. Absent/empty when nothing exists to offer. */
  galaxyCandidates?: { kind: GalaxyNavigationKind; id: number; label: string }[];
}

/** Structured chat reply: the answer plus its emotional register and (optionally)
 *  one clarifying question she asks back instead of guessing (interview instinct). */
export interface AnswerResult {
  answer: string;
  citations: number[];
  mood?: string;
  askBack?: string;
  /** Names of the custom roles she ACTUALLY adopted this turn (she picks the
   *  fitting one(s); empty when none applied) — drives the honest applied chips. */
  usedRoles?: string[];
  /** Maya Chat → Galaxy Navigation: UNTRUSTED candidate(s) she proposed navigating to, in her
   *  own preferred order — NEVER authoritative. The caller resolves the first one that
   *  validates via `resolveGalaxyEntity` (analysis/galaxyEntity.ts) into
   *  `ChatResponse.navigation`; everything else is discarded. Absent/empty = no proposal. */
  navigationCandidates?: GalaxyNavigationCandidate[];
  /** Maya Longitudinal Intelligence, Phase H: an UNTRUSTED proposal that the user's message
   *  itself explicitly stated a durable communication preference — never authoritative on its
   *  own. The caller (`chat/graphrag.ts`) only ever treats this as ONE piece of evidence toward
   *  a deterministically-accumulated preference (`analysis/interactionPreferences.ts`); it never
   *  changes behavior directly. null/undefined = no such statement this turn (the common case). */
  interactionPreferenceSignal?: InteractionPreferenceSignal | null;
}

/**
 * LlmProvider is the structured-reasoning seam. Gemini is the default; OpenAI
 * is a drop-in alternate; the heuristic provider keeps everything working with
 * no API key. `available` is false for the heuristic fallback so callers can
 * surface "LLM typing inactive" state.
 */
export interface LlmProvider {
  readonly available: boolean;
  readonly model: string;
  /** True when a cloud provider has fallen back to offline heuristic (credit/quota). */
  readonly degraded?: boolean;
  /** WHY it's degraded, when `degraded` is true — null/undefined otherwise. */
  readonly degradedReason?: DegradeReason | null;
  /** WHY the most recent answer() call fell back to the offline heuristic, or
   *  null when it was served by the cloud (or no answer has run yet). Set by
   *  ResilientLlmProvider per call — including single-call fallbacks that do
   *  NOT trip the cooldown and so never show up in `degradedReason`. */
  readonly lastAnswerDegradedReason?: AnswerDegradeReason | null;
  /** Parse raw text into typed nodes + edges, grounded in existing context. */
  extract(text: string, context: ContextNode[]): Promise<ExtractionResult>;
  /** Decide whether a semantic neighbour should become a formal graph edge. */
  validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
    // D4: additive cancellation. When provided, the provider MUST thread
    // `signal` into the actual transport operation (the fetch/SDK call), so
    // aborting it tears down the underlying work — a wrapper-only timeout is
    // not sufficient. Offline providers may ignore it (no I/O to stop).
    opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation>;
  /** Write a short insight about a latent (semantically near, graph-distant) pair. */
  synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }>;
  /** Judge whether two same-topic memories CONTRADICT (conflicting belief/goal/identity).
   *  Returns the verdict + a one-line reconciliation hypothesis and a 0..1 sharpness score.
   *  Implemented on every provider (offline heuristic included), so it's always available. */
  detectContradiction(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<ContradictionResult>;
  /** Judge whether a new chat message ANSWERS a pending clarification question Maya asked
   *  earlier, and if so extract it as a plain declarative statement (docs/specs/
   *  maya-intelligence-architecture.md, Part I2). Implemented on every provider (offline
   *  heuristic included) so the lifecycle always works, same precedent as `detectContradiction`.
   *  Must be conservative: prefer `answers:false` over misreading an unrelated message. */
  interpretClarificationAnswer(question: string, userMessage: string): Promise<ClarificationInterpretation>;
  /** Answer a question grounded in a retrieved subgraph; cite node ids. */
  answer(question: string, context: ContextNode[], opts?: AnswerOptions): Promise<AnswerResult>;
  /** Perform autonomous research on a single node to expand the knowledge base. */
  research(node: LinkCandidate, userAnswers?: string): Promise<{ label: string; content: string; questions?: string[] }>;
  /** Generate a vibe description for a cluster of nodes. */
  summarizeSector(nodes: LinkCandidate[]): Promise<string>;
  /** Optional: richer LLM-authored lore prose. Absent on the heuristic provider
   *  (the lore engine's offline chronicler is the always-available fallback). */
  chronicle?(subject: string, context: string): Promise<string>;
  /** Optional: pick the best next maintenance job from candidate options, given a
   *  brain summary. Returns the chosen index. Absent on heuristic → the deterministic
   *  ladder decides (the always-available fallback). */
  planJob?(summary: string, options: { type: string; objective: string }[]): Promise<number>;
  /** Optional: distill a finished conversation into 0–3 memory-worthy notes. Absent
   *  on heuristic → the caller falls back to a simple extraction. */
  distill?(transcript: string): Promise<string[]>;
  /** Optional: consolidate a cluster of related memories into ONE durable belief
   *  statement about the user (dream cycles). Absent on heuristic → the caller's
   *  template fallback runs. */
  consolidate?(nodes: LinkCandidate[]): Promise<{ belief: string; confidence: number }>;
  /** Generate a daily log of the brain's evolution. `persona` = optional About-Me
   *  awareness (who the user is / how to communicate with them — behavior guidance,
   *  learned preferences). `soul` = optional Soumaya identity text (soul.md), injected
   *  under its OWN correctly-labeled slot — never blended into `persona`'s "about the
   *  user" framing, so Soumaya's own voice is never mistaken for a user fact. */
  generateDailyLog(newNodes: LinkCandidate[], actions: string[], persona?: string, soul?: string): Promise<string>;
  /** Optional: look up LIVE information on the web (grounded search) and return a
   *  concise answer with source URLs. Absent/returns null when unavailable (no key,
   *  offline, or blocked) — the web-lookup tool then simply does nothing. */
  webLookup?(query: string): Promise<WebLookupResult | null>;
  /** Optional: the agentic tool-router's brain. Given a state briefing and the
   *  DETERMINISTIC candidate tool-invocations this tick, choose which indices to
   *  actually execute (curate for value + avoid noise). Returns the chosen indices.
   *  Absent → the router runs every candidate (the always-available deterministic path). */
  route?(briefing: string, candidates: { tool: string; reason: string }[]): Promise<number[]>;
  /** Optional: function-calling for the agent loop (Phase 1). Given the
   *  conversation and provider-neutral tool definitions, returns either final
   *  text or the tool calls the model wants. The provider translates the
   *  definitions into its native format; a tool whose schema the provider
   *  cannot express is EXCLUDED (with a log line), never silently mis-translated.
   *  Implemented on Gemini + OpenAI; the heuristic provider answers from text
   *  with no calls (offline). Absent → the caller falls back to plain chat. */
  callWithTools?(input: LlmToolCallInput): Promise<LlmToolResult>;
  /** Optional: read a financial screenshot/PDF (pay stub, earnings, bank txns) and extract
   *  DRAFT income/expense candidates (Financial OS Stage 1c). Absent on the heuristic/offline
   *  provider and returns null on any failure → the ingest route degrades to manual entry, so
   *  no feature ever hard-depends on a vision key. */
  extractFinancialImage?(image: { dataUrl: string; mime: string }): Promise<FinExtractionResult | null>;
  /** Optional: read pay-stub TEXT (from extractFileText's client-side PDF/DOCX conversion —
   *  docs/specs/paystub-ingestion.md) and return a comprehensive extraction — every earnings
   *  and deduction line, not a curated subset, generalized beyond hourly/salary. Absent on
   *  the heuristic/offline provider; the ingest layer falls back to a dedicated regex parser
   *  (ocr/paystubHeuristic.ts) so pay-stub text extraction always works offline. Returns null
   *  on any failure. */
  extractPaystub?(text: string): Promise<PaystubExtractionResult | null>;
  /** Optional: the same comprehensive extraction as `extractPaystub`, from a photographed
   *  paper stub or a screenshot instead of text. Absent on the heuristic/offline provider —
   *  the ingest layer degrades to an empty draft the user fills in manually (same shape as
   *  `extractFinancialImage`'s degrade path). Returns null on any failure. */
  extractPaystubImage?(image: { dataUrl: string; mime: string }): Promise<PaystubExtractionResult | null>;
}

/** A grounded web-lookup result: a concise answer plus the source URLs it cited. */
export interface WebLookupResult {
  text: string;
  sources: string[];
}

/**
 * Phase 1 agent loop: provider-neutral tool definition. The registry owns the
 * definitions; providers translate them into their native function-calling
 * format. Providers NEVER define tools.
 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) for the arguments object. */
  parameters: Record<string, unknown>;
}

/** One function call the model requested. */
export interface LlmToolCall {
  /** Opaque id for correlating this call with its result. */
  id: string;
  name: string;
  /** Already-parsed arguments object. */
  args: Record<string, unknown>;
}

/** A message in the agent-loop conversation (provider-neutral). */
export type LlmLoopMessage =
  | { role: "user"; text: string }
  // "model" messages may carry toolCalls when the assistant requested tool
  // execution. Providers like OpenAI REQUIRE the assistant tool_calls message
  // to precede the corresponding "tool" messages — a "tool" role message
  // without it is a 400 error. Always push this before tool results.
  | { role: "model"; text: string | null; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: string };

/** Result of one callWithTools invocation: final text OR requested calls. */
export interface LlmToolResult {
  /** Set when the model answered directly (calls is empty). */
  text: string | null;
  /** Requested tool calls (empty when text is set). */
  calls: LlmToolCall[];
}

/** Input for one callWithTools invocation. */
export interface LlmToolCallInput {
  systemInstruction: string;
  messages: LlmLoopMessage[];
  tools: LlmToolDefinition[];
  signal?: AbortSignal;
}

export type LlmProviderKind = "gemini" | "openai" | "heuristic";

/** Why a cloud provider is currently degraded (see `ResilientLlmProvider.degradedReason`
 *  in resilient.ts) — `"budget"` is this app's own spend cap, distinct from the cloud
 *  provider's own quota/billing/auth state. Surfaced through `/api/health` so "it's not
 *  working" has an actual, actionable answer instead of one generic message. */
export type DegradeReason = "auth" | "quota" | "timeout" | "budget";

/** Why ONE answer() call was served by the offline fallback (Finding 2):
 *  DegradeReason, plus "error" for a cloud failure that fits no named
 *  category (a non-fatal error degrades a single call without tripping the
 *  provider-wide cooldown, so `degradedReason` stays null for it — this
 *  per-call record is how chat() still learns the truth about THAT turn). */
export type AnswerDegradeReason = DegradeReason | "error";

export interface LlmProviderOptions {
  kind?: LlmProviderKind;
  /** Called with token usage after each successful cloud call (for the budget meter). */
  recordUsage?: (model: string, inputTokens: number, outputTokens: number) => void;
  /** When it returns true, calls skip the cloud and use the heuristic (budget hit). */
  isOverBudget?: () => boolean;
}

/**
 * Construct the configured LLM provider, falling back to the heuristic provider
 * when the relevant API key is missing.
 */
export async function createLlmProvider(opts: LlmProviderOptions = {}): Promise<LlmProvider> {
  const kind = opts.kind;
  // Accept any reasonable env-var name for the key (OPENAI_API_KEY, OPENAI_API,
  // and any case variant a Fly secret might use, e.g. openai_api).
  const findKey = (re: RegExp): string | undefined => {
    for (const [k, v] of Object.entries(process.env)) {
      if (v && re.test(k)) return v;
    }
    return undefined;
  };
  const openaiKey =
    process.env.OPENAI_API_KEY ?? process.env.OPENAI_API ?? findKey(/openai.*(api|key)/i);
  const geminiKey = process.env.GEMINI_API_KEY ?? findKey(/gemini.*(api|key)/i);

  // OpenAI takes FIRST precedence: whenever an OpenAI key is present it's chosen,
  // even over a stale LLM_PROVIDER=gemini secret — so you don't have to unset an
  // old env var to switch. An explicit `kind` (tests / callers) still wins, and
  // LLM_PROVIDER only decides when NO key resolves a provider on its own.
  const resolved: LlmProviderKind =
    kind ??
    (openaiKey
      ? "openai"
      : geminiKey
        ? "gemini"
        : ((process.env.LLM_PROVIDER as LlmProviderKind) ?? "heuristic"));

  // Cloud providers are wrapped so they degrade to the offline heuristic on
  // credit/quota/auth errors instead of taking the whole app down.
  if (resolved === "gemini" && geminiKey) {
    const { GeminiProvider } = await import("./gemini.js");
    const { ResilientLlmProvider } = await import("./resilient.js");
    return new ResilientLlmProvider(
      new GeminiProvider(geminiKey, opts.recordUsage),
      undefined,
      undefined,
      opts.isOverBudget,
    );
  }
  if (resolved === "openai" && openaiKey) {
    const { OpenAiProvider } = await import("./openai.js");
    const { ResilientLlmProvider } = await import("./resilient.js");
    return new ResilientLlmProvider(
      new OpenAiProvider(openaiKey, opts.recordUsage),
      undefined,
      undefined,
      opts.isOverBudget,
    );
  }
  const { HeuristicProvider } = await import("./heuristic.js");
  return new HeuristicProvider();
}
