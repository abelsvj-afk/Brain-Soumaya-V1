import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { listCognitive, type CognitiveItem } from "../analysis/cognitive.js";
import { COGNITIVE_META, type CognitiveKind } from "@brain/shared";

/**
 * Equivalence pin for the listCognitive degree rewrite (cogperf / Finding 2).
 *
 * The degree used to be a correlated per-row COUNT(*) over edges (source OR
 * target, same space, no relationship filter). It is now one grouped
 * aggregation joined onto the page. This test runs the ORIGINAL query —
 * copied verbatim below as the reference implementation — against randomized
 * fixtures and demands listCognitive return byte-identical results, so any
 * semantic drift in the rewrite (self-loops double-counted, cross-space
 * edges leaking in, LIMIT interplay) fails here.
 */

// ── The original (pre-rewrite) query + row mapping, verbatim ────────────────
function referenceListCognitive(handle: DbHandle, spaceId: string, kind?: CognitiveKind): CognitiveItem[] {
  const kinds = kind ? [kind] : (Object.keys(COGNITIVE_META) as CognitiveKind[]);
  const placeholders = kinds.map(() => "?").join(",");
  const rows = handle.sqlite
    .prepare(
      `SELECT n.id, n.kind, n.label, n.content, n.progress, n.completed_at AS completedAt, n.aliases, n.created_at AS createdAt,
         n.remind_at AS remindAt,
         (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id)) AS degree
       FROM nodes n
       WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.kind IN (${placeholders})
       ORDER BY n.id DESC LIMIT 100`,
    )
    .all(spaceId, ...kinds) as (Omit<CognitiveItem, "kind" | "aliases"> & { kind: string; aliases: string | null })[];
  return rows.map((r) => {
    let aliases: string[] = [];
    try {
      if (r.aliases) {
        const parsed: unknown = JSON.parse(r.aliases);
        if (Array.isArray(parsed)) aliases = parsed.map(String);
      }
    } catch {
      /* ignore */
    }
    return { ...r, kind: r.kind as CognitiveKind, aliases };
  });
}

// Deterministic LCG — same seed, same graph, on every machine.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const COG_KINDS = Object.keys(COGNITIVE_META);
const RELS = ["supports", "relates_to", "mentions", "caused_by"];

/**
 * Seed a two-space graph designed to break naive rewrites:
 * self-loops (old semantics count them once), parallel edges between the same
 * pair, edge rows owned by the OTHER space pointing at this space's nodes,
 * edges touching deleted nodes, and malformed legacy aliases values.
 */
function seedGraph(handle: DbHandle, seed: number, cogCount: number) {
  const s = handle.sqlite;
  const rand = rng(seed);
  const pick = (n: number) => 1 + Math.floor(rand() * n);
  const tx = s.transaction(() => {
    const insNode = s.prepare(
      `INSERT INTO nodes (id, space_id, label, type, content, kind, aliases, deleted_at)
       VALUES (?, ?, ?, 'concept', ?, ?, ?, ?)`,
    );
    let id = 0;
    const mainIds: number[] = [];
    const otherIds: number[] = [];
    for (let i = 0; i < cogCount; i++) {
      id++;
      const aliases =
        i % 7 === 3 ? JSON.stringify([`aka-${i}`, 42]) : i % 7 === 5 ? JSON.stringify(`bare-string-${i}`) : i % 7 === 6 ? "not json" : null;
      insNode.run(id, "main", `cog-${i}`, `content ${i}`, COG_KINDS[i % COG_KINDS.length]!, aliases, i % 11 === 10 ? "2026-01-01T00:00:00.000Z" : null);
      mainIds.push(id);
    }
    for (let i = 0; i < 40; i++) {
      id++;
      insNode.run(id, "main", `mem-${i}`, `memory ${i}`, "memory", null, null);
      mainIds.push(id);
    }
    for (let i = 0; i < 12; i++) {
      id++;
      insNode.run(id, "other", `other-cog-${i}`, `other ${i}`, COG_KINDS[i % COG_KINDS.length]!, null, null);
      otherIds.push(id);
    }
    const all = [...mainIds, ...otherIds];
    const insEdge = s.prepare(
      `INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, ?, 1)`,
    );
    const edgeCount = cogCount * 6;
    for (let i = 0; i < edgeCount; i++) {
      const a = all[pick(all.length) - 1]!;
      const b = all[pick(all.length) - 1]!;
      // ~70% of rows belong to the endpoints' home space of `a`; the rest are
      // cross-owned rows that must NOT count toward a node's degree.
      const owner = rand() < 0.7 ? (otherIds.includes(a) ? "other" : "main") : otherIds.includes(a) ? "main" : "other";
      insEdge.run(owner, a, b, RELS[Math.floor(rand() * RELS.length)]!);
    }
    // Forced pathologies, regardless of the random draw:
    const c0 = mainIds[0]!;
    const c1 = mainIds[1]!;
    insEdge.run("main", c0, c0, "supports"); // self-loop → degree +1, not +2
    insEdge.run("main", c0, c1, "supports"); // parallel pair…
    insEdge.run("main", c0, c1, "relates_to"); // …counts as 2 rows
    insEdge.run("other", c0, c1, "supports"); // foreign-owned row → counts for neither
  });
  tx();
}

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

describe("listCognitive degree — grouped rewrite ≡ original per-row count", () => {
  for (const seed of [1, 7, 42]) {
    it(`matches the reference on randomized graph (seed ${seed})`, () => {
      seedGraph(handle, seed, 60);
      expect(listCognitive(ctx, "main")).toEqual(referenceListCognitive(handle, "main"));
      expect(listCognitive(ctx, "main", "goal")).toEqual(referenceListCognitive(handle, "main", "goal"));
      expect(listCognitive(ctx, "other")).toEqual(referenceListCognitive(handle, "other"));
      // Sanity: the fixture really does exercise non-trivial degrees.
      const degrees = referenceListCognitive(handle, "main").map((i) => i.degree);
      expect(Math.max(...degrees)).toBeGreaterThan(3);
    });
  }

  it("matches the reference when cognitive rows exceed the LIMIT 100 page", () => {
    seedGraph(handle, 99, 130);
    const actual = listCognitive(ctx, "main");
    expect(actual.length).toBe(100);
    expect(actual).toEqual(referenceListCognitive(handle, "main"));
  });

  it("counts a self-loop once and parallel edges per row", () => {
    // Hand-built minimal case (ids laid out explicitly):
    const s = handle.sqlite;
    s.prepare(`INSERT INTO nodes (id, space_id, label, type, content, kind) VALUES (1, 'main', 'A', 'concept', '', 'goal')`).run();
    s.prepare(`INSERT INTO nodes (id, space_id, label, type, content, kind) VALUES (2, 'main', 'B', 'concept', '', 'goal')`).run();
    s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('main', 1, 1, 'supports')`).run();
    s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('main', 1, 2, 'supports')`).run();
    s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('main', 2, 1, 'relates_to')`).run();
    const items = listCognitive(ctx, "main");
    expect(items.find((i) => i.id === 1)?.degree).toBe(3); // self-loop + both parallels
    expect(items.find((i) => i.id === 2)?.degree).toBe(2);
    expect(items).toEqual(referenceListCognitive(handle, "main"));
  });
});
