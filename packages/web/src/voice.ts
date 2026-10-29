/**
 * Soumaya's voice. Uses the browser's built-in SpeechSynthesis (free, offline,
 * no API) but works hard to NOT sound like a robot:
 *  - it picks the most natural-sounding installed English voice (preferring the
 *    modern neural ones, never the flat eSpeak default),
 *  - it speaks sentence-by-sentence with small prosody jitter so the cadence
 *    breathes instead of droning, and
 *  - it bends rate/pitch to the conversation's emotional tone (the dramatization
 *    filter on the server hands us the tone; `prosodyFor` turns it into delivery).
 */
import { type EmotionalTone, NEUTRAL_TONE, prosodyFor } from "@brain/shared";

export function isVoiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Voice on/off is a per-device preference (localStorage) — it's a client setting,
// not brain data, so it stays out of the shared/global settings table.
const VOICE_PREF_KEY = "soumaya.voice";
export function isVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_PREF_KEY) === "on";
  } catch {
    return false;
  }
}
export function setVoiceEnabled(on: boolean): void {
  try {
    localStorage.setItem(VOICE_PREF_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (!on) stopSpeaking();
}

// Voices populate asynchronously on some browsers; keep the latest list around.
let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices(): SpeechSynthesisVoice[] {
  if (!isVoiceSupported()) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length > 0) cachedVoices = v;
  return cachedVoices;
}
if (isVoiceSupported()) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
}

// Ranked preferences — modern, warm, natural voices first; eSpeak/"default" last.
const PREFERRED = [
  "samantha", "ava", "allison", "serena", "google uk english female",
  "google us english", "microsoft aria", "microsoft jenny", "microsoft michelle",
  "zira", "fiona", "moira", "tessa", "karen", "female",
];

let chosen: SpeechSynthesisVoice | null = null;
export function pickVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;
  if (chosen && voices.includes(chosen)) return chosen;
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length > 0 ? en : voices;
  for (const want of PREFERRED) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(want));
    if (hit) return (chosen = hit);
  }
  // Avoid the obviously robotic ones if anything else is available.
  const nonRobot = pool.find((v) => !/espeak|robot|default/i.test(v.name));
  return (chosen = nonRobot ?? pool[0] ?? null);
}

/** Let the user pin a specific voice (by name) from a settings dropdown. */
export function setVoiceByName(name: string): void {
  const hit = loadVoices().find((v) => v.name === name);
  if (hit) chosen = hit;
}

export function listEnglishVoices(): SpeechSynthesisVoice[] {
  return loadVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
}

export function stopSpeaking(): void {
  if (isVoiceSupported()) window.speechSynthesis.cancel();
}

/**
 * CH-09: her replies are Markdown on screen (rendered via MarkdownView) —
 * read aloud, the markup itself must never be spoken ("asterisk asterisk",
 * heading hashes, backticks). Strip it to the words the screen shows.
 * Applied centrally in speak(): ChatDock's performSend is speak()'s only
 * caller, so no call site can bypass it.
 */
export function stripMarkdownForSpeech(text: string): string {
  return text
    // Code fences: keep the code's words, drop the fence lines.
    .replace(/```[^\n]*\n?/g, "")
    // Images and links become their visible text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Emphasis / strike markers (paired delimiters only).
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1$2")
    // Inline code backticks.
    .replace(/`([^`]*)`/g, "$1")
    // Line-leading structure: headings, blockquotes, list bullets, rules.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");
}

const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]*/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [text];

/**
 * Speak `text` aloud with delivery shaped by `tone`. Cancels anything already
 * speaking. `onBoundary` fires per sentence (handy for a "speaking…" indicator).
 */
export function speak(
  text: string,
  tone: EmotionalTone = NEUTRAL_TONE,
  opts: { onStart?: () => void; onEnd?: () => void } = {},
): void {
  if (!isVoiceSupported() || !text.trim()) {
    opts.onEnd?.();
    return;
  }
  stopSpeaking();
  const voice = pickVoice();
  const base = prosodyFor(tone);
  const sentences = splitSentences(stripMarkdownForSpeech(text));
  let started = false;

  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    // Per-sentence jitter (±) so the delivery breathes instead of droning.
    const jitter = (Math.sin(i * 1.7) * 0.5 + (Math.random() - 0.5)) * 0.04;
    u.rate = Math.max(0.6, Math.min(1.4, base.rate + jitter));
    u.pitch = Math.max(0.6, Math.min(1.6, base.pitch + jitter * 1.5));
    u.volume = base.volume;
    if (i === 0)
      u.onstart = () => {
        if (!started) {
          started = true;
          opts.onStart?.();
        }
      };
    if (i === sentences.length - 1) u.onend = () => opts.onEnd?.();
    window.speechSynthesis.speak(u);
  });
}
