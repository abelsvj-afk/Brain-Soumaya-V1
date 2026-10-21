import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { ingestWithContext } from "../../ingestion/pipeline.js";
import { getPreferences, localDay, localTime } from "../notify/policy.js";

/**
 * Telegram Parity Phase 5-C: dream playback — read back the latest nightly
 * consolidation (W3) run: what beliefs were formed or changed, plainly.
 *
 * Where consolidation results live (found, not reinvented):
 * - Run records: `consolidation_runs` (one row per space + window; written
 *   by `agent/consolidation/run.ts`). The latest COMPLETED row is the run
 *   played back. Its `window_date` is already the SPACE-LOCAL date the
 *   window opened (run.ts computes it in the space timezone); the started
 *   timestamp is additionally rendered in the space timezone via
 *   `getPreferences` + `localDay`/`localTime` (notify/policy.ts) — never a
 *   UTC date (owner's hard timezone rule).
 * - Beliefs formed by the run: `user_model` rows (origin 'consolidated' and
 *   friends) attributed two ways, unioned: (a) `consolidation_episodes`
 *   bookkeeping rows with `last_run_id = run.id` and a non-null
 *   `resulting_entry_id` (distill.ts writes these for every processed
 *   episode), and (b) entries whose `created_at` falls inside the run's
 *   [started_at, completed_at] window.
 * - Beliefs changed by the run: `user_model` rows whose `invalid_at` falls
 *   inside that window — reported as superseded/corrected with their
 *   invalid_reason and, when present, the replacement entry's text.
 * Playback itself is a pure read of those stores: it never calls
 * getUserModel (that read has access-telemetry side effects) and never
 * touches a user_model row.
 *
 * "That's wrong" — the correction path (INV-KC-1, hard rule):
 * When the caller passes `correction` (his words disputing a belief,
 * optionally with `beliefId`), the correction is recorded as a STATED INPUT
 * through the codebase's existing conversational stated-fact intake — the
 * exact entry `capture_memory` wraps and `/log` calls:
 * `ingestWithContext(handle, { embeddings, llm }, ctx, text, spaceId)`
 * with the text `Correction: <his words>`. The ingested node is a
 * user-origin stated record in the brain (the same store
 * clarification-confirmed facts land in — `analysis/clarificationResolution`
 * creates user-origin nodes there too) which the normal machinery
 * (retrieval, W3 consolidation over new material) may weigh later.
 * Deliberately NOT used, and why:
 * - `correctUserModel` / `updateUserModel` / `recordStated`
 *   (agent/userModel.ts) are user-model MUTATION APIs — recordStated would
 *   invalidate contradicted consolidated entries on the spot. Calling any
 *   of them from playback would directly edit a belief, which INV-KC-1
 *   forbids for this path. The disputed belief row stays byte-unchanged.
 * - `knowledgeCheck` stays read-only and is not called here at all.
 *
 * Approval treatment (flagged, deliberate): recording a correction IS a
 * write, and the intake it reuses is approval-gated in conversation
 * (owner decision D3 — capture_memory is a WRITE tool). This tool is
 * therefore registered as a WRITE tool in AGENT_TOOLS as a whole: the loop
 * gates per-tool, not per-args, so even a pure playback proposal is
 * proposed for approval. That is the honest cost of putting the correction
 * on the existing gated path instead of inventing a silent write — see
 * the Phase 5-C pin note in phase1.test.ts.
 * Idempotency mirrors captureMemory: the approval id stamps the first
 * ingested node, so a crash-retry of the same approved playback does not
 * ingest the correction twice (a pure playback retry is a pure re-read).
 */

interface RunRow {
  id: number;
  window_date: string;
  started_at: string;
  completed_at: string | null;
  items_processed: number;
  contradictions_resolved: number;
  consolidations_written: number;
}

interface EntryRow {
  id: number;
  slot: string;
  content: string;
  confidence: number;
  origin: string;
  invalid_at: string | null;
  invalid_reason: string | null;
  replaced_by: number | null;
}

const ENTRY_COLS = `id, slot, content, confidence, origin, invalid_at, invalid_reason, replaced_by`;

