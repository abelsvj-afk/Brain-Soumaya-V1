import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { createCognitive, listCognitive } from "../analysis/cognitive.js";
import { splitIdeaManual, mergeIdeasManual, splitRipeIdea } from "../analysis/ideas.js";
import { SourcesRepo } from "../repositories/sources.repo.js";

/**
 * IM-136 — user-triggered idea split / merge (docs/COGNITIVE_LAYER.md Phase 3).
 * The contract under test is the CONSERVATIVE one the Mind tab promises:
 * nothing is hard-deleted, merge unions links/evidence and keeps the folded
 * idea's label discoverable as an alias, split loses no supporting memory
 * (the union of both branches' backers equals the original's).
 */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

async function mem(label: string, content: string, spaceId = "legacy") {
  return new NodesRepo(handle, spaceId).create({ label, type: "daily", content } as never, await embeddings.embed(content));
}
function support(spaceId: string, from: number, to: number, weight = 0.7) {
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, 'supports', ?)`)
    .run(spaceId, from, to, weight);
}
const supportsInto = (anchorId: number, spaceId = "legacy") =>
  (handle.sqlite
    .prepare(`SELECT COUNT(*) AS c FROM edges WHERE space_id = ? AND relationship = 'supports' AND target = ?`)
    .get(spaceId, anchorId) as { c: number }).c;
const nodeRow = (id: number) =>
  handle.sqlite
    .prepare(`SELECT label, content, aliases, deleted_at AS deletedAt, merged_into AS mergedInto, kind FROM nodes WHERE id = ?`)
    .get(id) as { label: string; content: string; aliases: string | null; deletedAt: string | null; mergedInto: number | null; kind: string } | undefined;

describe("IM-136 — manual idea merge", () => {
  it("unions supporting links onto the survivor and never doubles an edge", async () => {
    const keep = await createCognitive(ctx, "legacy", "idea", "Build a boat", "wooden hull plans");
    const drop = await createCognitive(ctx, "legacy", "idea", "Sail the coast", "charts and sails");
    const m1 = await mem("hull", "sanding the hull");
    const m2 = await mem("charts", "buying coastal charts");
    const both = await mem("trip", "the boat trip");
    support("legacy", m1.id, keep);
    support("legacy", m2.id, drop);
    support("legacy", both.id, keep);
    support("legacy", both.id, drop); // already backs both — must not duplicate

    expect(await mergeIdeasManual(ctx, "legacy", keep, drop)).toBe(true);
    expect(supportsInto(keep)).toBe(3);
    // No edge of any relationship still touches the dropped idea.
    const touching = (handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM edges WHERE space_id = 'legacy' AND (source = ? OR target = ?)`)
      .get(drop, drop) as { c: number }).c;
    expect(touching).toBe(0);
  });

  it("is non-destructive: the folded idea is soft-deleted (recoverable), its label survives as an alias, its content is preserved", async () => {
    const keep = await createCognitive(ctx, "legacy", "idea", "Build a boat", "wooden hull plans");
    const drop = await createCognitive(ctx, "legacy", "idea", "Sail the coast", "charts and sails");
    expect(await mergeIdeasManual(ctx, "legacy", keep, drop)).toBe(true);

    const dropped = nodeRow(drop)!;
    expect(dropped.deletedAt).not.toBeNull(); // soft-deleted…
    expect(dropped.mergedInto).toBe(keep); // …and points at the survivor (recoverable)
    const survivor = listCognitive(ctx, "legacy", "idea").find((i) => i.id === keep)!;
    expect(survivor.aliases).toContain("Sail the coast"); // label stays discoverable
    expect(survivor.content).toContain("wooden hull plans");
    expect(survivor.content).toContain("charts and sails"); // content unioned, not lost
    // The folded idea no longer lists as a live cognitive item.
    expect(listCognitive(ctx, "legacy", "idea").map((i) => i.id)).toEqual([keep]);
  });

  it("re-points edges in BOTH directions (an outgoing link of the dropped idea survives on the survivor)", async () => {
    const keep = await createCognitive(ctx, "legacy", "idea", "Alpha thread", "a");
    const drop = await createCognitive(ctx, "legacy", "idea", "Beta thread", "b");
    const goal = await createCognitive(ctx, "legacy", "goal", "Some goal", "");
    handle.sqlite
      .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES ('legacy', ?, ?, 'relates_to', 0.5)`)
      .run(drop, goal);
    expect(await mergeIdeasManual(ctx, "legacy", keep, drop)).toBe(true);
    const row = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM edges WHERE space_id = 'legacy' AND source = ? AND target = ? AND relationship = 'relates_to'`)
      .get(keep, goal) as { c: number };
    expect(row.c).toBe(1);
  });

  it("refuses non-ideas, the same id twice, missing ids, and cross-space merges", async () => {
    const idea = await createCognitive(ctx, "legacy", "idea", "One", "");
    const goal = await createCognitive(ctx, "legacy", "goal", "Not an idea", "");
    const otherSpaceIdea = await createCognitive(ctx, "other", "idea", "Elsewhere", "");
    expect(await mergeIdeasManual(ctx, "legacy", idea, idea)).toBe(false);
    expect(await mergeIdeasManual(ctx, "legacy", idea, goal)).toBe(false);
    expect(await mergeIdeasManual(ctx, "legacy", goal, idea)).toBe(false);
    expect(await mergeIdeasManual(ctx, "legacy", idea, 999_999)).toBe(false);
    expect(await mergeIdeasManual(ctx, "legacy", idea, otherSpaceIdea)).toBe(false);
    // Nothing was harmed by the refused merges.
    expect(nodeRow(idea)!.deletedAt).toBeNull();
    expect(nodeRow(otherSpaceIdea)!.deletedAt).toBeNull();
  });
});

