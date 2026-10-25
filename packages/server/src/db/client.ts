import * as fs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { bootstrapVec, setVectorEnabled, type RawDb } from "./vec.js";
import { bootstrapFts } from "./fts.js";
import { BOOTSTRAP_SQL } from "./schemaSql.js";

export type Schema = typeof schema;
export type Db = BetterSQLite3Database<Schema>;

export interface DbHandle {
  /** Drizzle instance for type-safe relational queries. */
  db: Db;
  /** Raw better-sqlite3 connection for vector + recursive-CTE SQL. */
  sqlite: RawDb;
}

/**
 * Bootstrap the relational schema in raw SQL. Mirrors db/schema.ts and keeps
 * tests fully self-contained (drizzle-kit migrations remain available via
 * `npm run db:generate` for production deploys).
 */
export function bootstrapSchema(sqlite: RawDb): void {
  sqlite.exec(BOOTSTRAP_SQL);
}

/**
 * W3 Design Amendment 1 §2 (owner-approved): extend the
 * user_model.invalid_reason CHECK from five values to seven, adding
 * 'stated_conflict' (decision-table cell 7) and 'evidence_forgotten'
 * (§7.3 forget propagation). SQLite cannot alter a CHECK in place, so an
 * existing five-value table is rebuilt. Fresh bootstraps already carry
 * the seven-value CHECK (schemaSql.ts) and this helper no-ops for them.
 *
 * Tightened spec (Amendment 1 Rev 2):
 * - Idempotence guard parses the current CHECK value SET from
 *   sqlite_master: == original five -> rebuild; == full seven -> skip;
 *   anything else -> throw, naming the found set (fail closed).
 * - Entry asserts no enclosing transaction. PRAGMA foreign_keys is
 *   recorded, set OFF BEFORE BEGIN IMMEDIATE, the rebuild runs in one
 *   transaction, PRAGMA foreign_key_check must return zero rows before
 *   COMMIT, and the recorded FK value is restored in a finally path on
 *   success AND failure, verified by read-back.
 * - The rebuilt table reproduces the complete verified shape (all
 *   columns incl. migrate-only review_flag/review_flagged_at; the slot,
 *   confidence, evidence_strength and origin CHECKs; the
 *   UNIQUE(space_id, slot, content, valid_at); AUTOINCREMENT) and
 *   exactly the three indexes HEAD defines.
 * - Post-assertions throw on mismatch: row-count parity; new CHECK set
 *   == seven; index list + DDL match; integrity_check ok;
 *   sqlite_sequence >= max(id).
 */
export const USER_MODEL_INVALID_REASONS_V1 = [
  "superseded",
  "corrected_false_belief",
  "evidence_withdrawn",
  "expired",
  "user_override",
] as const;
export const USER_MODEL_INVALID_REASONS_V2 = [
  ...USER_MODEL_INVALID_REASONS_V1,
  "stated_conflict",
  "evidence_forgotten",
] as const;

const USER_MODEL_COLUMNS = [
  "id", "space_id", "slot", "content", "confidence", "evidence_strength",
  "evidence_ids", "topic_labels", "valid_at", "invalid_at",
  "invalid_reason", "replaced_by", "origin", "created_at",
  "review_flag", "review_flagged_at",
] as const;

const USER_MODEL_INDEX_DDL: Record<string, string> = {
  idx_user_model_current:
    "CREATE INDEX idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL",
  idx_user_model_origin:
    "CREATE INDEX idx_user_model_origin ON user_model(space_id, origin)",
  idx_user_model_replaced:
    "CREATE INDEX idx_user_model_replaced ON user_model(replaced_by)",
};

/** Parse the invalid_reason CHECK value set out of a user_model DDL string. */
export function parseInvalidReasonCheckSet(ddl: string): string[] | null {
  const m = /invalid_reason\s+TEXT\s+CHECK\s*\(\s*invalid_reason\s+IN\s*\(([^)]*)\)\s*\)/i.exec(ddl);
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

function sameValueSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export function migrateUserModelInvalidReasonCheck(sqlite: RawDb): { migrated: boolean } {
  const tableRow = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_model'`)
    .get() as { sql: string | null } | undefined;
  if (!tableRow?.sql) return { migrated: false }; // table created later in migrateSchema
  const found = parseInvalidReasonCheckSet(tableRow.sql);
  if (found && sameValueSet(found, USER_MODEL_INVALID_REASONS_V2)) {
    return { migrated: false }; // already seven — idempotent no-op
  }
  if (!found || !sameValueSet(found, USER_MODEL_INVALID_REASONS_V1)) {
    throw new Error(
      `W3 Amendment 1 migration: unexpected user_model invalid_reason CHECK set ` +
        `[${found ? found.join(", ") : "unparseable DDL"}] — expected the original five ` +
        `[${USER_MODEL_INVALID_REASONS_V1.join(", ")}] or the full seven; failing closed.`,
    );
  }
  if (sqlite.inTransaction) {
    throw new Error(
      "W3 Amendment 1 migration: user_model rebuild requires no enclosing transaction " +
        "(sqlite.inTransaction is true) — failing closed.",
    );
  }

  const sourceCols = (
    sqlite.prepare(`PRAGMA table_info(user_model)`).all() as { name: string }[]
  ).map((c) => c.name);
  const copyCols = USER_MODEL_COLUMNS.filter((c) => sourceCols.includes(c));
  const beforeCount = (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }
  ).n;

  const prevFk = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(`
        CREATE TABLE user_model_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id TEXT NOT NULL DEFAULT 'legacy',
          slot TEXT NOT NULL CHECK (slot IN (
            'belief','desire','intention','emotion_state','knowledge','constraint'
          )),
          content TEXT NOT NULL,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          evidence_strength REAL NOT NULL DEFAULT 0
            CHECK (evidence_strength >= 0 AND evidence_strength <= 1),
          evidence_ids TEXT NOT NULL DEFAULT '[]',
          topic_labels TEXT NOT NULL DEFAULT '[]',
          valid_at TEXT NOT NULL,
          invalid_at TEXT,
          invalid_reason TEXT CHECK (invalid_reason IN (
            'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override',
            'stated_conflict','evidence_forgotten'
          )),
          replaced_by INTEGER,
          origin TEXT NOT NULL CHECK (origin IN ('stated','inferred','consolidated')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          review_flag TEXT,
          review_flagged_at TEXT,
          UNIQUE (space_id, slot, content, valid_at)
        );
      `);
      const cols = copyCols.join(", ");
      sqlite.exec(`INSERT INTO user_model_new (${cols}) SELECT ${cols} FROM user_model`);
      sqlite.exec(`DROP TABLE user_model`);
      sqlite.exec(`ALTER TABLE user_model_new RENAME TO user_model`);
      for (const ddl of Object.values(USER_MODEL_INDEX_DDL)) sqlite.exec(ddl);
      const fkViolations = sqlite.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new Error(
          `W3 Amendment 1 migration: foreign_key_check returned ${fkViolations.length} row(s) after rebuild — rolling back.`,
        );
      }
      sqlite.exec("COMMIT");
    } catch (err) {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      throw err;
    }
  } finally {
    sqlite.pragma(`foreign_keys = ${prevFk ? "ON" : "OFF"}`);
    const restored = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
    if (restored !== prevFk) {
      throw new Error("W3 Amendment 1 migration: failed to restore PRAGMA foreign_keys to its recorded value.");
    }
  }

  // Post-assertions (throw on mismatch).
  const afterCount = (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }
  ).n;
  if (afterCount !== beforeCount) {
    throw new Error(
      `W3 Amendment 1 migration: row-count mismatch after rebuild (before=${beforeCount}, after=${afterCount}).`,
    );
  }
  const newDdl = (
    sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_model'`)
      .get() as { sql: string }
  ).sql;
  const newSet = parseInvalidReasonCheckSet(newDdl);
  if (!newSet || !sameValueSet(newSet, USER_MODEL_INVALID_REASONS_V2)) {
    throw new Error("W3 Amendment 1 migration: rebuilt CHECK set is not the full seven values.");
  }
  const indexRows = sqlite
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_model' AND sql IS NOT NULL`)
    .all() as { name: string; sql: string }[];
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (
    indexRows.length !== 3 ||
    !indexRows.every((r) => {
      const expected = USER_MODEL_INDEX_DDL[r.name];
      return !!expected && norm(r.sql) === norm(expected);
    })
  ) {
    throw new Error(
      `W3 Amendment 1 migration: rebuilt index inventory mismatch (found: ${indexRows.map((r) => r.name).join(", ") || "none"}).`,
    );
  }
  const integrity = sqlite.pragma("integrity_check") as { integrity_check: string }[];
  if (!integrity.every((r) => r.integrity_check === "ok")) {
    throw new Error("W3 Amendment 1 migration: integrity_check failed after rebuild.");
  }
  const maxId = (
    sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM user_model`).get() as { m: number }
  ).m;
  if (maxId > 0) {
    const seqRow = sqlite
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'user_model'`)
      .get() as { seq: number } | undefined;
    if (!seqRow || seqRow.seq < maxId) {
      throw new Error(
        `W3 Amendment 1 migration: sqlite_sequence (${seqRow?.seq ?? "missing"}) < max(id) (${maxId}) after rebuild.`,
      );
    }
  }
  return { migrated: true };
}

