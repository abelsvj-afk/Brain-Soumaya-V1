import { createHash } from "node:crypto";
import { toneFrom, prosodyFor, type EmotionalTone } from "@brain/shared";

/**
 * Phase D — spoken Telegram replies via cloud TTS (plans/telegram-and-autonomy.md).
 *
 * HARD GATE: this feature is DISABLED by default and can only turn on when ALL
 * of the `TELEGRAM_TTS_*` env vars are present and the enable flag is set:
 *
 *   TELEGRAM_TTS_ENABLED=1            (exactly "1" or "true", case-insensitive)
 *   TELEGRAM_TTS_API_KEY=<key>       (ElevenLabs API key — a Fly secret, never committed)
 *   TELEGRAM_TTS_VOICE_ID=<voice id>  (ElevenLabs voice to speak in)
 *   TELEGRAM_TTS_PROVIDER=elevenlabs (optional; the only provider implemented)
 *   TELEGRAM_TTS_MODEL_ID=<model>    (optional; default eleven_turbo_v2_5)
 *   TELEGRAM_TTS_MODE=selective|all  (optional; default selective — see bot.ts:
 *                                     selective speaks only for chats that opted
 *                                     in with /voice on, plus voice-triggered
 *                                     replies; `all` speaks every reply)
 *
 * `ttsConfig()` is the single truth source. When it returns null the feature
 * is OFF and it is IMPOSSIBLE to spend: `getSpeechSynthesizer()` returns null,
 * `deliverReply` (bot.ts) never synthesizes and never calls sendVoice, and the
 * bot behaves byte-for-byte as it did before this module existed. The offline
 * path (no keys at all) is therefore never broken — same contract as the LLM /
 * embedding provider seams.
 *
 * Why a cloud API: the web app's read-aloud (web/src/voice.ts) is browser
 * speech synthesis and cannot run server-side. ElevenLabs returns audio
 * natively; we request `opus_48000_64` (OGG/Opus), which Telegram's sendVoice
 * accepts for voice notes.
 */

/**
 * Replies longer than this are sent as text, never synthesized. Rationale:
 * ~1,000 chars is roughly 1–1.5 minutes of speech — a sane ceiling for a
 * voice note — and it bounds per-reply TTS spend (TTS bills per character).
 * Long-form output (digests, cited answers) stays readable text.
 */
export const TELEGRAM_TTS_MAX_CHARS = 1000;

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";

/** When enabled, WHICH conversational replies get spoken. */
export type TtsMode = "selective" | "all";

export interface TtsConfig {
  provider: "elevenlabs";
  apiKey: string;
  voiceId: string;
  modelId: string;
  mode: TtsMode;
}

type Env = Record<string, string | undefined>;

const flagOn = (v: string | undefined) => {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true";
};

/**
 * The gate. Returns a complete config ONLY when TTS is explicitly enabled AND
 * fully configured; null otherwise (disabled, incomplete, unknown provider).
 */
export function ttsConfig(env: Env = process.env): TtsConfig | null {
  if (!flagOn(env.TELEGRAM_TTS_ENABLED)) return null;
  const provider = (env.TELEGRAM_TTS_PROVIDER ?? "elevenlabs").trim().toLowerCase();
  if (provider !== "elevenlabs") return null; // unknown provider → off, never guess
  const apiKey = env.TELEGRAM_TTS_API_KEY?.trim();
  const voiceId = env.TELEGRAM_TTS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;
  const modelId = env.TELEGRAM_TTS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  // Spend-safety: only the exact value "all" opts into speak-every-reply.
  // Anything else (unset, typo) stays selective — the cheaper failure mode.
  const mode: TtsMode =
    (env.TELEGRAM_TTS_MODE ?? "").trim().toLowerCase() === "all" ? "all" : "selective";
  return { provider: "elevenlabs", apiKey, voiceId, modelId, mode };
}

