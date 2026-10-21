import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { buildCommunicationContext, recentActionCount } from "../../communication/context.js";

/**
 * Orphan-star surfacing (NEURO_ALIGNMENT.md #4). An unlinked memory is a star adrift —
 * the report says surface them so the user can integrate them. Gently: at most ONE
 * orphan nudged per space per day (guarded by today's own agent_logs entry, so no new
 * column), choosing the most significant long-drifting orphan. Deterministic + offline.
 *
 * Phase U (docs/specs/soumaya-proactive-communication-migration-wave2.md) — detect()'s
 * selection query below is COMPLETELY UNCHANGED (same `ORDER BY importance DESC,
 * created_at ASC` ranking). `importance` was already computed to CHOOSE the orphan but
 * discarded before the message was built; `run()`'s own re-fetch (needed anyway to
 * re-confirm it's still unlinked) now also reads `importance`/`created_at` — the exact
 * same columns the SAME row already has, not a new query or a second detector — so the
 * message can reflect how long it's drifted and whether it seemed to matter. Adds the
 * shared CommunicationContext's verbosity preference and a repetition signal (has an
 * orphan nudge fired recently). Zero new LLM calls; when none of that evidence applies,
 * the wording is byte-identical to the pre-Phase-U default.
 */

const MIN_AGE_MS = 1000 * 60 * 60 * 24 * 2; // give a memory 2 days to auto-link before calling it an orphan
const VERY_OLD_DAYS = 14; // drifting this long is worth naming, not just implying via "for now"
const SIGNIFICANT_IMPORTANCE = 0.7; // matches this codebase's existing "matters" bar elsewhere

interface OrphanRow {
  id: number;
  label: string;
}

/** SQLite/ISO timestamp → ms (tolerant of "YYYY-MM-DD HH:MM:SS" and full ISO) — same
 *  helper every other tool in this directory already has its own copy of. */
