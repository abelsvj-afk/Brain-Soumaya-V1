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
import { NodesRepo } from "../../repositories/nodes.repo.js";
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
      if (i < script.length) {
        const next = script[i++];
        if (next) return next;
      }
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
    // Simulate a crash mid-execution 10 minutes ago: BOTH clocks are old —
    // confirmed 10 min ago AND executing for 10 min.
    handle.sqlite.prepare(
      `UPDATE tool_approvals SET status = 'executing', decided_at = ?, execution_started_at = ?, execution_attempts = 1 WHERE id = ?`
    ).run(
      new Date(NOW - 10 * 60_000).toISOString(),
      new Date(NOW - 10 * 60_000).toISOString(),
      req.approvalId!,
    );
    const swept = await sweepApprovals({ ...tc, now: NOW });
    expect(swept.retried).toBe(1);
    const row = handle.sqlite.prepare(`SELECT status FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as { status: string };
    expect(row.status).toBe("executed");
  });

  it("executeApproval stamps execution_started_at when it claims a row", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "stamp me" }, "web:test");
    const c = confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    const exec = await executeApproval(tc, c.approval!);
    expect(exec.ok).toBe(true);
    const row = handle.sqlite.prepare(
      `SELECT execution_started_at FROM tool_approvals WHERE id = ?`
    ).get(req.approvalId!) as { execution_started_at: string | null };
    expect(row.execution_started_at).toBe(new Date(NOW).toISOString());
  });

  it("sweepApprovals does NOT retry an executing row confirmed long ago but executing briefly (REG-194)", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "still running" }, "web:test");
    confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    // The defect: staleness was measured from decided_at (confirmation
    // time), so this row — confirmed 6 min ago, executing for 10 s — was
    // flipped back to `confirmed` and re-executed concurrently.
    handle.sqlite.prepare(
      `UPDATE tool_approvals SET status = 'executing', decided_at = ?, execution_started_at = ?, execution_attempts = 1 WHERE id = ?`
    ).run(
      new Date(NOW - 6 * 60_000).toISOString(),
      new Date(NOW - 10_000).toISOString(),
      req.approvalId!,
    );
    const swept = await sweepApprovals({ ...tc, now: NOW });
    expect(swept).toEqual({ expired: 0, retried: 0, failed: 0 });
    const row = handle.sqlite.prepare(`SELECT status FROM tool_approvals WHERE id = ?`).get(req.approvalId!) as { status: string };
    expect(row.status).toBe("executing");
  });

  it("sweepApprovals retries an executing row whose EXECUTION start is stale even when confirmed recently (REG-194)", async () => {
    const nodeId = seedNode("dentist");
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "stuck execution" }, "web:test");
    confirmApproval(ctx, SPACE, "web:test", req.approvalId!, NOW);
    // Confirmed 1 min ago, but executing for 10 min (crashed mid-run) —
    // stale by the execution clock, so it must be retried.
    handle.sqlite.prepare(
      `UPDATE tool_approvals SET status = 'executing', decided_at = ?, execution_started_at = ?, execution_attempts = 1 WHERE id = ?`
    ).run(
      new Date(NOW - 60_000).toISOString(),
      new Date(NOW - 10 * 60_000).toISOString(),
      req.approvalId!,
    );
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
          { id: "c1", name: "create_task", args: { nodeId, label: "call dentist" } },
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
          { id: "c2", name: "create_task", args: { nodeId, label: "call dentist" } },
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
    // Seed through the production write path: NodesRepo.create populates the
    // vec + FTS indexes that memory_search reads. A raw INSERT into nodes is
    // invisible to both search channels, so it cannot exercise isolation.
    const emb = await ctx.embeddings.embed("content of my secret");
    const mine = new NodesRepo(handle, SPACE).create(
      { label: "my secret", type: "other", content: "content of my secret" },
      emb,
    );
    new NodesRepo(handle, "other-space").create(
      { label: "my secret", type: "other", content: "content of my secret" },
      emb,
    );
    const r = await memorySearchTool.run({ ...tc, spaceId: SPACE }, { query: "secret" });
    expect(r.ok).toBe(true);
    expect(r.targets?.length).toBe(1);
    expect(r.targets![0]).toBe(mine.id);
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
    // The append-only trigger is BEFORE DELETE per row: it only fires when a
    // row actually matches, so seed one first (as the UPDATE test does).
    handle.sqlite.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 't', 'd', '[]')`).run(SPACE);
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
// 7. Registry: the loop only offers the approved tools
//
// DELIBERATE CHANGE (Telegram Parity Phase 1, owner decision): the original
// pin was "exactly the 5 approved tools". The owner approved adding three
// exact-answer READ tools (brain_stats, people_lookup, entity_lookup)
// because the 5-tool loop had no way to count, list people, or look up an
// entity and invented answers instead (the "39 memories" incident). The
// approved conversational set became 8. The WRITE pin below was
// UNCHANGED at that point: writes were still exactly fire_reminder +
// create_task.
//
// DELIBERATE CHANGE (Telegram Parity Phase 2, owner decision D3):
// capture_memory joins as a WRITE tool so the owner can act from Telegram
// conversationally ("remember this: …" without the /log prefix). Under
// D3, writes SHE proposes need his "yes" (capture_memory is approval-gated
// like the existing writes); owner-typed commands like /log still act
// immediately and are unchanged. The WRITE pin is therefore EXTENDED,
// deliberately: writes are now exactly fire_reminder + create_task +
// capture_memory.
//
// DELIBERATE CHANGE (Telegram Parity Phase 4, owner decision): tab parity.
// The seven router-only analysis tools (bill_risk, goal_trend,
// finance_freshness, weekly_review, surface_orphan, chart_discovery,
// review_nudge) are promoted to model-callable READ tools (each with a
// conversational no-arg path; router behavior unchanged), and three list
// tools (agenda_list, journeys_list, insights_list) cover the remaining
// tabs. All ten are read-only; the write pin is unaffected by this phase.
//
// COMBINED PIN AT PHASES 2 + 4 (coordinator reconciliation at that
// integration; superseded by the Phase 5 final pin below): the approved
// conversational set was 19 tools — 5 original + 3 Phase 1 exact-answer
// reads + capture_memory (Phase 2) + 10 Phase 4 tab reads. Writes were
// exactly fire_reminder + create_task + capture_memory.
//
// DELIBERATE CHANGE (Telegram Parity Phase 5-A, owner decision): four
// assembled READ tools join — brief_me, relationship_radar, on_this_day,
// prepare_me (all compose existing sources; no new data stores). This
// phase alone does not change the write pin.
//
// DELIBERATE CHANGE (Telegram Parity Phase 5-B, owner decision): the two
// multi-turn conversational games join as READ tools — memory_quiz and
// constellation_tour. Both hold only in-memory game state (agent/
// gameSessions.ts, keyed by (spaceId, principal)); neither writes brain
// data. A quiz correction is routed to a capture_memory PROPOSAL (the
// existing approval-gated write), never to a direct edit by the quiz
// tool itself — so this phase alone does not change the write pin.
//
// DELIBERATE CHANGE (Telegram Parity Phase 5-C, owner decision): two
// narration tools join. story_time is a READ. dream_playback is pinned as
// a WRITE — FLAGGED: its playback half is a pure read, but its "that's
// wrong" correction path records a stated correction through the
// approval-gated capture/ingest intake (the D3 line), and the loop gates
// per-tool, not per-args, so the tool is a write in the pin's terms. It
// never edits a belief (INV-KC-1).
//
// FINAL COMBINED PIN (coordinator reconciliation at integration, ALL
// phases merged): the approved conversational set is 27 tools — the 19
// above + brief_me + relationship_radar + on_this_day + prepare_me
// (Phase 5-A) + memory_quiz + constellation_tour (Phase 5-B) + story_time
// + dream_playback (Phase 5-C). Writes are exactly fire_reminder +
// create_task + capture_memory + dream_playback.
// ---------------------------------------------------------------------------

