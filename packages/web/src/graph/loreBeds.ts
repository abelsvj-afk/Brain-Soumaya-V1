import { sfxEnabled, playSfx } from "./sfx.js";
import { onNarration } from "../lib/narrationBus.js";
import { WORLD_PLACE_EVENT } from "../lib/worldPlace.js";

/**
 * The lore's sound (docs/specs/muse-lore-music-beds-2026-10-30.md): four quiet looping beds that fade in under the narrator ONLY while a line is being read, and a short
 * sting when something is kept in the Book. The files are static assets; if one cannot play (blocked, missing, offline) the lore reads exactly as before and the sting falls
 * back to the synthesized one — sound is never required. The sound switch (Settings) silences all of it.
 */
export type LoreBed = "morning" | "hearth" | "hush" | "standing";

/** Which bed suits where the traveller is (the spec's table); anywhere unlisted gets the warm one. Pure. */
export function bedForWorld(world: string | null | undefined): LoreBed {
  switch (world) {
    case "deep-past":
      return "morning";
    case "quiet-archive":
    case "faded-ward":
      return "hush";
    case "eternity":
      return "standing";
    default:
      return "hearth"; // people, the growing place, the station, scale, home
  }
}

const BED_LEVEL = 0.55; // the beds are mastered quiet (~ −24 LUFS); the voice stays on top
const FADE_MS = 1400;

let world: string | null = null;
let bed: HTMLAudioElement | null = null;
let bedName: LoreBed | null = null;
let fade: number | null = null;
let wired = false;

function ramp(el: HTMLAudioElement, to: number, then?: () => void): void {
  if (fade !== null) window.clearInterval(fade);
  const from = el.volume;
  const t0 = performance.now();
  fade = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k >= 1) {
      if (fade !== null) window.clearInterval(fade);
      fade = null;
      then?.();
    }
  }, 60);
}

function startBed(): void {
  if (!sfxEnabled() || typeof Audio === "undefined") return;
  const name = bedForWorld(world);
  if (!bed || bedName !== name) {
    bed?.pause();
    bed = new Audio(`/audio/lore-bed-${name}.mp3`);
    bed.loop = true;
    bed.preload = "auto";
    bed.volume = 0;
    bedName = name;
  }
  bed.play().then(() => ramp(bed!, BED_LEVEL)).catch(() => {});
}

function stopBed(): void {
  const el = bed;
  if (el) ramp(el, 0, () => el.pause());
}

/** Wire the bed to the narration + the place (idempotent). Called by whatever starts narration; costs nothing until a line is read. */
export function ensureLoreBeds(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener(WORLD_PLACE_EVENT, (e) => {
    const d = (e as CustomEvent<{ visible?: boolean; world?: string | null }>).detail;
    world = d?.visible ? (d.world ?? null) : null;
  });
  onNarration((playing) => (playing ? startBed() : stopBed()));
}

/** The "a light is added" sting: Muse's file, else the synthesized find sound. */
export function playFindSting(): void {
  if (!sfxEnabled()) return;
  try {
    if (typeof Audio === "undefined") return playSfx("find");
    const a = new Audio("/audio/lore-sting-find.mp3");
    a.volume = 0.7;
    a.play().catch(() => playSfx("find"));
  } catch {
    playSfx("find");
  }
}