function toMs(iso: string): number {
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Compositional, not a hand-written sentence per combination (Phase U's own guidance
 * against a combinatorial matrix): a stable template gets at most one magnitude clause,
 * chosen by priority (age+importance together > age alone > importance alone), plus an
 * independent repetition-aware opener. When none of that evidence exists, this returns
 * the exact original sentence.
 */
function buildOrphanMessage(input: { label: string; ageDays: number; importance: number; preferConcise: boolean; nudgedRecently: boolean }): string {
  const { label, ageDays, importance, preferConcise, nudgedRecently } = input;
  if (preferConcise) return `🌟 Unlinked: "${label}".`;

  const veryOld = ageDays >= VERY_OLD_DAYS;
  const significant = importance >= SIGNIFICANT_IMPORTANCE;
  if (!veryOld && !significant && !nudgedRecently) {
    return `🌟 One memory is drifting unconnected: "${label}". Want to link it into your galaxy?`;
  }

  const opener = nudgedRecently ? "🌟 Another one drifting" : "🌟 One memory is drifting unconnected";
  const clause =
    veryOld && significant
      ? ` — this one seems to matter, and it's gone ${ageDays} days without a single connection`
      : veryOld
        ? ` — it's gone ${ageDays} days without a single connection`
        : significant
          ? " — this one seems to matter"
          : "";
  return `${opener}${clause}: "${label}". Want to link it into your galaxy?`;
}

export const orphanTool: Tool = {
  name: "surface_orphan",
  description:
    "Find a memory that has drifted with no connections (an orphan) so the user can link it into their galaxy. Call with NO arguments in conversation (\"do I have any unconnected memories?\") — the most significant long-drifting orphan is selected fresh. Optionally pass nodeId for a specific memory. (The router's detector-shaped call, with nodeId, still works exactly as before.)",
  parameters: {
    type: "object",
    properties: { nodeId: { type: "number", description: "Optional: a specific memory id. Omit in conversation to select the top orphan fresh." } },
    required: [],
    additionalProperties: false,
  },

  detect(tc: ToolContext): ToolInvocation[] {
    const today = new Date(tc.now).toISOString().slice(0, 10);
    // Once per day: if we already surfaced an orphan today, hold off.
    const didToday = tc.ctx.handle.sqlite
      .prepare(`SELECT 1 FROM agent_logs WHERE space_id = ? AND action = 'tool:surface_orphan' AND substr(created_at,1,10) = ?`)
      .get(tc.spaceId, today);
    if (didToday) return [];

    const cutoff = new Date(tc.now - MIN_AGE_MS).toISOString();
    const row = tc.ctx.handle.sqlite
      .prepare(
        `SELECT n.id, n.label FROM nodes n
         WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind = 'memory')
           AND n.created_at <= ?
           AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))
         ORDER BY COALESCE(n.importance, 0) DESC, n.created_at ASC
         LIMIT 1`,
      )
      .get(tc.spaceId, cutoff) as OrphanRow | undefined;
    if (!row) return [];
    return [{ tool: "surface_orphan", args: { nodeId: row.id }, reason: `"${row.label}" is drifting with no connections` }];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // Telegram Parity Phase 4 — conversational path: no nodeId means the
    // model is asking about orphaned memories — select with detect()'s
    // EXACT ranking (most significant, longest-drifting, past the MIN_AGE
    // grace) but WITHOUT the once-a-day gate and WITHOUT notify: the user
    // asked explicitly, and the answer returns to the model, not as a
    // separate proactive ping. Router path below is unchanged.
    if (typeof args.nodeId !== "number" || !Number.isFinite(args.nodeId)) {
      const s = tc.ctx.handle.sqlite;
      const total = (
        s
          .prepare(
            `SELECT COUNT(*) AS c FROM nodes n
             WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind = 'memory')
               AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))`,
          )
          .get(tc.spaceId) as { c: number }
      ).c;
      if (total === 0) {
        return {
          ok: true,
          summary: "surface_orphan (conversational): no orphans",
          message: "ORPHAN CHECK (exact, from the graph): every live memory has at least one connection — there are no orphaned (unconnected) memories. Say so honestly.",
        };
      }
      const cutoff = new Date(tc.now - MIN_AGE_MS).toISOString();
      const row = s
        .prepare(
          `SELECT n.id, n.label, n.created_at FROM nodes n
           WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind = 'memory')
             AND n.created_at <= ?
             AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id))
           ORDER BY COALESCE(n.importance, 0) DESC, n.created_at ASC
           LIMIT 1`,
        )
        .get(tc.spaceId, cutoff) as { id: number; label: string; created_at: string } | undefined;
      if (!row) {
        return {
          ok: true,
          summary: `surface_orphan (conversational): ${total} unlinked, all recent`,
          message: `ORPHAN CHECK (exact, from the graph): ${total} live memor${total === 1 ? "y is" : "ies are"} unconnected, but all are still within the grace period for forming links — none has drifted long enough to call an orphan yet.`,
        };
      }
      const ageDays = Math.max(0, Math.floor((tc.now - toMs(row.created_at)) / 86_400_000));
      return {
        ok: true,
        summary: `surface_orphan (conversational): top orphan "${row.label}"`,
        targets: [row.id],
        message: `ORPHAN CHECK (exact, from the graph): ${total} live memor${total === 1 ? "y is" : "ies are"} unconnected. The most significant long-drifting one is #${row.id} "${row.label}" — created ${row.created_at.slice(0, 10)}, drifting for ${ageDays} day(s) with no connections. Invite the user to link it into their galaxy.`,
      };
    }
    const nodeId = Number(args.nodeId);
    const row = tc.ctx.handle.sqlite
      .prepare(`SELECT label, importance, created_at FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
      .get(nodeId, tc.spaceId) as { label: string; importance: number | null; created_at: string } | undefined;
    if (!row) return { ok: false, summary: `orphan ${nodeId} gone` };
    // Re-check it's still an orphan (a link may have formed since detect()).
    const linked = tc.ctx.handle.sqlite
      .prepare(`SELECT 1 FROM edges WHERE space_id = ? AND (source = ? OR target = ?)`)
      .get(tc.spaceId, nodeId, nodeId);
    if (linked) return { ok: false, summary: `"${row.label}" got linked; skipping` };

    const ageDays = Math.max(0, Math.floor((tc.now - toMs(row.created_at)) / 86_400_000));
    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId);
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const nudgedRecently = recentActionCount(tc.ctx.handle, tc.spaceId, "tool:surface_orphan", 3, new Date(tc.now)) >= 1;
    const msg = buildOrphanMessage({ label: row.label, ageDays, importance: row.importance ?? 0.4, preferConcise, nudgedRecently });
    let delivered = false;
    try {
      await tc.notify(msg);
      delivered = true;
    } catch {
      /* router logs it regardless */
    }
    return { ok: true, summary: `surfaced orphan "${row.label}"`, delivered, message: msg };
  },
};
