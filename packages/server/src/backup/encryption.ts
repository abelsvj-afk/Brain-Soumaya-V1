/**
 * G0 backup — encryption stage (increment B2; G0 spec §3/§6, plan §3).
 *
 * AES-256-GCM via Node's built-in crypto — no new dependency. Each
 * backup gets a fresh random 12-byte nonce; the GCM auth tag (16 bytes)
 * is appended to the ciphertext, so the stored object is exactly
 * `ciphertext || authTag` and the manifest records the algorithm, the
 * nonce, and the SHA-256 of that whole stored object (the hash
 * VERIFIED-STORED re-checks after retrieval, G0-AC-03).
 *
 * Key custody (plan §3/§6): the 32-byte key is read from the
 * BACKUP_ENCRYPTION_KEY environment variable (a Fly secret in
 * production, plus the owner's offline copy). The value is NEVER logged,
 * persisted, or written into any manifest/index — documents name it
 * only. A missing or malformed key yields `null` here and the caller
 * fails the attempt closed at the encrypt stage: there is NO plaintext
 * upload path anywhere in this module's callers.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const BACKUP_ENCRYPTION_ALGORITHM = "aes-256-gcm" as const;
export type BackupEncryptionAlgorithm = typeof BACKUP_ENCRYPTION_ALGORITHM;

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/** What the manifest records about the encryption of one backup (spec §1/§3). Never key material. */
export interface BackupEncryptionRecord {
  algorithm: BackupEncryptionAlgorithm;
  /** base64-encoded 12-byte nonce. */
  nonce: string;
  /** SHA-256 (hex) of the stored ciphertext object (ciphertext || authTag). */
  ciphertextSha256: string;
  /** Byte size of the stored ciphertext object. */
  ciphertextBytes: number;
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Read the backup encryption key from the environment.
 * Accepts base64 (the documented form) or 64-char hex, in STRICT
 * canonical form: Node's base64 decoder silently ignores characters
 * outside the alphabet, so a corrupted secret could otherwise decode
 * to a plausible-but-wrong 32 bytes and be discovered only at restore
 * time (review P2). Canonical round-trip equality is required.
 * Returns null when unset or malformed — callers must fail closed on
 * null, never fall back to anything else.
 */
export function loadBackupEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const raw = env.BACKUP_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return null;
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== trimmed) {
    return null;
  }
  return key;
}

export interface EncryptResult {
  /** Stored-object bytes: ciphertext || authTag. */
  ciphertext: Buffer;
  record: BackupEncryptionRecord;
}

export function encryptBuffer(plaintext: Buffer, key: Buffer): EncryptResult {
  if (key.length !== KEY_BYTES) {
    throw new Error(`backup encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);
  return {
    ciphertext,
    record: {
      algorithm: BACKUP_ENCRYPTION_ALGORITHM,
      nonce: nonce.toString("base64"),
      ciphertextSha256: sha256Buffer(ciphertext),
      ciphertextBytes: ciphertext.length,
    },
  };
}

/**
 * Decrypt a stored object (ciphertext || authTag) with the nonce from
 * the manifest record. Throws on a wrong key, a tampered object, or a
 * malformed nonce/tag — GCM authentication failure is the rejection
 * (a flipped byte can never decrypt into silently-wrong plaintext).
 */
export function decryptBuffer(ciphertext: Buffer, key: Buffer, nonceBase64: string): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`backup encryption key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  // A tag-only object (exactly AUTH_TAG_BYTES) is the legitimate
  // encryption of an empty plaintext — only shorter is malformed.
  if (ciphertext.length < AUTH_TAG_BYTES) {
    throw new Error("ciphertext object too short to carry an auth tag");
  }
  const nonce = Buffer.from(nonceBase64, "base64");
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`backup nonce must be ${NONCE_BYTES} bytes, got ${nonce.length}`);
  }
  const body = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(BACKUP_ENCRYPTION_ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
