import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { AgentLoopInput, AgentLoopResult } from "../agent/loop.js";
import {
  handleTelegramUpdate,
  tgSendVoice,
  clearTelegramHistory,
  type Send,
  type SendVoice,
  type TelegramUpdate,
} from "../telegram/bot.js";
import { deliverReply, clearChatVoiceModes } from "../telegram/voiceReply.js";
import {
  ttsConfig,
  isTtsEnabled,
  prepareSpeech,
  createElevenLabsSynthesizer,
  MemorySpeechCache,
  TELEGRAM_TTS_MAX_CHARS,
  type SpeechSynthesizer,
  type SynthesizedSpeech,
} from "../telegram/tts.js";
import { DbSpeechCache } from "../telegram/ttsCache.js";

/**
 * Phase D — Telegram voice notes behind the TELEGRAM_TTS_* gate.
 *
 * Everything is mocked: the agent loop at its module seam (same pattern as
 * telegramFallbackHistory.test.ts), ElevenLabs + Telegram via fetch stubs
 * and injected senders. NO live calls. The load-bearing assertions:
 *  - gate off ⇒ zero provider calls, zero sendVoice calls, text as today;
 *  - gate on + triggered ⇒ a conversational reply goes out as ONE voice note;
 *  - selective (the default) + no trigger ⇒ text, provider never called;
 *  - provider failure / quota 402 / sendVoice failure / over-cap ⇒ text;
 *  - an unchanged reply, replayed while cached, comes from the cache
 *    with zero further provider calls.
 */

const loopStub = vi.hoisted(() => ({
  impl: null as null | ((input: AgentLoopInput) => Promise<AgentLoopResult>),
}));

vi.mock("../agent/loop.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../agent/loop.js")>();
  return {
    ...orig,
    agentLoop: async (input: AgentLoopInput): Promise<AgentLoopResult> => {
      if (!loopStub.impl) throw new Error("loop stub not configured");
      return loopStub.impl(input);
    },
  };
});

const TTS_ENV_KEYS = [
  "TELEGRAM_TTS_ENABLED",
  "TELEGRAM_TTS_API_KEY",
  "TELEGRAM_TTS_VOICE_ID",
  "TELEGRAM_TTS_PROVIDER",
  "TELEGRAM_TTS_MODEL_ID",
  "TELEGRAM_TTS_MODE",
] as const;

let savedEnv: Record<string, string | undefined>;

function clearTtsEnv() {
  for (const k of TTS_ENV_KEYS) delete process.env[k];
}
function setTtsEnvOn() {
  process.env.TELEGRAM_TTS_ENABLED = "1";
  process.env.TELEGRAM_TTS_API_KEY = "test-key-not-real";
  process.env.TELEGRAM_TTS_VOICE_ID = "voice-123";
}

const fakeAudioFetch = (status = 200) =>
  vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  }));

