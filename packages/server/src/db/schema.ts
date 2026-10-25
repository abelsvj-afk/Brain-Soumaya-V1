import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, blob, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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
    // W3 §5.5 (migration-only column): the typed contradiction this inquiry
    // asks about; NULL for pre-W3 / non-contradiction inquiries. Deduped by
    // idx_inquiries_contradiction UNIQUE(space_id, contradiction_id).
    contradictionId: integer("contradiction_id"),
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

/** Server-backed Inbox notifications (IM-74) — one row per real away-event.
 *  Retention (Q7 interim default): persist until the user clears them; the
 *  repository drops only the oldest past a high disclosed cap. */
export const inboxNotifications = sqliteTable(
  "inbox_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    source: text("source").notNull(), // digest | insight | discovery | bill-risk
    text: text("text").notNull(),
    icon: text("icon").notNull().default("🔔"),
    priority: text("priority").notNull().default("normal"), // low | normal | high
    dedupeKey: text("dedupe_key"),
    seenAt: text("seen_at"),
    snoozedUntil: text("snoozed_until"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index("inbox_notifications_space_idx").on(t.spaceId, t.id),
    uniqueIndex("inbox_notifications_dedupe_idx").on(t.spaceId, t.dedupeKey),
  ],
);
export type InboxNotificationRow = typeof inboxNotifications.$inferSelect;
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

// INSERT INTO packages/server/src/db/schema.ts
// AFTER line 474 (the `);` closing the corrections sqliteTable), BEFORE line 475
// (`export type CorrectionRow = typeof corrections.$inferSelect;`).
//
// IMPORT CHANGE (line 2): add `blob` and `uniqueIndex` to the drizzle-orm/sqlite-core import:
//   import { sqliteTable, integer, text, real, blob, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
//
// W1 pattern followed: fresh-schema defaults via sql template (strftime expression
// for created_at, matching the BOOTSTRAP_SQL expression defaults), DEFAULT_SPACE
// for space_id columns that have a DB default, nullable where the DDL is nullable.
// CHECK constraints and table-level UNIQUEs are DB-enforced; drizzle mirrors the
// UNIQUEs as named uniqueIndex (see NOTES.md). No drizzle definition for
// episodes_fts — same as node FTS (nodes_fts has none; all access is raw SQL in db/fts.ts).

/**
 * W2 episodic memory: immutable episode captures (Tulving-style). Capture
 * columns are immutable — no UPDATE path exists in code except
 * applyForgetRequest(), which may only write the fixed tombstone constant
 * under an approved user forget request (§3.7). kind / enrichment_status
 * vocabularies are enforced by DB CHECK (fresh schema) and application
 * validation on the migration path (same pattern as W1 reason codes).
 */
export const episodes = sqliteTable(
  "episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    occurredAt: text("occurred_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
    // application-enforced reference → episodes.id (no SQL FK, §8.5)
    correctsEpisodeId: integer("corrects_episode_id"),
    enrichmentStatus: text("enrichment_status").notNull().default("pending"),
    enrichmentAttempts: integer("enrichment_attempts").notNull().default(0),
    enrichmentLease: text("enrichment_lease"),
    enrichmentFence: text("enrichment_fence"),
    enrichedAt: text("enriched_at"),
    forgottenAt: text("forgotten_at"),
    // W3 §4.3/§8.6 (migration-only column): durable source-lineage key.
    // NULL = lineage unknown (pre-W3 rows; never a synthetic singleton).
    lineageKey: text("lineage_key"),
    // Which lineage rule fired for corrections: 'inherited' | 'new_subject' |
    // 'new_slot'; NULL for non-corrections and unknown-lineage rows.
    lineageBasis: text("lineage_basis"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index("idx_episodes_space_time").on(t.spaceId, t.occurredAt),
    index("idx_episodes_kind").on(t.spaceId, t.kind),
    index("idx_episodes_corrects").on(t.correctsEpisodeId),
    index("idx_episodes_enrichment")
      .on(t.enrichmentStatus, t.enrichmentLease)
      .where(sql`enrichment_status IN ('pending','failed_retryable')`),
  ],
);
export type EpisodeRow = typeof episodes.$inferSelect;

