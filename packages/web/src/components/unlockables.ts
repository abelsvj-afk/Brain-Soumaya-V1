import {
  EMPTY_UNLOCK_STATS,
  getUnlockableByEquip,
  isDevUnlockAllEnabled,
  isUnlocked,
  type UnlockOptions,
  type UnlockStats,
  type UnlockableItem,
} from "@brain/shared";
import type { GraphNode, Streak } from "@brain/shared";

/**
 * Web adapter over the shared Unlockables system (IM-133;
 * packages/shared/src/unlockables.ts is the catalog + evaluator).
 *
 * This module is the ONLY place the web app translates its live state
 * (graph nodes/links, the streak endpoint, the persisted achievement set,
 * the live Codex) into the shared UnlockStats shape, and the only place
 * the music player consults the gate — so App, the Hangar (when CL-12
 * migrates it) and any future surface all gate identically.
 */

/** Assemble UnlockStats from the exact values App already holds. */
export function buildUnlockStats(input: {
  /** Graph nodes; memories are counted as kind !== "action", matching HangarPanel's memoriesCount prop + the achievements context. */
  nodes: readonly GraphNode[];
  linksCount: number;
  streak?: Streak | null;
  /** Earned achievement ids (persisted set ∪ currently satisfied). */
  achievementIds: Iterable<string>;
  /** Codex completion 0..100 (codexProgress().pct). */
  codexPct: number;
}): UnlockStats {
  return {
    ...EMPTY_UNLOCK_STATS,
    memoriesCount: input.nodes.filter((n) => n.kind !== "action").length,
    linksCount: input.linksCount,
    streakCurrent: input.streak?.current ?? 0,
    streakBest: input.streak?.best ?? 0,
    achievementIds: [...input.achievementIds],
    codexPct: input.codexPct,
  };
}

/** The dev-unlock-all flag for this browser (docs/UNLOCKABLES.md — dev-only, off in normal use). */
export function readDevUnlockAll(): boolean {
  try {
    return isDevUnlockAllEnabled(localStorage);
  } catch {
    return false;
  }
}

// ---- Music gating -----------------------------------------------------------
// The playlist (graph/audio.ts TRACKS) joins the catalog on track id:
// TRACKS[i].id is the music item's equipValue. Deep Space is `always`, so
// index 0 is playable for every brain (docs: "start with 1 song").

/** The catalog item gating one playlist track, if any. */
export function unlockableForTrack(trackId: string): UnlockableItem | undefined {
  return getUnlockableByEquip("music", trackId);
}

/** May this playlist track play for these stats? A track with NO catalog entry fails closed (locked) — every gated item must resolve in the catalog. */
export function isTrackUnlocked(trackId: string, stats: UnlockStats, opts?: UnlockOptions): boolean {
  if (opts?.devUnlockAll) return true;
  const item = unlockableForTrack(trackId);
  if (!item) return false;
  return isUnlocked(item, stats, opts);
}

/** Index of the first playable track in playlist order, or -1 if none (unreachable while a track is `always`). */
export function firstUnlockedTrackIndex(trackIds: readonly string[], stats: UnlockStats, opts?: UnlockOptions): number {
  return trackIds.findIndex((id) => isTrackUnlocked(id, stats, opts));
}

/**
 * The next playable track after `current` (wrapping, skipping locked ones)
 * — what the skip control must advance to now that playback is gated.
 * Returns `current` when no other track is playable.
 */
export function nextUnlockedTrackIndex(
  current: number,
  trackIds: readonly string[],
  stats: UnlockStats,
  opts?: UnlockOptions,
): number {
  if (trackIds.length === 0) return current;
  for (let step = 1; step <= trackIds.length; step++) {
    const idx = (current + step) % trackIds.length;
    if (isTrackUnlocked(trackIds[idx]!, stats, opts)) return idx;
  }
  return current;
}

