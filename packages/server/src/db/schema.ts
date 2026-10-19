import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, index, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Relational tables for the knowledge graph. Vectors live in the separate
 * `vec_nodes` vec0 table (db/vec.ts), JOINed on node id.
 *
 * Multi-tenancy: every per-user table carries a `space_id` so one deployment can
 * host many private brains. Pre-existing rows (before spaces existed) default to
 * DEFAULT_SPACE and are claimed by the first account that registers.
 */

/** Holding space for data created before multi-tenancy; claimed on first signup. */
export const DEFAULT_SPACE = "legacy";

export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
  label: text("label").notNull(),
  celestialTitle: text("celestial_title"),
  type: text("type").notNull(),
  content: text("content").notNull(),
  emotionalWeight: real("emotional_weight"),
  importance: real("importance"),
  color: text("color"),
  // Provenance: "agent" = Soumaya-authored (e.g. a constellation hub); null/"user" = yours.
  origin: text("origin"),
  // Which autonomous agent last worked this node (e.g. "soumaya", "scout"); null = none.
  agent: text("agent"),
  deletedAt: text("deleted_at"),
  mergedInto: integer("merged_into"),
  kind: text("kind"),
  expiresAt: text("expires_at"),
  lastTendedAt: text("last_tended_at"),
  // When the memory's event actually happened (user-set, may be backdated).
  occurredAt: text("occurred_at"),
  // Future reminder to resurface this memory.
  remindAt: text("remind_at"),
  // JSON array of tag strings (curated + free-form).
  tags: text("tags"),
  researchQuestions: text("research_questions"),
  researchAnswers: text("research_answers"),
  // Cognitive layer: 0..1 progress (goal completion / skill level).
  progress: real("progress"),
  // Cognitive layer: when a goal actually finished — set once, permanent.
  completedAt: text("completed_at"),
  // Lifecycle: "active" | "archived". Archived rests out of the galaxy + retrieval (kept, not deleted).
  status: text("status").notNull().default("active"),
  // Cognitive layer: JSON array of aliases so vague memories ("my girlfriend") link
  // to a named Mind entry without the exact name.
  aliases: text("aliases"),
  // Phase 1 agent loop: idempotency key for write tools (the approval id).
  // UNIQUE(space_id, idempotency_key) — NULL keys never conflict.
  idempotencyKey: text("idempotency_key"),
  // Phase 1 agent loop: which approval fired this reminder (fire_reminder's
  // side effect is an UPDATE). Set atomically with reminder_fired_at.
  firedByApproval: integer("fired_by_approval"),
  // W1 temporal truth (wisdom layer): bitemporal columns.
  // valid_from/valid_to: when the fact was true in the real world (NULL = unknown).
  // recorded_at: when the system recorded the row (immutable). Fresh schemas get a
  // DB-level expression default as a backstop; application code always sets it
  // explicitly. Migrated schemas have nullable recorded_at (SQLite forbids
  // expression defaults on ALTER TABLE ADD COLUMN) — enforced by app code + test.
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  recordedAt: text("recorded_at"),
  // superseded_at/superseded_by/supersede_reason: transaction-time pointer.
  // NULL superseded_at = current. Plain INTEGER for superseded_by (application-
  // validated; the supersede() writer in agent/temporal.ts is the single entry
  // point). See docs/wisdom/w1-design-revision.md §7.
  supersededAt: text("superseded_at"),
  supersededBy: integer("superseded_by"),
  supersedeReason: text("supersede_reason"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const edges = sqliteTable(
  "edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    source: integer("source")
      .notNull()
      .references(() => nodes.id),
    target: integer("target")
      .notNull()
      .references(() => nodes.id),
    relationship: text("relationship").notNull(),
    weight: real("weight").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("edges_source_idx").on(t.source), index("edges_target_idx").on(t.target)],
);

