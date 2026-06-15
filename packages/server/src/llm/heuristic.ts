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
    // Stem-based substring matching (no word boundaries) so "arguing",
    // "anxious", "venture" etc. are caught.
    if (/(business|startup|idea|product|market|revenue|customer|saas|launch|venture|profit)/.test(t))
      return "business_idea";
    if (
      /(sister|brother|mother|father|\bmom\b|\bdad\b|wife|husband|girlfriend|boyfriend|relationship|friend|family|partner|\blove\b|argu|feel|anxious|emotion|lonely|\bshe\b|\bhe\b|\bthey\b)/.test(
        t,
      )
    )
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

  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    return {
      text: `"${a.label}" and "${b.label}" seem related (${Math.round(
        similarity * 100,
      )}% similar) but aren't connected yet — worth a closer look.`,
      score: similarity,
    };
  }

  async answer(
    question: string,
    context: ContextNode[],
  ): Promise<{ answer: string; citations: number[] }> {
    if (context.length === 0) {
      return { answer: "I don't have any memories related to that yet.", citations: [] };
    }
    const top = context.slice(0, 5);
    const answer =
      `Related memories for "${question}":\n` +
      top.map((c) => `• ${c.label}: ${c.content}`).join("\n") +
      `\n\n(Set GEMINI_API_KEY for synthesized answers.)`;
    return { answer, citations: top.map((c) => c.id) };
  }
}
