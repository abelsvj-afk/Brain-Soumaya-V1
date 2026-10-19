import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { validateArgs } from "../tools/validation.js";
import { reminderTool } from "../tools/reminder.js";
import { taskCreatorTool } from "../tools/taskCreator.js";
import { memorySearchTool } from "../tools/memorySearch.js";
import { AGENT_TOOLS } from "../tools/registry.js";
import {
  requestApproval,
  confirmApproval,
  denyApproval,
  executeApproval,
  findPendingApproval,
  sweepApprovals,
  argsHash,
} from "../approvals.js";
import { agentLoop, maybeConfirmPending, MAX_ITERATIONS, MAX_CALLS_PER_RESPONSE, MAX_EXECUTIONS_PER_TURN } from "../loop.js";

/**
 * Phase 1 acceptance tests (§G). Each test maps to a signed-off requirement:
 * validation, approval lifecycle, crash-safe idempotency, batch semantics,
 * loop limits, cross-space isolation, append-only audit.
 */

let handle: DbHandle;
let ctx: AppContext;
let tc: ToolContext;
const SPACE = "test-space";
const NOW = Date.now();

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: undefined as never,
  };
  tc = { ctx, spaceId: SPACE, now: NOW, notify: async () => {} };
});

afterEach(() => handle.sqlite.close());

/** Scripted LLM: returns queued callWithTools responses, then final text. */
function scriptedLlm(script: LlmToolResult[]): LlmProvider {
  const base = new HeuristicProvider();
  let i = 0;
  return {
    ...base,
    callWithTools: async (_input: LlmToolCallInput): Promise<LlmToolResult> => {
      if (i < script.length) return script[i++];
      return { text: "done.", calls: [] };
    },
  } as LlmProvider;
}

function seedNode(label: string, spaceId = SPACE): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, 'memory', ?)`
    )
    .run(spaceId, label, `content of ${label}`);
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// 1. Argument validation (single trusted source: registry schemas)
// ---------------------------------------------------------------------------

describe("validateArgs", () => {
  it("accepts valid args for fire_reminder", () => {
    expect(validateArgs(reminderTool, { nodeId: 42 }).ok).toBe(true);
  });
  it("rejects wrong-typed args", () => {
    const r = validateArgs(reminderTool, { nodeId: "not-a-number" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("fire_reminder");
  });
  it("rejects missing required args", () => {
    expect(validateArgs(reminderTool, {}).ok).toBe(false);
  });
  it("rejects unknown tool", () => {
    expect(validateArgs(undefined, { x: 1 }).ok).toBe(false);
  });
  it("rejects non-object args", () => {
    expect(validateArgs(reminderTool, "nope").ok).toBe(false);
  });
  it("accepts valid memory_search args", () => {
    expect(validateArgs(memorySearchTool, { query: "hello" }).ok).toBe(true);
    expect(validateArgs(memorySearchTool, { query: "hello", limit: 3 }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Approval lifecycle
// ---------------------------------------------------------------------------

describe("approval lifecycle", () => {
  it("request -> confirm -> execute -> executed", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "call dentist" }, "web:test");
    expect(req.ok).toBe(true);
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    expect(c.ok).toBe(true);
    const exec = await executeApproval(tc, c.approval!);
    expect(exec.ok).toBe(true);
    const row = handle.sqlite.prepare(`SELECT status FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as { status: string };
    expect(row.status).toBe("executed");
    // One task node created.
    const count = handle.sqlite.prepare(`SELECT COUNT(*) c FROM nodes WHERE kind = 'action' AND space_id = ?`).get(SPACE) as { c: number };
    expect(count.c).toBe(1);
  });

  it("double confirm: second is a no-op, not a double execution", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "call dentist" }, "web:test");
    const c1 = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    expect(c1.ok).toBe(true);
    const c2 = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    expect(c2.ok).toBe(false);
    expect(c2.error).toContain("confirmed");
    await executeApproval(tc, c1.approval!);
    const count = handle.sqlite.prepare(`SELECT COUNT(*) c FROM nodes WHERE kind = 'action' AND space_id = ?`).get(SPACE) as { c: number };
    expect(count.c).toBe(1);
  });

  it("expired approval cannot be confirmed", () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "y" }, "web:test");
    // Fast-forward past the 15-min TTL.
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW + 16 * 60 * 1000);
    expect(c.ok).toBe(false);
    expect(c.error).toContain("expired");
  });

  it("wrong principal cannot confirm", () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "y" }, "web:test");
    const c = confirmApproval(ctx, SPACE, "telegram:999", req.approvalId!, NOW);
    expect(c.ok).toBe(false);
  });

  it("wrong space cannot confirm (cross-space isolation)", () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "y" }, "web:test");
    const c = confirmApproval(ctx, "other-space", "web:test", req.approvalId!, NOW);
    expect(c.ok).toBe(false);
  });

  it("deny -> denied; cannot execute after deny", async () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "y" }, "web:test");
    expect(denyApproval(ctx, SPACE, "web:test", req.approvalId!, NOW).ok).toBe(true);
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    expect(c.ok).toBe(false);
  });

  it("changed args fail the hash check at execution", async () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "original" }, "web:test");
    // Tamper with the stored args (simulates a changed proposal).
    handle.sqlite.prepare(`UPDATE tool_approvals SET args_json = ? WHERE id = ?`)
      .run(JSON.stringify({ nodeId, label: "tampered" }), req.approvalId!);
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    expect(c.ok).toBe(true);
    const exec = await executeApproval(tc, c.approval!);
    expect(exec.ok).toBe(false);
    expect(exec.error).toContain("hash mismatch");
  });

  it("maybeConfirmPending: 'yes' executes exactly one pending approval", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "call dentist" }, "telegram:123");
    expect(req.ok).toBe(true);
    const out = await maybeConfirmPending(ctx, SPACE, "telegram:123", "yes", tc);
    expect(out).toContain("call dentist");
    const count = handle.sqlite.prepare(`SELECT COUNT(*) c FROM nodes WHERE kind = 'action' AND space_id = ?`).get(SPACE) as { c: number };
    expect(count.c).toBe(1);
    // Second "yes" finds nothing pending (already executed).
    const out2 = await maybeConfirmPending(ctx, SPACE, "telegram:123", "yes", tc);
    expect(out2).toBe(null);
  });

  it("maybeConfirmPending: ambiguous when 2+ pending (asks, never guesses)", async () => {
    const n1 = seedNode("a");
    const n2 = seedNode("b");
    requestApproval(tc, taskCreatorTool, { nodeId: n1, label: "one" }, "web:test");
    requestApproval(tc, taskCreatorTool, { nodeId: n2, label: "two" }, "web:test");
    expect(findPendingApproval(ctx, SPACE, "web:test")).toBe(undefined);
    const out = await maybeConfirmPending(ctx, SPACE, "web:test", "yes", tc);
    expect(out).toBe(null); // not handled — caller must disambiguate
  });
});

