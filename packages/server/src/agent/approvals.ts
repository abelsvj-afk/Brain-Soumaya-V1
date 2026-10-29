import { createHash } from "node:crypto";
import type { AppContext } from "../context.js";
import type { Tool, ToolContext, ToolResult } from "./tools/types.js";
import { TOOLS } from "./tools/registry.js";
import { validateArgs } from "./tools/validation.js";
import { captureEpisode } from "./episodic.js"; // W2: correction capture (§5.1)

/**
 * Phase 1 agent loop: write-approval lifecycle.
 *
 * States: pending -> confirmed -> executing -> executed | failed
 *          pending -> denied | expired
 *
 * Every transition appends an IMMUTABLE row to agent_logs (the audit trail).
 * tool_approvals holds the MUTABLE operational state. args_json (which may
 * contain user text) lives ONLY in tool_approvals — never in agent_logs.
 *
 * Crash safety: the approval id IS the idempotency key. A retry of the same
 * approval reuses it; the tool's persistence boundary (UNIQUE(space_id,
 * idempotency_key) or the atomic fired_by_approval UPDATE) guarantees the
 * side effect exists once. Effectively-once, not exactly-once.
 */

export const APPROVAL_TTL_MS = 15 * 60 * 1000; // pending approvals expire after 15 min
export const MAX_EXECUTION_ATTEMPTS = 3;
const STALE_EXECUTING_MS = 5 * 60 * 1000; // executing longer than this → retry

export type ApprovalStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "executed"
  | "failed"
  | "denied"
  | "expired";

export interface ApprovalRow {
  id: number;
  space_id: string;
  principal: string;
  tool: string;
  args_json: string;
  args_hash: string;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  execution_started_at: string | null;
  execution_attempts: number;
  last_error: string | null;
  execution_log_id: number | null;
}

/** Canonical JSON for hashing: sorted keys, no whitespace variance. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function argsHash(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

function audit(
  ctx: AppContext,
  spaceId: string,
  action: string,
  description: string,
  result: Record<string, unknown>,
): number {
  // Immutable audit row. description is TEMPLATED — never contains user text,
  // args, or secrets. result JSON carries {approvalId, attempt, ok} only.
  const row = ctx.handle.sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', ?, ?, '[]', ?)`
    )
    .run(spaceId, action, description, JSON.stringify({ kind: "approval", ...result }));
  return Number(row.lastInsertRowid);
}

function getApproval(ctx: AppContext, id: number): ApprovalRow | undefined {
  return ctx.handle.sqlite
    .prepare(`SELECT * FROM tool_approvals WHERE id = ?`)
    .get(id) as ApprovalRow | undefined;
}

/**
 * Create a pending approval for a write-tool call the model proposed.
 * Validates args and guard() BEFORE creating anything.
 */
export function requestApproval(
  tc: ToolContext,
  tool: Tool,
  args: Record<string, unknown>,
  principal: string,
): { ok: boolean; approvalId?: number; error?: string } {
  const v = validateArgs(tool, args);
  if (!v.ok) return { ok: false, error: v.error };
  if (tool.guard && !tool.guard(tc)) {
    return { ok: false, error: `tool "${tool.name}" is not allowed to run right now` };
  }
  const hash = argsHash(args);
  const expiresAt = new Date(tc.now + APPROVAL_TTL_MS).toISOString();
  const row = tc.ctx.handle.sqlite
    .prepare(
      `INSERT INTO tool_approvals (space_id, principal, tool, args_json, args_hash, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(tc.spaceId, principal, tool.name, JSON.stringify(args), hash, expiresAt);
  const id = Number(row.lastInsertRowid);
  audit(tc.ctx, tc.spaceId, "approval:requested", `approval #${id}: ${tool.name} awaiting confirmation`, {
    approvalId: id,
    tool: tool.name,
  });
  return { ok: true, approvalId: id };
}

/**
 * Confirm a pending approval. Atomic: only one confirmer wins. Revalidates
 * identity (principal), space, expiry, status, and exact args at confirm time.
 */
export function confirmApproval(
  ctx: AppContext,
  spaceId: string,
  principal: string,
  approvalId: number,
  now: number,
): { ok: boolean; approval?: ApprovalRow; error?: string } {
  const a = getApproval(ctx, approvalId);
  if (!a) return { ok: false, error: "approval not found" };
  if (a.space_id !== spaceId) return { ok: false, error: "approval belongs to a different space" };
  if (a.principal !== principal) return { ok: false, error: "approval belongs to a different user" };
  if (a.status !== "pending") {
    return { ok: false, error: `approval is ${a.status}, not pending` };
  }
  if (Date.parse(a.expires_at) <= now) {
    expireApproval(ctx, a);
    return { ok: false, error: "approval expired" };
  }
  // Atomic consume: only transitions pending -> confirmed.
  const changed = ctx.handle.sqlite
    .prepare(
      `UPDATE tool_approvals SET status = 'confirmed', decided_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(new Date(now).toISOString(), approvalId);
  if (changed.changes === 0) {
    // Lost the race — re-read to report the true state.
    const current = getApproval(ctx, approvalId);
    return { ok: false, error: `approval is ${current?.status ?? "unknown"}, not pending` };
  }
  audit(ctx, spaceId, "approval:confirmed", `approval #${approvalId} confirmed`, {
    approvalId,
    tool: a.tool,
  });
  return { ok: true, approval: { ...a, status: "confirmed" } };
}

