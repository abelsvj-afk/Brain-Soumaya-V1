import type { ExtractionResult, RelationshipType } from "@brain/shared";

/** A previously-stored node passed to the LLM as context for extraction. */
export interface ContextNode {
  id: number;
  label: string;
  type: string;
  content: string;
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

/**
 * LlmProvider is the structured-reasoning seam. Gemini is the default; OpenAI
 * is a drop-in alternate; the heuristic provider keeps everything working with
 * no API key. `available` is false for the heuristic fallback so callers can
 * surface "LLM typing inactive" state.
 */
export interface LlmProvider {
  readonly available: boolean;
  readonly model: string;
  /** Parse raw text into typed nodes + edges, grounded in existing context. */
  extract(text: string, context: ContextNode[]): Promise<ExtractionResult>;
  /** Decide whether a semantic neighbour should become a formal graph edge. */
  validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
  ): Promise<LinkValidation>;
  /** Write a short insight about a latent (semantically near, graph-distant) pair. */
  synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }>;
  /** Answer a question grounded in a retrieved subgraph; cite node ids. */
  answer(
    question: string,
    context: ContextNode[],
  ): Promise<{ answer: string; citations: number[] }>;
}

export type LlmProviderKind = "gemini" | "openai" | "heuristic";

/**
 * Construct the configured LLM provider, falling back to the heuristic provider
 * when the relevant API key is missing.
 */
export async function createLlmProvider(
  kind: LlmProviderKind = (process.env.LLM_PROVIDER as LlmProviderKind) ?? "gemini",
): Promise<LlmProvider> {
  if (kind === "gemini" && process.env.GEMINI_API_KEY) {
    const { GeminiProvider } = await import("./gemini.js");
    return new GeminiProvider(process.env.GEMINI_API_KEY);
  }
  if (kind === "openai" && process.env.OPENAI_API_KEY) {
    const { OpenAiProvider } = await import("./openai.js");
    return new OpenAiProvider(process.env.OPENAI_API_KEY);
  }
  const { HeuristicProvider } = await import("./heuristic.js");
  return new HeuristicProvider();
}
