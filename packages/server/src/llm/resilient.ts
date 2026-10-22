import type { ExtractionResult, ClarificationInterpretation } from "@brain/shared";
import type { AnswerDegradeReason, AnswerOptions, AnswerResult, ContextNode, ContradictionResult, DegradeReason, LinkCandidate, LinkValidation, LlmProvider, LlmToolCallInput, LlmToolResult } from "./adapter.js";
import { HeuristicProvider } from "./heuristic.js";

/**
 * Out-of-credit / quota / auth / hang errors — retrying just wastes time. Categorized
 * (not just a boolean) so the UI can tell "your API key is wrong" (auth — a
 * configuration problem, fix the key) apart from "you're out of credit" (quota — a
 * billing problem, same fix either way just recharge) apart from "the API is slow
 * right now" (timeout — often transient, no action needed). Order matters: check
 * auth before the broader 401/403 status-code check groups them under, since an
 * invalid-key message should win over a generic "unauthorized" status match.
 */
function classifyFatalError(err: unknown): DegradeReason | null {
  const s = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/unauthor|invalid api key|401|403/.test(s)) return "auth";
  if (/quota|insufficient|exceeded|billing|payment|credit|429/.test(s)) return "quota";
  if (/timed out/.test(s)) return "timeout";
  return null;
}