describe("ttsConfig — the gate", () => {
  it("is off when nothing is set", () => {
    expect(ttsConfig({})).toBeNull();
    expect(isTtsEnabled({})).toBe(false);
  });

  it("is off when the enable flag is missing or not truthy", () => {
    const base = { TELEGRAM_TTS_API_KEY: "k", TELEGRAM_TTS_VOICE_ID: "v" };
    expect(ttsConfig(base)).toBeNull();
    expect(ttsConfig({ ...base, TELEGRAM_TTS_ENABLED: "0" })).toBeNull();
    expect(ttsConfig({ ...base, TELEGRAM_TTS_ENABLED: "yes" })).toBeNull();
    expect(ttsConfig({ ...base, TELEGRAM_TTS_ENABLED: "off" })).toBeNull();
  });

  it("is off when enabled but key or voice id is missing/blank", () => {
    expect(ttsConfig({ TELEGRAM_TTS_ENABLED: "1", TELEGRAM_TTS_VOICE_ID: "v" })).toBeNull();
    expect(ttsConfig({ TELEGRAM_TTS_ENABLED: "1", TELEGRAM_TTS_API_KEY: "k" })).toBeNull();
    expect(
      ttsConfig({ TELEGRAM_TTS_ENABLED: "1", TELEGRAM_TTS_API_KEY: "  ", TELEGRAM_TTS_VOICE_ID: "v" }),
    ).toBeNull();
  });

  it("is off for an unknown provider — never guesses a billing endpoint", () => {
    expect(
      ttsConfig({
        TELEGRAM_TTS_ENABLED: "1",
        TELEGRAM_TTS_API_KEY: "k",
        TELEGRAM_TTS_VOICE_ID: "v",
        TELEGRAM_TTS_PROVIDER: "something-else",
      }),
    ).toBeNull();
  });

  it("returns the full config when enabled + complete, with the default model", () => {
    const cfg = ttsConfig({
      TELEGRAM_TTS_ENABLED: "true",
      TELEGRAM_TTS_API_KEY: "k",
      TELEGRAM_TTS_VOICE_ID: "v",
    });
    expect(cfg).toEqual({
      provider: "elevenlabs",
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_turbo_v2_5",
      mode: "selective",
    });
    expect(
      isTtsEnabled({ TELEGRAM_TTS_ENABLED: "TRUE", TELEGRAM_TTS_API_KEY: "k", TELEGRAM_TTS_VOICE_ID: "v" }),
    ).toBe(true);
  });

  it("mode defaults to selective; only the exact value 'all' speaks every reply", () => {
    const base = { TELEGRAM_TTS_ENABLED: "1", TELEGRAM_TTS_API_KEY: "k", TELEGRAM_TTS_VOICE_ID: "v" };
    expect(ttsConfig(base)!.mode).toBe("selective");
    expect(ttsConfig({ ...base, TELEGRAM_TTS_MODE: "all" })!.mode).toBe("all");
    expect(ttsConfig({ ...base, TELEGRAM_TTS_MODE: "ALL" })!.mode).toBe("all");
    expect(ttsConfig({ ...base, TELEGRAM_TTS_MODE: "everything" })!.mode).toBe("selective");
  });
});

describe("prepareSpeech — dramatize prosody adaptation", () => {
  it("strips the citation footer and markdown chrome", () => {
    const p = prepareSpeech("**Bold** news: [read this](https://x.y) now.\n\n— from: Note A · Note B");
    expect(p).not.toBeNull();
    expect(p!.text).toBe("Bold news: read this now.");
  });

  it("returns null for empty / whitespace-only replies", () => {
    expect(prepareSpeech("   \n ")).toBeNull();
  });

  it("returns null past the length cap, and accepts text at the cap", () => {
    expect(prepareSpeech("a".repeat(TELEGRAM_TTS_MAX_CHARS + 1))).toBeNull();
    expect(prepareSpeech("a".repeat(TELEGRAM_TTS_MAX_CHARS))).not.toBeNull();
  });

  it("a heavy reply is spoken slower than a bright one (dramatize prosodyFor)", () => {
    const bright = prepareSpeech("What a joyful, beautiful win — I am so grateful and excited!");
    const heavy = prepareSpeech("I carry a heavy grief about the loss, and the pain is real.");
    expect(bright).not.toBeNull();
    expect(heavy).not.toBeNull();
    expect(heavy!.speed).toBeLessThan(bright!.speed);
    // ElevenLabs ranges: speed 0.7..1.2, stability 0..1.
    for (const p of [bright!, heavy!]) {
      expect(p.speed).toBeGreaterThanOrEqual(0.7);
      expect(p.speed).toBeLessThanOrEqual(1.2);
      expect(p.stability).toBeGreaterThanOrEqual(0);
      expect(p.stability).toBeLessThanOrEqual(1);
    }
  });
});

