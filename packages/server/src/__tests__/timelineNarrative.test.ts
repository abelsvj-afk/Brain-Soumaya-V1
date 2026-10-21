import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import {
  createManualChapter,
  listChapters,
  matchFormulaNarrative,
  countChapterNarratives,
  regenerateChapterNarratives,
  narrativeOpening,
  activeDaysOf,
} from "../analysis/timeline.js";

/**
 * Screenshot finding #5 (2026-10-21): the chapter narrative's day number
 * measured window-opening → last memory, so a 9/5–9/13 card whose 19
 * memories all landed on day one read "Across about 1 day". The measure is
 * now DISTINCT ACTIVE DAYS (space-local), the wording says exactly that,
 * and stored old-formula narratives have a regeneration path that never
 * touches non-formula text.
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
function mem(content: string, emo: number, createdAt: string, importance = 0.5) {
  const info = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at)
       VALUES ('legacy', ?, 'daily', ?, ?, ?, ?)`,
    )
    .run(`m${seq++}`, content, emo, importance, createdAt);
  return Number(info.lastInsertRowid);
}
function setSummary(id: number, summary: string) {
  handle.sqlite.prepare(`UPDATE timeline_chapters SET summary = ? WHERE id = ?`).run(summary, id);
}
function summaryOf(id: number): string {
  return listChapters(ctx, "legacy").find((c) => c.id === id)!.summary;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("narrate — distinct active days, worded exactly", () => {
  it("the finding's case: 19 memories on ONE day of a 9-day window reads 'on 1 different day'", () => {
    const base = Date.UTC(2026, 8, 5); // Sep 5
    for (let i = 0; i < 19; i++) mem("bulk log", 0.2, iso(base + (6 + i) * HOUR)); // all within Sep 5 (NY)
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 8, 13)) }); // Sep 13
    expect(ch.summary.startsWith("You added 19 memories on 1 different day.")).toBe(true);
    expect(ch.summary).not.toContain("Across about");
  });

  it("memories spread over 3 days read 'on 3 different days'", () => {
    const base = Date.UTC(2026, 0, 10);
    mem("a", 0.2, iso(base + 12 * HOUR));
    mem("b", 0.2, iso(base + DAY + 12 * HOUR));
    mem("c", 0.2, iso(base + 2 * DAY + 12 * HOUR));
    mem("d", 0.2, iso(base + 2 * DAY + 13 * HOUR));
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(base + 3 * DAY) });
    expect(ch.summary.startsWith("You added 4 memories on 3 different days.")).toBe(true);
  });

  it("active days are SPACE-local: two UTC-same-day instants straddling NY midnight count as 2 days", () => {
    // 02:00 UTC Jan 1 = Dec 31 21:00 in America/New_York (the test space's
    // default zone); 06:00 UTC Jan 1 = Jan 1 01:00 NY. One UTC day, two
    // local days — the count must follow the local calendar.
    expect(activeDaysOf([Date.UTC(2026, 0, 1, 2), Date.UTC(2026, 0, 1, 6)], "America/New_York")).toBe(2);
    expect(activeDaysOf([Date.UTC(2026, 0, 1, 2), Date.UTC(2026, 0, 1, 6)], "UTC")).toBe(1);
    const base = Date.UTC(2026, 0, 1, 2);
    mem("late night", 0.2, iso(base));
    mem("after midnight", 0.2, iso(base + 4 * HOUR));
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 3)) });
    expect(ch.summary.startsWith("You added 2 memories on 2 different days.")).toBe(true);
  });

  it("an empty window says so instead of inventing a span", () => {
    expect(narrativeOpening(0, 0)).toBe("No new memories landed in this stretch.");
    const ch = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 3)) });
    expect(ch.summary.startsWith("No new memories landed in this stretch.")).toBe(true);
  });
});

describe("matchFormulaNarrative — the template signature", () => {
  it("matches the OLD span formula, with and without optional sentences", () => {
    expect(matchFormulaNarrative("Across about 1 day, you added 19 memories.")).toEqual({ kind: "old-span", memoryCount: 19 });
    const full =
      "Across about 33 days, you added 4 memories. It held a steady register, neither soaring nor sinking. " +
      "Much of it circled around nursing. Ana, Ben kept showing up. 2 new things took root in your mind. " +
      "You captured 3 moments in pictures.";
    expect(matchFormulaNarrative(full)).toEqual({ kind: "old-span", memoryCount: 4 });
  });

  it("matches the CURRENT formula", () => {
    expect(matchFormulaNarrative("You added 4 memories on 3 different days. It pulled both ways — real highs threaded through real lows.")?.kind).toBe("current");
    expect(matchFormulaNarrative("No new memories landed in this stretch.")?.kind).toBe("current");
  });

  it("EXCLUDES anything with non-formula content", () => {
    // Hand-edited tail after a formula opening.
    expect(matchFormulaNarrative("Across about 3 days, you added 4 memories. Then I rewrote this part myself.")).toBeNull();
    // An extra sentence appended to a full formula text.
    expect(matchFormulaNarrative("Across about 3 days, you added 4 memories. It held a steady register, neither soaring nor sinking. And then everything changed.")).toBeNull();
    // Pure prose (LLM-style) and empty text.
    expect(matchFormulaNarrative("This was the winter everything changed, slowly and then all at once.")).toBeNull();
    expect(matchFormulaNarrative("")).toBeNull();
  });
});

describe("regenerateChapterNarratives — stored-text backfill with exclusion rule", () => {
  const OLD_CH1 = "Across about 5 days, you added 5 memories. It held a steady register, neither soaring nor sinking.";
  const OLD_CH2 =
    "Across about 1 day, you added 19 memories. The mood of this stretch lifted — more brightened than dimmed. Much of it circled around nursing.";
  const HAND_EDITED = "Across about 3 days, you added 4 memories. Then I rewrote this part myself because it mattered.";
  const PROSE = "This was the winter everything changed, slowly and then all at once.";
  const WRONG_COUNT = "Across about 2 days, you added 99 memories. It held a steady register, neither soaring nor sinking.";

  function seed() {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 5; i++) mem("early", 0.1, iso(base + i * DAY + 12 * HOUR));
    const ch1 = createManualChapter(ctx, "legacy", { nowISO: iso(base + 5 * DAY) });
    setSummary(ch1.id, OLD_CH1);

    for (let i = 0; i < 19; i++) mem("bulk", 0.7, iso(Date.UTC(2026, 0, 7) + (6 + i) * HOUR));
    const ch2 = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 15)) });
    setSummary(ch2.id, OLD_CH2);

    for (let i = 0; i < 4; i++) mem("hand", 0.1, iso(Date.UTC(2026, 0, 16) + i * HOUR));
    const ch3 = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 17)) });
    setSummary(ch3.id, HAND_EDITED);

    mem("prose", 0.1, iso(Date.UTC(2026, 0, 18)));
    const ch4 = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 19)) });
    setSummary(ch4.id, PROSE);

    for (let i = 0; i < 3; i++) mem("current", 0.1, iso(Date.UTC(2026, 0, 20) + i * DAY));
    const ch5 = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 23)) });
    const ch5Summary = ch5.summary; // already current formula — untouched

    for (let i = 0; i < 4; i++) mem("drift", 0.1, iso(Date.UTC(2026, 0, 24) + i * HOUR));
    const ch6 = createManualChapter(ctx, "legacy", { nowISO: iso(Date.UTC(2026, 0, 25)) });
    setSummary(ch6.id, WRONG_COUNT);

    return { ch1, ch2, ch3, ch4, ch5, ch6, ch5Summary };
  }

  it("counts classes without content: 3 old-formula-shaped (incl. the count-drifted one), 1 current, 2 non-formula", () => {
    seed();
    // WRONG_COUNT matches the old template structurally, so it counts as
    // oldFormula here; the regen pass separately refuses it on the count
    // cross-check (skippedCountMismatch).
    expect(countChapterNarratives(ctx, "legacy")).toEqual({ current: 1, oldFormula: 3, nonFormula: 2 });
  });

  it("rewrites ONLY the opening of pure old-formula narratives; excluded text is byte-identical after", () => {
    const { ch1, ch2, ch3, ch4, ch5, ch6, ch5Summary } = seed();
    const report = regenerateChapterNarratives(ctx, "legacy");
    expect(report.regenerated).toBe(2);
    expect(report.skippedCountMismatch).toBe(1);
    expect(report.nonFormula).toBe(2);

    // Before → after proof on the finding's exact shape (19 on one day):
    expect(summaryOf(ch2.id)).toBe(
      "You added 19 memories on 1 different day. The mood of this stretch lifted — more brightened than dimmed. Much of it circled around nursing.",
    );
    expect(summaryOf(ch1.id)).toBe(
      "You added 5 memories on 5 different days. It held a steady register, neither soaring nor sinking.",
    );
    // Exclusion rule: hand-edited, prose, current, and count-drifted texts
    // are all EXACTLY as stored.
    expect(summaryOf(ch3.id)).toBe(HAND_EDITED);
    expect(summaryOf(ch4.id)).toBe(PROSE);
    expect(summaryOf(ch5.id)).toBe(ch5Summary);
    expect(summaryOf(ch6.id)).toBe(WRONG_COUNT);
  });

  it("is idempotent: a second run regenerates nothing", () => {
    seed();
    regenerateChapterNarratives(ctx, "legacy");
    const second = regenerateChapterNarratives(ctx, "legacy");
    expect(second.regenerated).toBe(0);
    expect(countChapterNarratives(ctx, "legacy").oldFormula).toBe(1); // only the count-drifted one remains
  });
});
