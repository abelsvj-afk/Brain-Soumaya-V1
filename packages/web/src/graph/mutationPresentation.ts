import { GARDEN_SEED } from "./gardenLayout.js";
import { animationById } from "./animationInventory.js";
import { getSpaceTimeZone } from "../utils/spaceTimezone.js";

/**
 * Mutation presentation (Phase 4) — pure helpers for the Growing Place's
 * visible change. No three.js here, no fetching: the scene module turns
 * these descriptors into objects, and the components turn them into words.
 *
 * Seeded palette math (§10.1, V4 traceability): every color below is
 * derived from GARDEN_SEED — same seed, same look, forever; no
 * hand-tuned exceptions. The derivation table:
 * - cool anchor (warmth 0, first light): hue = 190 + (seedHash % 20)
 *   (blue-teal first light), saturation 45%, lightness 62% for the key
 *   light; fog the same hue at 30% lightness, mist at 70%.
 * - warm anchor (warmth 1, warm gold): hue = 38 + (seedHash % 8),
 *   saturation 85%, lightness 62% for the key light; fog the same hue
 *   at 42% lightness, mist at 74%.
 * - warmth lerps each channel between the anchors. A difficult season
 *   lends a quieter palette (§4.3) — quieter, never darker-as-punishment:
 *   warmth never drops below the cool anchor, and lightness never drops
 *   below the anchors' floor.
 */

function hashSeeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): number {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toByte = (v: number) => Math.round((v + m) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

export interface WarmthColors {
  /** The garden's key light color (cool first-light → warm gold). */
  keyLight: number;
  /** The palette-matched fog tint. */
  fog: number;
  /** The mist-plane tint. */
  mist: number;
  /** The ambient fill tint. */
  ambient: number;
}

const SEED_HASH = hashSeeded(GARDEN_SEED);
const COOL_HUE = 190 + (SEED_HASH % 20);
const WARM_HUE = 38 + (SEED_HASH % 8);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp the server's warmth signal into the 0..1 range it promises. */
export function clampWarmth(warmth: number): number {
  if (!Number.isFinite(warmth)) return 0;
  return Math.min(1, Math.max(0, warmth));
}

/**
 * Garden colors for a warmth value (A8, proof change #1): the key light
 * warms from cool first-light to warm gold and the fog takes a warmer
 * tint, over days of accumulated change — the render lerps continuously
 * and never jumps. Deterministic from GARDEN_SEED (see the module
 * header); the same warmth always returns the same colors.
 */
export function warmthColors(warmth: number): WarmthColors {
  const t = clampWarmth(warmth);
  return {
    keyLight: hslToHex(lerp(COOL_HUE, WARM_HUE, t), lerp(0.45, 0.85, t), 0.62),
    fog: hslToHex(lerp(COOL_HUE, WARM_HUE, t), lerp(0.4, 0.6, t), lerp(0.3, 0.42, t)),
    mist: hslToHex(lerp(COOL_HUE, WARM_HUE, t), lerp(0.35, 0.5, t), lerp(0.7, 0.74, t)),
    ambient: hslToHex(lerp(COOL_HUE, WARM_HUE, t), lerp(0.35, 0.45, t), 0.55),
  };
}

/** The seeded hue anchors, exposed so tests can pin the derivation. */
export function gardenPaletteAnchors(): { coolHue: number; warmHue: number } {
  return { coolHue: COOL_HUE, warmHue: WARM_HUE };
}

export interface ProvisionalStyle {
  /** Ghost/shimmer, never monumental (P7 tier ii). */
  kind: "provisional";
  /** Ghost opacity for the preview mesh (0..1). */
  opacity: number;
  /** Dashed outline rendering (static under reduced motion). */
  dashed: true;
  /** Slow calm pulse — off under reduced motion, never urgent. */
  shimmer: boolean;
  /** A provisional preview is never monumental, never permanent. */
  monumental: false;
  /** The tag the preview carries. */
  tag: "Proposed — tap to review";
}

/**
 * Provisional (P7 tier ii) style descriptor (A23): ghost/shimmer, never
 * monumental. Under reduced motion the pulse stops — a static dashed
 * outline + the same tag — but the preview never becomes solid.
 */
export function provisionalStyle(reducedMotion: boolean): ProvisionalStyle {
  return {
    kind: "provisional",
    opacity: 0.45,
    dashed: true,
    shimmer: !reducedMotion,
    monumental: false,
    tag: "Proposed — tap to review",
  };
}

export interface TransitionDescriptor {
  /** The one inventory animation that plays — one landing per log entry. */
  animationId: string;
  /** Full-motion duration in ms. */
  durationMs: number;
  easing: "ease-in-out" | "ease-out" | "linear";
  /** What plays instead under reduced motion. */
  reducedMotion: { durationMs: number; kind: string };
}

export type LandingKind = "landmark" | "path" | "cluster" | "anchor" | "other";

/**
 * Apply transition (A24, with its space-specific forms): the approved
 * change's landing. A landmark rises (A6, ~8s), a path draws itself
 * (A7, ~4s), a cluster blooms (A9, ~6–10s); anything else firms from
 * its preview (A24, ~2s). Exactly one animation per landing — the
 * generic firming never also plays for a change with its own form.
 */
export function applyTransition(kind: LandingKind): TransitionDescriptor {
  switch (kind) {
    case "landmark":
      return {
        animationId: "A6",
        durationMs: 8000,
        easing: "ease-in-out",
        reducedMotion: { durationMs: 2000, kind: "fade-in with the same caption" },
      };
    case "path":
      return {
        animationId: "A7",
        durationMs: 4000,
        easing: "ease-in-out",
        reducedMotion: { durationMs: 2000, kind: "fade-in with the “why” caption" },
      };
    case "cluster":
      return {
        animationId: "A9",
        durationMs: 8000,
        easing: "ease-in-out",
        reducedMotion: { durationMs: 2000, kind: "fade into cluster positions" },
      };
    default:
      return {
        animationId: "A24",
        durationMs: 2000,
        easing: "ease-out",
        reducedMotion: { durationMs: 0, kind: "instant firming with the caption" },
      };
  }
}

/**
 * Undo transition (A25): the change reverses by a compensating path —
 * a landmark lowers the way it rose, a path un-draws from one end, a
 * cluster disperses gently. Never a snap-delete. The log keeps both
 * entries; the world never pretends the change never happened.
 */
export function undoTransition(kind: LandingKind): TransitionDescriptor {
  return {
    animationId: "A25",
    durationMs: kind === "landmark" ? 8000 : 6000,
    easing: "ease-in-out",
    reducedMotion: { durationMs: 2000, kind: "fade-out of the undone object" },
  };
}

/** The tend gesture (A26, Verb 1): a moment, glow + caption under reduced motion. */
export function tendTransition(): TransitionDescriptor {
  return {
    animationId: "A26",
    durationMs: 1800,
    easing: "ease-out",
    reducedMotion: { durationMs: 0, kind: "glow + caption, no flight" },
  };
}

/** Resolve a transition descriptor's animation id against the registry. */
export function transitionAnimation(descriptor: TransitionDescriptor): string {
  return animationById(descriptor.animationId)?.id ?? descriptor.animationId;
}

export type SeasonName = "winter" | "spring" | "summer" | "autumn";

export function seasonName(month: number): SeasonName {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

function spaceLocalMonthDay(d: Date, timeZone: string): { month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { month, day };
  } catch {
    return null;
  }
}

/**
 * The season label for a space-local date (A8: a season turns in the
 * owner's local time). Meteorological seasons, early/late by the
 * space-local day of the month — e.g. “Late spring”. The date is read
 * in the given timezone, never UTC; an unparseable date or zone returns
 * null instead of a guessed season.
 */
export function seasonLabelForDate(
  d: Date,
  timeZone: string = getSpaceTimeZone(),
): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const md = spaceLocalMonthDay(d, timeZone);
  if (!md) return null;
  const season = seasonName(md.month);
  return `${md.day <= 15 ? "Early" : "Late"} ${season}`;
}

/**
 * A stored timestamp rendered in the space's local time — the form the
 * World Changes log uses (“Oct 26, 2026, 2:14 PM”). A bare calendar
 * date is returned as its own date, never re-zoned. Returns null for
 * missing/unparseable input so callers omit the fragment instead of
 * printing a raw or “Invalid Date” string. Never UTC.
 */
export function formatWorldChangeTime(
  raw: string | null | undefined,
  timeZone: string = getSpaceTimeZone(),
): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const naive = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s);
  const d = new Date(naive ? `${s.replace(" ", "T")}Z` : s);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString(undefined, {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}
