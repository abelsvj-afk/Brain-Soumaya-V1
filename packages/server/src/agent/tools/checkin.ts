import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { buildCommunicationContext, recentActionCount, actionFiredToday } from "../../communication/context.js";

/**
 * Proactive check-ins (SOUMAYA_TOOLS.md tool #3). Beyond the once-a-day digest, she
 * reaches out WHEN something happens — a heavy emotional stretch, or two memories that
 * pull against each other (an unaddressed contradiction). Gentle + rate-limited: at
 * most one check-in per space per day. Deterministic + offline.
 *
 * Phase T pilot (docs/specs/soumaya-proactive-communication-migration.md) — the
 * non-financial consumer proving `communication/context.ts` generalizes beyond
 * billRisk (Phase S). detect()'s own heaviness/contradiction detection below is
 * COMPLETELY UNCHANGED — this tool already performs its own emotional read (a raw
 * 5-day mean-of-emotional_weight check, deliberately separate from
 * `analysis/emotional.ts`'s pattern detector — a pre-existing signal that predates this
 * phase and is left exactly as-is, per the phase's "preserve existing intelligence" rule).
 * Because detect() already IS this surface's emotional signal, `run()` deliberately does
 * NOT also read `CommunicationContext.emotionalPatterns` — doing so would mean two
 * independent emotional reads feeding one message, which is redundant, not more
 * intelligent (the "available vs. relevant" distinction this phase asks to preserve).
 * Only `preferences` (learned verbosity/directness) and a repetition-awareness read
 * (`recentActionCount` — has check-in already fired recently) shape HOW the
 * already-detected signal is phrased. Zero new LLM calls; every default (no-evidence)
 * branch below is byte-identical to the pre-Phase-T wording.
 */

const HEAVY_WINDOW_MS = 1000 * 60 * 60 * 24 * 5; // look back 5 days
const HEAVY_MIN_COUNT = 3; // need a few heavy notes, not one bad moment
const HEAVY_MEAN = -0.3; // mean emotional weight below this reads as a hard stretch

function toMs(iso: string): number {
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Deterministic message selection informed by CommunicationContext — kept outside the
 * shared module on purpose, same reasoning as billRisk's own `buildBillRiskMessage`
 * (domain-specific branching belongs with the tool that owns the message). Priority,
 * most to least specific: an explicit learned preference (concise, then direct) wins
 * outright; then repetition-awareness (heavy only — a contradiction is already deduped
 * by insight pair, so "have we said this before" doesn't apply the same way); then the
 * original default wording.
 */
function buildCheckinMessage(input: {
  kind: "heavy" | "contradiction";
  text: string;
  preferConcise: boolean;
  preferDirect: boolean;
  alreadyCheckedInRecently: boolean;
}): string {
  const { kind, text, preferConcise, preferDirect, alreadyCheckedInRecently } = input;

  if (kind === "contradiction") {
    if (preferConcise) return `🌀 Pulling against each other: ${text}`;
    if (preferDirect) return `🌀 Contradiction: ${text} Worth reconciling.`;
    return `🌀 Two of your memories seem to pull against each other: ${text} Want to reconcile them together?`;
  }

  if (preferConcise) return "💙 Rough stretch lately. I'm here.";
  if (alreadyCheckedInRecently) return "💙 Still a heavy stretch. I'm here whenever you want to talk it through.";
  if (preferDirect) return "💙 It's been a heavy stretch. Want to talk it through?";
  return "💙 The last little while looks like it's been heavy. I'm here whenever you want to talk it through — no pressure.";
}

export const checkinTool: Tool = {
  name: "check_in",
  description:
    "Reach out to the user when a signal warrants it — a heavy emotional stretch, or an unaddressed contradiction between two memories. At most one per day.",
  parameters: {
    type: "object",
    properties: { kind: { type: "string", enum: ["heavy", "contradiction"] }, text: { type: "string" } },
    required: ["kind", "text"],
  },

  detect(tc: ToolContext): ToolInvocation[] {
    // Once per SPACE-local day (owner rule 2026-10-21 — the guard follows
    // the user's own day, never the UTC day of the stored timestamp).
    if (actionFiredToday(tc.ctx.handle, tc.spaceId, "tool:check_in", new Date(tc.now))) return [];

    // Signal 1: a heavy emotional stretch across recent memories.
    const recent = tc.ctx.handle.sqlite
      .prepare(
        `SELECT emotional_weight AS w, created_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory') AND emotional_weight IS NOT NULL`,
      )
      .all(tc.spaceId) as { w: number; created_at: string }[];
    const window = recent.filter((r) => toMs(r.created_at) >= tc.now - HEAVY_WINDOW_MS);
    if (window.length >= HEAVY_MIN_COUNT) {
      const mean = window.reduce((a, r) => a + (r.w ?? 0), 0) / window.length;
      if (mean <= HEAVY_MEAN) {
        return [{ tool: "check_in", args: { kind: "heavy", text: "" }, reason: `mean emotional weight ${mean.toFixed(2)} over ${window.length} recent memories` }];
      }
    }

    // Signal 2: an unaddressed contradiction (most significant recent one).
    const contradiction = tc.ctx.handle.sqlite
      .prepare(`SELECT text FROM insights WHERE space_id = ? AND kind = 'contradiction' ORDER BY score DESC, id DESC LIMIT 1`)
      .get(tc.spaceId) as { text: string } | undefined;
    if (contradiction?.text) {
      return [{ tool: "check_in", args: { kind: "contradiction", text: contradiction.text }, reason: "an unresolved contradiction between two memories" }];
    }
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const kind = args.kind === "contradiction" ? "contradiction" : "heavy";
    const text = String(args.text ?? "");

    // Phase T: no opts passed — emotionalPatterns stays null (zero extra query), by
    // design (see the file-header comment for why this surface doesn't also read it).
    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId);
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const preferDirect = comm.preferences.some((p) => p.signal === "directness" && /direct|blunt/i.test(p.value));
    const alreadyCheckedInRecently = recentActionCount(tc.ctx.handle, tc.spaceId, "tool:check_in", 7, new Date(tc.now)) >= 1;

    const msg = buildCheckinMessage({ kind, text, preferConcise, preferDirect, alreadyCheckedInRecently });
    let delivered = false;
    try {
      await tc.notify(msg, { tool: "checkin" });
      delivered = true;
    } catch {
      /* router logs it regardless */
    }
    return { ok: true, summary: `checked in (${kind})`, delivered, message: msg };
  },
};