/** Deny a pending approval. Atomic; losers see the true state. */
export function denyApproval(
  ctx: AppContext,
  spaceId: string,
  principal: string,
  approvalId: number,
  now: number,
): { ok: boolean; error?: string } {
  const a = getApproval(ctx, approvalId);
  if (!a) return { ok: false, error: "approval not found" };
  if (a.space_id !== spaceId || a.principal !== principal) {
    return { ok: false, error: "approval not found" };
  }
  const changed = ctx.handle.sqlite
    .prepare(
      `UPDATE tool_approvals SET status = 'denied', decided_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(new Date(now).toISOString(), approvalId);
  if (changed.changes === 0) {
    const current = getApproval(ctx, approvalId);
    return { ok: false, error: `approval is ${current?.status ?? "unknown"}, not pending` };
  }
  audit(ctx, spaceId, "approval:denied", `approval #${approvalId} denied`, {
    approvalId,
    tool: a.tool,
  });
  // W2 §5.1: an approval denial is an explicit correction signal ("no",
  // "wrong") — the highest-value capture kind for the user model. Best-effort,
  // non-blocking, never throws.
  void Promise.resolve()
    .then(() =>
      captureEpisode(ctx.handle, spaceId, {
        kind: "correction",
        summary: `User denied approval #${approvalId} for tool "${a.tool}" — rejected the proposed action`,
      }),
    )
    .catch(() => {});
  return { ok: true };
}

function expireApproval(ctx: AppContext, a: ApprovalRow): void {
  const changed = ctx.handle.sqlite
    .prepare(`UPDATE tool_approvals SET status = 'expired' WHERE id = ? AND status = 'pending'`)
    .run(a.id);
  if (changed.changes > 0) {
    audit(ctx, a.space_id, "approval:expired", `approval #${a.id} expired`, {
      approvalId: a.id,
      tool: a.tool,
    });
  }
}

/**
 * Execute a confirmed approval. Transitions confirmed -> executing (atomic),
 * runs the tool with the approval id as idempotency key, then records
 * executed or failed. Each attempt appends its own audit row.
 *
 * Crash window: if the process dies during tool.run(), the row stays
 * `executing`. sweepApprovals() retries it with the SAME approval id; the
 * tool's persistence boundary dedups via UNIQUE(space_id, idempotency_key).
 */
export async function executeApproval(
  tc: ToolContext,
  approval: ApprovalRow,
): Promise<{ ok: boolean; result?: ToolResult; error?: string }> {
  const ctx = tc.ctx;
  // confirmed -> executing (atomic; only one executor proceeds). The claim
  // stamps execution_started_at: the sweep's stale-executing predicate
  // measures from here, NOT from decided_at (confirmation time) — a row
  // confirmed long ago but executing briefly is not stale.
  const claimed = ctx.handle.sqlite
    .prepare(
      `UPDATE tool_approvals
       SET status = 'executing', execution_attempts = execution_attempts + 1,
           execution_started_at = ?
       WHERE id = ? AND status = 'confirmed'`
    )
    .run(new Date(tc.now).toISOString(), approval.id);
  if (claimed.changes === 0) {
    const current = getApproval(ctx, approval.id);
    return { ok: false, error: `approval #${approval.id} is ${current?.status ?? "unknown"}; cannot execute` };
  }
  const attempt = approval.execution_attempts + 1;
  audit(ctx, tc.spaceId, "approval:executing", `approval #${approval.id} executing (attempt ${attempt})`, {
    approvalId: approval.id,
    attempt,
    tool: approval.tool,
  });

  const tool = TOOLS.find((t) => t.name === approval.tool);
  if (!tool) {
    return failApproval(tc, approval, attempt, `tool "${approval.tool}" no longer in registry`);
  }
  // Revalidate at execution time: schema, guard, and exact args binding.
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(approval.args_json) as Record<string, unknown>;
  } catch {
    return failApproval(tc, approval, attempt, "stored args are not valid JSON");
  }
  if (argsHash(args) !== approval.args_hash) {
    return failApproval(tc, approval, attempt, "args hash mismatch — args changed after approval");
  }
  const v = validateArgs(tool, args);
  if (!v.ok) return failApproval(tc, approval, attempt, v.error ?? "validation failed");
  if (tool.guard && !tool.guard(tc)) {
    return failApproval(tc, approval, attempt, `tool "${tool.name}" guard now blocks execution`);
  }

  let result: ToolResult;
  try {
    // The approval id is the idempotency key: tools that support it dedup
    // on UNIQUE(space_id, idempotency_key) at their persistence boundary.
    result = await tool.run(tc, { ...args, _approvalId: approval.id });
  } catch (err) {
    return failApproval(tc, approval, attempt, `tool threw: ${(err as Error).message}`.slice(0, 200));
  }

  if (!result.ok) {
    // Retryable vs terminal: exhausted attempts -> failed (terminal).
    const next = getApproval(ctx, approval.id);
    const attempts = next?.execution_attempts ?? attempt;
    if (attempts >= MAX_EXECUTION_ATTEMPTS) {
      return failApproval(tc, approval, attempt, `tool failed: ${result.summary}`.slice(0, 200));
    }
    // Back to confirmed for a retry (sweeper or next explicit execute).
    ctx.handle.sqlite
      .prepare(`UPDATE tool_approvals SET status = 'confirmed', last_error = ? WHERE id = ?`)
      .run(`attempt ${attempt}: ${result.summary}`.slice(0, 200), approval.id);
    audit(ctx, tc.spaceId, "approval:failed", `approval #${approval.id} attempt ${attempt} failed, will retry`, {
      approvalId: approval.id,
      attempt,
      tool: approval.tool,
      ok: false,
    });
    return { ok: false, error: result.summary };
  }

  // Success: record the execution audit row, then mark executed.
  const logId = audit(ctx, tc.spaceId, `tool:${tool.name}`, `${tool.name} executed (approval #${approval.id})`, {
    approvalId: approval.id,
    attempt,
    tool: tool.name,
    ok: true,
  });
  ctx.handle.sqlite
    .prepare(`UPDATE tool_approvals SET status = 'executed', execution_log_id = ? WHERE id = ?`)
    .run(logId, approval.id);
  return { ok: true, result };
}

