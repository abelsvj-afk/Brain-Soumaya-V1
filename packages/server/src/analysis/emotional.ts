import type { EmotionalTrajectory, EmotionalPattern, EmotionalPoint, GraphNode } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { spaceTimezone, DEFAULT_PREFS } from "../agent/notify/policy.js";
import { localDateOfStored } from "../lib/time.js";

/**
 * Emotional trajectory analysis (research-agent add-on #5). Turns the per-memory
 * signed `emotionalWeight` (valence −1..1) + timestamps into a mood-over-time view:
 * a day-bucketed series plus detected patterns (stress cycles, up/downswings,
 * burnout risk, volatility) with a trigger and a gentle intervention. Fully
 * heuristic + offline — no LLM, no token cost, always available.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The SPACE-local calendar day a memory belongs to (owner rule 2026-10-21:
 *  day buckets follow the user's own day, never the UTC day). A bare stored
 *  date stays itself; a stored timestamp is bucketed by its local day in the
 *  space's timezone. Unparseable values return null and are skipped. */
const dayOf = (iso: string, tz: string): string | null => localDateOfStored(iso, tz);

/** The space's timezone for day bucketing — same source (space_meta via the
 *  notify layer) the streak/digest fixes use; the shared default applies when
 *  space_meta is unreachable (bare test DB). */
function spaceTz(h: DbHandle, spaceId: string): string {
  return spaceTimezone(h.sqlite, spaceId);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Least-squares slope of values against their index (per-step change). */
function slopeOf(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (xs[i]! - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** The tag (or, failing tags, the type) most common among the given memories. */
function dominantTrigger(nodes: GraphNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const keys = n.tags && n.tags.length ? n.tags : [n.type];
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "";
  let bestN = 1; // require at least 2 to count as a pattern trigger
  for (const [k, c] of counts) if (c > bestN) ((best = k), (bestN = c));
  return best;
}

const EMPTY: EmotionalTrajectory = {
  points: [],
  trend: "steady",
  average: 0,
  volatility: 0,
  patterns: [],
  sampleSize: 0,
};

/**
 * The shared core, factored out (Maya Longitudinal Intelligence Phase E,
 * docs/specs/maya-longitudinal-intelligence.md) so the bounded chat-facing entry point below can
 * never silently diverge in behavior from the original full-space one — same factoring
 * discipline Phase A's `temporalChains.ts` `evolutionLinksFor()` already established for
 * exactly this "one full-scan function, one bounded one, one shared body" shape. `nodes` is
 * whatever set the caller already resolved (every memory in the space, or a small
 * already-retrieved candidate set) — this function does no querying of its own.
 */
function trajectoryFrom(nodes: GraphNode[], tz: string = DEFAULT_PREFS.timezone): EmotionalTrajectory {
  const dated = nodes
    .filter((n) => n.kind !== "action" && typeof n.emotionalWeight === "number")
    .map((n) => ({ t: n.occurredAt ?? n.createdAt, v: clamp(n.emotionalWeight!, -1, 1), node: n }))
    .filter((x): x is { t: string; v: number; node: GraphNode } => !!x.t)
    .sort((a, b) => (a.t < b.t ? -1 : 1));

  if (dated.length === 0) return EMPTY;

  // Day buckets → averaged series.
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const d of dated) {
    const day = dayOf(d.t, tz);
    if (!day) continue;
    const b = buckets.get(day) ?? { sum: 0, count: 0 };
    b.sum += d.v;
    b.count++;
    buckets.set(day, b);
  }
  const allPoints: EmotionalPoint[] = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, b]) => ({ date, valence: round(b.sum / b.count), count: b.count }));
  // Keep the most recent 40 buckets for the sparkline.
  const points = allPoints.slice(-40);
  const vals = points.map((p) => p.valence);

  const average = round(mean(dated.map((d) => d.v)));
  const volatility = round(clamp(stddev(vals), 0, 1));
  const slope = slopeOf(vals);
  const trend: EmotionalTrajectory["trend"] = slope > 0.02 ? "rising" : slope < -0.02 ? "falling" : "steady";

  const negativeNodes = dated.filter((d) => d.v < -0.2).map((d) => d.node);
  const trigger = dominantTrigger(negativeNodes);
  const patterns: EmotionalPattern[] = [];

  const dipDays = points.filter((p) => p.valence < -0.3);
  if (dipDays.length >= 2) {
    patterns.push({
      type: "Stress cycle",
      trigger,
      repeats: dipDays.length,
      intervention:
        "These heavy dips keep recurring — note what tends to precede them and plan a small recovery ritual around that trigger.",
    });
  }
  // Burnout shape: a bright early stretch that cools into a heavy recent one.
  if (points.length >= 6) {
    const third = Math.max(1, Math.floor(points.length / 3));
    const early = mean(vals.slice(0, third));
    const late = mean(vals.slice(-third));
    if (early > 0.15 && late < -0.15) {
      patterns.push({
        type: "Burnout risk",
        trigger,
        repeats: 1,
        intervention:
          "A bright early stretch has cooled into a heavy one — a classic burnout shape. Protect rest and lighten the load where you can.",
      });
    }
  }
  if (trend === "rising") {
    patterns.push({
      type: "Upswing",
      trigger: "",
      repeats: 1,
      intervention: "You're on an upswing — worth noting what's working so you can repeat it.",
    });
  } else if (trend === "falling" && average < 0) {
    patterns.push({
      type: "Downswing",
      trigger,
      repeats: 1,
      intervention: "Mood has been trending down. Revisit a memory that lifted you, or capture one good thing today.",
    });
  }
  if (volatility >= 0.5) {
    patterns.push({
      type: "Volatile stretch",
      trigger: "",
      repeats: 1,
      intervention: "Big emotional swings lately — anchoring routines (sleep, movement) can smooth the ride.",
    });
  }

  return { points, trend, average, volatility, patterns, sampleSize: dated.length };
}

