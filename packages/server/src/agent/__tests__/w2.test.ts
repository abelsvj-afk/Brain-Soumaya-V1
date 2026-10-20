/**
 * W2 acceptance tests — Episodes + User Model (design §9).
 *
 * Canonical design: ~/workspace/w2-impl/w2-design-canonical.md
 * (Revision 5). Every test ID below is defined in §9 of that document;
 * describe blocks are named "T-XX: <name>" to match the design exactly.
 *
 * Modules under test:
 *   ../episodic.ts  — episodes, enrichments, forget contract
 *   ../userModel.ts — user model, knowledge check
 *
 * Conventions (mirroring packages/server/src/agent/__tests__/w1-temporal.test.ts):
 * - `createDb(":memory:")` per test via beforeEach; file-backed DBs only for
 *   the multi-connection race tests (T-F4, T-E9b).
 * - W2 tables are bootstrapped in-test via `bootstrapEpisodicTables()`
 *   (the w2Ddl() helper exported from episodic.ts) plus the user_model DDL
 *   from design §4.2 below. userModel.ts exports no DDL helper — the repo's
 *   schema patch (db/schemaSql.ts BOOTSTRAP_SQL) is the schema of record and
 *   owns this DDL when it lands; CREATE TABLE IF NOT EXISTS keeps this file
 *   safe to run before AND after that patch.
 * - The repo's createDb() already creates the pre-W2 base tables the W2
 *   modules assume exist (agent_logs, nodes, corrections, space_meta).
 * - LLM-dependent paths use the modules' injectable seams (EpisodeEnricher,
 *   LlmJudge) with scripted fakes. No cloud API is ever called.
 * - Tests marked SUPPLEMENTAL cover design-specified behavior (T-E15/T-E16
 *   from §3.3 prose, T-F1 from principle 7) that §9's ID list omits.
 *
 * TEST-GAP notes (see individual tests):
 * - T-M2: no migrated-DB fixture is available in this environment, so the
 *   equivalence assertion is tested fresh-vs-fresh (identical) plus a
 *   deliberately-different negative case. When the schema patch lands, run
 *   assertSchemaEquivalent() against a migrated database as well.
 * - T-E4 / T-F1: "no UPDATE/DELETE path exists" is partly a code-review gate;
 *   the tests assert API shape (no such export) plus functional immutability.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { createDb, type DbHandle } from "../../db/client.js";
import { EMBED_DIM, isVectorEnabled } from "../../db/vec.js";
import * as Episodic from "../episodic.js";
import {
  bootstrapEpisodicTables,
  captureEpisode,
  claimEnrichment,
  enrichEpisode,
  getEpisodes,
  getEpisodesForNode,
  episodeSearch,
  linkEpisodeToNodes,
  validateProvenance,
  validateEpisodeRefs,
  evidenceSafeFields,
  applyForgetRequest,
  spaceLocalDate,
  isSignificant,
  ValidationError as EpisodicValidationError,
  type EpisodeEnricher,
  type EpisodeEnricherResult,
} from "../episodic.js";
import {
  recordStated,
  updateUserModel,
  correctUserModel,
  getUserModel,
  getUserModelHistory,
  knowledgeCheck,
  composeUserModelBlock,
  sweepStaleEmotions,
  sweepWithdrawnEvidence,
  validateEvidenceRefs,
  assessIndependence,
  independentSourceCount,
  mapTopics,
  ValidationError as UserModelValidationError,
  type EvidenceInput,
  type LlmJudge,
} from "../userModel.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const SPACE = "w2-test-space";
const SPACE2 = "w2-test-space-2";

/**
 * user_model DDL transcribed from design §4.2 (the repo's schema patch owns
 * this DDL in db/schemaSql.ts BOOTSTRAP_SQL when it lands). Kept in the test
 * because userModel.ts exports no DDL helper.
 */
const USER_MODEL_DDL = `
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
`;

function bootstrapW2(sqlite: DbHandle["sqlite"]): void {
  bootstrapEpisodicTables(sqlite);
  sqlite.exec(USER_MODEL_DDL);
}

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
  bootstrapW2(handle.sqlite);
});

afterEach(() => {
  (handle.sqlite as unknown as { close(): void }).close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedNode(spaceId: string = SPACE, label = "test node"): number {
  // Mirrors the W1 test's insert shape (space_id, label, type, content) so
  // this also works against the repo's nodes table, which requires those
  // columns.
  const r = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`)
    .run(spaceId, label, "memory", `content of ${label}`);
  return Number(r.lastInsertRowid);
}

function seedEpisode(
  opts: {
    kind?: "conversation" | "correction" | "milestone";
    excerpt?: string;
    topicLabels?: string[];
    occurredAt?: string;
    correctsEpisodeId?: number;
    spaceId?: string;
  } = {},
): number {
  const res = captureEpisode(handle, opts.spaceId ?? SPACE, {
    kind: opts.kind ?? "conversation",
    userExcerpt: opts.excerpt ?? "test interaction",
    topicLabels: opts.topicLabels ?? [],
    occurredAt: opts.occurredAt,
    correctsEpisodeId: opts.correctsEpisodeId,
  });
  if (!res) throw new Error("captureEpisode returned null in seedEpisode");
  return res.episodeId;
}

function getEpisodeRow(id: number, h: DbHandle = handle): Record<string, unknown> {
  return h.sqlite
    .prepare(`SELECT * FROM episodes WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

/** Scripted enricher with a call counter (injectable EpisodeEnricher seam). */
function countingEnricher(
  impl: (input: Parameters<EpisodeEnricher>[0]) => Promise<EpisodeEnricherResult>,
): EpisodeEnricher & { calls: number } {
  const w = (async (input: Parameters<EpisodeEnricher>[0]) => {
    w.calls++;
    return impl(input);
  }) as EpisodeEnricher & { calls: number };
  w.calls = 0;
  return w;
}

/** A valid, fully-labeled enrichment result (all provenance labels present). */
const VALID_ENRICHMENT: EpisodeEnricherResult = {
  detail: "He described first-day nerves on the long bus ride",
  emotion: "anxious",
  emotionalWeight: -0.4,
  importance: 0.8,
  participants: [],
  place: null,
  fieldProvenance: {
    detail: "explicit",
    emotion: "explicit",
    emotional_weight: "explicit",
    importance: "inferred",
    participants: "not_reported",
    place: "not_reported",
  },
};

function unitVec(i: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  v[i % EMBED_DIM] = 1;
  return v;
}

/** Claim one episode and run the (fake) enricher on it. */
async function claimAndEnrich(
  h: DbHandle,
  spaceId: string,
  enricher: EpisodeEnricher,
  embed?: (text: string) => Float32Array | Promise<Float32Array>,
) {
  const claim = claimEnrichment(h, spaceId);
  expect(claim).not.toBeNull();
  return {
    claim: claim!,
    result: await enrichEpisode(h, spaceId, claim!.episodeId, claim!.fence, {
      enricher,
      embed,
    }),
  };
}

/**
 * Enrich a SPECIFIC episode. claimEnrichment() picks the most recent pending
 * episode (ties on occurred_at are unordered), so when several episodes are
 * pending the test drains the queue — non-target episodes get a harmless
 * template enrichment — until the target is claimed. Bounded to avoid an
 * infinite loop if the target is never claimable.
 */
async function enrichTarget(
  h: DbHandle,
  spaceId: string,
  targetId: number,
  enricher: EpisodeEnricher,
  embed?: (text: string) => Float32Array | Promise<Float32Array>,
) {
  for (let i = 0; i < 10; i++) {
    const claim = claimEnrichment(h, spaceId);
    expect(claim).not.toBeNull();
    const isTarget = claim!.episodeId === targetId;
    const res = await enrichEpisode(h, spaceId, claim!.episodeId, claim!.fence, {
      enricher: isTarget ? enricher : countingEnricher(async () => VALID_ENRICHMENT),
      embed: isTarget ? embed : undefined,
    });
    if (isTarget) return res;
  }
  throw new Error(`enrichTarget: episode ${targetId} was never claimed`);
}

function ensureSpaceMetaColumn(col: string, decl: string, h: DbHandle = handle): void {
  try {
    h.sqlite.exec(`ALTER TABLE space_meta ADD COLUMN ${col} ${decl}`);
  } catch {
    // Column already exists (repo schema patch) — ignore.
  }
}

function setDailyCap(n: number): void {
  ensureSpaceMetaColumn("episode_enrich_daily_cap", "INTEGER");
  handle.sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, episode_enrich_daily_cap) VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE SET episode_enrich_daily_cap = ?`,
    )
    .run(SPACE, n, n);
}

function setTimezone(tz: string): void {
  ensureSpaceMetaColumn("timezone", "TEXT");
  handle.sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, timezone) VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE SET timezone = ?`,
    )
    .run(SPACE, tz, tz);
}

function quotaClaimed(h: DbHandle = handle): number | null {
  const row = h.sqlite
    .prepare(`SELECT claimed FROM enrichment_quota WHERE space_id = ?`)
    .get(SPACE) as { claimed: number } | undefined;
  return row?.claimed ?? null;
}

/** Byte-identical snapshot of user_model (for INV-KC-1 assertions). */
function snapshotUserModel(h: DbHandle = handle, spaceId: string = SPACE): string {
  const rows = h.sqlite
    .prepare(
      `SELECT id, space_id, slot, content, confidence, evidence_strength,
              evidence_ids, topic_labels, valid_at, invalid_at,
              invalid_reason, replaced_by, origin, created_at
       FROM user_model WHERE space_id = ? ORDER BY id`,
    )
    .all(spaceId);
  return JSON.stringify(rows);
}

function createForgetRequest(opts: {
  targetEpisodeId?: number | null;
  targetNodeId?: number | null;
  targetQuery?: string | null;
}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO forget_requests
         (space_id, target_episode_id, target_node_id, target_query)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      SPACE,
      opts.targetEpisodeId ?? null,
      opts.targetNodeId ?? null,
      opts.targetQuery ?? null,
    );
  return Number(r.lastInsertRowid);
}

/**
 * Approve a forget request: scope is confirmed and target_query is nulled in
 * the SAME statement (design §3.7, B4 Rev 4 — the free-text query may itself
 * contain the sensitive content and is never retained after confirmation).
 */
function approveForgetRequest(
  id: number,
  scope: { episodes?: number[]; nodes?: number[]; topics?: string[] } = {},
): void {
  handle.sqlite
    .prepare(
      `UPDATE forget_requests
       SET status = 'approved', target_query = NULL,
           scope_episode_ids = ?, scope_node_ids = ?, scope_topics = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(scope.episodes ?? []),
      JSON.stringify(scope.nodes ?? []),
      JSON.stringify(scope.topics ?? []),
      id,
    );
}

function forgetRequestStatus(id: number): string {
  const row = handle.sqlite
    .prepare(`SELECT status FROM forget_requests WHERE id = ?`)
    .get(id) as { status: string };
  return row.status;
}

/** File-backed DB pair sharing one file (for multi-connection race tests). */
function fileDbPair(): {
  h1: DbHandle;
  h2: DbHandle;
  close: () => void;
} {
  const path = join(
    tmpdir(),
    `w2-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const h1 = createDb(path);
  const h2 = createDb(path);
  bootstrapW2(h1.sqlite); // CREATE TABLE IF NOT EXISTS — shared file
  const close = () => {
    (h1.sqlite as unknown as { close(): void }).close();
    (h2.sqlite as unknown as { close(): void }).close();
    try {
      unlinkSync(path);
    } catch {
      /* best-effort */
    }
  };
  return { h1, h2, close };
}

function expectEpisodicValidationError(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EpisodicValidationError);
    expect((err as EpisodicValidationError).reason).toBe(reason);
    return;
  }
  throw new Error(`expected EpisodicValidationError(${reason}) but nothing threw`);
}

function expectUserModelValidationError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(UserModelValidationError);
    expect((err as UserModelValidationError).code).toBe(code);
    return;
  }
  throw new Error(`expected UserModelValidationError(${code}) but nothing threw`);
}

// ---------------------------------------------------------------------------
// Episodes: T-E1 – T-E14 (+ supplemental T-E15/T-E16)
// ---------------------------------------------------------------------------

describe("T-E1: capture writes a valid row", () => {
  it("writes a template summary with no LLM and never throws", () => {
    const res = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "started the Samsonite job today",
      toolNames: ["memorySearch"],
      outcome: "job_update",
    });
    expect(res).not.toBeNull();
    expect(res!.tombstoned).toBe(false);

    const row = getEpisodeRow(res!.episodeId);
    expect(row.space_id).toBe(SPACE);
    expect(row.kind).toBe("conversation");
    // Template summary: deterministic, contains the excerpt verbatim.
    expect(row.summary).toBe(
      "Conversation: started the Samsonite job today — tools: memorySearch — job_update",
    );
    expect(row.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.enrichment_status).toBe("pending");
    expect(row.enrichment_attempts).toBe(0);
    expect(row.forgotten_at).toBeNull();
  });

  it("returns null instead of throwing on a DB error (hot path is best-effort)", () => {
    handle.sqlite.exec(`DROP TABLE episodes`);
    const res = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "this must not throw",
    });
    expect(res).toBeNull();
  });
});

describe("T-E2: significance filter", () => {
  it("isSignificant() implements the §5.2 five-criterion filter", () => {
    // 1. First-time signals
    expect(isSignificant({ newNodeCreated: true })).toBe(true);
    expect(isSignificant({ newTopics: ["employment"] })).toBe(true);
    expect(isSignificant({ newToolUsed: true })).toBe(true);
    // 2. Emotional spike: |w| > 0.5 (strict)
    expect(isSignificant({ emotionalWeight: 0.6 })).toBe(true);
    expect(isSignificant({ emotionalWeight: -0.9 })).toBe(true);
    expect(isSignificant({ emotionalWeight: 0.5 })).toBe(false);
    expect(isSignificant({ emotionalWeight: null })).toBe(false);
    // 3. Decision
    expect(isSignificant({ decisionMade: true })).toBe(true);
    // 4. Correction (strongest single predictor)
    expect(isSignificant({ correctionSignal: true })).toBe(true);
    // 5. Explicit life content
    expect(isSignificant({ explicitLifeContent: true })).toBe(true);
    // Heartbeat / small talk: nothing significant
    expect(isSignificant({})).toBe(false);
    expect(isSignificant({ newTopics: [] })).toBe(false);
  });
});

