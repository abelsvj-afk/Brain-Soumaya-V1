// Fix round 5 — regression tests for the re-review blocker (RR4
// residual (a)): a SURVIVING node's quoting label/tags/aliases/
// celestial title were never scrubbed (the scrub checked `content`
// only), so the quote stayed MATCH-retrievable in nodes_fts and was
// re-injected into the persona on re-derivation. These tests assert
// the FIXED behavior: metadata is excised in place, the FTS row is
// re-indexed, the node still survives, and the re-derived persona is
// clean. Each test is fail-before: on the round-4 tree the persona
// assertion fails (the reviewer's rr4-residual.test.ts proves it).
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
  exciseVerbatimSpans,
  containsVerbatimSpan,
} from "../sources/forgetSource.js";
import { refreshPersona } from "../persona/derive.js";

const SPACE = "legacy";
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

describe("Fix round 5 — quoting label/tags on a SURVIVING node", () => {
  it("a linked survivor's quoting label/tags/aliases/title are excised in place; FTS and persona come back clean", async () => {
    const SPAN = "RESIDUALLABELSPAN2026!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ${SPAN} alpha` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;

    // Multi-origin node: CONTENT is clean (survives), but its LABEL,
    // TAGS, ALIASES, and CELESTIAL TITLE quote the forgotten span.
    const survivor = nodes.create(
      {
        label: `hub ${SPAN}`,
        type: "daily",
        content: "a clean paraphrase with no quoted words",
        tags: [SPAN],
        aliases: [`orbit ${SPAN}`],
        celestialTitle: `The ${SPAN} Nebula`,
      },
      await embeddings.embed("rr5-survivor"),
    );
    repo.linkNodeToAllChunks(survivor.id, srcA.id);
    repo.linkNodeToAllChunks(survivor.id, srcB.id);
    for (const n of ["rr5 clean one", "rr5 clean two", "rr5 clean three"]) {
      nodes.create({ label: n, type: "daily", content: `clean memory ${n}` }, await embeddings.embed(n));
    }

    const personaBefore = refreshPersona(handle, SPACE, true);
    expect(personaBefore).toContain(SPAN);

    const res = await forgetSource(srcA.id);

    // The node legitimately survives: clean content, second origin remains.
    expect(res.nodesSurvivedClean).toContain(survivor.id);
    expect(res.nodesLabelScrubbed).toContain(survivor.id);
    expect(res.unresolved).toEqual([]);
    const row = handle.sqlite.prepare(
      `SELECT label, tags, aliases, celestial_title FROM nodes WHERE id = ?`,
    ).get(survivor.id) as { label: string; tags: string | null; aliases: string | null; celestial_title: string | null };
    // Label excised in place (span cut out, rest kept), not tombstoned.
    expect(row.label).toBe("hub");
    expect(row.label).not.toContain(SPAN);
    // A tag that IS the quote is dropped; the alias keeps its clean part.
    expect(row.tags).toBeNull();
    expect(row.aliases).toBe(JSON.stringify(["orbit"]));
    // The celestial title loses the quote AND the "e" of "The": the
    // source chunk ("alpha capture …") contains the 24-char window
    // "e RESIDUALLABELSPAN2026!", so that "e" is part of a verbatim
    // window by the design's definition and is excised with it. Word
    // repair keeps the remainder two words ("Th Nebula"), never fused.
    expect(row.celestial_title).toBe("Th Nebula");
    // The FTS row is re-indexed with the scrubbed label.
    const fts = handle.sqlite.prepare(`SELECT label, content FROM nodes_fts WHERE rowid = ?`).get(survivor.id) as { label: string; content: string };
    expect(fts.label).toBe("hub");
    expect(fts.label).not.toContain(SPAN);
    expect(fts.content).toBe("a clean paraphrase with no quoted words");
    // The re-derived persona no longer quotes the forgotten source.
    const personaRow = handle.sqlite.prepare(`SELECT body FROM user_persona WHERE space_id = ?`).get(SPACE) as { body: string } | undefined;
    expect(personaRow).toBeDefined();
    expect(personaRow!.body).not.toContain(SPAN);
    // Whole-row sweep: no representation of the node holds the span.
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(survivor.id));
    expect(blob).not.toContain(SPAN);
  });

  it("an unlinked node with clean content but a quoting label is scrubbed, not tombstoned", async () => {
    const SPAN = "UNLINKEDLABELSPAN2026!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `unlinked ${SPAN} capture` }).source;
    const bystander = nodes.create(
      { label: `note ${SPAN}`, type: "daily", content: "nothing quoted in the body" },
      await embeddings.embed("rr5-bystander"),
    );
    const clean = nodes.create(
      { label: "untouched label", type: "daily", content: "clean body", tags: ["keep me"] },
      await embeddings.embed("rr5-clean"),
    );

    const res = await forgetSource(srcA.id);

    expect(res.nodesLabelScrubbed).toContain(bystander.id);
    expect(res.nodesLabelScrubbed).not.toContain(clean.id);
    expect(res.nodesTombstoned).not.toContain(bystander.id);
    const row = handle.sqlite.prepare(`SELECT label, deleted_at FROM nodes WHERE id = ?`).get(bystander.id) as { label: string; deleted_at: string | null };
    expect(row.label).toBe("note");
    expect(row.deleted_at).toBeNull();
    expect(nodes.getById(bystander.id)).toBeDefined();
    const fts = handle.sqlite.prepare(`SELECT label FROM nodes_fts WHERE rowid = ?`).get(bystander.id) as { label: string };
    expect(fts.label).toBe("note");
    // Clean metadata is written back byte-identical.
    const cleanRow = handle.sqlite.prepare(`SELECT label, tags FROM nodes WHERE id = ?`).get(clean.id) as { label: string; tags: string | null };
    expect(cleanRow.label).toBe("untouched label");
    expect(cleanRow.tags).toBe(JSON.stringify(["keep me"]));
  });

  it("a label that IS the quote becomes the forget tombstone; the node survives", async () => {
    const SPAN = "WHOLELABELSPAN2026!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `whole ${SPAN} capture` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "second origin capture" }).source;
    const survivor = nodes.create(
      { label: SPAN, type: "daily", content: "clean body, quoting label only" },
      await embeddings.embed("rr5-whole-label"),
    );
    repo.linkNodeToAllChunks(survivor.id, srcA.id);
    repo.linkNodeToAllChunks(survivor.id, srcB.id);

    const res = await forgetSource(srcA.id);

    expect(res.nodesSurvivedClean).toContain(survivor.id);
    expect(res.nodesLabelScrubbed).toContain(survivor.id);
    const row = handle.sqlite.prepare(`SELECT label FROM nodes WHERE id = ?`).get(survivor.id) as { label: string };
    expect(row.label).toBe("[forgotten at the owner's request]");
    expect(row.label).not.toContain(SPAN);
    const fts = handle.sqlite.prepare(`SELECT label FROM nodes_fts WHERE rowid = ?`).get(survivor.id) as { label: string };
    expect(fts.label).not.toContain(SPAN);
  });

  it("a quoting tag is excised to its clean remainder while a clean tag on the same node is kept; clean labels are untouched", async () => {
    const SPAN = "TAGONLYSPAN2026!!!!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `taggy ${SPAN} capture` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "second origin capture" }).source;
    const survivor = nodes.create(
      { label: "clean label", type: "daily", content: "clean body", tags: ["keep me", `trail ${SPAN}`] },
      await embeddings.embed("rr5-tag-only"),
    );
    repo.linkNodeToAllChunks(survivor.id, srcA.id);
    repo.linkNodeToAllChunks(survivor.id, srcB.id);

    const res = await forgetSource(srcA.id);

    expect(res.nodesSurvivedClean).toContain(survivor.id);
    expect(res.nodesLabelScrubbed).toContain(survivor.id);
    const row = handle.sqlite.prepare(`SELECT label, tags FROM nodes WHERE id = ?`).get(survivor.id) as { label: string; tags: string | null };
    expect(row.label).toBe("clean label");
    // The quoting tag keeps its clean remainder ("trail"); only a tag
    // that excises to nothing is dropped. The clean tag is untouched.
    expect(row.tags).toBe(JSON.stringify(["keep me", "trail"]));
  });
});

