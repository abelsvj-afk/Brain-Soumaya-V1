import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { DbSpeechCache, TTS_CACHE_MAX_ENTRIES } from "../telegram/ttsCache.js";
import {
  createElevenLabsSynthesizer,
  getSpeechSynthesizer,
  prepareSpeech,
  type SpeechAudioCache,
  type SynthesizedSpeech,
  type TtsConfig,
} from "../telegram/tts.js";
import { resolveReplyDeps } from "../telegram/voiceReply.js";

/**
 * ADR-018 Phase C — per-space TTS cache ownership (criteria 17–19, 23, 24).
 *
 * The honest guarantee is "free while cached", not "synthesize exactly
 * once ever": eviction re-synthesizes, concurrent misses have no
 * single-flight, and a failed cache write caches nothing. These tests
 * pin the ownership boundary, the global 500-row bound, and that
 * boundary — never a lifetime exactly-once claim.
 */

const SPACE_A = "space-alpha";
const SPACE_B = "space-beta";

function speech(byte: number): SynthesizedSpeech {
  return {
    audio: new Uint8Array([byte]),
    contentType: "audio/ogg",
    filename: "reply.ogg",
  };
}

function globalCount(h: DbHandle): number {
  return (h.sqlite.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache`).get() as { c: number }).c;
}

describe("ADR-018 DbSpeechCache ownership", () => {
  let h: DbHandle;
  beforeEach(() => {
    h = createDb(":memory:");
  });
  afterEach(() => {
    h.sqlite.close();
  });

  it("criterion 17: identical cache keys in two spaces do not hit each other's audio; each space caches independently", () => {
    const a = new DbSpeechCache(h, SPACE_A);
    const b = new DbSpeechCache(h, SPACE_B);
    const key = "shared-hash-key";

    a.put(key, speech(1));
    expect(a.get(key)).toEqual(speech(1));
    // Same key, different space: a miss — B must synthesize its own audio.
    expect(b.get(key)).toBeNull();

    b.put(key, speech(2));
    expect(b.get(key)).toEqual(speech(2));
    // A's entry is untouched by B's write under the same key.
    expect(a.get(key)).toEqual(speech(1));
    expect(globalCount(h)).toBe(2);
  });

  it("criterion 18: get/put/size are ownership-scoped — size() counts only own space", () => {
    const a = new DbSpeechCache(h, SPACE_A);
    const b = new DbSpeechCache(h, SPACE_B);

    a.put("k1", speech(1));
    a.put("k2", speech(2));
    b.put("k1", speech(3));

    expect(a.size()).toBe(2);
    expect(b.size()).toBe(1);
    expect(a.get("k1")).toEqual(speech(1));
    expect(b.get("k1")).toEqual(speech(3));
    expect(a.get("missing")).toBeNull();
    expect(b.get("k2")).toBeNull();
    expect(globalCount(h)).toBe(3);
  });

  it("criterion 19: the 500-row global limit holds under interleaved inserts from multiple spaces, with no cross-hits among survivors", () => {
    const a = new DbSpeechCache(h, SPACE_A);
    const b = new DbSpeechCache(h, SPACE_B);
    const caches = [a, b] as const;
    const spaces = [SPACE_A, SPACE_B] as const;

    // 600 interleaved puts (300 per space) against the 500-row global cap.
    for (let i = 0; i < 600; i++) {
      const which = i % 2;
      caches[which]!.put(`key-${i}`, speech(i % 251));
    }

    expect(globalCount(h)).toBe(TTS_CACHE_MAX_ENTRIES);
    expect(TTS_CACHE_MAX_ENTRIES).toBe(500);
    // Per-space counts sum to the global bound.
    expect(a.size() + b.size()).toBe(500);

    // Surviving entries never cross-hit: every key was written by exactly
    // one space, so the other space's get for that key must be null even
    // when the row survives, and the owner's get must return its audio.
    const survivors = h.sqlite
      .prepare(`SELECT space_id, cache_key FROM tts_audio_cache`)
      .all() as Array<{ space_id: string; cache_key: string }>;
    expect(survivors).toHaveLength(500);
    for (const row of survivors) {
      const ownerIdx = row.space_id === SPACE_A ? 0 : 1;
      const otherIdx = 1 - ownerIdx;
      const n = Number(row.cache_key.slice("key-".length));
      expect(caches[ownerIdx]!.get(row.cache_key)).toEqual(speech(n % 251));
      expect(caches[otherIdx]!.get(row.cache_key)).toBeNull();
      expect(spaces[ownerIdx]).toBe(row.space_id);
    }
  });

  it("criterion 23: eviction ends the free-while-cached guarantee — an evicted key re-synthesizes (get returns null after prune)", () => {
    const a = new DbSpeechCache(h, SPACE_A);
    a.put("old-key", speech(9));
    expect(a.get("old-key")).toEqual(speech(9));

    // Fill past the global cap with newer entries; the oldest is pruned.
    for (let i = 0; i < TTS_CACHE_MAX_ENTRIES; i++) {
      a.put(`filler-${i}`, speech(1));
    }
    expect(a.size()).toBe(TTS_CACHE_MAX_ENTRIES);
    // Free WHILE cached only: once evicted, the lookup misses and the
    // caller re-synthesizes (and re-bills). No exactly-once claim.
    expect(a.get("old-key")).toBeNull();
  });

  it("criterion 23: two caches for the SAME space racing a miss produce exactly one row — the second put is a no-op", () => {
    const first = new DbSpeechCache(h, SPACE_A);
    const second = new DbSpeechCache(h, SPACE_A);
    const key = "race-key";

    // Concurrent-miss shape: both observe the miss before either writes
    // (no single-flight), then both put.
    expect(first.get(key)).toBeNull();
    expect(second.get(key)).toBeNull();
    first.put(key, speech(1));
    second.put(key, speech(2)); // ON CONFLICT DO NOTHING — first write wins

    expect(globalCount(h)).toBe(1);
    expect(first.size()).toBe(1);
    expect(first.get(key)).toEqual(speech(1));
    expect(second.get(key)).toEqual(speech(1));
  });

  it("criterion 23: a cache-write failure is non-fatal — the reply is still synthesized, nothing is cached, and the next identical request re-synthesizes (and re-bills)", async () => {
    const cfg: TtsConfig = {
      provider: "elevenlabs",
      apiKey: "test-key-not-real",
      voiceId: "voice-123",
      modelId: "eleven_turbo_v2_5",
      mode: "selective",
    };
    let puts = 0;
    const throwingCache: SpeechAudioCache = {
      get: () => null,
      put: () => {
        puts++;
        throw new Error("simulated cache-write failure");
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    const synth = createElevenLabsSynthesizer(cfg, fetchImpl as unknown as typeof fetch, throwingCache);
    const prepared = prepareSpeech("A reply whose audio cannot be cached.")!;

    // The write throws inside the synthesizer and is swallowed there
    // (tts.ts: cache write failure is non-fatal) — synthesis itself
    // succeeds, so the caller can still send the voice reply.
    const first = await synth.synthesize(prepared);
    expect(first).not.toBeNull();
    expect(first!.contentType).toBe("audio/ogg");
    expect(puts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Nothing was cached, so the identical reply pays for synthesis
    // again — the honest boundary of "free while cached".
    const second = await synth.synthesize(prepared);
    expect(second).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(puts).toBe(2);
  });

  it("criterion 24: cache construction does not enable TTS — resolveReplyDeps without a space leaves the cache undefined and the gate still returns null without env config", () => {
    // No spaceId → no production cache is constructed (never unscoped).
    const unscoped = resolveReplyDeps(h, {});
    expect(unscoped.cache).toBeUndefined();

    // With a spaceId the scoped cache is bound…
    const scoped = resolveReplyDeps(h, { spaceId: SPACE_A });
    expect(scoped.cache).toBeInstanceOf(DbSpeechCache);

    // …but binding a cache does not enable anything: without the
    // TELEGRAM_TTS_* env config the synthesizer gate is still null,
    // even when handed a cache (existing telegramTts gate tests cover
    // the gate itself; this pins that construction changes nothing).
    expect(getSpeechSynthesizer({}, scoped.cache)).toBeNull();
    expect(getSpeechSynthesizer({})).toBeNull();
  });
});
