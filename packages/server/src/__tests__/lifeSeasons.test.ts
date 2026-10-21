import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { maybeGenerateChapter, createManualChapter } from "../analysis/timeline.js";
import { LifeSeasonsRepo, chapterRowToSeason, seasonLabel, utcDateOf } from "../repositories/lifeSeasons.repo.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
function mem(content: string, emo: number, createdAt: string) {
  const info = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, emotional_weight, importance, created_at)
              VALUES ('legacy', ?, 'daily', ?, ?, 0.5, ?)`)
    .run(`m${seq++}`, content, emo, createdAt);
  return Number(info.lastInsertRowid);
}
function chapterRow(space: string, origin: string, start: string, end: string, theme = "recovery") {
  handle.sqlite
    .prepare(`INSERT INTO timeline_chapters (space_id, title, summary, theme, trend, score, period_start, period_end, origin)
              VALUES (?, 'A chapter', '', ?, 'growth', 0.6, ?, ?, ?)`)
    .run(space, theme, start, end, origin);
}

describe("Life Seasons detection (IM-132)", () => {
  it("derives a season from an auto-detected chapter produced by the existing heuristic", () => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 6; i++) mem("wonderful day, so happy and proud", 0.7, iso(base + i * DAY));
    const ch = maybeGenerateChapter(ctx, "legacy", iso(base + 7 * DAY));
    expect(ch).not.toBeNull();
    const seasons = new LifeSeasonsRepo(handle, "legacy").listSeasons();
    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.chapterId).toBe(ch!.id);
    expect(seasons[0]!.confidence).toBe(ch!.score);
    expect(seasons[0]!.startDate).toBe("2026-01-01");
    expect(seasons[0]!.endDate).toBe("2026-01-08");
  });

  it("does NOT turn a manual (user) chapter into a season", () => {
    const base = Date.UTC(2026, 0, 1);
    mem("just one small thing", 0.2, iso(base));
    createManualChapter(ctx, "legacy", { title: "My milestone", nowISO: iso(base + 3 * DAY) });
    chapterRow("legacy", "user", iso(base), iso(base + 10 * DAY));
    expect(new LifeSeasonsRepo(handle, "legacy").listSeasons()).toHaveLength(0);
  });

  it("is space-scoped: another space's auto chapters never leak in", () => {
    const base = Date.UTC(2026, 0, 1);
    chapterRow("other-space", "auto", iso(base), iso(base + 10 * DAY));
    expect(new LifeSeasonsRepo(handle, "legacy").listSeasons()).toHaveLength(0);
    expect(new LifeSeasonsRepo(handle, "other-space").listSeasons()).toHaveLength(1);
  });

  it("labels a themed season '<Theme> Era' and falls back to the chapter title", () => {
    expect(seasonLabel("recovery", "Anything")).toBe("Recovery Era");
    expect(seasonLabel("", "Where it began")).toBe("Where it began");
    const base = Date.UTC(2026, 0, 1);
    chapterRow("legacy", "auto", iso(base), iso(base + 10 * DAY), "college");
    expect(new LifeSeasonsRepo(handle, "legacy").listSeasons()[0]!.label).toBe("College Era");
  });

  it("excludes a sub-day auto chapter — a moment, not an era (assumed MIN_SEASON_DAYS=1)", () => {
    const base = Date.UTC(2026, 0, 1, 9, 0, 0);
    chapterRow("legacy", "auto", iso(base), iso(base + 3 * 3_600_000));
    expect(new LifeSeasonsRepo(handle, "legacy").listSeasons()).toHaveLength(0);
  });

  it("boundary: season dates are the UTC calendar dates of the stored instants", () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Pacific/Kiritimati local time and
    // still Jan 1 in America/New_York — the season boundary must be Jan 1 in
    // BOTH test timezones (fixed calendar dates, UTC getters only).
    expect(utcDateOf("2026-01-01 23:30:00")).toBe("2026-01-01");
    expect(utcDateOf("2026-01-01T00:30:00Z")).toBe("2026-01-01");
    const s = chapterRowToSeason({
      id: 7, title: "T", theme: "recovery", trend: "growth", score: 0.5,
      period_start: "2026-01-01 23:30:00", period_end: "2026-01-10 00:30:00", origin: "auto",
    });
    expect(s!.startDate).toBe("2026-01-01");
    expect(s!.endDate).toBe("2026-01-10");
  });

  it("skips chapters with unparseable periods instead of emitting NaN dates", () => {
    expect(chapterRowToSeason({ id: 1, period_start: "garbage", period_end: "2026-01-10", origin: "auto" })).toBeNull();
  });
});

describe("Journey spans (IM-132, hybrid derivation)", () => {
  it("explicit started_at/ended_at round-trip through create + update (migration columns)", () => {
    const repo = new JourneysRepo(handle, "legacy");
    const j = repo.create({ title: "College", startedAt: "2025-09-01", endedAt: "2029-05-15" });
    expect(j.startedAt).toBe("2025-09-01");
    expect(j.endedAt).toBe("2029-05-15");
    const span = repo.spanFor(j);
    expect(span.startSource).toBe("explicit");
    expect(span.endSource).toBe("explicit");
    expect(span.startDate).toBe("2025-09-01");
    expect(span.endDate).toBe("2029-05-15");
    expect(span.ongoing).toBe(false);
    const cleared = repo.update(j.id, { endedAt: undefined, status: "active" });
    expect(cleared).not.toBeNull();
  });

  it("infers the span from linked node dates when no explicit dates are set", () => {
    const repo = new JourneysRepo(handle, "legacy");
    const j = repo.create({ title: "Recovery" });
    const base = Date.UTC(2026, 2, 10);
    const a = mem("first", 0.1, iso(base));
    const b = mem("last", 0.1, iso(base + 20 * DAY));
    mem("unlinked", 0.1, iso(base - 30 * DAY));
    repo.link(j.id, "node", a);
    repo.link(j.id, "node", b);
    const active = repo.spanFor(repo.get(j.id)!);
    expect(active.start).toBe(iso(base));
    expect(active.startSource).toBe("links");
    expect(active.end).toBeNull(); // still active → ongoing, never the latest link date
    expect(active.ongoing).toBe(true);
    repo.update(j.id, { status: "done" });
    const done = repo.spanFor(repo.get(j.id)!);
    expect(done.end).toBe(iso(base + 20 * DAY));
    expect(done.endSource).toBe("links");
    expect(done.endDate).toBe("2026-03-30");
  });

  it("a link-less journey falls back to created_at (start) — defined, no NaN/crash", () => {
    const repo = new JourneysRepo(handle, "legacy");
    const j = repo.create({ title: "Brand new" });
    const span = repo.spanFor(j);
    expect(span.start).toBe(j.createdAt);
    expect(span.startSource).toBe("created");
    expect(span.ongoing).toBe(true);
    expect(span.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("explicit dates override link inference, and an inverted pair is clamped", () => {
    const repo = new JourneysRepo(handle, "legacy");
    const j = repo.create({ title: "Odd", startedAt: "2026-06-10", endedAt: "2026-06-01" });
    const span = repo.spanFor(j);
    expect(span.start).toBe("2026-06-10");
    expect(span.end).toBe("2026-06-10");
  });

  it("listSpans is space-scoped and ordered by span start", () => {
    const repo = new JourneysRepo(handle, "legacy");
    repo.create({ title: "Later", startedAt: "2026-05-01" });
    repo.create({ title: "Earlier", startedAt: "2025-01-01" });
    new JourneysRepo(handle, "other-space").create({ title: "Not mine", startedAt: "2024-01-01" });
    const spans = repo.listSpans();
    expect(spans.map((s) => s.journey.title)).toEqual(["Earlier", "Later"]);
  });

  it("migration is idempotent: the journeys span columns exist exactly once", () => {
    const cols = (handle.sqlite.prepare(`PRAGMA table_info(journeys)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((n) => n === "started_at")).toHaveLength(1);
    expect(cols.filter((n) => n === "ended_at")).toHaveLength(1);
  });
});
