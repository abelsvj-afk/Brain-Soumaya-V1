import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANION_FORM, CURRENT_KEYS, STORY_ENTRY_BY_ID, pickText, storySecondReading, type CurrentKey, type Register, type VoiceRole } from "@brain/shared";

/**
 * Lore narration (docs/specs/lore-narration-2026-10-30.md). The lore is PUBLIC canon, identical for every player, so each line is voiced ONCE per (voice, model, register, text) and
 * the audio is shared across brains on the server's volume — a one-time cost, not per-player spend. The caller names an ENTRY, never text: nobody can make this speak
 * arbitrary words on our key. No key, a cap reached or any failure ⇒ null, and the client falls back to captions + the browser's own voice. Never throws.
 */

const API = "https://api.elevenlabs.io/v1";

export interface NarrationConfig {
  apiKey: string;
  /** The narrator's voice — every role without a voice of its own is read in this one. */
  voiceId: string;
  /** The voice for a speaking role (`LORE_TTS_VOICE_<ROLE>`), else the narrator's. */
  voiceFor: (role: VoiceRole) => string;
  modelId: string;
  /** Characters of NEW synthesis allowed per calendar month (cached replays are free). */
  monthlyChars: number;
}

type Env = Record<string, string | undefined>;

/** The gate. Reuses the Telegram TTS secret if no lore-specific one is set, so the key already on Fly works. Null = narration is off (captions + browser voice only). */
export function narrationConfig(env: Env = process.env): NarrationConfig | null {
  const off = (env.LORE_TTS_ENABLED ?? "").trim().toLowerCase();
  if (off === "0" || off === "false") return null;
  const apiKey = (env.LORE_TTS_API_KEY ?? env.TELEGRAM_TTS_API_KEY)?.trim();
  const voiceId = (env.LORE_TTS_VOICE_NARRATOR ?? env.TELEGRAM_TTS_VOICE_ID)?.trim();
  if (!apiKey || !voiceId) return null;
  const cap = Number(env.LORE_TTS_MONTHLY_CHARS);
  return {
    apiKey,
    voiceId,
    voiceFor: (role) => (role !== "narrator" ? env[`LORE_TTS_VOICE_${role.toUpperCase()}`]?.trim() : undefined) || voiceId,
    // Narration is cached forever, so quality beats the Telegram replies' latency-tuned model.
    modelId: env.LORE_TTS_MODEL_ID?.trim() || "eleven_multilingual_v2",
    monthlyChars: Number.isFinite(cap) && cap > 0 ? cap : 200_000,
  };
}

/** Delivery per register (Flavour changes how it is spoken, never the words). Tuned by ear, one place. */
export const NARRATION_SETTINGS: Readonly<Record<Register, { stability: number; similarity_boost: number; style: number; speed: number }>> = {
  plain: { stability: 0.6, similarity_boost: 0.75, style: 0.2, speed: 0.92 },
  warm: { stability: 0.7, similarity_boost: 0.75, style: 0.15, speed: 0.96 },
  grave: { stability: 0.5, similarity_boost: 0.75, style: 0.35, speed: 0.85 },
};

export interface Narrated {
  audio: Buffer;
  contentType: string;
  /** Content hash — also the ETag. */
  key: string;
}

type FetchImpl = typeof fetch;

export interface NarratorDeps {
  env?: Env;
  fetchImpl?: FetchImpl;
  /** Where shared clips live (a persistent volume on Fly). */
  dir: string;
  now?: () => number;
}

/**
 * What is spoken: the entry's words in the register, its Second Reading if the brain holds a partner, and the dock stranger's tide form. All from canon — never client text.
 * Returns null for an entry with no words yet.
 */
export function narrationText(entryId: string, register: Register, found: ReadonlySet<string>, tide?: CurrentKey): string | null {
  const entry = STORY_ENTRY_BY_ID.get(entryId);
  if (!entry?.text) return null;
  let text = pickText(entry.text, register);
  if (entry.id === "companion.dock-1" && tide && register !== "plain") {
    const form = COMPANION_FORM[tide];
    text = text.replace(/^A stranger/, form.charAt(0).toUpperCase() + form.slice(1));
  }
  const second = storySecondReading(entryId, found);
  return second ? `${text} ${second}` : text;
}

export const isTide = (v: unknown): v is CurrentKey => typeof v === "string" && (CURRENT_KEYS as readonly string[]).includes(v);

export function createNarrator(deps: NarratorDeps) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<Narrated | null>>();

  const clipPath = (key: string) => join(deps.dir, `${key}.mp3`);
  const spendPath = () => join(deps.dir, `spend-${new Date(now()).toISOString().slice(0, 7)}.json`);
  const readSpend = (): number => {
    try {
      return (JSON.parse(readFileSync(spendPath(), "utf8")) as { chars: number }).chars || 0;
    } catch {
      return 0;
    }
  };

  return {
    /** The clip for these words in this register, from the shared cache or (once) from ElevenLabs. Null = no audio; the client speaks it itself. */
    async narrate(text: string, register: Register, role: VoiceRole = "narrator"): Promise<Narrated | null> {
      const cfg = narrationConfig(env);
      if (!cfg) return null;
      const settings = NARRATION_SETTINGS[register];
      const voiceId = cfg.voiceFor(role);
      const key = createHash("sha256").update([voiceId, cfg.modelId, register, JSON.stringify(settings), text].join("\n")).digest("hex");
      try {
        if (existsSync(clipPath(key))) return { audio: readFileSync(clipPath(key)), contentType: "audio/mpeg", key };
      } catch {
        /* unreadable cache entry: fall through and re-voice it */
      }
      const running = inflight.get(key);
      if (running) return running; // concurrent first listeners share ONE synthesis
      const call = (async (): Promise<Narrated | null> => {
        if (readSpend() + text.length > cfg.monthlyChars) {
          console.error("[lore-tts] monthly character cap reached — falling back to captions and the browser voice");
          return null;
        }
        try {
          const res = await fetchImpl(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": cfg.apiKey },
            body: JSON.stringify({ text, model_id: cfg.modelId, voice_settings: settings }),
          });
          if (!res.ok) {
            console.error(`[lore-tts] ElevenLabs synthesis failed: HTTP ${res.status}`);
            return null;
          }
          const audio = Buffer.from(await res.arrayBuffer());
          if (audio.byteLength === 0) return null;
          mkdirSync(deps.dir, { recursive: true });
          writeFileSync(clipPath(key), audio);
          writeFileSync(spendPath(), JSON.stringify({ chars: readSpend() + text.length }));
          return { audio, contentType: "audio/mpeg", key };
        } catch (err) {
          console.error("[lore-tts] synthesis error:", err);
          return null;
        }
      })().finally(() => inflight.delete(key));
      inflight.set(key, call);
      return call;
    },
  };
}

export type Narrator = ReturnType<typeof createNarrator>;