describe("T-E3: enrichment is idempotent", () => {
  it("running enrichEpisode twice yields one version-1 record", async () => {
    const E = seedEpisode({ excerpt: "first day at Samsonite" });
    const enricher = countingEnricher(async () => VALID_ENRICHMENT);

    const first = await claimAndEnrich(handle, SPACE, enricher);
    expect(first.result.status).toBe("completed");
    if (first.result.status !== "completed") throw new Error("unreachable");
    expect(first.result.version).toBe(1);

    // Second run on the completed episode is a no-op (T-E3 guard).
    const row = getEpisodeRow(E);
    const second = await enrichEpisode(
      handle,
      SPACE,
      E,
      row.enrichment_fence as string,
      { enricher },
    );
    expect(second.status).toBe("already_completed");
    expect(enricher.calls).toBe(1); // no second LLM call

    const count = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
      .get(E) as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("T-E4: capture immutability (INV-EP-1)", () => {
  it("exposes no API path that updates capture columns", () => {
    // API-shape enforcement: no exported function may update/edit/mutate or
    // delete episodes. (Source-level enforcement — the only UPDATE of
    // episodes.summary lives in applyForgetRequest() — is a code-review
    // gate; see T-E4b for the redaction exception.)
    const names = Object.keys(Episodic);
    const mutators = names.filter((n) =>
      /^(update|rewrite|mutate|edit|delete|remove|purge)/i.test(n),
    );
    expect(mutators).toEqual([]);
  });

  it("claim + enrich never modify capture columns", async () => {
    const E = seedEpisode({ excerpt: "immutable content here" });
    const before = handle.sqlite
      .prepare(
        `SELECT kind, summary, occurred_at, recorded_at, corrects_episode_id, created_at
         FROM episodes WHERE id = ?`,
      )
      .get(E);
    const { result } = await claimAndEnrich(
      handle,
      SPACE,
      countingEnricher(async () => VALID_ENRICHMENT),
    );
    expect(result.status).toBe("completed");
    const after = handle.sqlite
      .prepare(
        `SELECT kind, summary, occurred_at, recorded_at, corrects_episode_id, created_at
         FROM episodes WHERE id = ?`,
      )
      .get(E);
    expect(after).toEqual(before);
  });
});

describe("T-E4b: redaction exception (B1, Rev 3)", () => {
  it("approved forget request redacts via the canonical tombstone only", async () => {
    const E = seedEpisode({
      excerpt: "sensitive medical discussion about lupus",
      topicLabels: ["health"],
    });
    const occurredAt = getEpisodeRow(E).occurred_at as string;
    const recordedAt = getEpisodeRow(E).recorded_at as string;
    const { result } = await claimAndEnrich(
      handle,
      SPACE,
      countingEnricher(async () => VALID_ENRICHMENT),
      () => unitVec(0),
    );
    expect(result.status).toBe("completed");

    const req = createForgetRequest({ targetEpisodeId: E });
    approveForgetRequest(req, { episodes: [E], topics: ["health"] });
    const applied = applyForgetRequest(handle, req);
    expect(applied.episodesTombstoned).toEqual([E]);

    const row = getEpisodeRow(E);
    // The tombstone is a fixed string with the request id — never an edit.
    expect(row.summary).toBe(`[redacted per forget request #${req}]`);
    expect(row.forgotten_at).not.toBeNull();
    // Structural metadata is untouched (timeline keeps "something happened").
    expect(row.occurred_at).toBe(occurredAt);
    expect(row.recorded_at).toBe(recordedAt);
    expect(row.kind).toBe("conversation");
    // Interpretation + search indexes are gone (embedding NULL = no rows).
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
          .get(E) as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM vec_episodes WHERE episode_id = ?`)
          .get(BigInt(E)) as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episodes_fts WHERE rowid = ?`)
          .get(E) as { n: number }
      ).n,
    ).toBe(0);

    // Audit contains metadata but no content substrings.
    const frRow = handle.sqlite
      .prepare(`SELECT * FROM forget_requests WHERE id = ?`)
      .get(req);
    const haystack = JSON.stringify(frRow).toLowerCase();
    for (const word of ["sensitive", "medical", "lupus"]) {
      expect(haystack).not.toContain(word);
    }
    expect((frRow as Record<string, unknown>).target_query).toBeNull();
  });
});

describe("T-E4c: versioned linking (B1, Rev 3)", () => {
  it("linkEpisodeToNodes creates a new version, never mutates", async () => {
    const N1 = seedNode();
    const N2 = seedNode();
    const N3 = seedNode();
    const E = seedEpisode({});
    await claimAndEnrich(
      handle,
      SPACE,
      countingEnricher(async () => VALID_ENRICHMENT),
    );

    // Link to N1 → version 2 with merged source_node_ids.
    const v1Before = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE episode_id = ? AND version = 1`)
      .get(E) as Record<string, unknown>;
    const link1 = linkEpisodeToNodes(handle, SPACE, E, [N1]);
    expect(link1.version).toBe(2);
    const v2 = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE id = ?`)
      .get(link1.enrichmentId) as Record<string, unknown>;
    expect(JSON.parse(v2.source_node_ids as string)).toEqual([N1]);
    // Version 1 superseded, but its source_node_ids byte-identical.
    const v1After = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE episode_id = ? AND version = 1`)
      .get(E) as Record<string, unknown>;
    expect(v1After.superseded_by).toBe(link1.enrichmentId);
    expect(v1After.source_node_ids).toBe(v1Before.source_node_ids);
    // Interpretive fields carried over unchanged.
    expect(v2.detail).toBe(v1Before.detail);

    // Link again → version 3 merges [N1, N2, N3]... (N1 deduped).
    const v2SourcesBefore = v2.source_node_ids;
    const link2 = linkEpisodeToNodes(handle, SPACE, E, [N1, N2, N3]);
    expect(link2.version).toBe(3);
    const v3 = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE id = ?`)
      .get(link2.enrichmentId) as Record<string, unknown>;
    expect(JSON.parse(v3.source_node_ids as string)).toEqual([N1, N2, N3]);
    const v2After = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE id = ?`)
      .get(link1.enrichmentId) as Record<string, unknown>;
    expect(v2After.superseded_by).toBe(link2.enrichmentId);
    expect(v2After.source_node_ids).toBe(v2SourcesBefore);
  });

  it("linking with no prior enrichment creates a minimal version-1 record", () => {
    const N1 = seedNode();
    const E = seedEpisode({});
    const link = linkEpisodeToNodes(handle, SPACE, E, [N1]);
    expect(link.version).toBe(1);
    const v1 = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE id = ?`)
      .get(link.enrichmentId) as Record<string, unknown>;
    expect(JSON.parse(v1.source_node_ids as string)).toEqual([N1]);
    expect(v1.detail).toBeNull();
    // Minimal linking record: {} provenance is valid (no interpretive fields).
    expect(JSON.parse(v1.field_provenance as string)).toEqual({
      source_node_ids: "explicit",
    });
  });
});

describe("T-E5: episodeSearch", () => {
  it("finds similar episodes, ranks by canonical scorer, excludes unrelated", async () => {
    if (!isVectorEnabled(handle.sqlite)) {
      // Vector search unavailable: the search degrades to empty, never wrong.
      expect(episodeSearch(handle, SPACE, unitVec(0), 5)).toEqual([]);
      return;
    }
    // Seed + enrich one at a time: with several pending episodes the claim
    // order is nondeterministic on occurred_at ties, so each claim must be
    // unambiguous about which episode it enriches.
    const E1 = seedEpisode({ excerpt: "Samsonite first day", occurredAt: new Date().toISOString() });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT), () => unitVec(0));
    const E2 = seedEpisode({ excerpt: "grocery shopping", occurredAt: new Date().toISOString() });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT), () => unitVec(1));
    const oldDate = new Date(Date.now() - 60 * 86400000).toISOString();
    const E3 = seedEpisode({ excerpt: "Samsonite first day memories", occurredAt: oldDate });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT), () => unitVec(0));

    // Similar finds: query ~ E1's embedding.
    const hits = episodeSearch(handle, SPACE, unitVec(0), 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.episodeId).toBe(E1);
    // Canonical scorer: identical similarity, recent outranks 60-day-old.
    const e3Hit = hits.find((h) => h.episodeId === E3)!;
    expect(hits[0]!.score).toBeGreaterThan(e3Hit.score);
    // Unrelated (orthogonal embedding) does not surface in top-1.
    const top1 = episodeSearch(handle, SPACE, unitVec(0), 1);
    expect(top1).toHaveLength(1);
    expect(top1[0]!.episodeId).toBe(E1);
    // Orthogonal query finds E2 first.
    const ortho = episodeSearch(handle, SPACE, unitVec(1), 1);
    expect(ortho[0]!.episodeId).toBe(E2);
  });
});

describe("T-E6: episodes for node", () => {
  it("source_node_ids join answers 'what experiences led to this fact?'", async () => {
    const N = seedNode();
    const E = seedEpisode({ excerpt: "job hunt discussion" });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT));
    linkEpisodeToNodes(handle, SPACE, E, [N]);

    const found = getEpisodesForNode(handle, SPACE, N);
    expect(found.map((f) => f.episode.id)).toContain(E);
    const withEnr = found.find((f) => f.episode.id === E)!;
    expect(withEnr.enrichment).not.toBeNull();
    expect(JSON.parse(withEnr.enrichment!.source_node_ids)).toContain(N);

    // A node with no linked episodes returns nothing.
    expect(getEpisodesForNode(handle, SPACE, seedNode())).toEqual([]);
  });
});

describe("T-E7: space isolation", () => {
  it("episodes never cross spaces", async () => {
    const EA = seedEpisode({ excerpt: "space A episode", spaceId: SPACE });
    seedEpisode({ excerpt: "space B episode", spaceId: SPACE2 });

    const aEps = getEpisodes(handle, SPACE, {});
    expect(aEps.episodes.map((e) => e.episode.id)).toEqual([EA]);

    // Worker claims are space-scoped too.
    const claimA = claimEnrichment(handle, SPACE);
    expect(claimA!.episodeId).toBe(EA);
    const claimB = claimEnrichment(handle, SPACE2);
    expect(claimB).not.toBeNull();
    expect(claimB!.episodeId).not.toBe(EA);

    // Cursor pagination stays within the space.
    const page = getEpisodes(handle, SPACE, { limit: 1 });
    expect(page.episodes).toHaveLength(1);
    expect(page.nextCursor).toBeNull(); // only one episode in SPACE
  });
});

describe("T-E8: enrichment lifecycle (B6, B6 Rev 4)", () => {
  it("exactly three attempts, then failed_permanent — no fourth LLM call, quota refunded", async () => {
    const E = seedEpisode({ excerpt: "flaky enrichment target" });
    const enricher = countingEnricher(async () => {
      throw new Error("LLM down");
    });

    // Attempt 1 → fail → failed_retryable.
    let claim = claimEnrichment(handle, SPACE);
    expect(claim).not.toBeNull();
    let res = await enrichEpisode(handle, SPACE, E, claim!.fence, { enricher });
    expect(res.status).toBe("rejected");
    expect(getEpisodeRow(E).enrichment_status).toBe("failed_retryable");
    expect(getEpisodeRow(E).enrichment_attempts).toBe(1);

    // Attempt 2 → fail.
    claim = claimEnrichment(handle, SPACE);
    expect(claim).not.toBeNull();
    res = await enrichEpisode(handle, SPACE, E, claim!.fence, { enricher });
    expect(res.status).toBe("rejected");
    expect(getEpisodeRow(E).enrichment_attempts).toBe(2);

    // Attempt 3 → fail.
    claim = claimEnrichment(handle, SPACE);
    expect(claim).not.toBeNull();
    res = await enrichEpisode(handle, SPACE, E, claim!.fence, { enricher });
    expect(res.status).toBe("rejected");
    expect(getEpisodeRow(E).enrichment_attempts).toBe(3);

    // The claim that would be attempt 4 transitions to failed_permanent:
    // the predicate is `enrichment_attempts > 3` — no off-by-one.
    const claimedBefore = quotaClaimed();
    expect(claimedBefore).toBe(3);
    const claim4 = claimEnrichment(handle, SPACE);
    expect(claim4).toBeNull();
    const row = getEpisodeRow(E);
    expect(row.enrichment_status).toBe("failed_permanent");
    expect(row.enrichment_attempts).toBe(4);
    // No fourth LLM call was made...
    expect(enricher.calls).toBe(3);
    // ...so the quota reservation was refunded in the same transaction (Rev 5).
    expect(quotaClaimed()).toBe(claimedBefore);
    // A permanent failure is never retried automatically.
    expect(claimEnrichment(handle, SPACE)).toBeNull();
  });
});

