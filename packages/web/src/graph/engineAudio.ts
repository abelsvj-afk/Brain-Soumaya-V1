import { sfxEnabled, sfxVolume, audioContext } from "./sfx.js";

/**
 * Soumaya's ship engine — real recordings. A short IGNITION (`/ship-engine-start.mp3`)
 * spools up when you focus on her, then a sustained THRUSTER LOOP (`/ship-engine-loop.wav`)
 * that is only audible WHILE SHE'S MOVING and fades to silence when she stops.
 *
 * Two fixes over the old version:
 *  - the ignition is capped to a couple of seconds (the file is long); it fades out and the
 *    loop takes over;
 *  - the loop plays through the shared Web-Audio context as a looping AudioBufferSourceNode,
 *    which is GAPLESS — an HTMLAudio `loop` re-buffers at the seam and you heard the restart.
 *
 * The caller feeds `focus` (0..1, is the camera on her) and `motion` (0..1, how fast she's
 * flying) each frame. Best-effort + gated by the interface-sounds setting.
 */
export interface EngineAudio {
  /** `pan` (IM-135): the ship's projected screen x in NDC (-1..1); the
   *  thruster loop is stereo-panned to follow her across the screen. */
  setLevel: (focus: number, motion: number, pan?: number) => void;
  dispose: () => void;
}

const MASTER = 0.9;
const STARTUP_MS = 2200; // cut the long ignition down to a quick spool-up
const FADE_MS = 450; // how long the ignition fades out before the loop carries on

export function makeEngineAudio(): EngineAudio {
  let focusTarget = 0;
  let motionTarget = 0;
  let loopCur = 0; // eased loop level (focus × motion)
  let disposed = false;
  let raf: number | null = null;

  // Ignition (one-shot HTMLAudio).
  let startEl: HTMLAudioElement | null = null;
  let ignitedAt = 0;

  // Thruster loop (gapless Web Audio).
  let buffer: AudioBuffer | null = null;
  let loading = false;
  let src: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let panNode: StereoPannerNode | null = null;
  let panTarget = 0;

  const ensureStart = () => {
    if (startEl) return;
    try {
      startEl = new Audio("/ship-engine-start.mp3");
      startEl.preload = "auto";
      startEl.volume = 0;
    } catch {
      /* Audio unavailable */
    }
  };

  const ensureBuffer = () => {
    if (buffer || loading) return;
    const ac = audioContext();
    if (!ac) return;
    loading = true;
    fetch("/ship-engine-loop.wav")
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .then((buf) => { buffer = buf; })
      .catch(() => { /* engine loop is non-critical */ })
      .finally(() => { loading = false; });
  };

  const startLoop = (ac: AudioContext) => {
    if (src || !buffer) return;
    if (!gainNode) {
      gainNode = ac.createGain();
      gainNode.gain.value = 0;
      // Spatial (IM-135): route the loop through a StereoPanner so the ship's
      // engine follows her on-screen position; centred fallback if unsupported.
      if (typeof ac.createStereoPanner === "function") {
        panNode = ac.createStereoPanner();
        panNode.pan.value = panTarget;
        gainNode.connect(panNode);
        panNode.connect(ac.destination);
      } else {
        gainNode.connect(ac.destination);
      }
    }
    src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true; // gapless — the whole point
    src.connect(gainNode);
    try { src.start(); } catch { /* already started / bad state */ }
  };

  const stopLoop = () => {
    if (!src) return;
    try { src.stop(); } catch { /* ignore */ }
    try { src.disconnect(); } catch { /* ignore */ }
    src = null;
  };

  let enabled = false;
  let userVol = 1;
  let settingsAt = 0;
  let lastT = 0;

  const frame = (t: number) => {
    if (disposed) return;
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
    lastT = t;
    if (t - settingsAt > 300) {
      settingsAt = t;
      enabled = sfxEnabled();
      userVol = sfxVolume();
    }
    // Ease the loop level toward focus×motion — fast attack, gentle release.
    const wanted = focusTarget * motionTarget;
    const rate = wanted > loopCur ? 7 : 3;
    loopCur += (wanted - loopCur) * Math.min(1, rate * dt);
    const g = MASTER * userVol;

    // --- IGNITION: fires when you START focusing on her; short + capped. ---
    const focusOn = enabled && focusTarget > 0.05;
    if (focusOn) {
      ensureStart();
      if (!ignitedAt && startEl) {
        ignitedAt = t;
        try { startEl.currentTime = 0; void startEl.play().catch(() => {}); } catch { /* blocked until gesture */ }
      }
      if (startEl && ignitedAt) {
        const age = t - ignitedAt;
        if (age >= STARTUP_MS) {
          if (!startEl.paused) startEl.pause();
        } else {
          const fade = age > STARTUP_MS - FADE_MS ? Math.max(0, (STARTUP_MS - age) / FADE_MS) : 1;
          startEl.volume = Math.min(1, focusTarget * g * 0.8 * fade);
        }
      }
    } else {
      ignitedAt = 0;
      if (startEl && !startEl.paused) startEl.pause();
    }

    // --- THRUSTER LOOP: audible only while she's actually moving. ---
    const loopOn = enabled && loopCur > 0.02;
    if (loopOn) {
      const ac = audioContext();
      ensureBuffer();
      if (ac && buffer) {
        startLoop(ac);
        if (gainNode) gainNode.gain.value = Math.min(1, loopCur * g);
        if (panNode) panNode.pan.value = panTarget;
      }
    } else if (src) {
      stopLoop();
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    setLevel: (focus: number, motion: number, pan?: number) => {
      focusTarget = Math.max(0, Math.min(1, focus));
      motionTarget = Math.max(0, Math.min(1, motion));
      if (pan !== undefined && Number.isFinite(pan)) panTarget = Math.max(-1, Math.min(1, pan));
    },
    dispose: () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      stopLoop();
      try { startEl?.pause(); } catch { /* ignore */ }
      startEl = null;
      buffer = null;
    },
  };
}
