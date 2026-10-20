import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import {
  associativeLink,
  mapWithConcurrency,
  type AssociativeLinkOptions,
} from "../ingestion/associativeLink.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { ResilientLlmProvider } from "../llm/resilient.js";
import type {
  LlmProvider,
  LinkCandidate,
  LinkValidation,
  ExtractionResult,
  ContradictionResult,
  ClarificationInterpretation,
  AnswerResult,
} from "../llm/adapter.js";
import type { GraphNode } from "@brain/shared";

/**
 * D4 (docs/repairs/galaxy-populate-render-stall.md §4.4): parallel
 * associative-link validation with slot reservation, 30s abortable timeout,
 * and the ≤6 aggregate bound.
 *
 * `knn` is mocked (vector search needs the sqlite-vec native binding); the
 * reservation / release / timeout / abort machinery under test is all in
 * `associativeLink` itself.
 *
 * NOTE: these tests need the better-sqlite3 native binding and do not run in
 * environments without it (see the implementation report).
 */

const mockKnn = vi.fn();
vi.mock("../db/vec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/vec.js")>();
  return {
    ...actual,
    knn: (...args: unknown[]) => mockKnn(...args),
  };
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- controllable fake LLM ---------- */

type ValidateBehavior = (
  callIndex: number,
  signal: AbortSignal | undefined,
) => Promise<LinkValidation>;

class FakeLinkLlm implements LlmProvider {
  readonly available = true;
  readonly model = "fake-link";
  inFlight = 0;
  maxInFlight = 0;
  signals: (AbortSignal | undefined)[] = [];
  abortsObserved = 0;

  constructor(private behavior: ValidateBehavior) {}

  async validateLink(
    _s: LinkCandidate,
    _t: LinkCandidate,
    _similarity: number,
    opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const signal = opts?.signal;
    this.signals.push(signal);
    signal?.addEventListener("abort", () => {
      this.abortsObserved++;
    });
    try {
      return await this.behavior(this.signals.length - 1, signal);
    } finally {
      this.inFlight--;
    }
  }

  async extract(): Promise<ExtractionResult> {
    throw new Error("not stubbed");
  }
  async synthesize(): Promise<{ text: string; score: number }> {
    throw new Error("not stubbed");
  }
  async detectContradiction(): Promise<ContradictionResult> {
    throw new Error("not stubbed");
  }
  async interpretClarificationAnswer(): Promise<ClarificationInterpretation> {
    throw new Error("not stubbed");
  }
  async answer(): Promise<AnswerResult> {
    throw new Error("not stubbed");
  }
  async research(): Promise<{ label: string; content: string; questions?: string[] }> {
    throw new Error("not stubbed");
  }
  async summarizeSector(): Promise<string> {
    throw new Error("not stubbed");
  }
  async generateDailyLog(): Promise<string> {
    throw new Error("not stubbed");
  }
}

/* ---------- setup ---------- */

function setupDb(nodeCount: number): { handle: DbHandle; newNode: GraphNode; ids: number[] } {
  const handle = createDb(":memory:");
  const ids: number[] = [];
  handle.sqlite.transaction(() => {
    for (let i = 0; i < nodeCount; i++) {
      const info = handle.sqlite
        .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES ('test-space', ?, 'memory', 'c')")
        .run(`n${i}`);
      ids.push(Number(info.lastInsertRowid));
    }
  })();
  const newId = Number(
    handle.sqlite
      .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES ('test-space', 'new', 'memory', 'new memory')")
      .run().lastInsertRowid,
  );
  const newNode: GraphNode = { id: newId, label: "new", type: "other", content: "new memory", createdAt: "2026-01-01T00:00:00.000Z" };
  return { handle, newNode, ids };
}

function deps(handle: DbHandle, llm: LlmProvider) {
  return {
    nodes: new NodesRepo(handle, "test-space"),
    edges: new EdgesRepo(handle, "test-space"),
    llm,
  };
}

const baseOpts: AssociativeLinkOptions = { threshold: 0.5, k: 12, maxLinks: 3 };

