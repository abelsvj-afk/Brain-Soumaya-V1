import { createHash } from "node:crypto";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { isVectorEnabled, type RawDb } from "../db/vec.js";
import { NotificationsRepo } from "./notifications.repo.js";

/**
 * Verbatim-Recall V1 — the Source Layer (design note Rev 1-3).
 *
 * One rule: nodes are derived; sources are truth. A source is persisted
 * (row + exact chunks + FTS rows) in ONE transaction BEFORE extraction
 * runs; extraction failure never deletes or degrades it (section 13
 * honesty rule: if persistence itself fails, the capture fails and
 * nothing claims the words were preserved — the transaction rolls back).
 *
 * Write-once discipline (section 12A): this repo exposes NO update path
 * for raw_bytes / raw_text / kind / speaker / occurred_at /
 * content_hash / byte_length. The only mutable fields are the section
 * 18.3 processing fields, changed only through the claim / complete /
 * fail transitions below.
 *
 * Chunking (section 18.2 + evidence E1 build requirement): chunks are
 * EXACT substrings of raw_text — a contiguous, non-overlapping partition
 * with character offsets, so concatenating chunks in ordinal order
 * reproduces raw_text exactly and raw_text.slice(start, end) === text.
 * The knowledge chunkText() normalizer is deliberately NOT reused.
 */

export type SourceKind =
  | "note"
  | "voice"
  | "telegram"
  | "chat"
  | "podcast_episode"
  | "video"
  | "document"
  | "meeting";

export type CitationClass =
  | "verbatim_typed"
  | "transcript_machine"
  | "transcript_corrected"
  | "transcript_unverifiable"
  | "imported_text";

export type ProcessingStatus =
  | "preserved"
  | "extracting"
  | "extracted"
  | "extraction_failed"
  | "failed_permanent";

/** Fix round 2 (audit P1): what boot recovery must DO with a pending
 *  source. Persisted at capture time (sources.capture_intent) so the
 *  intent survives a crash — recovery routes to the right handler
 *  instead of generic extraction for every source. */
export type CaptureIntent = "extract" | "action" | "telegram_note";

/** Params for the direct-capture intents, stored as JSON in
 *  sources.capture_params. Action: expiresAt (ISO, required) plus the
 *  route's occurredAt/remindAt/tags. Telegram note: none (the node is
 *  fully determined by the source row). */
export interface ActionCaptureParams {
  expiresAt: string;
  occurredAt?: string;
  remindAt?: string;
  tags?: string[];
}

/** After this many extraction attempts a source is failed_permanent (18.3). */
export const MAX_EXTRACTION_ATTEMPTS = 5;
/** Lease length for a claimed extraction (18.3: 15 minutes). */
export const LEASE_MS = 15 * 60 * 1000;
/** Fixed chunk size (characters) for the exact-substring partition. */
export const SOURCE_CHUNK_CHARS = 1000;
/** Marker wrapped around a correction segment that overwrote an earlier
 *  correction's range (18.2 overlap rule: later seq wins, conflict shown). */
export const CONFLICT_OPEN = "⟦conflict⟧";
export const CONFLICT_CLOSE = "⟦/conflict⟧";

export interface SourceRow {
  id: number;
  spaceId: string;
  kind: string;
  citationClass: string;
  title: string | null;
  rawBytes: Buffer;
  rawText: string | null;
  encoding: string;
  contentHash: string;
  byteLength: number;
  speaker: string;
  occurredAt: string | null;
  createdAt: string;
  idempotencyKey: string | null;
  audioRef: string | null;
  processingStatus: ProcessingStatus;
  processingAttempts: number;
  processingLeaseOwner: string | null;
  processingLeaseExpiresAt: string | null;
  extractionHash: string | null;
  /** Fix round 2: direct-capture intent + params (see CaptureIntent). */
  captureIntent: CaptureIntent;
  captureParams: ActionCaptureParams | null;
}

export interface SourceChunkRow {
  id: number;
  spaceId: string;
  sourceId: number;
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
  startMs: number | null;
  endMs: number | null;
  indexedVec: boolean;
}

export interface SourceCorrectionRow {
  id: number;
  spaceId: string;
  sourceId: number;
  chunkId: number | null;
  startOffset: number;
  endOffset: number;
  correctedText: string;
  reason: string | null;
  correctedBy: string | null;
  seq: number;
  createdAt: string;
}

interface RawSourceRow {
  id: number;
  space_id: string;
  kind: string;
  citation_class: string;
  title: string | null;
  raw_bytes: Buffer;
  raw_text: string | null;
  encoding: string;
  content_hash: string;
  byte_length: number;
  speaker: string;
  occurred_at: string | null;
  created_at: string;
  idempotency_key: string | null;
  audio_ref: string | null;
  processing_status: string;
  processing_attempts: number;
  processing_lease_owner: string | null;
  processing_lease_expires_at: string | null;
  extraction_hash: string | null;
  capture_intent: string | null;
  capture_params: string | null;
}

