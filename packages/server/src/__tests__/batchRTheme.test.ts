import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { maybeGenerateChapter } from "../analysis/timeline.js";

/**
 * REG-228 — the frequent-word theme fallback titled a chapter
 * "Rising through Same": "same" dominated the window text and the STOP set
 * had no entry for it (nor for similar high-frequency non-content words).
 *
 * The test isolates the fallback (no anchors at all). The reviewer's
 * scenario carries a "Sam" anchor alongside the "same" text — on the old
 * base that anchor would match by substring (REG-122's token fix lives in
 * the unmerged Batch K), which would mask the fallback entirely; Batch K
 * has now merged, so the anchored case below pins the same behaviour
 * through the anchor path instead: "Sam" gets zero hits (neither "same"
 * nor any hyphen segment matches it), the fallback runs, and "same" must
 * never be the theme.
 */

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

const DAY = 86_400_000;
const iso = (msFromEpoch: number) => new Date(msFromEpoch).toISOString();

/** Insert a named anchor node (person_entity) — not a window memory (the
 *  window query takes kind NULL / 'memory' only), but the theme anchor
 *  pass sees it. */
function personAnchor(label: string, createdAt: string) {
  handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at, kind)
       VALUES ('legacy', ?, 'person', '', 0, 0.5, ?, 'person_entity')`,
    )
    .run(label, createdAt);
}

describe("REG-228 — the theme fallback never picks a stop-word", () => {
  it("the reviewer's scenario: 'same' dominating the window is never the theme", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("the same old routine, same as always", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    expect(ch!.title).not.toBe("Rising through Same");
    expect(ch!.theme).not.toBe("same");
    // The genuine content word in the window wins instead.
    expect(ch!.theme).toBe("routine");
    expect(ch!.title).toBe("Rising through Routine");
  });

  it("a window of only stop-words yields no theme rather than a nonsense one", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("the same thing again, the same stuff every time", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    expect(ch!.theme).toBe("");
    expect(ch!.title).toBe("A season of growth");
  });

  it("N2 — the reviewer's full scenario: a 'Sam' anchor beside 'same' text still falls back to the genuine word", () => {
    const base = Date.UTC(2026, 0, 1);
    personAnchor("Sam", iso(base));
    for (let i = 0; i < 6; i++) mem("the same old routine, same as always", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    // "Sam" gets zero anchor hits ("same" is one token, never "sam") and the
    // fallback must not pick "same" either — the genuine content word wins.
    expect(ch!.theme).not.toBe("same");
    expect(ch!.theme).not.toBe("Sam");
    expect(ch!.theme).toBe("routine");
    expect(ch!.title).toBe("Rising through Routine");
  });

  it("other audited stop-words ('everything', 'nothing') are never the theme either", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("the garden grows, the garden blooms, everything changed", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    expect(ch!.theme).not.toBe("everything");
    expect(ch!.theme).not.toBe("nothing");
    expect(ch!.theme).toBe("garden");
  });
});
