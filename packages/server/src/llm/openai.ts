import { EXTRACTABLE_NODE_TYPES, RELATIONSHIP_TYPES, ExtractionResultSchema, type ExtractionResult, type FinExtractionResult, type PaystubExtractionResult, type ClarificationInterpretation, type GalaxyNavigationKind } from "@brain/shared";
import type { AnswerOptions, AnswerResult, ContextNode, ContradictionResult, LinkCandidate, LinkValidation, LlmProvider, LlmToolCallInput, LlmToolResult } from "./adapter.js";
import {
  EXTRACTION_SYSTEM,
  LINK_SYSTEM,
  SYNTHESIS_SYSTEM,
  CONTRADICTION_SYSTEM,
  CLARIFICATION_SYSTEM,
  composeSystem,
  RESEARCH_SYSTEM,
  SECTOR_SYSTEM,
  composeLogSystem,
  CHRONICLE_SYSTEM,
  PLAN_SYSTEM,
  DISTILL_SYSTEM,
  CONSOLIDATE_SYSTEM,
  buildExtractionPrompt,
  buildLinkPrompt,
  buildSynthesisPrompt,
  buildContradictionPrompt,
  buildClarificationPrompt,
  buildAnswerPrompt,
  buildResearchPrompt,
  buildSectorPrompt,
  buildLogPrompt,
  buildChroniclePrompt,
  buildPlanPrompt,
  buildDistillPrompt,
  buildConsolidatePrompt,
} from "./prompts.js";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * OpenAI's strict structured output requires every property in `required` and
 * emits `null` for ones the model leaves blank. Our zod schema treats these as
 * optional (number | undefined), so drop the nulls before validating.
 */
export function normalizeExtraction(raw: unknown): unknown {
  if (raw && typeof raw === "object" && Array.isArray((raw as { nodes?: unknown[] }).nodes)) {
    for (const n of (raw as { nodes: Record<string, unknown>[] }).nodes) {
      if (n.emotionalWeight == null) delete n.emotionalWeight;
      if (n.importance == null) delete n.importance;
      if (n.celestialTitle == null) delete n.celestialTitle;
      if (n.color == null) delete n.color;
    }
  }
  return raw;
}

/**
 * OpenAI's strict schema requires nullable fields to be present as `null` rather than
 * absent; PaystubExtractionResult treats them as optional (value | undefined). Strips
 * nulls and sanity-clamps money/confidence, same spirit as normalizeExtraction above.
 */
export function normalizePaystub(raw: unknown): PaystubExtractionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const cents = (v: unknown): number | undefined => { const n = num(v); return n == null ? undefined : Math.round(n); };
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const items = (v: unknown, extra: (i: Record<string, unknown>) => Record<string, unknown>): Array<Record<string, unknown>> =>
    Array.isArray(v)
      ? v
          .map((i) => (i && typeof i === "object" ? (i as Record<string, unknown>) : null))
          .filter((i): i is Record<string, unknown> => !!i && typeof i.label === "string" && typeof i.amountCents === "number")
          .map((i) => extra({ label: (i.label as string).trim().slice(0, 80), amountCents: Math.round(i.amountCents as number) }))
      : [];
  const netCents = cents(r.netCents);
  if (netCents == null) return null; // netCents is the one structurally required field
  return {
    employer: str(r.employer),
    payDate: str(r.payDate),
    periodStart: str(r.periodStart),
    periodEnd: str(r.periodEnd),
    grossCents: cents(r.grossCents),
    netCents,
    hours: num(r.hours),
    hourlyRateCents: cents(r.hourlyRateCents),
    overtimeHours: num(r.overtimeHours),
    overtimeRateCents: cents(r.overtimeRateCents),
    earnings: items(r.earnings, (i) => {
      const q = num((i as any).quantity);
      const rate = cents((i as any).rateCents);
      return { ...i, ...(q != null ? { quantity: q } : {}), ...(rate != null ? { rateCents: rate } : {}) };
    }) as unknown as PaystubExtractionResult["earnings"],
    deductions: items(r.deductions, (i) => {
      const ytd = cents((i as any).ytdCents);
      return { ...i, ...(ytd != null ? { ytdCents: ytd } : {}) };
    }) as unknown as PaystubExtractionResult["deductions"],
    ytdGrossCents: cents(r.ytdGrossCents),
    ytdNetCents: cents(r.ytdNetCents),
    confidence: Math.max(0, Math.min(1, num(r.confidence) ?? 0.5)),
  };
}

