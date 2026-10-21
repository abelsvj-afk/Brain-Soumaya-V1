import type { GraphNode, EpistemicStatus, ProvenanceRef } from "@brain/shared";
import { parseTolerantMs, localDayInZone } from "../lib/time.js";
import { DEFAULT_PREFS } from "../agent/notify/policy.js";

/**
 * Direction-of-currency resolver (docs/specs/maya-longitudinal-intelligence.md, Phase A). The
 * `maya-longitudinal-intelligence.md` audit found `EpistemicStatus` already includes
 * `"outdated"` and `"contradicted"` (added in the I1–I3 pass) but that NOTHING in the codebase
 * actually produces them — `analysis/intelligence.ts`'s `openContradictionClaims()` always
 * returns `"observation"`. This module is the smallest deterministic mechanism that closes that
 * gap: given two memories already known to be related by an EXISTING detector, decide which
 * side is temporally current, using only already-stored timestamps. Pure arithmetic — no LLM
 * call, no new persistence — and it NEVER touches either memory's actual content; it only
 * produces a transient, computed label a caller may attach to a fresh `IntelligenceClaim`.
 *
 * `"outdated"` and `"contradicted"` are NOT interchangeable outputs of the same situation —
 * they answer two different questions, so the caller must say which one it's asking:
 *  - A same-theme EVOLUTION pair (`analysis/temporalChains.ts`'s `buildEvolutionLinks*`) is a
 *    legitimate change over time ("I drive a Ford" → "I drive a Chevy") — the earlier side
 *    becomes `"outdated"`, never `"contradicted"`, because nothing here ever asserted the two
 *    statements were incompatible, only that one is older.
 *  - A genuine CONTRADICTION pair (`synthesis/contradictions.ts`'s LLM-verified conflicts,
 *    reframed by `openContradictionClaims()`) has ALREADY been judged mutually exclusive by an
 *    upstream detector — once we know which side came first, the earlier one becomes
 *    `"contradicted"`, a stronger claim than mere staleness.
 */

/** Which existing detector supplied the two memories — determines the resulting status. */
export type SupersessionKind = "contradiction" | "continuity";

export interface SupersessionResult {
  /** The side that remains (or is presumed) current — untouched, just referenced. */
  current: ProvenanceRef;
  /** The side whose implied state no longer describes the present. Its content is NEVER
   *  altered; this is a label on a separate, transient claim, not an edit to this row. */
  superseded: ProvenanceRef;
  status: Extract<EpistemicStatus, "outdated" | "contradicted">;
  /** Plain-language, reused verbatim by callers — never regenerated per-caller. */
  reason: string;
}

/** Event time preferred over creation time (`analysis/temporalChains.ts`'s own `timeOf()`
 *  convention, reused rather than re-derived) — a backdated memory's `occurredAt` is what
 *  actually matters for "which state came first," not when the user happened to type it. */
function timeOf(n: GraphNode): number {
  return parseTolerantMs(n.occurredAt ?? n.createdAt);
}

/** How far apart two events must be, in ms, before direction is trusted — guards against two
 *  memories recorded at effectively the same moment producing an arbitrary, coin-flip
 *  "earlier" side. NEW — no existing precedent for exactly this guard; a conservative, explicit
 *  floor rather than trusting any nonzero millisecond delta. */
const MIN_CONFIDENT_GAP_MS = 60_000; // 1 minute — generous relative to normal capture cadence

/**
 * Given two evidence memories already known to be related, and which kind of relationship
 * produced them, determine which side is temporally current. Returns `null` — never a guess —
 * when direction cannot be established confidently: a missing/unparseable date on either side,
 * or a gap too small to trust. A `null` result means the caller's EXISTING status (typically
 * `"observation"`) stays unchanged; this resolver only ever adds a stronger label, never removes
 * or downgrades one, and never promotes anything to `"confirmed"`.
 */
export function resolveSupersession(a: GraphNode, b: GraphNode, kind: SupersessionKind, tz: string = DEFAULT_PREFS.timezone): SupersessionResult | null {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  if (Math.abs(ta - tb) < MIN_CONFIDENT_GAP_MS) return null;

  const [older, newer] = ta < tb ? [a, b] : [b, a];
  const status: SupersessionResult["status"] = kind === "contradiction" ? "contradicted" : "outdated";
  // The reason text is user-facing: the date is the SPACE-local calendar date
  // of the newer statement (owner rule 2026-10-21), never its UTC date.
  const dateLabel = localDayInZone(Math.max(ta, tb), tz);

  return {
    current: { domain: "memory", kind: "node", id: newer.id, label: newer.label },
    superseded: { domain: "memory", kind: "node", id: older.id, label: older.label },
    status,
    reason:
      status === "contradicted"
        ? `Superseded by a later, conflicting statement on ${dateLabel} — no longer treated as current.`
        : `Superseded by a later statement on ${dateLabel} — this described an earlier state, not necessarily still true now.`,
  };
}
