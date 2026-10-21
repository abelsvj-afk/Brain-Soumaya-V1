/**
 * Layered adaptive ambience + spatial audio (IM-135) — the pure logic and the
 * sparse-chirp layer from docs/UX_AUDIO_HABIT_AUDIT.md Phase 2 (lines 74–86):
 *
 *  - StereoPanner positioning for ship/beacon sounds by screen position
 *    (`panForScreenX` — pure mapping, used by engineAudio + spatial SFX);
 *  - sparse randomized radio chirps, 20–60s apart (`nextChirpDelayMs`,
 *    `createChirpScheduler` — injectable clock/RNG so it is unit-testable);
 *  - density-aware ducking: the bigger/denser the galaxy, the more the bed
 *    yields (`densityBedGain`);
 *  - the bed brightens/darkens with emotional state (`bedFilterFreq`):
 *    a warm/positive galaxy sounds brighter; a galaxy full of cooling,
 *    heavy memories sounds darker.
 *
 * Everything here is gain/filter PARAMETER computation plus a thin Web-Audio
 * chirp player — per the Round-2 coordination constraint this module never
 * touches the galaxy's quality-switching, link rendering, or zoom behaviour.
 */
import { audioContext, sfxEnabled } from "./sfx.js";

/** Map an on-screen x position to a stereo pan in [-1, 1].
 *  Accepts either a normalized 0..1 position or a projection NDC x (-1..1)
 *  when `ndc` is set. Out-of-range values clamp — a ship off-screen left
 *  pans hard left, never beyond. */
export function panForScreenX(x: number, opts?: { ndc?: boolean }): number {
  if (!Number.isFinite(x)) return 0;
  const v = opts?.ndc ? x : x * 2 - 1;
  return Math.max(-1, Math.min(1, v));
}

/** Density-aware bed gain (0..1 multiplier on the ambient bed's target
 *  volume). Sparse galaxy → full bed; as nodes and link density grow the
 *  bed ducks a little so the galaxy's own life (chirps, SFX) reads on top.
 *  Floors at 0.55 — ducking, never muting. */
export function densityBedGain(nodeCount: number, linkCount: number): number {
  const n = Math.max(0, nodeCount);
  const density = n > 0 ? Math.max(0, linkCount) / n : 0; // avg links per node
  const sizeDuck = Math.min(0.3, n / 1000); // 300+ nodes → full size duck
  const densityDuck = Math.min(0.15, Math.max(0, density - 1) * 0.05);
  return Math.max(0.55, 1 - sizeDuck - densityDuck);
}

/** Bed brightness (lowpass cutoff Hz) from emotional state.
 *  `meanEmotion` is the galaxy's mean emotionalWeight (-1..1);
 *  `coolingFrac` is the share of memories at/above the cooling threshold.
 *  Bright (up to 6.5kHz) for a warm galaxy; dark (down to 900Hz) when heavy
 *  and cooling — the audit's "darkens when many memories are cooling". */
export function bedFilterFreq(meanEmotion: number, coolingFrac: number): number {
  const e = Math.max(-1, Math.min(1, Number.isFinite(meanEmotion) ? meanEmotion : 0));
  const c = Math.max(0, Math.min(1, Number.isFinite(coolingFrac) ? coolingFrac : 0));
  const bright = 3200 + e * 1800; // -1 → 1400, 0 → 3200, +1 → 5000
  const darkened = bright * (1 - 0.45 * c); // mass cooling pulls it down up to 45%
  return Math.max(900, Math.min(6500, Math.round(darkened)));
}

/** Next radio-chirp delay: uniformly random in [20s, 60s] (audit spec). */
export function nextChirpDelayMs(rand: () => number = Math.random): number {
  const r = Math.max(0, Math.min(0.999999, rand()));
  return 20000 + Math.floor(r * 40000);
}

export interface ChirpScheduler {
  start: () => void;
  stop: () => void;
  readonly running: boolean;
}

/** Schedule `onChirp` at sparse randomized 20–60s intervals. Injectable
 *  timer + RNG for tests; a chirp that throws never kills the schedule. */
export function createChirpScheduler(
  onChirp: () => void,
  opts?: {
    rand?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (h: unknown) => void;
  },
): ChirpScheduler {
  const setT = opts?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts?.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const rand = opts?.rand ?? Math.random;
  let handle: unknown = null;
  let running = false;
  const arm = () => {
    handle = setT(() => {
      if (!running) return;
      try {
        onChirp();
      } catch {
        /* a chirp is non-critical */
      }
      if (running) arm();
    }, nextChirpDelayMs(rand));
  };
  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },
    stop() {
      running = false;
      if (handle != null) clearT(handle);
      handle = null;
    },
    get running() {
      return running;
    },
  };
}

/** One distant radio chirp through a StereoPanner at the given pan:
 *  two short sine blips (the Soumaya "incoming transmission" colour, quieter). */
export function playRadioChirp(pan: number): void {
  try {
    if (!sfxEnabled()) return;
    const ac = audioContext();
    if (!ac) return;
    const dest: AudioNode = (() => {
      if (typeof ac.createStereoPanner === "function") {
        const p = ac.createStereoPanner();
        p.pan.value = panForScreenX(pan, { ndc: true });
        p.connect(ac.destination);
        return p;
      }
      return ac.destination;
    })();
    const t0 = ac.currentTime;
    for (const [i, f] of [1560, 1180].entries()) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t0 + i * 0.09);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + i * 0.09 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.08);
      osc.connect(g);
      g.connect(dest);
      osc.start(t0 + i * 0.09);
      osc.stop(t0 + i * 0.09 + 0.1);
    }
  } catch {
    /* chirps are non-critical */
  }
}