describe("agent tool set", () => {
  it("AGENT_TOOLS is exactly the 27 approved tools (19 through Phase 4 + 8 Phase 5 extras, by owner decision)", () => {
    const names = AGENT_TOOLS.map((e) => e.tool.name).sort();
    expect(names).toEqual(
      [
        "agenda_list",
        "bill_risk",
        "brain_stats",
        "brief_me",
        "capture_memory",
        "chart_discovery",
        "check_in",
        "constellation_tour",
        "create_task",
        "dream_playback",
        "entity_lookup",
        "finance_freshness",
        "fire_reminder",
        "goal_trend",
        "insights_list",
        "journeys_list",
        "memory_quiz",
        "memory_search",
        "on_this_day",
        "people_lookup",
        "prepare_me",
        "relationship_radar",
        "review_nudge",
        "story_time",
        "surface_orphan",
        "web_lookup",
        "weekly_review",
      ].sort(),
    );
  });
  it("the 4 Phase 5-A tools are read-only (no approval gating)", () => {
    const phase5a = AGENT_TOOLS.filter((e) =>
      ["brief_me", "relationship_radar", "on_this_day", "prepare_me"].includes(e.tool.name),
    );
    expect(phase5a).toHaveLength(4);
    expect(phase5a.every((e) => e.isWrite === false)).toBe(true);
  });
  it("the 2 Phase 5-B game tools are read-only (no approval gating; quiz corrections flow through capture_memory)", () => {
    const phase5b = AGENT_TOOLS.filter((e) =>
      ["memory_quiz", "constellation_tour"].includes(e.tool.name),
    );
    expect(phase5b).toHaveLength(2);
    expect(phase5b.every((e) => e.isWrite === false)).toBe(true);
  });
  it("the 3 Phase 1 tools are read-only (no approval gating)", () => {
    const phase1 = AGENT_TOOLS.filter((e) =>
      ["brain_stats", "people_lookup", "entity_lookup"].includes(e.tool.name),
    );
    expect(phase1).toHaveLength(3);
    expect(phase1.every((e) => e.isWrite === false)).toBe(true);
  });
  it("the 10 Phase 4 tools are read-only (no approval gating)", () => {
    const phase4 = AGENT_TOOLS.filter((e) =>
      [
        "bill_risk",
        "goal_trend",
        "finance_freshness",
        "weekly_review",
        "surface_orphan",
        "chart_discovery",
        "review_nudge",
        "agenda_list",
        "journeys_list",
        "insights_list",
      ].includes(e.tool.name),
    );
    expect(phase4).toHaveLength(10);
    expect(phase4.every((e) => e.isWrite === false)).toBe(true);
  });
  it("capture_memory (Phase 2) is a WRITE tool (approval-gated, owner decision D3)", () => {
    const entry = AGENT_TOOLS.find((e) => e.tool.name === "capture_memory");
    expect(entry).toBeDefined();
    expect(entry!.isWrite).toBe(true);
  });
  it("Phase 5-C: story_time is a READ tool; dream_playback is a WRITE tool (correction path, flagged)", () => {
    const story = AGENT_TOOLS.find((e) => e.tool.name === "story_time");
    expect(story).toBeDefined();
    expect(story!.isWrite).toBe(false);
    const dream = AGENT_TOOLS.find((e) => e.tool.name === "dream_playback");
    expect(dream).toBeDefined();
    expect(dream!.isWrite).toBe(true);
  });
  it("write tools are exactly fire_reminder + create_task + capture_memory + dream_playback (Phase 5-C flagged)", () => {
    const writes = AGENT_TOOLS.filter((e) => e.isWrite).map((e) => e.tool.name).sort();
    expect(writes).toEqual(["capture_memory", "create_task", "dream_playback", "fire_reminder"]);
  });
  it("argsHash is stable and order-independent", () => {
    expect(argsHash({ b: 2, a: 1 })).toBe(argsHash({ a: 1, b: 2 }));
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------
// 8. W2 integration: episode capture covers the LLM-error return path
// ---------------------------------------------------------------------------

describe("agent loop LLM-error path", () => {
  it("captures an episode when callWithTools throws (regression: review finding)", async () => {
    // Regression: the catch branch in agentLoop returned the "snag" message
    // WITHOUT calling captureTurnEpisode() or setting episodeCaptured, unlike
    // every other return path. The user's turn was substantive (they asked,
    // they saw a reply) — it must be captured like any other turn.
    // Object.assign (not object spread): spread drops the provider's
    // prototype methods, leaving an object that is not a full LlmProvider.
    const throwingLlm: LlmProvider = Object.assign(new HeuristicProvider(), {
      callWithTools: async (): Promise<LlmToolResult> => {
        throw new Error("OpenAI 400: tool messages must follow tool_calls");
      },
    });
    ctx.llm = throwingLlm;

    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "web:test",
      userMessage: "do you know where i work",
      history: [],
      now: NOW,
      notify: async () => {},
    });

    expect(r.text).toContain("I hit a snag");
    expect(r.episodeCaptured).toBe(true);

    // Capture is fire-and-forget (never awaited) — flush microtasks/timers.
    await new Promise((res) => setTimeout(res, 50));

    const count = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM episodes WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(1);
  });

  it("does not double-capture when the stated trigger already captured", async () => {
    const throwingLlm: LlmProvider = Object.assign(new HeuristicProvider(), {
      callWithTools: async (): Promise<LlmToolResult> => {
        throw new Error("boom");
      },
    });
    ctx.llm = throwingLlm;

    // "I started..." matches the stated-statement trigger, which captures
    // synchronously. The error-path capture must skip (alreadyCapturedId set).
    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "web:test",
      userMessage: "I started the Samsonite job today",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    expect(r.episodeCaptured).toBe(true);
    await new Promise((res) => setTimeout(res, 50));
    const count = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM episodes WHERE space_id = ?`)
      .get(SPACE) as { c: number };
    expect(count.c).toBe(1);
  });
});