describe("T-E8b: lease reclaim with fencing (B2, Rev 3)", () => {
  it("a crashed worker's claim is reclaimable; the stale fence cannot commit", async () => {
    const E = seedEpisode({ excerpt: "crash-me episode" });
    const stale = claimEnrichment(handle, SPACE);
    expect(stale).not.toBeNull();
    const F1 = stale!.fence;

    // Simulate the crash: lease expired, status still 'processing'.
    handle.sqlite
      .prepare(`UPDATE episodes SET enrichment_lease = ? WHERE id = ?`)
      .run("2020-01-01T00:00:00.000Z", E);

    // The ACTUAL claimEnrichment() query reclaims it: new fence, attempts+1.
    const reclaim = claimEnrichment(handle, SPACE);
    expect(reclaim).not.toBeNull();
    expect(reclaim!.episodeId).toBe(E);
    const F2 = reclaim!.fence;
    expect(F2).not.toBe(F1);
    expect(getEpisodeRow(E).enrichment_attempts).toBe(2);

    // The stale worker's commit predicate matches 0 rows (fence rotated).
    const commitCheck = handle.sqlite.prepare(
      `UPDATE episodes
       SET enrichment_status = 'completed', enriched_at = ?, enrichment_lease = NULL
       WHERE id = ? AND enrichment_fence = ? AND enrichment_status = 'processing'
         AND forgotten_at IS NULL`,
    );
    const r = commitCheck.run(new Date().toISOString(), E, F1);
    expect(r.changes).toBe(0);

    // End-to-end through the real worker path: stale fence is rejected...
    const enricher = countingEnricher(async () => VALID_ENRICHMENT);
    const staleRes = await enrichEpisode(handle, SPACE, E, F1, { enricher });
    expect(staleRes.status).toBe("rejected");
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
          .get(E) as { n: number }
      ).n,
    ).toBe(0);

    // ...while the reclaiming worker completes normally.
    const okRes = await enrichEpisode(handle, SPACE, E, F2, { enricher });
    expect(okRes.status).toBe("completed");
  });
});

describe("T-E9: daily cap (B6)", () => {
  it("cap=2 lets two episodes through; the third stays pending", () => {
    setDailyCap(2);
    const E1 = seedEpisode({});
    const E2 = seedEpisode({});
    const E3 = seedEpisode({});

    expect(claimEnrichment(handle, SPACE)).not.toBeNull();
    expect(claimEnrichment(handle, SPACE)).not.toBeNull();
    // Cap exhausted → null; nothing claimed.
    expect(claimEnrichment(handle, SPACE)).toBeNull();
    expect(quotaClaimed()).toBe(2);

    const pending = [E1, E2, E3].filter(
      (id) => getEpisodeRow(id).enrichment_status === "pending",
    );
    expect(pending).toHaveLength(1);
  });
});

describe("T-E9b: concurrent cap (B4, Rev 3)", () => {
  it("two interleaved workers cannot exceed the cap — the reservation is atomic", () => {
    const { h1, h2, close } = fileDbPair();
    try {
      // Bootstrap ran on h1's connection; h2 shares the file. Cap = 2.
      // (Same column-ensure step setDailyCap performs for the shared handle:
      // the cap column is a test-added tunable, not part of the base schema.)
      ensureSpaceMetaColumn("episode_enrich_daily_cap", "INTEGER", h1);
      h1.sqlite
        .prepare(
          `INSERT INTO space_meta (space_id, episode_enrich_daily_cap) VALUES (?, ?)
           ON CONFLICT (space_id) DO UPDATE SET episode_enrich_daily_cap = ?`,
        )
        .run(SPACE, 2, 2);
      const mkEp = (h: DbHandle) =>
        captureEpisode(h, SPACE, { kind: "conversation", userExcerpt: "cap race" })!.episodeId;
      mkEp(h1); mkEp(h1); mkEp(h1);

      const quotaDate = spaceLocalDate(h1, SPACE);
      const reserveSql = `INSERT INTO enrichment_quota (space_id, quota_date, claimed)
        VALUES (?, ?, 1)
        ON CONFLICT (space_id, quota_date) DO UPDATE
          SET claimed = claimed + 1
          WHERE claimed < ?
        RETURNING claimed`;

      // Worker A begins its claim transaction and reserves a unit (mid-flight).
      h1.sqlite.exec("BEGIN IMMEDIATE");
      const ra = h1.sqlite.prepare(reserveSql).get(SPACE, quotaDate, 2) as { claimed: number };
      expect(ra.claimed).toBe(1);

      // Worker B tries the ACTUAL reservation SQL concurrently → serialized.
      // (The old COUNT(*)<cap check-then-act would have let both through.)
      h2.sqlite.pragma("busy_timeout = 0");
      let busy = false;
      try {
        h2.sqlite.prepare(reserveSql).get(SPACE, quotaDate, 2);
      } catch (err) {
        busy = /BUSY/.test((err as Error & { code?: string }).code ?? "");
      }
      expect(busy).toBe(true);
      h1.sqlite.exec("ROLLBACK"); // worker A's claim aborts cleanly

      // Real claims through claimEnrichment(): exactly 2 succeed, third is null.
      expect(claimEnrichment(h1, SPACE)).not.toBeNull();
      expect(claimEnrichment(h1, SPACE)).not.toBeNull();
      expect(claimEnrichment(h1, SPACE)).toBeNull();
      expect(quotaClaimed(h1)).toBe(2); // never 3
      const pending = h1.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM episodes WHERE space_id = ? AND enrichment_status = 'pending'`)
        .get(SPACE) as { n: number };
      expect(pending.n).toBe(1);
    } finally {
      close();
    }
  });
});

describe("T-E9c: quota timezone boundary (B7, Rev 4)", () => {
  it("quota_date is the space-local date, never SQLite date('now')", async () => {
    setTimezone("America/New_York");
    setDailyCap(1);
    vi.useFakeTimers();
    try {
      // 2026-10-19 23:30 EDT == 2026-10-20 03:30 UTC.
      vi.setSystemTime(new Date("2026-10-20T03:30:00.000Z"));
      expect(spaceLocalDate(handle, SPACE)).toBe("2026-10-19");

      const E1 = seedEpisode({});
      const c1 = claimEnrichment(handle, SPACE);
      expect(c1).not.toBeNull();
      // Cap exhausted for the 19th.
      expect(claimEnrichment(handle, SPACE)).toBeNull();
      // The reservation used the space-local date as a bound parameter.
      const q1 = handle.sqlite
        .prepare(`SELECT quota_date, claimed FROM enrichment_quota WHERE space_id = ?`)
        .all(SPACE) as { quota_date: string; claimed: number }[];
      expect(q1).toHaveLength(1);
      expect(q1[0]!.quota_date).toBe("2026-10-19");
      expect(q1[0]!.claimed).toBe(1);

      // Complete E1 so it is not reclaimable after the clock moves.
      await enrichEpisode(handle, SPACE, E1, c1!.fence, {
        enricher: countingEnricher(async () => VALID_ENRICHMENT),
      });

      // 2026-10-20 00:30 EDT == 2026-10-20 04:30 UTC: new local day.
      vi.setSystemTime(new Date("2026-10-20T04:30:00.000Z"));
      expect(spaceLocalDate(handle, SPACE)).toBe("2026-10-20");
      seedEpisode({});
      const c2 = claimEnrichment(handle, SPACE);
      expect(c2).not.toBeNull(); // cap reset on the new quota_date
      const dates = handle.sqlite
        .prepare(`SELECT quota_date FROM enrichment_quota WHERE space_id = ? ORDER BY quota_date`)
        .all(SPACE) as { quota_date: string }[];
      expect(dates.map((d) => d.quota_date)).toEqual(["2026-10-19", "2026-10-20"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("T-E10: correction episodes", () => {
  it("appends with corrects_episode_id; the original is unmutated", () => {
    const E1 = seedEpisode({ excerpt: "bus is the 3" });
    const before = getEpisodeRow(E1).summary;
    const E2 = seedEpisode({
      kind: "correction",
      excerpt: "bus is the 8, not the 3",
      correctsEpisodeId: E1,
    });
    expect(getEpisodeRow(E2).corrects_episode_id).toBe(E1);
    expect(getEpisodeRow(E1).summary).toBe(before);
  });
});

describe("T-E11: forget propagation (B2)", () => {
  it("an approved request propagates through all stores in one transaction", async () => {
    const E = seedEpisode({ excerpt: "health discussion to forget", topicLabels: ["health"] });
    const E2 = seedEpisode({ excerpt: "unrelated episode", topicLabels: ["health"] });
    const N = seedNode();
    await enrichTarget(handle, SPACE, E, countingEnricher(async () => VALID_ENRICHMENT), () =>
      unitVec(2),
    );

    // User-model entries: A cites E as SOLE evidence; B cites E + E2.
    const A = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: [{ type: "episode", id: E }],
    });
    const B = recordStated(handle, SPACE, "belief", "believes his health routine needs rest", [
      { type: "episode", id: E },
      { type: "episode", id: E2 },
    ]);

    const req = createForgetRequest({ targetEpisodeId: E });
    approveForgetRequest(req, { episodes: [E], nodes: [N], topics: ["health"] });
    const applied = applyForgetRequest(handle, req);

    // Episode tombstoned (content removed, structural metadata kept).
    expect(applied.episodesTombstoned).toEqual([E]);
    const row = getEpisodeRow(E);
    expect(row.summary).toBe(`[redacted per forget request #${req}]`);
    expect(row.forgotten_at).not.toBeNull();
    // Enrichments (all versions), embeddings, and FTS entries deleted.
    expect(applied.enrichmentsDeleted).toBe(1);
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
          .get(E) as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM vec_episodes WHERE episode_id = ?`)
          .get(BigInt(E)) as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episodes_fts WHERE rowid = ?`)
          .get(E) as { n: number }
      ).n,
    ).toBe(0);
    // Sole-evidence entry invalidated (suspended, not deleted)...
    expect(applied.userModelInvalidated).toEqual([A.id]);
    const aRow = handle.sqlite
      .prepare(`SELECT invalid_reason FROM user_model WHERE id = ?`)
      .get(A.id) as { invalid_reason: string | null };
    expect(aRow.invalid_reason).toBe("evidence_withdrawn");
    // ...multi-evidence entry kept with the forgotten refs pruned.
    expect(applied.userModelPruned).toEqual([B.id]);
    const bRow = handle.sqlite
      .prepare(`SELECT evidence_ids, invalid_at FROM user_model WHERE id = ?`)
      .get(B.id) as { evidence_ids: string; invalid_at: string | null };
    expect(bRow.invalid_at).toBeNull();
    expect(JSON.parse(bRow.evidence_ids)).toEqual([{ type: "episode", id: E2 }]);
    // Nodes distilled from forgotten episodes are flagged, NOT auto-deleted.
    expect(applied.nodesFlaggedForReview).toEqual([N]);
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE id = ?`).get(N) as { n: number }).n,
    ).toBe(1);
    const review = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'forget_node_review'`)
      .get() as Record<string, unknown> | undefined;
    expect(review).toBeDefined();
    // Request row: applied, target_query already NULL (nulled at approval).
    expect(forgetRequestStatus(req)).toBe("applied");
    const fr = handle.sqlite
      .prepare(`SELECT applied_at, target_query FROM forget_requests WHERE id = ?`)
      .get(req) as { applied_at: string | null; target_query: string | null };
    expect(fr.applied_at).not.toBeNull();
    expect(fr.target_query).toBeNull();
  });

  it("a fault mid-apply rolls back the entire propagation", async () => {
    const E3 = seedEpisode({ excerpt: "rollback target", topicLabels: ["health"] });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT));
    const summaryBefore = getEpisodeRow(E3).summary as string;

    const req = createForgetRequest({ targetEpisodeId: E3 });
    approveForgetRequest(req, { episodes: [E3], topics: ["health"] });

    // Inject a fault: abort the tombstone UPDATE for this episode.
    handle.sqlite.exec(`CREATE TRIGGER w2_test_fault BEFORE UPDATE ON episodes
      WHEN NEW.id = ${E3} BEGIN SELECT RAISE(ABORT, 'injected fault'); END;`);
    try {
      expect(() => applyForgetRequest(handle, req)).toThrow(/injected fault/);
      // Everything rolled back: summary, enrichment, request status.
      expect(getEpisodeRow(E3).summary).toBe(summaryBefore);
      expect(
        (
          handle.sqlite
            .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
            .get(E3) as { n: number }
        ).n,
      ).toBe(1);
      expect(forgetRequestStatus(req)).toBe("approved");
    } finally {
      handle.sqlite.exec(`DROP TRIGGER w2_test_fault`);
    }
  });
});

describe("T-E12: provenance quarantine (B5, INV-ENRICH-1)", () => {
  it("generated-labeled enrichment content cannot become user-model evidence", async () => {
    const E = seedEpisode({ excerpt: "quiet morning" });
    const generated: EpisodeEnricherResult = {
      detail: "A quiet morning unfolded with soft light.",
      emotion: null,
      emotionalWeight: null,
      importance: 0.5,
      participants: [],
      place: null,
      fieldProvenance: {
        detail: "generated",
        emotion: "not_reported",
        emotional_weight: "not_reported",
        participants: "not_reported",
        place: "not_reported",
      },
    };
    const { result } = await claimAndEnrich(
      handle,
      SPACE,
      countingEnricher(async () => generated),
    );
    expect(result.status).toBe("completed");

    const enr = handle.sqlite
      .prepare(
        `SELECT id FROM episode_enrichments WHERE episode_id = ? AND superseded_by IS NULL`,
      )
      .get(E) as { id: number };

    // The write is rejected: generated content is quarantined from evidence.
    expectUserModelValidationError(
      () =>
        recordStated(handle, SPACE, "belief", "believes mornings are quiet", [
          { type: "enrichment", id: enr.id },
        ]),
      "quarantine_generated",
    );
  });
});

