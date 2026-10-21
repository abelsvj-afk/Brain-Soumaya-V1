/**
 * Golden-fixture seed + assembly helper for the web chat system prompt
 * (Telegram Parity Phase 0). Used by BOTH the one-off generator
 * (`generateGolden.ts`, which produced `fixtures/webChatSystemPrompt.golden.txt`
 * from the pre-refactor base code) and the golden test itself
 * (`companionContext.test.ts`), so the fixture and the test can never drift in
 * HOW the brain is seeded or the prompt assembled — only in the code under test.
 *
 * Determinism contract:
 * - Time is frozen at GOLDEN_NOW_MS (the generator patches the global Date;
 *   the test fakes only the Date timer). Every seeded row carries an explicit
 *   created_at, and every snapshot that renders a date derives it from those.
 * - Embeddings are the deterministic HashEmbeddingProvider.
 * - The LLM is the offline HeuristicProvider behind a capturing wrapper, so
 *   no network, no key, and no randomness reach the assembled prompt.
 */
import type { DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM, upsertProfileEmbedding } from "../../db/vec.js";
import type { AnswerOptions, ContextNode } from "../../llm/adapter.js";
import { composeSystem } from "../../llm/prompts.js";
import { chat, DEFAULT_CHAT } from "../graphrag.js";
import { InstructionProfilesRepo } from "../../repositories/instructions.repo.js";
import { InsightsRepo } from "../../repositories/insights.repo.js";

export const GOLDEN_SPACE = "golden-space";
/** Wednesday 2026-10-21 16:00 UTC = 12:00 EDT (America/New_York). */
export const GOLDEN_NOW_MS = Date.parse("2026-10-21T16:00:00.000Z");
export const GOLDEN_QUESTION = "Tell me about grilling and the cookout with my father";
/** Total live nodes seeded into GOLDEN_SPACE (asserted by the loop test). */
export const GOLDEN_TOTAL_NODES = 9;

interface SeedNode {
  label: string;
  type: string;
  content: string;
  emotionalWeight?: number;
  importance?: number;
  kind?: string;
  progress?: number;
  tags?: string[];
  createdAt: string;
}

const SEED_NODES: SeedNode[] = [
  {
    label: "Morning reflection on patience",
    type: "reflection",
    content: "Patience at work keeps paying off in small ways.",
    emotionalWeight: 0.4,
    importance: 0.85,
    tags: ["family", "growth"],
    createdAt: "2026-10-01T12:00:00.000Z",
  },
  {
    label: "Cookout with father",
    type: "memory",
    content: "Grilling at the cookout with my father Walter, who taught me his barbecue technique.",
    emotionalWeight: 0.6,
    importance: 0.5,
    tags: ["family"],
    createdAt: "2026-10-05T12:00:00.000Z",
  },
  {
    label: "Evening walk with Mara",
    type: "memory",
    content: "A slow evening walk around the lake with Mara.",
    emotionalWeight: 0.2,
    importance: 0.3,
    tags: ["health"],
    createdAt: "2026-10-10T12:00:00.000Z",
  },
  {
    label: "Community garden plan",
    type: "idea",
    content: "A plan for a community garden on the empty lot by the school.",
    emotionalWeight: 0.5,
    importance: 0.75,
    tags: ["growth"],
    createdAt: "2026-10-12T12:00:00.000Z",
  },
  {
    label: "Note on staying patient at work",
    type: "reflection",
    content: "Staying patient during the warehouse rush is harder some days.",
    emotionalWeight: -0.1,
    importance: 0.4,
    tags: ["work"],
    createdAt: "2026-10-15T12:00:00.000Z",
  },
  {
    label: "Dad fixed the porch light",
    type: "memory",
    content: "My father Walter fixed the porch light and stayed for dinner.",
    emotionalWeight: 0.7,
    importance: 0.45,
    tags: ["family"],
    createdAt: "2026-10-18T12:00:00.000Z",
  },
  {
    label: "Walter Reyes",
    type: "concept",
    content: "Walter Reyes is my father. He taught me to grill.",
    kind: "person_entity",
    createdAt: "2026-09-20T12:00:00.000Z",
  },
  {
    label: "Run a community kitchen",
    type: "concept",
    content: "Open a community kitchen that teaches families to cook together.",
    kind: "goal",
    progress: 0.25,
    createdAt: "2026-09-25T12:00:00.000Z",
  },
  {
    label: "Call the clinic",
    type: "task",
    content: "Call the clinic to reschedule the checkup.",
    kind: "action",
    importance: 0.6,
    createdAt: "2026-10-19T12:00:00.000Z",
  },
];