/**
 * W2: versioned interpretation of an episode. Re-enrichment creates a new
 * version and supersedes the old — never mutates in place (B1, Rev 3).
 * References are application-enforced, not SQL FKs (§8.5).
 */
export const episodeEnrichments = sqliteTable(
  "episode_enrichments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    episodeId: integer("episode_id").notNull(),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    version: integer("version").notNull(),
    detail: text("detail"),
    emotion: text("emotion"),
    emotionalWeight: real("emotional_weight"),
    importance: real("importance").notNull().default(0.5),
    participants: text("participants").notNull().default("[]"),
    place: text("place"),
    sourceNodeIds: text("source_node_ids").notNull().default("[]"),
    sourceTranscriptRef: text("source_transcript_ref"),
    fieldProvenance: text("field_provenance").notNull().default("{}"),
    embedding: blob("embedding", { mode: "buffer" }),
    // application-enforced reference → episode_enrichments.id (newer version); NULL = current
    supersededBy: integer("superseded_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index("idx_enrichments_episode").on(t.episodeId, t.version),
    index("idx_enrichments_current")
      .on(t.episodeId)
      .where(sql`superseded_by IS NULL`),
    // Mirrors the SQL table-level UNIQUE (episode_id, version) — behavioral equivalent.
    uniqueIndex("uq_enrichments_episode_version").on(t.episodeId, t.version),
  ],
);
export type EpisodeEnrichmentRow = typeof episodeEnrichments.$inferSelect;

/**
 * W2 user model: first-order theory of mind — what the system believes about
 * the user, with evidence and confidence. Entries supersede (invalid_at +
 * replaced_by); never deleted except under the forget contract (§3.7).
 * confidence = P(user currently holds this mental state | evidence) — NOT
 * P(content is objectively true). Truth-tracking is explicitly out of scope.
 */
export const userModel = sqliteTable(
  "user_model",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull().default(DEFAULT_SPACE),
    slot: text("slot").notNull(),
    // One proposition per row (B4): a single atomic claim.
    content: text("content").notNull(),
    confidence: real("confidence").notNull(),
    evidenceStrength: real("evidence_strength").notNull().default(0),
    // JSON array of {type: 'episode'|'node'|'correction'|'enrichment', id: N}.
    // Non-empty required (INV-EV-1); validated by validateEvidenceRefs().
    evidenceIds: text("evidence_ids").notNull().default("[]"),
    // JSON array of controlled topic labels (§6.2); '[]' = topic uncertain.
    topicLabels: text("topic_labels").notNull().default("[]"),
    validAt: text("valid_at").notNull(),
    invalidAt: text("invalid_at"),
    invalidReason: text("invalid_reason"),
    // application-enforced reference → user_model.id (the superseding entry)
    replacedBy: integer("replaced_by"),
    origin: text("origin").notNull(),
    // W3 §6.4 (migration-only columns): review flags — the only fields
    // maintenance may write on a stated row (SetReviewFlag). Values:
    // 'evidence_withdrawn' | 'stale_emotion' | 'contradiction_pending'.
    reviewFlag: text("review_flag"),
    reviewFlaggedAt: text("review_flagged_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index("idx_user_model_current")
      .on(t.spaceId, t.slot)
      .where(sql`invalid_at IS NULL`),
    index("idx_user_model_origin").on(t.spaceId, t.origin),
    index("idx_user_model_replaced").on(t.replacedBy),
    // Mirrors the SQL table-level UNIQUE (space_id, slot, content, valid_at) — behavioral equivalent.
    uniqueIndex("uq_user_model_entry").on(t.spaceId, t.slot, t.content, t.validAt),
  ],
);
export type UserModelRow = typeof userModel.$inferSelect;

/**
 * W2 forget / deletion contract: user-authorized forget requests. Scope is
 * resolved to IDs + controlled topic labels at approval time; the free-text
 * target_query is nulled at approval (content-free audit, §3.7).
 *
 * Fix round 3 (forget-request binding, D1): target_source_id names the
 * exact source a source-forget request authorizes. NULL on legacy /
 * episodic rows — NULL can never authorize a source forget (D5).
 */