describe("T-E13: not_reported is valid (B5, INV-ENRICH-2)", () => {
  it("terse interaction → NULL fields with not_reported labels, nothing invented", async () => {
    const E = seedEpisode({ excerpt: "ok" });
    // The template fallback is conservative by construction: it cannot know
    // texture, feeling, or place, so every interpretive field is NULL with an
    // explicit 'not_reported' label — a complete, valid state.
    const { result } = await claimAndEnrich(handle, SPACE, async () => ({
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
    }));
    expect(result.status).toBe("completed");

    const enr = handle.sqlite
      .prepare(`SELECT * FROM episode_enrichments WHERE episode_id = ? AND superseded_by IS NULL`)
      .get(E) as Record<string, unknown>;
    expect(enr.detail).toBeNull();
    expect(enr.emotion).toBeNull();
    const fp = JSON.parse(enr.field_provenance as string) as Record<string, string>;
    expect(fp.detail).toBe("not_reported");
    expect(fp.emotion).toBe("not_reported");
  });
});

describe("T-E14: grounding (B5, INV-ENRICH-3)", () => {
  // NOTE: enrichEpisode applies the direct_quote substring check only when
  // the caller supplies sourceText (the wiring layer's verbatim excerpt).
  // Without sourceText the label is trusted — the grounding guarantee lives
  // in the wiring contract, exercised below.
  it("rejects ungrounded direct_quote; accepts grounded direct_quote", async () => {
    const E = seedEpisode({ excerpt: "I started the Samsonite job today" });
    const claim = claimEnrichment(handle, SPACE);
    expect(claim).not.toBeNull();
    const res = await enrichEpisode(handle, SPACE, E, claim!.fence, {
      enricher: countingEnricher(async () => ({
        detail: "started the Samsonite job",
        emotion: null,
        emotionalWeight: null,
        importance: 0.5,
        participants: [],
        place: null,
        fieldProvenance: {
          detail: "direct_quote",
          emotion: "not_reported",
          emotional_weight: "not_reported",
          participants: "not_reported",
          place: "not_reported",
        },
      })),
      sourceText: "I started the Samsonite job today",
    });
    expect(res.status).toBe("completed");

    // And the adversarial twin with the same sourceText is rejected.
    const E2 = seedEpisode({ excerpt: "I started the Samsonite job today" });
    const claim2 = claimEnrichment(handle, SPACE);
    const res2 = await enrichEpisode(handle, SPACE, E2, claim2!.fence, {
      enricher: countingEnricher(async () => ({
        detail: "He wept tears of joy at the parade",
        emotion: null,
        emotionalWeight: null,
        importance: 0.5,
        participants: [],
        place: null,
        fieldProvenance: {
          detail: "direct_quote",
          emotion: "not_reported",
          emotional_weight: "not_reported",
          participants: "not_reported",
          place: "not_reported",
        },
      })),
      sourceText: "I started the Samsonite job today",
    });
    expect(res2.status).toBe("rejected");
    if (res2.status === "rejected") expect(res2.reason).toBe("validation");
  });
});

// SUPPLEMENTAL (design §3.3 prose; not in the §9 ID list but specified there).
describe("T-E15 (supplemental): provenance coverage validation (INV-ENRICH-4)", () => {
  it("rejects a populated field with no label, and a NULL field with no not_reported label", () => {
    // Populated detail, no label at all.
    expectEpisodicValidationError(
      () => validateProvenance({ detail: "something", field_provenance: {} }),
      "missing_provenance",
    );
    // Detail labeled, but emotion is NULL without a 'not_reported' label:
    // NULL without a label means "not yet classified" → rejected.
    expectEpisodicValidationError(
      () =>
        validateProvenance({
          detail: "something",
          emotion: null,
          field_provenance: { detail: "explicit" },
        }),
      "missing_provenance",
    );
    // Unknown field name in the map.
    expectEpisodicValidationError(
      () =>
        validateProvenance({
          detail: "something",
          field_provenance: { detail: "explicit", frobnicate: "explicit" } as never,
        }),
      "unknown_provenance_field",
    );
    // Label outside the field's allowed set (detail may not be 'inferred').
    expectEpisodicValidationError(
      () =>
        validateProvenance({
          detail: "something",
          field_provenance: { detail: "inferred" } as never,
        }),
      "invalid_provenance_label",
    );
  });
});

describe("T-E16 (supplemental): fail-closed evidence selector", () => {
  it("excludes fields when provenance is malformed and logs provenance_malformed", () => {
    const draft = {
      id: 4242,
      detail: "some detail",
      field_provenance: "this is not json{",
    };
    const safe = evidenceSafeFields(draft, { handle, spaceId: SPACE });
    expect(safe).toEqual([]); // fail-closed: nothing is "assumed fine"
    const log = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'provenance_malformed'`)
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();

    // Well-formed provenance selects the evidence-eligible fields only.
    const ok = evidenceSafeFields({
      detail: "verbatim words",
      emotion: "anxious",
      field_provenance: {
        detail: "direct_quote",
        emotion: "generated", // quarantined
      },
    });
    expect(ok).toContain("detail");
    expect(ok).not.toContain("emotion");
  });
});

// ---------------------------------------------------------------------------
// Forget: T-F1 (supplemental), T-F2 – T-F6
// ---------------------------------------------------------------------------

// SUPPLEMENTAL (principle 7 / INV-DEL-1; §9's list starts at T-F2).
describe("T-F1 (supplemental): no model-driven deletion", () => {
  it("no exported function deletes W2 rows; lifecycle paths never remove records", async () => {
    const names = Object.keys(Episodic);
    const deleters = names.filter((n) => /^(delete|remove|purge|drop)/i.test(n));
    expect(deleters).toEqual([]);

    // Functional: run every mutating path except applyForgetRequest and
    // assert nothing was deleted.
    const N = seedNode();
    const E = seedEpisode({});
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT));
    linkEpisodeToNodes(handle, SPACE, E, [N]);
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM episodes`).get() as { n: number }).n,
    ).toBe(1);
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments`).get() as { n: number }).n,
    ).toBe(2); // v1 + v2 (link)
  });
});

describe("T-F2: capture blocking (B5, Rev 3)", () => {
  it("approved requests block capture; rejected requests do not", () => {
    // Approved request (propagation not yet run — status='approved' blocks).
    const req = createForgetRequest({ targetQuery: "forget the job stuff" });
    approveForgetRequest(req, { topics: ["employment"] });
    expect(forgetRequestStatus(req)).toBe("approved");

    const blocked = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "talking about the Samsonite job",
      topicLabels: ["employment"],
    });
    expect(blocked).not.toBeNull();
    expect(blocked!.tombstoned).toBe(true);
    const row = getEpisodeRow(blocked!.episodeId);
    expect(row.summary).toBe(`[redacted per forget request #${req}]`);
    expect(row.forgotten_at).not.toBeNull();
    expect(row.summary as string).not.toContain("Samsonite");
    const log = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'forget_capture_blocked'`)
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();

    // A rejected request does not block capture.
    const req2 = createForgetRequest({ targetQuery: "forget the fee stuff" });
    handle.sqlite
      .prepare(`UPDATE forget_requests SET status = 'rejected', target_query = NULL WHERE id = ?`)
      .run(req2);
    const open = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "talking about the CNA fee",
      topicLabels: ["finance"],
    });
    expect(open).not.toBeNull();
    expect(open!.tombstoned).toBe(false);
    expect(getEpisodeRow(open!.episodeId).summary as string).toContain("CNA fee");
  });
});

describe("T-F3: scope topics (B4, Rev 4)", () => {
  it("topic overlap tombstones; non-overlap passes; weak overlap tombstones + logs ambiguity", () => {
    const req = createForgetRequest({ targetQuery: "forget work and money" });
    approveForgetRequest(req, { topics: ["employment", "finance"] });

    // Strong overlap (2 shared labels) → tombstone, no ambiguity log.
    const strong = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "Samsonite job and paycheck talk",
      topicLabels: ["employment", "finance"],
    });
    expect(strong!.tombstoned).toBe(true);

    // No overlap → normal capture.
    const clean = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "doctor visit went fine",
      topicLabels: ["health"],
    });
    expect(clean!.tombstoned).toBe(false);
    expect(getEpisodeRow(clean!.episodeId).summary as string).toContain("doctor visit");

    // Weak overlap (exactly one shared label) → tombstone ANYWAY (bias toward
    // over-redaction) + forget_ambiguity logged for user review.
    const weak = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "job talk",
      topicLabels: ["employment"],
    });
    expect(weak!.tombstoned).toBe(true);
    const amb = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'forget_ambiguity'`)
      .all() as Record<string, unknown>[];
    expect(amb.length).toBe(1);
  });
});

