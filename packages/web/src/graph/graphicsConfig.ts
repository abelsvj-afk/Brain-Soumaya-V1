/**
 * Adaptive graphics configuration — one place that decides how heavy the 3D galaxy
 * renders, so a flagship phone gets the cinematic experience and a budget phone gets
 * the SAME app, just optimized (never a stripped feature set). Graph3D CONSUMES this;
 * it never decides performance itself.
 *
 * Modes: auto (detect the device) · performance · balanced · quality. Individual
 * knobs (bloom, star density, particles, animation, render resolution, battery saver,
 * FPS cap) can be overridden in Settings. Everything persists in localStorage so the
 * pilot never reconfigures. An FPS monitor can suggest Performance Mode if it's rough.
 */

// Type-only — adaptiveController.ts imports GraphicsMode/etc back from this module, but
// both directions are `import type`, so they're erased at compile time and never form a
// real runtime circular dependency.
import type { RungSettings } from "./adaptiveController.js";

export type GraphicsMode = "auto" | "performance" | "balanced" | "quality";
export type Level = "low" | "medium" | "high";
export type RenderQuality = "auto" | Level;
export type FpsCap = 30 | 45 | 60;

export interface GraphicsSettings {
  mode: GraphicsMode;
  bloom: boolean;
  starDensity: Level;
  particles: Level;
  animationQuality: Level;
  renderQuality: RenderQuality;
  batterySaver: boolean;
  fpsCap: FpsCap;
  /** Force the heavy background scenery on/off, or leave it to the tier ("auto").
   *  Lets you perf-test the full scenery on any device without switching whole modes. */
  sceneryOverride?: "auto" | "on" | "off";
}

/** The concrete numbers Graph3D reads each build/settings-change. */
export interface ResolvedGraphics {
  bloom: boolean;
  bloomStrength: number;
  starCount: number;
  /** 0..1 multipliers the scene systems can scale their work by. Consumed today only by
   *  TimelineView's river-of-memories effect (packet count / twinkle gating) — NOT the
   *  galaxy itself. Kept for that consumer; don't expect these to affect Graph3D. */
  particleScale: number;
  animationScale: number;
  pixelRatio: number;
  fpsCap: number;
  /** Render the deep-space backdrop (nebula clouds / distant galaxies / dust)? On by
   *  default on every tier (Stage 3 baked it into a one-time cubemap, so the per-frame
   *  cost is cheap regardless of device) — a perf-testing/battery-saver lever, not a
   *  "cheap phones get less" switch. In auto mode, the Stage 6 adaptive controller can
   *  also turn it off, but only once real measurement has pushed the device all the way
   *  down to rung 0 — see adaptiveController.ts's own doc comment. */
  heavyScenery: boolean;
  /** The tier that was detected (for diagnostics + the Settings label) — a one-shot
   *  guess made before any real measurement exists. */
  tier: "performance" | "balanced" | "quality";
  /** Performance Program Stage 6: the tier ACTUALLY used for star-light-pool size,
   *  baked-backdrop resolution, and shader (octave/geometry) detail — in "auto" mode
   *  this is driven by the adaptive controller's measured rung and can differ from
   *  `tier` once it climbs or descends; in an explicit mode it just equals `tier`
   *  (an explicit pick is a stated preference, left untouched by the controller for
   *  now). Deliberately narrow: only these three consumers key off it — starCount,
   *  particles, animation, label-fade distances, and TimelineView's own scene stay on
   *  the coarse `tier` exactly as before, since the controller's rung ladder was never
   *  meant to touch them. */
  detailTier: "performance" | "balanced" | "quality";
}

const KEY = "brain.graphics";

// Bloom (UnrealBloomPass) allocates several full-screen render targets and is the
// #1 cause of a phone stalling on the first WebGL frame — so it's OFF for everything
// except the top "quality" tier. Reliability first; the cinematic look is opt-in.
const PRESETS: Record<"performance" | "balanced" | "quality", Omit<GraphicsSettings, "mode">> = {
  performance: { bloom: false, starDensity: "low", particles: "low", animationQuality: "low", renderQuality: "low", batterySaver: false, fpsCap: 30 },
  balanced: { bloom: false, starDensity: "medium", particles: "medium", animationQuality: "medium", renderQuality: "low", batterySaver: false, fpsCap: 45 },
  quality: { bloom: true, starDensity: "high", particles: "high", animationQuality: "high", renderQuality: "high", batterySaver: false, fpsCap: 60 },
};

/**
 * Detect a rough capability tier (cheap, synchronous, best-effort) — used only as the
 * FIRST-FRAME SEED before any real measurement exists. Performance Program Stage 6's
 * adaptive controller (adaptiveController.ts) takes over within seconds of the first
 * render and climbs or descends from here based on actually-measured frame cost, so
 * this heuristic no longer needs to be the last word — it only has to get a fresh
 * session started somewhere reasonable. Still deliberately conservative (better to
 * start low and climb than stall the first frame), but the old `dpr >= 3` penalty was
 * removed: it scored a SHARP screen down, which is backwards — a high-DPI phone is
 * usually a capable one, and penalizing it is exactly the "cheap phones get the same
 * app, better phones get punished for looking good" outcome this whole program exists
 * to avoid. Screen sharpness is a rendering COST, not a capability signal; DPR is
 * already capped elsewhere (`pixelRatio`) by tier/battery-saver, which is where a real
 * cost concern belongs.
 */
