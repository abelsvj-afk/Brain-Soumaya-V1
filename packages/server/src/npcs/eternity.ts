import type { DbHandle } from "../db/client.js";
import { ETERNITY_AUTONOMOUS_GESTURES, type EternityAutonomousGesture } from "@brain/shared";
import { localDateKey } from "./repo.js";
import { spaceTimezone } from "../agent/notify/policy.js";

/**
 * Eternity's Decide step (docs/specs/eternity-autonomy-2026-10-29.md, phase 1): a DETERMINISTIC policy over
 * coarse aggregates of the visitor's brain — no model call, no memory text, nothing displayed.
 *
 * "Cosmic alignment" (D-72) is how active and how emotionally charged the galaxy has been lately: the count of
 * memories added in the last 30 days and their average emotional weight. It is an internal gate only — never
 * shown, never a number to the visitor, never a score. Below the threshold he simply waits (a logged non-act);
 * a visitor who never comes gets nothing, and one whose galaxy is quiet gets no pull and no penalty.
 *
 * He reads aggregates only (read-only SELECT COUNT/AVG over `nodes`); he never reads `content` or `label`,
 * and never writes to a brain.
 */

export const ALIGNMENT_WINDOW_DAYS = 30;
/** Memories in the window that make the volume part of alignment full. */
export const ALIGNMENT_FULL_VOLUME = 12;
/** Below this he waits; at or above it he may act. Owner-tunable in code, never model-set. */
export const ALIGNMENT_THRESHOLD = 0.5;
/** One act in this many is "reorder the heavens" instead of a gesture. */
export const REORDER_ONE_IN = 4;

export interface EternityPerception {
  nowMs: number;
  memoriesInWindow: number;
  meanWeight: number;
  /** 0..1, internal only. */
  alignment: number;
  actsToday: number;
  /** Space-local day key, part of the deterministic pick. */
  dayKey: string;
  spaceId: string;
}

export type EternityDecision =
  | { act: "gesture"; gesture: EternityAutonomousGesture; cause: string }
  | { act: "reorder-light"; cause: string }
  | { act: "wait"; cause: string };

/** Pure: alignment from the two aggregates. */
export function alignmentOf(memoriesInWindow: number, meanWeight: number): number {
  const volume = Math.min(1, Math.max(0, memoriesInWindow) / ALIGNMENT_FULL_VOLUME);
  const charge = Math.min(1, Math.max(0, meanWeight));
  return 0.6 * volume + 0.4 * charge;
}

export function perceiveEternity(h: DbHandle, spaceId: string, nowMs: number, actsToday: number): EternityPerception {
  const since = new Date(nowMs - ALIGNMENT_WINDOW_DAYS * 86_400_000).toISOString();
  const row = h.sqlite
    .prepare(
      `SELECT COUNT(*) AS n, AVG(COALESCE(emotional_weight, 0)) AS w FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND created_at >= ?`,
    )
    .get(spaceId, since) as { n: number; w: number | null };
  const meanWeight = row.w ?? 0;
  return {
    nowMs,
    memoriesInWindow: row.n,
    meanWeight,
    alignment: alignmentOf(row.n, meanWeight),
    actsToday,
    dayKey: localDateKey(spaceTimezone(h.sqlite, spaceId), nowMs),
    spaceId,
  };
}

/** A small stable hash → 0..1, so the same day/space/act-count always picks the same act. */
function pick01(seed: string): number {
  let x = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    x ^= seed.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}

export function decideEternity(p: EternityPerception): EternityDecision {
  if (p.alignment < ALIGNMENT_THRESHOLD) {
    return {
      act: "wait",
      cause: "Nothing in this galaxy called to him — he waits. (He asks for nothing; a quiet galaxy is no fault.)",
    };
  }
  const r = pick01(`${p.spaceId}|${p.dayKey}|${p.actsToday}`);
  if (r < 1 / REORDER_ONE_IN) {
    return {
      act: "reorder-light",
      cause: "This galaxy has been alive lately, and he felt like rearranging the heavens — wonder, nothing taken.",
    };
  }
  // A second, independent draw chooses the gesture; weighted toward the warmer ones when the galaxy is charged.
  const g = pick01(`gesture|${p.spaceId}|${p.dayKey}|${p.actsToday}`);
  const warm = p.meanWeight >= 0.5;
  const pool: readonly EternityAutonomousGesture[] = warm
    ? ["blessing", "joy", "regard", "blessing", "joy", "stillness"]
    : ["stillness", "regard", "blessing", "stillness", "regard", "joy"];
  const gesture = pool[Math.min(pool.length - 1, Math.floor(g * pool.length))]!;
  if (!ETERNITY_AUTONOMOUS_GESTURES.includes(gesture)) {
    return { act: "wait", cause: "He considered a gesture that is not his to make unprompted, and let it pass." };
  }
  return {
    act: "gesture",
    gesture,
    cause: warm
      ? "This galaxy has been active and full of feeling lately — he turned toward it."
      : "This galaxy has been active lately — he looked in on it.",
  };
}