describe("T-F4: forget/enrichment race, both orderings (B1, Rev 4)", () => {
  // The ACTUAL claimEnrichment() SQL, the ACTUAL worker commit predicate,
  // and the ACTUAL applyForgetRequest() transaction. No mocks of outcomes.
  const COMMIT_PREDICATE = `UPDATE episodes
    SET enrichment_status = 'completed', enriched_at = ?, enrichment_lease = NULL
    WHERE id = ? AND enrichment_fence = ? AND enrichment_status = 'processing'
      AND forgotten_at IS NULL`;

  function seedFileEpisode(h: DbHandle, excerpt: string): number {
    return captureEpisode(h, SPACE, {
      kind: "conversation",
      userExcerpt: excerpt,
      topicLabels: ["health"],
    })!.episodeId;
  }

  it("ordering A: forget completes, then the worker commits → 0 rows, nothing survives", async () => {
    const { h1, close } = fileDbPair();
    try {
      const E = seedFileEpisode(h1, "race target A");
      const req = (() => {
        const r = h1.sqlite
          .prepare(
            `INSERT INTO forget_requests (space_id, target_episode_id) VALUES (?, ?)`,
          )
          .run(SPACE, E);
        return Number(r.lastInsertRowid);
      })();
      h1.sqlite
        .prepare(
          `UPDATE forget_requests SET status = 'approved', target_query = NULL,
                  scope_episode_ids = ?, scope_topics = ? WHERE id = ?`,
        )
        .run(JSON.stringify([E]), JSON.stringify(["health"]), req);

      // Worker claims E (fence F1), then goes to do its (slow) LLM work.
      const claim = claimEnrichment(h1, SPACE);
      expect(claim).not.toBeNull();
      const F1 = claim!.fence;

      // Forget runs to completion: fence rotated, forgotten_at set.
      applyForgetRequest(h1, req);
      expect(getEpisodeRow(E, h1).summary).toBe(`[redacted per forget request #${req}]`);

      // Worker's commit with the stale fence: the REAL predicate matches 0 rows.
      const r = h1.sqlite.prepare(COMMIT_PREDICATE).run(new Date().toISOString(), E, F1);
      expect(r.changes).toBe(0);

      // End-to-end through the real worker path: pre-flight sees forgotten_at.
      const res = await enrichEpisode(h1, SPACE, E, F1, {
        enricher: countingEnricher(async () => VALID_ENRICHMENT),
      });
      expect(res.status).toBe("rejected");

      // Nothing searchable was recreated.
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`).get(E) as { n: number }).n,
      ).toBe(0);
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM vec_episodes WHERE episode_id = ?`).get(BigInt(E)) as { n: number }).n,
      ).toBe(0);
    } finally {
      close();
    }
  });

  it("ordering B1: worker commits first, then forget deletes the enrichment", async () => {
    const { h1, close } = fileDbPair();
    try {
      const E = seedFileEpisode(h1, "race target B1");
      const req = (() => {
        const r = h1.sqlite
          .prepare(`INSERT INTO forget_requests (space_id, target_episode_id) VALUES (?, ?)`)
          .run(SPACE, E);
        return Number(r.lastInsertRowid);
      })();
      h1.sqlite
        .prepare(
          `UPDATE forget_requests SET status = 'approved', target_query = NULL,
                  scope_episode_ids = ?, scope_topics = ? WHERE id = ?`,
        )
        .run(JSON.stringify([E]), JSON.stringify(["health"]), req);

      // Worker completes its enrichment BEFORE the forget runs.
      const claim = claimEnrichment(h1, SPACE);
      const res = await enrichEpisode(h1, SPACE, E, claim!.fence, {
        enricher: countingEnricher(async () => VALID_ENRICHMENT),
        embed: () => unitVec(0),
      });
      expect(res.status).toBe("completed");
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`).get(E) as { n: number }).n,
      ).toBe(1);

      // Forget proceeds: the just-written enrichment is DELETED in the same
      // transaction. No enrichment of forgotten content survives.
      applyForgetRequest(h1, req);
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`).get(E) as { n: number }).n,
      ).toBe(0);
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM vec_episodes WHERE episode_id = ?`).get(BigInt(E)) as { n: number }).n,
      ).toBe(0);
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM episodes_fts WHERE rowid = ?`).get(E) as { n: number }).n,
      ).toBe(0);
      expect(getEpisodeRow(E, h1).summary).toBe(`[redacted per forget request #${req}]`);
    } finally {
      close();
    }
  });

  it("ordering B2: forget holds the lock; the blocked worker commit then affects 0 rows", async () => {
    const { h1, h2, close } = fileDbPair();
    try {
      const E = seedFileEpisode(h1, "race target B2");
      const req = (() => {
        const r = h1.sqlite
          .prepare(`INSERT INTO forget_requests (space_id, target_episode_id) VALUES (?, ?)`)
          .run(SPACE, E);
        return Number(r.lastInsertRowid);
      })();
      h1.sqlite
        .prepare(
          `UPDATE forget_requests SET status = 'approved', target_query = NULL,
                  scope_episode_ids = ?, scope_topics = ? WHERE id = ?`,
        )
        .run(JSON.stringify([E]), JSON.stringify(["health"]), req);

      // Worker claims E (fence F1).
      const claim = claimEnrichment(h1, SPACE);
      const F1 = claim!.fence;

      // The forget transaction starts first and holds the write lock
      // (SQLite serializes the two BEGIN IMMEDIATE transactions).
      h2.sqlite.exec("BEGIN IMMEDIATE");
      h2.sqlite
        .prepare(
          `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
           VALUES (?, 'soumaya', 'test_lock_hold', 'holding the write lock', '{}', 'ok')`,
        )
        .run(SPACE);

      // The worker's commit arrives while the lock is held → it would block.
      h1.sqlite.pragma("busy_timeout = 30");
      let blocked = false;
      try {
        h1.sqlite.prepare(COMMIT_PREDICATE).run(new Date().toISOString(), E, F1);
      } catch (err) {
        blocked = /BUSY/.test((err as Error & { code?: string }).code ?? "");
      }
      expect(blocked).toBe(true);

      // Forget commits (nested in the held transaction via savepoint), then
      // the worker retries its commit → 0 rows (fence rotated + forgotten).
      applyForgetRequest(h2, req);
      h2.sqlite.exec("COMMIT");
      h1.sqlite.pragma("busy_timeout = 5000");
      const r2 = h1.sqlite.prepare(COMMIT_PREDICATE).run(new Date().toISOString(), E, F1);
      expect(r2.changes).toBe(0);

      const res = await enrichEpisode(h1, SPACE, E, F1, {
        enricher: countingEnricher(async () => VALID_ENRICHMENT),
      });
      expect(res.status).toBe("rejected");
      expect(
        (h1.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`).get(E) as { n: number }).n,
      ).toBe(0);
      expect(getEpisodeRow(E, h1).summary).toBe(`[redacted per forget request #${req}]`);
    } finally {
      close();
    }
  });
});

describe("T-F5: content-free audit (B4, Rev 4)", () => {
  it("no substring of sensitive content survives in forget_requests, agent_logs, or any audit field", () => {
    const sensitive = "my private medical diagnosis is lupus";
    const E = seedEpisode({ excerpt: sensitive, topicLabels: ["health"] });

    // The request's free-text query itself contains the sensitive content.
    const req = createForgetRequest({
      targetQuery: "forget everything about my medical diagnosis lupus",
    });

    // Approval confirms scope and nulls target_query in the same transaction.
    const tx = handle.sqlite.transaction(() => {
      handle.sqlite
        .prepare(
          `UPDATE forget_requests SET status = 'approved', target_query = NULL,
                  scope_episode_ids = ?, scope_topics = ? WHERE id = ?`,
        )
        .run(JSON.stringify([E]), JSON.stringify(["health"]), req);
      const tq = handle.sqlite
        .prepare(`SELECT target_query FROM forget_requests WHERE id = ?`)
        .get(req) as { target_query: string | null };
      expect(tq.target_query).toBeNull();
    });
    tx();
    expect(forgetRequestStatus(req)).toBe("approved");

    applyForgetRequest(handle, req);

    // Sweep every retained audit surface for content substrings.
    const frRow = handle.sqlite
      .prepare(`SELECT * FROM forget_requests WHERE id = ?`)
      .get(req);
    const logs = handle.sqlite
      .prepare(`SELECT action, description, targets, result FROM agent_logs`)
      .all() as Record<string, unknown>[];
    const episodes = handle.sqlite.prepare(`SELECT * FROM episodes`).all();
    const haystack = JSON.stringify({ frRow, logs, episodes }).toLowerCase();
    for (const word of ["private", "medical", "diagnosis", "lupus"]) {
      expect(haystack).not.toContain(word);
    }
    // The audit proves THAT a forget occurred: request id, timestamps,
    // scope ids (integers), scope topics (controlled labels) — nothing else.
    const fr = frRow as Record<string, unknown>;
    expect(JSON.parse(fr.scope_episode_ids as string)).toEqual([E]);
    expect(JSON.parse(fr.scope_topics as string)).toEqual(["health"]);
    expect(fr.status).toBe("applied");
    expect(fr.applied_at).not.toBeNull();
    const applied = logs.find((l) => l.action === "forget_applied") as
      | Record<string, unknown>
      | undefined;
    expect(applied).toBeDefined();
  });
});

describe("T-F6: tombstone enforcement (B9, Rev 4)", () => {
  it("capture path and forget path write the identical canonical tombstone; tombstones are excluded everywhere", async () => {
    // Capture path: approved scope blocks capture.
    const req1 = createForgetRequest({ targetQuery: "forget work" });
    approveForgetRequest(req1, { topics: ["employment"] });
    const cap = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "Samsonite job talk",
      topicLabels: ["employment"],
    });
    const E1 = cap!.episodeId;
    expect(getEpisodeRow(E1).summary).toBe(`[redacted per forget request #${req1}]`);
    expect(getEpisodeRow(E1).forgotten_at).not.toBeNull();

    // Forget path: an existing episode is redacted by applyForgetRequest.
    // (topicLabels avoid req1's still-approved employment scope, so E2 is
    // captured normally — req1 would otherwise tombstone it at capture.)
    const E2 = seedEpisode({ excerpt: "normal episode about the job", topicLabels: ["health"] });
    await claimAndEnrich(handle, SPACE, countingEnricher(async () => VALID_ENRICHMENT), () =>
      unitVec(3),
    );
    const req2 = createForgetRequest({ targetEpisodeId: E2 });
    approveForgetRequest(req2, { episodes: [E2], topics: ["employment"] });
    applyForgetRequest(handle, req2);
    // Same format, same N semantics (the authorizing request's id).
    expect(getEpisodeRow(E2).summary).toBe(`[redacted per forget request #${req2}]`);

    // Exclusion: the tombstoned episodes are not claimable...
    expect(claimEnrichment(handle, SPACE)).toBeNull();
    // ...have no FTS rows...
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM episodes_fts WHERE rowid IN (?, ?)`)
          .get(E1, E2) as { n: number }
      ).n,
    ).toBe(0);
    // ...have no vector rows...
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM vec_episodes WHERE episode_id IN (?, ?)`)
          .get(BigInt(E1), BigInt(E2)) as { n: number }
      ).n,
    ).toBe(0);
    // ...and do not appear in episodeSearch results (real search, not a stub).
    if (isVectorEnabled(handle.sqlite)) {
      const hits = episodeSearch(handle, SPACE, unitVec(3), 10);
      expect(hits.map((h) => h.episodeId)).not.toContain(E1);
      expect(hits.map((h) => h.episodeId)).not.toContain(E2);
    }
  });
});

// ---------------------------------------------------------------------------
// User model: T-U1 – T-U18
// ---------------------------------------------------------------------------

describe("T-U1: recordStated writes at 0.95", () => {
  it("writes a stated entry with evidence; getUserModel returns it", () => {
    const E = seedEpisode({ excerpt: "I work at Samsonite" });
    const res = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    expect(res.entry.confidence).toBe(0.95);
    expect(res.entry.origin).toBe("stated");
    expect(res.entry.topicLabels).toContain("employment");
    expect(res.invalidatedIds).toEqual([]);

    const entries = getUserModel(handle, SPACE);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toBe("works at Samsonite");
    expect(entries[0]!.evidence).toHaveLength(1);
    expect(entries[0]!.evidence[0]!.status).toBe("ok");
  });
});