/** Seed the deterministic golden brain into GOLDEN_SPACE. Returns node ids by label. */
export async function seedGoldenBrain(handle: DbHandle): Promise<Map<string, number>> {
  // Pin the fuel economy BEFORE anything lazily creates the space_meta row:
  // EconomyRepo credits passive regen from the row's DB-clock updated_at
  // against the (frozen) JS clock, which would make the telemetry fuel line
  // depend on the real time of day the test happens to run. A future
  // updated_at makes regen a no-op, so fuel renders at its 25.0 start value.
  handle.sqlite
    .prepare(`INSERT OR IGNORE INTO space_meta (space_id, fuel, updated_at) VALUES (?, 25, '2027-01-01T00:00:00.000Z')`)
    .run(GOLDEN_SPACE);
  const ids = new Map<string, number>();
  const insert = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, kind, progress, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const n of SEED_NODES) {
    const r = insert.run(
      GOLDEN_SPACE,
      n.label,
      n.type,
      n.content,
      n.emotionalWeight ?? null,
      n.importance ?? null,
      n.kind ?? null,
      n.progress ?? null,
      n.tags ? JSON.stringify(n.tags) : null,
      n.createdAt,
    );
    ids.set(n.label, Number(r.lastInsertRowid));
  }
  // The two father memories "support" the tracked person (the Mind-tab roster
  // and its interaction counts/tone are derived from these edges).
  const personId = ids.get("Walter Reyes")!;
  const edge = handle.sqlite.prepare(
    `INSERT INTO edges (space_id, source, target, relationship, weight, created_at) VALUES (?, ?, ?, 'supports', 1, ?)`,
  );
  edge.run(GOLDEN_SPACE, ids.get("Cookout with father")!, personId, "2026-10-05T12:00:00.000Z");
  edge.run(GOLDEN_SPACE, ids.get("Dad fixed the porch light")!, personId, "2026-10-18T12:00:00.000Z");

  // One latent insight so the telemetry INSIGHTS section is exercised.
  new InsightsRepo(handle, GOLDEN_SPACE).create(
    ids.get("Morning reflection on patience")!,
    ids.get("Community garden plan")!,
    "Patience and the garden plan keep showing up together",
    0.8,
  );

  // Instruction profiles: one 'always', one 'auto' that the golden question
  // routes in, one 'auto' on an unrelated topic that must stay out.
  const embeddings = new HashEmbeddingProvider(EMBED_DIM);
  const repo = new InstructionProfilesRepo(handle, GOLDEN_SPACE);
  const profiles = [
    { name: "Family Coach", body: "GOLDEN_ALWAYS_BODY speak about family with warmth and patience", mode: "always" as const, priority: 5 },
    { name: "Grilling Mentor", body: "grilling barbecue cookout father technique GOLDEN_AUTO_BODY", mode: "auto" as const, priority: 1 },
    { name: "Tax Helper", body: "quarterly tax depreciation spreadsheets payroll GOLDEN_TAX_BODY", mode: "auto" as const, priority: 1 },
  ];
  for (const p of profiles) {
    const row = repo.create({ name: p.name, body: p.body, mode: p.mode, priority: p.priority });
    upsertProfileEmbedding(handle.sqlite, row.id, await embeddings.embed(`${p.name}\n${p.body}`));
  }
  return ids;
}

/** Records the AnswerOptions handed to answer(), then delegates to the heuristic. */
export class CapturingLlm extends HeuristicProvider {
  lastOpts: AnswerOptions | undefined;
  async answer(question: string, context: ContextNode[], opts?: AnswerOptions) {
    this.lastOpts = opts;
    return super.answer(question, context, opts);
  }
}

/**
 * Run the web chat path once over the golden brain and return the FULLY
 * assembled system prompt exactly as a cloud provider would build it:
 * composeSystem() over the captured AnswerOptions, with "now" pinned to
 * GOLDEN_NOW_MS (the providers call composeSystem without nowMs, i.e. wall
 * clock — pinning it here is what makes the golden comparable at all).
 */
export async function assembleGoldenSystemPrompt(handle: DbHandle): Promise<string> {
  const embeddings = new HashEmbeddingProvider(EMBED_DIM);
  const llm = new CapturingLlm();
  await chat(handle, { embeddings, llm }, GOLDEN_QUESTION, DEFAULT_CHAT, GOLDEN_SPACE);
  const opts = llm.lastOpts;
  if (!opts) throw new Error("chat() never called llm.answer()");
  return composeSystem({
    soul: opts.soul,
    persona: opts.persona,
    systemExtra: opts.systemExtra,
    timezone: opts.timezone,
    nowMs: GOLDEN_NOW_MS,
  });
}
