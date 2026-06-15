import type { ExtractionResult, NodeType } from "@brain/shared";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "./adapter.js";

/**
 * No-key fallback. Keeps the brain fully functional without an LLM:
 * - extract(): treats the whole input as a single node, guessing the type from
 *   keywords. (No LLM-typed edges; associative similarity linking still runs.)
 * - validateLink(): approves links purely on cosine similarity.
 */
export class HeuristicProvider implements LlmProvider {
  readonly available = false;
  readonly model = "heuristic";

  private guessType(text: string): NodeType {
    const t = text.toLowerCase();
    if (/\b(business|startup|idea|product|market|revenue|customer|saas)\b/.test(t))
      return "business_idea";
    if (/\b(she|he|they|him|her|relationship|friend|family|partner|love|argu|feel)\b/.test(t))
      return "relationship_reflection";
    return "random_thought";
  }

  private deriveLabel(text: string): string {
    const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
    return words.length > 0 ? words : "Thought";
  }

  async extract(text: string, _context: ContextNode[]): Promise<ExtractionResult> {
    return {
      nodes: [{ label: this.deriveLabel(text), type: this.guessType(text), content: text.trim() }],
      edges: [],
    };
  }

  async validateLink(
    _source: LinkCandidate,
    _target: LinkCandidate,
    similarity: number,
  ): Promise<LinkValidation> {
    return { linked: true, relationship: "relates_to", weight: similarity };
  }
}