beforeEach(() => {
  mockKnn.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------- per-node cap under concurrency ---------- */

describe("D4 per-node validation cap", () => {
  it("never exceeds maxLinks under out-of-order completion; concurrency ≤ 3", async () => {
    const { handle, newNode, ids } = setupDb(10);
    try {
      mockKnn.mockReturnValue(ids.map((id, i) => ({ nodeId: id, similarity: 0.9 - i * 0.01 })));
      const llm = new FakeLinkLlm(async () => {
        await sleep(Math.random() * 25); // randomized: completion order ≠ dispatch order
        return { linked: true, relationship: "relates_to", weight: 0.9 };
      });
      const created = await associativeLink(handle, deps(handle, llm), newNode, new Float32Array(8), baseOpts);
      // Exactly maxLinks created; only maxLinks validations dispatched (rest withheld).
      expect(created).toHaveLength(3);
      expect(llm.signals).toHaveLength(3);
      // Physical per-node concurrency bound held.
      expect(llm.maxInFlight).toBeLessThanOrEqual(3);
      // Every dispatched validation received a live AbortSignal.
      for (const s of llm.signals) expect(s).toBeInstanceOf(AbortSignal);
    } finally {
      handle.sqlite.close();
    }
  });

  it("interleaved positive completions never exceed the cap", async () => {
    const { handle, newNode, ids } = setupDb(8);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.95 })));
      const llm = new FakeLinkLlm(async (i) => {
        // Reverse-order-ish delays: later dispatches finish first.
        await sleep((8 - i) * 5);
        return { linked: true, relationship: "relates_to", weight: 0.9 };
      });
      const created = await associativeLink(handle, deps(handle, llm), newNode, new Float32Array(8), baseOpts);
      expect(created).toHaveLength(3);
    } finally {
      handle.sqlite.close();
    }
  });

  it("a larger maxLinks still respects concurrency 3", async () => {
    const { handle, newNode, ids } = setupDb(8);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.95 })));
      const llm = new FakeLinkLlm(async () => {
        await sleep(Math.random() * 15);
        return { linked: true, relationship: "relates_to", weight: 0.9 };
      });
      const created = await associativeLink(handle, deps(handle, llm), newNode, new Float32Array(8), {
        ...baseOpts,
        maxLinks: 8,
      });
      expect(created).toHaveLength(8);
      expect(llm.maxInFlight).toBeLessThanOrEqual(3);
    } finally {
      handle.sqlite.close();
    }
  });
});

/* ---------- failure semantics ---------- */

describe("D4 failure semantics", () => {
  it("failure injection releases all slots; ingest completes; failures are not-linked", async () => {
    const { handle, newNode, ids } = setupDb(6);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.9 })));
      const llm = new FakeLinkLlm(async (i) => {
        await sleep(5);
        if (i % 2 === 0) throw new Error(`boom ${i}`);
        return { linked: true, relationship: "relates_to", weight: 0.9 };
      });
      // Must resolve (no hang, no throw): one bad call never aborts the ingest.
      const created = await associativeLink(handle, deps(handle, llm), newNode, new Float32Array(8), baseOpts);
      expect(llm.signals).toHaveLength(3);
      // Only the non-throwing validations could link; cap still holds.
      expect(created.length).toBeLessThanOrEqual(3);
      // Failed pairs left no edges.
      const edges = new EdgesRepo(handle, "test-space").within([newNode.id, ...ids]);
      expect(edges.length).toBe(created.length);
    } finally {
      handle.sqlite.close();
    }
  });

  it("persistence failure: create-before-account keeps accounting exact (regression)", async () => {
    // Regression test for the implementation-review finding: the OLD ordering
    // (reserved--; regularLinks++; edges.create(...)) double-released the
    // reservation and phantom-counted regularLinks when create() threw.
    // This test FAILS against that ordering and passes with create-before-account.
    const { handle, newNode, ids } = setupDb(6);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.9 })));
      const llm = new FakeLinkLlm(async () => ({ linked: true, relationship: "relates_to", weight: 0.9 }));
      const d = deps(handle, llm);
      // The FIRST edge persistence throws; the rest succeed.
      const origCreate = d.edges.create.bind(d.edges);
      let calls = 0;
      vi.spyOn(d.edges, "create").mockImplementation((input) => {
        calls++;
        if (calls === 1) throw new Error("persistence boom");
        return origCreate(input);
      });
      let finalAccounting: { reserved: number; regularLinks: number } | undefined;
      // Must resolve (no hang, no unhandled rejection): the persistence
      // failure is contained and the ingest continues.
      const created = await associativeLink(handle, d, newNode, new Float32Array(8), {
        ...baseOpts,
        maxLinks: 3,
        accountingProbe: (a) => {
          finalAccounting = a;
        },
      });
      expect(calls).toBe(3);
      // Only real edges are returned and persisted; subsequent candidates
      // still fill the cap correctly (2 real links, not 3).
      expect(created).toHaveLength(2);
      const edges = new EdgesRepo(handle, "test-space").within([newNode.id, ...ids]);
      expect(edges).toHaveLength(2);
      // (a) reservation released exactly once → back to baseline;
      // (b) no phantom regularLinks for the uncreated edge.
      // OLD code produced { reserved: -1, regularLinks: 3 } here.
      expect(finalAccounting).toEqual({ reserved: 0, regularLinks: 2 });
    } finally {
      handle.sqlite.close();
    }
  });

  it("per-node isolation: a failing node does not affect its sibling", async () => {    const { handle, newNode, ids } = setupDb(6);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.9 })));
      const failing = new FakeLinkLlm(async () => {
        throw new Error("always");
      });
      const succeeding = new FakeLinkLlm(async () => ({ linked: true, relationship: "relates_to", weight: 0.9 }));
      const r1 = await associativeLink(handle, deps(handle, failing), newNode, new Float32Array(8), baseOpts);
      expect(r1).toHaveLength(0);
      // A real second node (FK constraints require inserted nodes).
      const newId2 = Number(
        handle.sqlite
          .prepare("INSERT INTO nodes (space_id, label, type, content) VALUES ('test-space', 'new2', 'memory', 'c')")
          .run().lastInsertRowid,
      );
      const newNode2: GraphNode = { id: newId2, label: "new2", type: "other", content: "c", createdAt: "2026-01-01T00:00:00.000Z" };
      const r2 = await associativeLink(handle, deps(handle, succeeding), newNode2, new Float32Array(8), baseOpts);
      expect(r2).toHaveLength(3);
    } finally {
      handle.sqlite.close();
    }
  });
});