/** Synthesized cross-cluster insights (the digest feature). */
export const insights = sqliteTable("insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
  nodeA: integer("node_a")
    .notNull()
    .references(() => nodes.id),
  nodeB: integer("node_b")
    .notNull()
    .references(() => nodes.id),
  text: text("text").notNull(),
  score: real("score").notNull().default(0),
  // "synthesis" (latent connection) or "contradiction" (conflicting belief/goal/identity).
  kind: text("kind").notNull().default("synthesis"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/** Logs of all autonomous agent activity. APPEND-ONLY: BEFORE UPDATE/DELETE
 * triggers (created in migrateSchema) abort any mutation. Operational state
 * lives in toolApprovals; rows here are immutable evidence. */
export const agentLogs = sqliteTable("agent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
  agent: text("agent").notNull().default("soumaya"),
  action: text("action").notNull(),
  description: text("description").notNull(),
  targets: text("targets").notNull(),
  result: text("result"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Phase 1 agent loop: operational approval state machine (MUTABLE by design).
 * States: pending -> confirmed -> executing -> executed | failed
 *         pending -> denied | expired
 * Every transition appends an agent_logs row (the immutable audit trail).
 * argsJson holds the exact args to execute — may contain user text; it is
 * operational necessity and is NEVER copied into agent_logs. Terminal rows
 * are pruned after 7 days; the audit trail is permanent.
 */
export const toolApprovals = sqliteTable("tool_approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull(),
  /** Who requested it: "telegram:<chatId>" or "web:<userId>". */
  principal: text("principal").notNull(),
  tool: text("tool").notNull(),
  argsJson: text("args_json").notNull(),
  /** sha256 of canonical args_json — confirmation binds to the exact args. */
  argsHash: text("args_hash").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  decidedAt: text("decided_at"),
  executionAttempts: integer("execution_attempts").notNull().default(0),
  lastError: text("last_error"),
  /** agent_logs.id of the successful execution audit row (set on executed). */
  executionLogId: integer("execution_log_id"),
});

/** Global configuration for the system (shared — e.g. the deployment API budget). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Append-only, versioned lore: each object (a memory, or an agent like the ship /
 * station / beacon) accrues "chapters" of its evolving story. v1 = genesis (never
 * rewritten); later versions extend it as the galaxy changes.
 */
export const lore = sqliteTable("lore", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  version: integer("version").notNull(),
  text: text("text").notNull(),
  trigger: text("trigger").notNull().default("genesis"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * AI Companion — Layer 2: user-created, stackable instruction profiles (roles she
 * adopts: Therapist, Business Advisor, …). `mode`: 'always' applies whenever
 * enabled; 'auto' is intent-routed by semantic similarity to the question.
 */
export const instructionProfiles = sqliteTable(
  "instruction_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    name: text("name").notNull(),
    body: text("body").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    mode: text("mode").notNull().default("always"),
    priority: integer("priority").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("instruction_profiles_space_idx").on(t.spaceId)],
);

/** AI Companion — a user's uploaded reference document (chunks live in knowledge_chunks). */
export const knowledgeDocs = sqliteTable(
  "knowledge_docs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    name: text("name").notNull(),
    mime: text("mime").notNull().default("text/plain"),
    charCount: integer("char_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("knowledge_docs_space_idx").on(t.spaceId)],
);

/** A retrievable chunk of a knowledge doc; its embedding lives in vec_docs (JOIN on id). */
export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    docId: integer("doc_id")
      .notNull()
      .references(() => knowledgeDocs.id),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
  },
  (t) => [index("knowledge_chunks_doc_idx").on(t.docId)],
);

/** A file attached to a specific memory note — the downloadable "doc kept inside a
 *  memory". Bytes are stored base64 in `data` (small docs; capped at the route). */
export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id),
    filename: text("filename").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    data: text("data").notNull(), // base64-encoded bytes
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("attachments_node_idx").on(t.nodeId)],
);
export type AttachmentRow = typeof attachments.$inferSelect;

