import type { DbHandle } from "../db/client.js";
import type { SpeechAudioCache, SynthesizedSpeech } from "./tts.js";

/**
 * Persistent voice-note audio cache (Phase D). Synthesizing costs real money
 * per character against a small monthly quota, so an unchanged reply is
 * free while cached: audio is stored in `tts_audio_cache` under the
 * content hash from `speechCacheKey` (voice + model + prosody + normalized
 * text) and replays are served from SQLite with zero provider calls — they
 * keep working even when the quota is exhausted, and they survive restarts
 * (Fly redeploys included), unlike an in-memory cache. That is not a
 * never-twice guarantee: an entry pruned past the cap below re-synthesizes
 * (and re-bills) on its next request, concurrent misses have no
 * single-flight, and a failed cache write (non-fatal in tts.ts) caches
 * nothing.
 *
 * Bounded: at most MAX_ENTRIES rows; the oldest are pruned on write so the
 * table can't grow without limit on the Fly volume.
 */

export const TTS_CACHE_MAX_ENTRIES = 500;

interface CacheRow {
  audio: Buffer;
  content_type: string;
  filename: string;
}

export class DbSpeechCache implements SpeechAudioCache {
  constructor(private readonly h: DbHandle) {}

  get(key: string): SynthesizedSpeech | null {
    const row = this.h.sqlite
      .prepare(`SELECT audio, content_type, filename FROM tts_audio_cache WHERE cache_key = ?`)
      .get(key) as CacheRow | undefined;
    if (!row) return null;
    return {
      audio: new Uint8Array(row.audio),
      contentType: row.content_type,
      filename: row.filename,
    };
  }

  put(key: string, speech: SynthesizedSpeech): void {
    const db = this.h.sqlite;
    db.prepare(
      `INSERT INTO tts_audio_cache (cache_key, audio, content_type, filename)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO NOTHING`,
    ).run(key, Buffer.from(speech.audio), speech.contentType, speech.filename);
    // Prune oldest beyond the cap (created_at ties broken by insertion order).
    db.prepare(
      `DELETE FROM tts_audio_cache WHERE cache_key IN (
         SELECT cache_key FROM tts_audio_cache
         ORDER BY created_at DESC, rowid DESC
         LIMIT -1 OFFSET ?
       )`,
    ).run(TTS_CACHE_MAX_ENTRIES);
  }

  /** Row count — tests/diagnostics. */
  size(): number {
    const row = this.h.sqlite.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache`).get() as {
      c: number;
    };
    return row.c;
  }
}
