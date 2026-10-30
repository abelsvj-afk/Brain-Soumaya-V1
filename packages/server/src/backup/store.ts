/**
 * G0 backup — off-volume object store (increment B2; G0 spec §3).
 *
 * The lifecycle talks to ONE narrow interface, `BackupObjectStore`, so
 * the gate runs against an in-memory fake and production runs against
 * Cloudflare R2 (owner decision, plan §6) through its S3-compatible API.
 * The S3 client below is deliberately minimal — PutObject / GetObject /
 * DeleteObject / ListObjectsV2 with AWS SigV4 signing from Node's
 * built-in crypto and the global fetch — because those four operations
 * are all a backup store needs, and the repo gains no new dependency.
 *
 * Configuration comes from the environment, by NAME only (values are
 * secrets and are never logged): BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET,
 * BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY, and optionally
 * BACKUP_R2_REGION (default "auto", R2's region). Until the owner
 * creates the bucket + API token in Cloudflare and sets those as Fly
 * secrets, `loadS3StoreConfig` returns null and the upload stage is
 * unconfigured — callers report that, they never invent an endpoint.
 */
import { createHash, createHmac } from "node:crypto";

/** Object layout inside the bucket. Deterministic per backup id. */
export const BACKUP_INDEX_KEY = "backup-index.json";
export function snapshotObjectKey(backupId: string): string {
  return `backups/${backupId}/snapshot.enc`;
}
export function manifestObjectKey(backupId: string): string {
  return `backups/${backupId}/manifest.json`;
}

export interface BackupObjectStore {
  putObject(key: string, body: Buffer): Promise<void>;
  /** Resolves null when the object does not exist; throws on other errors. */
  getObject(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing object is not an error. */
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<string[]>;
}

/** In-memory store for tests — the gate never needs a live bucket. */
export class InMemoryBackupStore implements BackupObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async putObject(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
  }

  async getObject(key: string): Promise<Buffer | null> {
    const found = this.objects.get(key);
    return found ? Buffer.from(found) : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async listObjects(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Test helper: every key currently held, sorted. */
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

// ── S3-compatible store (Cloudflare R2) ───────────────────────────────

export interface S3StoreConfig {
  /** e.g. https://<account-id>.r2.cloudflarestorage.com (no trailing slash). */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** SigV4 region; R2 uses "auto". */
  region: string;
}

/** Null unless ALL of endpoint/bucket/credentials are configured. */
export function loadS3StoreConfig(env: NodeJS.ProcessEnv = process.env): S3StoreConfig | null {
  const endpoint = env.BACKUP_R2_ENDPOINT?.trim();
  const bucket = env.BACKUP_R2_BUCKET?.trim();
  const accessKeyId = env.BACKUP_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.BACKUP_R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.BACKUP_R2_REGION?.trim() || "auto",
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeKeyPath(key: string): string {
  // SigV4 URI-encoding: encodeURIComponent leaves !'()* unescaped,
  // which SigV4's encode set does not allow (review P2 — latent today,
  // since object keys are UUIDs and fixed names, but cheap to close).
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * SigV4 canonical query string: percent-encoded name=value pairs,
 * sorted. BOTH signing paths (object ops and list) build theirs here
 * (review P2) — one construction, so the two can never drift apart.
 */
function canonicalQueryString(params: Iterable<readonly [string, string]>): string {
  return [...params]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join("&");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export class S3BackupStore implements BackupObjectStore {
  constructor(private readonly config: S3StoreConfig) {}

  private async request(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body?: Buffer,
  ): Promise<Response> {
    const { endpoint, bucket, region, accessKeyId, secretAccessKey } = this.config;
    const url = new URL(`${endpoint}/${bucket}/${encodeKeyPath(key)}`);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (method === "PUT") headers["content-length"] = String(payload.length);
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join("");
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQueryString(url.searchParams.entries()),
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
    ].join("\n");
    const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
    headers["Authorization"] =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    const res = await fetch(url, {
      method,
      headers,
      body: method === "PUT" ? payload : undefined,
    });
    return res;
  }

  private async listRequest(prefix: string, continuationToken?: string): Promise<Response> {
    const { endpoint, bucket, region, accessKeyId, secretAccessKey } = this.config;
    const url = new URL(`${endpoint}/${bucket}`);
    const params = new URLSearchParams({ "list-type": "2", prefix });
    if (continuationToken) params.set("continuation-token", continuationToken);
    const query = canonicalQueryString(params.entries());
    url.search = `?${query}`;
    const payloadHash = createHash("sha256").update("").digest("hex");
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join("");
    const canonicalRequest = [
      "GET",
      url.pathname,
      query,
      canonicalHeaders,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
    ].join("\n");
    const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
    headers["Authorization"] =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    return fetch(url, { method: "GET", headers });
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const res = await this.request("PUT", key, body);
    if (!res.ok) {
      throw new Error(`S3 PUT ${key} failed: HTTP ${res.status} ${await res.text()}`);
    }
  }

  async getObject(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 GET ${key} failed: HTTP ${res.status} ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE ${key} failed: HTTP ${res.status} ${await res.text()}`);
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    for (;;) {
      const res = await this.listRequest(prefix, token);
      if (!res.ok) {
        throw new Error(`S3 LIST ${prefix} failed: HTTP ${res.status} ${await res.text()}`);
      }
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g)) {
        keys.push(xmlUnescape(m[1] ?? ""));
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
      if (!truncated || !next) break;
      token = xmlUnescape(next[1] ?? "");
    }
    return keys.sort();
  }
}