export const forgetRequests = sqliteTable(
  "forget_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull(),
    requestedBy: text("requested_by").notNull().default("user"),
    targetEpisodeId: integer("target_episode_id"),
    targetNodeId: integer("target_node_id"),
    // Set to NULL at approval time — never retained after scope confirmation.
    targetQuery: text("target_query"),
    // Fix round 3 (D1): the bound source id for a source-forget request.
    targetSourceId: integer("target_source_id"),
    scopeEpisodeIds: text("scope_episode_ids").notNull().default("[]"),
    scopeNodeIds: text("scope_node_ids").notNull().default("[]"),
    scopeTopics: text("scope_topics").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    appliedAt: text("applied_at"),
  },
  (t) => [
    // Fix round 3 (D9): at most one live (pending/approved) source-forget
    // request per source per space. Mirrors the SQL partial unique index
    // in db/client.ts migrateSchema; NULLs never conflict.
    uniqueIndex("idx_forget_requests_live_source")
      .on(t.spaceId, t.targetSourceId)
      .where(sql`status IN ('pending', 'approved')`),
  ],
);
export type ForgetRequestRow = typeof forgetRequests.$inferSelect;

/**
 * W2 enrichment quota ledger (B4, Rev 3): atomic check-and-increment
 * reservation for the daily enrichment cap. quota_date is YYYY-MM-DD in the
 * SPACE's local timezone, computed by spaceLocalDate() — never SQLite
 * date('now') (B7 Rev 4).
 */
export const enrichmentQuota = sqliteTable(
  "enrichment_quota",
  {
    spaceId: text("space_id").notNull(),
    quotaDate: text("quota_date").notNull(),
    claimed: integer("claimed").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.quotaDate] })],
);
export type EnrichmentQuotaRow = typeof enrichmentQuota.$inferSelect;

/**
 * W3 consolidation run (design Rev 11 §8.2): one row per space per quiet
 * window, claimed atomically via UNIQUE(space_id, window_date). The fence
 * token guards finalization; stated_integrity_hash is the run-start snapshot
 * of the protected stated state (§6.1), compared at finalize.
 */
export const consolidationRuns = sqliteTable(
  "consolidation_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull(),
    windowDate: text("window_date").notNull(),
    fence: text("fence").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    status: text("status").notNull().default("running"),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    itemsProcessed: integer("items_processed").notNull().default(0),
    llmCalls: integer("llm_calls").notNull().default(0),
    contradictionsResolved: integer("contradictions_resolved").notNull().default(0),
    consolidationsWritten: integer("consolidations_written").notNull().default(0),
    statedIntegrityHash: text("stated_integrity_hash"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    index("idx_consolidation_runs_space").on(t.spaceId, t.startedAt),
    // Mirrors the SQL table-level UNIQUE (space_id, window_date).
    uniqueIndex("uq_consolidation_runs_window").on(t.spaceId, t.windowDate),
  ],
);
export type ConsolidationRunRow = typeof consolidationRuns.$inferSelect;

/**
 * W3 work-item ledger (§8.3): one row per (space, episode) — the durable
 * identity of an episode's consolidation decision per evidence state.
 * evidence_group_set is the canonical JSON array of lineage keys the
 * decision was based on; evidence_fingerprint is its SHA-256 identity.
 */
export const consolidationEpisodes = sqliteTable(
  "consolidation_episodes",
  {
    spaceId: text("space_id").notNull(),
    episodeId: integer("episode_id").notNull(),
    outcome: text("outcome").notNull(),
    resultingEntryId: integer("resulting_entry_id"),
    evidenceGroupSet: text("evidence_group_set").notNull(),
    evidenceFingerprint: text("evidence_fingerprint").notNull(),
    lastRunId: integer("last_run_id").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.episodeId] })],
);
export type ConsolidationEpisodeRow = typeof consolidationEpisodes.$inferSelect;

/**
 * W3 typed contradiction record (§5.1/§8.4): two-sided identity (old/new
 * kind+id), claim/fencing state machine, and report_ref dedup. Replaces the
 * W1-era free-form potential_contradiction log rows as the adjudication
 * backlog. References are application-enforced (no SQL FKs, §8.5 pattern).
 */
