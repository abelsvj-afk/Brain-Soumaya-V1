import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { SpacesRepo, SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { DbSpeechCache } from "../telegram/ttsCache.js";
import type { SynthesizedSpeech } from "../telegram/tts.js";

/**
 * ADR-018 Phase C — TTS cache + cap-claims deletion (criteria 20–22).
 *
 * Space building follows spaceAccount.test.ts's pattern: two real spaces
 * created through SpacesRepo (the same repo the HTTP auth route uses),
 * seeded with data, then one is deleted via deleteSpace — passcode +
 * exact gamer-tag confirmation, all inside the one deletion transaction.
 */

const TAG_A = "adrAlpha";
const PASS_A = "alpha-pass-123";
const TAG_B = "adrBeta";
const PASS_B = "beta-pass-1234";

function speech(byte: number): SynthesizedSpeech {
  return {
    audio: new Uint8Array([byte]),
    contentType: "audio/ogg",
    filename: "reply.ogg",
  };
}

function countWhere(h: DbHandle, table: string, spaceId: string): number {
  return (
    h.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE space_id = ?`).get(spaceId) as {
      c: number;
    }
  ).c;
}

function seedClaims(h: DbHandle, spaceId: string, keys: string[]): void {
  const stmt = h.sqlite.prepare(
    `INSERT INTO notification_cap_claims (space_id, local_day, channel, delivery_key, state)
     VALUES (?, '2026-10-21', 'telegram', ?, 'reserved')`,
  );
  for (const k of keys) stmt.run(spaceId, k);
}

describe("ADR-018 deletion — TTS cache and cap claims", () => {
  let h: DbHandle;
  let idA: string;
  let idB: string;

  beforeEach(() => {
    h = createDb(":memory:");
    const repo = new SpacesRepo(h);
    const a = repo.authOrCreate(TAG_A, PASS_A);
    const b = repo.authOrCreate(TAG_B, PASS_B);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    idA = a!.space.id;
    idB = b!.space.id;
    expect(idA).not.toBe(idB);
  });

  afterEach(() => {
    h.sqlite.close();
  });

  it("criterion 22: the deletion census explicitly includes tts_audio_cache and notification_cap_claims", () => {
    expect(SPACE_SCOPED_TABLES).toContain("tts_audio_cache");
    expect(SPACE_SCOPED_TABLES).toContain("notification_cap_claims");
  });

  it("criterion 20: deleting one space removes its cache rows and cap claims in the same transaction while retaining other spaces' rows", () => {
    const cacheA = new DbSpeechCache(h, idA);
    const cacheB = new DbSpeechCache(h, idB);
    cacheA.put("key-1", speech(1));
    cacheA.put("key-2", speech(2));
    cacheB.put("key-1", speech(3));
    seedClaims(h, idA, ["claim-a1", "claim-a2"]);
    seedClaims(h, idB, ["claim-b1"]);

    expect(countWhere(h, "tts_audio_cache", idA)).toBe(2);
    expect(countWhere(h, "notification_cap_claims", idA)).toBe(2);

    const deleted = new SpacesRepo(h).deleteSpace(idA, PASS_A, TAG_A);
    expect(deleted).toBe(true);

    // A's cache rows AND claims are gone…
    expect(countWhere(h, "tts_audio_cache", idA)).toBe(0);
    expect(countWhere(h, "notification_cap_claims", idA)).toBe(0);
    expect(cacheA.size()).toBe(0);
    expect(cacheA.get("key-1")).toBeNull();
    // …the spaces row itself is gone…
    const spaceRow = h.sqlite.prepare(`SELECT COUNT(*) AS c FROM spaces WHERE id = ?`).get(idA) as {
      c: number;
    };
    expect(spaceRow.c).toBe(0);
    // …and B is completely intact.
    expect(countWhere(h, "tts_audio_cache", idB)).toBe(1);
    expect(countWhere(h, "notification_cap_claims", idB)).toBe(1);
    expect(cacheB.get("key-1")).toEqual(speech(3));
    expect(new SpacesRepo(h).getById(idB)).toBeDefined();
  });

  it("criterion 21: a failure midway through deletion rolls back everything — cache rows and the spaces row survive", () => {
    const cacheA = new DbSpeechCache(h, idA);
    cacheA.put("key-1", speech(1));
    cacheA.put("key-2", speech(2));
    seedClaims(h, idA, ["claim-a1"]);

    // Break the deletion midway: drop a SPACE_SCOPED table that
    // deleteSpace hits AFTER tts_audio_cache / notification_cap_claims
    // in its census order (and that no earlier deletion step queries),
    // so the cache cleanup has already executed inside the transaction
    // when the failure lands.
    h.sqlite.exec(`DROP TABLE lore`);

    expect(() => new SpacesRepo(h).deleteSpace(idA, PASS_A, TAG_A)).toThrow();

    // The whole transaction rolled back: A's cache rows, claims, and
    // spaces row are ALL still present.
    expect(countWhere(h, "tts_audio_cache", idA)).toBe(2);
    expect(countWhere(h, "notification_cap_claims", idA)).toBe(1);
    expect(cacheA.get("key-1")).toEqual(speech(1));
    const spaceRow = h.sqlite.prepare(`SELECT COUNT(*) AS c FROM spaces WHERE id = ?`).get(idA) as {
      c: number;
    };
    expect(spaceRow.c).toBe(1);
    expect(new SpacesRepo(h).getById(idA)).toBeDefined();
    // B was never touched either.
    expect(new SpacesRepo(h).getById(idB)).toBeDefined();
  });
});
