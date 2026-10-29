import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { listChapters, countChapters } from "../analysis/timeline.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const DAY = 86_400_000;
const iso = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();

describe("Batch K — CHR-07 (REG-126): the chapter total is countable past the cap", () => {
  it("countChapters reports the true total while listChapters returns the newest 500", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 505; i++) {
      handle.sqlite
        .prepare(
          `INSERT INTO timeline_chapters (space_id, title, summary, theme, trend, score, period_start, period_end, memory_ids, photo_ids, threads, origin)
           VALUES ('legacy', ?, '', '', 'neutral', 0, ?, ?, '[]', '[]', '[]', 'auto')`,
        )
        .run("direct row", iso(base + i * DAY), iso(base + i * DAY));
    }
    expect(countChapters(ctx, "legacy")).toBe(505);
    expect(listChapters(ctx, "legacy")).toHaveLength(500);
  });

  it("countChapters is 0 on an empty brain", () => {
    expect(countChapters(ctx, "legacy")).toBe(0);
  });
});
