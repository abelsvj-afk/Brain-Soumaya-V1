// Fix round 7 — regression tests for the ChatGPT re-audit P1 blocker:
// a TOMBSTONED node's quoting label/tags/aliases/celestial title and
// research columns were never scrubbed. The tombstone UPDATE replaced
// `content` only, so the forgotten span survived verbatim in the
// row's metadata — and the zero-hit sweep covers tombstoned rows, so
// a quoting tombstone is a surviving quote, not a follow-up. These
// tests assert the FIXED behavior: on BOTH tombstone paths (linked
// multi-origin node + unlinked node), the metadata and research
// columns are excised in the same transaction as the tombstone, the
// FTS and vec rows stay dropped (never re-indexed), and no 24-char
// window of the forgotten source survives anywhere in the row.
// Each test is fail-before: on the round-6 tree the span assertions
// fail (the metadata is left intact by the tombstone).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import {
  forgetSourceByRequest,
  createForgetSourceRequest,
  approveForgetSourceRequest,
} from "../sources/forgetSource.js";

const SPACE = "legacy";
const FORGET_TOMBSTONE = "[forgotten at the owner's request]";
let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

async function forgetSource(sourceId: number) {
  const created = createForgetSourceRequest(handle, SPACE, sourceId);
  const reqId = approveForgetSourceRequest(handle, SPACE, created.requestId).requestId;
  return forgetSourceByRequest(handle, reqId);
}

type TombstoneRow = {
  label: string;
  tags: string | null;
  aliases: string | null;
  celestial_title: string | null;
  content: string;
  deleted_at: string | null;
  research_questions: string | null;
  research_answers: string | null;
};

function tombstoneRow(nodeId: number): TombstoneRow {
  return handle.sqlite
    .prepare(
      `SELECT label, tags, aliases, celestial_title, content, deleted_at, research_questions, research_answers FROM nodes WHERE id = ?`,
    )
    .get(nodeId) as TombstoneRow;
}

function ftsCount(nodeId: number): number {
  return (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?`).get(nodeId) as { c: number }).c;
}

function vecCount(nodeId: number): number {
  return (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_nodes WHERE node_id = ?`).get(nodeId) as { c: number }).c;
}

