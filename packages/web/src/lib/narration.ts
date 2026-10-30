import type { CurrentKey, Register } from "@brain/shared";
import { API, afetch } from "../api/http.js";
import { speak, stopSpeaking } from "../voice.js";
import { emitNarration } from "./narrationBus.js";

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

export function stopNarration(): void {
  current?.stop();
  current = null;
  stopSpeaking();
}

/** Resolve a clip URL for an entry, or null when the server has none (204) or anything fails. */
async function clipFor(entryId: string, register: Register, tide: CurrentKey | undefined): Promise<string | null> {
  try {
    const q = new URLSearchParams({ register });
    if (tide) q.set("tide", tide);
    const res = await afetch(`${API}/story/narration/${encodeURIComponent(entryId)}?${q.toString()}`);
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
}

/** Start reading. Returns which voice is used. Starting a new one stops the old. */
export async function playNarration(o: NarrationOpts): Promise<"clip" | "voice" | "none"> {
  if (getNarrationMode() === "off") return "none";
  stopNarration();
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    emitNarration(false);
    current = null;
    o.onEnd?.();
  };
  const url = await clipFor(o.entryId, o.register, o.tide);
  if (url) {
    const audio = new Audio(url);
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
      current = null;
      finished = true;
      emitNarration(false);
      finished = false;
    }
  }
  emitNarration(true);
  current = { stop: () => done() };
  speak(o.text, undefined, { onEnd: done });
  return "voice";
}
