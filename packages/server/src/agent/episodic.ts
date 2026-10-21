/**
 * W2 episodic memory: episodes (immutable capture) + versioned enrichments.
 *
 * Canonical design: ~/workspace/w2-impl/w2-design-canonical.md (§§3, 5, 8.2).
 *
 * Core principle (design §2.6): the captured event is IMMUTABLE. Interpretation
 * lives in separate, versioned enrichment records that can be superseded but
 * never rewrite the capture. The sole exception is the user-authorized
 * redaction in applyForgetRequest() (§3.7).
 *
 * Invariants enforced here (violating any = fail):
 * - INV-EP-1: no UPDATE of episodes capture columns except applyForgetRequest()
 *   (tombstone only). This module contains exactly one UPDATE of
 *   episodes.summary, inside applyForgetRequest().
 * - INV-DEL-1: no DELETE statements except inside applyForgetRequest().
 * - INV-ENRICH-1: generated-labeled content is quarantined from the user-model
 *   evidence pipeline (evidenceSafeFields()).
 * - INV-ENRICH-2: NULL interpretive fields mean "not reported", never "not yet
 *   enriched" — validateProvenance() requires explicit not_reported labels.
 * - INV-ENRICH-3: direct_quote fields must be substrings of the source text.
 * - INV-ENRICH-4: provenance coverage is complete — no populated interpretive
 *   field lacks a valid label (validateProvenance() at write time,
 *   evidenceSafeFields() fails closed at read time).
 *
 * Conventions (from the deploy branch):
 * - handle: DbHandle ({ db: drizzle, sqlite: RawDb }); raw SQL goes through
 *   handle.sqlite (better-sqlite3).
 * - Canonical timestamps: new Date().toISOString(); DB expression defaults
 *   strftime('%Y-%m-%dT%H:%M:%fZ','now') as a backstop.
 * - agent_logs: INSERT-only, templated, content-free (IDs and reason codes).
 * - space_id is TEXT on all W2 tables.
 * - Schema creation lives in db/schemaSql.ts BOOTSTRAP_SQL (repo rule, design
 *   §8.1); W2_DDL below is the self-contained equivalent for tests. The
 *   functions in this module assume the tables exist.
 */

import { randomBytes } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import {
  EMBED_DIM,
  cosineSimilarity,
  isVectorEnabled,
  type RawDb,
} from "../db/vec.js";
import { recordAccess } from "./consolidation/retrievals.js";
import { parseTolerantMs } from "../lib/time.js";

// ---------------------------------------------------------------------------
// Vocabularies & constants
// ---------------------------------------------------------------------------

/** Episode kinds — closed vocabulary (design §3.4). Mirrored by the CHECK
 *  constraint in the fresh schema; validated in application code on the
 *  migration path. */
export const EPISODE_KINDS = [
  "conversation",
  "agent_action",
  "job_run",
  "digest_sent",
  "proactive_msg",
  "correction",
  "milestone",
  "session",
] as const;
export type EpisodeKind = (typeof EPISODE_KINDS)[number];

/** Controlled emotion vocabulary (design §3.3). NULL is always valid and means
 *  "not reported" — a label is never forced. */
export const EMOTION_LABELS = [
  "anxious",
  "relieved",
  "proud",
  "frustrated",
  "hopeful",
  "overwhelmed",
  "grateful",
  "lonely",
  "determined",
  "ashamed",
  "content",
  "angry",
  "sad",
  "excited",
  "neutral",
] as const;
export type EmotionLabel = (typeof EMOTION_LABELS)[number];

/** Field-level provenance labels (design §3.3). */
export const PROVENANCE_LABELS = [
  "direct_quote",
  "explicit",
  "inferred",
  "generated",
  "not_reported",
] as const;
export type ProvenanceLabel = (typeof PROVENANCE_LABELS)[number];

/** Per-field allowed provenance labels (design §3.3, B5 Rev 4). */
const ALLOWED_PROVENANCE: Record<string, ReadonlySet<ProvenanceLabel>> = {
  detail: new Set(["direct_quote", "explicit", "generated", "not_reported"]),
  emotion: new Set(["direct_quote", "explicit", "inferred", "not_reported"]),
  emotional_weight: new Set(["explicit", "inferred", "not_reported"]),
  importance: new Set(["inferred"]), // always a judgment call
  participants: new Set(["explicit", "inferred", "not_reported"]),
  place: new Set(["explicit", "inferred", "not_reported"]),
  source_node_ids: new Set(["explicit"]), // mechanical link, never interpretation
  embedding: new Set(["explicit"]), // deterministic computation, not interpretation
};

/** Interpretive fields whose populated state requires a provenance label.
 *  `importance` is handled separately (only "populated" when != 0.5 default);
 *  `source_node_ids`/`embedding` are mechanical, not interpretive. */
const INTERPRETIVE_FIELDS = [
  "detail",
  "emotion",
  "emotional_weight",
  "participants",
  "place",
] as const;

/** Enrichment lifecycle states (design §3.5). */
export const ENRICHMENT_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed_retryable",
  "failed_permanent",
] as const;

/** Maximum LLM-backed enrichment attempts per episode. The claim that would be
 *  attempt 4 transitions the row to failed_permanent instead (design §3.5,
 *  predicate `enrichment_attempts > 3` — prose, SQL, and tests agree). */
export const MAX_ENRICHMENT_ATTEMPTS = 3;

/** Worker claim lease duration (design §3.5). */
export const ENRICHMENT_LEASE_MS = 10 * 60 * 1000;

/** Default daily enrichment cap (space_meta.episode_enrich_daily_cap). */
export const DEFAULT_ENRICH_DAILY_CAP = 20;

/** Default space timezone when space_meta has no row (design §3.5, B7 Rev 4). */
export const DEFAULT_TIMEZONE = "America/New_York";

/** Canonical tombstone format (design §3.7, B9 Rev 4): one format, everywhere.
 *  N is always the forget_requests.id — every tombstone is traceable to its
 *  authorizing request without revealing content. */
export const TOMBSTONE = (requestId: number): string =>
  `[redacted per forget request #${requestId}]`;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  readonly field: string;
  readonly reason: string;
  readonly referencedId?: number;
  constructor(field: string, reason: string, message?: string, referencedId?: number) {
    super(message ?? `Validation failed: field=${field} reason=${reason}`);
    this.name = "ValidationError";
    this.field = field;
    this.reason = reason;
    if (referencedId !== undefined) this.referencedId = referencedId;
  }
}

/** Thrown inside the enrichment commit transaction when the commit predicate
 *  matches 0 rows (stale fence, forgotten episode, or reclaimed claim). The
 *  transaction aborts; no partial state is ever visible. */
class CommitRejectedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Enrichment commit rejected: ${reason}`);
    this.name = "CommitRejectedError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface EpisodeRow {
  id: number;
  space_id: string;
  kind: EpisodeKind;
  summary: string;
  occurred_at: string;
  recorded_at: string;
  corrects_episode_id: number | null;
  enrichment_status: string;
  enrichment_attempts: number;
  enrichment_lease: string | null;
  enrichment_fence: string | null;
  enriched_at: string | null;
  forgotten_at: string | null;
  /** W3 §4.3: durable source-lineage key; NULL = lineage unknown. */
  lineage_key: string | null;
  /** W3 §4.3: 'inherited' | 'new_subject' | 'new_slot' for corrections. */
  lineage_basis: string | null;
  created_at: string;
}

export interface EpisodeEnrichmentRow {
  id: number;
  episode_id: number;
  space_id: string;
  version: number;
  detail: string | null;
  emotion: string | null;
  emotional_weight: number | null;
  importance: number;
  participants: string; // JSON array
  place: string | null;
  source_node_ids: string; // JSON array
  source_transcript_ref: string | null;
  field_provenance: string; // JSON object field -> label
  embedding: Buffer | null;
  superseded_by: number | null;
  created_at: string;
}

export interface ForgetRequestRow {
  id: number;
  space_id: string;
  requested_by: string;
  target_episode_id: number | null;
  target_node_id: number | null;
  target_query: string | null;
  scope_episode_ids: string; // JSON array
  scope_node_ids: string; // JSON array
  scope_topics: string; // JSON array of controlled topic labels
  status: "pending" | "approved" | "applied" | "rejected";
  created_at: string;
  applied_at: string | null;
}

// ---------------------------------------------------------------------------
// DDL (self-contained equivalent; the repo's schema of record is
// db/schemaSql.ts BOOTSTRAP_SQL per design §8.1)
// ---------------------------------------------------------------------------

/** Build the W2 DDL. sqlite-vec dimension is runtime-configured (EMBED_DIM),
 *  so the vec0 table definition is generated, not static. */
export function w2Ddl(): string {
  return `
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL DEFAULT 'legacy',
  kind TEXT NOT NULL CHECK (kind IN (
    'conversation','agent_action','job_run','digest_sent',
    'proactive_msg','correction','milestone','session'
  )),
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  corrects_episode_id INTEGER,
  enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','processing','completed','failed_retryable','failed_permanent')),
  enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  enrichment_lease TEXT,
  enrichment_fence TEXT,
  enriched_at TEXT,
  forgotten_at TEXT,
  lineage_key TEXT,
  lineage_basis TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_space_time ON episodes(space_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_episodes_kind ON episodes(space_id, kind);
CREATE INDEX IF NOT EXISTS idx_episodes_corrects ON episodes(corrects_episode_id);
CREATE INDEX IF NOT EXISTS idx_episodes_enrichment ON episodes(enrichment_status, enrichment_lease)
  WHERE enrichment_status IN ('pending','failed_retryable');
CREATE TABLE IF NOT EXISTS episode_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  space_id TEXT NOT NULL DEFAULT 'legacy',
  version INTEGER NOT NULL,
  detail TEXT,
  emotion TEXT CHECK (emotion IN (
    'anxious','relieved','proud','frustrated','hopeful','overwhelmed',
    'grateful','lonely','determined','ashamed','content','angry',
    'sad','excited','neutral'
  )),
  emotional_weight REAL CHECK (emotional_weight IS NULL OR (emotional_weight >= -1 AND emotional_weight <= 1)),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  participants TEXT NOT NULL DEFAULT '[]',
  place TEXT,
  source_node_ids TEXT NOT NULL DEFAULT '[]',
  source_transcript_ref TEXT,
  field_provenance TEXT NOT NULL DEFAULT '{}',
  embedding BLOB,
  superseded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (episode_id, version)
);
CREATE INDEX IF NOT EXISTS idx_enrichments_episode ON episode_enrichments(episode_id, version);
CREATE INDEX IF NOT EXISTS idx_enrichments_current ON episode_enrichments(episode_id) WHERE superseded_by IS NULL;
CREATE TABLE IF NOT EXISTS enrichment_quota (
  space_id TEXT NOT NULL,
  quota_date TEXT NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  PRIMARY KEY (space_id, quota_date)
);
CREATE TABLE IF NOT EXISTS forget_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'user' CHECK (requested_by = 'user'),
  target_episode_id INTEGER,
  target_node_id INTEGER,
  target_query TEXT,
  scope_episode_ids TEXT NOT NULL DEFAULT '[]',
  scope_node_ids TEXT NOT NULL DEFAULT '[]',
  scope_topics TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(summary, detail);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_episodes USING vec0(
  episode_id INTEGER PRIMARY KEY,
  embedding float[${EMBED_DIM}] distance_metric=cosine
);`;
}

/** Idempotent table bootstrap for tests / self-contained setups. In the repo,
 *  table creation lives in db/schemaSql.ts BOOTSTRAP_SQL (design §8.1); this
 *  helper mirrors it so the module is testable standalone. */
export function bootstrapEpisodicTables(sqlite: RawDb): void {
  sqlite.exec(w2Ddl());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** INSERT-only, templated, content-free audit row (repo convention, cf.
 *  agent/temporal.ts). `description` carries IDs and reason codes only — never
 *  memory text. */
function logAgent(
  h: DbHandle,
  spaceId: string,
  action: string,
  description: string,
  targets: Record<string, unknown>,
  result: string,
): void {
  h.sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', ?, ?, ?, ?)`,
    )
    .run(spaceId, action, description, JSON.stringify(targets), result);
}

