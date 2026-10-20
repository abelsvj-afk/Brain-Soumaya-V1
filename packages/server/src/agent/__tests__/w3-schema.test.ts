/**
 * W3 Milestone 1 tests — Phase B schema + lineage capture contract.
 *
 * Design: docs/wisdom/w3-design.md (Revision 11, owner-approved).
 * Test IDs are defined in §12 of that document; describe blocks are named
 * "T-Cxx: <name>" to match.
 *
 * Conventions (mirroring w2.test.ts):
 * - `createDb(":memory:")` per test — createDb runs bootstrapSchema +
 *   migrateSchema, so every handle carries the full W3 schema.
 * - No mocked transactional outcomes: all assertions run against real
 *   SQLite state.
 *
 * TEST-GAP (mirrors W2's T-M2 note): no pre-W3 production volume fixture is
 * available in this environment, so T-C55's migrated path is covered by
 * (a) exact expected-shape assertions on the createDb result (the same
 * columns/indexes the migration produces), (b) fresh-vs-fresh fingerprint
 * equivalence, (c) a drift negative case proving the fingerprint detects
 * differences, and (d) behavioral UNIQUE probes. The migrateSchema code
 * path itself runs inside every createDb() call above.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import {
  captureEpisode,
  backfillEpisodeLineage,
  type CaptureInput,
} from "../episodic.js";

const SPACE = "w3-m1-test-space";

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});

afterEach(() => {
  (handle.sqlite as unknown as { close(): void }).close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Sqlite = DbHandle["sqlite"];

function capture(input: CaptureInput): number {
  const res = captureEpisode(handle, SPACE, input);
  if (!res) throw new Error("captureEpisode returned null");
  return res.episodeId;
}

function episodeRow(id: number): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM episodes WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

/** Distinct KNOWN (non-NULL) lineage groups among the given episodes —
 * the §4.3 grouping rule the §4.5 threshold counts. */
function knownLineageGroups(ids: number[]): Set<string> {
  const keys = new Set<string>();
  for (const id of ids) {
    const row = episodeRow(id);
    if (typeof row.lineage_key === "string") keys.add(row.lineage_key);
  }
  return keys;
}