/**
 * The original, UNCHANGED full-space entry point — every memory in the space feeds the
 * trajectory. Correct and intentional for its one real caller (`GET /api/digest/*`, an
 * on-demand Digest-panel view), matching the same "full scans are fine in an on-demand route,
 * never the chat hot path" precedent `analysis/temporalChains.ts`'s `buildEvolutionLinks`/
 * `synthesis/contradictions.ts`'s `runContradictionScan` already established. Behavior is
 * byte-for-byte identical to before Phase E's refactor.
 */
export function buildEmotionalTrajectory(h: DbHandle, spaceId: string = DEFAULT_SPACE): EmotionalTrajectory {
  return trajectoryFrom(new NodesRepo(h, spaceId).all(), spaceTz(h, spaceId));
}

/**
 * Maya Longitudinal Intelligence, Phase E (docs/specs/maya-longitudinal-intelligence.md,
 * Section 11) — the bounded entry point for the chat hot path. `relevantIds` is the SAME small,
 * already-computed GraphRAG context set `chat/graphrag.ts` builds for every message (never a new
 * retrieval), so the per-message cost is `O(|relevantIds|)` — a single bounded `byIds()` query —
 * instead of `O(every memory in the space)`. This is also what gives the resulting trajectory
 * its CONTEXT RELEVANCE for free: bounding to nodes already retrieved for the current message's
 * topic means a detected pattern is, by construction, about what the conversation is currently
 * about — not a topic-blind, all-time mood average.
 */
export function buildEmotionalTrajectoryAmong(h: DbHandle, spaceId: string = DEFAULT_SPACE, relevantIds: number[]): EmotionalTrajectory {
  if (relevantIds.length === 0) return EMPTY;
  return trajectoryFrom(new NodesRepo(h, spaceId).byIds(relevantIds), spaceTz(h, spaceId));
}

/**
 * Chat-facing renderer — same null-when-empty, best-effort contract as every other snapshot
 * function `chat/graphrag.ts` already calls (finance/people/cognitive/temporal/intelligence).
 * Deliberately narrates a DETECTED PATTERN only (`EmotionalPattern`, which already requires ≥2
 * dip-days / a real bright-to-heavy shape / a multi-point slope / real variance to exist at
 * all — see `trajectoryFrom` above) — NEVER a single memory's raw valence. This is the
 * structural distinction between a temporary reaction (one heavy memory → `patterns: []` →
 * `null` here, nothing said) and a recurring signal worth surfacing as conversational context
 * (a named, repeated pattern). The returned text is explicit that this is a recurring SIGNAL,
 * never a fact about who the user is, what they want, or a change to any goal/vision/preference
 * — mirroring how `analysis/intelligence.ts`'s `intelligenceSnapshotText` hedges a detected
 * contradiction rather than asserting it as settled.
 *
 * Deliberately does NOT fall back to the full-space `buildEmotionalTrajectory` when
 * `contextNodeIds` is omitted/empty (unlike the temporal-bounding convention `analysis/
 * intelligence.ts`'s `intelligenceSnapshotText` uses) — this snapshot is chat-context-only by
 * design; a caller with no bounded context has nothing scoped to narrate, so this returns `null`
 * rather than ever reaching for a full scan from a hot path. The full-space view stays reachable
 * only through `buildEmotionalTrajectory` directly (the Digest panel's own route).
 */
export function emotionalSnapshotText(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  contextNodeIds: number[] = [],
  now: Date = new Date(),
): string | null {
  void now; // accepted for signature symmetry with the other snapshot functions; unused — pattern detection is not "as of now" gated, it reads whatever dated evidence the bounded set already contains
  const trajectory = buildEmotionalTrajectoryAmong(handle, spaceId, contextNodeIds);
  if (trajectory.patterns.length === 0) return null;

  const lines = [
    "EMOTIONAL CONTEXT (deterministic pattern detection over memories relevant to THIS conversation — a recurring SIGNAL, never a settled fact about who the user is, what they want, or a reason to treat any goal/vision/preference as changed; mention it only if it naturally fits, never as a scripted check-in):",
  ];
  for (const p of trajectory.patterns) {
    const triggerNote = p.trigger ? ` around "${p.trigger}"` : "";
    lines.push(`- ${p.type}${triggerNote} (recurred ${p.repeats}x among the memories relevant here): ${p.intervention}`);
  }
  return lines.join("\n");
}
