import { z } from "zod";

/**
 * Zod schemas. These are the single source of truth for runtime validation
 * AND are converted into the Gemini `responseSchema` in Phase II, so the LLM
 * is forced to emit exactly this structure.
 */

export const NodeTypeSchema = z.enum([
  "business_idea",
  "relationship_reflection",
  "random_thought",
  "person",
  "concept",
  "other",
]);

export const RelationshipTypeSchema = z.enum([
  "resolves",
  "complicates",
  "is_analogous_to",
  "builds_on",
  "relates_to",
  "contradicts",
  "caused_by",
]);

/** A single node the LLM extracts from a raw thought. */
export const ExtractedNodeSchema = z.object({
  label: z.string().min(1).describe("Short human-readable name for this entity/idea"),
  type: NodeTypeSchema,
  content: z.string().describe("The relevant text/summary for this node"),
  emotionalWeight: z
    .number()
    .min(-1)
    .max(1)
    .optional()
    .describe("Emotional valence from -1 (negative) to 1 (positive)"),
});

/** An edge the LLM proposes between two extracted nodes (referenced by label). */
export const ExtractedEdgeSchema = z.object({
  sourceLabel: z.string().min(1),
  targetLabel: z.string().min(1),
  relationship: RelationshipTypeSchema,
});

/** Full deterministic payload returned by the extraction LLM. */
export const ExtractionResultSchema = z.object({
  nodes: z.array(ExtractedNodeSchema),
  edges: z.array(ExtractedEdgeSchema),
});

export type ExtractedNode = z.infer<typeof ExtractedNodeSchema>;
export type ExtractedEdge = z.infer<typeof ExtractedEdgeSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