/** Reject if a promise doesn't settle in time — stops a hung API call from freezing ingest. */
function withTimeout<T>(p: Promise<T>, ms: number, op: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${op} timed out`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Wraps a cloud LLM so the brain never goes down when the API does. On any error
 * it transparently falls back to the offline heuristic for that call. On a
 * credit/quota/auth error it trips a cooldown and stops calling the cloud
 * entirely for a while — so a $5 key that runs dry degrades gracefully instead of
 * erroring on every ingest (and stops burning failed requests).
 */
export class ResilientLlmProvider implements LlmProvider {
  readonly model: string;
  private readonly fallback = new HeuristicProvider();
  private disabledUntil = 0;
  /** The category from the LAST caught error that tripped the cooldown — stale once
   *  a new cooldown period starts, cleared implicitly since `degradedReason` only
   *  reads it while `disabledUntil` is still in the future. */
  private lastFatalReason: DegradeReason | null = null;
  constructor(
    private readonly primary: LlmProvider,
    private readonly cooldownMs = Number(process.env.LLM_COOLDOWN_MS ?? 10 * 60_000),
    private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 20_000),
    private readonly isOverBudget?: () => boolean,
  ) {
    this.model = primary.model;
  }

  /** Skip the cloud (use heuristic) on cooldown OR when the spend budget is hit. */
  private get blocked(): boolean {
    return Date.now() < this.disabledUntil || !!this.isOverBudget?.();
  }

  /** True while we're in cloud mode; false once blocked (so callers/health can show it). */
  get available(): boolean {
    return this.primary.available && !this.blocked;
  }

  /** Surfaced in /api/health so the UI can say "offline mode (saving credit)". */
  get degraded(): boolean {
    return this.primary.available && this.blocked;
  }

  /** WHY it's degraded, when it is — this app's own spend cap takes precedence in the
   *  read since it's checked live (not a one-time cooldown), so it always reflects the
   *  CURRENT cause rather than whatever tripped the cooldown earlier. */
  get degradedReason(): DegradeReason | null {
    if (!this.degraded) return null;
    if (this.isOverBudget?.()) return "budget";
    return this.lastFatalReason;
  }

  private note(err: unknown, op: string): void {
    const reason = classifyFatalError(err);
    if (reason) {
      this.disabledUntil = Date.now() + this.cooldownMs;
      this.lastFatalReason = reason;
      console.warn(
        `[llm] ${op}: ${reason} error — using offline heuristic for ${Math.round(
          this.cooldownMs / 60000,
        )}m`,
      );
    } else {
      console.warn(`[llm] ${op}: ${err instanceof Error ? err.message : err} — heuristic this call`);
    }
  }

  async extract(text: string, context: ContextNode[]): Promise<ExtractionResult> {
    if (this.blocked) return this.fallback.extract(text, context);
    try {
      return await withTimeout(this.primary.extract(text, context), this.timeoutMs, "extract");
    } catch (err) {
      this.note(err, "extract");
      return this.fallback.extract(text, context);
    }
  }

  async validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
    opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation> {
    if (this.blocked) return this.fallback.validateLink(source, target, similarity, opts);
    // D4: link the caller's signal to a local controller so that OUR timeout
    // also aborts the underlying provider call. Without this, the withTimeout
    // race below would reject the wrapper while the real fetch kept running —
    // a timed-out call holding its socket while its freed slot admits new
    // work, violating the aggregate in-flight bound physically.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts?.signal?.addEventListener("abort", onAbort);
    try {
      try {
        return await withTimeout(
          this.primary.validateLink(source, target, similarity, { signal: controller.signal }),
          this.timeoutMs,
          "validateLink",
        );
      } catch (err) {
        // Our timeout (or the caller's abort) fired: tear down the underlying
        // provider call before falling back — never orphan it.
        controller.abort();
        this.note(err, "validateLink");
        return this.fallback.validateLink(source, target, similarity, opts);
      }
    } finally {
      opts?.signal?.removeEventListener("abort", onAbort);
    }
  }

  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    if (this.blocked) return this.fallback.synthesize(a, b, similarity);
    try {
      return await withTimeout(
        this.primary.synthesize(a, b, similarity),
        this.timeoutMs,
        "synthesize",
      );
    } catch (err) {
      this.note(err, "synthesize");
      return this.fallback.synthesize(a, b, similarity);
    }
  }

  async detectContradiction(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<ContradictionResult> {
    if (this.blocked) return this.fallback.detectContradiction(a, b, similarity);
    try {
      return await withTimeout(
        this.primary.detectContradiction(a, b, similarity),
        this.timeoutMs,
        "detectContradiction",
      );
    } catch (err) {
      this.note(err, "detectContradiction");
      return this.fallback.detectContradiction(a, b, similarity);
    }
  }

  async interpretClarificationAnswer(question: string, userMessage: string): Promise<ClarificationInterpretation> {
    if (this.blocked) return this.fallback.interpretClarificationAnswer(question, userMessage);
    try {
      return await withTimeout(
        this.primary.interpretClarificationAnswer(question, userMessage),
        this.timeoutMs,
        "interpretClarificationAnswer",
      );
    } catch (err) {
      this.note(err, "interpretClarificationAnswer");
      return this.fallback.interpretClarificationAnswer(question, userMessage);
    }
  }

  async answer(
    question: string,
    context: ContextNode[],
    opts?: AnswerOptions,
  ): Promise<AnswerResult> {
    // Audit-2 item 1: the per-call degraded reason travels WITH this call's
    // result (`AnswerResult.degradedReason`), never in shared instance
    // state. This provider is a process-wide singleton, so a mutable
    // last-call field read after an await races under concurrent turns —
    // one turn's Limited-mode flag could land on (or vanish from) another
    // turn's reply. A local + the returned object cannot be swapped.
    if (this.blocked) {
      // Blocked = budget (checked live) or a fatal-error cooldown whose reason
      // was recorded when it tripped; "error" is the honest remainder if a
      // future block source records neither.
      const reason: AnswerDegradeReason = this.isOverBudget?.()
        ? "budget"
        : (this.lastFatalReason ?? "error");
      const result = await this.fallback.answer(question, context, opts);
      return { ...result, degradedReason: reason };
    }
    try {
      const result = await withTimeout(this.primary.answer(question, context, opts), this.timeoutMs, "answer");
      // Explicit null — and a fresh object — so a primary-supplied value can
      // never masquerade as this wrapper's per-call verdict.
      return { ...result, degradedReason: null };
    } catch (err) {
      this.note(err, "answer");
      const reason: AnswerDegradeReason = classifyFatalError(err) ?? "error";
      const result = await this.fallback.answer(question, context, opts);
      return { ...result, degradedReason: reason };
    }
  }

  async research(
    node: LinkCandidate,
    userAnswers?: string,
  ): Promise<{ label: string; content: string; questions?: string[] }> {
    if (this.blocked) return this.fallback.research(node, userAnswers);
    try {
      return await withTimeout(
        this.primary.research(node, userAnswers),
        this.timeoutMs,
        "research",
      );
    } catch (err) {
      this.note(err, "research");
      return this.fallback.research(node, userAnswers);
    }
  }

  async summarizeSector(nodes: LinkCandidate[]): Promise<string> {
    if (this.blocked) return this.fallback.summarizeSector(nodes);
    try {
      return await withTimeout(this.primary.summarizeSector(nodes), this.timeoutMs, "summarizeSector");
    } catch (err) {
      this.note(err, "summarizeSector");
      return this.fallback.summarizeSector(nodes);
    }
  }

  async generateDailyLog(newNodes: LinkCandidate[], actions: string[], persona?: string, soul?: string): Promise<string> {
    if (this.blocked) return this.fallback.generateDailyLog(newNodes, actions, persona, soul);
    try {
      return await withTimeout(this.primary.generateDailyLog(newNodes, actions, persona, soul), this.timeoutMs, "generateDailyLog");
    } catch (err) {
      this.note(err, "generateDailyLog");
      return this.fallback.generateDailyLog(newNodes, actions, persona, soul);
    }
  }

  /** Only available when the primary provider supports it; the lore engine's
   *  offline chronicler is the real fallback, so we throw rather than degrade here. */
  async chronicle(subject: string, context: string): Promise<string> {
    if (this.blocked || !this.primary.chronicle) throw new Error("chronicle unavailable");
    return await withTimeout(this.primary.chronicle(subject, context), this.timeoutMs, "chronicle");
  }

  /** Only when the primary supports it; the dream cycle's template is the fallback. */
  async consolidate(nodes: LinkCandidate[]): Promise<{ belief: string; confidence: number }> {
    if (this.blocked || !this.primary.consolidate) throw new Error("consolidate unavailable");
    return await withTimeout(this.primary.consolidate(nodes), this.timeoutMs, "consolidate");
  }

  /** Only when the primary supports it; the deterministic ladder is the fallback. */
  async planJob(summary: string, options: { type: string; objective: string }[]): Promise<number> {
    if (this.blocked || !this.primary.planJob) throw new Error("planJob unavailable");
    return await withTimeout(this.primary.planJob(summary, options), this.timeoutMs, "planJob");
  }

  /** Only when the primary supports it; the caller's heuristic extraction is the fallback. */
  async distill(transcript: string): Promise<string[]> {
    if (this.blocked || !this.primary.distill) throw new Error("distill unavailable");
    return await withTimeout(this.primary.distill(transcript), this.timeoutMs, "distill");
  }

  /** Live web lookup — returns null (never throws) when unavailable, so the tool no-ops. */
  async webLookup(query: string): Promise<{ text: string; sources: string[] } | null> {
    if (this.blocked || !this.primary.webLookup) return null;
    try {
      return await withTimeout(this.primary.webLookup(query), this.timeoutMs, "webLookup");
    } catch (err) {
      this.note(err, "webLookup");
      return null;
    }
  }

  /** Only when the primary supports vision; null → the ingest route falls back to manual. */
  async extractFinancialImage(image: { dataUrl: string; mime: string }): Promise<import("@brain/shared").FinExtractionResult | null> {
    if (this.blocked || !this.primary.extractFinancialImage) return null;
    try {
      return await withTimeout(this.primary.extractFinancialImage(image), this.timeoutMs, "extractFinancialImage");
    } catch (err) {
      this.note(err, "extractFinancialImage");
      return null;
    }
  }

  /** Only when the primary supports pay-stub text extraction; null → the caller falls back
   *  to the offline regex parser (ocr/paystubHeuristic.ts). */
  async extractPaystub(text: string): Promise<import("@brain/shared").PaystubExtractionResult | null> {
    if (this.blocked || !this.primary.extractPaystub) return null;
    try {
      return await withTimeout(this.primary.extractPaystub(text), this.timeoutMs, "extractPaystub");
    } catch (err) {
      this.note(err, "extractPaystub");
      return null;
    }
  }

  /** Only when the primary supports pay-stub image extraction; null → the caller falls back
   *  to an empty draft the user fills in manually. */
  async extractPaystubImage(image: { dataUrl: string; mime: string }): Promise<import("@brain/shared").PaystubExtractionResult | null> {
    if (this.blocked || !this.primary.extractPaystubImage) return null;
    try {
      return await withTimeout(this.primary.extractPaystubImage(image), this.timeoutMs, "extractPaystubImage");
    } catch (err) {
      this.note(err, "extractPaystubImage");
      return null;
    }
  }

  /** Agentic router selection — throws when unavailable so the caller keeps every candidate. */
  async route(briefing: string, candidates: { tool: string; reason: string }[]): Promise<number[]> {
    if (this.blocked || !this.primary.route) throw new Error("route unavailable");
    return await withTimeout(this.primary.route(briefing, candidates), this.timeoutMs, "route");
  }

  async callWithTools(input: LlmToolCallInput): Promise<LlmToolResult> {
    if (this.blocked || !this.primary.callWithTools) throw new Error("callWithTools unavailable");
    return await withTimeout(this.primary.callWithTools(input), this.timeoutMs, "callWithTools");
  }
}
