import { GoogleGenAI, Type } from "@google/genai";
import { NODE_TYPES, RELATIONSHIP_TYPES, ExtractionResultSchema, type ExtractionResult } from "@brain/shared";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "./adapter.js";
import { EXTRACTION_SYSTEM, LINK_SYSTEM, buildExtractionPrompt, buildLinkPrompt } from "./prompts.js";

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
          type: { type: Type.STRING, enum: [...NODE_TYPES] },
          content: { type: Type.STRING },
          emotionalWeight: { type: Type.NUMBER },
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

export class GeminiProvider implements LlmProvider {
  readonly available = true;
  readonly model = MODEL;
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async json<T>(systemInstruction: string, prompt: string, schema: object): Promise<T> {
    const res = await this.ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0.2,
      },
    });
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
  ): Promise<LinkValidation> {
    const raw = await this.json<LinkValidation>(
      LINK_SYSTEM,
      buildLinkPrompt(source, target, similarity),
      linkSchema,
    );
    return {
      linked: Boolean(raw.linked),
      relationship: raw.relationship,
      weight: typeof raw.weight === "number" ? raw.weight : similarity,
    };
  }
}