const SOURCE_COLS = `id, space_id, kind, citation_class, title, raw_bytes,
  raw_text, encoding, content_hash, byte_length, speaker, occurred_at,
  created_at, idempotency_key, audio_ref, processing_status,
  processing_attempts, processing_lease_owner, processing_lease_expires_at,
  extraction_hash, capture_intent, capture_params`;

function parseCaptureParams(raw: string | null): ActionCaptureParams | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ActionCaptureParams;
    }
    return null;
  } catch {
    return null;
  }
}

/** Unknown intent values (hand-edited rows, forged restores) degrade
 *  to generic extraction — recovery must never crash on the intent. */
export function asCaptureIntent(raw: string | null | undefined): CaptureIntent {
  return raw === "action" || raw === "telegram_note" ? raw : "extract";
}

function toSource(r: RawSourceRow): SourceRow {
  return {
    id: r.id,
    spaceId: r.space_id,
    kind: r.kind,
    citationClass: r.citation_class,
    title: r.title,
    rawBytes: r.raw_bytes,
    rawText: r.raw_text,
    encoding: r.encoding,
    contentHash: r.content_hash,
    byteLength: r.byte_length,
    speaker: r.speaker,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    idempotencyKey: r.idempotency_key,
    audioRef: r.audio_ref,
    processingStatus: r.processing_status as ProcessingStatus,
    processingAttempts: r.processing_attempts,
    processingLeaseOwner: r.processing_lease_owner,
    processingLeaseExpiresAt: r.processing_lease_expires_at,
    extractionHash: r.extraction_hash,
    captureIntent: asCaptureIntent(r.capture_intent),
    captureParams: parseCaptureParams(r.capture_params),
  };
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Deterministic UTF-8 decode check: Buffer->string->Buffer round-trip is
 *  byte-identical iff the bytes were valid UTF-8 (Node replaces invalid
 *  sequences with U+FFFD, which re-encodes differently). */
export function decodeUtf8(bytes: Buffer): { text: string | null; encoding: "utf8" | "binary" } {
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").equals(bytes)) return { text, encoding: "utf8" };
  return { text: null, encoding: "binary" };
}

/** The exact-substring partition of raw_text (see header). No trimming,
 *  no normalization, no overlap — offsets are JS string (UTF-16 code
 *  unit) offsets, matching String.slice semantics. */
export function chunkExact(
  rawText: string,
  size: number = SOURCE_CHUNK_CHARS,
): { ordinal: number; text: string; startOffset: number; endOffset: number }[] {
  const out: { ordinal: number; text: string; startOffset: number; endOffset: number }[] = [];
  let ordinal = 0;
  for (let start = 0; start < rawText.length; start += size) {
    const end = Math.min(start + size, rawText.length);
    out.push({ ordinal: ordinal++, text: rawText.slice(start, end), startOffset: start, endOffset: end });
  }
  return out;
}

/** extraction_hash (18.3): hash of the extractor's node set for a source —
 *  a retry reproducing the same set reuses the existing nodes. */
export function extractionHashOf(nodes: { label: string; content: string }[]): string {
  const canonical = nodes
    .map((n) => `${n.label}\u0000${n.content}`)
    .sort()
    .join("\u0001");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Raw-SQL link copy for writers that cannot construct a SourcesRepo
 * mid-transaction (the W1 temporal supersession writers). Copies a
 * node's ACTIVE links forward to another node (12D), inside the
 * caller's transaction. INSERT OR IGNORE under the unique index.
 */
export function copyNodeSourceLinksRaw(
  sqlite: RawDb,
  spaceId: string,
  fromNodeId: number,
  toNodeId: number,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO node_sources (space_id, node_id, source_id, chunk_id, role, active)
       SELECT space_id, ?, source_id, chunk_id, role, 1
       FROM node_sources WHERE space_id = ? AND node_id = ? AND active = 1`,
    )
    .run(toNodeId, spaceId, fromNodeId);
}

export interface PersistSourceInput {
  kind: SourceKind | string;
  citationClass: CitationClass | string;
  /** Exact payload bytes as received at the server boundary. */
  rawBytes: Buffer;
  title?: string;
  speaker?: string;
  occurredAt?: string;
  idempotencyKey?: string;
  audioRef?: string;
  /** Fix round 2: direct-capture intent, persisted with the source so
   *  boot recovery can route to the right handler. Default 'extract'. */
  captureIntent?: CaptureIntent;
  /** Params for the direct-capture intents (action only, today). */
  captureParams?: ActionCaptureParams | null;
}

export interface PersistResult {
  source: SourceRow;
  /** False when an idempotency_key replay returned the existing source. */
  created: boolean;
}

export class SourcesRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  /**
   * Persist a source + its exact chunks + FTS rows in ONE transaction
   * (12A/12E). Any failure (including an FTS insert failure) rolls the
   * whole capture back and the error propagates — the caller reports
   * the capture as failed and claims nothing was preserved (section 13).
   * An idempotency_key replay returns the existing source untouched.
   */
  persist(input: PersistSourceInput): PersistResult {
    if (input.idempotencyKey) {
      const existing = this.getByIdempotencyKey(input.idempotencyKey);
      if (existing) return { source: existing, created: false };
    }
    const { text, encoding } = decodeUtf8(input.rawBytes);
    const contentHash = sha256Hex(input.rawBytes);
    const nowIso = new Date().toISOString();
    const captureIntent = input.captureIntent ?? "extract";
    const captureParamsJson = input.captureParams ? JSON.stringify(input.captureParams) : null;
    const tx = this.h.sqlite.transaction((): PersistResult => {
      // Re-check inside the transaction: a concurrent replay may have
      // landed between the pre-check and here (unique index backstops).
      if (input.idempotencyKey) {
        const raced = this.getByIdempotencyKey(input.idempotencyKey);
        if (raced) return { source: raced, created: false };
      }
      const info = this.h.sqlite
        .prepare(
          `INSERT INTO sources (space_id, kind, citation_class, title, raw_bytes,
             raw_text, encoding, content_hash, byte_length, speaker, occurred_at,
             created_at, idempotency_key, audio_ref, processing_status,
             capture_intent, capture_params)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preserved', ?, ?)`,
        )
        .run(
          this.spaceId,
          input.kind,
          input.citationClass,
          input.title ?? null,
          input.rawBytes,
          text,
          encoding,
          contentHash,
          input.rawBytes.length,
          input.speaker ?? "owner",
          input.occurredAt ?? null,
          nowIso,
          input.idempotencyKey ?? null,
          input.audioRef ?? null,
          captureIntent,
          captureParamsJson,
        );
      const sourceId = Number(info.lastInsertRowid);
      if (text !== null && text.length > 0) {
        const insChunk = this.h.sqlite.prepare(
          `INSERT INTO source_chunks (space_id, source_id, ordinal, text, start_offset, end_offset)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const insFts = this.h.sqlite.prepare(`INSERT INTO sources_fts (rowid, text) VALUES (?, ?)`);
        for (const c of chunkExact(text)) {
          const ci = insChunk.run(this.spaceId, sourceId, c.ordinal, c.text, c.startOffset, c.endOffset);
          // FTS inside the same transaction (12E explicit-sync pattern);
          // a failure here aborts the whole capture.
          insFts.run(Number(ci.lastInsertRowid), c.text);
        }
      }
      const source = this.getById(sourceId);
      if (!source) throw new Error("source persist failed: row missing after insert");
      return { source, created: true };
    });
    return tx();
  }

  /** Persist from a JS string: bytes are its exact UTF-8 encoding. */
  persistText(
    input: Omit<PersistSourceInput, "rawBytes"> & { text: string },
  ): PersistResult {
    const { text, ...rest } = input;
    return this.persist({ ...rest, rawBytes: Buffer.from(text, "utf8") });
  }

  getById(id: number): SourceRow | undefined {
    const r = this.h.sqlite
      .prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE id = ? AND space_id = ?`)
      .get(id, this.spaceId) as RawSourceRow | undefined;
    return r ? toSource(r) : undefined;
  }

  getByIdempotencyKey(key: string): SourceRow | undefined {
    const r = this.h.sqlite
      .prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE space_id = ? AND idempotency_key = ?`)
      .get(this.spaceId, key) as RawSourceRow | undefined;
    return r ? toSource(r) : undefined;
  }

  list(limit = 500): SourceRow[] {
    const rows = this.h.sqlite
      .prepare(`SELECT ${SOURCE_COLS} FROM sources WHERE space_id = ? ORDER BY id ASC LIMIT ?`)
      .all(this.spaceId, limit) as RawSourceRow[];
    return rows.map(toSource);
  }

  count(): number {
    const r = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM sources WHERE space_id = ?`)
      .get(this.spaceId) as { c: number };
    return r.c;
  }

  chunksOf(sourceId: number): SourceChunkRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, space_id, source_id, ordinal, text, start_offset, end_offset,
                start_ms, end_ms, indexed_vec
         FROM source_chunks WHERE source_id = ? AND space_id = ? ORDER BY ordinal ASC`,
      )
      .all(sourceId, this.spaceId) as {
      id: number; space_id: string; source_id: number; ordinal: number; text: string;
      start_offset: number; end_offset: number; start_ms: number | null;
      end_ms: number | null; indexed_vec: number;
    }[];
    return rows.map((r) => ({
      id: r.id, spaceId: r.space_id, sourceId: r.source_id, ordinal: r.ordinal,
      text: r.text, startOffset: r.start_offset, endOffset: r.end_offset,
      startMs: r.start_ms, endMs: r.end_ms, indexedVec: r.indexed_vec === 1,
    }));
  }

  /** Hash verification (12A): recompute over raw_bytes; never serve a
   *  mismatching source silently — callers decide (quarantine/report). */
  verifyHash(source: SourceRow): boolean {
    return sha256Hex(source.rawBytes) === source.contentHash && source.rawBytes.length === source.byteLength;
  }

  // ---------------------------------------------------------------------
  // Processing state machine (18.3)
  // ---------------------------------------------------------------------

  /**
   * The single-winner claim: ONE atomic conditional UPDATE. Succeeds
   * only where the source is preserved/extraction_failed and no live
   * lease exists. Returns the claimed source, or null when another
   * worker holds it (or it is already extracted / failed_permanent).
   */
  claim(sourceId: number, owner: string, nowMs: number = Date.now()): SourceRow | null {
    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + LEASE_MS).toISOString();
    const info = this.h.sqlite
      .prepare(
        `UPDATE sources
         SET processing_status = 'extracting',
             processing_attempts = processing_attempts + 1,
             processing_lease_owner = ?,
             processing_lease_expires_at = ?
         WHERE id = ? AND space_id = ?
           AND processing_status IN ('preserved', 'extraction_failed')
           AND (processing_lease_expires_at IS NULL OR processing_lease_expires_at <= ?)`,
      )
      .run(owner, expiresIso, sourceId, this.spaceId, nowIso);
    if (info.changes === 0) return null;
    return this.getById(sourceId) ?? null;
  }

  /** Terminal success: record extraction_hash, release the lease. Only
   *  the lease holder may complete (a stale worker cannot stomp). */
  completeExtraction(sourceId: number, owner: string, extractionHash: string): boolean {
    const info = this.h.sqlite
      .prepare(
        `UPDATE sources
         SET processing_status = 'extracted', extraction_hash = ?,
             processing_lease_owner = NULL, processing_lease_expires_at = NULL
         WHERE id = ? AND space_id = ? AND processing_status = 'extracting'
           AND processing_lease_owner = ?`,
      )
      .run(extractionHash, sourceId, this.spaceId, owner);
    return info.changes > 0;
  }

  /**
   * A failed attempt: back to extraction_failed, or failed_permanent
   * once attempts are exhausted (18.3) — which also raises the plain-
   * language Inbox item. Returns the new status, or null when the
   * caller did not hold the claim.
   */
  failExtraction(sourceId: number, owner: string): ProcessingStatus | null {
    const tx = this.h.sqlite.transaction((): ProcessingStatus | null => {
      const cur = this.getById(sourceId);
      if (!cur || cur.processingStatus !== "extracting" || cur.processingLeaseOwner !== owner) return null;
      const permanent = cur.processingAttempts >= MAX_EXTRACTION_ATTEMPTS;
      const next: ProcessingStatus = permanent ? "failed_permanent" : "extraction_failed";
      this.h.sqlite
        .prepare(
          `UPDATE sources
           SET processing_status = ?, processing_lease_owner = NULL,
               processing_lease_expires_at = NULL
           WHERE id = ? AND space_id = ?`,
        )
        .run(next, sourceId, this.spaceId);
      if (permanent) {
        // 18.3 permanent-failure surfacing: a plain-language Inbox item
        // through the typed NotificationsRepo path (fix round 2: 'system'
        // is now a member of the shared NotificationSource union, so the
        // write is type-checked and the reader's cast no longer hides a
        // mismatch). INSERT OR IGNORE semantics live in record() under
        // the (space_id, dedupe_key) unique index.
        new NotificationsRepo(this.h, this.spaceId).record({
          source: "system",
          text: "A note was saved but couldn't be processed — it's preserved and searchable exactly as you wrote it. You can retry it or leave it as it is.",
          icon: "📝",
          priority: "normal",
          dedupeKey: `source-failed-permanent:${sourceId}`,
        });
      }
      return next;
    });
    return tx();
  }

  /**
   * Boot-scan reclaim (18.3): an 'extracting' row whose lease has
   * expired belongs to a crashed worker. Reset it to extraction_failed
   * so the ordinary claim path can win it again — the claim itself
   * stays restricted to preserved/extraction_failed, per the design.
   * Returns how many leases were reclaimed (this space).
   */
  reclaimExpiredLeases(nowMs: number = Date.now()): number {
    const nowIso = new Date(nowMs).toISOString();
    const info = this.h.sqlite
      .prepare(
        `UPDATE sources
         SET processing_status = 'extraction_failed',
             processing_lease_owner = NULL, processing_lease_expires_at = NULL
         WHERE space_id = ? AND processing_status = 'extracting'
           AND processing_lease_expires_at IS NOT NULL
           AND processing_lease_expires_at <= ?`,
      )
      .run(this.spaceId, nowIso);
    return info.changes;
  }

  /** Sources awaiting (re)processing: preserved, retryable failures, and
   *  extracting rows whose lease has expired (crashed worker — 18.3 boot
   *  scan reclaims them by re-claiming; claim() enforces the lease). */
  pendingSources(nowMs: number = Date.now()): SourceRow[] {
    const nowIso = new Date(nowMs).toISOString();
    const rows = this.h.sqlite
      .prepare(
        `SELECT ${SOURCE_COLS} FROM sources
         WHERE space_id = ?
           AND (processing_status IN ('preserved', 'extraction_failed')
                OR (processing_status = 'extracting'
                    AND processing_lease_expires_at IS NOT NULL
                    AND processing_lease_expires_at <= ?))
         ORDER BY id ASC`,
      )
      .all(this.spaceId, nowIso) as unknown as RawSourceRow[];
    return rows.map(toSource);
  }

  /** Count of preserved sources across ALL spaces (18.4.4 startup log). */
  static countAllPreserved(h: DbHandle): number {
    const r = h.sqlite.prepare(`SELECT COUNT(*) AS c FROM sources`).get() as { c: number };
    return r.c;
  }

  // ---------------------------------------------------------------------
  // Provenance links (12D)
  // ---------------------------------------------------------------------

  /** INSERT OR IGNORE under UNIQUE(node_id, chunk_id, role): duplicate
   *  links are impossible under any retry pattern (18.3). */
  linkNode(input: {
    nodeId: number;
    sourceId: number;
    chunkId?: number | null;
    role?: "origin" | "support" | "derived_from";
  }): void {
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO node_sources (space_id, node_id, source_id, chunk_id, role, active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(this.spaceId, input.nodeId, input.sourceId, input.chunkId ?? null, input.role ?? "origin");
  }

  /** Origin-link every chunk of the source to the node (extraction read
   *  the whole source; each chunk is a provenance anchor). */
  linkNodeToAllChunks(nodeId: number, sourceId: number): void {
    for (const c of this.chunksOf(sourceId)) {
      this.linkNode({ nodeId, sourceId, chunkId: c.id, role: "origin" });
    }
    // A textless (binary / empty) source has no chunks: keep one
    // chunk-less origin link so provenance still holds.
    if (this.chunksOf(sourceId).length === 0) {
      this.linkNode({ nodeId, sourceId, chunkId: null, role: "origin" });
    }
  }

  activeLinksForNode(nodeId: number): { sourceId: number; chunkId: number | null; role: string }[] {
    return this.h.sqlite
      .prepare(
        `SELECT source_id AS sourceId, chunk_id AS chunkId, role FROM node_sources
         WHERE space_id = ? AND node_id = ? AND active = 1 ORDER BY id ASC`,
      )
      .all(this.spaceId, nodeId) as { sourceId: number; chunkId: number | null; role: string }[];
  }

  activeLinksForSource(sourceId: number): { nodeId: number; chunkId: number | null; role: string }[] {
    return this.h.sqlite
      .prepare(
        `SELECT node_id AS nodeId, chunk_id AS chunkId, role FROM node_sources
         WHERE space_id = ? AND source_id = ? AND active = 1 ORDER BY id ASC`,
      )
      .all(this.spaceId, sourceId) as { nodeId: number; chunkId: number | null; role: string }[];
  }

  /** Node ids carrying at least one active origin link to this source. */
  nodeIdsWithOriginFrom(sourceId: number): number[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT DISTINCT node_id AS id FROM node_sources
         WHERE space_id = ? AND source_id = ? AND role = 'origin' AND active = 1`,
      )
      .all(this.spaceId, sourceId) as { id: number }[];
    return rows.map((r) => r.id);
  }

  hasActiveOriginLink(nodeId: number): boolean {
    const r = this.h.sqlite
      .prepare(
        `SELECT 1 AS x FROM node_sources
         WHERE space_id = ? AND node_id = ? AND role = 'origin' AND active = 1 LIMIT 1`,
      )
      .get(this.spaceId, nodeId) as { x: number } | undefined;
    return !!r;
  }

  /** Batch provenance check for node reads (one query for the id set). */
  originFlagsForNodes(nodeIds: number[]): Set<number> {
    if (nodeIds.length === 0) return new Set();
    const ph = nodeIds.map(() => "?").join(",");
    const rows = this.h.sqlite
      .prepare(
        `SELECT DISTINCT node_id AS id FROM node_sources
         WHERE space_id = ? AND role = 'origin' AND active = 1 AND node_id IN (${ph})`,
      )
      .all(this.spaceId, ...nodeIds) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  }

  /** 12D merge: the surviving node inherits the union of both nodes'
   *  links; the dropped node's links are deactivated, never erased. */
  inheritLinksOnMerge(survivorId: number, droppedId: number): void {
    const tx = this.h.sqlite.transaction(() => {
      const links = this.activeLinksForNode(droppedId);
      for (const l of links) {
        this.linkNode({ nodeId: survivorId, sourceId: l.sourceId, chunkId: l.chunkId, role: l.role as "origin" | "support" | "derived_from" });
      }
      this.deactivateLinksForNode(droppedId);
    });
    tx();
  }

  /** 12D regeneration/supersession: links copy forward to the new node. */
  copyLinksForward(fromNodeId: number, toNodeId: number): void {
    for (const l of this.activeLinksForNode(fromNodeId)) {
      this.linkNode({ nodeId: toNodeId, sourceId: l.sourceId, chunkId: l.chunkId, role: l.role as "origin" | "support" | "derived_from" });
    }
  }

  /** 12D split: each child inherits the parent's links. */
  inheritLinksOnSplit(parentId: number, childIds: number[]): void {
    for (const child of childIds) this.copyLinksForward(parentId, child);
  }

  /** 12D node deletion: links are deactivated; sources are untouched. */
  deactivateLinksForNode(nodeId: number): void {
    this.h.sqlite
      .prepare(
        `UPDATE node_sources SET active = 0, superseded_at = ?
         WHERE space_id = ? AND node_id = ? AND active = 1`,
      )
      .run(new Date().toISOString(), this.spaceId, nodeId);
  }

  // ---------------------------------------------------------------------
  // Corrections (12A / 18.2) — append-only, seq assigned in-transaction
  // ---------------------------------------------------------------------

  addCorrection(input: {
    sourceId: number;
    chunkId?: number | null;
    startOffset: number;
    endOffset: number;
    correctedText: string;
    reason?: string;
    correctedBy?: string;
  }): SourceCorrectionRow {
    const tx = this.h.sqlite.transaction((): SourceCorrectionRow => {
      const src = this.getById(input.sourceId);
      if (!src) throw new Error(`correction target source ${input.sourceId} not found in this space`);
      const maxRow = this.h.sqlite
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM source_corrections WHERE source_id = ?`)
        .get(input.sourceId) as { m: number };
      const seq = maxRow.m + 1;
      const info = this.h.sqlite
        .prepare(
          `INSERT INTO source_corrections (space_id, source_id, chunk_id, start_offset,
             end_offset, corrected_text, reason, corrected_by, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.spaceId, input.sourceId, input.chunkId ?? null, input.startOffset,
          input.endOffset, input.correctedText, input.reason ?? null,
          input.correctedBy ?? null, seq,
        );
      const row = this.h.sqlite
        .prepare(
          `SELECT id, space_id, source_id, chunk_id, start_offset, end_offset,
                  corrected_text, reason, corrected_by, seq, created_at
           FROM source_corrections WHERE id = ?`,
        )
        .get(Number(info.lastInsertRowid)) as {
        id: number; space_id: string; source_id: number; chunk_id: number | null;
        start_offset: number; end_offset: number; corrected_text: string;
        reason: string | null; corrected_by: string | null; seq: number; created_at: string;
      };
      return {
        id: row.id, spaceId: row.space_id, sourceId: row.source_id, chunkId: row.chunk_id,
        startOffset: row.start_offset, endOffset: row.end_offset,
        correctedText: row.corrected_text, reason: row.reason,
        correctedBy: row.corrected_by, seq: row.seq, createdAt: row.created_at,
      };
    });
    return tx();
  }

  correctionsOf(sourceId: number): SourceCorrectionRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, space_id, source_id, chunk_id, start_offset, end_offset,
                corrected_text, reason, corrected_by, seq, created_at
         FROM source_corrections WHERE source_id = ? AND space_id = ? ORDER BY seq ASC`,
      )
      .all(sourceId, this.spaceId) as {
      id: number; space_id: string; source_id: number; chunk_id: number | null;
      start_offset: number; end_offset: number; corrected_text: string;
      reason: string | null; corrected_by: string | null; seq: number; created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id, spaceId: r.space_id, sourceId: r.source_id, chunkId: r.chunk_id,
      startOffset: r.start_offset, endOffset: r.end_offset, correctedText: r.corrected_text,
      reason: r.reason, correctedBy: r.corrected_by, seq: r.seq, createdAt: r.created_at,
    }));
  }

  /**
   * Current reading = original + corrections replayed in ascending seq
   * (18.2). Corrections anchor to ORIGINAL character offsets and never
   * chain. Overlapping corrections: the later seq wins the overlap and
   * its text is wrapped in a conflict marker. The original is never
   * modified — getById().rawText always returns it untouched.
   */
  currentReading(sourceId: number): {
    text: string | null;
    hasConflicts: boolean;
    correctionsApplied: number;
    originalCitationClass: string;
    readingCitationClass: string;
  } | undefined {
    const src = this.getById(sourceId);
    if (!src) return undefined;
    const original = src.rawText;
    const readingClass =
      this.correctionsOf(sourceId).length > 0 && src.citationClass === "transcript_machine"
        ? "transcript_corrected"
        : src.citationClass;
    if (original === null) {
      return { text: null, hasConflicts: false, correctionsApplied: 0, originalCitationClass: src.citationClass, readingCitationClass: readingClass };
    }
    const corrections = this.correctionsOf(sourceId);
    // Deterministic replay model: the reading is a list of atoms, one
    // per output character, each mapped to an ORIGINAL offset (a
    // correction's characters map uniformly across its original range).
    // Applying a correction removes every atom whose original offset
    // falls in its [start, end) range and inserts its text at that
    // point — so a later seq literally wins the overlap, and any atom
    // it displaces that belonged to an earlier correction marks that
    // correction's surviving text as conflicted.
    interface Atom { ch: string; orig: number; seq: number | null }
    // Atoms are per CODE UNIT so offsets stay aligned with slice().
    let atoms: Atom[] = original.split("").map((ch, i) => ({ ch, orig: i, seq: null }));
    const conflictedSeqs = new Set<number>();
    let hasConflicts = false;
    for (const c of corrections) {
      const s = Math.max(0, Math.min(c.startOffset, original.length));
      const e = Math.max(s, Math.min(c.endOffset, original.length));
      const overlapsEarlier = atoms.some((a) => a.orig >= s && a.orig < e && a.seq !== null);
      if (overlapsEarlier) {
        hasConflicts = true;
        conflictedSeqs.add(c.seq);
      }
      const firstIdx = atoms.findIndex((a) => a.orig >= s && a.orig < e);
      const insertAt =
        firstIdx >= 0 ? firstIdx : atoms.findIndex((a) => a.orig >= s) >= 0 ? atoms.findIndex((a) => a.orig >= s) : atoms.length;
      atoms = atoms.filter((a) => !(a.orig >= s && a.orig < e));
      const rangeLen = Math.max(1, e - s);
      const newAtoms: Atom[] = c.correctedText.split("").map((ch, i) => ({
        ch,
        orig: e > s ? s + Math.floor((i * rangeLen) / Math.max(1, c.correctedText.length)) : s,
        seq: c.seq,
      }));
      atoms.splice(insertAt, 0, ...newAtoms);
    }
    // Render: group consecutive atoms of a conflicted correction and
    // wrap each group in the conflict marker.
    let text = "";
    let openSeq: number | null = null;
    for (const a of atoms) {
      const inConflict = a.seq !== null && conflictedSeqs.has(a.seq);
      if (inConflict && openSeq !== a.seq) {
        if (openSeq !== null) text += CONFLICT_CLOSE;
        text += CONFLICT_OPEN;
        openSeq = a.seq;
      } else if (!inConflict && openSeq !== null) {
        text += CONFLICT_CLOSE;
        openSeq = null;
      }
      text += a.ch;
    }
    if (openSeq !== null) text += CONFLICT_CLOSE;
    return {
      text,
      hasConflicts,
      correctionsApplied: corrections.length,
      originalCitationClass: src.citationClass,
      readingCitationClass: readingClass,
    };
  }

  // ---------------------------------------------------------------------
  // Chunk search (12B / 12E) — the repo-level retrieval primitive.
  // The agent-facing search_my_words tool is V2 and is NOT built here.
  // ---------------------------------------------------------------------

  /**
   * Exact-word / exact-phrase FTS over chunk text. space_id is filtered
   * in the WHERE clause (via chunk -> source join) BEFORE LIMIT (12B).
   * `phrase: true` issues a quoted-phrase FTS5 query; otherwise the
   * query's terms are ANDed as quoted literals (no syntax injection).
   */
  searchChunksFts(
    query: string,
    k: number = 10,
    opts: { phrase?: boolean } = {},
  ): { chunk: SourceChunkRow; source: SourceRow }[] {
    const match = toFtsMatch(query, opts.phrase ?? false);
    if (!match) return [];
    try {
      const rows = this.h.sqlite
        .prepare(
          `SELECT c.id AS cid FROM sources_fts f
           JOIN source_chunks c ON c.id = f.rowid
           JOIN sources s ON s.id = c.source_id
           WHERE sources_fts MATCH ? AND s.space_id = ? AND c.space_id = ?
           ORDER BY bm25(sources_fts) LIMIT ?`,
        )
        .all(match, this.spaceId, this.spaceId, k) as { cid: number }[];
      const out: { chunk: SourceChunkRow; source: SourceRow }[] = [];
      for (const r of rows) {
        const chunk = this.chunkById(r.cid);
        if (!chunk) continue;
        const source = this.getById(chunk.sourceId);
        if (!source) continue;
        out.push({ chunk, source });
      }
      return out;
    } catch {
      return [];
    }
  }

  chunkById(id: number): SourceChunkRow | undefined {
    const r = this.h.sqlite
      .prepare(
        `SELECT id, space_id, source_id, ordinal, text, start_offset, end_offset,
                start_ms, end_ms, indexed_vec
         FROM source_chunks WHERE id = ? AND space_id = ?`,
      )
      .get(id, this.spaceId) as {
      id: number; space_id: string; source_id: number; ordinal: number; text: string;
      start_offset: number; end_offset: number; start_ms: number | null;
      end_ms: number | null; indexed_vec: number;
    } | undefined;
    if (!r) return undefined;
    return {
      id: r.id, spaceId: r.space_id, sourceId: r.source_id, ordinal: r.ordinal,
      text: r.text, startOffset: r.start_offset, endOffset: r.end_offset,
      startMs: r.start_ms, endMs: r.end_ms, indexedVec: r.indexed_vec === 1,
    };
  }

  /**
   * Vector search over chunk embeddings with defense-in-depth (12B):
   * vec0 KNN is global, so every hit is re-verified by joining
   * chunk -> source and asserting source.space_id = this space.
   */
  searchChunksVector(
    queryVec: Float32Array,
    k: number = 10,
  ): { chunk: SourceChunkRow; source: SourceRow; distance: number }[] {
    if (!isVectorEnabled(this.h.sqlite)) return [];
    try {
      const blob = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);
      const rows = this.h.sqlite
        .prepare(
          `SELECT chunk_id AS cid, distance FROM vec_source_chunks
           WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
        )
        .all(blob, Math.max(k * 4, k)) as { cid: number | bigint; distance: number }[];
      const out: { chunk: SourceChunkRow; source: SourceRow; distance: number }[] = [];
      for (const r of rows) {
        const chunk = this.chunkById(Number(r.cid));
        if (!chunk) continue; // not this space (or gone): never a candidate
        const source = this.getById(chunk.sourceId);
        if (!source || source.spaceId !== this.spaceId) continue;
        out.push({ chunk, source, distance: r.distance });
        if (out.length >= k) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Chunks whose embeddings have not been backfilled yet (12E boot scan). */
  unindexedChunks(limit = 200): SourceChunkRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT c.id, c.space_id, c.source_id, c.ordinal, c.text, c.start_offset,
                c.end_offset, c.start_ms, c.end_ms, c.indexed_vec
         FROM source_chunks c JOIN sources s ON s.id = c.source_id
         WHERE c.space_id = ? AND s.space_id = ? AND c.indexed_vec = 0
         ORDER BY c.id ASC LIMIT ?`,
      )
      .all(this.spaceId, this.spaceId, limit) as {
      id: number; space_id: string; source_id: number; ordinal: number; text: string;
      start_offset: number; end_offset: number; start_ms: number | null;
      end_ms: number | null; indexed_vec: number;
    }[];
    return rows.map((r) => ({
      id: r.id, spaceId: r.space_id, sourceId: r.source_id, ordinal: r.ordinal,
      text: r.text, startOffset: r.start_offset, endOffset: r.end_offset,
      startMs: r.start_ms, endMs: r.end_ms, indexedVec: false,
    }));
  }

  markChunkVecIndexed(chunkId: number): void {
    this.h.sqlite
      .prepare(`UPDATE source_chunks SET indexed_vec = 1 WHERE id = ? AND space_id = ?`)
      .run(chunkId, this.spaceId);
  }
}

/** Build an FTS5 MATCH string with every term quoted as a literal. */
function toFtsMatch(raw: string, phrase: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const esc = (t: string) => `"${t.replace(/"/g, '""')}"`;
  if (phrase) return esc(trimmed);
  const terms = trimmed.split(/\s+/).filter(Boolean).slice(0, 12);
  if (terms.length === 0) return "";
  return terms.map(esc).join(" ");
}

