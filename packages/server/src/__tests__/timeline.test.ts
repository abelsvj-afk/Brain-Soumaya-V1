import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { maybeGenerateChapter, createManualChapter, listChapters, deleteChapter, assessChange, backfillInitialChapter } from "../analysis/timeline.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

let seq = 0;
/** Insert a memory with a controlled timestamp + emotion (bypasses embedding for date control). */
function mem(content: string, emo: number, createdAt: string, importance = 0.5) {
  const info = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at)
       VALUES ('legacy', ?, 'daily', ?, ?, ?, ?)`,
    )
    .run(`m${seq++}`, content, emo, importance, createdAt);
  return Number(info.lastInsertRowid);
}
function photo(nodeId: number) {
  handle.sqlite
    .prepare(`INSERT INTO attachments (space_id, node_id, filename, mime, size, data) VALUES ('legacy', ?, 'p.jpg', 'image/jpeg', 10, 'x')`)
    .run(nodeId);
}

const DAY = 86_400_000;
const iso = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();

describe("The Chronicle — 3D life timeline", () => {
  it("writes NO chapter when there aren't enough new memories", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("a quiet note", 0.1, iso(base));
    mem("another", 0.1, iso(base + DAY));
    mem("third", 0.1, iso(base + 2 * DAY));
    expect(maybeGenerateChapter(ctx, "legacy", iso(base + 3 * DAY))).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(0);
  });

  it("reads a bright stretch as GROWTH and a heavy one as DECLINE", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("wonderful day, so happy and proud", 0.7, iso(base + i * DAY));
    const up = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(up).not.toBeNull();
    expect(up!.trend).toBe("growth");

    // A later heavy window (well past the min gap + fresh month) trends decline.
    const base2 = Date.UTC(2026, 1, 1);
    for (let i = 0; i < 6; i++) mem("exhausting, drained and low", -0.7, iso(base2 + i * DAY));
    const down = maybeGenerateChapter(ctx, "legacy", iso(base2 + 7 * DAY));
    expect(down).not.toBeNull();
    expect(down!.trend).toBe("decline");
  });

  it("respects the cadence: no second auto chapter inside the min gap", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("bright and hopeful days", 0.7, iso(base + i * DAY));
    const first = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(first).not.toBeNull();

    // A genuine shift (mood turns heavy) — real change, but only 2 days later, so the
    // gap gate blocks it even though the magnitude would otherwise qualify.
    for (let i = 0; i < 6; i++) mem("everything feels heavy and hard now", -0.6, iso(base + 8 * DAY));
    expect(maybeGenerateChapter(ctx, "legacy", iso(base + 9 * DAY))).toBeNull();

    // Far enough out (and still under the monthly cap) → allowed again.
    const second = maybeGenerateChapter(ctx, "legacy", iso(base + 20 * DAY));
    expect(second).not.toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(2);
  });

  it("narrates a sane day-span for the first/backfill chapter (not the epoch)", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 5; i++) mem("early history", 0.3, iso(base + i * DAY));
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(base + 6 * DAY) })!;
    // Before the fix this read "Across about 20454 days" (span measured from epoch 0).
    expect(ch.summary).not.toMatch(/\d{4,}\s*days/);
  });

  it("lets you add a manual chapter regardless of the change threshold", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("just one small thing", 0.0, iso(base));
    const ch = createManualChapter(ctx, "legacy", { title: "My milestone", nowISO: iso(base + DAY) })!;
    expect(ch.origin).toBe("user");
    expect(ch.title).toBe("My milestone");
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
  });

  it("prefers photo-bearing memories into a chapter's driving set", () => {
    const base = Date.UTC(2026, 0, 1);
    const plain: number[] = [];
    for (let i = 0; i < 5; i++) plain.push(mem("ordinary day", 0.6, iso(base + i * DAY), 0.3));
    const withPhoto = mem("a day I photographed", 0.6, iso(base + 5 * DAY), 0.1);
    photo(withPhoto);
    const a = assessChange(ctx, "legacy", iso(base + 6 * DAY));
    // Despite lower importance, the photo memory is pulled to the front.
    expect(a.photoCount).toBe(1);
    expect(a.memoryIds[0]).toBe(withPhoto);
    expect(a.photoIds).toEqual([withPhoto]);
  });

  it("backfills ONE opening chapter from existing history, exactly once", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 5; i++) mem("something that happened before the timeline existed", 0.3, iso(base + i * DAY));
    const seeded = backfillInitialChapter(ctx, "legacy", iso(base + 6 * DAY));
    expect(seeded).not.toBeNull();
    expect(seeded!.origin).toBe("auto");
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
    // The one-time flag means it never seeds again, even with more history.
    for (let i = 0; i < 5; i++) mem("more later", 0.3, iso(base + (7 + i) * DAY));
    expect(backfillInitialChapter(ctx, "legacy", iso(base + 20 * DAY))).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
  });

  it("skips the backfill when there's too little history (grows organically instead)", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("a lone early note", 0.2, iso(base));
    expect(backfillInitialChapter(ctx, "legacy", iso(base + DAY))).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(0);
  });

  it("does not backfill when chapters already exist", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("x", 0.2, iso(base));
    mem("y", 0.2, iso(base + DAY));
    mem("z", 0.2, iso(base + 2 * DAY));
    createManualChapter(ctx, "legacy", { nowISO: iso(base + 3 * DAY) });
    expect(backfillInitialChapter(ctx, "legacy", iso(base + 4 * DAY))).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
  });

  it("can delete a chapter", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("x", 0.2, iso(base));
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(base + DAY) })!;
    expect(deleteChapter(ctx, "legacy", ch.id)).toBe(true);
    expect(listChapters(ctx, "legacy")).toHaveLength(0);
  });
});
