import { NODE_TYPES, RELATIONSHIP_TYPES, ExtractionResultSchema, type ExtractionResult } from "@brain/shared";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "./adapter.js";
import { EXTRACTION_SYSTEM, LINK_SYSTEM, buildExtractionPrompt, buildLinkPrompt } from "./prompts.js";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * Drop-in alternate provider using OpenAI's JSON-schema structured output.
 * Implemented via fetch to avoid an extra SDK dependency.
 */
export class OpenAiProvider implements LlmProvider {
  readonly available = true;
  readonly model = MODEL;
  constructor(private apiKey: string) {}

  private async json<T>(system: string, user: string, schema: object, name: string): Promise<T> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
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
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(body.choices[0]!.message.content) as T;
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
              type: { type: "string", enum: [...NODE_TYPES] },
              content: { type: "string" },
              emotionalWeight: { type: ["number", "null"] },
            },
            required: ["label", "type", "content", "emotionalWeight"],
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
    return ExtractionResultSchema.parse(raw);
  }

  async validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
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
    );
    return {
      linked: Boolean(raw.linked),
      relationship: raw.relationship ?? undefined,
      weight: typeof raw.weight === "number" ? raw.weight : similarity,
    };
  }
}
