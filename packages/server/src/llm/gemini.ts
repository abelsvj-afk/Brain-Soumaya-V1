import { GoogleGenAI, Type } from "@google/genai";
import { EXTRACTABLE_NODE_TYPES, RELATIONSHIP_TYPES, ExtractionResultSchema, type ExtractionResult, type ClarificationInterpretation, type GalaxyNavigationKind } from "@brain/shared";
import type { AnswerOptions, AnswerResult, ContextNode, ContradictionResult, LinkCandidate, LinkValidation, LlmProvider, LlmToolCallInput, LlmToolDefinition, LlmToolResult } from "./adapter.js";
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

const MODEL = process.env.LLM_MODEL ?? "gemini-2.5-flash";

// Explicit, FLAT response schemas (deep schemas are fragile — see research).
const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          celestialTitle: { type: Type.STRING },
          // EXTRACTABLE_NODE_TYPES (excludes "moc"), NOT the full NODE_TYPES — the response is
          // validated against ExtractionResultSchema's NodeTypeSchema, which also excludes
          // "moc". Offering it here let the model pick a type the parser would then reject,
          // silently downgrading that whole ingest to the heuristic extractor.
          type: { type: Type.STRING, enum: [...EXTRACTABLE_NODE_TYPES] },
          content: { type: Type.STRING },
          emotionalWeight: { type: Type.NUMBER },
          importance: { type: Type.NUMBER },
          color: { type: Type.STRING },
        },
        required: ["label", "type", "content"],
      },
    },
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sourceLabel: { type: Type.STRING },
          targetLabel: { type: Type.STRING },
          relationship: { type: Type.STRING, enum: [...RELATIONSHIP_TYPES] },
        },
        required: ["sourceLabel", "targetLabel", "relationship"],
      },
    },
  },
  required: ["nodes", "edges"],
};

const linkSchema = {
  type: Type.OBJECT,
  properties: {
    linked: { type: Type.BOOLEAN },
    relationship: { type: Type.STRING, enum: [...RELATIONSHIP_TYPES] },
    weight: { type: Type.NUMBER },
  },
  required: ["linked"],
};

const synthesisSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    score: { type: Type.NUMBER },
  },
  required: ["text", "score"],
};

const contradictionSchema = {
  type: Type.OBJECT,
  properties: {
    conflict: { type: Type.BOOLEAN },
    text: { type: Type.STRING },
    score: { type: Type.NUMBER },
  },
  required: ["conflict", "text", "score"],
};

const clarificationSchema = {
  type: Type.OBJECT,
  properties: {
    answers: { type: Type.BOOLEAN },
    confirmedStatement: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["answers", "confirmedStatement", "confidence"],
};

const answerSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    citations: { type: Type.ARRAY, items: { type: Type.INTEGER } },
    mood: {
      type: Type.STRING,
      enum: ["happy", "excited", "warm", "thoughtful", "concerned", "sad", "neutral"],
    },
    askBack: { type: Type.STRING },
    usedRoles: { type: Type.ARRAY, items: { type: Type.STRING } },
    // Maya Chat → Galaxy Navigation — UNTRUSTED proposal only; the model may pick kind+id
    // ONLY from the GALAXY ENTITIES list given in the prompt, never invent one. Optional
    // (not in `required`), same treatment as askBack/usedRoles.
    navigationCandidates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["journey", "bill", "goal"] },
          id: { type: Type.INTEGER },
        },
        required: ["kind", "id"],
      },
    },
    // Maya Longitudinal Intelligence, Phase H — UNTRUSTED proposal only; the server treats
    // this as one piece of evidence, never authoritative. Optional/nullable, same treatment
    // as navigationCandidates/askBack/usedRoles above.
    interactionPreferenceSignal: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        signal: { type: Type.STRING },
        value: { type: Type.STRING },
      },
      required: ["signal", "value"],
    },
  },
  required: ["answer", "citations", "mood"],
};

const researchSchema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    content: { type: Type.STRING },
    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["label", "content", "questions"],
};