/** Owned TTS cache DDL (ADR-018 A3) — identical to BOOTSTRAP_SQL in schemaSql.ts. */
export const TTS_AUDIO_CACHE_OWNED_DDL = `
  CREATE TABLE tts_audio_cache (
    space_id TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    audio BLOB NOT NULL,
    content_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (space_id, cache_key)
  );
  CREATE INDEX tts_audio_cache_space_created_idx ON tts_audio_cache(space_id, created_at);
`;

const TTS_AUDIO_CACHE_LEGACY_COLUMNS = [
  "cache_key",
  "audio",
  "content_type",
  "filename",
  "created_at",
] as const;

interface TtsTableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/**
 * ADR-018 A3 — rebuild `tts_audio_cache` to the space-owned shape.
 * Follows the `migrateUserModelInvalidReasonCheck` precedent: idempotent,
 * transactional, fails closed.
 * - Table absent → create the owned shape + index.
 * - `space_id` already present → ensure the index exists, no-op.
 * - Legacy shape → validate it is exactly the known legacy column set;
 *   any other shape throws (source data untouched). A known legacy table
 *   is rebuilt in ONE transaction: rename, create owned table, copy ZERO
 *   rows (intentional purge — legacy rows have no trustworthy owner,
 *   ADR D2), drop the legacy table, create the index, then assert the
 *   final contract; any failure rolls back leaving the legacy table intact.
 */
export function migrateTtsAudioCacheOwned(sqlite: RawDb): { migrated: boolean } {
  const cols = sqlite.prepare(`PRAGMA table_info(tts_audio_cache)`).all() as TtsTableInfoRow[];
  if (cols.length === 0) {
    // Table (and therefore its index) absent — plain CREATE is safe.
    sqlite.exec(TTS_AUDIO_CACHE_OWNED_DDL);
    return { migrated: true };
  }
  if (cols.some((c) => c.name === "space_id")) {
    sqlite.exec(
      `CREATE INDEX IF NOT EXISTS tts_audio_cache_space_created_idx ON tts_audio_cache(space_id, created_at)`,
    );
    return { migrated: false };
  }
  const names = cols.map((c) => c.name);
  const isKnownLegacy =
    names.length === TTS_AUDIO_CACHE_LEGACY_COLUMNS.length &&
    TTS_AUDIO_CACHE_LEGACY_COLUMNS.every((n) => names.includes(n));
  if (!isKnownLegacy) {
    throw new Error(
      `ADR-018 migration: unexpected tts_audio_cache column set [${names.join(", ")}] — ` +
        `expected the known legacy set [${TTS_AUDIO_CACHE_LEGACY_COLUMNS.join(", ")}] ` +
        `or the owned shape with space_id; failing closed (source data untouched).`,
    );
  }
  if (sqlite.inTransaction) {
    throw new Error(
      "ADR-018 migration: tts_audio_cache rebuild requires no enclosing transaction " +
        "(sqlite.inTransaction is true) — failing closed.",
    );
  }
  const prevFk = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(`ALTER TABLE tts_audio_cache RENAME TO tts_audio_cache_legacy_unowned`);
      sqlite.exec(TTS_AUDIO_CACHE_OWNED_DDL);
      // Intentional purge (ADR D2): copy ZERO rows from the legacy table.
      sqlite.exec(`DROP TABLE tts_audio_cache_legacy_unowned`);
      // Assert the final contract before COMMIT.
      const after = sqlite.prepare(`PRAGMA table_info(tts_audio_cache)`).all() as TtsTableInfoRow[];
      const spaceId = after.find((c) => c.name === "space_id");
      const cacheKey = after.find((c) => c.name === "cache_key");
      if (!spaceId || spaceId.notnull !== 1 || spaceId.pk !== 1 || !cacheKey || cacheKey.pk !== 2) {
        throw new Error(
          "ADR-018 migration: rebuilt tts_audio_cache does not match the owned contract " +
            "(space_id NOT NULL + PRIMARY KEY (space_id, cache_key)) — rolling back.",
        );
      }
      const idxRows = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tts_audio_cache'`,
        )
        .all() as { name: string }[];
      if (!idxRows.some((r) => r.name === "tts_audio_cache_space_created_idx")) {
        throw new Error(
          "ADR-018 migration: rebuilt tts_audio_cache is missing tts_audio_cache_space_created_idx — rolling back.",
        );
      }
      const fkViolations = sqlite.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new Error(
          `ADR-018 migration: foreign_key_check returned ${fkViolations.length} row(s) after rebuild — rolling back.`,
        );
      }
      sqlite.exec("COMMIT");
    } catch (err) {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      throw err;
    }
  } finally {
    sqlite.pragma(`foreign_keys = ${prevFk ? "ON" : "OFF"}`);
    const restored = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
    if (restored !== prevFk) {
      throw new Error("ADR-018 migration: failed to restore PRAGMA foreign_keys to its recorded value.");
    }
  }
  return { migrated: true };
}

/**
 * Lightweight additive migrations for databases created before a column existed
 * (e.g. an existing volume on Fly). CREATE TABLE IF NOT EXISTS won't add new
 * columns, so we patch them in idempotently.
 */
