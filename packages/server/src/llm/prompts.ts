import { NODE_TYPES, RELATIONSHIP_TYPES } from "@brain/shared";
import type { ContextNode, LinkCandidate } from "./adapter.js";

/**
 * System instruction for ontological extraction. Forces the model to act as a
 * structured parser, not a chat assistant. The JSON shape is enforced separately
 * via responseSchema; this prompt steers classification quality.
 */
export const EXTRACTION_SYSTEM = `You are the extraction engine of a personal "second brain".
Parse the user's raw, unstructured thought into a knowledge graph.

Identify discrete entities/ideas as NODES. For each node set:
- label: a short, distinct name (2-6 words)
- type: one of ${NODE_TYPES.join(", ")}
- content: the relevant text/summary for that node
- emotionalWeight: optional, -1 (very negative) to 1 (very positive)

Identify relationships between the nodes you extracted as EDGES, using
relationship types: ${RELATIONSHIP_TYPES.join(", ")}.
Reference nodes by their label (sourceLabel/targetLabel).

You may reference the provided EXISTING CONTEXT to reuse concepts, but only emit
NEW nodes for this input. Be precise and avoid duplicates. Output JSON only.`;

export function buildExtractionPrompt(text: string, context: ContextNode[]): string {
  const ctx =
    context.length > 0
      ? `EXISTING CONTEXT (recent nodes):\n` +
        context.map((c) => `- [${c.id}] (${c.type}) ${c.label}: ${c.content}`).join("\n")
      : `EXISTING CONTEXT: (none yet)`;
  return `${ctx}\n\nNEW INPUT:\n${text}`;
}

/** Prompt asking the model to validate/type an associative link. */
export const LINK_SYSTEM = `You decide whether two thoughts in a personal knowledge
graph should be connected by a directed edge. They are semantically similar
(cosine similarity given). Only link them if there is a meaningful conceptual
relationship. If you link them, choose a relationship type from:
${RELATIONSHIP_TYPES.join(", ")} (direction: source -> target). Output JSON only.`;

export function buildLinkPrompt(
  source: LinkCandidate,
  target: LinkCandidate,
  similarity: number,
): string {
  return `SOURCE: ${source.label} — ${source.content}
TARGET: ${target.label} — ${target.content}
COSINE_SIMILARITY: ${similarity.toFixed(3)}

Should SOURCE connect to TARGET?`;
}

/** Synthesis: surface the non-obvious connection between two distant thoughts. */
export const SYNTHESIS_SYSTEM = `You are the insight engine of a personal "second brain".
Given two thoughts that are semantically related but NOT yet connected in the
graph, write ONE concise, specific insight (1-2 sentences) about how they connect,
converge, or inform each other — the kind of non-obvious link a thoughtful friend
would point out. Also rate its strength/surprise from 0 to 1. Output JSON only.`;

export function buildSynthesisPrompt(
  a: LinkCandidate,
  b: LinkCandidate,
  similarity: number,
): string {
  return `THOUGHT A: ${a.label} — ${a.content}
THOUGHT B: ${b.label} — ${b.content}
COSINE_SIMILARITY: ${similarity.toFixed(3)}

Write the insight connecting A and B.`;
}

/** GraphRAG answer over a retrieved subgraph. */
export const ANSWER_SYSTEM = `You are a personal "second brain" answering the user's
question using ONLY the provided memory nodes (their thoughts). Synthesize across
them; be concise and personal. Cite the node ids you used in "citations". If the
memories don't cover the question, say so. Output JSON only.`;

export function buildAnswerPrompt(question: string, context: ContextNode[]): string {
  const memories =
    context.length > 0
      ? context.map((c) => `[${c.id}] (${c.type}) ${c.label}: ${c.content}`).join("\n")
      : "(no relevant memories found)";
  return `MEMORIES:\n${memories}\n\nQUESTION: ${question}`;
}
