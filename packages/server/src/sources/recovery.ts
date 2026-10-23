import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";
import { upsertSourceChunkEmbedding } from "../db/vec.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { processSourceExtraction, type IngestResult } from "../ingestion/pipeline.js";
import type { AppContext } from "../context.js";

/**
 * Verbatim-Recall V1 boot recovery (design sections 12E / 18.3 / 18.4.4).
 *
 * No job platform: at startup the server (a) logs how many sources are
 * preserved, (b) backfills chunk vector embeddings for chunks whose
 * indexed_vec flag is still 0 — embeddings unavailable leaves chunks
 * unindexed and FTS-exact search keeps working (degradation is a
 * signal, not a failure), and (c) reclaims expired extraction leases
 * and resumes pending sources through the same claim path the live
 * pipeline uses, so a crash between persist and extract completes
 * exactly once.
 */

export function allSpaceIds(h: DbHandle): string[] {
  const ids = new Set<string>([DEFAULT_SPACE]);
  try {
    const rows = h.sqlite.prepare(`SELECT id FROM spaces`).all() as { id: string }[];
    for (const r of rows) ids.add(r.id);
  } catch {
    /* spaces table always exists post-bootstrap; legacy default suffices */
  }
  return [...ids];
}

/** 18.4.4: V1+ startup logs the preserved-source count. */
export function logPreservedSourceCount(h: DbHandle): number {
  const count = SourcesRepo.countAllPreserved(h);
  console.log(`[sources] verbatim-recall V1: ${count} preserved source(s) in the source layer`);
  return count;
}

/**
 * Chunk vec backfill (12E): embed every chunk still flagged
 * indexed_vec = 0 and store its vector. Returns how many chunks were
 * indexed. A failing embedder aborts the backfill quietly — chunks
 * stay unindexed, the flag stays visible, FTS still answers exactly.
 */
export async function backfillChunkVec(
  h: DbHandle,
  embeddings: EmbeddingProvider,
): Promise<number> {
  let indexed = 0;
  for (const spaceId of allSpaceIds(h)) {
    const repo = new SourcesRepo(h, spaceId);
    let chunks = repo.unindexedChunks(200);
    while (chunks.length > 0) {
      for (const chunk of chunks) {
        try {
          const vec = await embeddings.embed(chunk.text);
          upsertSourceChunkEmbedding(h.sqlite, chunk.id, vec);
          repo.markChunkVecIndexed(chunk.id);
          indexed++;
        } catch {
          return indexed; // embeddings unavailable: degrade, don't fail boot
        }
      }
      chunks = repo.unindexedChunks(200);
    }
  }
  return indexed;
}

/**
 * Resume pending sources across all spaces: reclaim expired leases,
 * then run each pending source through the pipeline's claim path.
 * Per-source failures are already recorded by the state machine
 * (extraction_failed / failed_permanent + Inbox); recovery continues
 * with the next source rather than failing boot.
 */
export async function recoverPendingSources(
  h: DbHandle,
  deps: { embeddings: EmbeddingProvider; llm: LlmProvider },
  ctx?: AppContext,
): Promise<{ reclaimed: number; resumed: number; results: IngestResult[] }> {
  let reclaimed = 0;
  let resumed = 0;
  const results: IngestResult[] = [];
  for (const spaceId of allSpaceIds(h)) {
    const repo = new SourcesRepo(h, spaceId);
    reclaimed += repo.reclaimExpiredLeases();
    for (const source of repo.pendingSources()) {
      try {
        const r = await processSourceExtraction(h, deps, source.id, spaceId, undefined, ctx);
        results.push(r);
        resumed++;
      } catch {
        /* state machine recorded the failure; keep recovering others */
      }
    }
  }
  return { reclaimed, resumed, results };
}