export function migrateSchema(sqlite: RawDb): void {
  const cols = sqlite.prepare(`PRAGMA table_info(nodes)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "importance")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN importance REAL`);
  }
  if (!cols.some((c) => c.name === "celestial_title")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN celestial_title TEXT`);
  }
  if (!cols.some((c) => c.name === "color")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN color TEXT`);
  }
  // Provenance: who authored a node ("agent" = Soumaya, e.g. a constellation hub).
  if (!cols.some((c) => c.name === "origin")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN origin TEXT`);
  }
  // Which autonomous agent last worked a node (attribution; e.g. "soumaya"/"scout").
  if (!cols.some((c) => c.name === "agent")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN agent TEXT`);
  }
  // Soft-delete safety (merged/redundant memories are flagged, not erased).
  if (!cols.some((c) => c.name === "deleted_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN deleted_at TEXT`);
  }
  if (!cols.some((c) => c.name === "merged_into")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN merged_into INTEGER`);
  }
  // Action items: transient day-to-day to-dos that expire.
  if (!cols.some((c) => c.name === "kind")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN kind TEXT`);
  }
  if (!cols.some((c) => c.name === "expires_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN expires_at TEXT`);
  }
  // Celestial Economy: when a memory was last tended (drives entropy).
  if (!cols.some((c) => c.name === "last_tended_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN last_tended_at TEXT`);
  }
  // Soumaya's reminder tool: when a due reminder was actually FIRED (delivered), so it
  // never re-fires. NULL = pending / never had a remind_at.
  if (!cols.some((c) => c.name === "reminder_fired_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN reminder_fired_at TEXT`);
  }
  // Spaced-repetition / active-recall (NEURO_ALIGNMENT #1): SM-2-ish memory-strength
  // scheduling per memory. All NULL = never scheduled (seeded lazily on first review sweep).
  for (const [col, ddl] of [
    ["review_ease", `ALTER TABLE nodes ADD COLUMN review_ease REAL`],
    ["review_interval_days", `ALTER TABLE nodes ADD COLUMN review_interval_days REAL`],
    ["next_review_at", `ALTER TABLE nodes ADD COLUMN next_review_at TEXT`],
    ["last_reviewed_at", `ALTER TABLE nodes ADD COLUMN last_reviewed_at TEXT`],
    ["review_count", `ALTER TABLE nodes ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0`],
    // Lifecycle status: an archived memory rests — kept, but out of the galaxy + retrieval
    // by default (not deleted). Feature runway #5a.
    ["status", `ALTER TABLE nodes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`],
  ] as const) {
    if (!cols.some((c) => c.name === col)) sqlite.exec(ddl);
  }
  // Insights gain a `kind` ("synthesis" | "contradiction") on existing volumes (additive).
  const insightCols = sqlite.prepare(`PRAGMA table_info(insights)`).all() as { name: string }[];
  if (insightCols.length > 0 && !insightCols.some((c) => c.name === "kind")) {
    sqlite.exec(`ALTER TABLE insights ADD COLUMN kind TEXT NOT NULL DEFAULT 'synthesis'`);
  }
  // Temporal memory: when the event happened (backdatable), a future reminder,
  // and free/curated tags. All optional, additive for existing volumes.
  if (!cols.some((c) => c.name === "occurred_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN occurred_at TEXT`);
  }
  if (!cols.some((c) => c.name === "remind_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN remind_at TEXT`);
  }
  if (!cols.some((c) => c.name === "tags")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN tags TEXT`);
  }
  if (!cols.some((c) => c.name === "research_questions")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN research_questions TEXT`);
  }
  if (!cols.some((c) => c.name === "research_answers")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN research_answers TEXT`);
  }
  // Cognitive layer: 0..1 progress for goals (completion) + skills (level).
  if (!cols.some((c) => c.name === "progress")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN progress REAL`);
  }
  // Cognitive layer: the moment a goal actually finished — set once, permanent (a
  // completed goal never loses that status even if progress is later nudged back
  // down). Distinguishes "just hit 100%" from "sitting at 99%" and gives a goal a
  // real payoff instead of a number that quietly stops moving.
  if (!cols.some((c) => c.name === "completed_at")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN completed_at TEXT`);
  }
  // Cognitive layer: aliases (JSON array) so vague memories ("my girlfriend") link
  // to the right Mind entry (person/place/…) without needing the exact name.
  if (!cols.some((c) => c.name === "aliases")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN aliases TEXT`);
  }

  // Multi-tenancy: add space_id to every per-user table on existing volumes.
  // Pre-existing rows keep the 'legacy' default and are claimed on first signup.
  const addSpaceId = (table: string) => {
    const tcols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (tcols.length > 0 && !tcols.some((c) => c.name === "space_id")) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN space_id TEXT NOT NULL DEFAULT 'legacy'`);
    }
  };
  for (const t of ["nodes", "edges", "insights", "agent_logs", "daily_logs"]) addSpaceId(t);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS nodes_space_idx ON nodes(space_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS edges_space_idx ON edges(space_id)`);
  // Migrate spaces table to non-unique name + unique gamer_tag if needed
  const spaceCols = sqlite.prepare(`PRAGMA table_info(spaces)`).all() as { name: string }[];
  if (spaceCols.length > 0 && !spaceCols.some((c) => c.name === "gamer_tag")) {
    sqlite.transaction(() => {
      sqlite.exec(`ALTER TABLE spaces RENAME TO spaces_old`);
      sqlite.exec(`
        CREATE TABLE spaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          gamer_tag TEXT NOT NULL UNIQUE,
          passcode_hash TEXT NOT NULL,
          passcode_salt TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // gamer_tag is UNIQUE, but the old `name` column was not — copying name→gamer_tag
      // verbatim would abort the migration (and crash boot on a real volume) if two old
      // brains shared a name (case-insensitively). De-dupe: the earliest brain in each
      // name-group keeps the bare name; later collisions get the unique id appended.
      sqlite.exec(`
        INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt, created_at)
        SELECT id, name,
               CASE WHEN rn = 1 THEN name ELSE name || '#' || id END AS gamer_tag,
               passcode_hash, passcode_salt, created_at
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS rn
          FROM spaces_old
        )
      `);
      sqlite.exec(`DROP TABLE spaces_old`);
    })();
  }

  // Daily-tending streak columns on existing space_meta volumes (additive).
  const metaCols = sqlite.prepare(`PRAGMA table_info(space_meta)`).all() as { name: string }[];
  if (metaCols.length > 0) {
    if (!metaCols.some((c) => c.name === "streak")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN streak INTEGER NOT NULL DEFAULT 0`);
    }
    if (!metaCols.some((c) => c.name === "streak_best")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN streak_best INTEGER NOT NULL DEFAULT 0`);
    }
    if (!metaCols.some((c) => c.name === "last_active_date")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN last_active_date TEXT`);
    }
    // Timestamp of the user's last visit — drives the "while you were away" digest.
    if (!metaCols.some((c) => c.name === "last_seen_at")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN last_seen_at TEXT`);
    }
    // Per-space Research Mode (was a global settings row any tenant could flip).
    // NULL = fall back to the legacy global setting so existing brains keep working.
    if (!metaCols.some((c) => c.name === "research_enabled")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN research_enabled TEXT`);
    }
    // Last UTC day a dream-cycle belief was consolidated (Level 2).
    if (!metaCols.some((c) => c.name === "last_dream_date")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN last_dream_date TEXT`);
    }
    // One-time flag: the Chronicle has seeded its opening chapter from existing history.
    if (!metaCols.some((c) => c.name === "timeline_backfilled")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN timeline_backfilled INTEGER NOT NULL DEFAULT 0`);
    }
    // Streak freeze ("nebula shield", NEURO_ALIGNMENT #3): forgive a missed day so a
    // broken streak is data, not punishment. Start with 2; earn one back each 7-day run.
    if (!metaCols.some((c) => c.name === "streak_shields")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN streak_shields INTEGER NOT NULL DEFAULT 2`);
    }
    // Per-space editable soul (feature #5b): overrides the global soul.md for THIS brain
    // when set. NULL/empty → the global soul.md is used.
    if (!metaCols.some((c) => c.name === "soul")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN soul TEXT`);
    }
    // Grounded-insight chat mode: when ON (default), her reflections must be specific,
    // evidence-grounded + falsifiable (anti-Barnum); OFF relaxes to a looser style.
    if (!metaCols.some((c) => c.name === "grounded_insight")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN grounded_insight INTEGER NOT NULL DEFAULT 1`);
    }
    // Phase 2 notification policy: per-space proactive messaging preferences.
    // timezone: IANA identifier used for quiet hours, digest time, and cap-day
    // boundaries. Validated at set-time via Intl; invalid values are rejected.
    if (!metaCols.some((c) => c.name === "timezone")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'`);
    }
    // quiet_start / quiet_end: HH:MM local time; proactive normal-priority sends
    // are queued during this window. May cross midnight (e.g. 21:00-04:30).
    if (!metaCols.some((c) => c.name === "quiet_start")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN quiet_start TEXT NOT NULL DEFAULT '21:00'`);
    }
    if (!metaCols.some((c) => c.name === "quiet_end")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN quiet_end TEXT NOT NULL DEFAULT '04:30'`);
    }
    // digest_time: HH:MM local time for the daily digest (replaces midnight UTC).
    if (!metaCols.some((c) => c.name === "digest_time")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN digest_time TEXT NOT NULL DEFAULT '06:00'`);
    }
    // daily_proactive_cap: max normal-priority proactive sends per local day.
    // Urgent bypasses; digest never counts.
    if (!metaCols.some((c) => c.name === "daily_proactive_cap")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN daily_proactive_cap INTEGER NOT NULL DEFAULT 5`);
    }
    // W1 temporal truth: dependent-fact cascade gate. DISABLED BY DEFAULT (0).
    // May only be enabled after depends_on/assumes edge semantics are verified
    // (see docs/wisdom/w1-design-revision.md §4 Rule 2, §5.1).
    if (!metaCols.some((c) => c.name === "w1_cascade_enabled")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w1_cascade_enabled INTEGER NOT NULL DEFAULT 0`);
    }
    // W3 consolidation (wisdom layer, design Rev 11 §8.1): per-space knobs for
    // the nightly consolidation job + the stated_set_version counter (§8.6
    // write contract: bumped in the same transaction as EVERY stated-row
    // write — see agent/userModel.ts bumpStatedSetVersion).
    if (!metaCols.some((c) => c.name === "last_consolidation_date")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN last_consolidation_date TEXT`);
    }
    if (!metaCols.some((c) => c.name === "w3_enabled")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_enabled INTEGER NOT NULL DEFAULT 1`);
    }
    if (!metaCols.some((c) => c.name === "w3_llm_budget")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_llm_budget INTEGER NOT NULL DEFAULT 15`);
    }
    if (!metaCols.some((c) => c.name === "w3_max_items")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_max_items INTEGER NOT NULL DEFAULT 50`);
    }
    if (!metaCols.some((c) => c.name === "w3_frozen")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_frozen INTEGER NOT NULL DEFAULT 0`);
    }
    if (!metaCols.some((c) => c.name === "w3_recon_batch")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_recon_batch INTEGER NOT NULL DEFAULT 200`);
    }
    if (!metaCols.some((c) => c.name === "w3_recon_semantic_budget")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_recon_semantic_budget INTEGER NOT NULL DEFAULT 10`);
    }
    if (!metaCols.some((c) => c.name === "w3_recon_sim_threshold")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_recon_sim_threshold REAL NOT NULL DEFAULT 0.75`);
    }
    if (!metaCols.some((c) => c.name === "w3_recon_pairs_budget")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN w3_recon_pairs_budget INTEGER NOT NULL DEFAULT 2000`);
    }
    if (!metaCols.some((c) => c.name === "stated_set_version")) {
      sqlite.exec(`ALTER TABLE space_meta ADD COLUMN stated_set_version INTEGER NOT NULL DEFAULT 0`);
    }
  }
  // Phase 2: outbox for deferred proactive notifications. The policy layer queues
  // here instead of dropping when quiet hours or the daily cap block a send.
  // See agent/notify/outbox.ts for the lifecycle (queued->sending->sent|failed|
  // dropped|ambiguous) and docs/SOUMAYA_TOOLS.md for the design.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notif_key TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      is_urgent INTEGER NOT NULL DEFAULT 0,
      urgent_reason TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      deliver_after TEXT NOT NULL,
      bill_due_at TEXT,
      remind_at TEXT,
      cap_day TEXT,
      send_started_at TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS notification_outbox_status_idx
      ON notification_outbox(status, deliver_after);
    CREATE INDEX IF NOT EXISTS notification_outbox_space_idx
      ON notification_outbox(space_id, cap_day, status);
  `);
  const outboxCols = sqlite.prepare(`PRAGMA table_info(notification_outbox)`).all() as { name: string }[];
  if (outboxCols.length > 0 && !outboxCols.some((c) => c.name === "bill_due_at")) {
    sqlite.exec(`ALTER TABLE notification_outbox ADD COLUMN bill_due_at TEXT`);
  }
  // ADR-018 A2b/B1: immutable original reminder due time, persisted at enqueue
  // and read on every retry for urgency/staleness reclassification.
  if (outboxCols.length > 0 && !outboxCols.some((c) => c.name === "remind_at")) {
    sqlite.exec(`ALTER TABLE notification_outbox ADD COLUMN remind_at TEXT`);
  }
  // Server-backed Inbox notifications (IM-74): same DDL as BOOTSTRAP_SQL —
  // CREATE TABLE IF NOT EXISTS makes this a no-op on fresh volumes and the
  // creation path on volumes that predate the table.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS inbox_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🔔',
      priority TEXT NOT NULL DEFAULT 'normal',
      dedupe_key TEXT,
      seen_at TEXT,
      snoozed_until TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS inbox_notifications_space_idx ON inbox_notifications(space_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS inbox_notifications_dedupe_idx ON inbox_notifications(space_id, dedupe_key);
  `);
  // Life Vision (docs/specs/life-vision.md): optional one-to-many link from a Financial
  // Goal to the Life Vision node it helps fund. Nullable, no SQL FK (matches bucket_id's
  // own style in this table) — validated at the application layer only. `tcols.length > 0`
  // guards a very old volume predating Wealth: bootstrap creates fin_goal fresh with this
  // column already present, so there's nothing to ALTER.
  const finGoalCols = sqlite.prepare(`PRAGMA table_info(fin_goal)`).all() as { name: string }[];
  if (finGoalCols.length > 0) {
    if (!finGoalCols.some((c) => c.name === "vision_node_id")) {
      sqlite.exec(`ALTER TABLE fin_goal ADD COLUMN vision_node_id INTEGER`);
    }
    // Created here rather than in schemaSql.ts's bootstrap block: by this point the
    // column is guaranteed to exist (either just ALTERed above, or already present
    // from a fresh bootstrap), so this is safe for both a brand-new DB and an
    // upgraded old one — unlike creating it unconditionally right after CREATE TABLE,
    // which fails on an old volume where the CREATE TABLE is a no-op.
    sqlite.exec(`CREATE INDEX IF NOT EXISTS fin_goal_vision_idx ON fin_goal(vision_node_id)`);
  }
  // Life Seasons (IM-132, docs/specs/timeline-life-seasons.md): explicit Journey
  // span columns — migrateSchema ONLY (PRAGMA-guarded ALTERs), never in
  // BOOTSTRAP_SQL (bootstrap runs before migrateSchema, so a bootstrap
  // reference to a migration-only column crashes fresh-volume boot). Nullable:
  // existing journeys keep NULL and their span is link-inferred on read.
  const journeyColsIM132 = sqlite.prepare(`PRAGMA table_info(journeys)`).all() as { name: string }[];
  if (journeyColsIM132.length > 0) {
    if (!journeyColsIM132.some((c) => c.name === "started_at")) {
      sqlite.exec(`ALTER TABLE journeys ADD COLUMN started_at TEXT`);
    }
    if (!journeyColsIM132.some((c) => c.name === "ended_at")) {
      sqlite.exec(`ALTER TABLE journeys ADD COLUMN ended_at TEXT`);
    }
  }
  // (Table creation lives ONLY in bootstrapSchema, which always runs first —
  // a second CREATE block here once drifted out of sync and shipped wrong shapes.)

  // Phase 1 agent loop: approval lifecycle + crash-safe execution.
  // tool_approvals is the operational state machine (mutable by design):
  //   pending -> confirmed -> executing -> executed | failed
  //   pending -> denied | expired
  // Every transition also appends to agent_logs (the immutable audit trail).
  // args_json holds the exact args to execute (operational necessity — may contain
  // user text; NEVER copied into agent_logs). Terminal rows are pruned after 7d
  // by maintenance; the audit trail in agent_logs is permanent.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tool_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      principal TEXT NOT NULL,
      tool TEXT NOT NULL,
      args_json TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      execution_attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      execution_log_id INTEGER
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_approvals_space_idx ON tool_approvals(space_id, status)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS tool_approvals_principal_idx ON tool_approvals(principal, status)`);

  // Telegram open-ended notes (parity Phase 3): durable /note drafts. Same
  // column set as BOOTSTRAP_SQL in db/schemaSql.ts — CREATE TABLE IF NOT
  // EXISTS makes this a safe no-op on fresh databases (bootstrapSchema
  // always runs first) and creates the table on existing volumes.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS telegram_note_drafts (
      space_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      part_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS telegram_note_drafts_space_idx ON telegram_note_drafts(space_id);
  `);

  // Append-only enforcement for the audit trail. No UPDATE or DELETE against
  // agent_logs exists in the codebase (verified); these triggers make that
  // structural instead of conventional. Operational state lives in
  // tool_approvals (mutable by design) — the audit rows here are immutable.
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_logs_no_update
    BEFORE UPDATE ON agent_logs
    BEGIN
      SELECT RAISE(ABORT, 'agent_logs is append-only');
    END
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS agent_logs_no_delete
    BEFORE DELETE ON agent_logs
    BEGIN
      SELECT RAISE(ABORT, 'agent_logs is append-only');
    END
  `);

  // Phase 1 agent loop: idempotency support on nodes.
  // - idempotency_key: set by write tools to the approval id. UNIQUE(space_id,
  //   idempotency_key) so a crash-retry of the same approval can never create a
  //   duplicate row. NULL keys (all existing rows) never conflict in SQLite.
  // - fired_by_approval: which approval fired a reminder (fire_reminder's side
  //   effect is an UPDATE, not an INSERT). Set atomically in the same UPDATE as
  //   reminder_fired_at so a retry can distinguish "I fired this" from
  //   "someone else fired this".
  if (!cols.some((c) => c.name === "idempotency_key")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN idempotency_key TEXT`);
  }
  if (!cols.some((c) => c.name === "fired_by_approval")) {
    sqlite.exec(`ALTER TABLE nodes ADD COLUMN fired_by_approval INTEGER`);
  }
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS nodes_idem_idx ON nodes(space_id, idempotency_key)`);

  // W1 temporal truth (wisdom layer): bitemporal columns on nodes + append-only
  // corrections table. See docs/wisdom/w1-design-revision.md for the full design.
  //
  // SQLite forbids parenthesized expression defaults on ALTER TABLE ADD COLUMN,
  // so migrated schemas get nullable recorded_at WITHOUT a DB default. The
  // fresh-schema BOOTSTRAP_SQL uses an expression default (legal in CREATE TABLE)
  // as a backstop; application code (NodesRepo.create + supersede()) always sets
  // recorded_at explicitly. This is a known, accepted schema asymmetry — parity
  // is behavioral, not definitional (see test T-PAR-1).
  for (const [col, ddl] of [
    ["valid_from", `ALTER TABLE nodes ADD COLUMN valid_from TEXT`],
    ["valid_to", `ALTER TABLE nodes ADD COLUMN valid_to TEXT`],
    ["recorded_at", `ALTER TABLE nodes ADD COLUMN recorded_at TEXT`],
    ["superseded_at", `ALTER TABLE nodes ADD COLUMN superseded_at TEXT`],
    ["superseded_by", `ALTER TABLE nodes ADD COLUMN superseded_by INTEGER`],
    ["supersede_reason", `ALTER TABLE nodes ADD COLUMN supersede_reason TEXT`],
  ] as const) {
    if (!cols.some((c) => c.name === col)) sqlite.exec(ddl);
  }
  // Corrections are append-only events (never updated/deleted). CREATE TABLE IF
  // NOT EXISTS is idempotent — no ALTER needed for a new table.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      node_id INTEGER NOT NULL,
      correction_type TEXT NOT NULL,
      corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      corrected_by TEXT NOT NULL,
      reason TEXT,
      superseding_node_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_node ON corrections(node_id);
    CREATE INDEX IF NOT EXISTS idx_corrections_space_time ON corrections(space_id, corrected_at);
  `);
  // W1 backfill — ORDER MATTERS (see design §9.2):
  // STEP 1: normalize created_at to canonical ISO 8601 UTC FIRST.
  //   This runs UNCONDITIONALLY — even on fresh databases where recorded_at
  //   never needs backfilling, created_at may still carry SQLite's legacy
  //   CURRENT_TIMESTAMP format from its column default. Skipping normalization
  //   here would trip the canonical-format assertion below on next startup.
  // STEP 2: backfill recorded_at from the NOW-NORMALIZED created_at (only where NULL).
  // Reversing this order leaves recorded_at in the old SQLite format.
  sqlite.exec(`
    UPDATE nodes
    SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
    WHERE created_at NOT LIKE '%T%';
    UPDATE edges
    SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
    WHERE created_at NOT LIKE '%T%';
  `);
  const needsBackfill = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE recorded_at IS NULL`)
    .get() as { n: number };
  if (needsBackfill.n > 0) {
    sqlite.exec(`UPDATE nodes SET recorded_at = created_at WHERE recorded_at IS NULL`);
  }
  // Post-migration assertion: every non-null temporal timestamp must match the
  // canonical format. Loud failure (throw) — not silent corruption.
  // recorded_at backfilled from created_at is the best available proxy for
  // "when the system learned the fact" — documented, not proof of exact time.
  const bad = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM nodes
       WHERE (created_at IS NOT NULL AND created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
          OR (recorded_at IS NOT NULL AND recorded_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
          OR (valid_from IS NOT NULL AND valid_from NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
          OR (valid_to IS NOT NULL AND valid_to NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
          OR (superseded_at IS NOT NULL AND superseded_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`,
    )
    .get() as { n: number };
  if (bad.n > 0) {
    throw new Error(`W1 migration: ${bad.n} rows have non-canonical timestamps after normalization`);
  }