const PAYSTUB_SYSTEM =
  "You read a pay stub. Extract EVERYTHING on it, not just the common hourly/salary fields — " +
  "pay structures vary widely (hourly, salary, per-mile for a company truck driver's line-haul " +
  "pay, a flat day-rate for training pay, per diem, commission, detention/stop pay, bonuses). " +
  "Put every earnings line item into `earnings` verbatim (label, amountCents, and quantity/" +
  "rateCents when the stub shows a count and a rate, e.g. \"2,450 mi @ $0.52/mi\"), and still " +
  "fill hours/hourlyRateCents when it genuinely is a simple hourly wage. Put every tax/benefit " +
  "deduction into `deductions` verbatim. Money in INTEGER CENTS (e.g. $44.30 -> 4430). Dates as " +
  "YYYY-MM-DD. Use null for anything not present. If unsure, use lower confidence.";

/** The strict JSON schema shared by both paystub extraction entry points (text + image) —
 *  one schema, two callers, per docs/specs/paystub-ingestion.md §4. */
function paystubSchema(): object {
  const item = (extra: Record<string, unknown> = {}) => ({
    type: "object" as const,
    additionalProperties: false,
    properties: { label: { type: "string" }, amountCents: { type: "number" }, ...extra },
  });
  const earningsItem = item({ quantity: { type: ["number", "null"] }, rateCents: { type: ["number", "null"] } });
  (earningsItem as any).required = ["label", "amountCents", "quantity", "rateCents"];
  const deductionsItem = item({ ytdCents: { type: ["number", "null"] } });
  (deductionsItem as any).required = ["label", "amountCents", "ytdCents"];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      employer: { type: ["string", "null"] },
      payDate: { type: ["string", "null"] },
      periodStart: { type: ["string", "null"] },
      periodEnd: { type: ["string", "null"] },
      grossCents: { type: ["number", "null"] },
      netCents: { type: "number" },
      hours: { type: ["number", "null"] },
      hourlyRateCents: { type: ["number", "null"] },
      overtimeHours: { type: ["number", "null"] },
      overtimeRateCents: { type: ["number", "null"] },
      earnings: { type: "array", items: earningsItem },
      deductions: { type: "array", items: deductionsItem },
      ytdGrossCents: { type: ["number", "null"] },
      ytdNetCents: { type: ["number", "null"] },
      confidence: { type: "number" },
    },
    required: [
      "employer", "payDate", "periodStart", "periodEnd", "grossCents", "netCents",
      "hours", "hourlyRateCents", "overtimeHours", "overtimeRateCents",
      "earnings", "deductions", "ytdGrossCents", "ytdNetCents", "confidence",
    ],
  };
}

/**
 * Drop-in alternate provider using OpenAI's JSON-schema structured output.
 * Implemented via fetch to avoid an extra SDK dependency.
 */

/**
 * Light shape-check for a tool parameter schema before passing it to OpenAI.
 * OpenAI accepts full JSON Schema, so this only rejects non-objects and
 * unknown top-level keywords (closed by default — never silently dropped).
 */
function checkedSchema(toolName: string, schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`tool "${toolName}": parameters must be an object`);
  }
  const s = schema as Record<string, unknown>;
  const known = new Set(["type", "description", "properties", "required", "items", "enum", "additionalProperties"]);
  for (const k of Object.keys(s)) {
    if (!known.has(k)) throw new Error(`tool "${toolName}": unsupported schema keyword "${k}"`);
  }
  if (s.type !== "object") throw new Error(`tool "${toolName}": top-level type must be "object"`);
  return s;
}

export class OpenAiProvider implements LlmProvider {
  readonly available = true;
  readonly model = MODEL;
  constructor(
    private apiKey: string,
    private recordUsage?: (model: string, inputTokens: number, outputTokens: number) => void,
  ) {}

