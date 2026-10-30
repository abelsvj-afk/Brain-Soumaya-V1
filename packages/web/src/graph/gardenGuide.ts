/**
 * Growing Place guidance (docs/specs/owner-feedback-2026-10-30-travel-exits-garden.md §4):
 * what to do next, what she is carrying, the first-visit steps and the
 * garden day's three beats. Pure (no three.js, no DOM except the small
 * storage helpers, which swallow a blocked localStorage) so the logic is
 * unit-tested; GardenObjective draws it and the scene only reacts to it.
 *
 * Nothing here rewards or punishes: no fuel, no streak, no decay. The
 * garden day's reward is a visible bloom — looking is never farmed.
 */

export interface ObjectiveInput {
  /** The label of the memory she is carrying, or null when her hands are empty. */
  carryingLabel: string | null;
  /** Seed pods ripe for recall right now. */
  podsWaiting: number;
  /** Plots with no recent tend (cold) the garden could suggest. */
  coldPlots: number;
  /** Groves in the garden (a carried memory needs one). */
  groves: number;
}

export type ObjectiveKind = "carrying" | "pods" | "plots" | "rest";

export interface Objective {
  kind: ObjectiveKind;
  text: string;
}

/** The single most useful next thing, in priority order: carrying → pods → plots → rest. */
export function gardenObjective(i: ObjectiveInput): Objective {
  if (i.carryingLabel !== null) {
    return {
      kind: "carrying",
      text:
        i.groves > 0
          ? `Carrying “${i.carryingLabel}” — tap a pulsing grove to place it.`
          : `Carrying “${i.carryingLabel}” — you have no Journeys to place it in yet; Drop it to put it back.`,
    };
  }
  if (i.podsWaiting > 0) {
    return {
      kind: "pods",
      text: i.podsWaiting === 1 ? "A seed pod is ready — tap it to recall it." : `${i.podsWaiting} seed pods are ready — tap one to recall it.`,
    };
  }
  if (i.coldPlots > 0) return { kind: "plots", text: "Tap a plot to tend it — Soumaya's suggestions are a good start." };
  return { kind: "rest", text: "The garden is tended. Walk to a grove, or rest here." };
}

// --- First-visit guide: Walk → Tend a plot → Carry a memory to a grove ---

export interface GuideProgress {
  walked: boolean;
  tended: boolean;
  carried: boolean;
  dismissed: boolean;
}

export const EMPTY_GUIDE: GuideProgress = { walked: false, tended: false, carried: false, dismissed: false };

export interface GuideStep {
  id: "walk" | "tend" | "carry";
  label: string;
  done: boolean;
}

export function guideSteps(p: GuideProgress): GuideStep[] {
  return [
    { id: "walk", label: "Walk (tap ground)", done: p.walked },
    { id: "tend", label: "Tend a plot", done: p.tended },
    { id: "carry", label: "Carry to a grove", done: p.carried },
  ];
}

/** The guide shows until it is finished or dismissed. */
export function guideVisible(p: GuideProgress): boolean {
  return !p.dismissed && !(p.walked && p.tended && p.carried);
}

/** The first undone step — what the strip teaches while the guide is up. */
export function nextGuideStep(p: GuideProgress): GuideStep | null {
  return guideSteps(p).find((s) => !s.done) ?? null;
}

// --- The garden day: tend 3 plots · place 1 memory · recall 1 pod ---

export const DAY_GOALS = { tends: 3, places: 1, recalls: 1 } as const;

export interface DayCounts {
  tends: number;
  places: number;
  recalls: number;
}

export const EMPTY_DAY: DayCounts = { tends: 0, places: 0, recalls: 0 };

export interface DayBeat {
  id: keyof DayCounts;
  label: string;
  have: number;
  goal: number;
  done: boolean;
}

export function dayBeats(c: DayCounts): DayBeat[] {
  const beat = (id: keyof DayCounts, label: string): DayBeat => ({
    id,
    label,
    have: Math.min(c[id], DAY_GOALS[id]),
    goal: DAY_GOALS[id],
    done: c[id] >= DAY_GOALS[id],
  });
  return [beat("tends", "Tend"), beat("places", "Place"), beat("recalls", "Recall")];
}

export function dayComplete(c: DayCounts): boolean {
  return dayBeats(c).every((b) => b.done);
}

/** How many of the three beats are done, 0..3 (the ring's fill). */
export function dayDoneCount(c: DayCounts): number {
  return dayBeats(c).filter((b) => b.done).length;
}

// --- Storage (per brain; per local day for the day) ---

const guideKey = (spaceId: string | null) => `garden.guide.${spaceId ?? "local"}`;

export function localDayStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayKey = (spaceId: string | null, d: Date) => `garden.day.${spaceId ?? "local"}.${localDayStamp(d)}`;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* blocked storage: progress lives for this stay only */
  }
}
const bool = (v: unknown) => v === true;
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function readGuide(spaceId: string | null): GuideProgress {
  const j = readJson(guideKey(spaceId)) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return EMPTY_GUIDE;
  return { walked: bool(j.walked), tended: bool(j.tended), carried: bool(j.carried), dismissed: bool(j.dismissed) };
}
export function writeGuide(spaceId: string | null, p: GuideProgress): void {
  writeJson(guideKey(spaceId), p);
}

/** The day's counts plus whether its bloom already played (so a reload never replays it). */
export interface DayState extends DayCounts {
  bloomed: boolean;
}

export function readDay(spaceId: string | null, d: Date = new Date()): DayState {
  const j = readJson(dayKey(spaceId, d)) as Record<string, unknown> | null;
  if (!j || typeof j !== "object") return { ...EMPTY_DAY, bloomed: false };
  return { tends: count(j.tends), places: count(j.places), recalls: count(j.recalls), bloomed: bool(j.bloomed) };
}
export function writeDay(spaceId: string | null, s: DayState, d: Date = new Date()): void {
  writeJson(dayKey(spaceId, d), s);
}
