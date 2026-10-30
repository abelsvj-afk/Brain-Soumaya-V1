import type { CurrentKey, Register } from "@brain/shared";
import { API, afetch } from "../api/http.js";
import { speak, stopSpeaking } from "../voice.js";
import { emitNarration } from "./narrationBus.js";
import { FALLBACK_CHARS_PER_SECOND } from "./captions.js";

/**
 * Reading the lore aloud (docs/specs/lore-narration-2026-10-30.md). The server voices canon text ONCE through ElevenLabs and shares the clip; here we ask for it by ENTRY (never
 * by words). If there is no clip — no key, the monthly cap, an error, offline — we read the same words with the browser's own voice. The words are on screen either way, so
 * audio is never the only carrier. While anything is being read the ambient bed ducks.
 */

export type NarrationMode = "ask" | "on" | "off";
const MODE_KEY = "soumaya.story.narration";

/** Per device: "ask" (a Listen button; default), "on" (new finds read themselves), "off". */
export function getNarrationMode(): NarrationMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "on" || v === "off" ? v : "ask";
  } catch {
    return "ask";
  }
}
export function setNarrationMode(m: NarrationMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* blocked storage: the choice lasts this session only */
  }
  if (m === "off") stopNarration();
}

let current: { stop: () => void } | null = null;

/**
 * Phones only let audio start inside the tap that asked for it, but the clip arrives a moment LATER (a network round trip). So the tap itself starts one audio element on a
 * silent sound, and the clip is then played through that same, already-allowed element. Without this the first clip is refused and the browser's own voice reads instead.
 */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
let shared: HTMLAudioElement | null = null;
function unlockedAudio(): HTMLAudioElement | null {
  try {
    if (!shared) shared = new Audio();
    shared.src = SILENCE;
    void shared.play()?.catch(() => {});
    return shared;
  } catch {
    return null;
  }
}

export function stopNarration(): void {
  current?.stop();
  current = null;
  stopSpeaking();
}

/** Resolve a clip URL for an entry, or null when the server has none (204) or anything fails. */
/** A short hash of the exact words, put in the URL so the device cache can never replay a clip over changed text (the server ignores it). */
export function textTag(text: string): string {
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 16777619);
  return (x >>> 0).toString(36);
}

async function clipFor(entryId: string, register: Register, tide: CurrentKey | undefined, text: string, reaction?: { npc: string; holds: string }): Promise<string | null> {
  try {
    const q = new URLSearchParams({ register });
    if (tide) q.set("tide", tide);
    q.set("t", textTag(text));
    if (reaction) q.set("holds", reaction.holds);
    const path = reaction ? `react/${encodeURIComponent(reaction.npc)}` : encodeURIComponent(entryId);
    const res = await afetch(`${API}/story/narration/${path}?${q.toString()}`);
    if (res.status !== 200) return null;
    const blob = await res.blob();
    return blob.size > 0 ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export interface NarrationOpts {
  entryId: string;
  register: Register;
  tide?: CurrentKey;
  /** The same words as on screen — spoken by the browser if no clip exists. */
  text: string;
  onEnd?: () => void;
  /** A person's reaction to a held thing: voiced in THEIR voice (the server names the pairing; the words never leave the client). */
  reaction?: { npc: string; holds: string };
  /** Called when the studio voice was NOT used, with a plain reason (shown in the Book so it is never a mystery). */
  onFallback?: (why: string) => void;
  /** 0..1 progress through the words, for captions that follow the voice. Exact for a clip; an estimate for the browser voice, which cannot report it. */
  onProgress?: (fraction: number) => void;
}

/** Start reading. Returns which voice is used. Starting a new one stops the old. */
export async function playNarration(o: NarrationOpts): Promise<"clip" | "voice" | "none"> {
  if (getNarrationMode() === "off") return "none";
  stopNarration();
  const el = unlockedAudio(); // synchronous: still inside the tap that asked
  let finished = false;
  let tick: number | null = null;
  const done = () => {
    if (finished) return;
    finished = true;
    if (tick !== null) window.clearInterval(tick);
    o.onProgress?.(1);
    emitNarration(false);
    current = null;
    o.onEnd?.();
  };
  const url = await clipFor(o.entryId, o.register, o.tide, o.text, o.reaction);
  if (!url) o.onFallback?.("the server has no studio clip for this line");
  if (url) {
    const audio = el ?? new Audio();
    audio.src = url;
    audio.ontimeupdate = () => {
      if (audio.duration > 0) o.onProgress?.(audio.currentTime / audio.duration);
    };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      done();
    };
    current = {
      stop: () => {
        audio.pause();
        URL.revokeObjectURL(url);
        done();
      },
    };
    try {
      emitNarration(true);
      await audio.play();
      return "clip";
    } catch {
      // Autoplay refused or a decode failure: fall through to the browser voice.
      o.onFallback?.("this device would not start the audio — tap Listen again");
      current = null;
      finished = true;
      emitNarration(false);
      finished = false;
    }
  }
  emitNarration(true);
  current = { stop: () => done() };
  // The browser voice cannot say where it is, so the captions follow a steady estimate of its pace.
  const startedAt = Date.now();
  const estimateMs = Math.max(1500, (o.text.length / FALLBACK_CHARS_PER_SECOND) * 1000);
  o.onProgress?.(0);
  tick = window.setInterval(() => o.onProgress?.(Math.min(0.97, (Date.now() - startedAt) / estimateMs)), 200);
  speak(o.text, undefined, { onEnd: done });
  return "voice";
}