export interface ChunkSearchResult {
  hits: { chunk: SourceChunkRow; source: SourceRow }[];
  /** 12E degradation signal: true when vector search contributed
   *  nothing (unavailable or unindexed) and results are FTS-only. */
  degraded: boolean;
  mode: "fts+vec" | "fts_only";
  /** True when some chunks in this space still await vec backfill. */
  vecLag: boolean;
}

/**
 * The combined retrieval primitive the acceptance tests exercise:
 * FTS always; vector fused in when a query vector is supplied and the
 * vec index has data. Degradation is reported, never silent (12E).
 *
 * Fusion is reciprocal rank fusion (fix round 2, audit P2): the old
 * code inserted FTS hits first, appended vector hits, and sliced to
 * k — so a result that only the vector side found could be crowded
 * out entirely while the mode still claimed "fts+vec". RRF scores
 * each chunk 1/(60+rank) in each ranking it appears in (the same
 * constant and shape as fuseRrf in db/fts.ts, which memorySearch
 * uses for nodes) and returns the top-k fused order, so a
 * vector-only hit ranked highly by meaning survives the cut.
 */
export function searchSourceChunks(
  repo: SourcesRepo,
  query: string,
  opts: { k?: number; phrase?: boolean; queryVec?: Float32Array } = {},
): ChunkSearchResult {
  const k = opts.k ?? 10;
  const ftsHits = repo.searchChunksFts(query, k, { phrase: opts.phrase });
  const vecLag = repo.unindexedChunks(1).length > 0;
  let degraded = true;
  let mode: ChunkSearchResult["mode"] = "fts_only";
  const byChunk = new Map<number, { chunk: SourceChunkRow; source: SourceRow }>();
  for (const h of ftsHits) byChunk.set(h.chunk.id, h);
  if (opts.queryVec) {
    const vecHits = repo.searchChunksVector(opts.queryVec, k);
    if (vecHits.length > 0) {
      degraded = false;
      mode = "fts+vec";
      for (const h of vecHits) {
        if (!byChunk.has(h.chunk.id)) byChunk.set(h.chunk.id, { chunk: h.chunk, source: h.source });
      }
      const scores = new Map<number, number>();
      const addRank = (ids: number[]) => {
        ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + i + 1)));
      };
      addRank(ftsHits.map((h) => h.chunk.id));
      addRank(vecHits.map((h) => h.chunk.id));
      const ordered = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map(([id]) => id);
      const hits = ordered
        .map((id) => byChunk.get(id))
        .filter((h): h is { chunk: SourceChunkRow; source: SourceRow } => h !== undefined);
      return { hits, degraded, mode, vecLag };
    }
  }
  return { hits: [...byChunk.values()].slice(0, k), degraded, mode, vecLag };
}
