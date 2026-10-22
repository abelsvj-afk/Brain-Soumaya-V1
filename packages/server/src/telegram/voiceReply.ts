import type { DbHandle } from "../db/client.js";
import type { Send, SendVoice } from "./bot.js";
import {
  getSpeechSynthesizer,
  isTtsEnabled,
  prepareSpeech,
  ttsConfig,
  type SpeechAudioCache,
  type SpeechSynthesizer,
  type TtsMode,
} from "./tts.js";
import { DbSpeechCache } from "./ttsCache.js";

/**
 * Phase D voice-reply policy + delivery — ALL of the TTS decision logic for
 * the Telegram bot lives here (and in tts.ts / ttsCache.ts), so bot.ts only
 * carries the minimal call sites: hand a finished reply to `deliverReply`,
 * or dispatch the /voice command / an incoming voice note to the handlers
 * below. The gate itself is telegram/tts.ts (`ttsConfig()`).
 */

/** Optional reply-path dependencies (voice notes, Phase D). */
export interface TelegramReplyDeps {
  /**
   * Voice-note sender. When absent, voice delivery is impossible and replies
   * are always text — the wiring (route) must opt in explicitly.
   */
  sendVoice?: SendVoice;
  /**
   * Speech synthesizer override (tests). `undefined` = build from the
   * TELEGRAM_TTS_* env gate (null when off); explicit null = force off.
   */
  synthesizer?: SpeechSynthesizer | null;
  /** Audio cache override. `undefined` in the handler = the persistent DB cache. */
  cache?: SpeechAudioCache;
}

/** Fill in the production defaults for a handler call (persistent DB cache). */
export function resolveReplyDeps(handle: DbHandle, deps: TelegramReplyDeps): TelegramReplyDeps {
  return { ...deps, cache: deps.cache ?? new DbSpeechCache(handle) };
}

// ---------------------------------------------------------------------------
// Voice-mode opt-in (selective TTS). The provider quota is small (~40k chars
// a month ≈ under an hour of speech), so speaking EVERY reply by default
// would burn it in days. Selective mode therefore speaks only when:
//   (a) this chat opted in with /voice on (the store below), or
//   (b) the reply answers a voice message the user sent (voiceTrigger).
// TELEGRAM_TTS_MODE=all removes the selectivity for owners who want it.
// The store is memory-only (like bot.ts's history store): a restart resets
// chats to the default — text — which is the cheap, safe direction to reset.
// ---------------------------------------------------------------------------

const voiceOptIns = new Set<string>();

const voiceKey = (spaceId: string, chatId: number) => `${spaceId} ${chatId}`;

export function setChatVoiceEnabled(spaceId: string, chatId: number, on: boolean): void {
  const key = voiceKey(spaceId, chatId);
  if (on) voiceOptIns.add(key);
  else voiceOptIns.delete(key);
}

export function isChatVoiceEnabled(spaceId: string, chatId: number): boolean {
  return voiceOptIns.has(voiceKey(spaceId, chatId));
}

/** Drop voice opt-ins — one chat (all its brains), or everything (tests). */
export function clearChatVoiceModes(chatId?: number): void {
  if (chatId == null) {
    voiceOptIns.clear();
    return;
  }
  const suffix = ` ${chatId}`;
  for (const key of [...voiceOptIns]) {
    if (key.endsWith(suffix)) voiceOptIns.delete(key);
  }
}

export interface DeliverOptions {
  /** This reply answers a voice message — a selective-mode trigger. */
  voiceTrigger?: boolean;
  /** Whether this chat opted in via /voice on. Defaults to false (safe). */
  chatOptedIn?: boolean;
  /** Resolved TTS mode. Defaults to the env gate's mode, else "selective". */
  mode?: TtsMode;
}

/**
 * Deliver one conversational reply: as a voice note when TTS is enabled AND
 * configured AND the trigger policy allows it AND the reply is speakable,
 * otherwise as text. Text is the default AND the fallback — selective-mode
 * non-triggers, over-cap replies, synthesis failure (incl. quota HTTP 402),
 * and sendVoice failure all land here, so a reply is never lost to the voice
 * path and chat never breaks because voice is unavailable. Returns how the
 * reply was delivered.
 */
export async function deliverReply(
  send: Send,
  deps: TelegramReplyDeps,
  chatId: number,
  text: string,
  opts: DeliverOptions = {},
): Promise<"voice" | "text"> {
  const synth =
    deps.synthesizer !== undefined
      ? deps.synthesizer
      : getSpeechSynthesizer(process.env, deps.cache);
  const mode = opts.mode ?? ttsConfig()?.mode ?? "selective";
  const maySpeak = mode === "all" || opts.voiceTrigger === true || opts.chatOptedIn === true;
  if (synth && deps.sendVoice && maySpeak) {
    const prepared = prepareSpeech(text); // null = unspeakable or over the length cap
    if (prepared) {
      const speech = await synth.synthesize(prepared); // null on provider failure
      if (speech && (await deps.sendVoice(chatId, speech))) return "voice";
    }
  }
  await send(chatId, text);
  return "text";
}

/** What she says back to a voice note (there is no speech-to-text path). */
export const VOICE_NOTE_REPLY =
  "🎙️ Got your voice note — I can't transcribe those yet, so nothing was saved from it. " +
  "Type it out and I'll remember it. (My own replies can be spoken too: /voice on.)";

/**
 * Handle an incoming voice note from a linked chat. Nothing can be logged or
 * answered from it without STT — say so honestly. The reply itself is a
 * selective-TTS trigger (you spoke → she speaks back) when the gate is on;
 * with the gate off it's the same words as text. The text is constant, so
 * while its entry stays cached it is served from the audio cache for free.
 */
export async function handleVoiceMessage(
  send: Send,
  deps: TelegramReplyDeps,
  chatId: number,
  spaceId: string,
): Promise<void> {
  await deliverReply(send, deps, chatId, VOICE_NOTE_REPLY, {
    voiceTrigger: true,
    chatOptedIn: isChatVoiceEnabled(spaceId, chatId),
  });
}

/**
 * The /voice command — the selective-TTS opt-in for this chat.
 * Usage: /voice (status) · /voice on · /voice off. Replies are always text
 * (command acks are not conversational replies).
 */
export async function handleVoiceCommand(
  send: Send,
  spaceId: string,
  chatId: number,
  text: string,
): Promise<void> {
  const arg = text.slice("/voice".length).trim().toLowerCase();
  if (!isTtsEnabled()) {
    await send(
      chatId,
      "🔇 Voice replies aren't enabled on this server (the TELEGRAM_TTS_* settings aren't configured), so my replies stay text.",
    );
    return;
  }
  if (arg === "on") {
    setChatVoiceEnabled(spaceId, chatId, true);
    await send(
      chatId,
      "🔊 Voice replies ON for this chat — my answers will be spoken (short ones; long answers stay text). /voice off to go back to text.",
    );
    return;
  }
  if (arg === "off") {
    setChatVoiceEnabled(spaceId, chatId, false);
    await send(chatId, "🔇 Voice replies off for this chat — text it is.");
    return;
  }
  const mode = ttsConfig()?.mode ?? "selective";
  await send(
    chatId,
    `🔊 Voice replies for this chat: ${isChatVoiceEnabled(spaceId, chatId) ? "ON" : "OFF"} · server mode: ${mode}` +
      (mode === "all" ? " (every reply is spoken)" : "") +
      "\n/voice on — hear my replies · /voice off — text only",
  );
}