/* ---------- timeout cancellation ---------- */

describe("D4 timeout cancellation", () => {
  it("aborts the underlying work: signal observed + work halted", async () => {
    const { handle, newNode, ids } = setupDb(4);
    try {
      mockKnn.mockReturnValue(ids.map((id) => ({ nodeId: id, similarity: 0.9 })));
      let halted = 0;
      // Simulates a hung provider that honors abort, the way fetch does: the
      // promise never settles on its own; the abort listener stops the work.
      const llm = new FakeLinkLlm(
        (_i, signal) =>
          new Promise<LinkValidation>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              halted++;
              reject(new Error("aborted"));
            });
          }),
      );
      const created = await associativeLink(handle, deps(handle, llm), newNode, new Float32Array(8), {
        ...baseOpts,
        validateTimeoutMs: 50,
      });
      expect(created).toHaveLength(0);
      // All three dispatched validations observed the abort and halted.
      expect(llm.abortsObserved).toBe(3);
      expect(halted).toBe(3);
    } finally {
      handle.sqlite.close();
    }
  });

  it("resilient wrapper aborts the primary on its own timeout (no orphaned fetch)", async () => {
    let primaryHalted = false;
    const hanging: LlmProvider = new FakeLinkLlm(
      (_i, signal) =>
        new Promise<LinkValidation>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            primaryHalted = true;
            reject(new Error("aborted"));
          });
        }),
    );
    // 50ms resilient timeout — far below any test's patience.
    const resilient = new ResilientLlmProvider(hanging, 10 * 60_000, 50);
    const s: LinkCandidate = { label: "a", content: "a" };
    const t: LinkCandidate = { label: "b", content: "b" };
    // Resolves via the offline heuristic fallback after aborting the primary.
    const res = await resilient.validateLink(s, t, 0.9);
    expect(typeof res.linked).toBe("boolean");
    expect(primaryHalted).toBe(true);
  });
});

/* ---------- aggregate bound ---------- */

describe("D4 aggregate bound", () => {
  it("mapWithConcurrency holds the physical in-flight bound under stress", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const jobs = Array.from(
      { length: 60 },
      (_, i) => async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await sleep(Math.random() * 10);
        inFlight--;
        return i;
      },
    );
    const results = await mapWithConcurrency(jobs, 6, (j) => j());
    expect(results).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(maxInFlight).toBeLessThanOrEqual(6);
    // Bound is structural: with 60 jobs and limit 6 it must actually parallelize.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("composition: pipeline (2 jobs) × associativeLink (3 validations) ≤ 6", async () => {
    // Structural argument, verified by the two worker-pool limits:
    // pipeline.ts dispatches associativeLink via mapWithConcurrency(nodes, 2),
    // associativeLink dispatches validateLink via mapWithConcurrency(jobs, 3).
    // This test pins the per-node half of the composition under stress.
    let inFlight = 0;
    let maxInFlight = 0;
    const mkNode = (n: number) => async () => {
      const jobs = Array.from(
        { length: 9 },
        () => async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(Math.random() * 8);
          inFlight--;
        },
      );
      await mapWithConcurrency(jobs, 3, (j) => j());
      return n;
    };
    await mapWithConcurrency([0, 1], 2, (n) => mkNode(n)());
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(3); // both levels actually parallelize
  });
});