/** True only when voice replies are enabled AND fully configured. */
export function isTtsEnabled(env: Env = process.env): boolean {
  return ttsConfig(env) !== null;
}

// ---------------------------------------------------------------------------
// Speech preparation — dramatize.ts prosody, adapted for a cloud voice.
//
// The plan says: "Reuse the shared/dramatize.ts tone to pick prosody."
// dramatize's `toneFrom` reads the reply's emotional weather; `prosodyFor`
// maps it onto SpeechSynthesis rate/pitch. ElevenLabs has no pitch knob, but
// its `voice_settings.speed` is the same idea as rate (we clamp dramatize's
// 0.7..1.25 rate into ElevenLabs' 0.7..1.2 speed range), and `stability`
// is its expressiveness knob — a more intense tone gets a less stable (more
// expressive) delivery, a calm one stays steady. That is the genuine fit;
// pitch/volume have no server-side analogue and are deliberately not faked.
// ---------------------------------------------------------------------------

export interface PreparedSpeech {
  /** Cleaned, speakable text (markdown/citation chrome stripped). */
  text: string;
  tone: EmotionalTone;
  /** ElevenLabs voice_settings derived from dramatize prosody. */
  speed: number;
  stability: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Adapt a chat reply for spoken delivery. Returns null when there is nothing
 * speakable or the reply exceeds TELEGRAM_TTS_MAX_CHARS — callers fall back
 * to text in both cases.
 */
export function prepareSpeech(raw: string): PreparedSpeech | null {
  const text = raw
    // The GraphRAG citation footer ("— from: a · b") is reading chrome, not speech.
    .replace(/\n+\s*— from:.*$/s, "")
    // Markdown links read as their label; images drop entirely.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Emphasis / code / heading markers are visual only.
    .replace(/[*_~`#]+/g, "")
    // Bullets become pauses, not the word "bullet".
    .replace(/^\s*[•·-]\s+/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text || text.length > TELEGRAM_TTS_MAX_CHARS) return null;
  const tone = toneFrom(text);
  const prosody = prosodyFor(tone);
  return {
    text,
    tone,
    speed: clamp(prosody.rate, 0.7, 1.2),
    // Intensity 0 → 0.75 (steady); intensity 1 → 0.4 (expressive). Floor keeps
    // the voice intelligible; ceiling keeps calm replies from going monotone-flat.
    stability: clamp(0.75 - tone.intensity * 0.35, 0.3, 0.85),
  };
}

// ---------------------------------------------------------------------------
// Provider seam — mirrors llm/adapter.ts + embeddings/adapter.ts: an interface
// with swappable implementations and a null (unconfigured) state, so no
// feature ever hard-depends on a cloud key.
// ---------------------------------------------------------------------------

export interface SynthesizedSpeech {
  /** Always ArrayBuffer-backed (fresh synthesis copies the response body;
   *  the cache copies out of the DB row) — the send path wraps it directly
   *  in a Blob, which requires an ArrayBuffer-backed view. */
  audio: Uint8Array<ArrayBuffer>;
  contentType: string;
  /** Filename Telegram shows for the voice note upload. */
  filename: string;
}

export interface SpeechSynthesizer {
  /**
   * Synthesize prepared speech. Returns null on ANY failure (provider error,
   * quota exhaustion, network, empty audio) — never throws into the reply
   * path; null means the caller falls back to the text reply.
   */
  synthesize(prepared: PreparedSpeech): Promise<SynthesizedSpeech | null>;
}

// ---------------------------------------------------------------------------
// Audio cache — replays are FREE. Synthesized audio is cached under a hash of
// (voice, model, prosody, normalized text): an unchanged reply synthesizes
// exactly once, ever. A cache hit makes ZERO provider calls, so repeats keep
// working even after the monthly quota is exhausted. Two implementations:
// MemorySpeechCache (tests / no-DB callers) and DbSpeechCache
// (telegram/ttsCache.ts — the production path, survives restarts).
// ---------------------------------------------------------------------------

export interface SpeechAudioCache {
  get(key: string): SynthesizedSpeech | null;
  put(key: string, speech: SynthesizedSpeech): void;
}

/** Cache key for one prepared utterance under one voice/model configuration. */
export function speechCacheKey(config: TtsConfig, prepared: PreparedSpeech): string {
  return createHash("sha256")
    .update(
      [
        config.provider,
        config.voiceId,
        config.modelId,
        prepared.speed.toFixed(3),
        prepared.stability.toFixed(3),
        prepared.text,
      ].join("\n"),
    )
    .digest("hex");
}

/** In-memory cache with a simple entry cap (oldest evicted first). */
export class MemorySpeechCache implements SpeechAudioCache {
  private map = new Map<string, SynthesizedSpeech>();
  constructor(private readonly maxEntries = 100) {}
  get(key: string): SynthesizedSpeech | null {
    return this.map.get(key) ?? null;
  }
  put(key: string, speech: SynthesizedSpeech): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, speech);
  }
}

type FetchImpl = typeof fetch;

/** ElevenLabs implementation: POST /text-to-speech/:voiceId, OGG/Opus out. */
export function createElevenLabsSynthesizer(
  config: TtsConfig,
  fetchImpl: FetchImpl = fetch,
  cache?: SpeechAudioCache,
): SpeechSynthesizer {
  return {
    async synthesize(prepared) {
      const key = cache ? speechCacheKey(config, prepared) : null;
      if (key && cache) {
        const hit = cache.get(key);
        if (hit) return hit; // replay — zero provider calls, zero spend
      }
      try {
        const res = await fetchImpl(
          `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(config.voiceId)}` +
            `?output_format=opus_48000_64`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "audio/ogg",
              "xi-api-key": config.apiKey,
            },
            body: JSON.stringify({
              text: prepared.text,
              model_id: config.modelId,
              voice_settings: {
                stability: prepared.stability,
                similarity_boost: 0.75,
                style: 0,
                speed: prepared.speed,
              },
            }),
          },
        );
        if (!res.ok) {
          // 402 = quota/credits exhausted. Fail SOFT: the caller sends the
          // text reply and the conversation continues — voice running out of
          // credits must never break chat. (Cached replies still play.)
          if (res.status === 402) {
            console.error(
              "[telegram-tts] ElevenLabs quota exhausted (HTTP 402) — falling back to text replies",
            );
          } else {
            console.error(`[telegram-tts] ElevenLabs synthesis failed: HTTP ${res.status}`);
          }
          return null;
        }
        const audio = new Uint8Array(await res.arrayBuffer());
        if (audio.byteLength === 0) return null;
        const speech: SynthesizedSpeech = { audio, contentType: "audio/ogg", filename: "reply.ogg" };
        if (key && cache) {
          try {
            cache.put(key, speech);
          } catch (err) {
            console.error("[telegram-tts] audio cache write failed (reply still sent):", err);
          }
        }
        return speech;
      } catch (err) {
        console.error("[telegram-tts] ElevenLabs synthesis error:", err);
        return null;
      }
    },
  };
}

/** Build the configured synthesizer, or null when the gate is off. */
export function createSpeechSynthesizer(
  config: TtsConfig | null,
  fetchImpl: FetchImpl = fetch,
  cache?: SpeechAudioCache,
): SpeechSynthesizer | null {
  if (!config) return null;
  switch (config.provider) {
    case "elevenlabs":
      return createElevenLabsSynthesizer(config, fetchImpl, cache);
  }
}

/**
 * The synthesizer for the current process env, or null when TTS is off.
 * Deliberately NOT cached: config is re-read per call so the gate state is
 * always the env's current truth (and tests can stub env freely).
 */
export function getSpeechSynthesizer(
  env: Env = process.env,
  cache?: SpeechAudioCache,
): SpeechSynthesizer | null {
  return createSpeechSynthesizer(ttsConfig(env), fetch, cache);
}