describe("T-U2: stated beats inferred (INV-ST-1)", () => {
  it("a stated entry invalidates the contradicted inferred entry", () => {
    const E = seedEpisode({});
    const inferred = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the fee is $85",
      confidence: 0.5,
      evidence: [{ type: "episode", id: E }],
    });

    const res = recordStated(handle, SPACE, "belief", "believes the fee is $90", [
      { type: "episode", id: E },
    ]);
    expect(res.invalidatedIds).toEqual([inferred.id]);

    const oldRow = handle.sqlite
      .prepare(`SELECT invalid_at, invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(inferred.id) as {
      invalid_at: string | null;
      invalid_reason: string | null;
      replaced_by: number | null;
    };
    expect(oldRow.invalid_at).not.toBeNull();
    expect(oldRow.invalid_reason).toBe("superseded");
    expect(oldRow.replaced_by).toBe(res.id);

    // History shows both: the superseded entry and its replacement.
    const history = getUserModelHistory(handle, SPACE, res.id);
    expect(history.map((e) => e.id)).toEqual([inferred.id, res.id]);
    expect(history[0]!.invalidAt).not.toBeNull();
    expect(history[1]!.invalidAt).toBeNull();
  });
});

describe("T-U3: evidence is required (INV-EV-1)", () => {
  it("updateUserModel rejects empty evidence_ids", () => {
    expectUserModelValidationError(
      () =>
        updateUserModel(handle, SPACE, "consolidated", {
          slot: "belief",
          content: "believes the fee is $85",
          confidence: 0.5,
          evidence: [],
        }),
      "empty_evidence",
    );
  });
});

describe("T-U4: origin ceiling", () => {
  it("updateUserModel rejects inferred confidence above 0.69", () => {
    const E = seedEpisode({});
    expectUserModelValidationError(
      () =>
        updateUserModel(handle, SPACE, "inferred", {
          slot: "belief",
          content: "believes the fee is $85",
          confidence: 0.8,
          evidence: [{ type: "episode", id: E }],
        }),
      "origin_ceiling",
    );
    // 0.69 itself is allowed.
    const ok = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the fee is $85",
      confidence: 0.69,
      evidence: [{ type: "episode", id: E }],
    });
    expect(ok.entry.confidence).toBe(0.69);
  });
});

describe("T-U5: independence (INV-IND-1)", () => {
  it("two mentions in the same conversation are one observation", () => {
    const E = seedEpisode({});
    const a = { ref: { type: "episode" as const, id: E }, episodeId: E };
    const b = { ref: { type: "episode" as const, id: E }, episodeId: E };
    expect(assessIndependence(a, b)).toBe(false);
    expect(independentSourceCount([a, b])).toBe(1);

    // A node distilled from an episode is not independent of that episode.
    const N = seedNode();
    const nodeMeta = {
      ref: { type: "node" as const, id: N },
      derivedFromEpisodeId: E,
    };
    const epMeta = { ref: { type: "episode" as const, id: E }, episodeId: E };
    expect(assessIndependence(nodeMeta, epMeta)).toBe(false);

    // Different episodes are independent observations.
    const E2 = seedEpisode({});
    const c = { ref: { type: "episode" as const, id: E2 }, episodeId: E2 };
    expect(assessIndependence(a, c)).toBe(true);
    expect(independentSourceCount([a, b, c])).toBe(2);
  });
});

describe("T-U6: correction semantics (§4.6)", () => {
  it("false_belief: invalidates with corrected_false_belief, no replacement", () => {
    const E = seedEpisode({});
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", [
      { type: "episode", id: E },
    ]);
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "the fee is not $85",
      type: "false_belief",
    });
    expect(res.status).toBe("applied");
    expect(res.entryId).toBe(entry.id);
    expect(res.newEntryId).toBeNull();
    const row = handle.sqlite
      .prepare(`SELECT invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(entry.id) as { invalid_reason: string; replaced_by: number | null };
    expect(row.invalid_reason).toBe("corrected_false_belief");
    expect(row.replaced_by).toBeNull();
    // No new row was written.
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }).n,
    ).toBe(1);
  });

  it("factual_update: supersedes and writes the replacement with a replaced_by link", () => {
    const E = seedEpisode({});
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", [
      { type: "episode", id: E },
    ]);
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "the $85 fee is actually $90",
      type: "factual_update",
      newContent: "believes the fee is $90",
      evidence: [{ type: "episode", id: E }],
    });
    expect(res.status).toBe("applied");
    expect(res.newEntryId).not.toBeNull();
    const row = handle.sqlite
      .prepare(`SELECT invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(entry.id) as { invalid_reason: string; replaced_by: number | null };
    expect(row.invalid_reason).toBe("superseded");
    expect(row.replaced_by).toBe(res.newEntryId);
    const fresh = getUserModel(handle, SPACE);
    expect(fresh.map((e) => e.content)).toContain("believes the fee is $90");
  });

  it("preference_override: user_override, no replacement, no inferred constraint", () => {
    const E = seedEpisode({});
    const entry = recordStated(handle, SPACE, "belief", "believes he will always be broke", [
      { type: "episode", id: E },
    ]);
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "stop assuming I'm always broke",
      type: "preference_override",
    });
    expect(res.status).toBe("applied");
    const row = handle.sqlite
      .prepare(`SELECT invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(entry.id) as { invalid_reason: string; replaced_by: number | null };
    expect(row.invalid_reason).toBe("user_override");
    expect(row.replaced_by).toBeNull();
    // The correction is evidence that THIS entry was wrong — not evidence of
    // a general rule. No constraint entry may be inferred from it.
    expect(
      (
        handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE slot = 'constraint'`)
          .get() as { n: number }
      ).n,
    ).toBe(0);
  });
});

describe("T-U7: no inferred constraint from a correction", () => {
  it("writes a constraint ONLY from explicit constraintContent", () => {
    const E = seedEpisode({});
    const entry = recordStated(handle, SPACE, "belief", "believes he will always be broke", [
      { type: "episode", id: E },
    ]);
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "stop assuming I'm always broke",
      type: "preference_override",
      constraintContent: "never assume he is broke",
      constraintEvidence: [{ type: "episode", id: E }],
    });
    expect(res.status).toBe("applied");
    expect(res.constraintEntryId).not.toBeNull();
    const cRow = handle.sqlite
      .prepare(`SELECT slot, confidence, origin, content FROM user_model WHERE id = ?`)
      .get(res.constraintEntryId!) as {
      slot: string;
      confidence: number;
      origin: string;
      content: string;
    };
    expect(cRow.slot).toBe("constraint");
    expect(cRow.confidence).toBe(0.95);
    expect(cRow.origin).toBe("stated");
    expect(cRow.content).toBe("never assume he is broke");
  });
});

describe("T-U8: emotion expiry", () => {
  it("the read filter excludes 8-day-old emotions; the sweep is hygiene", async () => {
    const E = seedEpisode({});
    // 8-day-old emotion_state row (inserted directly to control valid_at).
    handle.sqlite
      .prepare(
        `INSERT INTO user_model
           (space_id, slot, content, confidence, evidence_strength, evidence_ids,
            topic_labels, valid_at, origin)
         VALUES (?, 'emotion_state', 'stressed about the fee', 0.9, 0.5,
                 ?, '["finance"]', datetime('now', '-8 days'), 'stated')`,
      )
      .run(SPACE, JSON.stringify([{ type: "episode", id: E }]));
    // Fresh emotion via the write path.
    recordStated(handle, SPACE, "emotion_state", "proud about the job", [
      { type: "episode", id: E },
    ]);

    // Correctness lives in the READ filter: the stale row is excluded even
    // though the sweep has never run.
    const before = getUserModel(handle, SPACE, { slot: "emotion_state" });
    expect(before.map((e) => e.content)).toEqual(["proud about the job"]);

    // W3 Rev 11 §6.3 superseded the sweep-expiry half of this test: a STATED
    // emotion is never expired by the sweep — it is flagged for review and
    // stays current (the read filter above remains the correctness path).
    // (Inferred/observed stale emotions still expire — see the W3 sweep
    // matrix tests.)
    const swept = await sweepStaleEmotions(handle, SPACE);
    expect(swept.expiredCount).toBe(0);
    expect(swept.flaggedStatedCount).toBe(1);
    const stale = handle.sqlite
      .prepare(`SELECT invalid_at, invalid_reason, review_flag, review_flagged_at FROM user_model WHERE content = 'stressed about the fee'`)
      .get() as {
        invalid_at: string | null;
        invalid_reason: string | null;
        review_flag: string | null;
        review_flagged_at: string | null;
      };
    expect(stale.invalid_at).toBeNull();
    expect(stale.invalid_reason).toBeNull();
    expect(stale.review_flag).toBe("stale_emotion");
    expect(stale.review_flagged_at).not.toBeNull();
  });
});

describe("T-U9: composeUserModelBlock", () => {
  it("renders the §7.2 prompt block", () => {
    const E = seedEpisode({});
    const ev: EvidenceInput[] = [{ type: "episode", id: E }];
    recordStated(handle, SPACE, "belief", "believes the CNA fee is $85", ev);
    recordStated(handle, SPACE, "desire", "wants the CNA license reinstated", ev);
    updateUserModel(handle, SPACE, "consolidated", {
      slot: "knowledge",
      content: "knows the bus route",
      confidence: 0.9,
      evidence: ev,
    });
    recordStated(
      handle,
      SPACE,
      "constraint",
      "never suggest spending before the CNA fee is covered",
      ev,
    );
    recordStated(handle, SPACE, "emotion_state", "stressed about the fee", ev);
    // Below the 0.40 display floor: must not appear.
    updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "might prefer morning reminders",
      confidence: 0.3,
      evidence: ev,
    });

    const block = composeUserModelBlock(handle, SPACE);
    expect(block).toContain("## What I believe about you");
    expect(block).not.toContain("what is true about you");
    expect(block).toContain("Believes:");
    expect(block).toContain("Wants:");
    expect(block).toContain("Knows:");
    expect(block).toContain("Constraints:");
    expect(block).toContain("Current state:");
    expect(block).toContain("(0.95, stated)"); // origin cited per line
    expect(block).not.toContain("might prefer morning reminders");
    // Emotion lines are always dated.
    const today = new Date().toISOString().slice(0, 10);
    expect(block).toContain(`stressed about the fee (${today})`);
    // ~400 token cap (4 chars/token heuristic).
    expect(block.length).toBeLessThanOrEqual(400 * 4);
  });
});

describe("T-U10: space isolation", () => {
  it("user-model reads are space-scoped", () => {
    const E = seedEpisode({});
    recordStated(handle, SPACE, "belief", "works at Samsonite", [{ type: "episode", id: E }]);
    expect(getUserModel(handle, SPACE2)).toEqual([]);
    expect(getUserModel(handle, SPACE)).toHaveLength(1);
  });
});

describe("T-U11: higher-order rejection (INV-TOM-1)", () => {
  it("rejects nested mental-state content at write time", () => {
    const E = seedEpisode({});
    expectUserModelValidationError(
      () =>
        recordStated(handle, SPACE, "belief", "he thinks I think the fee is fine", [
          { type: "episode", id: E },
        ]),
      "higher_order_tom",
    );
    expect(getUserModel(handle, SPACE)).toHaveLength(0);
  });
});

describe("T-U12: persona backfill (INV-PERSONA-1)", () => {
  it("blob content cannot become stated without explicit user confirmation", () => {
    const E = seedEpisode({});
    expectUserModelValidationError(
      () =>
        recordStated(handle, SPACE, "belief", "works at Samsonite", [{ type: "episode", id: E }], {
          source: "user_persona_blob",
        }),
      "persona_backfill",
    );
    // With explicit confirmation it is allowed (assisted, user-reviewable).
    const ok = recordStated(
      handle,
      SPACE,
      "belief",
      "works at Samsonite",
      [{ type: "episode", id: E }],
      { source: "user_persona_blob", userConfirmed: true },
    );
    expect(ok.entry.origin).toBe("stated");
  });
});

describe("T-U13: one-proposition rule (B4)", () => {
  it("rejects multi-claim content with guidance to split", () => {
    const E = seedEpisode({});
    expectUserModelValidationError(
      () =>
        recordStated(handle, SPACE, "belief", "believes the fee is $85 and the bus is the 8", [
          { type: "episode", id: E },
        ]),
      "multi_proposition",
    );
    expectUserModelValidationError(
      () =>
        recordStated(handle, SPACE, "belief", "believes the fee is $85; pay it soon", [
          { type: "episode", id: E },
        ]),
      "multi_proposition",
    );
    // A single atomic claim passes.
    const ok = recordStated(handle, SPACE, "belief", "believes the fee is $85", [
      { type: "episode", id: E },
    ]);
    expect(ok.entry.content).toBe("believes the fee is $85");
  });
});

describe("T-U14: targeted invalidation (B4)", () => {
  it("contradicting one same-slot belief leaves the unrelated one untouched", () => {
    const E = seedEpisode({});
    // recordStated() invalidates contradicted inferred/consolidated entries
    // (INV-ST-1); stated-vs-stated conflicts surface as conflictingStatedIds
    // for the correction path instead. So the contradicted entry is inferred.
    const fee = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the fee is $85",
      confidence: 0.5,
      evidence: [{ type: "episode", id: E }],
    });
    const bus = recordStated(handle, SPACE, "belief", "believes the bus is the 8", [
      { type: "episode", id: E },
    ]);

    recordStated(handle, SPACE, "belief", "believes the fee is $90", [
      { type: "episode", id: E },
    ]);

    const feeRow = handle.sqlite
      .prepare(`SELECT invalid_at FROM user_model WHERE id = ?`)
      .get(fee.id) as { invalid_at: string | null };
    expect(feeRow.invalid_at).not.toBeNull();
    const busRow = handle.sqlite
      .prepare(`SELECT invalid_at FROM user_model WHERE id = ?`)
      .get(bus.id) as { invalid_at: string | null };
    expect(busRow.invalid_at).toBeNull(); // same slot, different topic: survives
  });
});

describe("T-U15: stated-trigger boundary (gap 15)", () => {
  it("hypotheticals, quotes, jokes, third-person, and questions produce no stated entry", () => {
    const E = seedEpisode({});
    const ev: EvidenceInput[] = [{ type: "episode", id: E }];
    const cases: Array<[string, string]> = [
      ["what if I quit my job?", "hypothetical"],
      ["she said I should save money", "quote of other"],
      ["I'm so broke lol", "joke"],
      ["my brother thinks I'm lazy", "third-person"],
      ["should I take the bus?", "question"],
    ];
    for (const [content] of cases) {
      expectUserModelValidationError(
        () => recordStated(handle, SPACE, "belief", content, ev),
        "trigger_boundary",
      );
    }
    expect(getUserModel(handle, SPACE)).toHaveLength(0);
  });
});

describe("T-U16: ambiguous correction abstains (Rev 3)", () => {
  it("two same-topic beliefs + vague correction → abstain, log, inquiry, nothing invalidated", () => {
    const E = seedEpisode({});
    const ev: EvidenceInput[] = [{ type: "episode", id: E }];
    const fee85 = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev);
    const moneyOrder = recordStated(
      handle,
      SPACE,
      "belief",
      "believes the fee must be a money order",
      ev,
    );

    const res = correctUserModel(handle, SPACE, null, {
      text: "that's wrong about the fee",
      type: "false_belief",
    });
    expect(res.status).toBe("abstained");
    expect(res.entryId).toBeNull();
    expect(res.inquiry).toBeDefined();
    expect(res.candidateScores!.length).toBe(2);
    // Neither entry was invalidated.
    for (const id of [fee85.id, moneyOrder.id]) {
      const row = handle.sqlite
        .prepare(`SELECT invalid_at FROM user_model WHERE id = ?`)
        .get(id) as { invalid_at: string | null };
      expect(row.invalid_at).toBeNull();
    }
    // The ambiguity was logged for the review path.
    const log = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'correction_ambiguous'`)
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();
  });
});

describe("T-U17: targeted correction (Rev 3)", () => {
  it("a precise correction invalidates only the matching entry", () => {
    const E = seedEpisode({});
    const ev: EvidenceInput[] = [{ type: "episode", id: E }];
    const fee85 = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev);
    const moneyOrder = recordStated(
      handle,
      SPACE,
      "belief",
      "believes the fee must be a money order",
      ev,
    );

    const res = correctUserModel(handle, SPACE, null, {
      text: "the fee isn't $85, it's $90",
      type: "factual_update",
      newContent: "believes the fee is $90",
      evidence: ev,
    });
    expect(res.status).toBe("applied");
    expect(res.entryId).toBe(fee85.id);
    expect(res.newEntryId).not.toBeNull();

    const old = handle.sqlite
      .prepare(`SELECT invalid_at, invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(fee85.id) as {
      invalid_at: string | null;
      invalid_reason: string | null;
      replaced_by: number | null;
    };
    expect(old.invalid_at).not.toBeNull();
    expect(old.invalid_reason).toBe("superseded");
    expect(old.replaced_by).toBe(res.newEntryId);

    // The money-order entry is untouched.
    const other = handle.sqlite
      .prepare(`SELECT invalid_at FROM user_model WHERE id = ?`)
      .get(moneyOrder.id) as { invalid_at: string | null };
    expect(other.invalid_at).toBeNull();
  });
});

describe("T-U18: belief withdrawal (Rev 3)", () => {
  it("withdrawal without replacement invalidates with replaced_by NULL", () => {
    const E = seedEpisode({});
    const entry = recordStated(handle, SPACE, "belief", "believes the bus is reliable", [
      { type: "episode", id: E },
    ]);
    const countBefore = (
      handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }
    ).n;

    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "I don't believe the bus is reliable anymore",
      type: "false_belief",
    });
    expect(res.status).toBe("applied");
    expect(res.newEntryId).toBeNull();

    const row = handle.sqlite
      .prepare(`SELECT invalid_reason, replaced_by FROM user_model WHERE id = ?`)
      .get(entry.id) as { invalid_reason: string | null; replaced_by: number | null };
    expect(row.invalid_reason).toBe("corrected_false_belief");
    expect(row.replaced_by).toBeNull();
    // No replacement row was written.
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }).n,
    ).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Knowledge check: T-K1 – T-K20
// ---------------------------------------------------------------------------

/** Seed one episode for evidence; returns a one-item evidence array. */
function ev1(): EvidenceInput[] {
  return [{ type: "episode", id: seedEpisode({}) }];
}

describe("T-K1: 0.95 stated belief contradiction", () => {
  it("contradicts_belief + suppress", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "you are in between jobs right now",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
    expect(res.conflictingEntries).toHaveLength(1);
    expect(res.conflictingEntries[0]!.confidence).toBe(0.95);
    expect(res.conflictingEntries[0]!.evidence).toHaveLength(1);
  });
});

describe("T-K2: low-confidence contradiction", () => {
  it("0.50 consolidated contradiction → rephrase_as_question", async () => {
    updateUserModel(handle, SPACE, "consolidated", {
      slot: "belief",
      content: "works at Samsonite",
      confidence: 0.5,
      evidence: ev1(),
    });
    const res = await knowledgeCheck(handle, SPACE, {
      content: "you are in between jobs",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("rephrase_as_question");
  });
});

describe("T-K3: restated knowledge", () => {
  it("already_known + suppress", async () => {
    recordStated(handle, SPACE, "knowledge", "knows the bus route is 8 then 1 then 3", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "the bus route is 8 then 1 then 3",
      path: "proactive",
    });
    expect(res.verdict).toBe("already_known");
    expect(res.suggestedAction).toBe("suppress");
  });
});

describe("T-K4: constraint violation", () => {
  it("contradicts_belief with the constraint cited", async () => {
    recordStated(
      handle,
      SPACE,
      "constraint",
      "never spend money on shoes before the CNA fee is covered",
      ev1(),
    );
    const res = await knowledgeCheck(handle, SPACE, {
      content: "spend money on shoes before the CNA fee is covered",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
    expect(res.conflictingEntries.some((e) => e.slot === "constraint")).toBe(true);
  });
});

describe("T-K5: the original sin", () => {
  it("'in between jobs' vs 'works at Samsonite' is suppressed and logged", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "you're in between jobs",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
    const log = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'knowledge_check'`)
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();
    expect(log!.result).toBe("contradicts_belief");
  });
});

describe("T-K6: adversarial recall (B3)", () => {
  it("'you are unemployed' contradicts 'started working at Samsonite' via state-change pattern", async () => {
    recordStated(handle, SPACE, "belief", "started working at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "you are unemployed",
      path: "proactive",
    });
    // Low surface similarity — recall comes from the employment topic
    // mapping + the employed/unemployed state incompatibility rule.
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.conflictingEntries[0]!.content).toBe("started working at Samsonite");
  });
});

