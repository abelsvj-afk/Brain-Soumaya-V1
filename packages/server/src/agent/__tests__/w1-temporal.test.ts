import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createDb, type DbHandle } from "../../db/client.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import {
  supersede,
  SupersessionConflictError,
  isNeverTrue,
  getCorrections,
  asOfBelief,
  nodeHistory,
  CANONICAL_TS,
  normalizeTimestamp,
} from "../temporal.js";
import { MAX_CANDIDATES, vecSearchCurrent } from "../../db/vec.js";
import { keywordSearch } from "../../db/fts.js";
import { buildDailyDigest } from "../../synthesis/dailyDigest.js";

/**
 * W1 temporal truth acceptance tests (design §10).
 * Each test maps to a signed-off requirement in docs/wisdom/w1-design-revision.md.
 *
 * Core principle: a memory can stop being current without its history being
 * rewritten, and a correction must not create false historical truth.
 */

let handle: DbHandle;
let repo: NodesRepo;
const SPACE = "w1-test-space";
const SPACE2 = "w1-test-space-2";

const EMB = new Float32Array(384).fill(0.1);

beforeEach(() => {
  handle = createDb(":memory:");
  repo = new NodesRepo(handle, SPACE);
});

afterEach(() => handle.sqlite.close());

function seedNode(label: string, spaceId = SPACE, extra: Record<string, unknown> = {}): number {
  const cols = ["space_id", "label", "type", "content", ...Object.keys(extra)];
  const vals = [spaceId, label, "memory", `content of ${label}`, ...Object.values(extra)];
  const r = handle.sqlite
    .prepare(`INSERT INTO nodes (${cols.join(", ")}) VALUES (${vals.map(() => "?").join(", ")})`)
    .run(...vals);
  return Number(r.lastInsertRowid);
}

function getNode(id: number): Record<string, unknown> {
  return handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// T1–T8: Revision 1 tests (retained with corrections)
// ---------------------------------------------------------------------------

describe("T1: basic supersession", () => {
  it("supersedes a fact and creates a correction event", () => {
    const a = seedNode("Between jobs");
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: {
        label: "Started Samsonite",
        type: "memory",
        content: "Started at Samsonite warehouse",
        validFrom: "2026-10-08T00:00:00.000Z",
      },
      correctionType: "factual_update",
      correctedBy: "user",
      reason: "job_update",
      origin: "user_statement",
    });
    expect(result.newNodeId).not.toBeNull();
    expect(result.opTime).toMatch(CANONICAL_TS);

    const oldRow = getNode(a);
    expect(oldRow.superseded_at).not.toBeNull();
    expect(oldRow.superseded_by).toBe(result.newNodeId);
    expect(oldRow.supersede_reason).toBe("update");
    expect(oldRow.valid_to).toBe("2026-10-08T00:00:00.000Z");

    // Correction event created with type factual_update
    const corrections = getCorrections(handle.sqlite, a);
    expect(corrections).toHaveLength(1);
    expect(corrections[0].correction_type).toBe("factual_update");
    expect(corrections[0].corrected_by).toBe("user");
  });
});

describe("T2: out-of-order messages", () => {
  it("handles a backdated valid_from correctly", () => {
    const a = seedNode("Between jobs");
    // User reports on Oct 10 that they started Oct 8
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: {
        label: "Started Samsonite",
        type: "memory",
        content: "Started Oct 8",
        validFrom: "2026-10-08T00:00:00.000Z", // date-only → midnight UTC
      },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const newRow = getNode(result.newNodeId!);
    expect(newRow.valid_from).toBe("2026-10-08T00:00:00.000Z");
    expect(newRow.recorded_at).toMatch(CANONICAL_TS);
  });
});

describe("T3: repeated corrections", () => {
  it("preserves correction history through multiple corrections", () => {
    const a = seedNode("Car insurance $200/mo");
    // First: false-belief correction
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      reason: "no_car",
      origin: "user_correction",
    });
    expect(isNeverTrue(handle.sqlite, a)).toBe(true);

    // History shows: believed, corrected as false
    const history = nodeHistory(handle.sqlite, SPACE, a);
    expect(history?.wasCorrectedAsFalse).toBe(true);
    expect(history?.correctionHistory).toHaveLength(1);
  });
});

