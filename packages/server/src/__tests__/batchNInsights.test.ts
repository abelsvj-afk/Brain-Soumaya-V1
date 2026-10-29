import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { buildDailyDigest } from "../synthesis/dailyDigest.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import { findCandidates, synthesisOptionsFor, DEFAULT_SYNTHESIS } from "../synthesis/engine.js";
import { buildEmotionalTrajectory } from "../analysis/emotional.js";
import { buildLifeAreaCounts } from "../analysis/lifeAreas.js";
import { buildSelfReview } from "../analysis/selfReview.js";
import { findConstellations } from "../ml/cluster.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * Batch N — Insights cluster (REG-148…REG-158, server-side rows).
 * Each test is written fail-before: it asserts the fixed behaviour against
 * the pre-change code first, then the fix makes it pass.
 */

let handle: DbHandle;
beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

/** Naive UTC "YYYY-MM-DD HH:MM:SS" string for `daysAgo` days before now. */
function naiveDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
}

function seedNode(label: string, opts: { kind?: string; type?: string; content?: string; importance?: number } = {}): number {
  const info = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, importance, kind) VALUES ('legacy', ?, ?, ?, ?, ?)`,
    )
    .run(label, opts.type ?? "other", opts.content ?? label, opts.importance ?? 0.5, opts.kind ?? null);
  return Number(info.lastInsertRowid);
}

describe("REG-148 / INS-01 — the digest's connections are today's, not all-time recents", () => {
  it("excludes a week-old insight from today's digest connections", () => {
    const a = seedNode("old A");
    const b = seedNode("old B");
    const c = seedNode("today C");
    const d = seedNode("today D");
    const repo = new InsightsRepo(handle, "legacy");
    const oldRow = repo.create(a, b, "a stale connection from last week", 0.7);
    repo.create(c, d, "a fresh connection from today", 0.8);
    // Backdate the first insight a week (stored as naive UTC, like CURRENT_TIMESTAMP).
    handle.sqlite.prepare(`UPDATE insights SET created_at = ? WHERE id = ?`).run(naiveDaysAgo(7), oldRow.id);

    const digest = buildDailyDigest(handle, "legacy");
    const texts = digest.connections.map((x) => x.text);
    expect(texts).toContain("a fresh connection from today");
    expect(texts).not.toContain("a stale connection from last week");
  });

  it("shows today's connections when they exist, and none when the day has none", () => {
    const a = seedNode("old A");
    const b = seedNode("old B");
    const repo = new InsightsRepo(handle, "legacy");
    const oldRow = repo.create(a, b, "yesterday's connection", 0.7);
    handle.sqlite.prepare(`UPDATE insights SET created_at = ? WHERE id = ?`).run(naiveDaysAgo(1), oldRow.id);

    const digest = buildDailyDigest(handle, "legacy");
    expect(digest.connections).toEqual([]);
    // The closing line must not claim traced links when the day has none.
    expect(digest.closing).not.toMatch(/traced .* faint link/);
  });

  it("InsightsRepo.recentOnDay scopes by the space-local day", () => {
    const a = seedNode("A");
    const b = seedNode("B");
    const repo = new InsightsRepo(handle, "legacy");
    const oldRow = repo.create(a, b, "old", 0.7);
    repo.create(a, b, "today", 0.8);
    handle.sqlite.prepare(`UPDATE insights SET created_at = ? WHERE id = ?`).run(naiveDaysAgo(3), oldRow.id);

    const today = new Date().toISOString().slice(0, 10); // UTC day; NY day may differ near midnight — see note below
    void today;
    // Scope by the space-local day the digest itself reports, so the repo and
    // the digest can never disagree about which day "today" is.
    const digest = buildDailyDigest(handle, "legacy");
    const scoped = repo.recentOnDay(digest.date, "America/New_York", 5);
    expect(scoped.map((x) => x.text)).toEqual(["today"]);
  });
});

describe("REG-151 / INS-04 — the synthesis gate is provider-aware like the contradiction gate", () => {
  it("synthesisOptionsFor drops the threshold to 0.5 under hash embeddings, keeps 0.82 for a real model", () => {
    expect(synthesisOptionsFor("hash-bow").threshold).toBe(0.5);
    expect(synthesisOptionsFor("hash-bow").k).toBe(DEFAULT_SYNTHESIS.k);
    expect(synthesisOptionsFor("hash-bow").minHops).toBe(DEFAULT_SYNTHESIS.minHops);
    expect(synthesisOptionsFor("hash-bow").maxCandidates).toBe(DEFAULT_SYNTHESIS.maxCandidates);
    expect(synthesisOptionsFor("Xenova/all-MiniLM-L6-v2").threshold).toBe(0.82);
    expect(synthesisOptionsFor("").threshold).toBe(0.82);
  });

  it("a genuinely latent pair at cosine ~0.69 is reachable under hash options and unreachable at the flat 0.82", () => {
    const nodesRepo = new NodesRepo(handle, "legacy");
    // Two isolated memories (no edges → graph-distant by construction) whose
    // embeddings sit at cosine 0.69 — the contradiction scan's own measured
    // hash cosine for an obvious pair (~0.69, see contradictions.ts).
    const v1 = new Float32Array(EMBED_DIM);
    v1[0] = 1;
    const v2 = new Float32Array(EMBED_DIM);
    v2[0] = 0.69;
    v2[1] = Math.sqrt(1 - 0.69 * 0.69);
    const a = nodesRepo.create({ label: "alpha", content: "alpha", type: "other" }, v1);
    const b = nodesRepo.create({ label: "beta", content: "beta", type: "other" }, v2);

    expect(findCandidates(handle, DEFAULT_SYNTHESIS, "legacy")).toEqual([]);
    const underHash = findCandidates(handle, synthesisOptionsFor("hash-bow"), "legacy");
    expect(underHash).toHaveLength(1);
    expect(new Set([underHash[0]!.a, underHash[0]!.b])).toEqual(new Set([a.id, b.id]));
    expect(underHash[0]!.similarity).toBeCloseTo(0.69, 2);
  });
});

describe("REG-153 / INS-06 — every emotional pattern carries its basis (days counted, window)", () => {
  function seedValence(label: string, valence: number, occurredAt: string, tags?: string[]) {
    handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content, emotional_weight, occurred_at, tags)
         VALUES ('legacy', ?, 'daily', ?, ?, ?, ?)`,
      )
      .run(label, label, valence, occurredAt, tags ? JSON.stringify(tags) : null);
  }

  it("a Stress cycle names its dip-day count and its day-bucket window", () => {
    seedValence("ok", 0.3, "2026-03-01T12:00:00", ["life"]);
    seedValence("bad1", -0.6, "2026-03-02T12:00:00", ["work"]);
    seedValence("ok2", 0.2, "2026-03-03T12:00:00", ["life"]);
    seedValence("bad2", -0.7, "2026-03-04T12:00:00", ["work"]);
    seedValence("bad3", -0.5, "2026-03-05T12:00:00", ["work"]);
    const t = buildEmotionalTrajectory(handle, "legacy");
    const stress = t.patterns.find((p) => p.type === "Stress cycle");
    expect(stress).toBeTruthy();
    expect(stress!.basis).toBeTruthy();
    expect(stress!.basis!).toMatch(/3/); // 3 heavy days
    expect(stress!.basis!).toContain("2026-03-01");
    expect(stress!.basis!).toContain("2026-03-05");
  });

  it("a Burnout risk names its bucket count and its window", () => {
    const series = [0.6, 0.5, 0.4, -0.3, -0.5, -0.6];
    series.forEach((v, i) => seedValence(`b${i}`, v, `2026-04-0${i + 1}T12:00:00`));
    const t = buildEmotionalTrajectory(handle, "legacy");
    const burnout = t.patterns.find((p) => p.type === "Burnout risk");
    expect(burnout).toBeTruthy();
    expect(burnout!.basis).toBeTruthy();
    expect(burnout!.basis!).toMatch(/6/); // 6 day-buckets
    expect(burnout!.basis!).toContain("2026-04-01");
    expect(burnout!.basis!).toContain("2026-04-06");
  });
});