/** AI Companion — "About Me": who the user is (singleton per brain). She's aware, never becomes them. */
export const userPersona = sqliteTable("user_persona", {
  spaceId: text("space_id").primaryKey(),
  body: text("body").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type InstructionProfileRow = typeof instructionProfiles.$inferSelect;
export type KnowledgeDocRow = typeof knowledgeDocs.$inferSelect;
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;

/** Aggregated visitor activity per memory + craft type (drives "most visited"). */
export const visitorStats = sqliteTable(
  "visitor_stats",
  {
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    nodeId: integer("node_id").notNull(),
    visitorType: text("visitor_type").notNull(),
    visits: integer("visits").notNull().default(0),
    lastAt: text("last_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.nodeId, t.visitorType] }),
    index("visitor_stats_space_idx").on(t.spaceId),
  ],
);

/** Summarized daily reflections on the brain's evolution. */
export const dailyLogs = sqliteTable("daily_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
  content: text("content").notNull(),
  date: text("date").notNull().default(sql`CURRENT_DATE`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/** Per-brain meta state: fuel economy, daily streak, presence, Research Mode. */
export const spaceMeta = sqliteTable("space_meta", {
  spaceId: text("space_id").primaryKey(),
  fuel: real("fuel").notNull().default(25),
  streak: integer("streak").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  lastActiveDate: text("last_active_date"),
  lastSeenAt: text("last_seen_at"),
  researchEnabled: text("research_enabled"),
  lastDreamDate: text("last_dream_date"),
  timelineBackfilled: integer("timeline_backfilled").notNull().default(0),
  streakShields: integer("streak_shields").notNull().default(2),
  soul: text("soul"),
  groundedInsight: integer("grounded_insight").notNull().default(1),
  // Phase 2 notification policy (see agent/notify/policy.ts).
  timezone: text("timezone").notNull().default("America/New_York"),
  quietStart: text("quiet_start").notNull().default("21:00"),
  quietEnd: text("quiet_end").notNull().default("04:30"),
  digestTime: text("digest_time").notNull().default("06:00"),
  dailyProactiveCap: integer("daily_proactive_cap").notNull().default(5),
  // W1 temporal truth: dependent-fact cascade gate (disabled by default = 0).
  // May only be enabled after depends_on/assumes edge semantics are verified.
  w1CascadeEnabled: integer("w1_cascade_enabled").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Phase 2: outbox for deferred proactive notifications.
 * Lifecycle: queued -> sending -> sent | failed | dropped | ambiguous.
 * - notif_key: UNIQUE dedup key = sha256(space_id|tool|occurrence_id).
 * - cap_day: local YYYY-MM-DD whose cap this counts against (NULL = uncounted).
 * - send_started_at: set immediately before the Telegram request; distinguishes
 *   definite non-delivery (NULL on crash recovery) from ambiguous outcome.
 * - ambiguous: terminal; cap retained, never auto-retried (see design doc).
 */
export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    notifKey: text("notif_key").notNull().unique(),
    spaceId: text("space_id").notNull(),
    tool: text("tool").notNull(),
    occurrenceId: text("occurrence_id").notNull(),
    message: text("message").notNull(),
    priority: text("priority").notNull().default("normal"),
    isUrgent: integer("is_urgent").notNull().default(0),
    urgentReason: text("urgent_reason"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    deliverAfter: text("deliver_after").notNull(),
    billDueAt: text("bill_due_at"),
    capDay: text("cap_day"),
    sendStartedAt: text("send_started_at"),
    claimedBy: text("claimed_by"),
    claimedAt: text("claimed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("notification_outbox_status_idx").on(t.status, t.deliverAfter),
    index("notification_outbox_space_idx").on(t.spaceId, t.capDay, t.status),
  ]
);

/** A private brain ("space"), opened by name + passcode (works across devices). */
export const spaces = sqliteTable("spaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  gamerTag: text("gamer_tag").notNull().unique(),
  passcodeHash: text("passcode_hash").notNull(),
  passcodeSalt: text("passcode_salt").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Working Memory (Cognitive Layer Phase 2): the ephemeral "mind space" — what you
 * are thinking NOW. Thought-motes decay unless reinforced; survivors are
 * consolidated into the permanent galaxy as real nodes (and the mote removed).
 * Kept SEPARATE from `nodes` so it never enters the galaxy until promoted.
 */
export const workingMemory = sqliteTable(
  "working_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    text: text("text").notNull(),
    // Where the thought came from: 'manual' | 'chat' | 'goal' | 'priority' | 'emotion'.
    source: text("source").notNull().default("manual"),
    // 0..1 charge at `reinforcedAt`; effective strength decays with elapsed time.
    strength: real("strength").notNull().default(0.6),
    reinforceCount: integer("reinforce_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    reinforcedAt: text("reinforced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("working_memory_space_idx").on(t.spaceId)],
);
export type WorkingMemoryRow = typeof workingMemory.$inferSelect;

/**
 * Inquiries — connections Soumaya notices on her own (a new memory bridging two
 * people/goals, sitting near an existing anchor, or joining an emerging theme) and
 * raises as a question. Answering ingests + links, so noticing grows the graph.
 */
export const inquiries = sqliteTable(
  "inquiries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    question: text("question").notNull(),
    kind: text("kind").notNull(),
    nodeIds: text("node_ids").notNull().default("[]"), // JSON array of involved ids
    signature: text("signature").notNull(), // dedupe key (so a dismissed one never re-asks)
    status: text("status").notNull().default("open"), // open | answered | dismissed
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("inquiries_space_idx").on(t.spaceId, t.status)],
);
export type InquiryRow = typeof inquiries.$inferSelect;

/**
 * Candidate connections — links Soumaya WITHHELD (below the auto-link confidence bar)
 * or PRUNED (weak existing links removed to declutter). They wait here for YOU to
 * review: connect it yourself or dismiss it. Canonical a<b, one row per pair.
 */
export const candidateLinks = sqliteTable(
  "candidate_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    a: integer("a").notNull(),
    b: integer("b").notNull(),
    reason: text("reason"),
    score: real("score").notNull().default(0),
    origin: text("origin").notNull().default("withheld"), // withheld | pruned | suggested
    status: text("status").notNull().default("pending"), // pending | accepted | dismissed
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("candidate_links_status_idx").on(t.spaceId, t.status)],
);
export type CandidateLinkRow = typeof candidateLinks.$inferSelect;

export type NodeRow = typeof nodes.$inferSelect;
export type EdgeRow = typeof edges.$inferSelect;
export type InsightRow = typeof insights.$inferSelect;
/**
 * W1 temporal truth: append-only correction events. Corrections are events, not
 * row mutations — a mutable flag on the node row would corrupt historical as-of
 * queries (an Oct 5 query would see a flag set on Oct 10). The "never true"
 * status is DERIVED via isNeverTrue(), never stored on the node.
 * correction_type: 'factual_update' | 'false_belief' | 'preference_override'.
 */
export const corrections = sqliteTable(
  "corrections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    nodeId: integer("node_id").notNull(),
    correctionType: text("correction_type").notNull(),
    correctedAt: text("corrected_at").notNull(),
    correctedBy: text("corrected_by").notNull(),
    reason: text("reason"),
    supersedingNodeId: integer("superseding_node_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_corrections_node").on(t.nodeId),
    index("idx_corrections_space_time").on(t.spaceId, t.correctedAt),
  ],
);
export type CorrectionRow = typeof corrections.$inferSelect;
export type AgentLogRow = typeof agentLogs.$inferSelect;
export type DailyLogRow = typeof dailyLogs.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;
export type SpaceMetaRow = typeof spaceMeta.$inferSelect;