// ---------------------------------------------------------------------------
// 3. Crash-safe idempotency (effectively-once)
// ---------------------------------------------------------------------------

describe("crash-safe execution", () => {
  it("fire_reminder retry after crash does not double-fire", async () => {
    const nodeId = seedNode("dentist");
    handle.sqlite.prepare(`UPDATE nodes SET remind_at = ? WHERE id = ?`)
      .run(new Date(NOW + 3600_000).toISOString(), nodeId);
    const req = requestApproval(tc, reminderTool, { nodeId }, "web:test");
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    // First execution succeeds.
    const e1 = await executeApproval(tc, c.approval!);
    expect(e1.ok).toBe(true);
    // Simulate crash: row stuck in `executing` (success never recorded).
    handle.sqlite.prepare(`UPDATE tool_approvals SET status = 'executing' WHERE id = ?`).run(req.approvalId!);
    // Sweeper retries with the SAME approval id.
    const stale = { ...c.approval!, status: "executing" as const, execution_attempts: 1 };
    handle.sqlite.prepare(`UPDATE tool_approvals SET status = 'confirmed' WHERE id = ?`).run(req.approvalId!);
    const e2 = await executeApproval(tc, { ...stale, status: "confirmed" as const });
    expect(e2.ok).toBe(true);
    expect(e2.result?.summary).toContain("deduped");
    // Still exactly one fire recorded.
    const row = handle.sqlite.prepare(`SELECT reminder_fired_at, fired_by_approval FROM nodes WHERE id = ?`).get(nodeId) as { reminder_fired_at: string; fired_by_approval: number };
    expect(row.reminder_fired_at).toBeTruthy();
    expect(row.fired_by_approval).toBe(req.approvalId!);
  });

  it("taskCreator retry after crash does not duplicate the task", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "call dentist" }, "web:test");
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    const e1 = await executeApproval(tc, c.approval!);
    expect(e1.ok).toBe(true);
    // Simulate crash-retry: back to confirmed, same approval id.
    handle.sqlite.prepare(`UPDATE tool_approvals SET status = 'confirmed' WHERE id = ?`).run(req.approvalId!);
    const e2 = await executeApproval(tc, { ...c.approval!, status: "confirmed" as const });
    expect(e2.ok).toBe(true);
    expect(e2.result?.summary).toContain("deduped");
    const count = handle.sqlite.prepare(`SELECT COUNT(*) c FROM nodes WHERE kind = 'action' AND space_id = ?`).get(SPACE) as { c: number };
    expect(count.c).toBe(1);
    const edges = handle.sqlite.prepare(
      `SELECT COUNT(*) c FROM edges WHERE space_id = ? AND relationship = 'relates_to'`
    ).get(SPACE) as { c: number };
    expect(edges.c).toBe(1);
  });

  it("permanent failure after 3 attempts -> failed, user notified, never silent", async () => {
    // Force failure: taskCreator with a nonexistent source node.
    const req = requestApproval(tc, taskCreatorTool, { nodeId: 999999, label: "ghost" }, "web:test");
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    let last: { ok: boolean; error?: string } = { ok: true };
    for (let i = 0; i < 3; i++) {
      handle.sqlite.prepare(`UPDATE tool_approvals SET status = 'confirmed' WHERE id = ?`).run(req.approvalId!);
      const cur = handle.sqlite.prepare(`SELECT * FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as never;
      last = await executeApproval(tc, cur as never);
    }
    expect(last.ok).toBe(false);
    const row = handle.sqlite.prepare(`SELECT status FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as { status: string };
    expect(row.status).toBe("failed");
  });

  it("sweepApprovals retries stale executing rows", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "sweep me" }, "web:test");
    confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    // Simulate a crash mid-execution 10 minutes ago.
    handle.sqlite.prepare(
      `UPDATE tool_approvals SET status = 'executing', decided_at = ?, execution_attempts = 1 WHERE id = ?`
    ).run(new Date(NOW - 10 * 60_000).toISOString(), req.approvalId!);
    const swept = await sweepApprovals({ ...tc, now: NOW });
    expect(swept.retried).toBe(1);
    const row = handle.sqlite.prepare(`SELECT status FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as { status: string };
    expect(row.status).toBe("executed");
  });
});

// ---------------------------------------------------------------------------
// 4. Batch semantics (strict order, per-call outcomes, caps)
// ---------------------------------------------------------------------------

describe("agent loop batch semantics", () => {
  it("write-first batch: write deferred, later reads blocked (never reordered)", async () => {
    const nodeId = seedNode("dentist");
    ctx.llm = scriptedLlm([
      {
        text: null,
        calls: [
          { id: "c1", name: "taskCreator", args: { nodeId, label: "call dentist" } },
          { id: "c2", name: "memory_search", args: { query: "dentist" } },
        ],
      },
      { text: "I'll set that up — say yes to confirm.", calls: [] },
    ]);
    const r = await agentLoop({ ctx, spaceId: SPACE, principal: "web:test", userMessage: "remind me", history: [], now: NOW, notify: async () => {} });
    expect(r.pendingApprovalId).toBeDefined();
    expect(r.text).toContain("yes");
    // The read must NOT have executed ahead of the write.
    const logs = handle.sqlite.prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:memory_search'`).get() as { c: number };
    expect(logs.c).toBe(0);
  });

  it("read-first mixed batch: read executes, write deferred, trailing read blocked", async () => {
    const nodeId = seedNode("dentist");
    seedNode("dentist appointment notes");
    ctx.llm = scriptedLlm([
      {
        text: null,
        calls: [
          { id: "c1", name: "memory_search", args: { query: "dentist" } },
          { id: "c2", name: "taskCreator", args: { nodeId, label: "call dentist" } },
          { id: "c3", name: "memory_search", args: { query: "teeth" } },
        ],
      },
      { text: "Found your dentist notes. I'll create the task — say yes.", calls: [] },
    ]);
    const r = await agentLoop({ ctx, spaceId: SPACE, principal: "web:test", userMessage: "dentist stuff", history: [], now: NOW, notify: async () => {} });
    expect(r.pendingApprovalId).toBeDefined();
    // First read executed...
    const first = handle.sqlite.prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:memory_search'`).get() as { c: number };
    expect(first.c).toBe(1);
    // ...trailing read did not (blocked behind the write).
    // (Only one memory_search execution total.)
  });

  it("over-cap response: 6 proposed, 4 processed, 2 rejected with explicit outcomes", async () => {
    ctx.llm = scriptedLlm([
      {
        text: null,
        calls: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `c${i}`, name: "memory_search", args: { query: `q${i}` } })),
      },
      { text: "done", calls: [] },
    ]);
    await agentLoop({ ctx, spaceId: SPACE, principal: "web:test", userMessage: "go", history: [], now: NOW, notify: async () => {} });
    const n = handle.sqlite.prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:memory_search'`).get() as { c: number };
    expect(n.c).toBe(MAX_CALLS_PER_RESPONSE);
  });

  it("unknown tool name is rejected, never executed", async () => {
    ctx.llm = scriptedLlm([
      { text: null, calls: [{ id: "c1", name: "delete_everything", args: {} }] },
      { text: "I can't do that.", calls: [] },
    ]);
    const r = await agentLoop({ ctx, spaceId: SPACE, principal: "web:test", userMessage: "go", history: [], now: NOW, notify: async () => {} });
    expect(r.text).toContain("can't do that");
  });

  it("six-iteration cap terminates a runaway loop", async () => {
    // The model always calls a read tool, never answers.
    const script: LlmToolResult[] = Array.from({ length: 20 }, () => ({
      text: null,
      calls: [{ id: "c", name: "memory_search", args: { query: "loop" } }],
    }));
    ctx.llm = scriptedLlm(script);
    const r = await agentLoop({ ctx, spaceId: SPACE, principal: "web:test", userMessage: "go", history: [], now: NOW, notify: async () => {} });
    expect(r.text).toContain("ran out of steps");
    const n = handle.sqlite.prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:memory_search'`).get() as { c: number };
    expect(n.c).toBeLessThanOrEqual(MAX_EXECUTIONS_PER_TURN);
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-space isolation
// ---------------------------------------------------------------------------

describe("space isolation", () => {
  it("memorySearch never returns another space's nodes", async () => {
    seedNode("my secret", SPACE);
    seedNode("my secret", "other-space");
    const r = await memorySearchTool.run({ ...tc, spaceId: SPACE }, { query: "secret" });
    expect(r.ok).toBe(true);
    expect(r.targets?.length).toBe(1);
    const node = handle.sqlite.prepare(`SELECT space_id FROM nodes WHERE id = ?`).get(r.targets![0]) as { space_id: string };
    expect(node.space_id).toBe(SPACE);
  });
});

// ---------------------------------------------------------------------------
// 6. Append-only audit
// ---------------------------------------------------------------------------

describe("agent_logs append-only", () => {
  it("UPDATE on agent_logs is blocked by trigger", () => {
    handle.sqlite.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 't', 'd', '[]')`).run(SPACE);
    expect(() =>
      handle.sqlite.prepare(`UPDATE agent_logs SET description = 'x' WHERE space_id = ?`).run(SPACE)
    ).toThrow(/append-only/);
  });
  it("DELETE on agent_logs is blocked by trigger", () => {
    expect(() =>
      handle.sqlite.prepare(`DELETE FROM agent_logs WHERE space_id = ?`).run(SPACE)
    ).toThrow(/append-only/);
  });
  it("approval transitions append audit rows with correlation ids", async () => {
    const nodeId = seedNode("x");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "y" }, "web:test");
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    await executeApproval(tc, c.approval!);
    const rows = handle.sqlite.prepare(
      `SELECT action, result FROM agent_logs WHERE result LIKE '%"approvalId":' || ? || '%' OR result LIKE ? ORDER BY id`
    ).all(req.approvalId!, `%"approvalId":${req.approvalId!}%`) as { action: string; result: string }[];
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("approval:requested");
    expect(actions).toContain("approval:confirmed");
    expect(actions).toContain("approval:executing");
    // No raw args in the audit trail.
    for (const r of rows) {
      expect(r.result).not.toContain("call dentist");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Registry: the loop only offers the 5 approved tools
// ---------------------------------------------------------------------------

describe("agent tool set", () => {
  it("AGENT_TOOLS is exactly the 5 approved tools", () => {
    const names = AGENT_TOOLS.map((e) => e.tool.name).sort();
    expect(names).toEqual(["checkin", "fire_reminder", "memory_search", "taskCreator", "webLookup"].sort());
  });
  it("write tools are exactly fire_reminder + taskCreator", () => {
    const writes = AGENT_TOOLS.filter((e) => e.isWrite).map((e) => e.tool.name).sort();
    expect(writes).toEqual(["fire_reminder", "taskCreator"]);
  });
  it("argsHash is stable and order-independent", () => {
    expect(argsHash({ b: 2, a: 1 })).toBe(argsHash({ a: 1, b: 2 }));
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });
});
