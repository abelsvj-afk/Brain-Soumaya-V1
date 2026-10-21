/**
 * UI Sound Kit — dependency-free, procedural Web Audio SFX.
 *
 * Every sound is synthesized at runtime (oscillator + gain envelope), so we ship no
 * audio files and get free per-play pitch variation. One `playSfx(name)` API; a master
 * enable + volume (separate from the music, persisted in localStorage); lazy AudioContext
 * init on first gesture; and everything wrapped so a failure can never break the UI.
 * Respects reduced motion (treated as reduce-sound) unless the user opts in — via the
 * shared `graph/motion.ts` helper, so the OS setting AND the in-app Settings toggle
 * both reach it.
 */
import { prefersReducedMotion } from "./motion.js";
import { triggerHaptic, hapticKindForSfx } from "./haptics.js";

export type SfxName =
  | "tap"
  | "select"
  | "notify"
  | "achievement"
  | "delete"
  | "welcome"
  | "dock" // clamping onto the station to recharge
  | "complete" // a task/journey/agenda item finished — lighter than achievement
  | "milestone" // a bigger, tracked-number crossing (streak day, capacity, tier)
  | "chime"; // gentle one-note confirmation for a quieter save

const ENABLED_KEY = "sfx.enabled";
const VOLUME_KEY = "sfx.volume";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlay = 0; // global throttle so rapid clicks don't machine-gun

export function sfxEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    // Default on, but off if reduced motion is asked for. Reads the SHARED helper
    // (graph/motion.ts) rather than a local matchMedia copy — the local copy only saw
    // the OS setting, so flipping "Reduce motion" in Settings left sound running and
    // the app's two accessibility systems disagreed with each other.
    return !prefersReducedMotion();
  } catch {
    return true;
  }
}

export function setSfxEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (on) void playSfx("tap"); // audible confirmation when turning it on
}

export function sfxVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7; // loud enough to cut through the music
  } catch {
    return 0.7;
  }
}

export function setSfxVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
  } catch {
    /* ignore */
  }
  if (master) master.gain.value = sfxVolume();
}

/** The shared SFX AudioContext (resumed on demand) — reused by the ship engine for a
 *  gapless Web-Audio loop. Returns null where Web Audio is unavailable. */
export function audioContext(): AudioContext | null {
  return ensure();
}

function ensure(): AudioContext | null {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = sfxVolume();
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/** One shaped tone: freq (with optional glide), waveform, duration, relative gain. */
function tone(
  ac: AudioContext,
  dest: GainNode,
  opts: { freq: number; glideTo?: number; type?: OscillatorType; dur: number; gain: number; delay?: number },
): void {
  const t0 = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type ?? "sine";
  // ±4% pitch jitter so repeated cues never feel mechanical.
  const jitter = 1 + (((t0 * 1000) % 8) / 100 - 0.04);
  osc.frequency.setValueAtTime(opts.freq * jitter, t0);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glideTo * jitter), t0 + opts.dur);
  // Quick attack, smooth exponential release — no clicks.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

