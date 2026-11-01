import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM, upsertSourceChunkEmbedding } from "../db/vec.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import {
  SourcesRepo,
  searchSourceChunks,
} from "../repositories/sources.repo.js";

/**
 * Verbatim-Recall V2 — repo-layer acceptance tests (K1 filters, K2 slice).
 * Criterion map (design note Rev 4, §7): the repo-level halves of
 * T-V2-3, T-V2-8, T-V2-10. Kept in their own file so the fail-before
 * evidence is per-test (these imports all exist pre-change; the new
 * behavior is what is missing).
 */

const SPACE = "v2-repo-space";
let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

class SemanticFakeProvider implements EmbeddingProvider {
  readonly dim = EMBED_DIM;
  readonly model = "test-semantic";
  private inner = new HashEmbeddingProvider(EMBED_DIM);
  async embed(text: string): Promise<Float32Array> {
    return this.inner.embed(text);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return this.inner.embedBatch(texts);
  }
}
const semantic = new SemanticFakeProvider();

// ---------------------------------------------------------------------------
// T-V2-3 (repo half) — filter-before-LIMIT + vector scan widening (N1)
// ---------------------------------------------------------------------------

describe("T-V2-3 repo: filter-before-LIMIT", () => {
  it("FTS: the date filter applies before the k cut, not after it", () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "recent one",
      text: "meridian meridian meridian meridian meridian report",
      occurredAt: "2026-09-15T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "recent two",
      text: "meridian meridian meridian meridian meridian bulletin",
      occurredAt: "2026-09-16T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "old one",
      text: "a long meridian reflection written at leisure with many other words around it",
      occurredAt: "2026-06-10T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "old two",
      text: "another lengthy meridian meditation full of unrelated surrounding prose here",
      occurredAt: "2026-06-20T12:00:00.000Z",
    });

    const unfiltered = repo.searchChunksFts("meridian", 2);
    expect(unfiltered.map((h) => h.source.title).sort()).toEqual(["recent one", "recent two"]);

    const fromMs = Date.parse("2026-06-01T00:00:00.000Z");
    const toMs = Date.parse("2026-07-01T00:00:00.000Z");
    const filtered = repo.searchChunksFts("meridian", 2, { filters: { fromMs, toMs } });
    expect(filtered.map((h) => h.source.title).sort()).toEqual(["old one", "old two"]);
  });

  it("vector path keeps scanning verified candidates under filters until k pass (N1 widening)", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    // Ten telegram chunks sit AT the query vector (distance 0) — they fill
    // the fixed k*4 candidate window outright. The two note chunks the
    // kind filter wants sit farther away, outside that window: only a
    // widening scan can reach them.
    for (let i = 0; i < 10; i++) {
      const s = repo.persistText({
        kind: "telegram", citationClass: "verbatim_typed", text: `filler telegram chunk ${i}`,
      }).source;
      const c = repo.chunksOf(s.id)[0]!;
      upsertSourceChunkEmbedding(handle.sqlite, c.id, await semantic.embed("widening probe"));
    }
    const wanted: number[] = [];
    for (let i = 0; i < 2; i++) {
      const s = repo.persistText({
        kind: "note", citationClass: "verbatim_typed", text: `wanted note chunk ${i}`,
      }).source;
      const c = repo.chunksOf(s.id)[0]!;
      upsertSourceChunkEmbedding(handle.sqlite, c.id, await semantic.embed("widening probe extra"));
      wanted.push(c.id);
    }
    const hits = repo.searchChunksVector(await semantic.embed("widening probe"), 2, {
      filters: { kind: "note" },
    });
    expect(hits.map((h) => h.chunk.id).sort()).toEqual(wanted.sort());
  });

  it("searchSourceChunks passes filters through to both paths", () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "N1",
      text: "kindprobe shared one",
    });
    repo.persistText({
      kind: "document", citationClass: "verbatim_typed", title: "D1",
      text: "kindprobe shared two",
    });
    const direct = searchSourceChunks(repo, "kindprobe", { filters: { kind: "document" } });
    expect(direct.hits.map((h) => h.source.title)).toEqual(["D1"]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-8 (repo half) — readingSlice: R2 boundary cases + §2.1 assertions
// ---------------------------------------------------------------------------

describe("T-V2-8 repo: readingSlice", () => {
  it("R2: a correction crossing a chunk boundary contributes its anchored portion to each chunk", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const text = "startword " + "x".repeat(990) + "y".repeat(400) + " endword";
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text,
    });
    const replacement = "0123456789ABCDEFGHIJ"; // 20 chars over a 20-unit range
    repo.addCorrection({
      sourceId: source.id, startOffset: 990, endOffset: 1010, correctedText: replacement,
    });

    const slice0 = repo.readingSlice(source.id, 0, 1000)!;
    const slice1 = repo.readingSlice(source.id, 1000, text.length)!;
    // §2.1: rangeLen 20, L 20 → unit i takes offset 990+i. Ten units land
    // in chunk 0's span, ten in chunk 1's; together they reconstruct it.
    expect(slice0.text).toBe("startword " + "x".repeat(980) + "0123456789");
    expect(slice1.text).toBe("ABCDEFGHIJ" + "y".repeat(390) + " endword");
    expect(slice0.corrected).toBe(true);
    expect(slice1.corrected).toBe(true);
    expect("0123456789" + "ABCDEFGHIJ").toBe(replacement);
  });

  it("a length-changing correction never renumbers chunks or offsets", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const text = "lengthprobe " + "q".repeat(1500);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text,
    });
    const before = repo.chunksOf(source.id).map((c) => [c.ordinal, c.startOffset, c.endOffset]);
    repo.addCorrection({
      sourceId: source.id, startOffset: 3, endOffset: 9,
      correctedText: "a much longer replacement than the original span",
    });
    const after = repo.chunksOf(source.id).map((c) => [c.ordinal, c.startOffset, c.endOffset]);
    expect(after).toEqual(before);
  });

  it("§2.1 worked example, verbatim: [4,9) → 123456789 across chunks [0,6) / [6,12)", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "ABCDEFGHIJKL",
    });
    repo.addCorrection({
      sourceId: source.id, startOffset: 4, endOffset: 9, correctedText: "123456789",
    });
    // Unit offsets 4,4,5,5,6,6,7,7,8: chunk [0,6) carries 1234, [6,12) 56789.
    expect(repo.readingSlice(source.id, 0, 6)!.text).toBe("ABCD1234");
    expect(repo.readingSlice(source.id, 6, 12)!.text).toBe("56789JKL");
  });

  it("§2.1: an insertion-only correction at an exact chunk boundary is attributed to the following chunk", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "ABCDEFGHIJKL",
    });
    repo.addCorrection({
      sourceId: source.id, startOffset: 6, endOffset: 6, correctedText: "ZZ",
    });
    const before = repo.readingSlice(source.id, 0, 6)!;
    const after = repo.readingSlice(source.id, 6, 12)!;
    expect(before.text).toBe("ABCDEF");
    expect(before.corrected).toBe(false);
    expect(after.text).toBe("ZZGHIJKL");
    expect(after.corrected).toBe(true);
  });

  it("§2.1: a deletion-only correction attributes nothing and shortens each reading by its in-span range", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "ABCDEFGHIJKL",
    });
    repo.addCorrection({
      sourceId: source.id, startOffset: 4, endOffset: 9, correctedText: "",
    });
    expect(repo.readingSlice(source.id, 0, 6)!.text).toBe("ABCD");
    expect(repo.readingSlice(source.id, 6, 12)!.text).toBe("JKL");
    expect(repo.readingSlice(source.id, 0, 6)!.corrected).toBe(true);
    expect(repo.readingSlice(source.id, 6, 12)!.corrected).toBe(true);
    expect(repo.currentReading(source.id)!.text).toBe("ABCDJKL");
  });

  it("§2.1: a surrogate pair straddling the 1000-unit boundary never shifts an offset", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const text = "x".repeat(999) + "\uD83D\uDE00" + "e\u0301" + " tail endmark";
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text,
    });
    const chunks = repo.chunksOf(source.id);
    expect(chunks.length).toBe(2);
    // NB: the stored chunk TEXTS do not join back to the original here —
    // chunk 0 ends with a lone high surrogate, which UTF-8 storage
    // cannot represent (pre-existing V1 storage property, outside the
    // V2 fence). The §2.1 contract under test is the OFFSETS, and the
    // reading model works from rawText, where the pair is intact.
    expect(chunks[0]!.endOffset).toBe(1000);
    expect(chunks[1]!.startOffset).toBe(1000);

    // Correction anchored over the emoji (offsets 999..1001, code units).
    repo.addCorrection({
      sourceId: source.id, startOffset: 999, endOffset: 1001, correctedText: "E",
    });
    const slice0 = repo.readingSlice(source.id, 0, 1000)!;
    expect(slice0.text).toBe("x".repeat(999) + "E");
    const slice1 = repo.readingSlice(source.id, 1000, text.length)!;
    expect(slice1.text).toBe(text.slice(1001));
    // Offsets after the correction are identical to before it.
    const after = repo.chunksOf(source.id);
    expect(after.map((c) => [c.startOffset, c.endOffset])).toEqual(
      chunks.map((c) => [c.startOffset, c.endOffset]),
    );
  });

  it("readingSlice on an uncorrected source returns the raw substring, uncorrected", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "plain uncorrected text",
    });
    const slice = repo.readingSlice(source.id, 6, 17)!;
    expect(slice.text).toBe("uncorrected");
    expect(slice.corrected).toBe(false);
    expect(slice.conflicted).toBe(false);
  });
});