describe("T-K7: negation (B3)", () => {
  it("'you don't work weekends' contradicts 'works Saturdays'", async () => {
    recordStated(handle, SPACE, "belief", "works Saturdays", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "you don't work weekends",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
  });
});

describe("T-K8: temporal succession (B3)", () => {
  it("a past-scoped restatement is succession, not contradiction", async () => {
    recordStated(handle, SPACE, "belief", "in between jobs", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "back when you were in between jobs, things were tight",
      path: "proactive",
    });
    // The candidate scopes the old state to the past → succession rule fires;
    // it must NOT be judged a contradiction of the current belief.
    expect(res.verdict).not.toBe("contradicts_belief");
    expect(res.conflictingEntries).toHaveLength(0);
  });
});

describe("T-K9: proactive fail-closed (B9)", () => {
  it("a check failure on the proactive path defers and logs", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    // Ambiguous pair (topic overlap, no deterministic verdict) + a judge
    // that times out: the bounded check must fail closed.
    const slowJudge: LlmJudge = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "uncertain";
    };
    const res = await knowledgeCheck(
      handle,
      SPACE,
      { content: "thinking about the warehouse schedule", path: "proactive" },
      { timeoutMs: 5, llmJudge: slowJudge },
    );
    expect(res.verdict).toBe("check_failed");
    expect(res.suggestedAction).toBe("defer");
    const log = handle.sqlite
      .prepare(
        `SELECT * FROM agent_logs WHERE action = 'knowledge_check' AND result = 'check_failed'`,
      )
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();
  });
});

describe("T-K10: conversational fail-open (B9)", () => {
  it("a check failure on the conversational path proceeds", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const slowJudge: LlmJudge = async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "uncertain";
    };
    const res = await knowledgeCheck(
      handle,
      SPACE,
      { content: "thinking about the warehouse schedule", path: "conversational" },
      { timeoutMs: 5, llmJudge: slowJudge },
    );
    expect(res.verdict).toBe("ok");
    expect(res.suggestedAction).toBe("proceed");
  });
});

describe("T-K11: paraphrase recall (B3, Rev 3)", () => {
  it("'between gigs' maps to employment via the synonym set", async () => {
    expect(mapTopics("between gigs right now").labels).toContain("employment");
    recordStated(handle, SPACE, "belief", "started at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "between gigs right now",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
  });
});

describe("T-K12: synonym recall (B3, Rev 3)", () => {
  it("'jobless' maps to employment via the synonym set", async () => {
    expect(mapTopics("looks like you're jobless").labels).toContain("employment");
    recordStated(handle, SPACE, "belief", "employed at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "looks like you're jobless",
      path: "proactive",
    });
    expect(res.verdict).toBe("contradicts_belief");
  });
});

describe("T-K13: compatible schedules, same topic (B3, Rev 4)", () => {
  it("topic overlap generates a candidate but compatible claims do NOT contradict", async () => {
    recordStated(handle, SPACE, "belief", "works Saturdays", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "only free on weekdays",
      path: "proactive",
    });
    // Weekday freedom and Saturday work are compatible — the check must not
    // declare a contradiction from topic overlap alone.
    expect(res.verdict).not.toBe("contradicts_belief");
    expect(res.conflictingEntries).toHaveLength(0);
  });
});

describe("T-K14: different entities, same topic (B3, Rev 4)", () => {
  it("'quit the warehouse' does not establish entity identity with Samsonite", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "quit the warehouse",
      path: "proactive",
    });
    // "warehouse" is a generic term, not an entity identifier — without an
    // entity-resolution link these are compatible (possibly different
    // workplaces). Candidate generated, verdict NOT contradicts_belief.
    expect(res.verdict).not.toBe("contradicts_belief");
    expect(res.conflictingEntries).toHaveLength(0);
  });
});

describe("T-K15: unrelated state change (B3, Rev 3)", () => {
  it("'quit smoking' does not contradict the employment belief", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "quit smoking",
      path: "proactive",
    });
    // "quit" is in the employment synonym set, so the pair IS generated as a
    // candidate — but the state-change verb must not over-fire into a false
    // contradiction. Without an LLM judge the pair stays ambiguous
    // ('uncertain'); the requirement is NO false contradicts_belief.
    expect(res.verdict).not.toBe("contradicts_belief");
    expect(res.conflictingEntries).toHaveLength(0);
  });
});

describe("T-K16: uncertain recall (B3, Rev 3)", () => {
  it("unmapped topics widen recall and never return a false ok", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = await knowledgeCheck(handle, SPACE, {
      content: "florpingle the zorg",
      path: "proactive",
    });
    expect(res.recall_uncertain).toBe(true);
    expect(res.verdict).toBe("uncertain");
    expect(res.suggestedAction).toBe("flag_for_review");
  });
});

describe("T-K17: genuine negation, same entity (B3, Rev 4)", () => {
  it("same entity + incompatible states → contradicts_belief; user_model untouched", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const before = snapshotUserModel();
    const res = await knowledgeCheck(
      handle,
      SPACE,
      { content: "I don't work at Samsonite anymore", path: "proactive" },
      { assertReadOnly: true },
    );
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
    expect(res.conflictingEntries[0]!.content).toBe("works at Samsonite");
    // Judgment only: byte-identical user_model.
    expect(snapshotUserModel()).toBe(before);
  });
});

describe("T-K18a: explicit job transition via the write path (B3, Rev 4; Rev 5)", () => {
  it("a user statement goes through recordStated/correction — NOT knowledgeCheck", () => {
    const entry = recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "I quit Samsonite, started at Amazon last week",
      type: "factual_update",
      newContent: "works at Amazon",
      evidence: ev1(),
    });
    expect(res.status).toBe("applied");
    // The quit explicitly terminates the Samsonite state; X≠Y.
    const old = handle.sqlite
      .prepare(`SELECT invalid_at, replaced_by FROM user_model WHERE id = ?`)
      .get(entry.id) as { invalid_at: string | null; replaced_by: number | null };
    expect(old.invalid_at).not.toBeNull();
    expect(old.replaced_by).toBe(res.newEntryId);
    const fresh = getUserModel(handle, SPACE);
    expect(fresh.map((e) => e.content)).toContain("works at Amazon");
    expect(fresh.find((e) => e.content === "works at Amazon")!.confidence).toBe(0.95);
  });
});

describe("T-K18b: explicit transition as proposed assistant content (INV-KC-1, Rev 5)", () => {
  it("knowledgeCheck judges the draft contradicts_belief and writes nothing", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const before = snapshotUserModel();
    const countBefore = (
      handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }
    ).n;
    const invalidBefore = handle.sqlite
      .prepare(`SELECT id, invalid_at FROM user_model ORDER BY id`)
      .all();

    // A digest DRAFT (proposed assistant message, not a user statement).
    const res = await knowledgeCheck(
      handle,
      SPACE,
      { content: "quit Samsonite, started at Amazon last week", path: "proactive" },
      { assertReadOnly: true },
    );
    // Deterministic explicit-transition rule — no LLM needed.
    expect(res.verdict).toBe("contradicts_belief");
    expect(res.suggestedAction).toBe("suppress");
    expect(res.conflictingEntries[0]!.content).toBe("works at Samsonite");

    // INV-KC-1: user_model is byte-identical — no invalidation, no new entry.
    // The check judges; it does not write.
    expect(snapshotUserModel()).toBe(before);
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM user_model`).get() as { n: number }).n,
    ).toBe(countBefore);
    expect(handle.sqlite.prepare(`SELECT id, invalid_at FROM user_model ORDER BY id`).all()).toEqual(
      invalidBefore,
    );
  });
});

describe("T-K19: different employers, no transition (B3, Rev 4)", () => {
  it("two employer names alone do not establish contradiction; user_model untouched", async () => {
    recordStated(handle, SPACE, "belief", "works at Samsonite", ev1());
    const before = snapshotUserModel();
    const res = await knowledgeCheck(
      handle,
      SPACE,
      { content: "picked up a shift at Amazon", path: "proactive" },
      { assertReadOnly: true },
    );
    // No quit/termination language; both employments could coexist.
    // At most uncertain + flag_for_review — never a false contradiction.
    expect(res.verdict).not.toBe("contradicts_belief");
    expect(res.conflictingEntries).toHaveLength(0);
    expect(snapshotUserModel()).toBe(before);
  });
});

describe("T-K20: constraint cap exemption (B8, Rev 4)", () => {
  it("all 30 constraints are evaluated; belief candidates are capped at 25", async () => {
    const evidence = ev1();
    // 30 constraints — one of them matches the candidate.
    for (let i = 1; i <= 30; i++) {
      recordStated(handle, SPACE, "constraint", `never do thing-${i} before the CNA fee is covered`, evidence);
    }
    recordStated(
      handle,
      SPACE,
      "constraint",
      "never spend money on shoes before the CNA fee is covered",
      evidence,
    );
    // 30 belief entries, all contradicting the candidate deterministically.
    for (let i = 1; i <= 30; i++) {
      recordStated(handle, SPACE, "belief", `works at Samsonite depot ${i}`, evidence);
    }

    const before = snapshotUserModel();
    const res = await knowledgeCheck(
      handle,
      SPACE,
      {
        content: "spend money on shoes before the CNA fee is covered; you are in between jobs",
        path: "proactive",
      },
      { assertReadOnly: true },
    );
    expect(res.verdict).toBe("contradicts_belief");
    // 25 capped belief candidates + the 1 violated constraint = 26.
    // (Without the cap this would be 31; without the exemption the violated
    // constraint might never have been evaluated.)
    expect(res.conflictingEntries).toHaveLength(26);
    expect(res.conflictingEntries.some((e) => e.slot === "constraint")).toBe(true);
    expect(
      res.conflictingEntries.filter((e) => e.slot === "constraint"),
    ).toHaveLength(1);
    // Judgment only.
    expect(snapshotUserModel()).toBe(before);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Validation & migration: T-V1 – T-V7, T-M1 – T-M3
// ---------------------------------------------------------------------------

describe("T-V1: malformed JSON refs rejected", () => {
  it("validateEpisodeRefs and validateEvidenceRefs reject bad shapes", () => {
    // participants must be an array of strings.
    expectEpisodicValidationError(
      () => validateEpisodeRefs(handle, SPACE, { participants: "nope" }),
      "bad_shape",
    );
    expectEpisodicValidationError(
      () => validateEpisodeRefs(handle, SPACE, { participants: [""] }),
      "bad_shape",
    );
    // sourceNodeIds must be integers.
    expectEpisodicValidationError(
      () => validateEpisodeRefs(handle, SPACE, { sourceNodeIds: [1.5] }),
      "bad_shape",
    );
    // Typed evidence refs: unknown type / non-integer id.
    expectUserModelValidationError(
      () =>
        validateEvidenceRefs(handle, SPACE, [{ type: "bogus", id: 1 } as never]),
      "malformed_evidence",
    );
    expectUserModelValidationError(
      () => validateEvidenceRefs(handle, SPACE, [{ type: "episode", id: 1.5 }]),
      "malformed_evidence",
    );
    // Missing row.
    expectUserModelValidationError(
      () => validateEvidenceRefs(handle, SPACE, [{ type: "episode", id: 99999 }]),
      "missing_reference",
    );
  });
});

describe("T-V2: cross-space node ref rejected", () => {
  it("references are valid only within the writing space (§8.5)", () => {
    const foreign = seedNode(SPACE2);
    expectUserModelValidationError(
      () => validateEvidenceRefs(handle, SPACE, [{ type: "node", id: foreign }]),
      "wrong_space",
    );
    expectEpisodicValidationError(
      () => validateEpisodeRefs(handle, SPACE, { sourceNodeIds: [foreign] }),
      "wrong_space",
    );
    // Same-space refs pass.
    const local = seedNode(SPACE);
    validateEvidenceRefs(handle, SPACE, [{ type: "node", id: local }]);
    validateEpisodeRefs(handle, SPACE, { sourceNodeIds: [local] });
  });
});

describe("T-V3: stale evidence annotated, not deleted", () => {
  it("a superseded node is marked stale at read time", () => {
    const N = seedNode();
    const E = seedEpisode({});
    recordStated(handle, SPACE, "belief", "believes the fee is $85", [
      { type: "node", id: N },
      { type: "episode", id: E },
    ]);
    // The node is superseded (W1-style); the ref is NOT deleted.
    handle.sqlite
      .prepare(`UPDATE nodes SET superseded_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), N);

    const entries = getUserModel(handle, SPACE);
    expect(entries).toHaveLength(1);
    const nodeRef = entries[0]!.evidence.find((e) => e.type === "node")!;
    expect(nodeRef.status).toBe("stale");
    expect(entries[0]!.evidence.find((e) => e.type === "episode")!.status).toBe("ok");
    // The entry itself survives — annotation, not deletion.
    expect(entries[0]!.invalidAt).toBeNull();
  });
});

describe("T-V4: withdrawn evidence", () => {
  it("fully-withdrawn evidence auto-invalidates inferred entries, flags stated ones", async () => {
    const E = seedEpisode({ excerpt: "forgotten soon" });
    const inferred = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: [{ type: "episode", id: E }],
    });
    const stated = recordStated(handle, SPACE, "belief", "believes rest is needed", [
      { type: "episode", id: E },
    ]);

    // The episode is forgotten (evidence withdrawn).
    handle.sqlite
      .prepare(`UPDATE episodes SET forgotten_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), E);

    const swept = await sweepWithdrawnEvidence(handle, SPACE);
    expect(swept.invalidatedIds).toEqual([inferred.id]);
    expect(swept.flaggedStatedIds).toEqual([stated.id]);

    const infRow = handle.sqlite
      .prepare(`SELECT invalid_reason FROM user_model WHERE id = ?`)
      .get(inferred.id) as { invalid_reason: string | null };
    expect(infRow.invalid_reason).toBe("evidence_withdrawn");
    // The stated entry keeps its content (the user said it) — flagged, not
    // invalidated.
    const stRow = handle.sqlite
      .prepare(`SELECT invalid_at FROM user_model WHERE id = ?`)
      .get(stated.id) as { invalid_at: string | null };
    expect(stRow.invalid_at).toBeNull();
  });
});

describe("T-V5: dangling reference (B6, Rev 3)", () => {
  it("linking to a nonexistent episode rejects the write and rolls back", () => {
    const N = seedNode();
    expectEpisodicValidationError(
      () => linkEpisodeToNodes(handle, SPACE, 99999, [N]),
      "not_found",
    );
    expect(
      (handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM episode_enrichments`).get() as { n: number }).n,
    ).toBe(0);
  });
});