describe("exciseVerbatimSpans", () => {
  it("cuts quoting windows and collapses the gap", () => {
    const SPAN = "EXCISESPAN2026!!!!!!!!!!";
    expect(SPAN.length).toBe(24);
    const chunks = [`prefix ${SPAN} suffix`];
    expect(exciseVerbatimSpans(`a label ${SPAN} here`, chunks)).toBe("a label here");
    expect(exciseVerbatimSpans(SPAN, chunks)).toBe("");
  });

  it("removes a span crossing a chunk boundary", () => {
    const chunks = ["a".repeat(24), "b".repeat(24)];
    const crossing = "a".repeat(16) + "b".repeat(8);
    expect(crossing.length).toBe(24);
    expect(containsVerbatimSpan(`pre ${crossing} post`, chunks)).toBe(true);
    const out = exciseVerbatimSpans(`pre ${crossing} post`, chunks);
    expect(out).toBe("pre post");
    expect(containsVerbatimSpan(out, chunks)).toBe(false);
  });

  it("excises a short chunk checked whole", () => {
    expect(exciseVerbatimSpans("say tiny quote now", ["tiny quote"])).toBe("say now");
    expect(exciseVerbatimSpans("nothing quoted here", ["tiny quote"])).toBe("nothing quoted here");
  });
});
