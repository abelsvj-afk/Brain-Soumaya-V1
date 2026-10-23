import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { sha256Hex } from "./sources.repo.js";

/**
 * Graph JSON export (IM-129c). The only pre-existing export facility is the
 * client-side Markdown export in Browse (one note / a folder / the whole brain
 * rendered as prose) — there was no machine-readable export of the graph
 * itself. This repo assembles one space's full graph (live nodes + the edges
 * between them) as plain JSON. Space-scoped like every repo; soft-deleted
 * nodes are excluded, and an edge is only included when BOTH endpoints are
 * in the exported node set (the dangling-link lesson from the galaxy fix:
 * never ship a reference to something the payload itself doesn't contain).
 *
 * Verbatim-Recall V1 (design section 18.4.3): the format is versioned.
 * v2 adds `sources` — every preserved source with its raw bytes as
 * base64 plus its chunks, corrections, and provenance links — and this
 * repo gains the restore path that never existed: restoreGraph()
 * rebuilds nodes/edges/sources/chunks/indexes into an (empty-of-them)
 * space and VERIFIES every source content_hash; a mismatch aborts the
 * restore and is reported, never silently served. Pre-V1 (v1 / unversioned)
 * exports still restore — sources are simply absent.
 */
export interface GraphExport {
  /** Format version: 1 = nodes/edges only (pre-V1), 2 = + sources. */
  version?: number;
  exportedAt: string;
  spaceId: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  sources?: Record<string, unknown>[];
}

export interface RestoreReport {
  nodesRestored: number;
  edgesRestored: number;
  sourcesRestored: number;
  chunksRestored: number;
  /** Source ids whose content_hash failed verification (restore aborts
   *  before commit when non-empty — see restoreGraph). */
  hashMismatches: number[];
}

export class GraphExportRepo {
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {}

  exportGraph(): GraphExport {
    const nodes = this.h.sqlite
      .prepare(
        `SELECT id, label, celestial_title AS celestialTitle, type, content,
                emotional_weight AS emotionalWeight, importance, color, origin,
                kind, progress, tags, created_at AS createdAt,
                occurred_at AS occurredAt, last_tended_at AS lastTendedAt
         FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    const ids = new Set(nodes.map((n) => n.id as number));
    const allEdges = this.h.sqlite
      .prepare(
        `SELECT id, source, target, relationship, weight, created_at AS createdAt
         FROM edges
         WHERE space_id = ?
         ORDER BY id ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    const edges = allEdges.filter(
      (e) => ids.has(e.source as number) && ids.has(e.target as number),
    );

    // V1 sources: raw bytes base64 (authoritative), plus everything a
    // faithful rebuild needs — chunks, corrections, provenance links.
    let sources: Record<string, unknown>[] = [];
    try {
      const srcRows = this.h.sqlite
        .prepare(
          `SELECT id, kind, citation_class AS citationClass, title,
                  raw_bytes AS rawBytes, raw_text AS rawText, encoding,
                  content_hash AS contentHash, byte_length AS byteLength,
                  speaker, occurred_at AS occurredAt, created_at AS createdAt,
                  idempotency_key AS idempotencyKey, audio_ref AS audioRef,
                  processing_status AS processingStatus,
                  processing_attempts AS processingAttempts,
                  extraction_hash AS extractionHash
           FROM sources WHERE space_id = ? ORDER BY id ASC`,
        )
        .all(this.spaceId) as Record<string, unknown>[];
      sources = srcRows.map((s) => {
        const sourceId = s.id as number;
        const chunks = this.h.sqlite
          .prepare(
            `SELECT id, ordinal, text, start_offset AS startOffset, end_offset AS endOffset,
                    start_ms AS startMs, end_ms AS endMs, indexed_vec AS indexedVec
             FROM source_chunks WHERE space_id = ? AND source_id = ? ORDER BY ordinal ASC`,
          )
          .all(this.spaceId, sourceId) as Record<string, unknown>[];
        const corrections = this.h.sqlite
          .prepare(
            `SELECT id, chunk_id AS chunkId, start_offset AS startOffset,
                    end_offset AS endOffset, corrected_text AS correctedText,
                    reason, corrected_by AS correctedBy, seq, created_at AS createdAt
             FROM source_corrections WHERE space_id = ? AND source_id = ? ORDER BY seq ASC`,
          )
          .all(this.spaceId, sourceId) as Record<string, unknown>[];
        const links = this.h.sqlite
          .prepare(
            `SELECT node_id AS nodeId, chunk_id AS chunkId, role, active,
                    superseded_at AS supersededAt
             FROM node_sources WHERE space_id = ? AND source_id = ? ORDER BY id ASC`,
          )
          .all(this.spaceId, sourceId) as Record<string, unknown>[];
        const rawBytes = s.rawBytes as Buffer;
        const { rawBytes: _omit, ...rest } = s;
        return {
          ...rest,
          rawBytesBase64: rawBytes.toString("base64"),
          chunks,
          corrections,
          links,
        };
      });
    } catch {
      // Pre-V1 volume (no sources table): export stays v1-shaped.
      return { exportedAt: new Date().toISOString(), spaceId: this.spaceId, nodes, edges };
    }
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      spaceId: this.spaceId,
      nodes,
      edges,
      sources,
    };
  }