describe("T-V6: cross-space reference (B6, Rev 3)", () => {
  it("a replaced_by-style reference to another space is rejected", () => {
    const E = seedEpisode({ spaceId: SPACE2 });
    const foreign = recordStated(handle, SPACE2, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    // correctUserModel addresses entries by id; the space filter rejects the
    // foreign row even though it exists — references never cross spaces.
    expectUserModelValidationError(
      () =>
        correctUserModel(handle, SPACE, foreign.id, {
          text: "the fee is not $85",
          type: "false_belief",
        }),
      "entry_not_found",
    );
  });
});

describe("T-V7: superseded reference (B6, Rev 3)", () => {
  it("superseding an already-superseded version throws already_superseded", () => {
    const E = seedEpisode({});
    const N1 = seedNode();
    linkEpisodeToNodes(handle, SPACE, E, [N1]); // minimal v1

    // Fault injection: a trigger pre-supersedes the current version inside
    // the linker's own transaction, so the module's guarded
    // UPDATE ... WHERE superseded_by IS NULL affects 0 rows — the exact
    // concurrent-supersede path.
    handle.sqlite.exec(`CREATE TRIGGER w2_test_fault AFTER INSERT ON episode_enrichments
      WHEN NEW.version > 1 BEGIN
        UPDATE episode_enrichments SET superseded_by = -1 WHERE id = (
          SELECT id FROM episode_enrichments
          WHERE episode_id = NEW.episode_id AND version = NEW.version - 1
        );
      END;`);
    try {
      expectEpisodicValidationError(
        () => linkEpisodeToNodes(handle, SPACE, E, [seedNode()]),
        "already_superseded",
      );
      // The whole transaction rolled back: still exactly one version.
      expect(
        (
          handle.sqlite
            .prepare(`SELECT COUNT(*) AS n FROM episode_enrichments WHERE episode_id = ?`)
            .get(E) as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      handle.sqlite.exec(`DROP TRIGGER w2_test_fault`);
    }
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/** Expected columns per W2 table (design §§3.2, 3.3, 3.5, 3.7, 4.2). */
const W2_TABLE_COLUMNS: Record<string, string[]> = {
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
    "status", "created_at", "applied_at",
  ],
  enrichment_quota: ["space_id", "quota_date", "claimed"],
};

/**
 * Post-migration loud assertion (design §8.1): every W2 table exists with
 * every expected column. Throws on any mismatch — the W1 timestamp-assertion
 * pattern (fail loudly at startup, never silently).
 */
export function assertW2Schema(sqlite: DbHandle["sqlite"]): void {
  for (const [table, cols] of Object.entries(W2_TABLE_COLUMNS)) {
    const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (info.length === 0) {
      throw new Error(`W2 migration assertion failed: table '${table}' is missing`);
    }
    const names = new Set(info.map((c) => c.name));
    for (const col of cols) {
      if (!names.has(col)) {
        throw new Error(`W2 migration assertion failed: column '${table}.${col}' is missing`);
      }
    }
  }
}

/** Paren-aware extraction of top-level CHECK(...) expressions from DDL text. */
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

const normalizeSql = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Behavioral UNIQUE check: duplicate (episode_id, version) and duplicate
 * (space_id, slot, content, valid_at) inserts must be rejected.
 */
function assertUniqueBehavior(sqlite: DbHandle["sqlite"]): void {
  const ep = sqlite
    .prepare(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
       VALUES ('t-m2', 'conversation', 'x', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
  const eid = Number(ep.lastInsertRowid);
  const insEnr = sqlite.prepare(
    `INSERT INTO episode_enrichments (episode_id, space_id, version) VALUES (?, 't-m2', 1)`,
  );
  insEnr.run(eid);
  let threw = false;
  try {
    insEnr.run(eid);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("UNIQUE(episode_id, version) is not enforced");

  const insUm = sqlite.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin)
     VALUES ('t-m2', 'belief', 'u', 0.5, '[]', '2026-01-01T00:00:00.000Z', 'inferred')`,
  );
  insUm.run();
  threw = false;
  try {
    insUm.run();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("UNIQUE(space_id, slot, content, valid_at) is not enforced");
}

/**
 * assertSchemaEquivalent (design §8.1, B8 Rev 3): compares columns
 * (PRAGMA table_info — name/type/notnull/default/pk), indexes (full
 * CREATE INDEX text from sqlite_master, so partial-index predicates are
 * compared too), CHECK constraints (extracted from sqlite_master DDL text),
 * and UNIQUE behavior (behavioral duplicate-insert rejection) across the
 * five W2 tables.
 *
 * TEST-GAP (T-M2): no migrated-DB fixture is available in this environment —
 * the "migrated" path is simulated with the same DDL (fresh-vs-fresh, which
 * must pass) plus deliberately-different negative cases (which must throw).
 * When the schema patch lands, run this against a genuinely migrated
 * database: the migration path replicates BOOTSTRAP_SQL per §8.1, and this
 * assertion pins that the two paths stay identical.
 */
export function assertSchemaEquivalent(
  a: DbHandle["sqlite"],
  b: DbHandle["sqlite"],
): void {
  for (const table of Object.keys(W2_TABLE_COLUMNS)) {
    // 1. Columns.
    const colsA = a.prepare(`PRAGMA table_info(${table})`).all();
    const colsB = b.prepare(`PRAGMA table_info(${table})`).all();
    const norm = (rows: Record<string, unknown>[]) =>
      rows.map((r) => ({
        name: r.name,
        type: String(r.type ?? "").toUpperCase(),
        notnull: r.notnull,
        dflt: r.dflt_value ?? null,
        pk: r.pk,
      }));
    expect(norm(colsA as Record<string, unknown>[])).toEqual(
      norm(colsB as Record<string, unknown>[]),
    );

    // 2. Indexes (full CREATE INDEX text — covers partial-index predicates).
    const idx = (s: DbHandle["sqlite"]) => {
      const rows = s
        .prepare(
          `SELECT name, sql FROM sqlite_master
           WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
        )
        .all(table) as { name: string; sql: string }[];
      const out: Record<string, string> = {};
      for (const r of rows) out[r.name] = normalizeSql(r.sql);
      return out;
    };
    expect(idx(a)).toEqual(idx(b));

    // 3. CHECK constraints (parsed from sqlite_master DDL text).
    const checks = (s: DbHandle["sqlite"]) => {
      const row = s
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { sql: string } | undefined;
      if (!row) throw new Error(`table '${table}' missing`);
      return extractCheckExprs(row.sql).map(normalizeSql).sort();
    };
    expect(checks(a)).toEqual(checks(b));
  }
  // 4. UNIQUE behavior, on both paths.
  assertUniqueBehavior(a);
  assertUniqueBehavior(b);
}

function freshW2Db(episodicDdl?: string): DbHandle {
  const h = createDb(":memory:");
  if (episodicDdl !== undefined) {
    // A caller-supplied DDL must be authoritative. createDb's bootstrap has
    // already created these tables and w2Ddl() uses IF NOT EXISTS, so
    // without dropping first, the custom DDL would silently never apply
    // (this is why T-M2's rogue-CHECK case used to compare two identical
    // production tables and never throw).
    for (const t of [
      "episodes",
      "episode_enrichments",
      "enrichment_quota",
      "forget_requests",
      "episodes_fts",
      "vec_episodes",
    ]) {
      h.sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
    }
  }
  h.sqlite.exec(episodicDdl ?? Episodic.w2Ddl());
  h.sqlite.exec(USER_MODEL_DDL);
  return h;
}

describe("T-M1: fresh DB creates all five W2 tables", () => {
  it("BOOTSTRAP-equivalent DDL produces the expected schema", () => {
    const h = freshW2Db();
    try {
      expect(() => assertW2Schema(h.sqlite)).not.toThrow();
    } finally {
      (h.sqlite as unknown as { close(): void }).close();
    }
  });
});

describe("T-M2: migration equivalence (B8, Rev 3)", () => {
  it("fresh-vs-fresh schemas are equivalent (columns, indexes, CHECKs, UNIQUE behavior)", () => {
    const a = freshW2Db();
    const b = freshW2Db();
    try {
      expect(() => assertSchemaEquivalent(a.sqlite, b.sqlite)).not.toThrow();
    } finally {
      (a.sqlite as unknown as { close(): void }).close();
      (b.sqlite as unknown as { close(): void }).close();
    }
  });

  it("a deliberately different schema throws (dropped index + added column)", () => {
    const a = freshW2Db();
    const b = freshW2Db();
    try {
      b.sqlite.exec(`DROP INDEX idx_episodes_kind`);
      b.sqlite.exec(`ALTER TABLE episodes ADD COLUMN extra_col TEXT`);
      expect(() => assertSchemaEquivalent(a.sqlite, b.sqlite)).toThrow();
    } finally {
      (a.sqlite as unknown as { close(): void }).close();
      (b.sqlite as unknown as { close(): void }).close();
    }
  });

  it("a deliberately different CHECK constraint throws", () => {
    const a = freshW2Db();
    // Same DDL except the episodes.kind CHECK gains a rogue value.
    const modified = Episodic.w2Ddl().replace(
      "'conversation','agent_action','job_run','digest_sent',\n    'proactive_msg','correction','milestone','session'",
      "'conversation','agent_action','job_run','digest_sent',\n    'proactive_msg','correction','milestone','session','rogue_kind'",
    );
    expect(modified).not.toBe(Episodic.w2Ddl());
    const b = freshW2Db(modified);
    try {
      expect(() => assertSchemaEquivalent(a.sqlite, b.sqlite)).toThrow();
    } finally {
      (a.sqlite as unknown as { close(): void }).close();
      (b.sqlite as unknown as { close(): void }).close();
    }
  });
});

describe("T-M3: migration assertion", () => {
  it("missing table or column after migration throws loudly", () => {
    const h = freshW2Db();
    try {
      expect(() => assertW2Schema(h.sqlite)).not.toThrow();
      h.sqlite.exec(`DROP TABLE enrichment_quota`);
      expect(() => assertW2Schema(h.sqlite)).toThrow(/enrichment_quota/);
    } finally {
      (h.sqlite as unknown as { close(): void }).close();
    }
  });
});

describe("T-VEC-1: vec_episodes exists via production createDb() (P0, impl review)", () => {
  it("production bootstrapVec creates vec_episodes — no test-only helper", () => {
    // Regression: episodic.ts writes episode embeddings to vec_episodes, but
    // the production schema path (db/vec.ts bootstrapVec) did not create it —
    // only the test helper bootstrapEpisodicTables() did. This test goes
    // through the REAL createDb() with NO test bootstrap and asserts the
    // table exists, so enrichment can't fail on a production database.
    const h = createDb(":memory:");
    try {
      const row = h.sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='vec_episodes'`,
        )
        .get() as { name?: string } | undefined;
      expect(row?.name).toBe("vec_episodes");
      // And the shape matches what episodic.ts expects: episode_id PK + embedding.
      const cols = h.sqlite
        .prepare(`PRAGMA table_info(vec_episodes)`)
        .all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("episode_id");
      expect(names).toContain("embedding");
    } finally {
      (h.sqlite as unknown as { close(): void }).close();
    }
  });

  it("episode embedding write works on a production-bootstrapped DB", async () => {
    // End-to-end: capture an episode, claim it, and run enrichEpisode (which
    // writes the embedding) using ONLY createDb() — no test helper. Fails
    // before the bootstrapVec fix with "no such table: vec_episodes".
    const h = createDb(":memory:");
    try {
      const res = captureEpisode(h, SPACE, {
        kind: "conversation",
        userExcerpt: "asked about the Samsonite job",
        toolNames: ["memorySearch"],
        outcome: "job_update",
      });
      expect(res).not.toBeNull();
      const claimed = claimEnrichment(h, SPACE);
      // Strict: the episode must be claimable. A silent skip here would let
      // the embedding-write assertion pass vacuously.
      expect(claimed).not.toBeNull();
      const result = await enrichEpisode(h, SPACE, claimed!.episodeId, claimed!.fence, {
          enricher: async () => ({
            detail: null,
            emotion: "neutral",
            emotionalWeight: 0.5,
            importance: 0.7,
            participants: [],
            place: null,
            // INV-ENRICH-4 completeness: once any interpretive field is
            // populated, EVERY interpretive field needs a label (NULL fields
            // take 'not_reported'). The full map is what the production
            // enricher contract requires — an emotion-only map is rejected.
            fieldProvenance: {
              detail: "not_reported",
              emotion: "inferred",
              emotional_weight: "inferred",
              importance: "inferred",
              participants: "not_reported",
              place: "not_reported",
            },
          }),
          embed: async () => new Float32Array(384).fill(0.1),
        });
        expect(["completed", "already_completed"]).toContain(result.status);
        const vecRow = h.sqlite
          .prepare(`SELECT episode_id FROM vec_episodes WHERE episode_id = ?`)
          .get(res!.episodeId) as { episode_id?: number } | undefined;
        expect(vecRow?.episode_id).toBe(res!.episodeId);
    } finally {
      (h.sqlite as unknown as { close(): void }).close();
    }
  });
});