describe("ElevenLabs synthesizer (fetch mocked — no live calls)", () => {
  const cfg = { provider: "elevenlabs" as const, apiKey: "test-key-not-real", voiceId: "voice-123", modelId: "eleven_turbo_v2_5", mode: "selective" as const };

  it("posts to the voice endpoint asking for OGG/Opus and returns the audio", async () => {
    const fetchImpl = fakeAudioFetch();
    const synth = createElevenLabsSynthesizer(cfg, fetchImpl as unknown as typeof fetch);
    const prepared = prepareSpeech("Hello there, bright and joyful day!")!;
    const out = await synth.synthesize(prepared);
    expect(out).not.toBeNull();
    expect(out!.contentType).toBe("audio/ogg");
    expect(out!.filename).toBe("reply.ogg");
    expect(out!.audio.byteLength).toBe(4);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/voice-123");
    expect(url).toContain("output_format=opus_48000_64");
    const headers = init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("test-key-not-real");
    const body = JSON.parse(init.body as string) as {
      text: string;
      model_id: string;
      voice_settings: { speed: number; stability: number };
    };
    expect(body.text).toBe(prepared.text);
    expect(body.model_id).toBe("eleven_turbo_v2_5");
    expect(body.voice_settings.speed).toBe(prepared.speed);
    expect(body.voice_settings.stability).toBe(prepared.stability);
  });

  it("returns null on a provider error status (caller falls back to text)", async () => {
    const synth = createElevenLabsSynthesizer(cfg, fakeAudioFetch(500) as unknown as typeof fetch);
    expect(await synth.synthesize(prepareSpeech("hello")!)).toBeNull();
  });

  it("returns null on HTTP 402 quota exhaustion (caller falls back to text)", async () => {
    const synth = createElevenLabsSynthesizer(cfg, fakeAudioFetch(402) as unknown as typeof fetch);
    expect(await synth.synthesize(prepareSpeech("hello")!)).toBeNull();
  });

  it("CACHE: an unchanged reply is free while cached — the replay makes zero provider calls", async () => {
    const fetchImpl = fakeAudioFetch();
    const synth = createElevenLabsSynthesizer(cfg, fetchImpl as unknown as typeof fetch, new MemorySpeechCache());
    const prepared = prepareSpeech("The very same reply, word for word.")!;
    const first = await synth.synthesize(prepared);
    const second = await synth.synthesize(prepared);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // A different text is a different cache entry.
    await synth.synthesize(prepareSpeech("A different reply entirely.")!);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null when the network throws", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    const synth = createElevenLabsSynthesizer(cfg, throwing as unknown as typeof fetch);
    expect(await synth.synthesize(prepareSpeech("hello")!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deliverReply — unit level
// ---------------------------------------------------------------------------

describe("deliverReply", () => {
  let texts: string[];
  let voices: { chatId: number; speech: SynthesizedSpeech }[];
  let send: Send;
  let sendVoice: SendVoice;

  beforeEach(() => {
    texts = [];
    voices = [];
    send = async (chatId, text) => {
      texts.push(text);
    };
    sendVoice = async (chatId, speech) => {
      voices.push({ chatId, speech });
      return true;
    };
  });

  const okSynth: SpeechSynthesizer = {
    synthesize: async () => ({ audio: new Uint8Array([9]), contentType: "audio/ogg", filename: "reply.ogg" }),
  };

  it("sends text when the synthesizer is null (gate off)", async () => {
    const how = await deliverReply(send, { sendVoice, synthesizer: null }, 1, "hello");
    expect(how).toBe("text");
    expect(texts).toEqual(["hello"]);
    expect(voices).toHaveLength(0);
  });

  it("sends text and never synthesizes when no voice sender is wired", async () => {
    const synthSpy = vi.fn(okSynth.synthesize);
    const how = await deliverReply(send, { synthesizer: { synthesize: synthSpy } }, 1, "hello");
    expect(how).toBe("text");
    expect(synthSpy).not.toHaveBeenCalled();
    expect(texts).toEqual(["hello"]);
  });

  it("SELECTIVE (default) + no trigger: text, and the provider is never called", async () => {
    const synthSpy = vi.fn(okSynth.synthesize);
    const how = await deliverReply(send, { sendVoice, synthesizer: { synthesize: synthSpy } }, 1, "hello friend");
    expect(how).toBe("text");
    expect(synthSpy).not.toHaveBeenCalled();
    expect(texts).toEqual(["hello friend"]);
    expect(voices).toHaveLength(0);
  });

  it("sends a voice note when the chat opted in (selective trigger) — no text copy", async () => {
    const how = await deliverReply(
      send,
      { sendVoice, synthesizer: okSynth },
      1,
      "hello friend",
      { chatOptedIn: true },
    );
    expect(how).toBe("voice");
    expect(voices).toHaveLength(1);
    expect(voices[0]!.chatId).toBe(1);
    expect(texts).toHaveLength(0);
  });

  it("sends a voice note in mode=all without any trigger, and on a voiceTrigger in selective mode", async () => {
    expect(
      await deliverReply(send, { sendVoice, synthesizer: okSynth }, 1, "hello friend", { mode: "all" }),
    ).toBe("voice");
    expect(
      await deliverReply(send, { sendVoice, synthesizer: okSynth }, 1, "hello friend", { voiceTrigger: true }),
    ).toBe("voice");
    expect(voices).toHaveLength(2);
  });

  it("falls back to text when synthesis returns null (provider failure)", async () => {
    const failSynth: SpeechSynthesizer = { synthesize: async () => null };
    const how = await deliverReply(send, { sendVoice, synthesizer: failSynth }, 1, "hello friend", { mode: "all" });
    expect(how).toBe("text");
    expect(texts).toEqual(["hello friend"]);
    expect(voices).toHaveLength(0);
  });

  it("falls back to text when sendVoice reports failure", async () => {
    const badVoice: SendVoice = async () => false;
    const how = await deliverReply(send, { sendVoice: badVoice, synthesizer: okSynth }, 1, "hello friend", { mode: "all" });
    expect(how).toBe("text");
    expect(texts).toEqual(["hello friend"]);
  });

  it("falls back to text past the length cap WITHOUT calling the provider", async () => {
    const synthSpy = vi.fn(okSynth.synthesize);
    const long = "word ".repeat(TELEGRAM_TTS_MAX_CHARS); // well past the cap
    const how = await deliverReply(send, { sendVoice, synthesizer: { synthesize: synthSpy } }, 1, long, { mode: "all" });
    expect(how).toBe("text");
    expect(synthSpy).not.toHaveBeenCalled();
    expect(texts).toEqual([long]);
    expect(voices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bot integration — the reply path through handleTelegramUpdate
// ---------------------------------------------------------------------------

describe("bot reply path with the env gate", () => {
  let handle: DbHandle;
  let ctx: AppContext;
  let outbox: { chatId: number; text: string }[];
  let voiceCalls: { chatId: number; speech: SynthesizedSpeech }[];

  const send: Send = async (chatId, text) => {
    outbox.push({ chatId, text });
  };
  const sendVoice: SendVoice = async (chatId, speech) => {
    voiceCalls.push({ chatId, speech });
    return true;
  };
  const update = (chatId: number, text: string): TelegramUpdate => ({
    message: { chat: { id: chatId }, text },
  });

  beforeEach(() => {
    savedEnv = {};
    for (const k of TTS_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    handle = createDb(":memory:");
    ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    };
    outbox = [];
    voiceCalls = [];
    loopStub.impl = async () => ({ text: "Here is your answer, plain and simple." });
    clearTelegramHistory();
    clearChatVoiceModes();
  });

  afterEach(() => {
    handle.sqlite.close();
    vi.unstubAllGlobals();
    for (const k of TTS_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function linkAndAsk(deps: { sendVoice?: SendVoice; synthesizer?: SpeechSynthesizer | null }) {
    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, deps);
    outbox = [];
    await handleTelegramUpdate(ctx, update(7, "what do you remember?"), send, deps);
  }

  it("GATE OFF: zero provider/voice calls — the reply is text, exactly as before", async () => {
    clearTtsEnv();
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be touched");
    });
    vi.stubGlobal("fetch", fetchSpy);

    await linkAndAsk({ sendVoice }); // synthesizer resolves from env → off

    expect(fetchSpy).not.toHaveBeenCalled(); // no ElevenLabs call possible
    expect(voiceCalls).toHaveLength(0); // no sendVoice
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("GATE OFF when env is partially set (flag on, no key): still zero calls", async () => {
    process.env.TELEGRAM_TTS_ENABLED = "1"; // key + voice missing → incomplete → off
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be touched");
    });
    vi.stubGlobal("fetch", fetchSpy);

    await linkAndAsk({ sendVoice });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("GATE ON + MODE=all: the reply is delivered as one voice note via the env-built synthesizer", async () => {
    setTtsEnvOn();
    process.env.TELEGRAM_TTS_MODE = "all";
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await linkAndAsk({ sendVoice });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0]! as unknown as [string];
    expect(url).toContain("api.elevenlabs.io/v1/text-to-speech/voice-123");
    expect(voiceCalls).toHaveLength(1);
    expect(voiceCalls[0]!.chatId).toBe(7);
    expect(voiceCalls[0]!.speech.contentType).toBe("audio/ogg");
    // …and no text copy of the reply was sent.
    expect(outbox).toHaveLength(0);
  });

  it("GATE ON + provider failure (HTTP 500): falls back to the text reply", async () => {
    setTtsEnvOn();
    process.env.TELEGRAM_TTS_MODE = "all";
    vi.stubGlobal("fetch", fakeAudioFetch(500));

    await linkAndAsk({ sendVoice });

    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("GATE ON + quota exhausted (HTTP 402): text fallback, and the conversation keeps going", async () => {
    setTtsEnvOn();
    process.env.TELEGRAM_TTS_MODE = "all";
    vi.stubGlobal("fetch", fakeAudioFetch(402));

    await linkAndAsk({ sendVoice });
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");

    // The next turn works exactly the same — chat never breaks over credits.
    outbox = [];
    await handleTelegramUpdate(ctx, update(7, "and another thing?"), send, { sendVoice });
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("GATE ON + over-cap reply: text fallback, provider never called", async () => {
    setTtsEnvOn();
    process.env.TELEGRAM_TTS_MODE = "all";
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);
    loopStub.impl = async () => ({ text: "detail ".repeat(300) }); // 2100 chars > cap

    await linkAndAsk({ sendVoice });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text.length).toBe(2100);
  });

  it("GATE ON + SELECTIVE (default): a plain question gets TEXT — provider never called", async () => {
    setTtsEnvOn(); // no TELEGRAM_TTS_MODE → selective, no opt-in yet
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await linkAndAsk({ sendVoice });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("SELECTIVE + /voice on: replies are spoken until /voice off", async () => {
    setTtsEnvOn();
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, { sendVoice });
    await handleTelegramUpdate(ctx, update(7, "/voice on"), send, { sendVoice });
    expect(outbox.at(-1)!.text).toMatch(/Voice replies ON/);
    outbox = [];

    await handleTelegramUpdate(ctx, update(7, "what do you remember?"), send, { sendVoice });
    expect(voiceCalls).toHaveLength(1);
    expect(outbox).toHaveLength(0);

    await handleTelegramUpdate(ctx, update(7, "/voice off"), send, { sendVoice });
    outbox = [];
    await handleTelegramUpdate(ctx, update(7, "what do you remember?"), send, { sendVoice });
    expect(voiceCalls).toHaveLength(1); // unchanged — back to text
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("/voice on with the GATE OFF is refused honestly — no toggle, no spend", async () => {
    clearTtsEnv();
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, { sendVoice });
    await handleTelegramUpdate(ctx, update(7, "/voice on"), send, { sendVoice });
    // REG-023: plain language — the refusal names no env var, file, or
    // internal setting key.
    expect(outbox.at(-1)!.text).toMatch(/aren't turned on for this brain yet/i);
    expect(outbox.at(-1)!.text).not.toMatch(/TELEGRAM_TTS|env|setting/i);

    outbox = [];
    await handleTelegramUpdate(ctx, update(7, "what do you remember?"), send, { sendVoice });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toBe("Here is your answer, plain and simple.");
  });

  it("CACHE: the same reply twice is free while cached (second send = DB cache hit, zero provider calls)", async () => {
    setTtsEnvOn();
    process.env.TELEGRAM_TTS_MODE = "all";
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await linkAndAsk({ sendVoice }); // 1st ask → synthesis + cache write
    await handleTelegramUpdate(ctx, update(7, "say it again?"), send, { sendVoice }); // same reply text

    expect(voiceCalls).toHaveLength(2); // both delivered as voice…
    expect(fetchSpy).toHaveBeenCalledTimes(1); // …but paid for only once
    const linkedSpaceId = (
      handle.sqlite.prepare(`SELECT space_id FROM telegram_links WHERE chat_id = 7`).get() as {
        space_id: string;
      }
    ).space_id;
    expect(new DbSpeechCache(handle, linkedSpaceId).size()).toBe(1);
  });

  it("a user VOICE MESSAGE triggers a spoken reply in selective mode — and its replay is free while cached", async () => {
    setTtsEnvOn(); // selective; no /voice opt-in
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const voiceUpdate = (chatId: number): TelegramUpdate => ({
      message: { chat: { id: chatId }, voice: { file_id: "file-1", duration: 4 } },
    });

    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, { sendVoice });
    outbox = [];
    await handleTelegramUpdate(ctx, voiceUpdate(7), send, { sendVoice });
    expect(voiceCalls).toHaveLength(1); // she speaks back because you spoke
    expect(outbox).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The canned reply text is constant → the second voice note replays from cache.
    await handleTelegramUpdate(ctx, voiceUpdate(7), send, { sendVoice });
    expect(voiceCalls).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a user voice message with the GATE OFF gets the same explanation as text", async () => {
    clearTtsEnv();
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);
    const voiceUpdate = (chatId: number): TelegramUpdate => ({
      message: { chat: { id: chatId }, voice: { file_id: "file-1", duration: 4 } },
    });

    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, { sendVoice });
    outbox = [];
    await handleTelegramUpdate(ctx, voiceUpdate(7), send, { sendVoice });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(voiceCalls).toHaveLength(0);
    expect(outbox.at(-1)!.text).toMatch(/can't transcribe/i);
  });

  it("command replies stay text even with the gate on (voice is for conversational replies)", async () => {
    setTtsEnvOn();
    const fetchSpy = fakeAudioFetch();
    vi.stubGlobal("fetch", fetchSpy);

    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send, { sendVoice });
    expect(voiceCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outbox.at(-1)!.text).toMatch(/linked/i);
  });
});

// ---------------------------------------------------------------------------
// DbSpeechCache — the persistent cache (survives restarts by construction)
// ---------------------------------------------------------------------------

describe("DbSpeechCache", () => {
  let h: DbHandle;
  beforeEach(() => {
    h = createDb(":memory:");
  });
  afterEach(() => {
    h.sqlite.close();
  });

  it("round-trips audio and is readable from a NEW cache instance (restart-safe)", () => {
    const TEST_SPACE = "space-tts-test";
    const speech: SynthesizedSpeech = {
      audio: new Uint8Array([5, 6, 7]),
      contentType: "audio/ogg",
      filename: "reply.ogg",
    };
    new DbSpeechCache(h, TEST_SPACE).put("key-1", speech);
    const fresh = new DbSpeechCache(h, TEST_SPACE); // a "restarted" process over the same DB
    expect(fresh.get("key-1")).toEqual(speech);
    expect(fresh.get("never-synthesized")).toBeNull();
    expect(fresh.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// tgSendVoice — the real Telegram sender, fetch mocked
// ---------------------------------------------------------------------------

describe("tgSendVoice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs multipart form to sendVoice with chat_id + the audio blob", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const speech: SynthesizedSpeech = {
      audio: new Uint8Array([1, 2]),
      contentType: "audio/ogg",
      filename: "reply.ogg",
    };
    await expect(tgSendVoice("TOKEN", 42, speech)).resolves.toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendVoice");
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    const voice = form.get("voice") as File;
    expect(voice).toBeInstanceOf(Blob);
    expect(voice.name).toBe("reply.ogg");
    expect(voice.type).toBe("audio/ogg");
  });

  it("returns false on a Telegram error status and on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400 })),
    );
    const speech: SynthesizedSpeech = {
      audio: new Uint8Array([1]),
      contentType: "audio/ogg",
      filename: "reply.ogg",
    };
    await expect(tgSendVoice("TOKEN", 42, speech)).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(tgSendVoice("TOKEN", 42, speech)).resolves.toBe(false);
  });
});

// REG-023 (TG-07): /voice status speaks in plain language — no env var,
// file, or internal setting key in any user-facing Telegram string.
// Grep-verifiable: the only TELEGRAM_TTS_* mentions left are in code
// comments and test scaffolding, never in a reply string.
describe("REG-023 /voice status in plain language", () => {
  let handle: DbHandle;
  let ctx: AppContext;
  let outbox: { chatId: number; text: string }[];

  const send: Send = async (chatId, text) => {
    outbox.push({ chatId, text });
  };
  const update = (chatId: number, text: string): TelegramUpdate => ({
    message: { chat: { id: chatId }, text },
  });

  beforeEach(() => {
    savedEnv = {};
    for (const k of TTS_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    handle = createDb(":memory:");
    ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    };
    outbox = [];
    loopStub.impl = async () => ({ text: "Here is your answer, plain and simple." });
    clearTelegramHistory();
    clearChatVoiceModes();
  });

  afterEach(() => {
    handle.sqlite.close();
    vi.unstubAllGlobals();
    for (const k of TTS_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("gate-off refusal names no env var or internal key", async () => {
    clearTtsEnv();
    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send);
    await handleTelegramUpdate(ctx, update(7, "/voice"), send);
    const text = outbox.at(-1)!.text;
    expect(text).toMatch(/aren't turned on for this brain yet/i);
    expect(text).not.toMatch(/TELEGRAM_TTS|_[A-Z]{2,}_|server mode|selective/i);
  });

  it("status with the gate on states ON/OFF and scope in plain words", async () => {
    setTtsEnvOn();
    await handleTelegramUpdate(ctx, update(7, "/link soumaya hunter222"), send);
    await handleTelegramUpdate(ctx, update(7, "/voice"), send);
    const off = outbox.at(-1)!.text;
    expect(off).toMatch(/Voice replies for this chat: OFF/i);
    expect(off).toMatch(/my replies stay text/i);
    expect(off).not.toMatch(/server mode|selective/i);

    await handleTelegramUpdate(ctx, update(7, "/voice on"), send);
    await handleTelegramUpdate(ctx, update(7, "/voice"), send);
    const on = outbox.at(-1)!.text;
    expect(on).toMatch(/Voice replies for this chat: ON/i);
    expect(on).toMatch(/short answers are spoken/i);
    expect(on).not.toMatch(/server mode|selective/i);
  });
});