// INSERT INTO packages/server/src/db/client.ts migrateSchema()
// AFTER line 442 (the closing `}` of the W1 `if (bad.n > 0)` block), BEFORE line 443
// (the closing `}` of migrateSchema).
//
// NOTE: the existing comment above the tool_approvals block — "(Table creation
// lives ONLY in bootstrapSchema...)" — is outdated: Phase 1 (tool_approvals),
// W1 (corrections), and now W2 all create new tables here. IF NOT EXISTS makes
// this a safe no-op on fresh databases (bootstrapSchema always runs first).

  // W2 episodes + user model (wisdom layer): immutable episode captures,
  // versioned enrichments, structured user model, forget requests, and the
  // enrichment quota ledger. Design: docs/wisdom/w2-design-canonical.md
  // (canonical design, §§3.2, 3.3, 3.5, 3.7, 4.2, 8.1, 8.5).
  //
  // New tables via CREATE TABLE IF NOT EXISTS — the same column set as
  // BOOTSTRAP_SQL in db/schemaSql.ts (T-M1/T-M2 pin equivalence). No ALTERs
  // needed: W2 creates NEW tables, never modifies existing ones, so the W1
  // expression-default-on-ALTER asymmetry does not arise here — both paths
  // declare identical DDL including the strftime expression defaults.
  // References are application-enforced (§8.5) — no SQL REFERENCES clauses.
  sqlite.exec(`
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

    CREATE TABLE IF NOT EXISTS user_model (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      slot TEXT NOT NULL CHECK (slot IN (
        'belief','desire','intention','emotion_state','knowledge','constraint'
      )),
      content TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      evidence_strength REAL NOT NULL DEFAULT 0 CHECK (evidence_strength >= 0 AND evidence_strength <= 1),
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      topic_labels TEXT NOT NULL DEFAULT '[]',
      valid_at TEXT NOT NULL,
      invalid_at TEXT,
      invalid_reason TEXT CHECK (invalid_reason IN (
        'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'
      )),
      replaced_by INTEGER,
      origin TEXT NOT NULL CHECK (origin IN ('stated','inferred','consolidated')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (space_id, slot, content, valid_at)
    );
    CREATE INDEX IF NOT EXISTS idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_user_model_origin ON user_model(space_id, origin);
    CREATE INDEX IF NOT EXISTS idx_user_model_replaced ON user_model(replaced_by);

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

    CREATE TABLE IF NOT EXISTS enrichment_quota (
      space_id TEXT NOT NULL,
      quota_date TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed >= 0),
      PRIMARY KEY (space_id, quota_date)
    );

    -- Episode keyword search (same pattern as node FTS): FTS5 over capture
    -- summary + current enrichment detail, rowid = episode id. Sync is
    -- EXPLICIT (manual upsert/delete from the episode write path, no triggers).
    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(summary, detail);
  `);

  // W3 consolidation (wisdom layer, design Rev 11 §8): nightly consolidation
  // job state — run claims, the work-item ledger, the typed contradiction
  // backlog, access telemetry, and the reconciliation sweep's durable cursor
  // + semantic queue. New tables via CREATE TABLE IF NOT EXISTS with the same
  // column set as BOOTSTRAP_SQL in db/schemaSql.ts (T-C55 pins equivalence).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      window_date TEXT NOT NULL,
      fence TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','aborted_budget')),
      lease_expires_at TEXT NOT NULL,
      items_processed INTEGER NOT NULL DEFAULT 0,
      llm_calls INTEGER NOT NULL DEFAULT 0,
      contradictions_resolved INTEGER NOT NULL DEFAULT 0,
      consolidations_written INTEGER NOT NULL DEFAULT 0,
      stated_integrity_hash TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (space_id, window_date)
    );
    CREATE INDEX IF NOT EXISTS idx_consolidation_runs_space
      ON consolidation_runs(space_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS consolidation_episodes (
      space_id TEXT NOT NULL,
      episode_id INTEGER NOT NULL,
      outcome TEXT NOT NULL
        CHECK (outcome IN ('consolidated','strengthened','skipped_covered','skipped_low_importance','abstained',
                           'failed_terminal','failed_retryable')),
      resulting_entry_id INTEGER,
      evidence_group_set TEXT NOT NULL,
      evidence_fingerprint TEXT NOT NULL,
      last_run_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, episode_id)
    );

    CREATE TABLE IF NOT EXISTS contradictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      domain TEXT NOT NULL CHECK (domain IN ('nodes','user_model')),
      old_kind TEXT NOT NULL CHECK (old_kind IN ('node','user_model_entry')),
      old_id INTEGER NOT NULL,
      new_kind TEXT NOT NULL CHECK (new_kind IN ('node','user_model_entry','episode')),
      new_id INTEGER NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('factual_update','false_belief','preference_change','state_transition','duplicate_claim')),
      reported_by TEXT NOT NULL CHECK (reported_by IN ('temporal_propose','knowledge_check','consolidation','sweep','user','reconciliation')),
      report_ref TEXT,
      reopens_id INTEGER,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending','claimed','resolved','unresolved','moot','stated_conflict')),
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_by_run INTEGER,
      claim_fence TEXT,
      lease_expires_at TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair
      ON contradictions(space_id, domain, old_kind, old_id, new_kind, new_id)
      WHERE state IN ('pending','claimed');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair_ref
      ON contradictions(space_id, domain, old_kind, old_id, new_kind, new_id, report_ref);

    CREATE TABLE IF NOT EXISTS access_stats (
      entity_type TEXT NOT NULL CHECK (entity_type IN ('episode','user_model_entry','node')),
      entity_id INTEGER NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS w3_recon_progress (
      space_id TEXT PRIMARY KEY,
      cursor_valid_at TEXT,
      cursor_id INTEGER,
      partial_valid_at TEXT,
      partial_id INTEGER,
      partial_stated_overlap REAL,
      partial_stated_id INTEGER,
      partial_stated_version INTEGER,
      last_pass_completed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS w3_recon_semantic_queue (
      space_id TEXT NOT NULL,
      consolidated_id INTEGER NOT NULL,
      stated_id INTEGER NOT NULL,
      similarity REAL NOT NULL,
      queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (space_id, consolidated_id, stated_id)
    );

    -- Living Galaxy (IM-140): journey mission completions — identical DDL to
    -- BOOTSTRAP_SQL in db/schemaSql.ts (new table, both paths).
    CREATE TABLE IF NOT EXISTS journey_mission_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      journey_id INTEGER NOT NULL,
      task_ref_id INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_mission_completions_unique
      ON journey_mission_completions(space_id, journey_id, task_ref_id);
  `);
  // ADR-018: shared atomic delivery ledger — the sole cap-counting authority
  // for proactive notifications across Telegram + web push. New table, both
  // paths: identical DDL to BOOTSTRAP_SQL in db/schemaSql.ts (fresh DBs
  // already have it; this is a no-op there).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notification_cap_claims (
      space_id TEXT NOT NULL,
      local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      channel TEXT NOT NULL CHECK (channel IN ('telegram', 'push')),
      delivery_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'sent', 'ambiguous', 'released')),
      cap_exempt INTEGER NOT NULL DEFAULT 0 CHECK (cap_exempt IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, channel, delivery_key, local_day)
    );
    CREATE INDEX IF NOT EXISTS notification_cap_claims_count_idx
      ON notification_cap_claims(space_id, local_day, state, cap_exempt);
  `);
  // Worlds travel (Phase 2, P2-2): the travel journey ledger. New tables,
  // both paths: identical DDL to BOOTSTRAP_SQL in db/schemaSql.ts (fresh
  // DBs already have them; this is a no-op there).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS travel_journeys (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      client_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warp','drift')),
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('arming','in_transit','returning','arrived','returned','cancelled')),
      fuel_charged REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      cancel_deadline TEXT NOT NULL,
      departed_at TEXT,
      arrived_at TEXT,
      ended_at TEXT,
      bonus_credited_at TEXT,
      bonus_amount REAL NOT NULL DEFAULT 0,
      bonus_reason TEXT,
      UNIQUE (space_id, client_key)
    );
    CREATE INDEX IF NOT EXISTS idx_travel_journeys_space_created
      ON travel_journeys(space_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS travel_journeys_one_active
      ON travel_journeys (space_id) WHERE state IN ('arming','in_transit','returning');
    CREATE TABLE IF NOT EXISTS travel_journey_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journey_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('departure_armed','departed','cancelled','turned_back','arrived','returned')),
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_travel_events_journey
      ON travel_journey_events(journey_id);
  `);

  // P2-4 journey-bonus outcome columns on existing travel_journeys volumes
  // (additive; the marker is the exactly-once crediting record).
  const travelCols = sqlite.prepare(`PRAGMA table_info(travel_journeys)`).all() as { name: string }[];
  if (travelCols.length > 0) {
    if (!travelCols.some((c) => c.name === "bonus_credited_at")) {
      sqlite.exec(`ALTER TABLE travel_journeys ADD COLUMN bonus_credited_at TEXT`);
    }
    if (!travelCols.some((c) => c.name === "bonus_amount")) {
      sqlite.exec(`ALTER TABLE travel_journeys ADD COLUMN bonus_amount REAL NOT NULL DEFAULT 0`);
    }
    if (!travelCols.some((c) => c.name === "bonus_reason")) {
      sqlite.exec(`ALTER TABLE travel_journeys ADD COLUMN bonus_reason TEXT`);
    }
  }
  // ADR-018 A3: rebuild tts_audio_cache to the space-owned shape (legacy
  // unowned rows purged; see migrateTtsAudioCacheOwned). Runs here rather
  // than as a plain CREATE because an existing legacy table must be
  // rebuilt, not merely created-if-absent.
  migrateTtsAudioCacheOwned(sqlite);
  // W3 columns on EXISTING tables — migrateSchema ONLY (PRAGMA-guarded
  // ALTERs). These must never appear in BOOTSTRAP_SQL (the v252 precedent:
  // bootstrap runs before migrateSchema, so a bootstrap reference to a
  // migration-only column crashes fresh-volume boot).
  const episodeColsW3 = sqlite.prepare(`PRAGMA table_info(episodes)`).all() as { name: string }[];
  if (episodeColsW3.length > 0) {
    // §4.3/§8.6: durable source-lineage key. Nullable — pre-W3 rows stay NULL
    // (unknown lineage) unless backfill can recover a key from capture
    // metadata; never a synthetic singleton.
    if (!episodeColsW3.some((c) => c.name === "lineage_key")) {
      sqlite.exec(`ALTER TABLE episodes ADD COLUMN lineage_key TEXT`);
    }
    if (!episodeColsW3.some((c) => c.name === "lineage_basis")) {
      sqlite.exec(`ALTER TABLE episodes ADD COLUMN lineage_basis TEXT`);
    }
  }
  const userModelColsW3 = sqlite.prepare(`PRAGMA table_info(user_model)`).all() as { name: string }[];
  if (userModelColsW3.length > 0) {
    // §6.4: review flags — the ONLY columns maintenance may write on stated
    // rows (via the SetReviewFlag operation). Existing rows get NULL.
    if (!userModelColsW3.some((c) => c.name === "review_flag")) {
      sqlite.exec(`ALTER TABLE user_model ADD COLUMN review_flag TEXT`);
    }
    if (!userModelColsW3.some((c) => c.name === "review_flagged_at")) {
      sqlite.exec(`ALTER TABLE user_model ADD COLUMN review_flagged_at TEXT`);
    }
  }
  const inquiryColsW3 = sqlite.prepare(`PRAGMA table_info(inquiries)`).all() as { name: string }[];
  if (inquiryColsW3.length > 0 && !inquiryColsW3.some((c) => c.name === "contradiction_id")) {
    sqlite.exec(`ALTER TABLE inquiries ADD COLUMN contradiction_id INTEGER`);
  }
  // §5.5 inquiry dedup. SQLite UNIQUE treats NULLs as distinct, so the many
  // inquiries with contradiction_id NULL never collide.
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiries_contradiction ON inquiries(space_id, contradiction_id)`);

  // Fix round 3 (forget-request binding, D1/D9): `forget_requests`
  // gains `target_source_id INTEGER NULL`, plus the partial unique
  // index for at most one live (pending/approved) source-forget
  // request per source per space. migrateSchema ONLY, never
  // BOOTSTRAP_SQL (v252 crash precedent) — the CREATE TABLE above is
  // a no-op on existing volumes, so only this PRAGMA-guarded ALTER
  // can add the column, on fresh and legacy volumes alike. No FK, no
  // backfill: NULL is the only correct default (a pre-column request's
  // intended source is unknowable — target_query is nulled at
  // approval — and such rows must refuse, D5). This MUST sit before
  // the W2 post-migration assertion below (which lists the column)
  // and AFTER the W2 CREATE TABLE block above (the index cannot
  // reference a column that does not exist yet). SQLite treats NULLs
  // as distinct in a unique index, so legacy/episodic NULL rows
  // never conflict.
  const forgetCols = sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[];
  if (forgetCols.length > 0) {
    if (!forgetCols.some((c) => c.name === "target_source_id")) {
      sqlite.exec(`ALTER TABLE forget_requests ADD COLUMN target_source_id INTEGER`);
    }
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_forget_requests_live_source
       ON forget_requests(space_id, target_source_id)
       WHERE status IN ('pending','approved')`,
    );
  }

  // W3 Amendment 1 §2 (Milestone 3): extend the user_model.invalid_reason
  // CHECK to seven values via table rebuild when the live table still has
  // the original five. Runs AFTER the review_flag ALTERs above so the
  // rebuild copies the complete column inventory. No-op on fresh
  // bootstraps (seven-value CHECK already) — see the helper for the
  // guard/FK/post-assertion contract.
  migrateUserModelInvalidReasonCheck(sqlite);

  // W2 post-migration assertion: all six W2 tables exist with the expected
  // columns. Loud failure (throw) on mismatch — same pattern as the W1
  // timestamp assertion above. Runs on every boot, covering both fresh
  // (bootstrap) and migrated volumes (T-M1).
  const w2Tables: Record<string, string[]> = {
    episodes: [
      "id", "space_id", "kind", "summary", "occurred_at", "recorded_at",
      "corrects_episode_id", "enrichment_status", "enrichment_attempts",
      "enrichment_lease", "enrichment_fence", "enriched_at", "forgotten_at",
      "created_at",
    ],
    episode_enrichments: [
      "id", "episode_id", "space_id", "version", "detail", "emotion",
      "emotional_weight", "importance", "participants", "place",
      "source_node_ids", "source_transcript_ref", "field_provenance",
      "embedding", "superseded_by", "created_at",
    ],
    user_model: [
      "id", "space_id", "slot", "content", "confidence", "evidence_strength",
      "evidence_ids", "topic_labels", "valid_at", "invalid_at",
      "invalid_reason", "replaced_by", "origin", "created_at",
    ],
    forget_requests: [
      "id", "space_id", "requested_by", "target_episode_id", "target_node_id",
      "target_query", "scope_episode_ids", "scope_node_ids", "scope_topics",
      "status", "created_at", "applied_at", "target_source_id",
    ],
    enrichment_quota: ["space_id", "quota_date", "claimed"],
    // FTS5 virtual table: rowid is implicit (not listed by PRAGMA table_info).
    episodes_fts: ["summary", "detail"],
  };
  for (const [table, expected] of Object.entries(w2Tables)) {
    const w2Cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const missing = expected.filter((c) => !w2Cols.some((col) => col.name === c));
    if (missing.length > 0) {
      throw new Error(`W2 migration: table ${table} missing columns: ${missing.join(", ")}`);
    }
  }

  // W3 post-migration assertion: all W3 tables + migrated columns exist.
  // Same loud-failure pattern; runs on every boot (T-C55).
  const w3Tables: Record<string, string[]> = {
    consolidation_runs: [
      "id", "space_id", "window_date", "fence", "started_at", "completed_at",
      "status", "lease_expires_at", "items_processed", "llm_calls",
      "contradictions_resolved", "consolidations_written",
      "stated_integrity_hash", "error", "created_at",
    ],
    consolidation_episodes: [
      "space_id", "episode_id", "outcome", "resulting_entry_id",
      "evidence_group_set", "evidence_fingerprint", "last_run_id",
      "updated_at", "created_at",
    ],
    contradictions: [
      "id", "space_id", "domain", "old_kind", "old_id", "new_kind", "new_id",
      "category", "reported_by", "report_ref", "reopens_id", "state",
      "attempts", "claimed_by_run", "claim_fence", "lease_expires_at",
      "resolution", "created_at", "resolved_at",
    ],
    access_stats: ["entity_type", "entity_id", "last_accessed_at", "access_count"],
    w3_recon_progress: [
      "space_id", "cursor_valid_at", "cursor_id", "partial_valid_at",
      "partial_id", "partial_stated_overlap", "partial_stated_id",
      "partial_stated_version", "last_pass_completed_at", "updated_at",
    ],
    w3_recon_semantic_queue: [
      "space_id", "consolidated_id", "stated_id", "similarity", "queued_at",
      "attempts",
    ],
  };
  for (const [table, expected] of Object.entries(w3Tables)) {
    const w3Cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const missing = expected.filter((c) => !w3Cols.some((col) => col.name === c));
    if (missing.length > 0) {
      throw new Error(`W3 migration: table ${table} missing columns: ${missing.join(", ")}`);
    }
  }
  const w3ColumnChecks: Record<string, string[]> = {
    space_meta: [
      "last_consolidation_date", "w3_enabled", "w3_llm_budget", "w3_max_items",
      "w3_frozen", "w3_recon_batch", "w3_recon_semantic_budget",
      "w3_recon_sim_threshold", "w3_recon_pairs_budget", "stated_set_version",
    ],
    episodes: ["lineage_key", "lineage_basis"],
    user_model: ["review_flag", "review_flagged_at"],
    inquiries: ["contradiction_id"],
  };
  for (const [table, expected] of Object.entries(w3ColumnChecks)) {
    const tCols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const missing = expected.filter((c) => !tCols.some((col) => col.name === c));
    if (missing.length > 0) {
      throw new Error(`W3 migration: table ${table} missing columns: ${missing.join(", ")}`);
    }
  }

  // Web push (Immersion Round 3, CL3): subscription storage for existing
  // volumes. New table only — CREATE TABLE IF NOT EXISTS with DDL identical
  // to BOOTSTRAP_SQL in db/schemaSql.ts (fresh DBs already have it; this is a
  // no-op there). No columns are added to existing tables, so the
  // bootstrap-references-migration-column crash pattern cannot arise.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL DEFAULT 'legacy',
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_space_idx ON push_subscriptions(space_id);
  `);

  // Web push policy deferral (Immersion Round 3 follow-up, owner decision
  // 2026-10-21): pending-push store for existing volumes. New table only —
  // CREATE TABLE IF NOT EXISTS with DDL identical to BOOTSTRAP_SQL in
  // db/schemaSql.ts (fresh DBs already have it; no-op there). No columns
  // are added to existing tables, so the bootstrap-references-migration-
  // column crash pattern cannot arise.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS push_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      push_key TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '/',
      status TEXT NOT NULL DEFAULT 'pending',
      is_urgent INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      deliver_after TEXT NOT NULL,
      cap_day TEXT,
      send_started_at TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS push_outbox_pending_idx ON push_outbox(status, deliver_after);
  `);
  // ADR-018 A2b: immutable original due-time columns on push_outbox —
  // migrateSchema-only PRAGMA-guarded ALTERs, NEVER in BOOTSTRAP_SQL
  // (v252 rule: bootstrap runs before migrateSchema, so a bootstrap
  // reference to a migration-only column crashes fresh-volume boot).
  // Populated from NotifyMeta at enqueue; read on every retry for
  // urgency/staleness reclassification.
  const pushOutboxCols = sqlite.prepare(`PRAGMA table_info(push_outbox)`).all() as { name: string }[];
  if (pushOutboxCols.length > 0) {
    if (!pushOutboxCols.some((c) => c.name === "remind_at")) {
      sqlite.exec(`ALTER TABLE push_outbox ADD COLUMN remind_at TEXT`);
    }
    if (!pushOutboxCols.some((c) => c.name === "bill_due_at")) {
      sqlite.exec(`ALTER TABLE push_outbox ADD COLUMN bill_due_at TEXT`);
    }
  }
  // ADR-019 §8: settlement marker on fin_income / fin_expense —
  // migrateSchema-only PRAGMA-guarded ALTERs, NEVER in BOOTSTRAP_SQL
  // (same v252 rule as above). The marker is set iff the entry's amount
  // is currently reflected in fin_account.balance_cents (I9). The
  // one-time backfill (= created_at) runs ONLY in the first-add step:
  // under the pre-ADR-019 ledger model every existing row already
  // adjusted the balance at creation, so each legacy row IS applied.
  // Re-opens find the column present and never re-run the backfill, so
  // a live marker can never be stomped.
  for (const table of ["fin_income", "fin_expense"] as const) {
    const finCols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (finCols.length > 0 && !finCols.some((c) => c.name === "balance_applied_at")) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN balance_applied_at TEXT`);
      sqlite.exec(`UPDATE ${table} SET balance_applied_at = created_at WHERE balance_applied_at IS NULL`);
    }
  }

  // Verbatim-Recall V1 Source Layer (design note Rev 1-3, sections
  // 18.2-18.3). New tables via CREATE TABLE IF NOT EXISTS with DDL
  // identical to BOOTSTRAP_SQL in db/schemaSql.ts (the W2 pattern) —
  // a no-op on fresh volumes, the migration on legacy ones.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      citation_class TEXT NOT NULL DEFAULT 'verbatim_typed',
      title TEXT,
      raw_bytes BLOB NOT NULL,
      raw_text TEXT,
      encoding TEXT NOT NULL DEFAULT 'utf8',
      content_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      speaker TEXT NOT NULL DEFAULT 'owner',
      occurred_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      idempotency_key TEXT,
      audio_ref TEXT,
      processing_status TEXT NOT NULL DEFAULT 'preserved',
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      processing_lease_owner TEXT,
      processing_lease_expires_at TEXT,
      extraction_hash TEXT,
      capture_intent TEXT NOT NULL DEFAULT 'extract',
      capture_params TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sources_space_occurred
      ON sources(space_id, occurred_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_space_idempotency
      ON sources(space_id, idempotency_key);
    CREATE TABLE IF NOT EXISTS source_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      start_ms INTEGER,
      end_ms INTEGER,
      indexed_vec INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_source_chunks_space_source_ordinal
      ON source_chunks(space_id, source_id, ordinal);
    CREATE TABLE IF NOT EXISTS node_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      chunk_id INTEGER,
      role TEXT NOT NULL DEFAULT 'origin',
      active INTEGER NOT NULL DEFAULT 1,
      superseded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (node_id, chunk_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_node_sources_node
      ON node_sources(node_id, active);
    CREATE INDEX IF NOT EXISTS idx_node_sources_source
      ON node_sources(source_id, active);
    CREATE TABLE IF NOT EXISTS source_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      chunk_id INTEGER,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      corrected_text TEXT NOT NULL,
      reason TEXT,
      corrected_by TEXT,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (source_id, seq)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS sources_fts USING fts5(text);
  `);

  // Fix round 2 (audit P1: direct-capture recovery): volumes created
  // by the V1 build (PR #104, pre-fix-2) already have a `sources`
  // table WITHOUT capture_intent/capture_params — the CREATE TABLE
  // above is a no-op for them. PRAGMA-guarded ALTERs backfill the
  // columns (same pattern as the journeys span columns above).
  //
  // Fix round 3 — the 'extract' default is NOT correct for every
  // pre-fix-2 row, despite what this comment used to claim. Pre-fix-2
  // direct captures (Telegram /note saves and action captures) were
  // persisted without intent, so they are defaulted to 'extract' here
  // and boot recovery runs them through generic extraction — the
  // recovery routing cannot tell them apart afterwards (see the
  // disclosed residual in sources/recovery.ts). The default is kept
  // because there is no safe signal to reclassify them by (no guessing
  // from content or title); it is a known misroute, not a correct one.
  const sourceCols = sqlite.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[];
  if (sourceCols.length > 0) {
    if (!sourceCols.some((c) => c.name === "capture_intent")) {
      sqlite.exec(`ALTER TABLE sources ADD COLUMN capture_intent TEXT NOT NULL DEFAULT 'extract'`);
    }
    if (!sourceCols.some((c) => c.name === "capture_params")) {
      sqlite.exec(`ALTER TABLE sources ADD COLUMN capture_params TEXT`);
    }
  }
}

/**
 * Open the database, load sqlite-vec, and bootstrap both the relational and
 * vector schemas. Pass ":memory:" for tests.
 */
export function createDb(path: string = process.env.DB_PATH ?? "./brain.db"): DbHandle {
  const sqlite = new BetterSqlite3(path);
  try {
    const serverRoot = nodePath.resolve(fileURLToPath(import.meta.url), "../../../");
    const localVecPath = nodePath.join(serverRoot, "vec0.so");
    if (fs.existsSync(localVecPath)) {
      sqlite.loadExtension(localVecPath);
      setVectorEnabled(sqlite, true);
    } else {
      sqliteVec.load(sqlite);
      setVectorEnabled(sqlite, true);
    }
  } catch (err) {
    console.warn(
      `WARNING: Failed to load sqlite-vec extension. Vector features (semantic search, AI routing) will be disabled.`,
      err
    );
    setVectorEnabled(sqlite, false);
  }
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  // ADR-018 A3: a legacy (unowned) tts_audio_cache must be rebuilt BEFORE
  // bootstrapSchema — BOOTSTRAP_SQL's owned CREATE is a no-op on an existing
  // legacy table, and its space_created index (on the new space_id column)
  // would fail with "no such column: space_id" and abort the rest of
  // bootstrap. The rebuild is idempotent; migrateSchema calls it again as
  // a no-op. On an unexpected legacy shape this throws here, before any
  // bootstrap statement runs, leaving the source table untouched.
  migrateTtsAudioCacheOwned(sqlite);
  bootstrapSchema(sqlite);
  migrateSchema(sqlite);
  bootstrapVec(sqlite);
  bootstrapFts(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