/** Fresh fencing token per claim (design §3.5, B2 Rev 3): 16 random bytes hex. */
function freshFence(): string {
  return randomBytes(16).toString("hex");
}

function parseJsonArrayInt(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

function parseJsonArrayStr(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Serialize a Float32Array as the raw little-endian byte BLOB sqlite-vec
 *  expects (same convention as db/vec.ts vecToBlob). */
function vecToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function getEpisode(sqlite: RawDb, episodeId: number, spaceId: string): EpisodeRow | undefined {
  return sqlite
    .prepare(`SELECT * FROM episodes WHERE id = ? AND space_id = ?`)
    .get(episodeId, spaceId) as EpisodeRow | undefined;
}

// ---------------------------------------------------------------------------
// Capture (hot path)
// ---------------------------------------------------------------------------

/** Significance signals for the §5.2 filter. The pure isSignificant() takes
 *  precomputed booleans — "new in the last 30 days" is resolved by the caller,
 *  keeping the filter deterministic and unit-testable. */
export interface InteractionSignals {
  /** A new node was created during the interaction. */
  newNodeCreated?: boolean;
  /** New person/place/topic (not seen in the last 30 days of episodes). */
  newTopics?: string[];
  /** A tool was used for the first time. */
  newToolUsed?: boolean;
  /** |emotional_weight| from node writes, explicit user language, or
   *  correction signals. Spike threshold: > 0.5. */
  emotionalWeight?: number | null;
  /** An approval was confirmed/denied, a choice selected, an inquiry answered. */
  decisionMade?: boolean;
  /** Any correction signal (strongest single predictor of "this mattered"). */
  correctionSignal?: boolean;
  /** The user stated something about their life (job, money, family, health,
   *  plans) — detected by the extraction prompt's entity output. */
  explicitLifeContent?: boolean;
}

/**
 * Significance filter (design §5.2). Pure function: an episode qualifies for
 * prioritized background enrichment if ANY of the five criteria holds.
 * Non-significant episodes are still captured — never dropped, only delayed.
 */
export function isSignificant(s: InteractionSignals = {}): boolean {
  if (s.newNodeCreated) return true; // criterion 1: first-time signal
  if ((s.newTopics?.length ?? 0) > 0) return true; // criterion 1
  if (s.newToolUsed) return true; // criterion 1
  if (typeof s.emotionalWeight === "number" && Math.abs(s.emotionalWeight) > 0.5)
    return true; // criterion 2: emotional spike
  if (s.decisionMade) return true; // criterion 3: decision
  if (s.correctionSignal) return true; // criterion 4: correction
  if (s.explicitLifeContent) return true; // criterion 5: explicit life content
  return false;
}

export interface CaptureInput {
  kind: EpisodeKind;
  /** Caller-provided one-line summary. When set, it is stored verbatim
   *  (unless a forget scope tombstones the capture); when absent, the
   *  summary is built from the template vocabulary (templateSummary). */
  summary?: string;
  /** When the event happened (canonical ISO UTC). Defaults to now. */
  occurredAt?: string;
  /** First user message, truncated by the caller (content — stored only when
   *  no forget scope matches). */
  userExcerpt?: string;
  /** Names of tools called during the interaction (names only, no args). */
  toolNames?: string[];
  /** One-line outcome in the caller's template vocabulary
   *  (e.g. "approval_confirmed", "digest_delivered"). */
  outcome?: string;
  /** Set when this episode corrects a misrecorded one (append-only pattern). */
  correctsEpisodeId?: number | null;
  /** Significance signals (§5.2). */
  signals?: InteractionSignals;
  /** Controlled topic labels of the interaction (§6.2 vocabulary) — used for
   *  forget-scope matching. */
  topicLabels?: string[];
  /** True when the topic mapping was uncertain (drives the ambiguous-match
   *  bias: tombstone anyway, log for review). */
  topicUncertain?: boolean;
  /* --- W3 §4.3 source lineage (capture-trigger contract amendment, §8.6) ---
   * New captures always assign a lineage key from these fields per the
   * per-kind grain in computeLineage(). Anything unrecoverable stays NULL
   * (lineage unknown) — never a synthetic singleton. */
  /** Conversation session identifier (conversation / agent_action /
   *  correction captures): the session that produced the turn. */
  sessionId?: string;
  /** Turn identifier within the session. conversation/agent_action lineage
   *  is conv:<sessionId>:turn:<turnId>; corrections inherit it by default. */
  turnId?: string;
  /** job_run captures: the job's name (lineage job:<jobName>:<runId>). */
  jobName?: string;
  /** job_run captures: the run identifier. */
  runId?: string | number;
  /** digest_sent / proactive_msg captures: the lineage key of the content
   *  being summarized. The digest inherits it and can therefore never
   *  corroborate its own sources (§4.3 derived-artifact rule). */
  sourceLineageKey?: string | null;
  /** digest_sent / proactive_msg captures whose content came from multiple
   *  sources: the digest run's own identifier (lineage digest:<id>) — such a
   *  digest corroborates nothing it summarized. */
  digestRunId?: string | number;
  /** milestone captures: the milestone event's identifier (mill:<id>). */
  milestoneId?: string | number;
  /** correction captures ONLY: positive evidence that the correction
   *  introduces a proposition about a different subject ('new_subject') or a
   *  different slot ('new_slot') than the enclosing turn — the ONLY way a
   *  correction earns an independent corr:<correctionId> lineage. Absent =
   *  inherit the enclosing turn (conservative default, §4.3). */
  correctionBasis?: "new_subject" | "new_slot";
  /** correction captures: the correction's own identifier, required to mint
   *  corr:<correctionId> when correctionBasis is set. */
  correctionId?: string | number;
  /** Explicit lineage key — overrides every computed rule when provided. */
  lineageKey?: string;
}

export interface CaptureResult {
  episodeId: number;
  /** True when the summary is a tombstone (forget-scope match). */
  tombstoned: boolean;
  significant: boolean;
  /** W3 §4.3: the lineage key assigned at capture (NULL = unknown). */
  lineageKey: string | null;
}

export type LineageBasis = "inherited" | "new_subject" | "new_slot";

/**
 * W3 §4.3 lineage grain — the capture-trigger contract. Independence is
 * defined by source lineage, not by episode count: episodes sharing a key
 * are ONE observation. Exact grain per capture kind:
 * - conversation / agent_action: conv:<sessionId>:turn:<turnId> (an agent
 *   action inside a turn is part of that turn's source). With a session but
 *   no turn id, the session as a whole: sess:<sessionId>.
 * - job_run: job:<jobName>:<runId> — one job execution is one source.
 * - digest_sent / proactive_msg: inherit the summarized content's lineage;
 *   multi-source digests take their own digest:<runId> key and can never
 *   corroborate the sources they summarize.
 * - correction: inherits the enclosing turn's key BY DEFAULT (basis
 *   'inherited'); earns corr:<correctionId> ONLY on positive evidence of a
 *   new subject or new slot (correctionBasis + correctionId supplied).
 * - milestone: mill:<milestoneId>. session: sess:<sessionId>.
 * Anything unrecoverable returns a NULL key (lineage unknown) — unknown
 * lineage is ineligible to establish independence (§4.3); a synthetic
 * singleton is never minted.
 */
export function computeLineage(input: CaptureInput): {
  key: string | null;
  basis: LineageBasis | null;
} {
  if (input.lineageKey) return { key: input.lineageKey, basis: null };
  const turnKey =
    input.sessionId && input.turnId
      ? `conv:${input.sessionId}:turn:${input.turnId}`
      : input.sessionId
        ? `sess:${input.sessionId}`
        : null;
  switch (input.kind) {
    case "conversation":
    case "agent_action":
      return { key: turnKey, basis: null };
    case "job_run":
      if (input.jobName != null && input.runId != null) {
        return { key: `job:${input.jobName}:${input.runId}`, basis: null };
      }
      if (input.runId != null) return { key: `job:run:${input.runId}`, basis: null };
      return { key: null, basis: null };
    case "digest_sent":
    case "proactive_msg":
      if (input.sourceLineageKey) return { key: input.sourceLineageKey, basis: null };
      if (input.digestRunId != null) return { key: `digest:${input.digestRunId}`, basis: null };
      if (input.runId != null) return { key: `digest:${input.runId}`, basis: null };
      return { key: null, basis: null };
    case "correction":
      if (input.correctionBasis && input.correctionId != null) {
        return { key: `corr:${input.correctionId}`, basis: input.correctionBasis };
      }
      // Conservative default: inherit the enclosing turn (a correction
      // usually re-describes the same observation). The basis records that
      // the inherit rule fired even when no turn key is recoverable.
      return { key: turnKey, basis: "inherited" };
    case "milestone":
      return {
        key: input.milestoneId != null ? `mill:${input.milestoneId}` : null,
        basis: null,
      };
    case "session":
      return {
        key: input.sessionId ? `sess:${input.sessionId}` : null,
        basis: null,
      };
  }
}

/** Template summary builders — deterministic, zero LLM (design §3.5). */
function templateSummary(input: CaptureInput): string {
  const excerpt = (input.userExcerpt ?? "").slice(0, 280);
  const tools =
    input.toolNames && input.toolNames.length > 0
      ? ` — tools: ${input.toolNames.slice(0, 8).join(", ")}`
      : "";
  const outcome = input.outcome ? ` — ${input.outcome.slice(0, 120)}` : "";
  switch (input.kind) {
    case "conversation":
      return `Conversation${excerpt ? `: ${excerpt}` : ""}${tools}${outcome}`;
    case "agent_action":
      return `Agent action${input.outcome ? `: ${input.outcome.slice(0, 200)}` : ""}${tools}`;
    case "job_run":
      return `Background job run${outcome}${tools}`;
    case "digest_sent":
      return `Digest sent${outcome}`;
    case "proactive_msg":
      return `Proactive message sent${outcome}`;
    case "correction":
      return `Correction recorded${excerpt ? `: ${excerpt}` : ""}${outcome}`;
    case "milestone":
      return `Milestone${excerpt ? `: ${excerpt}` : input.outcome ? `: ${input.outcome.slice(0, 200)}` : ""}`;
    case "session":
      return `Session${outcome}`;
  }
}

/**
 * Hot-path episode capture (design §3.5). Template summary, zero LLM calls,
 * zero embedding calls — a single INSERT. Best-effort and non-blocking:
 * NEVER throws; on any error it logs and returns null (episodes are
 * observability-grade, not transaction-critical).
 *
 * Forget-list check first (design §3.7, B5 Rev 4): requests with
 * status IN ('approved','applied') block capture. A content match writes a
 * tombstone row instead of the content. `pending`/`rejected` do not block.
 */
export function captureEpisode(
  h: DbHandle,
  spaceId: string,
  input: CaptureInput,
): CaptureResult | null {
  try {
    return captureEpisodeInner(h, spaceId, input);
  } catch (err) {
    try {
      logAgent(
        h,
        spaceId,
        "episode_capture_failed",
        `episode_capture_failed kind=${input?.kind ?? "unknown"} error=${err instanceof Error ? err.message : "unknown"}`,
        { kind: input?.kind ?? null },
        "error",
      );
    } catch {
      // Logging itself must never break the hot path.
    }
    return null;
  }
}

function captureEpisodeInner(
  h: DbHandle,
  spaceId: string,
  input: CaptureInput,
): CaptureResult {
  const sqlite = h.sqlite;
  if (!EPISODE_KINDS.includes(input.kind)) {
    throw new ValidationError("kind", "unknown_kind", `Unknown episode kind: ${input.kind}`);
  }
  const now = new Date().toISOString();
  // Date/time accuracy (audit gap #2): a caller-supplied occurred_at used to
  // be stored verbatim. All current callers pass ISO-Z, so this was latent —
  // but the write boundary now normalizes through the tolerant parser to
  // canonical ISO-Z, so a naive/space-formatted value can never seed a
  // mixed-format column. Unparseable input keeps the previous behavior
  // (stored verbatim) — a timestamp is never invented or silently dropped.
  const occurredMs = parseTolerantMs(input.occurredAt);
  const occurredAt =
    input.occurredAt == null
      ? now
      : Number.isFinite(occurredMs)
        ? new Date(occurredMs).toISOString()
        : input.occurredAt;
  const significant = isSignificant(input.signals);

  // --- Forget-list check (B5, B9 Rev 4) ---
  const requests = sqlite
    .prepare(
      `SELECT id, scope_episode_ids, scope_node_ids, scope_topics
       FROM forget_requests
       WHERE space_id = ? AND status IN ('approved', 'applied')`,
    )
    .all(spaceId) as {
    id: number;
    scope_episode_ids: string;
    scope_node_ids: string;
    scope_topics: string;
  }[];
  const topicLabels = input.topicLabels ?? [];
  const matchedIds: number[] = [];
  let weakMatch = false;
  for (const r of requests) {
    const scopeTopics = parseJsonArrayStr(r.scope_topics);
    const overlap = topicLabels.filter((t) => scopeTopics.includes(t));
    const directHit =
      input.correctsEpisodeId != null &&
      parseJsonArrayInt(r.scope_episode_ids).includes(input.correctsEpisodeId);
    if (overlap.length > 0 || directHit) {
      matchedIds.push(r.id);
      // Weak overlap: exactly one shared topic label, or the interaction's
      // topic mapping was uncertain (design §3.7: bias toward over-redaction,
      // with a review path).
      if (overlap.length === 1 || input.topicUncertain === true) weakMatch = true;
    }
  }

  let summary: string;
  let forgottenAt: string | null = null;
  let tombstoned = false;
  if (matchedIds.length > 0) {
    // Canonical tombstone with the LOWEST matching request ID (deterministic);
    // all matching IDs are logged. Tombstoned episodes are never eligible for
    // enrichment (claimEnrichment filters forgotten_at IS NULL) or search
    // indexing (no FTS/vec rows are written for tombstones).
    const requestId = Math.min(...matchedIds);
    summary = TOMBSTONE(requestId);
    forgottenAt = now;
    tombstoned = true;
    logAgent(
      h,
      spaceId,
      "forget_capture_blocked",
      `forget_capture_blocked request_ids=${matchedIds.join(",")}`,
      { request_ids: matchedIds },
      "ok",
    );
    if (weakMatch) {
      logAgent(
        h,
        spaceId,
        "forget_ambiguity",
        `forget_ambiguity request_ids=${matchedIds.join(",")} topic_labels=${topicLabels.join(",")}`,
        { request_ids: matchedIds, topic_labels: topicLabels },
        "pending_review",
      );
    }
  } else {
    summary = input.summary ?? templateSummary(input);
  }

  // --- Application-enforced reference: corrects_episode_id (design §8.5) ---
  let correctsEpisodeId: number | null = null;
  if (input.correctsEpisodeId != null) {
    const target = getEpisode(sqlite, input.correctsEpisodeId, spaceId);
    if (target) {
      correctsEpisodeId = input.correctsEpisodeId;
    } else {
      // Invalid link: capture anyway (best-effort) with the link nulled, and
      // log the mismatch — never silently fabricate the reference.
      logAgent(
        h,
        spaceId,
        "episode_capture_bad_ref",
        `episode_capture_bad_ref corrects_episode_id=${input.correctsEpisodeId} reason=not_found_or_wrong_space`,
        { corrects_episode_id: input.correctsEpisodeId },
        "ok",
      );
    }
  }

  // W3 §4.3: assign the source-lineage key at capture (contract amendment,
  // §8.6). New captures always run the grain rules; unrecoverable lineage
  // stays NULL (unknown), never a synthetic singleton.
  const lineage = computeLineage(input);

  let row: { id: number };
  try {
    row = sqlite
      .prepare(
        `INSERT INTO episodes
           (space_id, kind, summary, occurred_at, recorded_at, corrects_episode_id, forgotten_at, lineage_key, lineage_basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        spaceId,
        input.kind,
        summary,
        occurredAt,
        now,
        correctsEpisodeId,
        forgottenAt,
        lineage.key,
        lineage.basis,
      ) as { id: number };
  } catch (err) {
    // Pre-W3 volume opened without migrateSchema (exotic test setups only —
    // createDb always migrates first): the lineage columns don't exist yet.
    // Capture must never break the hot path, so fall back to the legacy
    // column set; the row's lineage stays unknown (NULL by absence).
    if (!/lineage/i.test(err instanceof Error ? err.message : "")) throw err;
    row = sqlite
      .prepare(
        `INSERT INTO episodes
           (space_id, kind, summary, occurred_at, recorded_at, corrects_episode_id, forgotten_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        spaceId,
        input.kind,
        summary,
        occurredAt,
        now,
        correctsEpisodeId,
        forgottenAt,
      ) as { id: number };
    return { episodeId: row.id, tombstoned, significant, lineageKey: null };
  }

  logAgent(
    h,
    spaceId,
    "episode_captured",
    `episode_captured id=${row.id} kind=${input.kind} significant=${significant} tombstoned=${tombstoned}`,
    { episode_id: row.id, kind: input.kind, significant, tombstoned },
    "ok",
  );
  return { episodeId: row.id, tombstoned, significant, lineageKey: lineage.key };
}

// ---------------------------------------------------------------------------
// Space-local date (quota timezone contract, B7 Rev 4)
// ---------------------------------------------------------------------------

/**
 * Returns YYYY-MM-DD in the SPACE's local timezone, read from
 * space_meta.timezone (default America/New_York). Used as the quota_date bound
 * parameter for enrichment_quota — never SQLite date('now') (which is UTC).
 *
 * DESIGN-GAP: §8.2 lists `spaceLocalDate(spaceId)` without a handle, but the
 * body must read space_meta.timezone from the database, so the handle is
 * required. All W2 functions take (handle, spaceId, ...) per §8.4.
 */
export function spaceLocalDate(h: DbHandle, spaceId: string): string {
  let tz = DEFAULT_TIMEZONE;
  try {
    const row = h.sqlite
      .prepare(`SELECT timezone FROM space_meta WHERE space_id = ?`)
      .get(spaceId) as { timezone?: string } | undefined;
    if (row?.timezone) tz = row.timezone;
  } catch {
    // space_meta may be unreachable in a bare test DB — fall through to default.
  }
  const format = (zone: string): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string): string =>
      parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  try {
    return format(tz);
  } catch {
    return format(DEFAULT_TIMEZONE); // invalid timezone string in space_meta
  }
}

/** Tunable daily cap (design §3.5). Read defensively — the column exists on
 *  fresh schemas; older volumes fall back to the default. */
function getEnrichDailyCap(sqlite: RawDb, spaceId: string): number {
  try {
    const row = sqlite
      .prepare(`SELECT episode_enrich_daily_cap AS cap FROM space_meta WHERE space_id = ?`)
      .get(spaceId) as { cap?: number | null } | undefined;
    if (row && typeof row.cap === "number" && row.cap > 0) {
      return Math.floor(row.cap);
    }
  } catch {
    // Column absent on pre-W2 volumes — use the default.
  }
  return DEFAULT_ENRICH_DAILY_CAP;
}

// ---------------------------------------------------------------------------
// Enrichment claim (atomic worker claim with quota reservation + fencing)
// ---------------------------------------------------------------------------

export interface EnrichmentClaim {
  episodeId: number;
  /** Fencing token — the commit predicate requires this exact value. */
  fence: string;
}

/**
 * Atomic worker claim with quota reservation + fencing (design §3.5, B2+B4
 * Rev 3, B1 Rev 4). Returns { episodeId, fence } or null when the cap is
 * exhausted, no episode is claimable, or the claim would be attempt 4 (row
 * transitions to failed_permanent instead — with a quota REFUND, Rev 5).
 *
 * The SQL below is the §3.5 claim flow verbatim:
 *  1. INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claimed < cap RETURNING
 *     — a check-and-increment in a single statement; SQLite serializes
 *     writers so two concurrent workers cannot both succeed on one unit.
 *  2. UPDATE ... RETURNING id, enrichment_fence — claims pending /
 *     failed_retryable episodes, or processing rows whose lease expired
 *     (crashed worker), with a FRESH fence token per claim.
 *  Tombstoned episodes are never eligible (forgotten_at IS NULL).
 */
export function claimEnrichment(h: DbHandle, spaceId: string): EnrichmentClaim | null {
  const sqlite = h.sqlite;
  const now = new Date().toISOString();
  const fence = freshFence();
  const lease = new Date(Date.now() + ENRICHMENT_LEASE_MS).toISOString();
  // spaceLocalDate computed in TS BEFORE the transaction (B7 Rev 4) — never
  // SQLite date('now').
  const quotaDate = spaceLocalDate(h, spaceId);
  const cap = getEnrichDailyCap(sqlite, spaceId);

  type ClaimOutcome = EnrichmentClaim | null | { permanent: number; attempts: number };
  const tx = sqlite.transaction((): ClaimOutcome => {
    // Step 1: atomically reserve one quota unit.
    const reserved = sqlite
      .prepare(
        `INSERT INTO enrichment_quota (space_id, quota_date, claimed)
         VALUES (?, ?, 1)
         ON CONFLICT (space_id, quota_date) DO UPDATE
           SET claimed = claimed + 1
           WHERE claimed < ?
         RETURNING claimed`,
      )
      .get(spaceId, quotaDate, cap) as { claimed: number } | undefined;
    if (!reserved) {
      return null; // cap exhausted -> ROLLBACK, nothing claimed
    }

    // Step 2: claim one episode.
    const claimed = sqlite
      .prepare(
        `UPDATE episodes
         SET enrichment_status = 'processing',
             enrichment_lease = ?,
             enrichment_fence = ?,
             enrichment_attempts = enrichment_attempts + 1
         WHERE id = (
           SELECT id FROM episodes
           WHERE space_id = ?
             AND forgotten_at IS NULL
             AND (
               enrichment_status IN ('pending', 'failed_retryable')
               OR (
                 enrichment_status = 'processing'
                 AND enrichment_lease IS NOT NULL
                 AND enrichment_lease < ?
               )
             )
             AND (enrichment_lease IS NULL OR enrichment_lease < ?)
           ORDER BY
             CASE enrichment_status
               WHEN 'pending' THEN 0
               WHEN 'failed_retryable' THEN 1
               WHEN 'processing' THEN 2
             END,
             occurred_at DESC
           LIMIT 1
         )
         RETURNING id, enrichment_fence, enrichment_attempts`,
      )
      .get(lease, fence, spaceId, now, now) as
      | { id: number; enrichment_fence: string; enrichment_attempts: number }
      | undefined;

    if (!claimed) {
      // No claimable episodes — refund the reservation.
      sqlite
        .prepare(
          `UPDATE enrichment_quota SET claimed = claimed - 1
           WHERE space_id = ? AND quota_date = ?`,
        )
        .run(spaceId, quotaDate);
      return null;
    }

    // Retry accounting (B6 Rev 4): exactly three attempts. The claim that
    // would be attempt 4 transitions the row to failed_permanent — no LLM
    // call is wasted. The predicate is `> 3` in prose, SQL, and tests.
    if (claimed.enrichment_attempts > MAX_ENRICHMENT_ATTEMPTS) {
      sqlite
        .prepare(
          `UPDATE episodes
           SET enrichment_status = 'failed_permanent', enrichment_lease = NULL
           WHERE id = ?`,
        )
        .run(claimed.id);
      // No work was performed, so the reservation is refunded in the same
      // transaction (Rev 5): the daily cap is consumed only by claims that
      // actually attempt enrichment work.
      sqlite
        .prepare(
          `UPDATE enrichment_quota SET claimed = claimed - 1
           WHERE space_id = ? AND quota_date = ?`,
        )
        .run(spaceId, quotaDate);
      return { permanent: claimed.id, attempts: claimed.enrichment_attempts };
    }

    return { episodeId: claimed.id, fence: claimed.enrichment_fence };
  });

  let outcome: ClaimOutcome;
  try {
    outcome = tx();
  } catch (err) {
    logAgent(
      h,
      spaceId,
      "enrichment_claim_failed",
      `enrichment_claim_failed error=${err instanceof Error ? err.message : "unknown"}`,
      {},
      "error",
    );
    return null;
  }

  if (outcome !== null && "permanent" in outcome) {
    // A human or W3 can reset the row to 'pending' (attempts to 0) if the
    // failure cause is fixed. Surfaced in diagnostics; never retried.
    logAgent(
      h,
      spaceId,
      "enrichment_failed_permanent",
      `enrichment_failed_permanent episode_id=${outcome.permanent} attempts=${outcome.attempts} quota_refunded=true`,
      { episode_id: outcome.permanent, attempts: outcome.attempts, quota_refunded: true },
      "ok",
    );
    return null;
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Enrichment (background, LLM-gated)
// ---------------------------------------------------------------------------

/** Input to an episode enricher. The wiring layer supplies the verbatim
 *  interaction excerpt when available (sourceText) — it is never stored by
 *  W2 (no transcript store), only used for grounding validation. */
export interface EpisodeEnricherInput {
  episodeId: number;
  kind: EpisodeKind;
  /** The immutable template summary (always available). */
  summary: string;
  occurredAt: string;
  /** Verbatim interaction excerpt for grounding (optional, not stored). */
  excerpt?: string;
}

export interface EpisodeEnricherResult {
  detail?: string | null;
  emotion?: EmotionLabel | null;
  emotionalWeight?: number | null;
  /** Defaults to 0.5 when omitted (the default needs no provenance label). */
  importance?: number;
  participants?: string[];
  place?: string | null;
  /** Field -> provenance label. Every populated interpretive field must have
   *  one (INV-ENRICH-4); NULL fields carry 'not_reported' (INV-ENRICH-2). */
  fieldProvenance: Record<string, ProvenanceLabel>;
}

/**
 * Injectable enricher (design §3.5, testability seam). The W3 worker supplies
 * the LLM-backed implementation; tests supply fakes. The built-in default is
 * the template fallback below — never a cloud call.
 */
export type EpisodeEnricher = (
  input: EpisodeEnricherInput,
) => Promise<EpisodeEnricherResult>;

/**
 * Template-based fallback enricher (design §3.5: "default to a template-based
 * fallback if no LLM available — never hard-depend on a cloud key").
 *
 * Conservative by construction (INV-ENRICH-3): a template cannot know texture,
 * feeling, or place, so every interpretive field is NULL with an explicit
 * 'not_reported' label — a complete, valid state (T-E13). Nothing is invented;
 * nothing needs the evidence quarantine because no evidence-eligible content
 * is produced.
 */
export async function templateEnricher(
  _input: EpisodeEnricherInput,
): Promise<EpisodeEnricherResult> {
  return {
    detail: null,
    emotion: null,
    emotionalWeight: null,
    importance: 0.5,
    participants: [],
    place: null,
    fieldProvenance: {
      detail: "not_reported",
      emotion: "not_reported",
      emotional_weight: "not_reported",
      participants: "not_reported",
      place: "not_reported",
    },
  };
}

/**
 * Canonical enrichment prompt for LLM-backed enrichers (INV-ENRICH-3). The
 * prompt receives the verbatim interaction excerpt and a grounding checklist;
 * the wiring layer's enricher must honor the label contract in its output.
 * Provided here so all enrichers share one grounding standard.
 */
export function buildEnrichmentPrompt(input: EpisodeEnricherInput): string {
  return [
    "You are enriching an episodic memory record. The CAPTURED event below is",
    "immutable — your job is interpretation, clearly labeled, never invention.",
    "",
    `Kind: ${input.kind}`,
    `Occurred: ${input.occurredAt}`,
    `Capture summary: ${input.summary}`,
    input.excerpt ? `Verbatim excerpt:\n${input.excerpt}` : "Verbatim excerpt: (none provided)",
    "",
    "GROUNDING CHECKLIST (hard rules):",
    "- Every field you populate gets a provenance label:",
    "  direct_quote (verbatim user words — must be a substring of the excerpt),",
    "  explicit (user stated it plainly), inferred (your interpretation),",
    "  generated (narrative connective tissue ONLY — transitions, scene-setting,",
    "  never invented experience), not_reported (the source did not contain it).",
    "- Do NOT invent sensory details, feelings, motivations, or meaning absent",
    "  from the source. A terse interaction yields NULL fields with",
    "  'not_reported' labels — that is a complete, valid enrichment.",
    "- emotion must be one of: " + EMOTION_LABELS.join(", ") + " — or NULL.",
    "- emotional_weight in [-1, 1]; importance in [0, 1] (always a judgment:",
    "  label it 'inferred' when you set it away from the 0.5 default).",
    "- 'generated' text is quarantined: it can never become user-model evidence.",
    "- participants: non-empty strings only. place: free text or NULL.",
    "",
    "Return JSON: { detail, emotion, emotional_weight, importance,",
    "participants, place, field_provenance }.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Provenance validation (INV-ENRICH-4)
// ---------------------------------------------------------------------------

/** The shape validateProvenance() accepts: a draft or a stored row. JSON TEXT
 *  columns are accepted as strings or pre-parsed values. */
export interface EnrichmentDraft {
  detail?: string | null;
  emotion?: string | null;
  emotional_weight?: number | null;
  importance?: number | null;
  participants?: string[] | string | null;
  place?: string | null;
  source_node_ids?: number[] | string | null;
  embedding?: Uint8Array | Buffer | null;
  field_provenance?: string | Record<string, string> | null;
  /** Row id, for diagnostic logs only. */
  id?: number;
}

export interface ValidateProvenanceOpts {
  /** Verbatim source text — enables INV-ENRICH-3 substring checks for
   *  direct_quote fields. */
  sourceText?: string;
}

function asStringArray(v: string[] | string | null | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try {
    const p: unknown = JSON.parse(v);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function asIntArray(v: number[] | string | null | undefined): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return parseJsonArrayInt(v);
}

/**
 * Provenance coverage validation (design §3.3, B7 Rev 3; INV-ENRICH-4).
 * Throws ValidationError on:
 * - malformed field_provenance JSON,
 * - unknown field names in the map (unknown_provenance_field),
 * - a populated interpretive field without a label, or a NULL interpretive
 *   field without a 'not_reported' label (missing_provenance) — NULL without
 *   a label means "not yet classified", which is ambiguous and rejected,
 * - a label outside the field's allowed set (invalid_provenance_label),
 * - a direct_quote value that is not a substring of sourceText
 *   (ungrounded_direct_quote, INV-ENRICH-3) when sourceText is provided.
 *
 * The `{}` default is valid only when no interpretive fields are populated
 * AND no mechanical labels are required (the minimal linking record). An
 * empty source_node_ids array needs no label (mechanical, not interpretive);
 * a non-empty one requires 'explicit'.
 *
 * DESIGN-GAP: the completeness rule lists `embedding` among "populated"
 * fields, but the allowed-label table says embedding needs no label ("not
 * interpretive"). This implementation follows the table (the more specific
 * rule): an embedding label is optional, and when present must be 'explicit'.
 */
export function validateProvenance(
  e: EnrichmentDraft,
  opts: ValidateProvenanceOpts = {},
): void {
  // --- Parse field_provenance ---
  let fp: Record<string, string>;
  if (e.field_provenance == null) {
    fp = {};
  } else if (typeof e.field_provenance === "string") {
    try {
      const parsed: unknown = JSON.parse(e.field_provenance);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ValidationError("field_provenance", "malformed_json");
      }
      fp = parsed as Record<string, string>;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError("field_provenance", "malformed_json");
    }
  } else if (typeof e.field_provenance === "object") {
    fp = e.field_provenance;
  } else {
    throw new ValidationError("field_provenance", "malformed_json");
  }

  // --- Unknown field names rejected ---
  for (const key of Object.keys(fp)) {
    if (!(key in ALLOWED_PROVENANCE)) {
      throw new ValidationError("field_provenance", "unknown_provenance_field", `Unknown provenance field: ${key}`);
    }
  }

  // --- Value-shape checks (CHECK constraints are fresh-schema only; the
  // --- migration path relies on application validation) ---
  if (e.emotion != null && !EMOTION_LABELS.includes(e.emotion as EmotionLabel)) {
    throw new ValidationError("emotion", "invalid_emotion", `Unknown emotion label: ${e.emotion}`);
  }
  if (
    e.emotional_weight != null &&
    (typeof e.emotional_weight !== "number" ||
      e.emotional_weight < -1 ||
      e.emotional_weight > 1)
  ) {
    throw new ValidationError("emotional_weight", "out_of_range");
  }
  if (
    e.importance != null &&
    (typeof e.importance !== "number" || e.importance < 0 || e.importance > 1)
  ) {
    throw new ValidationError("importance", "out_of_range");
  }

  // --- Populated-field determination (design §3.3 completeness rule) ---
  const participants = asStringArray(e.participants);
  const sourceNodeIds = asIntArray(e.source_node_ids);
  const populated: Record<string, boolean> = {
    detail: e.detail != null,
    emotion: e.emotion != null,
    emotional_weight: e.emotional_weight != null,
    participants: participants.length > 0,
    place: e.place != null,
    importance: (e.importance ?? 0.5) !== 0.5,
    source_node_ids: sourceNodeIds.length > 0,
    embedding: e.embedding != null,
  };
  const anyInterpretive = INTERPRETIVE_FIELDS.some((f) => populated[f]) || populated["importance"];

  // --- Label requirements ---
  const requireLabel = (field: string): void => {
    const label = fp[field];
    if (label == null) {
      throw new ValidationError("field_provenance", "missing_provenance", `Populated field '${field}' has no provenance label`);
    }
    const allowed = ALLOWED_PROVENANCE[field];
    if (!allowed?.has(label as ProvenanceLabel)) {
      throw new ValidationError(
        "field_provenance",
        "invalid_provenance_label",
        `Label '${label}' not allowed for field '${field}'`,
      );
    }
  };

  // Mechanical links: non-empty source_node_ids requires 'explicit' (always a
  // mechanical link, never interpretation — design §3.3 versioning rules).
  if (populated["source_node_ids"]) requireLabel("source_node_ids");

  if (anyInterpretive) {
    // Every interpretive field must carry a label; NULL fields must carry
    // 'not_reported' (a NULL without a label means "not yet classified").
    for (const field of INTERPRETIVE_FIELDS) requireLabel(field);
    if (populated["importance"]) requireLabel("importance");
  }
  // embedding: label optional; when present it must be 'explicit'.

  // --- INV-ENRICH-3: direct_quote grounding ---
  if (opts.sourceText != null) {
    const values: Record<string, string | null> = {
      detail: e.detail ?? null,
      emotion: e.emotion ?? null,
    };
    for (const [field, value] of Object.entries(values)) {
      if (fp[field] === "direct_quote" && value != null && !opts.sourceText.includes(value)) {
        throw new ValidationError(
          field,
          "ungrounded_direct_quote",
          `direct_quote field '${field}' is not a substring of the source text`,
        );
      }
    }
  }
}

/**
 * Fail-closed evidence selector (design §3.3; INV-ENRICH-1). Returns the names
 * of fields eligible to feed user-model evidence:
 * - 'direct_quote' / 'explicit' — always eligible,
 * - 'inferred' — only when opts.allowInferred (inferred-origin entries, capped
 *   0.69 downstream),
 * - 'generated' — NEVER eligible (quarantined),
 * - 'not_reported' — never eligible (nothing to select).
 *
 * Fail-closed: if field_provenance is malformed, a populated field lacks a
 * label, or a label is unknown, the field is EXCLUDED and a
 * 'provenance_malformed' row is logged (when a handle is supplied). A field
 * is never included "on the assumption it's fine."
 */
export function evidenceSafeFields(
  e: EnrichmentDraft,
  opts: { allowInferred?: boolean; handle?: DbHandle; spaceId?: string } = {},
): string[] {
  let fp: Record<string, string> | null = null;
  const malformed = (field: string): void => {
    if (opts.handle && opts.spaceId) {
      try {
        logAgent(
          opts.handle,
          opts.spaceId,
          "provenance_malformed",
          `provenance_malformed enrichment_id=${e.id ?? "unknown"} field=${field}`,
          { enrichment_id: e.id ?? null, field },
          "ok",
        );
      } catch {
        // Diagnostic logging must never break the selector.
      }
    }
  };

  if (e.field_provenance == null) {
    fp = {};
  } else if (typeof e.field_provenance === "string") {
    try {
      const parsed: unknown = JSON.parse(e.field_provenance);
      fp =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, string>)
          : null;
    } catch {
      fp = null;
    }
  } else if (typeof e.field_provenance === "object") {
    fp = e.field_provenance;
  }
  if (fp === null) {
    malformed("field_provenance");
    return []; // fail-closed: no safe fields when provenance is unreadable
  }

  const participants = asStringArray(e.participants);
  const populated: Record<string, boolean> = {
    detail: e.detail != null,
    emotion: e.emotion != null,
    emotional_weight: e.emotional_weight != null,
    participants: participants.length > 0,
    place: e.place != null,
    importance: (e.importance ?? 0.5) !== 0.5,
  };

  const safe: string[] = [];
  for (const [field, isPopulated] of Object.entries(populated)) {
    if (!isPopulated) continue;
    const label = fp[field];
    const allowed = ALLOWED_PROVENANCE[field];
    if (label == null || !allowed?.has(label as ProvenanceLabel)) {
      malformed(field); // missing or unknown label -> excluded
      continue;
    }
    if (label === "direct_quote" || label === "explicit") {
      safe.push(field);
    } else if (label === "inferred" && opts.allowInferred === true) {
      safe.push(field);
    }
    // 'generated' and 'not_reported' are never evidence-eligible.
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Reference validation (design §3.8)
// ---------------------------------------------------------------------------

export interface EpisodeRefInput {
  participants?: unknown;
  sourceNodeIds?: unknown;
}

/**
 * JSON shape + cross-space validation (design §3.8). Single enforcement point
 * for reference columns (design §8.5) — no module performs ad-hoc reference
 * checks. Missing references reject the write with ValidationError
 * ({field, referenced_id, reason: 'not_found' | 'wrong_space'}); references
 * are never silently nulled and placeholder rows are never created.
 */
export function validateEpisodeRefs(
  h: DbHandle,
  spaceId: string,
  refs: EpisodeRefInput,
): void {
  const { participants = [], sourceNodeIds = [] } = refs;

  // participants: array of non-empty strings, max 20, max 100 chars each.
  if (!Array.isArray(participants)) {
    throw new ValidationError("participants", "bad_shape", "participants must be an array of strings");
  }
  if (participants.length > 20) {
    throw new ValidationError("participants", "too_many", "participants: max 20 entries");
  }
  for (const p of participants) {
    if (typeof p !== "string" || p.length === 0) {
      throw new ValidationError("participants", "bad_shape", "participants must be non-empty strings");
    }
    if (p.length > 100) {
      throw new ValidationError("participants", "too_long", "participant entry max 100 chars");
    }
  }

  // sourceNodeIds: array of integers; each must exist AND belong to spaceId.
  if (!Array.isArray(sourceNodeIds)) {
    throw new ValidationError("source_node_ids", "bad_shape", "source_node_ids must be an array of integers");
  }
  const lookup = h.sqlite.prepare(`SELECT space_id FROM nodes WHERE id = ?`);
  for (const id of sourceNodeIds) {
    if (!Number.isInteger(id)) {
      throw new ValidationError("source_node_ids", "bad_shape", `node id must be an integer, got ${String(id)}`, undefined);
    }
    const row = lookup.get(id) as { space_id: string } | undefined;
    if (!row) {
      throw new ValidationError("source_node_ids", "not_found", `referenced node ${id} does not exist`, id);
    }
    if (row.space_id !== spaceId) {
      throw new ValidationError("source_node_ids", "wrong_space", `referenced node ${id} belongs to a different space`, id);
    }
  }
}

// ---------------------------------------------------------------------------
// Versioned node linking (design §3.3, B1 Rev 3)
// ---------------------------------------------------------------------------

export interface LinkResult {
  enrichmentId: number;
  version: number;
}

function currentEnrichment(sqlite: RawDb, episodeId: number): EpisodeEnrichmentRow | undefined {
  return sqlite
    .prepare(
      `SELECT * FROM episode_enrichments
       WHERE episode_id = ? AND superseded_by IS NULL`,
    )
    .get(episodeId) as EpisodeEnrichmentRow | undefined;
}

function insertEnrichment(
  sqlite: RawDb,
  row: {
    episode_id: number;
    space_id: string;
    version: number;
    detail: string | null;
    emotion: string | null;
    emotional_weight: number | null;
    importance: number;
    participants: string;
    place: string | null;
    source_node_ids: string;
    source_transcript_ref: string | null;
    field_provenance: string;
    embedding: Buffer | null;
  },
): number {
  const r = sqlite
    .prepare(
      `INSERT INTO episode_enrichments
         (episode_id, space_id, version, detail, emotion, emotional_weight,
          importance, participants, place, source_node_ids,
          source_transcript_ref, field_provenance, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      row.episode_id,
      row.space_id,
      row.version,
      row.detail,
      row.emotion,
      row.emotional_weight,
      row.importance,
      row.participants,
      row.place,
      row.source_node_ids,
      row.source_transcript_ref,
      row.field_provenance,
      row.embedding,
    ) as { id: number };
  return r.id;
}

/**
 * Link an episode to nodes (design §3.3, B1 Rev 3). ALWAYS creates a NEW
 * enrichment version — never mutates an existing one. source_node_ids is
 * evidence linkage, and evidence linkage is part of the interpretation:
 * silently growing it would retroactively change what an earlier version
 * claimed as its sources.
 *
 * - Current version exists: version N+1 copies ALL fields from the current
 *   version with the merged source_node_ids; the old version's superseded_by
 *   points at the new row. The old row is byte-identical otherwise.
 * - No enrichment yet: minimal version 1 with only source_node_ids populated
 *   (all interpretive fields NULL / not_reported), field_provenance carrying
 *   the mechanical 'explicit' label for source_node_ids.
 */
export function linkEpisodeToNodes(
  h: DbHandle,
  spaceId: string,
  episodeId: number,
  nodeIds: number[],
): LinkResult {
  const sqlite = h.sqlite;
  validateEpisodeRefs(h, spaceId, { sourceNodeIds: nodeIds });
  const episode = getEpisode(sqlite, episodeId, spaceId);
  if (!episode) {
    throw new ValidationError("episode_id", "not_found", `episode ${episodeId} does not exist in space ${spaceId}`, episodeId);
  }

  const tx = sqlite.transaction((): LinkResult => {
    const cur = currentEnrichment(sqlite, episodeId);
    const existing = cur ? asIntArray(cur.source_node_ids) : [];
    const merged = [...existing];
    for (const id of nodeIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    const sourceNodeIdsJson = JSON.stringify(merged);

    let newId: number;
    let newVersion: number;
    if (cur) {
      // Copy every field from the current version; only source_node_ids
      // changes. field_provenance keeps its labels; the mechanical
      // source_node_ids label is 'explicit' by construction.
      const fp: Record<string, string> = JSON.parse(cur.field_provenance);
      fp["source_node_ids"] = "explicit";
      const draft: EnrichmentDraft = {
        detail: cur.detail,
        emotion: cur.emotion,
        emotional_weight: cur.emotional_weight,
        importance: cur.importance,
        participants: cur.participants,
        place: cur.place,
        source_node_ids: merged,
        embedding: cur.embedding,
        field_provenance: fp,
      };
      validateProvenance(draft);
      newVersion = cur.version + 1;
      newId = insertEnrichment(sqlite, {
        episode_id: episodeId,
        space_id: spaceId,
        version: newVersion,
        detail: cur.detail,
        emotion: cur.emotion,
        emotional_weight: cur.emotional_weight,
        importance: cur.importance,
        participants: cur.participants,
        place: cur.place,
        source_node_ids: sourceNodeIdsJson,
        source_transcript_ref: cur.source_transcript_ref,
        field_provenance: JSON.stringify(fp),
        embedding: cur.embedding,
      });
      const upd = sqlite
        .prepare(
          `UPDATE episode_enrichments SET superseded_by = ?
           WHERE id = ? AND superseded_by IS NULL`,
        )
        .run(newId, cur.id);
      if (upd.changes !== 1) {
        // A concurrent linker superseded this version first — abort rather
        // than fork the version chain.
        throw new ValidationError("superseded_by", "already_superseded", `enrichment version ${cur.version} was superseded concurrently`);
      }
    } else {
      const draft: EnrichmentDraft = {
        source_node_ids: merged,
        field_provenance: { source_node_ids: "explicit" },
      };
      validateProvenance(draft);
      newVersion = 1;
      newId = insertEnrichment(sqlite, {
        episode_id: episodeId,
        space_id: spaceId,
        version: 1,
        detail: null,
        emotion: null,
        emotional_weight: null,
        importance: 0.5,
        participants: "[]",
        place: null,
        source_node_ids: sourceNodeIdsJson,
        source_transcript_ref: null,
        field_provenance: JSON.stringify({ source_node_ids: "explicit" }),
        embedding: null,
      });
    }
    return { enrichmentId: newId, version: newVersion };
  });

  const result = tx();
  logAgent(
    h,
    spaceId,
    "episode_nodes_linked",
    `episode_nodes_linked episode_id=${episodeId} node_ids=${nodeIds.join(",")} version=${result.version}`,
    { episode_id: episodeId, node_ids: nodeIds, version: result.version },
    "ok",
  );
  return result;
}

// ---------------------------------------------------------------------------
// enrichEpisode (background worker)
// ---------------------------------------------------------------------------

export interface EnrichEpisodeOpts {
  /** Injected enricher (LLM-backed in production, fake in tests). Defaults
   *  to the template fallback — never a cloud call. */
  enricher?: EpisodeEnricher;
  /** Embedding provider for summary+detail. When absent, the enrichment
   *  completes with embedding NULL (no vec rows) — still valid. */
  embed?: (text: string) => Float32Array | Promise<Float32Array>;
  /** Verbatim source text for direct_quote substring validation
   *  (INV-ENRICH-3). */
  sourceText?: string;
}

export type EnrichEpisodeResult =
  | { status: "completed"; episodeId: number; version: number; enrichmentId: number }
  | { status: "already_completed"; episodeId: number }
  | {
      status: "rejected";
      episodeId: number;
      reason:
        | "not_found"
        | "forgotten"
        | "fence_mismatch"
        | "not_processing"
        | "validation"
        | "enricher_failed"
        | "commit_rejected";
    };

function ftsUpsertEpisode(sqlite: RawDb, episodeId: number, summary: string, detail: string | null): void {
  // Index re-sync primitive (delete-then-insert in the same transaction), not
  // record deletion — the same pattern as db/fts.ts ftsUpsert. INV-DEL-1
  // governs record deletion; index rows are rebuilt, never independently removed.
  sqlite.prepare(`DELETE FROM episodes_fts WHERE rowid = ?`).run(episodeId);
  sqlite
    .prepare(`INSERT INTO episodes_fts (rowid, summary, detail) VALUES (?, ?, ?)`)
    .run(episodeId, summary ?? "", detail ?? "");
}

function upsertEpisodeEmbedding(sqlite: RawDb, episodeId: number, vec: Float32Array): void {
  if (!isVectorEnabled(sqlite)) return;
  if (vec.length !== EMBED_DIM) {
    throw new Error(`Embedding dim mismatch: got ${vec.length}, expected ${EMBED_DIM}.`);
  }
  const id = BigInt(episodeId);
  const blob = vecToBlob(vec);
  // vec0 does not honour INSERT OR REPLACE — delete-then-insert, atomically.
  // Index re-sync primitive (same as db/vec.ts upsertEmbedding), not record
  // deletion — see the INV-DEL-1 note on ftsUpsertEpisode.
  sqlite.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`).run(id);
  sqlite.prepare(`INSERT INTO vec_episodes(episode_id, embedding) VALUES (?, ?)`).run(id, blob);
}

function markEnrichmentFailed(h: DbHandle, spaceId: string, episodeId: number, why: string): void {
  try {
    h.sqlite
      .prepare(
        `UPDATE episodes
         SET enrichment_status = 'failed_retryable', enrichment_lease = NULL
         WHERE id = ? AND space_id = ?`,
      )
      .run(episodeId, spaceId);
  } catch {
    // Best-effort: the lease will expire and another worker reclaims.
  }
  try {
    logAgent(
      h,
      spaceId,
      "enrichment_failed_retryable",
      `enrichment_failed_retryable episode_id=${episodeId} why=${why}`,
      { episode_id: episodeId, why },
      "ok",
    );
  } catch {
    // ignore
  }
}

/**
 * Background enrichment for one claimed episode (design §3.5).
 *
 * - Idempotent: re-running for a 'completed' episode is a no-op (T-E3).
 * - Exactly ONE LLM attempt per call — the retry discipline lives in
 *   claimEnrichment() (attempts counted at claim; the 4th claim goes
 *   failed_permanent). A failed attempt marks the row 'failed_retryable'.
 * - The enrichment INSERT, the version supersede, the FTS/vec writes, and the
 *   episode commit UPDATE happen in ONE transaction: either all commit or
 *   none does (a crashed worker leaves no partial enrichment record).
 * - Commit predicate (design §3.5, B1 Rev 4):
 *     enrichment_fence = ? AND enrichment_status = 'processing'
 *     AND forgotten_at IS NULL
 *   0 rows affected -> the transaction ABORTS, the enrichment work is
 *   discarded, and 'enrichment_commit_rejected' is logged. A stale worker
 *   whose claim was reclaimed, or whose episode was forgotten, can never
 *   commit.
 */
export async function enrichEpisode(
  h: DbHandle,
  spaceId: string,
  episodeId: number,
  fence: string,
  opts: EnrichEpisodeOpts = {},
): Promise<EnrichEpisodeResult> {
  const sqlite = h.sqlite;
  const enricher = opts.enricher ?? templateEnricher;

  // --- Pre-flight checks (before spending an LLM call) ---
  const episode = getEpisode(sqlite, episodeId, spaceId);
  if (!episode) {
    return { status: "rejected", episodeId, reason: "not_found" };
  }
  if (episode.forgotten_at != null) {
    // Ordering A of the forget/worker race: never enrich forgotten content.
    logAgent(h, spaceId, "enrichment_commit_rejected", `enrichment_commit_rejected episode_id=${episodeId} reason=forgotten`, { episode_id: episodeId, reason: "forgotten" }, "ok");
    return { status: "rejected", episodeId, reason: "forgotten" };
  }
  if (episode.enrichment_status === "completed") {
    return { status: "already_completed", episodeId }; // idempotent (T-E3)
  }
  if (episode.enrichment_fence !== fence) {
    return { status: "rejected", episodeId, reason: "fence_mismatch" };
  }
  if (episode.enrichment_status !== "processing") {
    return { status: "rejected", episodeId, reason: "not_processing" };
  }

  // --- Run the enricher (exactly one attempt per call) ---
  let produced: EpisodeEnricherResult;
  try {
    produced = await enricher({
      episodeId,
      kind: episode.kind,
      summary: episode.summary,
      occurredAt: episode.occurred_at,
      excerpt: opts.sourceText,
    });
  } catch (err) {
    markEnrichmentFailed(h, spaceId, episodeId, `enricher_error:${err instanceof Error ? err.message : "unknown"}`);
    return { status: "rejected", episodeId, reason: "enricher_failed" };
  }

  // --- Validate provenance BEFORE writing (INV-ENRICH-4) ---
  const draft: EnrichmentDraft = {
    detail: produced.detail ?? null,
    emotion: produced.emotion ?? null,
    emotional_weight: produced.emotionalWeight ?? null,
    importance: produced.importance ?? 0.5,
    participants: produced.participants ?? [],
    place: produced.place ?? null,
    source_node_ids: [],
    field_provenance: produced.fieldProvenance ?? {},
  };
  try {
    validateProvenance(draft, { sourceText: opts.sourceText });
    validateEpisodeRefs(h, spaceId, { participants: produced.participants ?? [] });
  } catch (err) {
    markEnrichmentFailed(h, spaceId, episodeId, `validation:${err instanceof Error ? err.message : "unknown"}`);
    return { status: "rejected", episodeId, reason: "validation" };
  }

  // --- Embedding (best-effort, computed before the transaction) ---
  let embeddingVec: Float32Array | null = null;
  if (opts.embed) {
    try {
      const text = draft.detail ? `${episode.summary}\n${draft.detail}` : episode.summary;
      embeddingVec = await opts.embed(text);
    } catch (err) {
      logAgent(h, spaceId, "enrichment_embed_failed", `enrichment_embed_failed episode_id=${episodeId} error=${err instanceof Error ? err.message : "unknown"}`, { episode_id: episodeId }, "ok");
      embeddingVec = null; // proceed without an embedding — still valid
    }
  }

  // --- Atomic commit ---
  const now = new Date().toISOString();
  const participantsJson = JSON.stringify(produced.participants ?? []);
  try {
    const result = sqlite.transaction((): { enrichmentId: number; version: number } => {
      const cur = currentEnrichment(sqlite, episodeId);
      const version = cur ? cur.version + 1 : 1;
      const fp = produced.fieldProvenance ?? {};
      const enrichmentId = insertEnrichment(sqlite, {
        episode_id: episodeId,
        space_id: spaceId,
        version,
        detail: draft.detail ?? null,
        emotion: draft.emotion ?? null,
        emotional_weight: draft.emotional_weight ?? null,
        importance: draft.importance ?? 0.5,
        participants: participantsJson,
        place: draft.place ?? null,
        source_node_ids: "[]",
        source_transcript_ref: null,
        field_provenance: JSON.stringify(fp),
        embedding: embeddingVec ? vecToBlob(embeddingVec) : null,
      });
      if (cur) {
        sqlite
          .prepare(`UPDATE episode_enrichments SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`)
          .run(enrichmentId, cur.id);
      }
      if (embeddingVec) {
        upsertEpisodeEmbedding(sqlite, episodeId, embeddingVec);
      }
      ftsUpsertEpisode(sqlite, episodeId, episode.summary, draft.detail ?? null);

      // Commit predicate: fence + processing + NOT forgotten (B1 Rev 4).
      // The forgotten_at IS NULL check is load-bearing: a worker whose
      // episode was forgotten (by any ordering) cannot commit.
      const commit = sqlite
        .prepare(
          `UPDATE episodes
           SET enrichment_status = 'completed',
               enriched_at = ?,
               enrichment_lease = NULL
           WHERE id = ? AND enrichment_fence = ? AND enrichment_status = 'processing'
             AND forgotten_at IS NULL`,
        )
        .run(now, episodeId, fence);
      if (commit.changes !== 1) {
        const fresh = getEpisode(sqlite, episodeId, spaceId);
        const reason =
          fresh?.forgotten_at != null
            ? "forgotten"
            : fresh?.enrichment_fence !== fence
              ? "fence_mismatch"
              : "status_changed";
        throw new CommitRejectedError(reason);
      }
      return { enrichmentId, version };
    })();

    logAgent(
      h,
      spaceId,
      "episode_enriched",
      `episode_enriched episode_id=${episodeId} version=${result.version} enrichment_id=${result.enrichmentId}`,
      { episode_id: episodeId, version: result.version, enrichment_id: result.enrichmentId },
      "ok",
    );
    return { status: "completed", episodeId, version: result.version, enrichmentId: result.enrichmentId };
  } catch (err) {
    if (err instanceof CommitRejectedError) {
      // Transaction aborted — no partial state visible (T-F4 ordering A).
      logAgent(h, spaceId, "enrichment_commit_rejected", `enrichment_commit_rejected episode_id=${episodeId} reason=${err.reason}`, { episode_id: episodeId, reason: err.reason }, "ok");
      return { status: "rejected", episodeId, reason: "commit_rejected" };
    }
    markEnrichmentFailed(h, spaceId, episodeId, `commit_error:${err instanceof Error ? err.message : "unknown"}`);
    return { status: "rejected", episodeId, reason: "enricher_failed" };
  }
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

export interface GetEpisodesOpts {
  /** Cursor: return episodes with occurred_at < before (reverse-chron). */
  before?: string;
  /** Return episodes with occurred_at > after. */
  after?: string;
  kind?: EpisodeKind;
  limit?: number; // default 50, max 200
}

export interface EpisodeWithEnrichment {
  episode: EpisodeRow;
  /** Current enrichment version (superseded_by IS NULL), or null. */
  enrichment: EpisodeEnrichmentRow | null;
}

/** Parse a joined row (episodes.* + ee_*-prefixed enrichment columns). */
function parseEpisodeJoin(row: Record<string, unknown>): EpisodeWithEnrichment {
  const episode = {
    id: row["id"],
    space_id: row["space_id"],
    kind: row["kind"],
    summary: row["summary"],
    occurred_at: row["occurred_at"],
    recorded_at: row["recorded_at"],
    corrects_episode_id: row["corrects_episode_id"],
    enrichment_status: row["enrichment_status"],
    enrichment_attempts: row["enrichment_attempts"],
    enrichment_lease: row["enrichment_lease"],
    enrichment_fence: row["enrichment_fence"],
    enriched_at: row["enriched_at"],
    forgotten_at: row["forgotten_at"],
    created_at: row["created_at"],
  } as EpisodeRow;
  let enrichment: EpisodeEnrichmentRow | null = null;
  if (row["ee_id"] != null) {
    enrichment = {
      id: row["ee_id"],
      episode_id: row["ee_episode_id"],
      space_id: row["ee_space_id"],
      version: row["ee_version"],
      detail: row["ee_detail"],
      emotion: row["ee_emotion"],
      emotional_weight: row["ee_emotional_weight"],
      importance: row["ee_importance"],
      participants: row["ee_participants"],
      place: row["ee_place"],
      source_node_ids: row["ee_source_node_ids"],
      source_transcript_ref: row["ee_source_transcript_ref"],
      field_provenance: row["ee_field_provenance"],
      embedding: row["ee_embedding"],
      superseded_by: row["ee_superseded_by"],
      created_at: row["ee_created_at"],
    } as EpisodeEnrichmentRow;
  }
  return { episode, enrichment };
}

const EPISODE_JOIN_SELECT = `
  e.*,
  ee.id AS ee_id, ee.episode_id AS ee_episode_id, ee.space_id AS ee_space_id,
  ee.version AS ee_version, ee.detail AS ee_detail, ee.emotion AS ee_emotion,
  ee.emotional_weight AS ee_emotional_weight, ee.importance AS ee_importance,
  ee.participants AS ee_participants, ee.place AS ee_place,
  ee.source_node_ids AS ee_source_node_ids,
  ee.source_transcript_ref AS ee_source_transcript_ref,
  ee.field_provenance AS ee_field_provenance, ee.embedding AS ee_embedding,
  ee.superseded_by AS ee_superseded_by, ee.created_at AS ee_created_at
  FROM episodes e
  LEFT JOIN episode_enrichments ee
    ON ee.episode_id = e.id AND ee.superseded_by IS NULL`;

/**
 * Timeline backend API (design §3.9): episodes in reverse-chronological order
 * with their current enrichment. Pagination is cursor-based
 * (before = ISO timestamp). Kind filter supported.
 *
 * This is a backend retrieval API, not a UI — a future timeline view calls it.
 */
export function getEpisodes(
  h: DbHandle,
  spaceId: string,
  opts: GetEpisodesOpts = {},
): { episodes: EpisodeWithEnrichment[]; nextCursor: string | null } {
  if (opts.kind !== undefined && !EPISODE_KINDS.includes(opts.kind)) {
    throw new ValidationError("kind", "unknown_kind", `Unknown episode kind: ${opts.kind}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const conditions = ["e.space_id = ?"];
  const params: unknown[] = [spaceId];
  if (opts.before !== undefined) {
    conditions.push("e.occurred_at < ?");
    params.push(opts.before);
  }
  if (opts.after !== undefined) {
    conditions.push("e.occurred_at > ?");
    params.push(opts.after);
  }
  if (opts.kind !== undefined) {
    conditions.push("e.kind = ?");
    params.push(opts.kind);
  }
  // Fetch one extra to detect a next page.
  const rows = h.sqlite
    .prepare(
      `SELECT ${EPISODE_JOIN_SELECT}
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(parseEpisodeJoin);
  const nextCursor = hasMore ? (page[page.length - 1]?.episode.occurred_at ?? null) : null;
  return { episodes: page, nextCursor };
}

// ---------------------------------------------------------------------------
// Canonical episode scorer (design §3.6, B10)
// ---------------------------------------------------------------------------

export interface EpisodeScoreInput {
  /** Cosine similarity of the query vector to the episode embedding (0..1). */
  relevance: number;
  /** Canonical ISO UTC of the episode. */
  occurredAt: string;
  /** Enrichment importance (0.5 default for unenriched). */
  importance?: number | null;
  /** Node ids this episode distilled into (source_node_ids). */
  sourceNodeIds?: number[];
  /** "Now" for recency math (injectable for tests). */
  nowMs?: number;
}

/**
 * Canonical episode scorer — one scorer contract shared with W1's node
 * scorer form, with per-kind parameters:
 *
 *   score(e, q) = 0.40·relevance + 0.25·recency + 0.20·importance
 *               + 0.10·trust + 0.05·graph_degree
 *
 * - recency: 0.5^(days_since(occurred_at)/7) — 7-day half-life (episodes are
 *   texture, not reference).
 * - trust: fixed 1.0 — episodes are records, not claims; trust is not a
 *   meaningful axis.
 * - graph_degree: min(1, len(source_node_ids)/10) — episodes that distilled
 *   into many facts are load-bearing.
 */
export function scoreEpisode(input: EpisodeScoreInput): number {
  const nowMs = input.nowMs ?? Date.now();
  const daysSince = Math.max(0, (nowMs - Date.parse(input.occurredAt)) / 86_400_000);
  const recency = Math.pow(0.5, daysSince / 7);
  const importance = input.importance ?? 0.5;
  const graphDegree = Math.min(1, (input.sourceNodeIds?.length ?? 0) / 10);
  return (
    0.4 * input.relevance +
    0.25 * recency +
    0.2 * importance +
    0.1 * 1.0 +
    0.05 * graphDegree
  );
}

// ---------------------------------------------------------------------------
// Episode vector search
// ---------------------------------------------------------------------------

export interface EpisodeSearchHit {
  episodeId: number;
  /** Cosine similarity (1 - distance) from the vec0 KNN. */
  similarity: number;
  /** Canonical scorer output (design §3.6). */
  score: number;
  episode: EpisodeRow;
  enrichment: EpisodeEnrichmentRow | null;
}

/**
 * KNN over episode enrichment embeddings. Mirrors db/vec.ts vecSearchCurrent's
 * iterative over-fetch algorithm (same exhaustion contract: ONLY an empty page
 * means "no more candidates"; same adaptive widening; same 2000 safety bound).
 *
 * DESIGN-GAP: vecSearchCurrent() is nodes-specific (it hardcodes the
 * vec_nodes table and the nodes supersession lookup), so it cannot be called
 * directly for episodes. This is the episodes instantiation of the same
 * algorithm — "code reuse, not a new primitive" per design §7.1 — with the
 * supersession filter reduced to a no-op: episodes are append-only, so the
 * only validity filter is space_id + forgotten_at IS NULL.
 */
function knnEpisodes(
  sqlite: RawDb,
  spaceId: string,
  queryVec: Float32Array,
  k: number,
  logDiagnostic?: (event: string, data: Record<string, unknown>) => void,
): { episodeId: number; distance: number; similarity: number }[] {
  const MAX_CANDIDATES = 2000;
  const lookup = sqlite.prepare(
    `SELECT space_id AS s, forgotten_at AS f FROM episodes WHERE id = ?`,
  );
  const knnStmt = sqlite.prepare(
    `SELECT episode_id AS episodeId, distance
     FROM vec_episodes
     WHERE embedding MATCH ? AND k = ?
     ORDER BY distance`,
  );
  const doFetchPage = (fetchSize: number, offset: number) => {
    const windowed = knnStmt.all(vecToBlob(queryVec), fetchSize + offset) as {
      episodeId: number;
      distance: number;
    }[];
    return windowed.slice(offset);
  };

  const valid: { episodeId: number; distance: number; similarity: number }[] = [];
  let offset = 0;
  let fetchSize = Math.min(500, Math.max(k * 6, k + 40));
  let truncated = false;
  while (valid.length < k) {
    if (offset >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const page = doFetchPage(fetchSize, offset);
    if (page.length === 0) break; // exhaustion contract: only empty = done
    let batchValid = 0;
    for (const hit of page) {
      const row = lookup.get(Number(hit.episodeId)) as
        | { s: string; f: string | null }
        | undefined;
      if (row !== undefined && row.s === spaceId && row.f === null) {
        valid.push({
          episodeId: Number(hit.episodeId),
          distance: hit.distance,
          similarity: cosineSimilarity(hit.distance),
        });
        batchValid++;
        if (valid.length >= k) break;
      }
    }
    offset += page.length;
    if (page.length > 0 && batchValid < page.length / 2) {
      fetchSize = Math.min(fetchSize * 2, Math.max(1, MAX_CANDIDATES - offset));
    }
  }
  if (truncated && logDiagnostic) {
    logDiagnostic("vecSearchTruncated", {
      scope: "episodes",
      space_id: spaceId,
      found: valid.length,
      wanted: k,
      scanned: offset,
    });
  }
  return valid.slice(0, k);
}

/**
 * Episode retrieval for "remember when" queries (design §3.6, §7.1):
 * Stage 1 — top-40 by cosine similarity over enrichment embeddings;
 * Stage 2 — canonical scorer rerank; return top k.
 *
 * Episodes answer "what happened / when did we discuss X / what was that
 * like" — the mental-time-travel queries. "What is true now" goes to nodes
 * (the Tulving retrieval asymmetry, design §3.6).
 */
export function episodeSearch(
  h: DbHandle,
  spaceId: string,
  queryVec: Float32Array,
  k: number,
  opts: {
    logDiagnostic?: (event: string, data: Record<string, unknown>) => void;
    nowMs?: number;
  } = {},
): EpisodeSearchHit[] {
  const sqlite = h.sqlite;
  if (!isVectorEnabled(sqlite)) return [];
  if (queryVec.length !== EMBED_DIM) {
    throw new Error(`Query dim mismatch: got ${queryVec.length}, expected ${EMBED_DIM}.`);
  }
  if (k <= 0) return [];

  // Stage 1: vector candidate generation (top-40 by cosine similarity).
  const candidates = knnEpisodes(sqlite, spaceId, queryVec, 40, opts.logDiagnostic);
  if (candidates.length === 0) return [];

  // Stage 2: canonical scorer rerank.
  const hits: EpisodeSearchHit[] = [];
  for (const c of candidates) {
    const rows = sqlite
      .prepare(`SELECT ${EPISODE_JOIN_SELECT} WHERE e.id = ? AND e.space_id = ?`)
      .all(c.episodeId, spaceId) as Record<string, unknown>[];
    const row0 = rows[0];
    if (!row0) continue;
    const { episode, enrichment } = parseEpisodeJoin(row0);
    if (episode.forgotten_at != null) continue; // defense in depth
    const score = scoreEpisode({
      relevance: c.similarity,
      occurredAt: episode.occurred_at,
      importance: enrichment?.importance ?? 0.5,
      sourceNodeIds: enrichment ? asIntArray(enrichment.source_node_ids) : [],
      nowMs: opts.nowMs,
    });
    hits.push({ episodeId: c.episodeId, similarity: c.similarity, score, episode, enrichment });
  }
  hits.sort((a, b) => b.score - a.score);
  const served = hits.slice(0, k);
  // W3 §8.5 access telemetry: episodeSearch is a retrieval-SERVING read —
  // served hits record access (feeds decay refresh). Telemetry writes
  // access_stats only, never episode rows (T-C44).
  for (const hit of served) recordAccess(h.sqlite, "episode", hit.episodeId);
  return served;
}

/** Episodes for a node — "what experiences led to this fact?" (design §3.6).
 *  Joins through episode_enrichments.source_node_ids (SQLite JSON1). */
export function getEpisodesForNode(
  h: DbHandle,
  spaceId: string,
  nodeId: number,
  limit = 20,
): EpisodeWithEnrichment[] {
  const rows = h.sqlite
    .prepare(
      `SELECT ${EPISODE_JOIN_SELECT}
       WHERE e.space_id = ?
         AND EXISTS (
           SELECT 1 FROM json_each(ee.source_node_ids) WHERE value = ?
         )
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ?`,
    )
    .all(spaceId, nodeId, Math.min(Math.max(limit, 1), 200)) as Record<string, unknown>[];
  return rows.map(parseEpisodeJoin);
}

// ---------------------------------------------------------------------------
// Forget / deletion contract (design §3.7)
// ---------------------------------------------------------------------------

export interface ForgetApplyResult {
  requestId: number;
  episodesTombstoned: number[];
  enrichmentsDeleted: number;
  userModelInvalidated: number[];
  userModelPruned: number[];
  nodesFlaggedForReview: number[];
}

interface EvidenceRef {
  type: "episode" | "node" | "correction" | "enrichment";
  id: number;
}

/**
 * Forget propagation (design §3.7). The redaction exception to INV-EP-1 and
 * INV-DEL-1: the ONLY code path that may UPDATE episodes capture columns or
 * DELETE W2 rows. Requires a forget_requests row with status='approved' and
 * requested_by='user'. Everything runs in ONE transaction — a crash mid-apply
 * rolls back the entire propagation.
 *
 * Per the propagation table:
 * - Target episodes: summary -> TOMBSTONE(requestId) (fixed string, never an
 *   arbitrary edit); forgotten_at = now; enrichment_fence -> fresh token
 *   (revokes outstanding worker claims, B1 Rev 4); enrichment_lease -> NULL.
 *   occurred_at / recorded_at / kind are untouched (structural metadata, not
 *   content — the timeline keeps "something happened here").
 * - Enrichment records of target episodes: DELETE (all versions), including
 *   embeddings. Interpretation of forgotten content has no standing.
 * - vec_episodes rows: DELETE. FTS rows: DELETE. Forgets propagate to search.
 * - User-model entries citing forgotten records as SOLE evidence:
 *   invalid_at = now, invalid_reason = 'evidence_withdrawn'. With independent
 *   remaining evidence: kept, evidence_ids pruned of the forgotten refs.
 * - Nodes distilled from forgotten episodes: NOT auto-deleted — flagged for
 *   user review via a content-free agent_logs row (W6 surfaces the inquiry).
 * - agent_logs: untouched except the new content-free audit rows.
 * - The request row: status='applied', applied_at set, target_query forced to
 *   NULL (nulled at approval per B4 Rev 4; ensured here). The audit proves
 *   THAT a forget occurred — never WHAT was forgotten.
 *
 * Forget/worker race (B1 Rev 4): both orderings are safe. Ordering A — the
 * worker's commit predicate (fence + forgotten_at IS NULL) matches 0 rows
 * after the fence rotation, so its transaction aborts. Ordering B — SQLite
 * serializes the transactions (both BEGIN IMMEDIATE); a committed enrichment
 * is DELETED by this transaction, so no enrichment of forgotten content
 * survives. This transaction is the linearizing point.
 *
 * DESIGN-GAP: §3.7's table invalidates ALL sole-evidence entries regardless
 * of origin, while §3.8 says a `stated` entry with fully-withdrawn evidence
 * "keeps its content (the user said it) but is flagged for review". This
 * implementation follows §3.7's propagation table (the write path);
 * §3.8's stated-entry flagging is a read-time evidence_status annotation in
 * getUserModel() (userModel.ts), which is out of scope for this module.
 */
/**
 * W3 §8.6 stated_set_version write contract — local copy of the helper in
 * agent/userModel.ts (NO cross-import: userModel.ts imports this module's
 * captureEpisode, so importing back would be circular). Increments by the
 * number of stated rows written, in the caller's transaction.
 */
function bumpStatedSetVersion(sqlite: RawDb, spaceId: string, by: number): void {
  if (by <= 0) return;
  sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, stated_set_version)
       VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE
       SET stated_set_version = stated_set_version + excluded.stated_set_version`,
    )
    .run(spaceId, by);
}

export function applyForgetRequest(h: DbHandle, requestId: number): ForgetApplyResult {
  const sqlite = h.sqlite;
  const req = sqlite
    .prepare(`SELECT * FROM forget_requests WHERE id = ?`)
    .get(requestId) as ForgetRequestRow | undefined;
  if (!req) {
    throw new ValidationError("request_id", "not_found", `forget request ${requestId} does not exist`, requestId);
  }
  // INV-DEL-1: the only deletion path requires an approved, user-requested row.
  if (req.requested_by !== "user") {
    throw new ValidationError("requested_by", "not_user", "forget requests must be user-requested");
  }
  if (req.status !== "approved") {
    throw new ValidationError(
      "status",
      "not_approved",
      `forget request ${requestId} has status '${req.status}' — only 'approved' requests can be applied`,
    );
  }
  const spaceId = req.space_id;
  const scopeEpisodeIds = parseJsonArrayInt(req.scope_episode_ids);
  const scopeNodeIds = parseJsonArrayInt(req.scope_node_ids);
  const now = new Date().toISOString();
  const tombstone = TOMBSTONE(requestId);

  const inList = (ids: number[]): string => ids.map(() => "?").join(",");

  const tx = sqlite.transaction((): ForgetApplyResult => {
    // Enrichment ids of the target episodes — captured BEFORE the DELETE, for
    // evidence pruning (type 'enrichment' refs).
    const enrRows =
      scopeEpisodeIds.length > 0
        ? (sqlite
            .prepare(
              `SELECT id FROM episode_enrichments WHERE episode_id IN (${inList(scopeEpisodeIds)})`,
            )
            .all(...scopeEpisodeIds) as { id: number }[])
        : [];
    const forgottenEnrichmentIds = enrRows.map((r) => r.id);
    const forgottenEpisodeSet = new Set(scopeEpisodeIds);
    const forgottenEnrichmentSet = new Set(forgottenEnrichmentIds);
    const forgottenNodeSet = new Set(scopeNodeIds);

    // 1. Tombstone target episodes (the sole permitted UPDATE of capture
    //    columns — INV-EP-1 exception). Fence rotation revokes any in-flight
    //    worker claim even if it already passed its status check.
    const tombstoned: number[] = [];
    const tombstoneStmt = sqlite.prepare(
      `UPDATE episodes
       SET summary = ?, forgotten_at = ?, enrichment_fence = ?, enrichment_lease = NULL
       WHERE id = ? AND space_id = ?`,
    );
    for (const eid of scopeEpisodeIds) {
      const r = tombstoneStmt.run(tombstone, now, freshFence(), eid, spaceId);
      if (r.changes === 1) tombstoned.push(eid);
    }

    // 2. DELETE enrichment records (all versions) of target episodes.
    let enrichmentsDeleted = 0;
    if (scopeEpisodeIds.length > 0) {
      const r = sqlite
        .prepare(`DELETE FROM episode_enrichments WHERE episode_id IN (${inList(scopeEpisodeIds)})`)
        .run(...scopeEpisodeIds);
      enrichmentsDeleted = r.changes;
    }

    // 3. DELETE vector rows (vec0 PK bound as BigInt, cf. db/vec.ts).
    if (isVectorEnabled(sqlite) && scopeEpisodeIds.length > 0) {
      const delVec = sqlite.prepare(`DELETE FROM vec_episodes WHERE episode_id = ?`);
      for (const eid of scopeEpisodeIds) delVec.run(BigInt(eid));
    }

    // 4. DELETE FTS rows.
    if (scopeEpisodeIds.length > 0) {
      sqlite
        .prepare(`DELETE FROM episodes_fts WHERE rowid IN (${inList(scopeEpisodeIds)})`)
        .run(...scopeEpisodeIds);
    }

    // 5. User-model evidence propagation.
    const invalidated: number[] = [];
    const pruned: number[] = [];
    // W3 §8.6: origin is selected so stated-row writes are counted for the
    // stated_set_version bump below (the forget flow is an authorized
    // stated-row writer — tombstoning that invalidates a stated row, or
    // prunes its evidence, bumps exactly like any other stated write).
    let statedRowsWritten = 0;
    const umRows = sqlite
      .prepare(`SELECT id, evidence_ids, origin FROM user_model WHERE space_id = ? AND invalid_at IS NULL`)
      .all(spaceId) as { id: number; evidence_ids: string; origin: string }[];
    const isForgottenRef = (ref: EvidenceRef): boolean =>
      (ref.type === "episode" && forgottenEpisodeSet.has(ref.id)) ||
      (ref.type === "enrichment" && forgottenEnrichmentSet.has(ref.id)) ||
      (ref.type === "node" && forgottenNodeSet.has(ref.id));
    for (const um of umRows) {
      let evidence: EvidenceRef[];
      try {
        const parsed: unknown = JSON.parse(um.evidence_ids);
        if (!Array.isArray(parsed)) continue;
        evidence = parsed as EvidenceRef[];
      } catch {
        continue; // malformed evidence — cannot interpret; leave untouched
      }
      if (evidence.length === 0) continue; // INV-EV-1 guarantees non-empty; be lenient
      const remaining = evidence.filter((ref) => !isForgottenRef(ref));
      if (remaining.length === 0) {
        // Sole evidence withdrawn: suspend the claim, never delete it.
        sqlite
          .prepare(
            `UPDATE user_model
             SET invalid_at = ?, invalid_reason = 'evidence_withdrawn'
             WHERE id = ?`,
          )
          .run(now, um.id);
        invalidated.push(um.id);
        if (um.origin === "stated") statedRowsWritten++;
      } else if (remaining.length < evidence.length) {
        // Independent remaining evidence: the claim survives on its other legs.
        sqlite
          .prepare(`UPDATE user_model SET evidence_ids = ? WHERE id = ?`)
          .run(JSON.stringify(remaining), um.id);
        pruned.push(um.id);
        if (um.origin === "stated") statedRowsWritten++;
      }
    }
    // W3 §8.6: one bump per stated row invalidated or pruned above, inside
    // this same transaction (T-C81 pins the forget path: V → V+1 for a
    // single stated row leaving the current set).
    bumpStatedSetVersion(sqlite, spaceId, statedRowsWritten);

    // 6. Mark the request applied; ensure target_query is NULL (B4 Rev 4 —
    //    the free-text query may itself contain the sensitive content and is
    //    never retained after scope confirmation).
    sqlite
      .prepare(
        `UPDATE forget_requests
         SET status = 'applied', applied_at = ?, target_query = NULL
         WHERE id = ?`,
      )
      .run(now, requestId);

    // 7. Content-free audit rows (IDs and counts only — T-F5).
    sqlite
      .prepare(
        `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
         VALUES (?, 'soumaya', 'forget_applied', ?, ?, 'ok')`,
      )
      .run(
        spaceId,
        `forget_applied request_id=${requestId} episodes=${tombstoned.length} enrichments_deleted=${enrichmentsDeleted}`,
        JSON.stringify({
          request_id: requestId,
          episode_ids: tombstoned,
          enrichment_ids: forgottenEnrichmentIds,
          node_ids: scopeNodeIds,
        }),
      );
    if (scopeNodeIds.length > 0) {
      // Nodes distilled from forgotten episodes are NOT auto-deleted —
      // deleting facts the user may still rely on is destructive. Flagged for
      // user review (surfaced as an inquiry by W6).
      sqlite
        .prepare(
          `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
           VALUES (?, 'soumaya', 'forget_node_review', ?, ?, 'pending_review')`,
        )
        .run(
          spaceId,
          `forget_node_review request_id=${requestId} node_ids=${scopeNodeIds.join(",")}`,
          JSON.stringify({ request_id: requestId, node_ids: scopeNodeIds }),
        );
    }

    return {
      requestId,
      episodesTombstoned: tombstoned,
      enrichmentsDeleted,
      userModelInvalidated: invalidated,
      userModelPruned: pruned,
      nodesFlaggedForReview: scopeNodeIds,
    };
  });

  return tx();
}

// ---------------------------------------------------------------------------
// W3 lineage backfill (§8.6)
// ---------------------------------------------------------------------------

/**
 * Backfill `lineage_key` for pre-W3 episodes from capture metadata WHERE
 * AVAILABLE — else the row stays NULL (lineage unknown). The only metadata
 * in the current capture set that can carry a recoverable lineage is an
 * enrichment's `source_transcript_ref` when the caller stored a
 * conversation-turn reference there in the canonical grain
 * (conv:<session>:turn:<turn>). Everything else — the overwhelming majority
 * of pre-W3 rows — has no recoverable lineage and remains NULL: unknown
 * lineage is ineligible to establish independence (§4.3), and minting a
 * synthetic singleton would manufacture evidence. This function NEVER
 * invents a key. Idempotent; safe to re-run (only NULL rows are touched).
 * Startup wiring is an integration step; T-C56 exercises this function
 * directly.
 */
export function backfillEpisodeLineage(
  h: DbHandle,
  spaceId?: string,
): { updated: number; leftUnknown: number } {
  const sqlite = h.sqlite;
  const CONV_REF = /^conv:[^:\s]+:turn:[^:\s]+$/;
  return sqlite.transaction(() => {
    const rows = sqlite
      .prepare(
        `SELECT e.id AS id,
                (SELECT en.source_transcript_ref
                   FROM episode_enrichments en
                  WHERE en.episode_id = e.id AND en.superseded_by IS NULL
                  ORDER BY en.version DESC
                  LIMIT 1) AS transcript_ref
           FROM episodes e
          WHERE e.lineage_key IS NULL
            ${spaceId ? "AND e.space_id = ?" : ""}`,
      )
      .all(...(spaceId ? [spaceId] : [])) as {
      id: number;
      transcript_ref: string | null;
    }[];
    const update = sqlite.prepare(
      `UPDATE episodes SET lineage_key = ? WHERE id = ? AND lineage_key IS NULL`,
    );
    let updated = 0;
    for (const row of rows) {
      const ref = (row.transcript_ref ?? "").trim();
      if (CONV_REF.test(ref)) {
        update.run(ref, row.id);
        updated++;
      }
    }
    return { updated, leftUnknown: rows.length - updated };
  })();
}