describe("IM-136 — manual idea split", () => {
  it("creates a second idea, keeps the original intact, and loses no supporting memory", async () => {
    const idea = await createCognitive(ctx, "legacy", "idea", "Weekend projects", "the weekend pile");
    const backers: number[] = [];
    for (const [label, content] of [
      ["saw", "cutting timber with the saw and hammer for the deck frame"],
      ["drill", "drilling pilot holes and driving screws into the timber deck"],
      ["recipe", "cooking tomato sauce with basil garlic and olive oil"],
      ["bake", "cooking sourdough bread with flour water salt and yeast"],
    ] as const) {
      const m = await mem(label, content);
      backers.push(m.id);
      support("legacy", m.id, idea);
    }
    expect(supportsInto(idea)).toBe(4);

    const out = await splitIdeaManual(ctx, "legacy", idea, { newLabel: "Cooking projects" });
    expect(out).not.toBeNull();
    const branch = listCognitive(ctx, "legacy", "idea").find((i) => i.id === out!.newId)!;
    expect(branch.label).toBe("Cooking projects");
    expect(nodeRow(idea)!.deletedAt).toBeNull(); // original survives
    expect(nodeRow(idea)!.label).toBe("Weekend projects"); // …with its own label
    // Conservation: every backer still supports exactly one of the two ideas.
    expect(supportsInto(idea) + supportsInto(out!.newId)).toBe(4);
    // The cooking memories are the ones nearer the new branch — they moved.
    expect(supportsInto(out!.newId)).toBeGreaterThan(0);
  });

  it("an explicit branch content wins over inheriting the original's", async () => {
    const idea = await createCognitive(ctx, "legacy", "idea", "Big vague idea", "original words");
    const out = await splitIdeaManual(ctx, "legacy", idea, { newLabel: "Sharper half", content: "branch words" });
    expect(out).not.toBeNull();
    expect(nodeRow(out!.newId)!.content).toBe("branch words");
    expect(nodeRow(idea)!.content).toBe("original words");
  });

  it("refuses non-ideas and missing ids", async () => {
    const goal = await createCognitive(ctx, "legacy", "goal", "Not an idea", "");
    expect(await splitIdeaManual(ctx, "legacy", goal, { newLabel: "Nope" })).toBeNull();
    expect(await splitIdeaManual(ctx, "legacy", 999_999, { newLabel: "Nope" })).toBeNull();
    expect(listCognitive(ctx, "legacy", "idea")).toEqual([]);
  });
});

describe("Fix D regression: 12D split link inheritance", () => {
  function linkIdeaToSource(ideaId: number) {
    const repo = new SourcesRepo(handle, "legacy");
    const { source } = repo.persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: "the exact words behind this idea, kept verbatim",
    });
    repo.linkNodeToAllChunks(ideaId, source.id);
    return { repo, source };
  }

  it("manual split: child inherits the parent's active origin links; parent's links unchanged", async () => {
    const idea = await createCognitive(ctx, "legacy", "idea", "Weekend projects", "the weekend pile");
    const { repo, source } = linkIdeaToSource(idea);
    const parentBefore = repo.activeLinksForNode(idea);
    expect(parentBefore.length).toBeGreaterThan(0);
    expect(parentBefore.every((l) => l.sourceId === source.id)).toBe(true);

    const out = await splitIdeaManual(ctx, "legacy", idea, { newLabel: "Cooking projects" });
    expect(out).not.toBeNull();
    expect(repo.activeLinksForNode(out!.newId)).toEqual(parentBefore);
    expect(repo.activeLinksForNode(idea)).toEqual(parentBefore);
    expect(repo.hasActiveOriginLink(out!.newId)).toBe(true);
  });

  it("autonomous split (splitRipeIdea): the new branch inherits the parent's origin links; parent's links unchanged", async () => {
    const id = await createCognitive(ctx, "legacy", "idea", "A creative project", "");
    const { repo } = linkIdeaToSource(id);
    const parentBefore = repo.activeLinksForNode(id);
    expect(parentBefore.length).toBeGreaterThan(0);
    const nodes = new NodesRepo(handle, "legacy");
    const edges = new EdgesRepo(handle, "legacy");
    for (let i = 0; i < 3; i++) {
      const m = nodes.create({ label: `music ${i}`, type: "daily", content: "recording guitar songs in the studio" } as never, await embeddings.embed("recording guitar songs in the studio"));
      edges.create({ source: m.id, target: id, relationship: "supports", weight: 0.7 });
    }
    for (let i = 0; i < 3; i++) {
      const m = nodes.create({ label: `garden ${i}`, type: "daily", content: "planting tomatoes in the vegetable garden" } as never, await embeddings.embed("planting tomatoes in the vegetable garden"));
      edges.create({ source: m.id, target: id, relationship: "supports", weight: 0.7 });
    }
    const branchId = await splitRipeIdea(ctx, "legacy");
    expect(branchId).not.toBeNull();
    expect(repo.activeLinksForNode(branchId!)).toEqual(parentBefore);
    expect(repo.activeLinksForNode(id)).toEqual(parentBefore);
  });
});