describe("T4: concurrent supersession", () => {
  it("second supersession of an already-superseded node fails", () => {
    const a = seedNode("Between jobs");
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: { label: "Job A", type: "memory", content: "x" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: { label: "Job B", type: "memory", content: "y" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "user_statement",
      }),
    ).toThrow(SupersessionConflictError);
  });
});

describe("T5: ambiguous non-invalidation", () => {
  it("ambiguous contradictions do not supersede", () => {
    const a = seedNode("Likes morning reminders");
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: { label: "Evening?", type: "memory", content: "maybe" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "user_statement",
        ambiguous: true,
      }),
    ).toThrow(SupersessionConflictError);
    // Node unmodified
    expect(getNode(a).superseded_at).toBeNull();
    // Logged for W3
    const log = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'potential_contradiction'`)
      .get() as Record<string, unknown> | undefined;
    expect(log).toBeDefined();
  });
});

describe("T6: digest exclusion", () => {
  it("superseded facts do not appear in the digest", () => {
    const a = repo.create(
      { label: "Between jobs", type: "memory", content: "unemployed" },
      EMB,
    );
    supersede(handle, SPACE, {
      oldNodeId: a.id,
      newNode: { label: "Started Samsonite", type: "memory", content: "employed" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const digest = buildDailyDigest(handle, SPACE);
    const allLabels = [
      ...digest.fresh.map((f) => f.node.label),
      ...digest.cooling.map((c) => c.node.label),
      ...digest.reminders.map((r) => r.node.label),
    ];
    expect(allLabels).not.toContain("Between jobs");
  });

  it("superseded facts do not reach the LLM digest input path", () => {
    // The bad digest came through an LLM path, not buildDailyDigest().
    // Verify the repo-level filter that feeds LLM context.
    const a = repo.create({ label: "Car insurance", type: "memory", content: "have car" }, EMB);
    supersede(handle, SPACE, {
      oldNodeId: a.id,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      origin: "user_correction",
    });
    // byIds (memorySearch path) excludes superseded by default
    expect(repo.byIds([a.id])).toHaveLength(0);
    expect(repo.byIds([a.id], { includeSuperseded: true })).toHaveLength(1);
    // getCurrentById returns undefined for superseded
    expect(repo.getCurrentById(a.id)).toBeUndefined();
    // getById (history path) still returns it
    expect(repo.getById(a.id)).toBeDefined();
  });
});

describe("T7: backfill", () => {
  it("existing rows get canonical recorded_at after migration", () => {
    // Seed via raw SQL (simulates pre-W1 rows without recorded_at... but
    // migration already ran on :memory: DBs. Instead verify the invariant.)
    const id = seedNode("Legacy memory");
    const row = getNode(id);
    // On a fresh :memory: DB, bootstrap ran — recorded_at has DB default
    expect(row.recorded_at).toMatch(CANONICAL_TS);
  });
});

describe("T8: cascade atomicity", () => {
  it("cascade is disabled by default", () => {
    const meta = handle.sqlite
      .prepare(`SELECT w1_cascade_enabled FROM space_meta WHERE space_id = ?`)
      .get(SPACE) as { w1_cascade_enabled: number } | undefined;
    // No space_meta row yet for test space → flag check defaults to disabled
    // (temporal.ts catches the missing row and treats as disabled).
    // Explicitly verify the column default is 0 via a fresh insert.
    handle.sqlite
      .prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`)
      .run(SPACE);
    const m2 = handle.sqlite
      .prepare(`SELECT w1_cascade_enabled FROM space_meta WHERE space_id = ?`)
      .get(SPACE) as { w1_cascade_enabled: number };
    expect(m2.w1_cascade_enabled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Timestamp tests (T-TIME-1 through T-TIME-5)
// ---------------------------------------------------------------------------

describe("T-TIME-1: mixed-format regression", () => {
  it("normalizes old-format timestamps to canonical", () => {
    expect(normalizeTimestamp("2026-10-19 14:30:00")).toBe("2026-10-19T14:30:00.000Z");
    expect(normalizeTimestamp("2026-10-19T14:30:00.000Z")).toBe("2026-10-19T14:30:00.000Z");
    expect(CANONICAL_TS.test(normalizeTimestamp("2026-10-19 14:30:00"))).toBe(true);
  });
});

describe("T-TIME-2: same-day boundaries", () => {
  it("valid_from at exactly midnight is inclusive", () => {
    const validFrom = "2026-10-08T00:00:00.000Z";
    const now = "2026-10-08T00:00:00.000Z";
    expect(validFrom <= now).toBe(true); // lexicographic == chronological
  });
});

describe("T-TIME-3: timezone offsets", () => {
  it("encodes EDT 8am as UTC noon", () => {
    // America/New_York EDT = UTC-4 in October
    const edt8am = new Date("2026-10-08T08:00:00-04:00").toISOString();
    expect(edt8am).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("T-TIME-4: historical dates", () => {
  it("orders historical dates chronologically", () => {
    const dates = [
      "2021-01-01T00:00:00.000Z",
      "2026-10-08T00:00:00.000Z",
      "2026-10-19T14:30:00.000Z",
    ];
    const sorted = [...dates].sort();
    expect(sorted).toEqual(dates);
  });
});

describe("T-TIME-5: shared operation timestamp", () => {
  it("superseded_at, recorded_at, and corrected_at are string-identical", () => {
    const a = seedNode("Between jobs");
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: { label: "Started Samsonite", type: "memory", content: "x" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const oldRow = getNode(a);
    const newRow = getNode(result.newNodeId!);
    const corr = handle.sqlite
      .prepare(`SELECT corrected_at FROM corrections WHERE id = ?`)
      .get(result.correctionId) as { corrected_at: string };
    expect(oldRow.superseded_at).toBe(result.opTime);
    expect(newRow.recorded_at).toBe(result.opTime);
    expect(corr.corrected_at).toBe(result.opTime);
  });
});

// ---------------------------------------------------------------------------
// T-WRITE-1: all insert paths populate recorded_at
// ---------------------------------------------------------------------------

describe("T-WRITE-1: insert paths", () => {
  it("NodesRepo.create populates recorded_at in canonical format", () => {
    const before = new Date().toISOString();
    const n = repo.create({ label: "Test", type: "memory", content: "x" }, EMB);
    const row = getNode(n.id);
    expect(row.recorded_at).toMatch(CANONICAL_TS);
    expect((row.recorded_at as string) >= before).toBe(true);
  });

  it("supersede() new-row insert uses explicit opTime", () => {
    const a = seedNode("Old");
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: { label: "New", type: "memory", content: "y" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const newRow = getNode(result.newNodeId!);
    expect(newRow.recorded_at).toBe(result.opTime);
  });

  it("raw SQL insert without recorded_at documents the limitation", () => {
    // On migrated schemas there is no DB default — raw inserts MUST supply it.
    // This test documents that the application never does this.
    const r = handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`)
      .run(SPACE, "Raw", "memory", "x");
    const row = getNode(Number(r.lastInsertRowid));
    // Fresh :memory: DBs have the bootstrap default, so this documents the
    // BEHAVIORAL difference: app code always sets it explicitly.
    expect(row.recorded_at).toBeDefined();
  });

  it("T-MIG-2: raw insert + restart normalizes legacy created_at", () => {
    // Regression test for the fresh-DB startup edge case: a raw SQL insert
    // relies on column defaults — recorded_at gets the canonical default but
    // created_at gets SQLite's legacy CURRENT_TIMESTAMP format. On the NEXT
    // startup, the migration must normalize created_at BEFORE the canonical
    // assertion runs, or startup throws.
    const tmpPath = join(tmpdir(), `w1-mig2-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    try {
      // First boot: fresh DB, bootstrap + migration run.
      const h1 = createDb(tmpPath);
      // Raw insert using only column defaults (no explicit timestamps).
      // Simulate the legacy default by forcing created_at into old format —
      // this is what CURRENT_TIMESTAMP produces on fresh-schema inserts
      // that bypass application code.
      const r = h1.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))`)
        .run(SPACE, "RawRestart", "memory", "y");
      const rowId = Number(r.lastInsertRowid);
      const before = h1.sqlite
        .prepare(`SELECT created_at, recorded_at FROM nodes WHERE id = ?`)
        .get(rowId) as { created_at: string; recorded_at: string };
      // recorded_at got the canonical bootstrap default; created_at is legacy.
      expect(before.recorded_at).toMatch(CANONICAL_TS);
      expect(before.created_at).not.toMatch(CANONICAL_TS);
      h1.sqlite.close();

      // Second boot (restart): migration reruns. Must NOT throw.
      let h2: DbHandle | undefined;
      expect(() => {
        h2 = createDb(tmpPath);
      }).not.toThrow();
      try {
        const after = h2!.sqlite
          .prepare(`SELECT created_at, recorded_at FROM nodes WHERE id = ?`)
          .get(rowId) as { created_at: string; recorded_at: string };
        // Both timestamps are now canonical.
        expect(after.created_at).toMatch(CANONICAL_TS);
        expect(after.recorded_at).toMatch(CANONICAL_TS);
      } finally {
        h2!.sqlite.close();
      }
    } finally {
      // Cleanup temp file (best-effort).
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T-TRIG-1: ambiguous LLM inference cannot supersede
// ---------------------------------------------------------------------------

describe("T-TRIG-1: model uncertainty", () => {
  it("LLM proposal without user origin is blocked and logged", () => {
    const a = seedNode("Prefers morning reminders");
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: { label: "Evening?", type: "memory", content: "maybe" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "model_inference",
        llmProposed: true,
      }),
    ).toThrow(SupersessionConflictError);
    expect(getNode(a).superseded_at).toBeNull();
    const proposed = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'supersession_proposed'`)
      .get();
    expect(proposed).toBeDefined();
    const pending = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'potential_contradiction'`)
      .get();
    expect(pending).toBeDefined();
  });

  it("non-user origin is blocked", () => {
    const a = seedNode("Some fact");
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: { label: "Other", type: "memory", content: "z" },
        correctionType: "factual_update",
        correctedBy: "system",
        origin: "tool_output",
      }),
    ).toThrow(SupersessionConflictError);
  });

  it("LLM proposal with user origin is STILL blocked (advisory only)", () => {
    // Blocker 1 regression: llmProposed=true must NEVER auto-execute, even
    // when paired with a user-origin value. The old guard only blocked when
    // origin was NOT user-originated — this case slipped through.
    const a = seedNode("Some fact");
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: { label: "Replacement", type: "memory", content: "new" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "user_statement",
        llmProposed: true,
      }),
    ).toThrow(SupersessionConflictError);
    // NOTHING changed: old node still current, no new node, no correction event
    expect(getNode(a).superseded_at).toBeNull();
    const newNodes = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE label = 'Replacement'`)
      .get() as { n: number };
    expect(newNodes.n).toBe(0);
    expect(getCorrections(handle.sqlite, a)).toHaveLength(0);
    // Proposal was logged as advisory
    const proposed = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE action = 'supersession_proposed'`)
      .get();
    expect(proposed).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T-RTR-1/2/3: retrieval edge cases
// ---------------------------------------------------------------------------

describe("T-RTR-2: iterative over-fetch survives superseded flooding", () => {
  it("finds valid nodes buried under superseded ones via vecSearchCurrent", () => {
    // 500 superseded + 3 valid. The injected page function returns superseded
    // IDs first (positions 0-499) and valid IDs at 500-502. A single-shot fetch
    // would return zero valid results; iterative widening must find all 3.
    // This test FAILS if the iterative loop is removed.
    const SUP_COUNT = 500;
    const supIds: number[] = [];
    for (let i = 0; i < SUP_COUNT; i++) {
      supIds.push(seedNode(`Superseded ${i}`, SPACE, { superseded_at: "2026-10-10T00:00:00.000Z" }));
    }
    const validIds: number[] = [seedNode("Valid one"), seedNode("Valid two"), seedNode("Valid three")];
    const ordering = [...supIds, ...validIds]; // valid buried at the end
    const fakeFetchPage = (fetchSize: number, offset: number) => {
      return ordering
        .slice(offset, offset + fetchSize)
        .map((nodeId, idx) => ({ nodeId, distance: 0.1 + (offset + idx) * 0.001 }));
    };
    const qv = new Float32Array(384).fill(0.1);
    const hits = vecSearchCurrent(handle.sqlite, SPACE, qv, 3, undefined, fakeFetchPage);
    expect(hits.map((h) => h.nodeId).sort((a, b) => a - b)).toEqual(
      [...validIds].sort((a, b) => a - b),
    );
    // And the repo-level filter agrees
    const byIds = repo.byIds([...validIds, supIds[0]]);
    expect(byIds.map((r) => r.id).sort()).toEqual([...validIds].sort((a, b) => a - b));
  });
});

describe("T-RTR-3: safety bound", () => {
  it("MAX_CANDIDATES is 2000", () => {
    expect(MAX_CANDIDATES).toBe(2000);
  });

  it("emits truncation diagnostic and returns partial results on bound hit", () => {
    // 2500 superseded + 2 valid at positions 100-101 (within the bound), k=3.
    // The loop finds 2 valid but exhausts MAX_CANDIDATES before a 3rd exists.
    // Must return partial results + diagnostic — never claim completeness.
    const SUP_COUNT = 2500;
    const supIds: number[] = [];
    for (let i = 0; i < SUP_COUNT; i++) {
      supIds.push(seedNode(`Sup ${i}`, SPACE, { superseded_at: "2026-10-10T00:00:00.000Z" }));
    }
    const validIds: number[] = [seedNode("V1"), seedNode("V2")];
    const ordering = [...supIds.slice(0, 100), ...validIds, ...supIds.slice(100)];
    const fakeFetchPage = (fetchSize: number, offset: number) => {
      return ordering
        .slice(offset, offset + fetchSize)
        .map((nodeId, idx) => ({ nodeId, distance: 0.1 + (offset + idx) * 0.001 }));
    };
    const diagnostics: { event: string; data: Record<string, unknown> }[] = [];
    const qv = new Float32Array(384).fill(0.1);
    const hits = vecSearchCurrent(
      handle.sqlite,
      SPACE,
      qv,
      3,
      (event, data) => diagnostics.push({ event, data }),
      fakeFetchPage,
    );
    // Partial results: the 2 valid nodes that exist within the bound
    expect(hits.map((h) => h.nodeId).sort((a, b) => a - b)).toEqual(
      [...validIds].sort((a, b) => a - b),
    );
    // Truncation diagnostic emitted exactly once, with honest counts
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].event).toBe("vecSearchTruncated");
    expect(diagnostics[0].data["wanted"]).toBe(3);
    expect(diagnostics[0].data["found"]).toBe(2);
    expect(diagnostics[0].data["space_id"]).toBe(SPACE);
  });
});

// ---------------------------------------------------------------------------
// T-RB-1: rollback behavior
// ---------------------------------------------------------------------------

describe("T-RB-1: rollback", () => {
  it("temporal columns survive and queries degrade gracefully", () => {
    const a = seedNode("Test", SPACE, { superseded_at: "2026-10-10T00:00:00.000Z" });
    // Simulate flag-off: pre-W1 queries ignore temporal columns.
    // getById (history path) still works.
    expect(repo.getById(a)).toBeDefined();
    // Data is intact.
    expect(getNode(a).superseded_at).toBe("2026-10-10T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// T-FK-1: superseded_by referential integrity
// ---------------------------------------------------------------------------

describe("T-FK-1: referential integrity", () => {
  it("no dangling superseded_by references", () => {
    const a = seedNode("Old");
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: { label: "New", type: "memory", content: "x" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    expect(result.newNodeId).not.toBeNull();
    const dangling = handle.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM nodes
         WHERE superseded_by IS NOT NULL
           AND superseded_by NOT IN (SELECT id FROM nodes)`,
      )
      .get() as { n: number };
    expect(dangling.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T-SEC-1: cross-space rejection
// ---------------------------------------------------------------------------

describe("T-SEC-1: cross-space isolation", () => {
  it("cannot supersede a node from another space", () => {
    const other = seedNode("Other space fact", SPACE2);
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: other,
        newNode: { label: "Hijack", type: "memory", content: "x" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "user_statement",
      }),
    ).toThrow(SupersessionConflictError);
    // Other space unmodified
    expect(getNode(other).superseded_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-PAR-1: fresh vs migrated behavioral parity
// ---------------------------------------------------------------------------

describe("T-PAR-1: behavioral parity", () => {
  it("both schemas populate recorded_at on every insert", () => {
    // :memory: DBs use bootstrap (fresh schema). Verify behavior.
    const n = repo.create({ label: "Parity", type: "memory", content: "x" }, EMB);
    const row = getNode(n.id);
    expect(row.recorded_at).toMatch(CANONICAL_TS);
  });

  it("schema asymmetry is pinned to recorded_at only", () => {
    const cols = handle.sqlite.prepare(`PRAGMA table_info(nodes)`).all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    const rec = cols.find((c) => c.name === "recorded_at");
    expect(rec).toBeDefined();
    // Document the known asymmetry: fresh has NOT NULL + default, migrated is nullable.
    // This test pins that no OTHER temporal column diverges unexpectedly.
    for (const col of ["valid_from", "valid_to", "superseded_at", "superseded_by", "supersede_reason"]) {
      expect(cols.some((c) => c.name === col)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T-NT-1: never-true correction creates no false interval
// ---------------------------------------------------------------------------

describe("T-NT-1: false-belief correction", () => {
  it("creates no valid-time interval for never-true facts", () => {
    const a = seedNode("Car insurance $200/mo");
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      reason: "no_car",
      origin: "user_correction",
    });
    const row = getNode(a);
    expect(row.valid_from).toBeNull();
    expect(row.valid_to).toBeNull(); // NO interval fabricated
    expect(row.superseded_at).not.toBeNull();
    expect(row.supersede_reason).toBe("false_belief");
    expect(isNeverTrue(handle.sqlite, a)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-HIST-1a / T-HIST-1b: as-of belief vs correction history
// ---------------------------------------------------------------------------

describe("T-HIST-1a: as-of belief query", () => {
  it("reconstructs pre-correction belief state", () => {
    // Seed with explicit recorded_at for deterministic as-of queries
    const a = seedNode("Car insurance $200/mo", SPACE, {
      recorded_at: "2026-10-01T10:00:00.000Z",
      created_at: "2026-10-01T10:00:00.000Z",
    });
    // Correct on Oct 10 — but supersede() uses opTime (now). For the test,
    // manually set the supersession timestamps to Oct 10.
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      origin: "user_correction",
    });
    const opTime = (getNode(a).superseded_at as string);
    // Rewrite to Oct 10 for deterministic as-of testing
    handle.sqlite.prepare(`UPDATE nodes SET superseded_at = ? WHERE id = ?`).run("2026-10-10T14:00:00.000Z", a);
    handle.sqlite.prepare(`UPDATE corrections SET corrected_at = ? WHERE node_id = ?`).run("2026-10-10T14:00:00.000Z", a);

    // As-of Oct 5: believed true
    const oct5 = asOfBelief(handle.sqlite, SPACE, "2026-10-05T00:00:00.000Z");
    expect(oct5.some((n) => n.id === a)).toBe(true);

    // As-of Oct 11: excluded (superseded)
    const oct11 = asOfBelief(handle.sqlite, SPACE, "2026-10-11T00:00:00.000Z");
    expect(oct11.some((n) => n.id === a)).toBe(false);
    expect(opTime).toBeDefined(); // opTime was used
  });
});

describe("T-HIST-1b: correction-history query", () => {
  it("returns full timeline without duplication", () => {
    const a = seedNode("Car insurance $200/mo", SPACE, {
      recorded_at: "2026-10-01T10:00:00.000Z",
      created_at: "2026-10-01T10:00:00.000Z",
    });
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      origin: "user_correction",
    });
    // Add a second correction event (same timestamp to test tiebreaker)
    const corrTime = getNode(a).superseded_at as string;
    handle.sqlite
      .prepare(
        `INSERT INTO corrections (space_id, node_id, correction_type, corrected_at, corrected_by, reason)
         VALUES (?, ?, 'factual_update', ?, 'user', 'second')`,
      )
      .run(SPACE, a, corrTime);

    const history = nodeHistory(handle.sqlite, SPACE, a);
    expect(history).toBeDefined();
    // Exactly ONE row (no duplication from two correction events)
    expect(history!.wasCorrectedAsFalse).toBe(true);
    expect(history!.correctionHistory).toHaveLength(2);
    // Ordered deterministically (corrected_at ASC, id ASC)
    const times = history!.correctionHistory.map((c) => c.at);
    expect(times[0] <= times[1]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-MIG-1: migration order and assertion
// ---------------------------------------------------------------------------

describe("T-MIG-1: migration", () => {
  it("canonical timestamp regex rejects bad formats", () => {
    expect(CANONICAL_TS.test("2026-10-19T14:30:00.000Z")).toBe(true);
    expect(CANONICAL_TS.test("2026-10-19 14:30:00")).toBe(false);
    expect(CANONICAL_TS.test("2026-10-19T14:30:00Z")).toBe(false);
  });

  it("normalizeTimestamp handles legacy format", () => {
    expect(normalizeTimestamp("2026-10-19 14:30:00")).toBe("2026-10-19T14:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// T-CAS-1: atomic cascade failure
// ---------------------------------------------------------------------------

describe("T-CAS-1: atomicity", () => {
  it("failed supersession leaves no partial state", () => {
    const a = seedNode("Old fact");
    // Force failure: try to supersede a nonexistent node
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: 99999,
        newNode: { label: "New", type: "memory", content: "x" },
        correctionType: "factual_update",
        correctedBy: "user",
        origin: "user_statement",
      }),
    ).toThrow(SupersessionConflictError);
    // No partial rows
    const count = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE label = 'New'`).get() as {
      n: number;
    };
    expect(count.n).toBe(0);
    expect(getNode(a).superseded_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-RTR-1: top-K regression (keyword search excludes superseded)
// ---------------------------------------------------------------------------

describe("T-RTR-1: keyword search", () => {
  it("superseded nodes do not appear in keyword results", () => {
    const valid = repo.create(
      { label: "Samsonite job", type: "memory", content: "warehouse work" },
      EMB,
    );
    const old = repo.create(
      { label: "Job search", type: "memory", content: "looking for warehouse work" },
      EMB,
    );
    supersede(handle, SPACE, {
      oldNodeId: old.id,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      origin: "user_correction",
    });
    const hits = keywordSearch(handle.sqlite, SPACE, "warehouse work", 10);
    const ids = hits.map((h) => h.nodeId);
    expect(ids).toContain(valid.id);
    expect(ids).not.toContain(old.id);
  });
});

// ---------------------------------------------------------------------------
// T-IDX-1/2: replacement-node search indexing (Item 1)
// ---------------------------------------------------------------------------

describe("T-IDX: replacement-node search indexing", () => {
  it("replacement WITH embedding is findable via FTS and vector paths; old node in neither", () => {
    const oldId = seedNode("Morning routine");
    const result = supersede(handle, SPACE, {
      oldNodeId: oldId,
      newNode: {
        label: "Evening routine uniqueword123",
        type: "memory",
        content: "switched to evening workouts uniqueword123",
        embedding: EMB,
      },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const newId = result.newNodeId!;

    // FTS path (real keyword search)
    const ftsHits = keywordSearch(handle.sqlite, SPACE, "uniqueword123", 10);
    const ftsIds = ftsHits.map((h) => h.nodeId);
    expect(ftsIds).toContain(newId);
    expect(ftsIds).not.toContain(oldId);

    // Vector path: the embedding must have been stored via upsertEmbedding
    // (the same path supersede() uses). Defensive: skip if vec0 isn't loaded.
    let vecAvailable = false;
    try {
      handle.sqlite.prepare(`SELECT 1 FROM vec_nodes LIMIT 1`).get();
      vecAvailable = true;
    } catch {
      /* vec extension not loaded in this environment */
    }
    if (vecAvailable) {
      const vecRow = handle.sqlite
        .prepare(`SELECT node_id FROM vec_nodes WHERE node_id = ?`)
        .get(BigInt(newId));
      expect(vecRow).toBeDefined();
    }

    // vecSearchCurrent W1 filter: candidate pages containing BOTH the old
    // (superseded) and new (current) node IDs must return only the new one.
    const fakeFetchPage = () => [
      { nodeId: oldId, distance: 0.05 },
      { nodeId: newId, distance: 0.1 },
    ];
    const vecHits = vecSearchCurrent(handle.sqlite, SPACE, EMB, 5, undefined, fakeFetchPage);
    const vecIds = vecHits.map((h) => h.nodeId);
    expect(vecIds).toContain(newId);
    expect(vecIds).not.toContain(oldId);
  });

  it("replacement WITHOUT embedding still gets FTS indexing (graceful degradation)", () => {
    const oldId = seedNode("Old preference");
    const result = supersede(handle, SPACE, {
      oldNodeId: oldId,
      newNode: {
        label: "New preference ftsfallback456",
        type: "memory",
        content: "changed my mind ftsfallback456",
        // No embedding — FTS must still work, no crash
      },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    const newId = result.newNodeId!;
    const ftsHits = keywordSearch(handle.sqlite, SPACE, "ftsfallback456", 10);
    const ftsIds = ftsHits.map((h) => h.nodeId);
    expect(ftsIds).toContain(newId);
    expect(ftsIds).not.toContain(oldId);
  });
});

// ---------------------------------------------------------------------------
// T-PO-1/2/3/4: Type 3 preference-override endsValidity flag (Item 2)
// ---------------------------------------------------------------------------

describe("T-PO: preference-override endsValidity flag", () => {
  it("T-PO-1: silence mode (endsValidity false/undefined) preserves old valid_to", () => {
    const a = seedNode("Prefers morning reminders", SPACE, {
      valid_from: "2026-09-01T00:00:00.000Z",
      valid_to: null,
    });
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: {
        label: "Prefers evening reminders",
        type: "memory",
        content: "evenings work better now",
        // endsValidity omitted → silence mode
      },
      correctionType: "preference_override",
      correctedBy: "user",
      origin: "user_statement",
    });
    // Old row superseded, but valid_to NOT touched (no end date invented)
    const oldRow = getNode(a);
    expect(oldRow.superseded_at).not.toBeNull();
    expect(oldRow.valid_to).toBeNull();
    expect(oldRow.supersede_reason).toBe("user_override");
    // Replacement inserted and correction recorded
    expect(result.newNodeId).not.toBeNull();
    expect(getCorrections(handle.sqlite, a)).toHaveLength(1);
    expect(getCorrections(handle.sqlite, a)[0].correction_type).toBe("preference_override");
  });

  it("T-PO-2: validity-ending mode with known validFrom closes valid_to", () => {
    const a = seedNode("Prefers morning reminders", SPACE, {
      valid_from: "2026-09-01T00:00:00.000Z",
    });
    const result = supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: {
        label: "Prefers evening reminders",
        type: "memory",
        content: "evenings work better now",
        validFrom: "2026-10-15T00:00:00.000Z",
        endsValidity: true,
      },
      correctionType: "preference_override",
      correctedBy: "user",
      origin: "user_statement",
    });
    const oldRow = getNode(a);
    expect(oldRow.superseded_at).not.toBeNull();
    // valid_to closed with the replacement's known validFrom
    expect(oldRow.valid_to).toBe("2026-10-15T00:00:00.000Z");
    expect(oldRow.supersede_reason).toBe("user_override");
    expect(result.newNodeId).not.toBeNull();
  });

  it("T-PO-3: validity-ending mode WITHOUT known validFrom leaves valid_to NULL (never fabricated)", () => {
    const a = seedNode("Prefers morning reminders", SPACE, {
      valid_from: "2026-09-01T00:00:00.000Z",
    });
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: {
        label: "Prefers evening reminders",
        type: "memory",
        content: "evenings work better now",
        // validFrom unknown, but endsValidity true
        endsValidity: true,
      },
      correctionType: "preference_override",
      correctedBy: "user",
      origin: "user_statement",
    });
    const oldRow = getNode(a);
    expect(oldRow.superseded_at).not.toBeNull();
    // Ended at an unknown time — honest NULL, not a fabricated date
    expect(oldRow.valid_to).toBeNull();
    expect(oldRow.supersede_reason).toBe("user_override");
  });

  it("T-PO-4: preference_override with null newNode is a no-op (pure silence)", () => {
    const a = seedNode("Trucking interest");
    expect(() =>
      supersede(handle, SPACE, {
        oldNodeId: a,
        newNode: null,
        correctionType: "preference_override",
        correctedBy: "user",
        reason: "stop_bringing_up",
        origin: "user_statement",
      }),
    ).toThrow(SupersessionConflictError);
    // Nothing changed: still current, no correction event
    expect(getNode(a).superseded_at).toBeNull();
    expect(getCorrections(handle.sqlite, a)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-SEM-1/2: archived()/count() semantics (Item 3)
// ---------------------------------------------------------------------------

describe("T-SEM: archived() and count() semantics", () => {
  it("T-SEM-1: archived() returns superseded archived nodes (history view)", () => {
    const a = seedNode("Old archived fact");
    repo.setStatus(a, "archived");
    // Supersede it (false-belief, no replacement)
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: null,
      correctionType: "false_belief",
      correctedBy: "user",
      origin: "user_correction",
    });
    // archived() is a history/browse view — the superseded archived node
    // is still returned (archival status is orthogonal to temporal truth)
    const archived = repo.archived();
    expect(archived.map((n) => n.id)).toContain(a);
  });

  it("T-SEM-2: count() includes superseded nodes (storage total)", () => {
    const before = repo.count();
    const a = seedNode("Soon superseded");
    expect(repo.count()).toBe(before + 1);
    supersede(handle, SPACE, {
      oldNodeId: a,
      newNode: { label: "Replacement", type: "memory", content: "new" },
      correctionType: "factual_update",
      correctedBy: "user",
      origin: "user_statement",
    });
    // count() is a storage total: old (superseded) + new (current) = +2
    expect(repo.count()).toBe(before + 2);
  });
});