  /**
   * Restore a graph export into THIS repo's space. Faithful-rebuild
   * semantics for the export -> wipe -> restore path: rows are rebuilt
   * with fresh ids and every internal reference remapped (see below),
   * so a restore never collides with rows the target database holds.
   * Embeddings are NOT in the export: restored nodes/chunks get FTS
   * rows immediately and vec rows lag (indexed_vec = 0 — the boot
   * backfill rebuilds them, the section 12E degradation contract).
   *
   * Hash verification happens over the decoded bytes BEFORE insert and
   * again after rebuild; any mismatch throws with the offending source
   * ids and the transaction rolls back — nothing is silently served.
   */
  restoreGraph(payload: GraphExport): RestoreReport {
    const sqlite = this.h.sqlite;
    const report: RestoreReport = {
      nodesRestored: 0,
      edgesRestored: 0,
      sourcesRestored: 0,
      chunksRestored: 0,
      hashMismatches: [],
    };
    // Pre-verify sources before touching the DB.
    const decoded = new Map<number, Buffer>();
    for (const s of payload.sources ?? []) {
      const b64 = s.rawBytesBase64 as string | undefined;
      if (typeof b64 !== "string") continue;
      const bytes = Buffer.from(b64, "base64");
      decoded.set(s.id as number, bytes);
      if (sha256Hex(bytes) !== (s.contentHash as string) || bytes.length !== (s.byteLength as number)) {
        report.hashMismatches.push(s.id as number);
      }
    }
    if (report.hashMismatches.length > 0) {
      throw new Error(
        `restore aborted: content_hash mismatch for source id(s) ${report.hashMismatches.join(", ")} — nothing was restored`,
      );
    }

    const tx = sqlite.transaction(() => {
      // Id remapping: ids in the payload belong to the exporting brain's
      // global id space, so a restore into a live database (another
      // space, or the same space after a partial wipe) must mint fresh
      // ids and rewrite every reference (edges, chunks, corrections,
      // links) through the maps. Into an empty database the maps come
      // out identity in practice (same insertion order from id 1).
      const nodeIdMap = new Map<number, number>();
      const sourceIdMap = new Map<number, number>();
      const chunkIdMap = new Map<number, number>();
      const insNode = sqlite.prepare(
        `INSERT INTO nodes (space_id, label, celestial_title, type, content,
           emotional_weight, importance, color, origin, kind, progress, tags,
           created_at, occurred_at, last_tended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insFts = sqlite.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, ?, ?)`);
      for (const n of payload.nodes) {
        const info = insNode.run(
          this.spaceId, n.label as string,
          (n.celestialTitle as string) ?? null, n.type as string, n.content as string,
          (n.emotionalWeight as number) ?? null, (n.importance as number) ?? null,
          (n.color as string) ?? null, (n.origin as string) ?? null,
          (n.kind as string) ?? null, (n.progress as number) ?? null,
          (n.tags as string) ?? null, (n.createdAt as string) ?? new Date().toISOString(),
          (n.occurredAt as string) ?? null, (n.lastTendedAt as string) ?? null,
        );
        const newId = Number(info.lastInsertRowid);
        nodeIdMap.set(n.id as number, newId);
        try { insFts.run(newId, (n.label as string) ?? "", (n.content as string) ?? ""); } catch { /* FTS absent */ }
        report.nodesRestored++;
      }
      const insEdge = sqlite.prepare(
        `INSERT INTO edges (space_id, source, target, relationship, weight, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const e of payload.edges) {
        const s = nodeIdMap.get(e.source as number);
        const tg = nodeIdMap.get(e.target as number);
        if (s === undefined || tg === undefined) continue; // dangling: never ship a reference the payload can't resolve
        insEdge.run(
          this.spaceId, s, tg,
          e.relationship as string, (e.weight as number) ?? null,
          (e.createdAt as string) ?? new Date().toISOString(),
        );
        report.edgesRestored++;
      }

      if (payload.sources && payload.sources.length > 0) {
        const insSource = sqlite.prepare(
          `INSERT INTO sources (space_id, kind, citation_class, title, raw_bytes,
             raw_text, encoding, content_hash, byte_length, speaker, occurred_at,
             created_at, idempotency_key, audio_ref, processing_status,
             processing_attempts, extraction_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const insChunk = sqlite.prepare(
          `INSERT INTO source_chunks (space_id, source_id, ordinal, text,
             start_offset, end_offset, start_ms, end_ms, indexed_vec)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        );
        const insChunkFts = sqlite.prepare(`INSERT INTO sources_fts (rowid, text) VALUES (?, ?)`);
        const insCorrection = sqlite.prepare(
          `INSERT INTO source_corrections (space_id, source_id, chunk_id,
             start_offset, end_offset, corrected_text, reason, corrected_by, seq, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const insLink = sqlite.prepare(
          `INSERT OR IGNORE INTO node_sources (space_id, node_id, source_id, chunk_id, role, active, superseded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of payload.sources) {
          const bytes = decoded.get(s.id as number);
          if (!bytes) continue;
          const sInfo = insSource.run(
            this.spaceId, s.kind as string,
            (s.citationClass as string) ?? "verbatim_typed", (s.title as string) ?? null,
            bytes, (s.rawText as string) ?? null, (s.encoding as string) ?? "utf8",
            s.contentHash as string, s.byteLength as number,
            (s.speaker as string) ?? "owner", (s.occurredAt as string) ?? null,
            (s.createdAt as string) ?? new Date().toISOString(),
            (s.idempotencyKey as string) ?? null, (s.audioRef as string) ?? null,
            (s.processingStatus as string) ?? "preserved",
            (s.processingAttempts as number) ?? 0, (s.extractionHash as string) ?? null,
          );
          const newSourceId = Number(sInfo.lastInsertRowid);
          sourceIdMap.set(s.id as number, newSourceId);
          report.sourcesRestored++;
          for (const c of (s.chunks as Record<string, unknown>[]) ?? []) {
            const cInfo = insChunk.run(
              this.spaceId, newSourceId, c.ordinal as number,
              c.text as string, c.startOffset as number, c.endOffset as number,
              (c.startMs as number) ?? null, (c.endMs as number) ?? null,
            );
            const newChunkId = Number(cInfo.lastInsertRowid);
            chunkIdMap.set(c.id as number, newChunkId);
            insChunkFts.run(newChunkId, c.text as string);
            report.chunksRestored++;
          }
          for (const corr of (s.corrections as Record<string, unknown>[]) ?? []) {
            insCorrection.run(
              this.spaceId, newSourceId,
              corr.chunkId != null ? (chunkIdMap.get(corr.chunkId as number) ?? null) : null,
              corr.startOffset as number,
              corr.endOffset as number, corr.correctedText as string,
              (corr.reason as string) ?? null, (corr.correctedBy as string) ?? null,
              corr.seq as number, (corr.createdAt as string) ?? new Date().toISOString(),
            );
          }
          for (const l of (s.links as Record<string, unknown>[]) ?? []) {
            const mappedNode = nodeIdMap.get(l.nodeId as number);
            if (mappedNode === undefined) continue;
            insLink.run(
              this.spaceId, mappedNode, newSourceId,
              l.chunkId != null ? (chunkIdMap.get(l.chunkId as number) ?? null) : null,
              (l.role as string) ?? "origin",
              (l.active as number) ?? 1, (l.supersededAt as string) ?? null,
            );
          }
        }
        // Post-rebuild verification: re-read and re-hash every source
        // restored in this call (by mapped id).
        const check = sqlite.prepare(`SELECT raw_bytes AS b, content_hash AS hh FROM sources WHERE id = ?`);
        for (const newId of sourceIdMap.values()) {
          const v = check.get(newId) as { b: Buffer; hh: string };
          if (!v || sha256Hex(v.b) !== v.hh) report.hashMismatches.push(newId);
        }
        if (report.hashMismatches.length > 0) {
          throw new Error(
            `restore aborted: post-restore content_hash mismatch for source id(s) ${report.hashMismatches.join(", ")}`,
          );
        }
      }
    });
    tx();
    return report;
  }
}
