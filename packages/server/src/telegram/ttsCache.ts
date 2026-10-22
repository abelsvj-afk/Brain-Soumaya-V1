import type { DbHandle } from "../db/client.js";
import type { SpeechAudioCache, SynthesizedSpeech } from "./tts.js";

/**
 * Persistent voice-note audio cache (Phase D / ADR-018 D2). Synthesizing
 * costs real money per character against a small monthly quota, so an
 * unchanged reply is free while cached: audio is stored in
 * `tts_audio_cache` under the content hash from `speechCacheKey` (voice +
 * model + prosody + normalized text) and replays are served from SQLite
 * with zero provider calls — they keep working even when the quota is
 * exhausted, and they survive restarts (Fly redeploys included), unlike
 * an in-memory cache. That is not a never-twice guarantee: an entry
 * pruned past the cap below re-synthesizes (and re-bills) on its next
 * request, concurrent misses have no single-flight, and a failed cache
 * write (non-fatal in tts.ts) caches nothing.
 *
 * Ownership is per-space (ADR-018 D2): every row belongs to the space
 * whose private conversational context produced it. Every query is
 * scoped by `space_id` — equal text/hash across two spaces never shares
 * audio. The one exception is the bound: at most MAX_ENTRIES rows
 * GLOBALLY (not per space); the oldest are pruned on write so the table
 * can't grow without limit on the Fly volume, and one busy space may
 * evict another's entries (eviction only ever causes re-synthesis,
 * never a cross-space hit).
 */

export const TTS_CACHE_MAX_ENTRIES = 500;

interface CacheRow {
  audio: Buffer;
  content_type: string;
  filename: string;
}

export class DbSpeechCache implements SpeechAudioCache {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string,
  ) {}

  get(key: string): SynthesizedSpeech | null {
    const row = this.h.sqlite
      .prepare(
        `SELECT audio, content_type, filename FROM tts_audio_cache WHERE space_id = ? AND cache_key = ?`,
      )
      .get(this.spaceId, key) as CacheRow | undefined;
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
      `INSERT INTO tts_audio_cache (space_id, cache_key, audio, content_type, filename)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(space_id, cache_key) DO NOTHING`,
    ).run(this.spaceId, key, Buffer.from(speech.audio), speech.contentType, speech.filename);
    // Global prune (ADR-018 D2/A3): the 500-row bound is global, not
    // per-space. cache_key is no longer unique, so prune by rowid —
    // keep the newest rows ordered by created_at DESC, rowid DESC
    // (rowid is the stable insertion tie-breaker for equal timestamps).
    db.prepare(
      `DELETE FROM tts_audio_cache WHERE rowid IN (
         SELECT rowid FROM tts_audio_cache
         ORDER BY created_at DESC, rowid DESC
         LIMIT -1 OFFSET ?
       )`,
    ).run(TTS_CACHE_MAX_ENTRIES);
  }

  /** Row count for THIS SPACE only (ownership-scoped) — tests/diagnostics. */
  size(): number {
    const row = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache WHERE space_id = ?`)
      .get(this.spaceId) as {
      c: number;
    };
    return row.c;
  }
}