const W3_TABLE_COLUMNS: Record<string, string[]> = {
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

const W3_MIGRATED_COLUMNS: Record<string, string[]> = {
  space_meta: [
    "last_consolidation_date", "w3_enabled", "w3_llm_budget", "w3_max_items",
    "w3_frozen", "w3_recon_batch", "w3_recon_semantic_budget",
    "w3_recon_sim_threshold", "w3_recon_pairs_budget", "stated_set_version",
  ],
  episodes: ["lineage_key", "lineage_basis"],
  user_model: ["review_flag", "review_flagged_at"],
  inquiries: ["contradiction_id"],
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Paren-aware extraction of top-level CHECK(...) expressions (w2 pattern). */
function extractCheckExprs(createTableSql: string): string[] {
  const out: string[] = [];
  const re = /\bCHECK\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(createTableSql)) !== null) {
    let i = m.index + m[0].length;
    while (i < createTableSql.length && /\s/.test(createTableSql[i]!)) i++;
    if (createTableSql[i] !== "(") continue;
    let depth = 0;
    const start = i;
    for (; i < createTableSql.length; i++) {
      if (createTableSql[i] === "(") depth++;
      else if (createTableSql[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    out.push(createTableSql.slice(start, i));
  }
  return out;
}

/** Structural fingerprint of the full W3 schema surface on one database. */
function w3SchemaFingerprint(sqlite: Sqlite): string {
  const parts: string[] = [];
  const tables = [
    ...Object.keys(W3_TABLE_COLUMNS),
    ...Object.keys(W3_MIGRATED_COLUMNS),
  ];
  for (const table of tables) {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Record<
      string,
      unknown
    >[];
    parts.push(
      `${table}:cols=` +
        JSON.stringify(
          cols.map((c) => ({
            name: c.name,
            type: String(c.type ?? "").toUpperCase(),
            notnull: c.notnull,
            dflt: c.dflt_value ?? null,
            pk: c.pk,
          })),
        ),
    );
    const idx = sqlite
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
         ORDER BY name`,
      )
      .all(table) as { name: string; sql: string }[];
    parts.push(
      `${table}:idx=` +
        JSON.stringify(idx.map((r) => [r.name, normalizeSql(r.sql)])),
    );
    const ddl = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) as { sql: string } | undefined;
    if (ddl) {
      parts.push(
        `${table}:checks=` +
          JSON.stringify(extractCheckExprs(ddl.sql).map(normalizeSql).sort()),
      );
    }
  }
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// T-C55: bootstrap-vs-migration schema equivalence
// ---------------------------------------------------------------------------

describe("T-C55: fresh-bootstrap vs migrated DB produce identical W3 schemas", () => {
  it("creates every W3 table with the exact expected columns", () => {
    for (const [table, expected] of Object.entries(W3_TABLE_COLUMNS)) {
      const cols = handle.sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as { name: string }[];
      expect(cols.length, `table ${table} missing`).toBeGreaterThan(0);
      expect(cols.map((c) => c.name).sort()).toEqual([...expected].sort());
    }
  });

  it("adds every migrateSchema-only W3 column to existing tables", () => {
    for (const [table, expected] of Object.entries(W3_MIGRATED_COLUMNS)) {
      const cols = handle.sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      for (const col of expected) {
        expect(names.has(col), `${table}.${col} missing`).toBe(true);
      }
    }
    // space_meta defaults land with the design's values.
    handle.sqlite
      .prepare(`INSERT INTO space_meta (space_id) VALUES (?)`)
      .run(SPACE);
    const meta = handle.sqlite
      .prepare(
        `SELECT w3_enabled, w3_llm_budget, w3_max_items, w3_frozen,
                w3_recon_batch, w3_recon_semantic_budget, w3_recon_sim_threshold,
                w3_recon_pairs_budget, stated_set_version
         FROM space_meta WHERE space_id = ?`,
      )
      .get(SPACE) as Record<string, number>;
    expect(meta).toMatchObject({
      w3_enabled: 1,
      w3_llm_budget: 15,
      w3_max_items: 50,
      w3_frozen: 0,
      w3_recon_batch: 200,
      w3_recon_semantic_budget: 10,
      w3_recon_sim_threshold: 0.75,
      w3_recon_pairs_budget: 2000,
      stated_set_version: 0,
    });
  });

  it("fresh-vs-fresh fingerprints are identical, and drift is detected", () => {
    const other = createDb(":memory:");
    try {
      expect(w3SchemaFingerprint(handle.sqlite)).toBe(
        w3SchemaFingerprint(other.sqlite),
      );
      other.sqlite.exec(`DROP INDEX idx_contradictions_pair_ref`);
      expect(w3SchemaFingerprint(handle.sqlite)).not.toBe(
        w3SchemaFingerprint(other.sqlite),
      );
    } finally {
      (other.sqlite as unknown as { close(): void }).close();
    }
  });

  it("UNIQUE behavior: consolidation_runs admits one row per (space, window)", () => {
    const ins = () =>
      handle.sqlite
        .prepare(
          `INSERT INTO consolidation_runs
             (space_id, window_date, fence, started_at, lease_expires_at)
           VALUES (?, '2026-10-19', 'fence-1', '2026-10-20T01:00:00.000Z', '2026-10-20T07:00:00.000Z')`,
        )
        .run(SPACE);
    ins();
    expect(ins).toThrow();
  });

  it("UNIQUE behavior: contradictions partial index + report_ref dedup", () => {
    const ins = (state: string, ref: string | null) =>
      handle.sqlite
        .prepare(
          `INSERT INTO contradictions
             (space_id, domain, old_kind, old_id, new_kind, new_id, category,
              reported_by, report_ref, state)
           VALUES (?, 'user_model', 'user_model_entry', 1, 'user_model_entry', 2,
                   'factual_update', 'user', ?, ?)`,
        )
        .run(SPACE, ref, state);
    ins("pending", "ref-1");
    // Same pair still active → partial unique index rejects.
    expect(() => ins("pending", "ref-2")).toThrow();
    // Terminal state frees the pair for a genuinely new report...
    handle.sqlite
      .prepare(`UPDATE contradictions SET state = 'resolved' WHERE space_id = ?`)
      .run(SPACE);
    ins("pending", "ref-2");
    // ...but the same (pair, report_ref) is a duplicate across ALL states.
    expect(() => ins("pending", "ref-1")).toThrow();
    // NULL refs never dedupe (legacy rows carry no ref).
    ins("resolved", null);
    ins("resolved", null);
  });

  it("UNIQUE behavior: semantic queue PK and inquiries contradiction dedup", () => {
    const q = () =>
      handle.sqlite
        .prepare(
          `INSERT INTO w3_recon_semantic_queue
             (space_id, consolidated_id, stated_id, similarity, queued_at)
           VALUES (?, 10, 20, 0.8, '2026-10-20T01:00:00.000Z')`,
        )
        .run(SPACE);
    q();
    expect(q).toThrow();

    const inq = (cid: number | null) =>
      handle.sqlite
        .prepare(
          `INSERT INTO inquiries (space_id, question, kind, signature, contradiction_id)
           VALUES (?, 'q?', 'link', ?, ?)`,
        )
        .run(SPACE, `sig-${Math.random()}`, cid);
    inq(null);
    inq(null); // NULLs are distinct under SQLite UNIQUE — both admitted.
    inq(42);
    expect(() => inq(42)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-C56: lineage backfill + always-set-on-new-capture
// ---------------------------------------------------------------------------

describe("T-C56: lineage_key backfill", () => {
  it("pre-W3 episodes without recoverable metadata stay NULL (unknown)", () => {
    // Seed a pre-W3-shaped row (no lineage written at capture time).
    const r = handle.sqlite
      .prepare(
        `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
         VALUES (?, 'conversation', 'Conversation: old turn', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      )
      .run(SPACE);
    const id = Number(r.lastInsertRowid);
    const res = backfillEpisodeLineage(handle, SPACE);
    expect(res.updated).toBe(0);
    expect(res.leftUnknown).toBe(1);
    expect(episodeRow(id).lineage_key).toBeNull();
  });

  it("recovers a key from capture metadata where available, never synthetic", () => {
    const ep = capture({
      kind: "conversation",
      userExcerpt: "metadata-bearing turn",
      // No session/turn context: capture itself leaves lineage unknown...
    });
    // ...but a current enrichment stored the turn reference as its
    // source_transcript_ref — the one recoverable metadata carrier.
    handle.sqlite
      .prepare(
        `INSERT INTO episode_enrichments (episode_id, space_id, version, source_transcript_ref)
         VALUES (?, ?, 1, 'conv:s9:turn:t3')`,
      )
      .run(ep, SPACE);
    const res = backfillEpisodeLineage(handle, SPACE);
    expect(res.updated).toBe(1);
    expect(episodeRow(ep).lineage_key).toBe("conv:s9:turn:t3");
    // No synthetic singleton keys anywhere in the table.
    const keys = handle.sqlite
      .prepare(`SELECT DISTINCT lineage_key FROM episodes WHERE lineage_key IS NOT NULL`)
      .all() as { lineage_key: string }[];
    for (const k of keys) {
      expect(k.lineage_key).toMatch(/^(conv|job|digest|corr|mill|sess):/);
    }
  });

  it("new captures always assign the §4.3 grain key when context is supplied", () => {
    const cases: { input: CaptureInput; key: string; basis?: string | null }[] = [
      {
        input: { kind: "conversation", sessionId: "s1", turnId: "t1" },
        key: "conv:s1:turn:t1",
      },
      {
        input: { kind: "agent_action", sessionId: "s1", turnId: "t2" },
        key: "conv:s1:turn:t2",
      },
      {
        input: { kind: "job_run", jobName: "dream", runId: 7 },
        key: "job:dream:7",
      },
      {
        input: { kind: "digest_sent", sourceLineageKey: "conv:s1:turn:t1" },
        key: "conv:s1:turn:t1",
      },
      {
        input: { kind: "digest_sent", digestRunId: "d5" },
        key: "digest:d5",
      },
      {
        input: { kind: "proactive_msg", sourceLineageKey: "job:dream:7" },
        key: "job:dream:7",
      },
      {
        input: { kind: "correction", sessionId: "s1", turnId: "t3" },
        key: "conv:s1:turn:t3",
        basis: "inherited",
      },
      {
        input: { kind: "milestone", milestoneId: "m2" },
        key: "mill:m2",
      },
      {
        input: { kind: "session", sessionId: "s7" },
        key: "sess:s7",
      },
    ];
    for (const c of cases) {
      const id = capture(c.input);
      const row = episodeRow(id);
      expect(row.lineage_key, JSON.stringify(c.input)).toBe(c.key);
      if (c.basis !== undefined) expect(row.lineage_basis).toBe(c.basis);
    }
  });
});

// ---------------------------------------------------------------------------
// T-C59: unknown lineage is ineligible to establish independence
// ---------------------------------------------------------------------------

describe("T-C59: unknown-lineage ineligible", () => {
  it("two NULL-lineage episodes on the same topic form ZERO known groups", () => {
    const a = capture({ kind: "conversation", userExcerpt: "I work at Samsonite" });
    const b = capture({ kind: "conversation", userExcerpt: "Samsonite shift talk" });
    // No session/turn context supplied → both lineage-unknown.
    expect(episodeRow(a).lineage_key).toBeNull();
    expect(episodeRow(b).lineage_key).toBeNull();
    // §4.5 threshold (≥2 distinct KNOWN groups) is NOT met.
    expect(knownLineageGroups([a, b]).size).toBe(0);
  });

  it("one known + one unknown is one group; two known distinct are two", () => {
    const known1 = capture({
      kind: "conversation",
      sessionId: "s1",
      turnId: "t1",
      userExcerpt: "I work at Samsonite",
    });
    const unknown = capture({
      kind: "conversation",
      userExcerpt: "Samsonite again",
    });
    expect(knownLineageGroups([known1, unknown]).size).toBe(1);
    const known2 = capture({
      kind: "conversation",
      sessionId: "s2",
      turnId: "t1",
      userExcerpt: "Samsonite confirmed again",
    });
    expect(knownLineageGroups([known1, known2]).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T-C65: correction lineage inherits the conversation
// ---------------------------------------------------------------------------

describe("T-C65: correction lineage inherits the conversation", () => {
  it("same-turn correction inherits; a second conversation is the second group", () => {
    const turn = capture({
      kind: "conversation",
      sessionId: "s1",
      turnId: "t1",
      userExcerpt: "I work at Samsonite",
    });
    expect(episodeRow(turn).lineage_key).toBe("conv:s1:turn:t1");

    const correction = capture({
      kind: "correction",
      sessionId: "s1",
      turnId: "t1",
      userExcerpt: "I meant I started last Monday",
      correctsEpisodeId: turn,
    });
    const crow = episodeRow(correction);
    expect(crow.lineage_key).toBe("conv:s1:turn:t1");
    expect(crow.lineage_basis).toBe("inherited");
    // One interaction = one lineage group → threshold NOT met.
    expect(knownLineageGroups([turn, correction]).size).toBe(1);

    const second = capture({
      kind: "conversation",
      sessionId: "s2",
      turnId: "t1",
      userExcerpt: "Samsonite mentioned in a separate conversation",
    });
    expect(knownLineageGroups([turn, second]).size).toBe(2);
  });

  it("a correction introducing a new subject earns corr:<id> and its own group", () => {
    const turn = capture({
      kind: "conversation",
      sessionId: "s1",
      turnId: "t1",
      userExcerpt: "I work at Samsonite",
    });
    const correction = capture({
      kind: "correction",
      sessionId: "s1",
      turnId: "t1",
      userExcerpt: "my sister also works at Samsonite",
      correctsEpisodeId: turn,
      correctionBasis: "new_subject",
      correctionId: 77,
    });
    const crow = episodeRow(correction);
    expect(crow.lineage_key).toBe("corr:77");
    expect(crow.lineage_basis).toBe("new_subject");
    expect(knownLineageGroups([turn, correction]).size).toBe(2);
  });
});