function failApproval(
  tc: ToolContext,
  approval: ApprovalRow,
  attempt: number,
  reason: string,
): { ok: boolean; error?: string } {
  tc.ctx.handle.sqlite
    .prepare(`UPDATE tool_approvals SET status = 'failed', last_error = ? WHERE id = ?`)
    .run(reason.slice(0, 200), approval.id);
  audit(tc.ctx, tc.spaceId, "approval:failed", `approval #${approval.id} failed: ${reason}`.slice(0, 160), {
    approvalId: approval.id,
    attempt,
    tool: approval.tool,
    ok: false,
  });
  return { ok: false, error: reason };
}

/**
 * Maintenance sweep: expire stale pendings, retry stale `executing` rows
 * (crash recovery — same approval id, so the persistence boundary dedups).
 * Returns counts for observability.
 */
export async function sweepApprovals(
  tc: ToolContext,
): Promise<{ expired: number; retried: number; failed: number }> {
  const ctx = tc.ctx;
  let expired = 0;
  let retried = 0;
  let failed = 0;
  const stalePending = ctx.handle.sqlite
    .prepare(`SELECT * FROM tool_approvals WHERE status = 'pending' AND expires_at <= ?`)
    .all(new Date(tc.now).toISOString()) as ApprovalRow[];
  for (const a of stalePending) {
    expireApproval(ctx, a);
    expired++;
  }
  // Stale `executing` rows are measured from EXECUTION START, not from
  // confirmation: decided_at is when the user said yes, which can long
  // predate the claim. A row confirmed 6 min ago but executing for 10 s
  // must not be flipped back to `confirmed` and re-executed while the
  // first execution is still running.
  const staleExecuting = ctx.handle.sqlite
    .prepare(
      `SELECT * FROM tool_approvals WHERE status = 'executing' AND execution_started_at <= ?`
    )
    .all(new Date(tc.now - STALE_EXECUTING_MS).toISOString()) as ApprovalRow[];
  for (const a of staleExecuting) {
    if (a.execution_attempts >= MAX_EXECUTION_ATTEMPTS) {
      failApproval(tc, a, a.execution_attempts, "stale executing row; attempts exhausted");
      failed++;
      continue;
    }
    // Back to confirmed so executeApproval can claim it again with the same id.
    ctx.handle.sqlite
      .prepare(`UPDATE tool_approvals SET status = 'confirmed' WHERE id = ? AND status = 'executing'`)
      .run(a.id);
    const exec = await executeApproval(tc, { ...a, status: "confirmed" });
    if (exec.ok) retried++;
    else failed++;
  }
  // Prune terminal rows older than 7 days (audit trail in agent_logs remains).
  ctx.handle.sqlite
    .prepare(
      `DELETE FROM tool_approvals
       WHERE status IN ('executed','failed','denied','expired')
       AND decided_at <= ?`
    )
    .run(new Date(tc.now - 7 * 24 * 60 * 60 * 1000).toISOString());
  return { expired, retried, failed };
}

/** Find a pending approval for this principal+space (for "yes" confirmations). */
export function findPendingApproval(
  ctx: AppContext,
  spaceId: string,
  principal: string,
): ApprovalRow | undefined {
  const rows = ctx.handle.sqlite
    .prepare(
      `SELECT * FROM tool_approvals
       WHERE space_id = ? AND principal = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 2`
    )
    .all(spaceId, principal) as ApprovalRow[];
  // Ambiguous when 2+ pending — the caller must ask which one.
  if (rows.length !== 1) return undefined;
  return rows[0];
}