  private async json<T>(system: string, user: string, schema: object, name: string, temperature = 0.2, signal?: AbortSignal): Promise<T> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // D4: aborts the actual HTTP request — the socket is torn down, the
      // provider call stops, not just the awaiting wrapper.
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        // Chat runs HOT for varied, human phrasing; structured jobs stay cold.
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema },
        },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (this.recordUsage && body.usage) {
      this.recordUsage(MODEL, body.usage.prompt_tokens ?? 0, body.usage.completion_tokens ?? 0);
    }
    // A refusal or truncated response can yield null/empty content; surface a clear
    // error so ResilientLlmProvider degrades to the heuristic instead of JSON.parse(undefined).
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no content (refusal or empty response).");
    return JSON.parse(content) as T;
  }


  /**
   * Phase 1 agent loop: function-calling via chat/completions `tools`.
   * OpenAI accepts standard JSON Schema, so the registry definitions pass
   * through with a light shape check (closed by default: unknown top-level
   * keywords exclude the tool rather than being silently dropped).
   */
  async callWithTools(input: LlmToolCallInput): Promise<LlmToolResult> {
    const tools: Record<string, unknown>[] = [];
    for (const t of input.tools) {
      try {
        tools.push({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: checkedSchema(t.name, t.parameters),
          },
        });
      } catch (err) {
        console.warn(`[openai] tool "${t.name}" excluded: ${(err as Error).message}`);
      }
    }
    const messages: Record<string, unknown>[] = [
      { role: "system", content: input.systemInstruction },
    ];
    for (const m of input.messages) {
      if (m.role === "tool") {
        messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.result });
      } else if (m.role === "model" && m.toolCalls && m.toolCalls.length > 0) {
        // Assistant tool_calls message — must precede the tool results.
        messages.push({
          role: "assistant",
          content: m.text,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else {
        messages.push({ role: m.role === "model" ? "assistant" : "user", content: m.text });
      }
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: input.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (this.recordUsage && body.usage) {
      this.recordUsage(MODEL, body.usage.prompt_tokens ?? 0, body.usage.completion_tokens ?? 0);
    }
    const msg = body.choices?.[0]?.message;
    const calls = (msg?.tool_calls ?? []).map((tc, i) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        // Malformed JSON from the model → empty args; validateArgs will reject.
      }
      return {
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name ?? "",
        args,
      };
    });
    if (calls.length > 0) return { text: null, calls };
    return { text: msg?.content ?? "", calls: [] };
  }

  /**
   * Financial OS (Stage 1c): read a screenshot/PDF of income or expenses and return DRAFT
   * candidates. Best-effort + fully guarded — ANY failure returns null so the ingest route
   * degrades to manual entry (no feature hard-depends on a vision key). Amounts requested in
   * integer cents. gpt-4o-mini is vision-capable.
   */
  async extractFinancialImage(image: { dataUrl: string; mime: string }): Promise<FinExtractionResult | null> {
    try {
      const system =
        "You read a screenshot of financial transactions (pay stub, gig earnings like GoPuff/DoorDash/Uber/Spark, or bank/Cash App/Venmo activity). " +
        "Return ONLY JSON: {\"incomes\":[{\"date\":\"YYYY-MM-DD or null\",\"netCents\":int,\"platform\":str or null,\"confidence\":0..1}]," +
        "\"expenses\":[{\"date\":\"YYYY-MM-DD or null\",\"amountCents\":int,\"merchant\":str or null,\"direction\":\"out\",\"confidence\":0..1}]}. " +
        "Money in INTEGER CENTS (e.g. $44.30 -> 4430). Income = money received; expense = money spent. Omit totals/balances. If unsure, use lower confidence.";
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: [
              { type: "text", text: "Extract the income and expense line items from this image." },
              { type: "image_url", image_url: { url: image.dataUrl } },
            ] },
          ],
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (this.recordUsage && body.usage) this.recordUsage(MODEL, body.usage.prompt_tokens ?? 0, body.usage.completion_tokens ?? 0);
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      const raw = JSON.parse(content) as { incomes?: unknown[]; expenses?: unknown[] };
      const cents = (v: unknown): number => Math.abs(Math.round(Number(v) || 0));
      const conf = (v: unknown): number => Math.max(0, Math.min(1, Number(v) || 0.5));
      const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : undefined);
      const date = (v: unknown): string | undefined => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
      const incomes = (Array.isArray(raw.incomes) ? raw.incomes : [])
        .map((i: any) => ({ date: date(i?.date), netCents: cents(i?.netCents), platform: str(i?.platform), confidence: conf(i?.confidence) }))
        .filter((i) => i.netCents > 0);
      const expenses = (Array.isArray(raw.expenses) ? raw.expenses : [])
        .map((e: any) => ({ date: date(e?.date), amountCents: cents(e?.amountCents), merchant: str(e?.merchant), direction: "out" as const, confidence: conf(e?.confidence) }))
        .filter((e) => e.amountCents > 0);
      return { incomes, expenses, provider: "vision" };
    } catch {
      return null; // any failure → caller falls back to manual entry
    }
  }

  /**
   * Pay stub TEXT extraction (docs/specs/paystub-ingestion.md §4) — comprehensive, not
   * curated. `earnings` generalizes beyond hourly/salary (e.g. per-mile line-haul pay, a
   * flat day-rate for training, per diem) so whatever pay structure is actually on the
   * document is captured verbatim, while `hours`/`hourlyRateCents` still get filled when the
   * stub genuinely is hourly. Best-effort + fully guarded: any failure returns null so the
   * caller falls back to the offline regex parser (never a hard dependency on a cloud key).
   */
  async extractPaystub(text: string): Promise<PaystubExtractionResult | null> {
    try {
      const raw = await this.json<Record<string, unknown>>(
        PAYSTUB_SYSTEM, `Pay stub text:\n\n${text.slice(0, 8000)}`, paystubSchema(), "paystub", 0,
      );
      return normalizePaystub(raw);
    } catch {
      return null; // any failure → caller falls back to the offline regex parser
    }
  }

  /**
   * Pay stub IMAGE extraction (a photographed paper stub or a screenshot) — the exact same
   * schema/prompt as extractPaystub's text path (docs/specs/paystub-ingestion.md §3: "one
   * shared schema, two entry points"), called via the raw vision endpoint the same way
   * extractFinancialImage is. Best-effort + fully guarded: any failure returns null.
   */
  async extractPaystubImage(image: { dataUrl: string; mime: string }): Promise<PaystubExtractionResult | null> {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: "json_schema", json_schema: { name: "paystub", strict: true, schema: paystubSchema() } },
          messages: [
            { role: "system", content: PAYSTUB_SYSTEM },
            { role: "user", content: [
              { type: "text", text: "Extract this pay stub." },
              { type: "image_url", image_url: { url: image.dataUrl } },
            ] },
          ],
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (this.recordUsage && body.usage) this.recordUsage(MODEL, body.usage.prompt_tokens ?? 0, body.usage.completion_tokens ?? 0);
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      return normalizePaystub(JSON.parse(content));
    } catch {
      return null;
    }
  }

  async extract(text: string, context: ContextNode[]): Promise<ExtractionResult> {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              celestialTitle: { type: ["string", "null"] },
              // EXTRACTABLE_NODE_TYPES (excludes "moc") — see gemini.ts for why the full
              // NODE_TYPES enum here would let the model pick a type the response validator
              // (NodeTypeSchema) rejects, silently downgrading the ingest to the heuristic path.
              type: { type: "string", enum: [...EXTRACTABLE_NODE_TYPES] },
              content: { type: "string" },
              emotionalWeight: { type: ["number", "null"] },
              importance: { type: ["number", "null"] },
              color: { type: ["string", "null"] },
            },
            required: ["label", "celestialTitle", "type", "content", "emotionalWeight", "importance", "color"],
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceLabel: { type: "string" },
              targetLabel: { type: "string" },
              relationship: { type: "string", enum: [...RELATIONSHIP_TYPES] },
            },
            required: ["sourceLabel", "targetLabel", "relationship"],
          },
        },
      },
      required: ["nodes", "edges"],
    };
    const raw = await this.json<unknown>(
      EXTRACTION_SYSTEM,
      buildExtractionPrompt(text, context),
      schema,
      "extraction",
    );
    return ExtractionResultSchema.parse(normalizeExtraction(raw));
  }

  async validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
    opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation> {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        linked: { type: "boolean" },
        relationship: { type: ["string", "null"], enum: [...RELATIONSHIP_TYPES, null] },
        weight: { type: ["number", "null"] },
      },
      required: ["linked", "relationship", "weight"],
    };
    const raw = await this.json<LinkValidation>(
      LINK_SYSTEM,
      buildLinkPrompt(source, target, similarity),
      schema,
      "link",
      0.2,
      opts?.signal,
    );
    return {
      linked: Boolean(raw.linked),
      relationship: raw.relationship ?? undefined,
      weight: typeof raw.weight === "number" ? raw.weight : similarity,
    };
  }

  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string" }, score: { type: "number" } },
      required: ["text", "score"],
    };
    const raw = await this.json<{ text: string; score: number }>(
      SYNTHESIS_SYSTEM,
      buildSynthesisPrompt(a, b, similarity),
      schema,
      "synthesis",
    );
    return { text: raw.text, score: typeof raw.score === "number" ? raw.score : similarity };
  }

  async detectContradiction(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<ContradictionResult> {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        conflict: { type: "boolean" },
        text: { type: "string" },
        score: { type: "number" },
      },
      required: ["conflict", "text", "score"],
    };
    const raw = await this.json<ContradictionResult>(
      CONTRADICTION_SYSTEM,
      buildContradictionPrompt(a, b, similarity),
      schema,
      "contradiction",
    );
    return {
      conflict: !!raw.conflict,
      text: raw.conflict ? String(raw.text ?? "") : "",
      score: raw.conflict ? (typeof raw.score === "number" ? raw.score : similarity) : 0,
    };
  }

  async interpretClarificationAnswer(question: string, userMessage: string): Promise<ClarificationInterpretation> {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        answers: { type: "boolean" },
        confirmedStatement: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["answers", "confirmedStatement", "confidence"],
    };
    const raw = await this.json<ClarificationInterpretation>(
      CLARIFICATION_SYSTEM,
      buildClarificationPrompt(question, userMessage),
      schema,
      "clarification",
    );
    return {
      answers: !!raw.answers,
      confirmedStatement: raw.answers ? String(raw.confirmedStatement ?? "").trim() : "",
      confidence: raw.answers ? Math.max(0, Math.min(1, typeof raw.confidence === "number" ? raw.confidence : 0.5)) : 0,
    };
  }

  async answer(question: string, context: ContextNode[], opts?: AnswerOptions): Promise<AnswerResult> {
    // Strict structured outputs require every property listed in `required`, so the
    // optional askBack is modeled as "empty string = none".
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        answer: { type: "string" },
        citations: { type: "array", items: { type: "integer" } },
        mood: {
          type: "string",
          enum: ["happy", "excited", "warm", "thoughtful", "concerned", "sad", "neutral"],
        },
        askBack: { type: "string" },
        usedRoles: { type: "array", items: { type: "string" } },
        // Maya Chat → Galaxy Navigation — UNTRUSTED proposal only; the model may pick kind+id
        // ONLY from the GALAXY ENTITIES list given in the prompt, never invent one. "empty
        // array = none" — same strict-schema convention as askBack/usedRoles in this file.
        navigationCandidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["journey", "bill", "goal"] },
              id: { type: "integer" },
            },
            required: ["kind", "id"],
          },
        },
        // Maya Longitudinal Intelligence, Phase H — UNTRUSTED proposal only, one piece of
        // evidence toward a deterministically-accumulated preference, never authoritative on
        // its own. "empty signal/value = none" — same strict-schema convention as askBack.
        interactionPreferenceSignal: {
          type: "object",
          additionalProperties: false,
          properties: {
            signal: { type: "string" },
            value: { type: "string" },
          },
          required: ["signal", "value"],
        },
      },
      required: ["answer", "citations", "mood", "askBack", "usedRoles", "navigationCandidates", "interactionPreferenceSignal"],
    };
    const raw = await this.json<AnswerResult>(
      composeSystem(opts), // Layer 1 + About-Me + Layer 2 (custom instructions)
      buildAnswerPrompt(question, context, opts?.knowledge, opts?.history, opts?.justAsked, opts?.galaxyCandidates, opts?.attachments),
      schema,
      "answer",
      0.85, // conversational warmth + variety
    );
    return {
      answer: raw.answer ?? "",
      citations: Array.isArray(raw.citations) ? raw.citations : [],
      mood: typeof raw.mood === "string" ? raw.mood : undefined,
      // Shape-checked here (defense in depth, same discipline as `citations` above); the
      // AUTHORITATIVE check is `resolveGalaxyEntity` at the chat-integration call site —
      // this only guards against a malformed/off-schema response, never decides trust.
      navigationCandidates: Array.isArray(raw.navigationCandidates)
        ? (raw.navigationCandidates as unknown as any[])
            .filter(
              (c): c is { kind: string; id: number } =>
                !!c && typeof c === "object" && typeof c.id === "number" &&
                ["journey", "bill", "goal"].includes(c.kind),
            )
            .slice(0, 2)
            .map((c) => ({ kind: c.kind as GalaxyNavigationKind, id: c.id }))
        : undefined,
      askBack: typeof raw.askBack === "string" && raw.askBack.trim() ? raw.askBack.trim() : undefined,
      usedRoles: Array.isArray(raw.usedRoles) ? raw.usedRoles.filter((x) => typeof x === "string") : undefined,
      interactionPreferenceSignal: (() => {
        const sig = raw.interactionPreferenceSignal as unknown as { signal?: unknown; value?: unknown } | undefined;
        return sig && typeof sig.signal === "string" && sig.signal.trim() && typeof sig.value === "string" && sig.value.trim()
          ? { signal: sig.signal, value: sig.value }
          : undefined;
      })(),
    };
  }

  async research(
    node: LinkCandidate,
    userAnswers?: string,
  ): Promise<{ label: string; content: string; questions?: string[] }> {
    return await this.json<{ label: string; content: string; questions?: string[] }>(
      RESEARCH_SYSTEM,
      buildResearchPrompt(node, userAnswers),
      {
        type: "object",
        properties: {
          label: { type: "string" },
          content: { type: "string" },
          questions: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["label", "content", "questions"],
        additionalProperties: false,
      },
      "research",
    );
  }

  async summarizeSector(nodes: LinkCandidate[]): Promise<string> {
    const raw = await this.json<{ vibe: string }>(
      SECTOR_SYSTEM,
      buildSectorPrompt(nodes),
      {
        type: "object",
        properties: { vibe: { type: "string" } },
        required: ["vibe"],
        additionalProperties: false,
      },
      "sector",
    );
    return raw.vibe;
  }

  async generateDailyLog(newNodes: LinkCandidate[], actions: string[], persona?: string, soul?: string): Promise<string> {
    const raw = await this.json<{ log: string }>(
      composeLogSystem({ persona, soul }),
      buildLogPrompt(newNodes, actions),
      {
        type: "object",
        properties: { log: { type: "string" } },
        required: ["log"],
        additionalProperties: false,
      },
      "log",
    );
    return raw.log;
  }

  async chronicle(subject: string, context: string): Promise<string> {
    const raw = await this.json<{ lore: string }>(
      CHRONICLE_SYSTEM,
      buildChroniclePrompt(subject, context),
      {
        type: "object",
        properties: { lore: { type: "string" } },
        required: ["lore"],
        additionalProperties: false,
      },
      "chronicle",
    );
    return raw.lore;
  }

  async consolidate(nodes: LinkCandidate[]): Promise<{ belief: string; confidence: number }> {
    const raw = await this.json<{ belief: string; confidence: number }>(
      CONSOLIDATE_SYSTEM,
      buildConsolidatePrompt(nodes),
      {
        type: "object",
        properties: { belief: { type: "string" }, confidence: { type: "number" } },
        required: ["belief", "confidence"],
        additionalProperties: false,
      },
      "consolidate",
    );
    return {
      belief: String(raw.belief ?? "").trim(),
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    };
  }

  async planJob(summary: string, options: { type: string; objective: string }[]): Promise<number> {
    const raw = await this.json<{ index: number }>(
      PLAN_SYSTEM,
      buildPlanPrompt(summary, options),
      {
        type: "object",
        properties: { index: { type: "integer" } },
        required: ["index"],
        additionalProperties: false,
      },
      "plan",
    );
    return raw.index;
  }

  async distill(transcript: string): Promise<string[]> {
    const raw = await this.json<{ summaries: string[] }>(
      DISTILL_SYSTEM,
      buildDistillPrompt(transcript),
      {
        type: "object",
        properties: { summaries: { type: "array", items: { type: "string" } } },
        required: ["summaries"],
        additionalProperties: false,
      },
      "distill",
    );
    return Array.isArray(raw.summaries) ? raw.summaries : [];
  }
}