export const contradictions = sqliteTable(
  "contradictions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull(),
    domain: text("domain").notNull(), // 'nodes' | 'user_model'
    oldKind: text("old_kind").notNull(),
    oldId: integer("old_id").notNull(),
    newKind: text("new_kind").notNull(),
    newId: integer("new_id").notNull(),
    category: text("category").notNull(),
    reportedBy: text("reported_by").notNull(),
    reportRef: text("report_ref"),
    // application-enforced reference → contradictions.id (the record this
    // one reopens after a terminal state); NULL for first reports.
    reopensId: integer("reopens_id"),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimedByRun: integer("claimed_by_run"),
    claimFence: text("claim_fence"),
    leaseExpiresAt: text("lease_expires_at"),
    resolution: text("resolution"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    // Mirror of the SQL partial unique index (active pair uniqueness).
    uniqueIndex("idx_contradictions_pair")
      .on(t.spaceId, t.domain, t.oldKind, t.oldId, t.newKind, t.newId)
      .where(sql`state IN ('pending','claimed')`),
    uniqueIndex("idx_contradictions_pair_ref").on(
      t.spaceId,
      t.domain,
      t.oldKind,
      t.oldId,
      t.newKind,
      t.newId,
      t.reportRef,
    ),
  ],
);
export type ContradictionRow = typeof contradictions.$inferSelect;

/**
 * W3 access telemetry (§7.2/§8.5): read-serving access counts in a SEPARATE
 * table so retrieval reads never write the episodes/user_model rows
 * themselves (capture-field immutability, W2 INV-EP-1).
 */
export const accessStats = sqliteTable(
  "access_stats",
  {
    entityType: text("entity_type").notNull(), // 'episode' | 'user_model_entry' | 'node'
    entityId: integer("entity_id").notNull(),
    lastAccessedAt: text("last_accessed_at").notNull(),
    accessCount: integer("access_count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entityId] })],
);
export type AccessStatRow = typeof accessStats.$inferSelect;

/**
 * W3 reconciliation durable progress (§5.6/§8.6): one row per space. The
 * cursor is the exclusive (valid_at, id) bound of the last FULLY processed
 * consolidated belief; partial_* is the pair-level marker for a belief whose
 * examination was cut short by the pairs budget, validated against
 * space_meta.stated_set_version (partial_stated_version).
 */
export const w3ReconProgress = sqliteTable("w3_recon_progress", {
  spaceId: text("space_id").primaryKey(),
  cursorValidAt: text("cursor_valid_at"),
  cursorId: integer("cursor_id"),
  partialValidAt: text("partial_valid_at"),
  partialId: integer("partial_id"),
  partialStatedOverlap: real("partial_stated_overlap"),
  partialStatedId: integer("partial_stated_id"),
  partialStatedVersion: integer("partial_stated_version"),
  lastPassCompletedAt: text("last_pass_completed_at"),
  updatedAt: text("updated_at").notNull(),
});
export type W3ReconProgressRow = typeof w3ReconProgress.$inferSelect;

/**
 * W3 reconciliation semantic queue (§5.6/§8.6): durable ambiguous-pair work
 * items for the bounded LLM pass. Rows are deleted on resolution (judged,
 * filed, either side no longer current, or attempts exhausted).
 */
export const w3ReconSemanticQueue = sqliteTable(
  "w3_recon_semantic_queue",
  {
    spaceId: text("space_id").notNull(),
    consolidatedId: integer("consolidated_id").notNull(),
    statedId: integer("stated_id").notNull(),
    similarity: real("similarity").notNull(),
    queuedAt: text("queued_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.consolidatedId, t.statedId] })],
);
export type W3ReconSemanticQueueRow = typeof w3ReconSemanticQueue.$inferSelect;
export type CorrectionRow = typeof corrections.$inferSelect;
export type AgentLogRow = typeof agentLogs.$inferSelect;
export type DailyLogRow = typeof dailyLogs.$inferSelect;
export type SpaceRow = typeof spaces.$inferSelect;
export type SpaceMetaRow = typeof spaceMeta.$inferSelect;
