/**
 * Ambient space soundtrack — a small PLAYLIST of bundled loops. Created lazily on
 * the first user toggle (mobile blocks autoplay until a gesture). Single element,
 * crossfaded on track change so switching isn't abrupt. Best-effort: if a file
 * can't load/play it simply no-ops.
 *
 * Tracks are gated by the Unlockables system (IM-133): the shared catalog
 * (packages/shared/src/unlockables.ts) decides which loops a brain has
 * earned — Deep Space from the start, the rest as it grows. The gate lives
 * in App (the only caller): the picker disables locked tracks and skip /
 * play advance only across unlocked ones, so this module just plays what
 * it is told to. On track change we emit a `brain-music-track` window event
 * carrying the title + position so the UI can pop a "now playing" cue and
 * show the count.
 */
import { densityBedGain, bedFilterFreq } from "./adaptiveAudio.js";
import { NARRATION_DUCK, onNarration } from "../lib/narrationBus.js";
import { audioContext } from "./sfx.js";

export interface Track {
  id: string;
  title: string;
  src: string;
}

/** The playlist. Add to this as new loops are bundled into /public. */
export const TRACKS: Track[] = [
  { id: "deep-space", title: "Deep Space", src: "/ambient-loop.mp3" },
  { id: "slow-tide", title: "Slow Tide", src: "/slow-tide.mp3" },
  { id: "interstellar", title: "Interstellar", src: "/interstellar.mp3" },
];

export interface MusicState {
  playing: boolean;
  index: number;
  title: string;
  total: number;
}

export interface AmbientAudio {
  toggle: () => boolean; // returns new playing state
  /** Advance to the next track (wraps). Starts playback if paused. */
  next: () => void;
  /** Jump to a specific track by index (wraps). Starts playback if paused. */
  playTrack: (index: number) => void;
  /** Adaptive bed (IM-135): drive the bed's gain (galaxy density ducking)
   *  and brightness filter (emotional state / mass cooling) from live
   *  galaxy data. Parameter-only — playback behaviour is unchanged. */
  setAdaptive: (state: { nodeCount: number; linkCount: number; meanEmotion: number; coolingFrac: number }) => void;
  readonly playing: boolean;
  readonly index: number;
  readonly title: string;
  readonly total: number;
}

const TARGET_VOLUME = 0.5; // leaves headroom so UI sounds sit clearly on top
const KEY_INDEX = "music.track"; // remember the last track across sessions

// Adaptive bed state (IM-135) — pure parameter math lives in adaptiveAudio.ts.

/** Broadcast the current track so the UI can show a now-playing cue + count. */
function emitTrack(state: MusicState) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<MusicState>("brain-music-track", { detail: state }));
  }
}

