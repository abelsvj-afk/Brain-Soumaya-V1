import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import type { LlmProvider, LlmLoopMessage, LlmToolCallInput, LlmToolResult } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { validateArgs } from "../tools/validation.js";
import { captureMemoryTool } from "../tools/captureMemory.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { AGENT_TOOLS, TOOLS } from "../tools/registry.js";
import {
  requestApproval,
  confirmApproval,
  executeApproval,
} from "../approvals.js";
import { agentLoop, maybeConfirmPending, getAgentTool } from "../loop.js";

/**
 * Telegram Parity Phase 2 — conversational capture + resolve-then-act
 * (findings §7 Phase 2; owner decision D3).
 *
 * FALSIFICATION BY CONSTRUCTION: every test here exercises capture_memory.
 * On the pre-Phase-2 code that module does not exist, AGENT_TOOLS holds 8
 * tools with writes exactly fire_reminder + create_task, and the loop has
 * no conversational capture path at all (only the owner-typed /log command
 * ingests) — this suite cannot even be collected there.
 *
 * D3 approval line under test: a capture SHE proposes writes NOTHING until
 * the owner says "yes"; a "no" writes nothing ever; owner-typed /log (the
 * immediate command path) is untouched by this phase and not tested here.
 */

let handle: DbHandle;
let ctx: AppContext;
let tc: ToolContext;
const SPACE = "parity2-space";
const OTHER = "parity2-other-space";
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

function seedNode(label: string, opts: { kind?: string; type?: string; content?: string; remindAt?: string } = {}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, kind, remind_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(SPACE, label, opts.type ?? "memory", opts.content ?? `content of ${label}`, opts.kind ?? null, opts.remindAt ?? null);
  return Number(r.lastInsertRowid);
}

/** Object.assign (not spread): spread drops the provider's prototype
 *  methods (extract!), which capture execution depends on. */
function providerWith(callWithTools: (input: LlmToolCallInput) => Promise<LlmToolResult>): LlmProvider {
  return Object.assign(new HeuristicProvider(), { callWithTools }) as LlmProvider;
}

function lastToolResult(input: LlmToolCallInput, name: string): string {
  const msg = [...input.messages]
    .reverse()
    .find((m): m is Extract<LlmLoopMessage, { role: "tool" }> => m.role === "tool" && m.name === name);
  if (!msg) throw new Error(`no tool result for ${name} in loop messages`);
  return msg.result;
}

// ---------------------------------------------------------------------------
// capture_memory — registration, schema, guidance
// ---------------------------------------------------------------------------

