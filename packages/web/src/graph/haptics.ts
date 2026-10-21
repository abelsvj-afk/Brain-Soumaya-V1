/**
 * Haptics (IM-134) — `navigator.vibrate` paired with the audio audit's two
 * Critical moments (memory saved, achievement unlock) plus light UI taps on
 * mobile (docs/UX_AUDIO_HABIT_AUDIT.md:34,44,50).
 *
 * Gating (all must pass, mirroring the SFX rules in graph/sfx.ts):
 *  - the browser actually supports vibration (feature-detect; desktop and
 *    unsupported browsers are a silent no-op, never a crash);
 *  - reduced motion is NOT in effect (graph/motion.ts is the shared source of
 *    truth — OS setting OR the in-app Settings override);
 *  - sound is not muted (the SFX master toggle, localStorage `sfx.enabled`,
 *    is the app's mute — read directly here to avoid an import cycle with
 *    sfx.ts, which calls into this module from playSfx);
 *  - haptics themselves are not explicitly disabled (`haptics.enabled`="0").
 *
 * Patterns stay short and quiet in spirit: a tap is a single 10ms pulse; the
 * two Critical moments get a distinctive but brief pattern.
 */
import { prefersReducedMotion } from "./motion.js";

export type HapticKind = "tap" | "memorySaved" | "achievement" | "complete" | "notify";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  memorySaved: 25,
  achievement: [30, 60, 30],
  complete: [15, 40, 15],
  notify: 20,
};

const HAPTICS_KEY = "haptics.enabled";
const SFX_KEY = "sfx.enabled";

/** Injectable view of the environment, so the gating logic is unit-testable. */
export interface HapticEnv {
  supported: boolean;
  reducedMotion: boolean;
  muted: boolean;
  hapticsOff: boolean;
}

export function hapticPattern(kind: HapticKind): number | number[] {
  return PATTERNS[kind];
}

/** Pure gate: may a haptic fire in this environment? */
export function hapticsAllowed(env: HapticEnv): boolean {
  return env.supported && !env.reducedMotion && !env.muted && !env.hapticsOff;
}

function currentEnv(nav: Navigator | undefined): HapticEnv {
  let muted = false;
  let hapticsOff = false;
  try {
    muted = localStorage.getItem(SFX_KEY) === "0";
    hapticsOff = localStorage.getItem(HAPTICS_KEY) === "0";
  } catch {
    /* storage unavailable — treat as unmuted/enabled */
  }
  let reduced = false;
  try {
    reduced = prefersReducedMotion();
  } catch {
    reduced = false;
  }
  return {
    supported: !!nav && typeof nav.vibrate === "function",
    reducedMotion: reduced,
    muted,
    hapticsOff,
  };
}

/**
 * Fire a haptic pattern if the gate allows. Returns true when vibration was
 * actually requested. Never throws — haptics are non-critical feedback.
 * `nav` is injectable for tests.
 */
export function triggerHaptic(kind: HapticKind, nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  try {
    if (!hapticsAllowed(currentEnv(nav))) return false;
    nav!.vibrate(hapticPattern(kind));
    return true;
  } catch {
    return false;
  }
}

/** Which SFX names carry a haptic partner (the audit's pairing rule). */
export function hapticKindForSfx(sfxName: string): HapticKind | null {
  switch (sfxName) {
    case "tap":
      return "tap";
    case "achievement":
    case "milestone":
      return "achievement";
    case "complete":
      return "complete";
    case "notify":
    case "welcome":
      return "notify";
    default:
      return null; // select/delete/dock/chime stay silent to the touch
  }
}