export const dreamPlaybackTool: Tool = {
  name: "dream_playback",
  description:
    "Play back the most recent nightly consolidation (dream cycle): which beliefs were formed and which were changed in the latest completed run, with the run's date in the user's own timezone. Use for 'what did you dream', 'what did you learn last night', 'what beliefs changed'. CORRECTION: if the user disputes one of the beliefs ('that's wrong', 'I don't believe that'), call this again with beliefId set to that belief's id and correction set to the user's own words disputing it — the correction is saved as a stated record ('Correction: <their words>') for the brain to weigh later; it does NOT rewrite the belief on the spot, and you must never claim the belief was edited or deleted. This is a WRITE tool because of that correction path: proposing it asks for confirmation first — quote back what will be saved before the user confirms.",
  parameters: {
    type: "object",
    properties: {
      beliefId: {
        type: "integer",
        description:
          "Optional. The user_model belief id being disputed (from a previous dream_playback result). Only used together with correction.",
      },
      correction: {
        type: "string",
        description:
          "Optional. The user's own words disputing a belief ('that's wrong — …'). When present, they are recorded verbatim as a stated correction; the belief itself is not edited.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const s = tc.ctx.handle.sqlite;
    const correction = String(args.correction ?? "").trim();
    const beliefId = typeof args.beliefId === "number" && Number.isInteger(args.beliefId) ? args.beliefId : null;

    // ----- Correction path: stated input via the capture/ingest intake. -----
    if (correction) {
      let belief: EntryRow | undefined;
      if (beliefId !== null) {
        belief = s
          .prepare(`SELECT ${ENTRY_COLS} FROM user_model WHERE id = ? AND space_id = ?`)
          .get(beliefId, tc.spaceId) as EntryRow | undefined;
        if (!belief) {
          return {
            ok: true,
            summary: `dream_playback: correction target #${beliefId} not found`,
            message: `DREAM PLAYBACK: no belief with id ${beliefId} exists in this brain, so there is nothing to attach that correction to. Say so — do not invent one, and do not record a correction against a different belief.`,
          };
        }
      }
      const text = `Correction: ${correction}`;

      // Idempotency (captureMemory precedent): the approval id stamps the
      // first ingested node; a crash-retry dedups instead of re-ingesting.
      const approvalId = typeof args._approvalId === "number" ? args._approvalId : null;
      const idemKey = approvalId !== null ? `approval:${approvalId}` : null;
      if (idemKey) {
        const existing = s
          .prepare(
            `SELECT id, label FROM nodes WHERE space_id = ? AND idempotency_key = ? AND deleted_at IS NULL`,
          )
          .get(tc.spaceId, idemKey) as { id: number; label: string } | undefined;
        if (existing) {
          return {
            ok: true,
            summary: "dream_playback: correction already recorded (deduped)",
            targets: [existing.id],
            message: `✦ That correction is already recorded — I didn't duplicate it. The belief itself is unchanged; the correction sits alongside it as your stated word, for the brain to weigh.`,
          };
        }
      }

      // The existing stated-fact intake, verbatim (same call /log and
      // capture_memory make). This writes a memory NODE — it never calls
      // any user-model mutation API, so the disputed belief row is
      // byte-unchanged by construction (INV-KC-1).
      const result = await ingestWithContext(
        tc.ctx.handle,
        { embeddings: tc.ctx.embeddings, llm: tc.ctx.llm },
        tc.ctx,
        text,
        tc.spaceId,
      );
      if (result.nodes.length === 0) {
        return { ok: false, summary: "dream_playback: correction produced no record" };
      }
      if (idemKey) {
        try {
          s.prepare(`UPDATE nodes SET idempotency_key = ? WHERE id = ? AND space_id = ?`).run(
            idemKey,
            result.nodes[0]!.id,
            tc.spaceId,
          );
        } catch {
          /* UNIQUE race lost — the record itself succeeded either way. */
        }
      }
      const about = belief ? ` about the belief "${belief.content}" (#${belief.id})` : "";
      return {
        ok: true,
        summary: `dream_playback: correction recorded${belief ? ` for belief #${belief.id}` : ""} (belief unchanged)`,
        targets: [result.nodes[0]!.id],
        message:
          `✦ Recorded as your stated correction${about}: "${text}". ` +
          `I did NOT edit or delete the belief — it stays exactly as it was, and your correction is now on record for the brain to weigh against it.`,
      };
    }

    // ----- Playback: latest completed consolidation run (pure read). -----
    const run = s
      .prepare(
        `SELECT id, window_date, started_at, completed_at, items_processed,
                contradictions_resolved, consolidations_written
         FROM consolidation_runs
         WHERE space_id = ? AND status = 'completed'
         ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(tc.spaceId) as RunRow | undefined;

    if (!run) {
      return {
        ok: true,
        summary: "dream_playback: no completed consolidation run",
        message:
          "DREAM PLAYBACK: no nightly consolidation run has completed yet for this brain — there is no dream to play back. Say so honestly; do not invent beliefs a run never formed.",
      };
    }

    // Space timezone for every date label (owner's hard rule: never UTC).
    let tz = "America/New_York";
    try {
      tz = getPreferences(s, tc.spaceId).timezone;
    } catch {
      /* fail open to the default prefs timezone */
    }
    const started = new Date(run.started_at);
    const startedLocal = Number.isNaN(started.getTime())
      ? run.window_date
      : `${localDay(started, tz)} ${localTime(started, tz)}`;
    const end = run.completed_at ?? run.started_at;

    // Formed: bookkeeping-attributed entries ∪ entries created in-window.
    const formedById = new Map<number, { entry: EntryRow; via: string }>();
    const bookkept = s
      .prepare(
        `SELECT outcome, resulting_entry_id FROM consolidation_episodes
         WHERE space_id = ? AND last_run_id = ? AND resulting_entry_id IS NOT NULL`,
      )
      .all(tc.spaceId, run.id) as { outcome: string; resulting_entry_id: number }[];
    for (const b of bookkept) {
      const entry = s
        .prepare(`SELECT ${ENTRY_COLS} FROM user_model WHERE id = ? AND space_id = ?`)
        .get(b.resulting_entry_id, tc.spaceId) as EntryRow | undefined;
      if (entry) formedById.set(entry.id, { entry, via: b.outcome });
    }
    const createdInWindow = s
      .prepare(
        `SELECT ${ENTRY_COLS} FROM user_model
         WHERE space_id = ? AND created_at >= ? AND created_at <= ?`,
      )
      .all(tc.spaceId, run.started_at, end) as EntryRow[];
    for (const entry of createdInWindow) {
      if (!formedById.has(entry.id)) formedById.set(entry.id, { entry, via: "formed" });
    }
    const formed = [...formedById.values()].sort((a, b) => a.entry.id - b.entry.id);

    // Changed: entries invalidated inside the run window.
    const changed = s
      .prepare(
        `SELECT ${ENTRY_COLS} FROM user_model
         WHERE space_id = ? AND invalid_at IS NOT NULL AND invalid_at >= ? AND invalid_at <= ?
         ORDER BY id ASC`,
      )
      .all(tc.spaceId, run.started_at, end) as EntryRow[];
    const changedNotFormed = changed.filter((e) => !formedById.has(e.id));

    const formedLine = ({ entry, via }: { entry: EntryRow; via: string }): string => {
      const verb = via === "strengthened" ? "Strengthened" : via === "consolidated" ? "Formed" : "Formed";
      const now = entry.invalid_at ? ` (no longer current — ${entry.invalid_reason ?? "invalidated"} since)` : "";
      return `  - ${verb} belief #${entry.id} [${entry.slot}, confidence ${entry.confidence.toFixed(2)}, origin ${entry.origin}]: "${entry.content}"${now}`;
    };
    const changedLine = (entry: EntryRow): string => {
      let replacement = "";
      if (entry.replaced_by !== null) {
        const rep = s
          .prepare(`SELECT content FROM user_model WHERE id = ? AND space_id = ?`)
          .get(entry.replaced_by, tc.spaceId) as { content: string } | undefined;
        if (rep) replacement = ` Replaced by: "${rep.content}".`;
      }
      return `  - Changed belief #${entry.id} [${entry.slot}, was confidence ${entry.confidence.toFixed(2)}]: "${entry.content}" — ${entry.invalid_reason ?? "invalidated"}.${replacement}`;
    };

    const lines = [
      `DREAM PLAYBACK — latest nightly consolidation run #${run.id}, night of ${run.window_date} (space timezone ${tz}; run started ${startedLocal} local):`,
      `Run totals: ${run.items_processed} item(s) processed, ${run.consolidations_written} consolidation(s) written, ${run.contradictions_resolved} contradiction(s) resolved.`,
      `Beliefs formed or strengthened in this run: ${formed.length}`,
      ...formed.map(formedLine),
      ...(formed.length === 0 ? ["  (none — the run formed no new beliefs.)"] : []),
      `Beliefs changed in this run: ${changedNotFormed.length}`,
      ...changedNotFormed.map(changedLine),
      ...(changedNotFormed.length === 0 ? ["  (none — no belief was superseded or corrected by this run.)"] : []),
      `If any of these is wrong, say so in your own words and call dream_playback with that belief's id and your correction — it will be recorded as your stated correction (the belief itself is never edited on the spot).`,
    ];

    return {
      ok: true,
      summary: `dream_playback: run #${run.id} (${run.window_date}): ${formed.length} formed, ${changedNotFormed.length} changed`,
      message: lines.join("\n"),
    };
  },
};