describe("capture_memory registration & guidance", () => {
  it("is registered as a WRITE tool in AGENT_TOOLS and in the full TOOLS registry (approval execution resolves it there)", () => {
    expect(getAgentTool("capture_memory")).toBe(captureMemoryTool);
    expect(AGENT_TOOLS.find((e) => e.tool.name === "capture_memory")?.isWrite).toBe(true);
    expect(TOOLS.find((t) => t.name === "capture_memory")).toBe(captureMemoryTool);
  });

  it("is loop-only: detect() never proposes it to the deterministic router", () => {
    expect(captureMemoryTool.detect(tc)).toEqual([]);
  });

  it("description makes the conversational trigger clear and demands a quote-back on propose", () => {
    const d = captureMemoryTool.description;
    expect(d).toContain("remember this");
    expect(d).toContain("save this");
    expect(d).toContain("note that");
    expect(d).toMatch(/quote back/i);
    expect(d).toMatch(/never claim it is saved until the user confirms/i);
  });

  it("validates args: text is a required string", () => {
    expect(validateArgs(captureMemoryTool, { text: "call mom on Sunday" }).ok).toBe(true);
    expect(validateArgs(captureMemoryTool, {}).ok).toBe(false);
    expect(validateArgs(captureMemoryTool, { text: 42 }).ok).toBe(false);
  });

  it("rejects empty capture text at run time", async () => {
    const r = await captureMemoryTool.run(tc, { text: "   " });
    expect(r.ok).toBe(false);
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// capture_memory — approval lifecycle (D3: propose writes nothing)
// ---------------------------------------------------------------------------

describe("capture_memory approval lifecycle", () => {
  it("request -> confirm -> execute ingests into the space, assertable via NodesRepo", async () => {
    const req = requestApproval(tc, captureMemoryTool, { text: "The landlord raised the rent starting November" }, "telegram:7");
    expect(req.ok).toBe(true);
    // Proposed only — nothing written yet.
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);

    const c = confirmApproval(ctx, SPACE, "telegram:7", req.approvalId!, NOW);
    expect(c.ok).toBe(true);
    const exec = await executeApproval(tc, c.approval!);
    expect(exec.ok).toBe(true);
    expect(exec.result?.message).toContain("Saved");

    const nodes = new NodesRepo(handle, SPACE).all();
    expect(nodes).toHaveLength(1);
    // Heuristic extraction keeps the user's text as the node content, verbatim.
    expect(nodes[0]!.content).toBe("The landlord raised the rent starting November");
  });

  it("crash-retry of the same approval does not ingest a duplicate", async () => {
    const req = requestApproval(tc, captureMemoryTool, { text: "Dentist appointment moved to Friday" }, "telegram:7");
    const c = confirmApproval(ctx, SPACE, "telegram:7", req.approvalId!, NOW);
    const e1 = await executeApproval(tc, c.approval!);
    expect(e1.ok).toBe(true);
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(1);

    // Simulate crash-retry: back to confirmed, SAME approval id.
    handle.sqlite.prepare(`UPDATE tool_approvals SET status = 'confirmed' WHERE id = ?`).run(req.approvalId!);
    const e2 = await executeApproval(tc, { ...c.approval!, status: "confirmed" as const });
    expect(e2.ok).toBe(true);
    expect(e2.result?.summary).toContain("deduped");
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(1);
  });

  it("a capture approved in one space never lands in another", async () => {
    const req = requestApproval(tc, captureMemoryTool, { text: "space A only fact" }, "telegram:7");
    const c = confirmApproval(ctx, SPACE, "telegram:7", req.approvalId!, NOW);
    await executeApproval(tc, c.approval!);
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(1);
    expect(new NodesRepo(handle, OTHER).all()).toHaveLength(0);
    // And the approval itself cannot be confirmed from the other space.
    const req2 = requestApproval(tc, captureMemoryTool, { text: "second fact" }, "telegram:7");
    expect(confirmApproval(ctx, OTHER, "telegram:7", req2.approvalId!, NOW).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capture_memory — through the loop (propose → yes / no)
// ---------------------------------------------------------------------------

describe("capture_memory through the agent loop", () => {
  function captureLlm(captureText: string): LlmProvider {
    let i = 0;
    return providerWith(async () => {
      i++;
      if (i === 1) {
        return { text: null, calls: [{ id: "c1", name: "capture_memory", args: { text: captureText } }] };
      }
      return { text: `I'll save this: "${captureText}" — say "yes" to confirm.`, calls: [] };
    });
  }

  it("proposing writes NOTHING; the owner's 'yes' ingests it into the right space", async () => {
    const text = "Mom's surgery is scheduled for Tuesday morning";
    ctx.llm = captureLlm(text);
    const r = await agentLoop({
      ctx, spaceId: SPACE, principal: "telegram:7",
      userMessage: `remember this: ${text}`, history: [], now: NOW, notify: async () => {},
    });
    expect(r.pendingApprovalId).toBeDefined();
    expect(r.text).toContain(text); // the proposal quotes back what will be saved
    // D3: the proposal alone must not have written anything.
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);
    const approval = handle.sqlite
      .prepare(`SELECT tool, args_json FROM tool_approvals WHERE id = ?`)
      .get(r.pendingApprovalId!) as { tool: string; args_json: string };
    expect(approval.tool).toBe("capture_memory");
    expect(JSON.parse(approval.args_json)).toEqual({ text });

    const out = await maybeConfirmPending(ctx, SPACE, "telegram:7", "yes", tc);
    expect(out).toContain("Saved");
    const nodes = new NodesRepo(handle, SPACE).all();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.content).toBe(text);
    expect(new NodesRepo(handle, OTHER).all()).toHaveLength(0);
  });

  it("the owner's 'no' writes nothing, ever", async () => {
    const text = "A fact that must not be saved";
    ctx.llm = captureLlm(text);
    const r = await agentLoop({
      ctx, spaceId: SPACE, principal: "telegram:7",
      userMessage: `remember this: ${text}`, history: [], now: NOW, notify: async () => {},
    });
    expect(r.pendingApprovalId).toBeDefined();
    const out = await maybeConfirmPending(ctx, SPACE, "telegram:7", "no", tc);
    expect(out).toContain("won't do that");
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolve-then-act chains (Phase 1 lookups feed Phase 2 writes)
//
// The model previously could not act on "the landlord memory": both write
// tools need a node id, and nothing could resolve a description to one.
// These tests drive the REAL loop with a model that reads the lookup's
// tool result, extracts the id from it, and proposes the write against
// THAT id — then the owner's "yes" must execute against the same node.
// ---------------------------------------------------------------------------

describe("resolve-then-act chains", () => {
  it("entity_lookup (by label) → create_task against the resolved id → approval executes against that node", async () => {
    const landlordId = seedNode("Landlord lease renewal", {
      content: "The landlord wants to renew the lease; rent discussion pending.",
    });

    let stage = 0;
    ctx.llm = providerWith(async (input) => {
      stage++;
      if (stage === 1) {
        return { text: null, calls: [{ id: "r1", name: "entity_lookup", args: { label: "Landlord lease renewal" } }] };
      }
      if (stage === 2) {
        // The model resolves the id from the lookup's own output.
        const result = lastToolResult(input, "entity_lookup");
        const m = /ENTITY #(\d+):/.exec(result);
        if (!m) throw new Error("entity_lookup result carried no id");
        return {
          text: null,
          calls: [{ id: "a1", name: "create_task", args: { nodeId: Number(m[1]), label: "Call the landlord about the lease" } }],
        };
      }
      return { text: "Found the landlord memory. I'll create that task — say \"yes\" to confirm.", calls: [] };
    });

    const r = await agentLoop({
      ctx, spaceId: SPACE, principal: "telegram:7",
      userMessage: "make a task about the landlord memory", history: [], now: NOW, notify: async () => {},
    });
    expect(r.pendingApprovalId).toBeDefined();
    // The lookup really ran, and the write was proposed against ITS id.
    const lookupLogs = handle.sqlite
      .prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:entity_lookup'`)
      .get() as { c: number };
    expect(lookupLogs.c).toBe(1);
    const approval = handle.sqlite
      .prepare(`SELECT tool, args_json FROM tool_approvals WHERE id = ?`)
      .get(r.pendingApprovalId!) as { tool: string; args_json: string };
    expect(approval.tool).toBe("create_task");
    expect(JSON.parse(approval.args_json)).toEqual({ nodeId: landlordId, label: "Call the landlord about the lease" });
    // Nothing acted yet — the task does not exist before the "yes".
    expect(handle.sqlite.prepare(`SELECT COUNT(*) c FROM nodes WHERE kind = 'action'`).get() as { c: number }).toMatchObject({ c: 0 });

    const out = await maybeConfirmPending(ctx, SPACE, "telegram:7", "yes", tc);
    expect(out).toContain("Call the landlord about the lease");
    // The executed action is linked (relates_to) to the RESOLVED node.
    const edge = handle.sqlite
      .prepare(
        `SELECT a.id AS actionId FROM edges e JOIN nodes a ON a.id = e.source
         WHERE e.space_id = ? AND e.target = ? AND e.relationship = 'relates_to' AND a.kind = 'action'`,
      )
      .get(SPACE, landlordId) as { actionId: number } | undefined;
    expect(edge).toBeDefined();
  });

  it("people_lookup (role query 'father') → fire_reminder against the resolved person id", async () => {
    const fatherId = seedNode("Marcus Vale", {
      kind: "person_entity",
      type: "person",
      content: "Marcus is the owner's father. He raised the owner and lives nearby.",
      remindAt: new Date(NOW).toISOString(),
    });

    let stage = 0;
    ctx.llm = providerWith(async (input) => {
      stage++;
      if (stage === 1) {
        return { text: null, calls: [{ id: "r1", name: "people_lookup", args: { query: "father" } }] };
      }
      if (stage === 2) {
        const result = lastToolResult(input, "people_lookup");
        const m = /- #(\d+) Marcus Vale/.exec(result);
        if (!m) throw new Error("people_lookup result carried no father id");
        return { text: null, calls: [{ id: "a1", name: "fire_reminder", args: { nodeId: Number(m[1]) } }] };
      }
      return { text: "Found your father. I'll fire that reminder — say \"yes\" to confirm.", calls: [] };
    });

    const r = await agentLoop({
      ctx, spaceId: SPACE, principal: "telegram:7",
      userMessage: "fire the reminder on my father's entry", history: [], now: NOW, notify: async () => {},
    });
    expect(r.pendingApprovalId).toBeDefined();
    const approval = handle.sqlite
      .prepare(`SELECT tool, args_json FROM tool_approvals WHERE id = ?`)
      .get(r.pendingApprovalId!) as { tool: string; args_json: string };
    expect(approval.tool).toBe("fire_reminder");
    expect(JSON.parse(approval.args_json)).toEqual({ nodeId: fatherId });
    // Not fired before the "yes".
    const before = handle.sqlite.prepare(`SELECT reminder_fired_at FROM nodes WHERE id = ?`).get(fatherId) as { reminder_fired_at: string | null };
    expect(before.reminder_fired_at).toBeNull();

    const out = await maybeConfirmPending(ctx, SPACE, "telegram:7", "yes", tc);
    expect(out).toContain("Marcus Vale");
    const after = handle.sqlite
      .prepare(`SELECT reminder_fired_at, fired_by_approval FROM nodes WHERE id = ?`)
      .get(fatherId) as { reminder_fired_at: string | null; fired_by_approval: number | null };
    expect(after.reminder_fired_at).toBeTruthy();
    expect(after.fired_by_approval).toBe(r.pendingApprovalId!);
  });
});
