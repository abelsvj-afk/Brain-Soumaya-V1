import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { ingestWithContext } from "../../ingestion/pipeline.js";

/**
 * Telegram Parity Phase 2: conversational memory capture — "remember this: …"
 * without the /log prefix (findings §7 Phase 2; owner decision D3).
 *
 * The approval line (D3): owner-TYPED commands act immediately (/log stays
 * exactly as it is — a direct command, no approval), but anything SHE
 * proposes in conversation is a write that needs his "yes" first. This tool
 * is therefore registered as a WRITE tool in AGENT_TOOLS: proposing it only
 * creates a pending approval via the loop's approval machinery
 * (agent/approvals.ts); nothing is ingested until the owner confirms, and
 * executeApproval() is what calls run().
 *
 * Execution reuses EXACTLY the /log path: telegram/bot.ts's /log handler
 * calls `ingestWithContext(handle, { embeddings, llm }, ctx, body, spaceId)`;
 * run() below calls the same entry point with the same deps shape and the
 * ToolContext's server-provided spaceId (the model never supplies a space
 * id, so a capture can only ever land in the space the conversation is in).
 *
 * Idempotency: the approval id is the idempotency key, mirroring
 * taskCreator.ts. ingestWithContext creates its nodes through the pipeline
 * (which stamps no key), so after a successful ingest the FIRST created
 * node is stamped with `approval:<id>`; a crash-retry of the same approval
 * sees that stamp and reports the capture as already done instead of
 * ingesting a duplicate.
 */
export const captureMemoryTool: Tool = {
  name: "capture_memory",
  description:
    "Save something the user wants remembered as a new memory in their brain. Use this when the user says \"remember this\", \"save this\", \"note that\", \"remember that\", or otherwise asks you in plain conversation to remember/save something for later (without using the /log command). The \"text\" argument must be exactly what should be saved, in the user's own words as far as possible. This is a WRITE: proposing it only asks for confirmation — when you propose it, you MUST quote back verbatim what will be saved (e.g. 'I'll save this: \"<text>\" — say \"yes\" to confirm'), and never claim it is saved until the user confirms.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Exactly what should be saved as the new memory — the fact, note, or thought the user asked to remember, in their own words.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never
    // does — capture happens only on an explicit conversational request,
    // never on a maintenance tick.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // Fix round 4 (§18.2 byte-exact contract): the persisted payload is
    // the submitted text UNTRIMMED — only the empty check uses a trimmed
    // copy. trim() here used to silently drop leading/trailing spaces
    // before persist, violating "the JSON string value exactly as submitted".
    const text = String(args.text ?? "");
    if (!text.trim()) return { ok: false, summary: "empty capture text" };

    // Phase 1 approval machinery: the approval id is the idempotency key.
    // A crash-retry of the same approval must not ingest a second copy.
    const approvalId = typeof args._approvalId === "number" ? args._approvalId : null;
    const idemKey = approvalId !== null ? `approval:${approvalId}` : null;
    const s = tc.ctx.handle.sqlite;
    if (idemKey) {
      const existing = s
        .prepare(
          `SELECT id, label FROM nodes WHERE space_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
        )
        .get(tc.spaceId, idemKey) as { id: number; label: string } | undefined;
      if (existing) {
        return {
          ok: true,
          summary: `captured memory "${existing.label}" already saved (deduped)`,
          targets: [existing.id],
          message: `✦ Already saved "${existing.label}" — I didn't duplicate it.`,
        };
      }
    }

    // The /log path, verbatim: same pipeline entry, same deps shape, same
    // space scoping (bot.ts /log: ingestWithContext(ctx.handle,
    // { embeddings: ctx.embeddings, llm: ctx.llm }, ctx, body, spaceId)).
    const result = await ingestWithContext(
      tc.ctx.handle,
      { embeddings: tc.ctx.embeddings, llm: tc.ctx.llm },
      tc.ctx,
      text,
      tc.spaceId,
      // Verbatim V1: conversational captures are kind 'chat' sources;
      // the approval id doubles as the source idempotency key so a
      // crash-retry of the same approval can never duplicate the source.
      { channel: "chat", idempotencyKey: idemKey ?? undefined },
    );
    if (result.nodes.length === 0) {
      return { ok: false, summary: "capture produced no memories" };
    }

    // Stamp the first created node with the approval's idempotency key so a
    // crash-retry dedups above instead of re-ingesting (see header).
    if (idemKey) {
      try {
        s.prepare(`UPDATE nodes SET idempotency_key = ? WHERE id = ? AND space_id = ?`).run(
          idemKey,
          result.nodes[0]!.id,
          tc.spaceId,
        );
      } catch {
        /* UNIQUE race lost — a concurrent retry already stamped it; the
           capture itself succeeded either way, so never fail over this. */
      }
    }

    const label = result.nodes[0]!.label;
    const linkCount = result.associativeEdges.length;
    const extra =
      result.nodes.length > 1 ? ` (+${result.nodes.length - 1} more ${result.nodes.length === 2 ? "memory" : "memories"})` : "";
    const msg =
      `✦ Saved "${label}"${extra} — ${linkCount} link${linkCount === 1 ? "" : "s"} formed. ` +
      `It's in your brain now.`;
    return {
      ok: true,
      summary: `captured memory "${label}" (${result.nodes.length} node${result.nodes.length === 1 ? "" : "s"})`,
      targets: result.nodes.map((n) => n.id),
      message: msg,
    };
  },
};