const sectorSchema = {
  type: Type.OBJECT,
  properties: {
    vibe: { type: Type.STRING },
  },
  required: ["vibe"],
};

const logSchema = {
  type: Type.OBJECT,
  properties: {
    log: { type: Type.STRING },
  },
  required: ["log"],
};

const chronicleSchema = {
  type: Type.OBJECT,
  properties: {
    lore: { type: Type.STRING },
  },
  required: ["lore"],
};

const planSchema = {
  type: Type.OBJECT,
  properties: {
    index: { type: Type.INTEGER },
  },
  required: ["index"],
};

const distillSchema = {
  type: Type.OBJECT,
  properties: {
    summaries: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["summaries"],
};

const consolidateSchema = {
  type: Type.OBJECT,
  properties: {
    belief: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["belief", "confidence"],
};


/**
 * Translate a JSON-Schema-ish parameter definition (the registry's
 * `parameters` shape) into a Gemini FunctionDeclaration parameter schema.
 * Gemini supports a subset of JSON Schema: object/string/number/integer/
 * boolean/array with properties/items/required/enum/description. Anything
 * else throws, and the caller EXCLUDES the tool (never mis-translates it).
 */
function toGeminiSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("schema must be an object");
  }
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const t = s.type;
  const toType = (tt: unknown): unknown => {
    switch (tt) {
      case "object": return Type.OBJECT;
      case "string": return Type.STRING;
      case "number": return Type.NUMBER;
      case "integer": return Type.INTEGER;
      case "boolean": return Type.BOOLEAN;
      case "array": return Type.ARRAY;
      default: throw new Error(`unsupported type: ${JSON.stringify(tt)}`);
    }
  };
  if (t !== undefined) out.type = toType(t);
  if (s.description !== undefined) {
    if (typeof s.description !== "string") throw new Error("description must be a string");
    out.description = s.description;
  }
  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum)) throw new Error("enum must be an array");
    out.enum = s.enum;
  }
  if (s.properties !== undefined) {
    if (typeof s.properties !== "object" || s.properties === null || Array.isArray(s.properties)) {
      throw new Error("properties must be an object");
    }
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
      props[k] = toGeminiSchema(v);
    }
    out.properties = props;
  }
  if (s.items !== undefined) out.items = toGeminiSchema(s.items);
  if (s.required !== undefined) {
    if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === "string")) {
      throw new Error("required must be a string array");
    }
    out.required = s.required;
  }
  if (s.additionalProperties !== undefined) {
    if (typeof s.additionalProperties !== "boolean") throw new Error("additionalProperties must be a boolean");
    out.additionalProperties = s.additionalProperties;
  }
  // Closed by default: reject unknown keywords rather than silently dropping them.
  const known = new Set(["type", "description", "enum", "properties", "items", "required", "additionalProperties"]);
  for (const k of Object.keys(s)) {
    if (!known.has(k)) throw new Error(`unsupported schema keyword: ${k}`);
  }
  return out;
}