/** A band-pass-swept white-noise burst — the core of "whoosh"/thruster sounds. */
function noiseSweep(
  ac: AudioContext,
  dest: GainNode,
  opts: { dur: number; from: number; to: number; gain: number; q?: number; delay?: number },
): void {
  const t0 = ac.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(ac.sampleRate * opts.dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = "bandpass";
  filt.Q.value = opts.q ?? 1;
  filt.frequency.setValueAtTime(opts.from, t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t0 + Math.min(0.08, opts.dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

// Sound recipes. Short (<0.5s); the master gain scales them. Gains are punchy so a
// click reads clearly ON TOP of the ambient music (which also ducks — see below).
const RECIPES: Record<SfxName, (ac: AudioContext, dest: GainNode) => void> = {
  tap: (ac, dest) => {
    tone(ac, dest, { freq: 1650, type: "triangle", dur: 0.045, gain: 0.28 });
    tone(ac, dest, { freq: 2600, type: "sine", dur: 0.02, gain: 0.14 }); // tiny high tick for crispness
  },
  select: (ac, dest) => tone(ac, dest, { freq: 2050, type: "sine", dur: 0.09, gain: 0.26 }),
  notify: (ac, dest) => tone(ac, dest, { freq: 1320, glideTo: 1560, type: "sine", dur: 0.13, gain: 0.3 }),
  achievement: (ac, dest) => {
    tone(ac, dest, { freq: 523, type: "triangle", dur: 0.12, gain: 0.34 });
    tone(ac, dest, { freq: 659, type: "triangle", dur: 0.12, gain: 0.34, delay: 0.1 });
    tone(ac, dest, { freq: 784, type: "triangle", dur: 0.3, gain: 0.36, delay: 0.2 });
  },
  delete: (ac, dest) => tone(ac, dest, { freq: 420, glideTo: 110, type: "sawtooth", dur: 0.22, gain: 0.26 }),
  welcome: (ac, dest) => {
    tone(ac, dest, { freq: 440, type: "sine", dur: 0.3, gain: 0.3 });
    tone(ac, dest, { freq: 660, type: "sine", dur: 0.5, gain: 0.3, delay: 0.14 });
  },
  // Docking clamp: a metallic thunk + a short pneumatic hiss.
  dock: (ac, dest) => {
    tone(ac, dest, { freq: 150, glideTo: 90, type: "square", dur: 0.1, gain: 0.24 });
    noiseSweep(ac, dest, { dur: 0.2, from: 900, to: 400, gain: 0.16, q: 1.4, delay: 0.06 });
  },
  // A flat "done" — one clean beat, not a full arpeggio. `achievement` was reused
  // for every single celebration in the app (task done, journey complete, export
  // succeeded, ...), so nothing ever sounded distinct from anything else.
  complete: (ac, dest) => {
    tone(ac, dest, { freq: 587, type: "triangle", dur: 0.1, gain: 0.3 });
    tone(ac, dest, { freq: 880, type: "triangle", dur: 0.16, gain: 0.3, delay: 0.07 });
  },
  // A bigger moment than `complete` (a streak day, a fuel cap, a tier crossing) —
  // four ascending notes, longer tail than `achievement`'s three.
  milestone: (ac, dest) => {
    tone(ac, dest, { freq: 494, type: "triangle", dur: 0.1, gain: 0.32 });
    tone(ac, dest, { freq: 622, type: "triangle", dur: 0.1, gain: 0.32, delay: 0.09 });
    tone(ac, dest, { freq: 740, type: "triangle", dur: 0.1, gain: 0.34, delay: 0.18 });
    tone(ac, dest, { freq: 988, type: "triangle", dur: 0.34, gain: 0.36, delay: 0.27 });
  },
  // A quieter save confirmation — one soft note, for moments too minor for a chime
  // sequence but still worth a small audible ack.
  chime: (ac, dest) => tone(ac, dest, { freq: 1046, type: "sine", dur: 0.14, gain: 0.22 }),
};

/** Play a UI sound. No-op if disabled, unsupported, or throttled. Never throws. */
export function playSfx(name: SfxName): void {
  playSfxInternal(name, undefined);
}

/** Play a UI sound panned by on-screen position (IM-135 spatial audio):
 *  `panNdc` is the source's projected screen x in NDC (-1 left … +1 right).
 *  Falls back to centred playback where StereoPanner is unavailable. */
export function playSfxSpatial(name: SfxName, panNdc: number): void {
  playSfxInternal(name, panNdc);
}

function playSfxInternal(name: SfxName, panNdc: number | undefined): void {
  try {
    if (!sfxEnabled()) return;
    // lastPlay used to be overwritten by every sound, not just `tap` — a burst of
    // achievement/notify cues could then make the NEXT genuinely-rapid tap read
    // as throttled for a reason that had nothing to do with tapping quickly.
    if (name === "tap") {
      const now = performance.now();
      if (now - lastPlay < 45) return;
      lastPlay = now;
    }
    const ac = ensure();
    if (!ac || !master) return;
    let dest: GainNode = master;
    if (panNdc !== undefined && typeof ac.createStereoPanner === "function") {
      const panner = ac.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, Number.isFinite(panNdc) ? panNdc : 0));
      panner.connect(master);
      dest = panner as unknown as GainNode;
    }
    RECIPES[name]?.(ac, dest);
    // Haptics (IM-134): the audit pairs the Critical cues + UI taps with a
    // vibration on mobile. Gated inside haptics.ts (support / reduced-motion
    // / mute) — fire-and-forget, never throws.
    const hk = hapticKindForSfx(name);
    if (hk) triggerHaptic(hk);
    // Briefly duck the ambient music so meatier cues punch through (not the rapid tap,
    // which would make the music pump). The audio module listens for this.
    if (name !== "tap") {
      try {
        window.dispatchEvent(new CustomEvent("brain-sfx-duck"));
      } catch {
        /* no window — ignore */
      }
    }
  } catch {
    /* audio is non-critical */
  }
}