export function detectTier(): "performance" | "balanced" | "quality" {
  try {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 3; // GB; unknown → low-ish
    const cores = navigator.hardwareConcurrency ?? 4;
    const minSide = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768);
    let score = 0;
    if (mem <= 3) score -= 2;
    else if (mem >= 8) score += 2;
    else if (mem >= 6) score += 1;
    if (cores <= 4) score -= 1;
    else if (cores >= 8) score += 1;
    if (minSide <= 480) score -= 1; // small phone screen
    if (score <= 1) return "performance"; // bias low — a seed, not a verdict
    if (score >= 3) return "quality";
    return "balanced";
  } catch {
    return "performance";
  }
}

export function defaultSettings(): GraphicsSettings {
  return { mode: "auto", ...PRESETS[detectTier()] };
}

export function getGraphics(): GraphicsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
      return { ...defaultSettings(), ...parsed };
    }
  } catch {
    /* ignore */
  }
  return defaultSettings();
}

type Listener = (s: GraphicsSettings) => void;
const listeners = new Set<Listener>();
export function onGraphicsChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function persistAndEmit(s: GraphicsSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l(s);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("brain-graphics-change"));
}

/** Switch mode: a preset seeds all fields (auto seeds from the detected tier). */
export function setGraphicsMode(mode: GraphicsMode): GraphicsSettings {
  const preset = mode === "auto" ? PRESETS[detectTier()] : PRESETS[mode];
  const next: GraphicsSettings = { mode, ...preset };
  persistAndEmit(next);
  return next;
}

/** Override one individual knob (keeps the current mode; it's now effectively custom). */
export function setGraphicsField<K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]): GraphicsSettings {
  const next = { ...getGraphics(), [key]: value };
  persistAndEmit(next);
  return next;
}

const STAR = { low: 1200, medium: 3500, high: 6500 } as const;
const PARTICLE = { low: 0.35, medium: 0.7, high: 1 } as const;
const ANIM = { low: 0.5, medium: 0.8, high: 1 } as const;

/** Translate the stored settings into the concrete numbers Graph3D consumes.
 *
 * `rung` (Performance Program Stage 6, auto mode only): the adaptive controller's
 * currently-learned rung, when the caller has one — overrides `pixelRatio`/`bloom`/
 * `bloomStrength`/`detailTier` with measurement-driven values instead of the static
 * per-tier preset. An explicit Performance/Balanced/Quality pick is a stated
 * preference and is intentionally left on its fixed preset (untouched by `rung`) — see
 * `ResolvedGraphics.detailTier`'s doc comment for why this is scoped narrowly. */
export function resolveGraphics(s: GraphicsSettings = getGraphics(), rung?: RungSettings): ResolvedGraphics {
  const detected = detectTier();
  const tier = s.mode === "auto" ? detected : s.mode;
  // In auto mode the device decides; otherwise honor the stored (possibly custom) fields.
  const eff: Omit<GraphicsSettings, "mode"> = s.mode === "auto" ? { ...PRESETS[tier] } : s;
  const dpr = window.devicePixelRatio || 1;
  const useRung = s.mode === "auto" && rung != null;
  const detailTier = useRung ? rung!.detailTier : tier;

  const tierCap = useRung ? rung!.pixelRatioCap : tier === "performance" ? 1 : tier === "balanced" ? 1.5 : 2;
  let pixelRatio: number;
  switch (eff.renderQuality) {
    case "low": pixelRatio = 1; break;
    case "medium": pixelRatio = Math.min(1.5, dpr); break;
    case "high": pixelRatio = Math.min(2, dpr); break;
    default: pixelRatio = Math.min(dpr, tierCap); // "auto"
  }

  let bloom = useRung ? rung!.bloom : eff.bloom;
  let fpsCap: number = eff.fpsCap;
  if (eff.batterySaver) {
    bloom = false;
    fpsCap = Math.min(fpsCap, 30);
    pixelRatio = Math.min(pixelRatio, 1);
  }

  return {
    bloom,
    bloomStrength: bloom ? (useRung ? rung!.bloomStrength : eff.animationQuality === "high" ? 0.3 : 0.22) : 0, // UX review #5: was 0.4/0.3 — glow washed out labels and the scene
    starCount: STAR[eff.starDensity],
    particleScale: PARTICLE[eff.particles],
    animationScale: ANIM[eff.animationQuality],
    pixelRatio,
    fpsCap,
    // On by default for EVERY tier, not just "quality" — the deep-space backdrop is
    // procedural and already tier-scaled internally (makeDeepSpace's own density knob),
    // and per-tier gating here previously did nothing at all (this knob had zero
    // consumers until now — see GEMINI_CHANGES.md). Wiring it to actually gate the
    // backdrop must not, on its own, remove scenery from mid/low-tier phones that were
    // already rendering it; only an explicit override or Battery Saver turns it off.
    // In auto mode with an active rung, the adaptive controller gets ONE more say: a
    // device that has genuinely measured its way down to rung 0 (see
    // adaptiveController.ts's own doc comment — every rung above 0 keeps this on) loses
    // it too, as the last lever after DPR/detail/bloom are already at their floor. This
    // is real measurement, not a first-frame guess, so it never contradicts "give every
    // device the full experience by default" — it only ever removes something from a
    // device that's already proven, live, that it can't afford the cheapest preset.
    heavyScenery:
      s.sceneryOverride === "on"
        ? true
        : s.sceneryOverride === "off"
          ? false
          : useRung
            ? rung!.heavyScenery && !eff.batterySaver
            : !eff.batterySaver,
    tier,
    detailTier,
  };
}

export const GRAPHICS_MODES: { id: GraphicsMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Match your device" },
  { id: "performance", label: "Performance", hint: "Smoothest on weaker phones" },
  { id: "balanced", label: "Balanced", hint: "Good looks + speed" },
  { id: "quality", label: "Quality", hint: "Full cinematic galaxy" },
];