export class GeminiProvider implements LlmProvider {
  readonly available = true;
  readonly model = MODEL;
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly recordUsage?: (model: string, inputTokens: number, outputTokens: number) => void,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async json<T>(
    systemInstruction: string,
    prompt: string,
    schema: object,
    // Chat runs HOT so her phrasing varies turn to turn (low temp made every
    // reply the same shape). Structured jobs (extraction/linking) stay cold.
    temperature = 0.2,
    // D4: aborts the actual SDK request. `GenerateContentConfig.abortSignal`
    // is honored by @google/genai's transport — aborting tears down the
    // underlying fetch socket; the service is still charged for the call.
    abortSignal?: AbortSignal,
  ): Promise<T> {
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature,
        abortSignal,
      },
    });
    // Feed the budget meter — without this the deployment's USD cap never trips.
    const meta = res.usageMetadata;
    if (meta) {
      this.recordUsage?.(MODEL, meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0);
    }
    const text = res.text ?? "";
    return JSON.parse(text) as T;
  }

  async extract(text: string, context: ContextNode[]): Promise<ExtractionResult> {
    const prompt = buildExtractionPrompt(text, context);
    // One retry on schema-validation failure before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await this.json<unknown>(EXTRACTION_SYSTEM, prompt, extractionSchema);
        return ExtractionResultSchema.parse(raw);
      } catch (err) {
        if (attempt === 1) throw err;
      }
    }
    throw new Error("unreachable");
  }

  async validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
    opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation> {
    const raw = await this.json<LinkValidation>(
      LINK_SYSTEM,
      buildLinkPrompt(source, target, similarity),
      linkSchema,
      0.2,
      opts?.signal,
    );
    return {
      linked: Boolean(raw.linked),
      relationship: raw.relationship,
      weight: typeof raw.weight === "number" ? raw.weight : similarity,
    };
  }

  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    const raw = await this.json<{ text: string; score: number }>(
      SYNTHESIS_SYSTEM,
      buildSynthesisPrompt(a, b, similarity),
      synthesisSchema,
    );
    return {
      text: raw.text,
      score: typeof raw.score === "number" ? raw.score : similarity,
    };
  }

  async detectContradiction(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<ContradictionResult> {
    const raw = await this.json<ContradictionResult>(
      CONTRADICTION_SYSTEM,
      buildContradictionPrompt(a, b, similarity),
      contradictionSchema,
    );
    return {
      conflict: !!raw.conflict,
      text: raw.conflict ? String(raw.text ?? "") : "",
      score: raw.conflict ? (typeof raw.score === "number" ? raw.score : similarity) : 0,
    };
  }

  async interpretClarificationAnswer(question: string, userMessage: string): Promise<ClarificationInterpretation> {
    const raw = await this.json<ClarificationInterpretation>(
      CLARIFICATION_SYSTEM,
      buildClarificationPrompt(question, userMessage),
      clarificationSchema,
    );
    return {
      answers: !!raw.answers,
      confirmedStatement: raw.answers ? String(raw.confirmedStatement ?? "").trim() : "",
      confidence: raw.answers ? Math.max(0, Math.min(1, typeof raw.confidence === "number" ? raw.confidence : 0.5)) : 0,
    };
  }

  async answer(question: string, context: ContextNode[], opts?: AnswerOptions): Promise<AnswerResult> {
    const raw = await this.json<AnswerResult>(
      composeSystem(opts), // Layer 1 + About-Me + Layer 2 (custom instructions)
      buildAnswerPrompt(question, context, opts?.knowledge, opts?.history, opts?.justAsked, opts?.galaxyCandidates),
      answerSchema,
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
        const sig = raw.interactionPreferenceSignal as unknown as { signal?: unknown; value?: unknown } | null | undefined;
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
      researchSchema,
    );
  }

  /** Live web lookup via Google Search grounding — returns a concise answer + sources. */
  async webLookup(query: string): Promise<{ text: string; sources: string[] } | null> {
    try {
      const res = await this.ai.models.generateContent({
        model: MODEL,
        contents: `Answer concisely using current information from the web. Be factual and brief.\n\nQuestion: ${query}`,
        config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
      });
      const meta = res.usageMetadata;
      if (meta) this.recordUsage?.(MODEL, meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0);
      const text = (res.text ?? "").trim();
      if (!text) return null;
      const cand = res.candidates?.[0] as { groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] } } | undefined;
      const sources: string[] = [];
      for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
        const uri = c?.web?.uri;
        if (uri) sources.push(uri);
      }
      return { text, sources: [...new Set(sources)].slice(0, 8) };
    } catch {
      return null;
    }
  }

  /** Agentic router: pick which deterministic candidate actions are worth doing now. */
  async route(briefing: string, candidates: { tool: string; reason: string }[]): Promise<number[]> {    const list = candidates.map((c, i) => `${i}. [${c.tool}] ${c.reason}`).join("\n");
    const schema = {
      type: Type.OBJECT,
      properties: { choose: { type: Type.ARRAY, items: { type: Type.NUMBER } } },
      required: ["choose"],
    };
    const system =
      "You are Soumaya's action router. Given the user's current state and a list of candidate actions " +
      "she could take right now, choose ONLY the indices worth doing this moment — favour genuine value, " +
      "avoid noise, and never overwhelm. You may choose none. Return {\"choose\": [indices]}.";
    try {
      const raw = await this.json<{ choose: number[] }>(system, `STATE:\n${briefing}\n\nCANDIDATES:\n${list}`, schema, 0.2);
      return Array.isArray(raw.choose) ? raw.choose.filter((n) => Number.isInteger(n)) : [];
    } catch {
      return candidates.map((_, i) => i); // on failure, don't suppress anything
    }
  }

  /**
   * Phase 1 agent loop: function-calling. Translates the provider-neutral tool
   * definitions into Gemini FunctionDeclarations. A tool whose schema uses
   * constructs Gemini cannot express is EXCLUDED (logged), never mis-translated.
   */
  async callWithTools(input: LlmToolCallInput): Promise<LlmToolResult> {
    const declarations: Record<string, unknown>[] = [];
    for (const t of input.tools) {
      try {
        declarations.push({
          name: t.name,
          description: t.description,
          parameters: toGeminiSchema(t.parameters),
        });
      } catch (err) {
        console.warn(`[gemini] tool "${t.name}" excluded: ${(err as Error).message}`);
      }
    }
    const contents = input.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: m.name, response: { result: m.result } } }],
        };
      }
      return { role: m.role, parts: [{ text: m.text }] };
    });
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: contents as never,
      config: {
        systemInstruction: input.systemInstruction,
        // Chat runs HOT so her phrasing varies turn to turn.
        temperature: 0.7,
        ...(declarations.length > 0 ? { tools: [{ functionDeclarations: declarations }] } : {}),
        abortSignal: input.signal,
      },
    });
    const meta = res.usageMetadata;
    if (meta) {
      this.recordUsage?.(MODEL, meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0);
    }
    const calls = (res.functionCalls ?? []).map((fc, i) => ({
      id: typeof fc.id === "string" && fc.id ? fc.id : `call_${i}`,
      name: fc.name ?? "",
      args: (fc.args ?? {}) as Record<string, unknown>,
    }));
    if (calls.length > 0) return { text: null, calls };
    return { text: res.text ?? "", calls: [] };
  }

  async summarizeSector(nodes: LinkCandidate[]): Promise<string> {
    const raw = await this.json<{ vibe: string }>(
      SECTOR_SYSTEM,
      buildSectorPrompt(nodes),
      sectorSchema,
    );
    return raw.vibe;
  }

  async generateDailyLog(newNodes: LinkCandidate[], actions: string[], persona?: string, soul?: string): Promise<string> {
    const raw = await this.json<{ log: string }>(
      composeLogSystem({ persona, soul }),
      buildLogPrompt(newNodes, actions),
      logSchema,
    );
    return raw.log;
  }

  async consolidate(nodes: LinkCandidate[]): Promise<{ belief: string; confidence: number }> {
    const raw = await this.json<{ belief: string; confidence: number }>(
      CONSOLIDATE_SYSTEM,
      buildConsolidatePrompt(nodes),
      consolidateSchema,
    );
    return {
      belief: String(raw.belief ?? "").trim(),
      confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    };
  }

  async chronicle(subject: string, context: string): Promise<string> {
    const raw = await this.json<{ lore: string }>(
      CHRONICLE_SYSTEM,
      buildChroniclePrompt(subject, context),
      chronicleSchema,
    );
    return raw.lore;
  }

  async planJob(summary: string, options: { type: string; objective: string }[]): Promise<number> {
    const raw = await this.json<{ index: number }>(
      PLAN_SYSTEM,
      buildPlanPrompt(summary, options),
      planSchema,
    );
    return raw.index;
  }

  async distill(transcript: string): Promise<string[]> {
    const raw = await this.json<{ summaries: string[] }>(
      DISTILL_SYSTEM,
      buildDistillPrompt(transcript),
      distillSchema,
    );
    return Array.isArray(raw.summaries) ? raw.summaries : [];
  }
}