// ---- Batch I — gating while unlock stats are in flight (REG-065 / GH-07) ----
// While stats are null the dots rendered every track as unlocked and the
// player could play a locked one. These helpers fail CLOSED: a track
// whose condition cannot be evaluated is locked, except an `always`
// track (Deep Space), which needs no stats at all.

/** Is this track gated by an `always` condition — playable before any stats exist? */
export function isTrackAlwaysUnlocked(trackId: string): boolean {
  return unlockableForTrack(trackId)?.condition.kind === "always";
}

/**
 * Is this track LOCKED right now — the predicate the song dots and the
 * player guards must use. `stats === null` means "still loading": only
 * `always` tracks are playable, everything else is locked. A track with
 * no catalog entry is locked (same rule as isTrackUnlocked).
 */
export function trackLocked(trackId: string, stats: UnlockStats | null, opts?: UnlockOptions): boolean {
  if (opts?.devUnlockAll) return false;
  if (!stats) return !isTrackAlwaysUnlocked(trackId);
  return !isTrackUnlocked(trackId, stats, opts);
}

/** Index of the first `always` track in playlist order, or -1 if none. */
export function firstAlwaysUnlockedTrackIndex(trackIds: readonly string[]): number {
  return trackIds.findIndex((id) => isTrackAlwaysUnlocked(id));
}

/**
 * The next `always` track after `current` (wrapping) — what the player
 * falls back to while stats are in flight. Returns `current` when no
 * track is `always` (the player then stays put rather than playing a
 * possibly-locked track).
 */
export function nextAlwaysUnlockedTrackIndex(current: number, trackIds: readonly string[]): number {
  if (trackIds.length === 0) return current;
  for (let step = 1; step <= trackIds.length; step++) {
    const idx = (current + step) % trackIds.length;
    if (isTrackAlwaysUnlocked(trackIds[idx]!)) return idx;
  }
  return current;
}

/** One locked track, named with the requirement that unlocks it — the visible "why locked" line (REG-066). */
export interface LockedTrackNote {
  id: string;
  requirement: string;
}

/** The human requirement for one catalog item's condition ("25 memories", …). */
export function trackRequirement(trackId: string): string {
  const item = unlockableForTrack(trackId);
  if (!item) return "locked";
  const c = item.condition;
  switch (c.kind) {
    case "always":
      return "always available";
    case "memories":
      return `${c.count} memories`;
    case "streak":
      return `${c.days}-day streak`;
    case "links":
      return `${c.count} links`;
    case "achievement":
      return "an achievement";
    case "codex":
      return `${c.pct}% codex`;
    case "anyOf":
      return c.conditions.map((sub) => (sub.kind === "memories" ? `${sub.count} memories` : "an achievement")).join(" or ");
    default:
      return "locked";
  }
}

/** Every currently-locked track in playlist order, with its requirement — empty once everything is unlocked. */
export function lockedTrackNotes(
  trackIds: readonly string[],
  stats: UnlockStats | null,
  opts?: UnlockOptions,
): LockedTrackNote[] {
  return trackIds
    .filter((id) => trackLocked(id, stats, opts))
    .map((id) => ({ id, requirement: trackRequirement(id) }));
}

// ---- "Seen" persistence for the celebration watcher --------------------------
// Mirrors the achievements pattern (achvKey in achievements.ts): the set of
// unlockable ids this device has already celebrated for a brain, so an item
// is celebrated exactly once and a returning pilot is never re-spammed.

/** localStorage key holding the celebrated-unlock set for a brain. */
export function unlockSeenKey(spaceId: string): string {
  return `brain.unlocksSeen.${spaceId}`;
}

/** Read the persisted celebrated-unlock ids for a brain. */
export function loadSeenUnlockIds(spaceId: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(unlockSeenKey(spaceId)) || "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Persist the celebrated-unlock ids for a brain. */
export function saveSeenUnlockIds(spaceId: string, ids: Iterable<string>): void {
  try {
    localStorage.setItem(unlockSeenKey(spaceId), JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — celebrations simply re-derive next session */
  }
}
