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
 * Lightweight additive migrations for databases created before a column existed
 * (e.g. an existing volume on Fly). CREATE TABLE IF NOT EXISTS won't add new
 * columns, so we patch them in idempotently.
 */
function migrateSchema(sqlite: RawDb): void {
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
  bootstrapSchema(sqlite);
  migrateSchema(sqlite);
  bootstrapVec(sqlite);
  bootstrapFts(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
