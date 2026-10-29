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
/** Insert a named anchor (person / goal / skill / identity) for theme matching. */
function anchor(label: string, kind: string, createdAt: string) {
  handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, kind, type, content, emotional_weight, importance, created_at)
       VALUES ('legacy', ?, ?, 'cognitive', '', 0, 0.5, ?)`,
    )
    .run(label, kind, createdAt);
}
/** Insert a stored chapter row directly (simulates legacy rows the guards never saw). */
function chapterRow(periodEnd: string, origin: string, memoryIds: number[] = [], periodStart?: string) {
  const info = handle.sqlite
    .prepare(
      `INSERT INTO timeline_chapters (space_id, title, summary, theme, trend, score, period_start, period_end, memory_ids, photo_ids, threads, origin)
       VALUES ('legacy', ?, '', '', 'neutral', 0, ?, ?, ?, '[]', '[]', ?)`,
    )
    .run("direct row", periodStart ?? periodEnd, periodEnd, JSON.stringify(memoryIds), origin);
  return Number(info.lastInsertRowid);
}

const DAY = 86_400_000;
const iso = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();

describe("Batch K — CHR-03 (REG-122): anchor matching is token/word-boundary aware", () => {
  it("a short name does NOT match as a substring inside other words ('Sam' vs 'same')", () => {
    const base = Date.UTC(2026, 0, 1);
    anchor("Sam", "person_entity", iso(base));
    for (let i = 0; i < 6; i++) mem("the same old routine, same as always", 0.5, iso(base + i * DAY));
    const a = assessChange(ctx, "legacy", iso(base + 7 * DAY));
    expect(a.threads.map((t) => t.name)).not.toContain("Sam");
    expect(a.theme).not.toBe("Sam");
  });

  it("'Art' does NOT match 'start' / 'part'", () => {
    const base = Date.UTC(2026, 0, 1);
    anchor("Art", "skill", iso(base));
    for (let i = 0; i < 6; i++) mem("start the day, part of the plan, restarting again", 0.5, iso(base + i * DAY));
    const a = assessChange(ctx, "legacy", iso(base + 7 * DAY));
    expect(a.threads.map((t) => t.name)).not.toContain("Art");
    expect(a.theme).not.toBe("Art");
  });

  it("a genuine word mention DOES match — including a possessive ('Sam\\'s')", () => {
    const base = Date.UTC(2026, 0, 1);
    anchor("Sam", "person_entity", iso(base));
    for (let i = 0; i < 4; i++) mem("met Sam at the park, Sam was in good spirits", 0.6, iso(base + i * DAY));
    mem("it was Sam's birthday and we celebrated", 0.6, iso(base + 4 * DAY));
    mem("an ordinary day with no one in particular", 0.1, iso(base + 5 * DAY));
    const a = assessChange(ctx, "legacy", iso(base + 7 * DAY));
    expect(a.theme).toBe("Sam");
    expect(a.threads[0]?.name).toBe("Sam");
  });

  it("a multi-word label matches as a token phrase, not as a glued token ('Mary Jane' vs 'Maryjane')", () => {
    const base = Date.UTC(2026, 0, 1);
    anchor("Mary Jane", "person_entity", iso(base));
    for (let i = 0; i < 4; i++) mem("Mary Jane came over for dinner", 0.6, iso(base + i * DAY));
    const a = assessChange(ctx, "legacy", iso(base + 5 * DAY));
    expect(a.theme).toBe("Mary Jane");
    expect(a.threads[0]?.name).toBe("Mary Jane");

    // A second brain state: only the glued single token appears — no match.
    const handle2 = createDb(":memory:");
    const ctx2 = { handle: handle2, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle2) } as AppContext;
    try {
      handle2.sqlite
        .prepare(
          `INSERT INTO nodes (space_id, label, kind, type, content, emotional_weight, importance, created_at)
           VALUES ('legacy', ?, ?, 'cognitive', '', 0, 0.5, ?)`,
        )
        .run("Mary Jane", "person_entity", iso(base));
      for (let i = 0; i < 4; i++) {
        handle2.sqlite
          .prepare(
            `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at)
             VALUES ('legacy', ?, 'daily', ?, ?, ?, ?)`,
          )
          .run(`m${i}`, "Maryjane Smith called about the lease", 0.6, 0.5, iso(base + i * DAY));
      }
      const b = assessChange(ctx2, "legacy", iso(base + 5 * DAY));
      expect(b.threads.map((t) => t.name)).not.toContain("Mary Jane");
      expect(b.theme).not.toBe("Mary Jane");
    } finally {
      handle2.sqlite.close();
    }
  });

  it("a chapter title is never built from a substring accident", () => {
    const base = Date.UTC(2026, 0, 1);
    anchor("Sam", "person_entity", iso(base));
    for (let i = 0; i < 6; i++) mem("the same old routine, same as always", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    // The title must not credit the person Sam — "same" is a genuine word
    // in the text (the frequent-word fallback may pick it), but the Sam
    // ANCHOR must never author the title. (Exact match, not substring:
    // "Same" contains "Sam" as characters — the old bug's own shape.)
    expect(ch!.title).not.toBe("Rising through Sam");
    expect(ch!.theme).not.toBe("Sam");
  });
});

describe("Batch K — CHR-07 (REG-126): the cap keeps the NEWEST chapters", () => {
  it("listChapters past 500 returns the newest 500, oldest-first, true latest last", () => {
    const base = Date.UTC(2026, 0, 1);
    const ids: number[] = [];
    for (let i = 0; i < 505; i++) {
      ids.push(chapterRow(iso(base + i * DAY), "auto"));
    }
    const list = listChapters(ctx, "legacy");
    expect(list).toHaveLength(500);
    // The five OLDEST are the ones dropped — never the newest.
    expect(list[0]!.id).toBe(ids[5]);
    expect(list[list.length - 1]!.id).toBe(ids[504]);
    // Still oldest → newest order within the retained window.
    const ends = list.map((c) => c.periodEnd);
    expect([...ends].sort()).toEqual(ends);
  });
});

describe("Batch K — CHR-12 (REG-131): an empty window writes no chapter and never blocks backfill", () => {
  it("marking over an empty window writes nothing and reports nothing created", () => {
    const base = Date.UTC(2026, 0, 1);
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(base) });
    expect(ch).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(0);
  });

  it("marking again with no new memories since the last chapter writes nothing", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("just one small thing", 0.0, iso(base));
    const first = createManualChapter(ctx, "legacy", { nowISO: iso(base + DAY) });
    expect(first).not.toBeNull();
    const second = createManualChapter(ctx, "legacy", { nowISO: iso(base + 2 * DAY) });
    expect(second).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
  });

  it("a legacy content-free manual chapter does NOT suppress the opening backfill", () => {
    const base = Date.UTC(2026, 0, 1);
    // A pre-guard empty manual chapter: collapsed period, no memories.
    chapterRow(iso(base), "user", []);
    expect(listChapters(ctx, "legacy")).toHaveLength(1);
    // Real history arrives later.
    for (let i = 0; i < 5; i++) mem("real early history", 0.3, iso(base + (1 + i) * DAY));
    const seeded = backfillInitialChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(seeded).not.toBeNull();
    expect(seeded!.origin).toBe("auto");
    expect(listChapters(ctx, "legacy")).toHaveLength(2);
    // …and the backfill still runs exactly once.
    expect(backfillInitialChapter(ctx, "legacy", iso(base + 8 * DAY))).toBeNull();
    expect(listChapters(ctx, "legacy")).toHaveLength(2);
  });

  it("deleting the empty manual chapter also leaves backfill available", () => {
    const base = Date.UTC(2026, 0, 1);
    const emptyId = chapterRow(iso(base), "user", []);
    expect(deleteChapter(ctx, "legacy", emptyId)).toBe(true);
    for (let i = 0; i < 5; i++) mem("real early history", 0.3, iso(base + (1 + i) * DAY));
    expect(backfillInitialChapter(ctx, "legacy", iso(base + 7 * DAY))).not.toBeNull();
  });
});