describe("Fix round 7 — quoting metadata on a TOMBSTONED node", () => {
  it("a linked multi-origin node whose content quotes is tombstoned AND its label/tags/aliases/title/research are scrubbed in the same transaction", async () => {
    const SPAN = "TOMBSTONELABEL2026!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ${SPAN} alpha` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;

    // Multi-origin node: CONTENT quotes (tombstones), and its LABEL,
    // TAGS, ALIASES, CELESTIAL TITLE and RESEARCH columns quote too.
    const doomed = nodes.create(
      {
        label: `hub ${SPAN}`,
        type: "daily",
        content: `body quotes ${SPAN} here`,
        tags: [SPAN],
        aliases: [`orbit ${SPAN}`],
        celestialTitle: `The ${SPAN} Nebula`,
      },
      await embeddings.embed("rr7-linked"),
    );
    nodes.updateResearch(
      doomed.id,
      [`what about ${SPAN}?`, "a clean question"],
      { q1: `my answer ${SPAN} here`, q2: "clean answer" },
    );
    repo.linkNodeToAllChunks(doomed.id, srcA.id);
    repo.linkNodeToAllChunks(doomed.id, srcB.id);

    const res = await forgetSource(srcA.id);

    // Tombstoned, not erased: other origins remain, content quotes.
    expect(res.nodesTombstoned).toContain(doomed.id);
    expect(res.nodesSurvivedClean).not.toContain(doomed.id);
    expect(res.nodesErased).not.toContain(doomed.id);
    expect(res.nodesLabelScrubbed).toContain(doomed.id);
    expect(res.unresolved).toEqual([]);
    const row = tombstoneRow(doomed.id);
    // The tombstone itself is the permitted marker.
    expect(row.content).toBe(FORGET_TOMBSTONE);
    expect(row.deleted_at).not.toBeNull();
    // Metadata excised in place, same shapes as the round-5/6
    // surviving-node scrub (label keeps its clean part, a tag that IS
    // the quote is dropped, the alias keeps its clean part, the title
    // loses the quoting window, research keeps clean entries).
    expect(row.label).toBe("hub");
    expect(row.tags).toBeNull();
    expect(row.aliases).toBe(JSON.stringify(["orbit"]));
    expect(row.celestial_title).toBe("Th Nebula");
    expect(JSON.parse(row.research_questions as string)).toEqual(["what about?", "a clean question"]);
    expect(JSON.parse(row.research_answers as string)).toEqual({ q1: "my answer here", q2: "clean answer" });
    // FTS and vec rows stay dropped — the scrub must not re-index them.
    expect(ftsCount(doomed.id)).toBe(0);
    expect(vecCount(doomed.id)).toBe(0);
    // Whole-row sweep: no representation of the node holds the span.
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(doomed.id));
    expect(blob).not.toContain(SPAN);
  });

  it("an unlinked node whose content quotes is tombstoned AND its quoting metadata/research are scrubbed", async () => {
    const SPAN = "UNLINKEDTOMB2026!!!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `unlinked ${SPAN} capture` }).source;

    // No node_sources row at all: the unlinked sweep tombstones it.
    const doomed = nodes.create(
      {
        label: `note ${SPAN}`,
        type: "daily",
        content: `body quotes ${SPAN} here`,
        tags: [`trail ${SPAN}`, "keep me"],
      },
      await embeddings.embed("rr7-unlinked"),
    );
    nodes.updateResearch(
      doomed.id,
      [`why ${SPAN}?`],
      { q1: `because ${SPAN} happened` },
    );

    const res = await forgetSource(srcA.id);

    expect(res.nodesTombstoned).toContain(doomed.id);
    expect(res.nodesSurvivedClean).not.toContain(doomed.id);
    expect(res.nodesLabelScrubbed).toContain(doomed.id);
    const row = tombstoneRow(doomed.id);
    expect(row.content).toBe(FORGET_TOMBSTONE);
    expect(row.deleted_at).not.toBeNull();
    expect(row.label).toBe("note");
    // The quoting tag keeps its clean remainder; the clean tag stays.
    expect(row.tags).toBe(JSON.stringify(["trail", "keep me"]));
    expect(JSON.parse(row.research_questions as string)).toEqual(["why?"]);
    expect(JSON.parse(row.research_answers as string)).toEqual({ q1: "because happened" });
    expect(ftsCount(doomed.id)).toBe(0);
    expect(vecCount(doomed.id)).toBe(0);
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(doomed.id));
    expect(blob).not.toContain(SPAN);
  });

  it("a tombstoned node whose label IS the quote keeps the tombstone marker as its label (NOT NULL) with no span surviving", async () => {
    const SPAN = "WHOLETOMBSTONELBL2026!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `whole ${SPAN} capture` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "second origin capture" }).source;
    const doomed = nodes.create(
      { label: SPAN, type: "daily", content: `body quotes ${SPAN} here` },
      await embeddings.embed("rr7-whole-label"),
    );
    repo.linkNodeToAllChunks(doomed.id, srcA.id);
    repo.linkNodeToAllChunks(doomed.id, srcB.id);

    const res = await forgetSource(srcA.id);

    expect(res.nodesTombstoned).toContain(doomed.id);
    const row = tombstoneRow(doomed.id);
    expect(row.content).toBe(FORGET_TOMBSTONE);
    expect(row.label).toBe(FORGET_TOMBSTONE);
    expect(row.label).not.toContain(SPAN);
    expect(ftsCount(doomed.id)).toBe(0);
    expect(vecCount(doomed.id)).toBe(0);
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(doomed.id));
    expect(blob).not.toContain(SPAN);
  });
});