describe("REG-155 / INS-08 — the life-area lens excludes machine-authored belief nodes", () => {
  it("a belief node about money does not count toward Money", () => {
    seedNode("real money note", { type: "other", content: "pay the rent this week" });
    seedNode("she believes about money", { type: "other", content: "pay attention to money", kind: "belief" });
    const counts = buildLifeAreaCounts(handle, "legacy");
    const money = counts.find((c) => c.area === "Money");
    expect(money?.count).toBe(1);
  });
});

describe("REG-156 / INS-10 — the constellation finder drops degenerate 1-member buckets", () => {
  it("never returns a singleton cluster, even when k-means isolates one memory", () => {
    const nodesRepo = new NodesRepo(handle, "legacy");
    // Three identical vectors + one orthogonal vector: k-means (k=2) isolates
    // the orthogonal memory into its own bucket, whose cohesion would be 1.0
    // by construction (the centroid IS that vector).
    const same = new Float32Array(EMBED_DIM);
    same[0] = 1;
    const other = new Float32Array(EMBED_DIM);
    other[1] = 1;
    for (let i = 0; i < 3; i++) {
      nodesRepo.create({ label: `same ${i}`, content: "same same same", type: "other" }, Float32Array.from(same));
    }
    nodesRepo.create({ label: "lonely", content: "lonely lonely", type: "other" }, Float32Array.from(other));

    const clusters = findConstellations(handle, {}, "legacy");
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.nodes.length).toBeGreaterThanOrEqual(2);
    }
    // The isolated memory is not presented as a constellation at all — in
    // particular it never renders as "1 · 100% tight". (A multi-member
    // cluster of identical vectors may honestly have cohesion 1.0; the
    // degenerate case is the singleton, whose cohesion is 1.0 by construction.)
    expect(clusters.flatMap((c) => c.nodes.map((n) => n.label))).not.toContain("lonely");
  });
});

describe("REG-152 / INS-05 — the self-check names the Research Mode system, not a bare deep-dive", () => {
  it("the blind-spots line says Research Mode research, not 'a deep dive'", () => {
    seedNode("blind", { type: "project", content: "important but undocumented", importance: 0.8 });
    const items = buildSelfReview(handle, "legacy");
    const blind = items.find((i) => i.title === "Important blind spots");
    expect(blind).toBeTruthy();
    expect(blind!.detail).toMatch(/Research Mode research/);
    expect(blind!.detail).not.toMatch(/deep dive in Research Mode/);
  });
});