export function makeAmbientAudio(): AmbientAudio {
  let el: HTMLAudioElement | null = null;
  let playing = false;
  let fadeTimer: number | null = null;
  let index = 0;
  try {
    const saved = Number(localStorage.getItem(KEY_INDEX));
    if (Number.isInteger(saved) && saved >= 0 && saved < TRACKS.length) index = saved;
  } catch {
    /* ignore */
  }

  const track = () => TRACKS[index]!;
  const state = (): MusicState => ({ playing, index, title: track().title, total: TRACKS.length });

  // --- Adaptive bed (IM-135) -------------------------------------------------
  // Density ducking scales the bed's target volume; emotional state drives a
  // lowpass filter the element is routed through (once, lazily, via the shared
  // SFX context). If Web-Audio routing is unavailable the gain half still
  // applies and playback stays on the plain element path.
  let adaptiveGain = 1;
  let filterNode: BiquadFilterNode | null = null;
  let routed = false;
  // While the lore is read aloud the bed steps back (docs/specs/lore-narration-2026-10-30.md §4).
  let duck = 1;
  const effectiveTarget = () => TARGET_VOLUME * adaptiveGain * duck;

  const ensureRouted = (): boolean => {
    if (routed) return filterNode != null;
    routed = true;
    try {
      const ac = audioContext();
      const a = el;
      if (!ac || !a || typeof ac.createMediaElementSource !== "function") return false;
      const src = ac.createMediaElementSource(a);
      filterNode = ac.createBiquadFilter();
      filterNode.type = "lowpass";
      filterNode.frequency.value = bedFilterFreq(0, 0);
      src.connect(filterNode);
      filterNode.connect(ac.destination);
      void ac.resume?.();
      return true;
    } catch {
      filterNode = null;
      return false;
    }
  };

  const setAdaptive = (s: { nodeCount: number; linkCount: number; meanEmotion: number; coolingFrac: number }) => {
    adaptiveGain = densityBedGain(s.nodeCount, s.linkCount);
    if (ensureRouted() && filterNode) {
      try {
        filterNode.frequency.value = bedFilterFreq(s.meanEmotion, s.coolingFrac);
      } catch {
        /* filter is non-critical */
      }
    }
    // If we're playing and not mid-fade, ease the element toward the new target.
    if (el && playing && !fadeTimer) fadeTo(effectiveTarget(), 600);
  };

  const ensure = (): HTMLAudioElement => {
    if (el) return el;
    el = new Audio(track().src);
    el.loop = true; // infinite loop
    // "none": the 5 MB music loop downloads when someone actually plays it, not on every app start (speed audit S3).
    // The adaptive-bed routing creates this element at load time, long before any play.
    el.preload = "none";
    el.volume = 0;
    return el;
  };

  const fadeTo = (target: number, ms: number, onDone?: () => void) => {
    const a = el;
    if (!a) return;
    if (fadeTimer) window.clearInterval(fadeTimer);
    const start = a.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    fadeTimer = window.setInterval(() => {
      i++;
      a.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
      if (i >= steps) {
        if (fadeTimer) window.clearInterval(fadeTimer);
        fadeTimer = null;
        onDone?.();
      }
    }, 50);
  };

  onNarration((narrating) => {
    duck = narrating ? NARRATION_DUCK : 1;
    if (el && playing) fadeTo(effectiveTarget(), narrating ? 600 : 1200);
  });

  const toggle = (): boolean => {
    const a = ensure();
    if (playing) {
      fadeTo(0, 800, () => a.pause());
      playing = false;
    } else {
      void a.play().catch(() => {}); // gesture-driven; ignore autoplay rejections
      fadeTo(effectiveTarget(), 1500);
      playing = true;
    }
    emitTrack(state());
    return playing;
  };

  /** Load a track into the single element, crossfading out then in. */
  const loadTrack = (i: number) => {
    index = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    try {
      localStorage.setItem(KEY_INDEX, String(index));
    } catch {
      /* ignore */
    }
    const swap = () => {
      const a = ensure();
      a.src = track().src;
      a.currentTime = 0;
      if (playing) {
        void a.play().catch(() => {});
        fadeTo(effectiveTarget(), 900);
      }
      emitTrack(state());
    };
    if (el && playing) {
      fadeTo(0, 350, swap); // fade the old one down, then swap + fade up
    } else {
      swap();
    }
  };

  const next = () => {
    if (!playing) {
      // If paused, "next" both advances and starts playing (feels like skip).
      loadTrack(index + 1);
      toggle();
    } else {
      loadTrack(index + 1);
    }
  };
  const playTrack = (i: number) => {
    loadTrack(i);
    if (!playing) toggle();
  };

  // Sidechain duck: when a UI sound fires, dip the music for ~300ms so the cue
  // punches through, then ramp back. Ignored while paused/fading out.
  let duckTimer: number | null = null;
  const onDuck = () => {
    const a = el;
    if (!a || !playing) return;
    if (fadeTimer) return; // don't fight an in-progress fade in/out
    a.volume = Math.max(0, effectiveTarget() * 0.4);
    if (duckTimer) window.clearTimeout(duckTimer);
    duckTimer = window.setTimeout(() => {
      if (el && playing && !fadeTimer) fadeTo(effectiveTarget(), 280);
    }, 120);
  };
  if (typeof window !== "undefined") window.addEventListener("brain-sfx-duck", onDuck);

  // Create the element up front so the (large) file buffers before the first
  // toggle — avoids the "music takes a while to start" lag. Loading without
  // playing is allowed on mobile (no gesture needed to preload).
  ensure();

  return {
    toggle,
    next,
    playTrack,
    setAdaptive,
    get playing() {
      return playing;
    },
    get index() {
      return index;
    },
    get title() {
      return track().title;
    },
    get total() {
      return TRACKS.length;
    },
  };
}
