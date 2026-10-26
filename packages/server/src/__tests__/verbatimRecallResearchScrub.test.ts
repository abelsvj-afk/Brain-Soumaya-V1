// Fix round 6 — regression tests for the round-5 re-review finding 2:
// a forgotten span can survive in `nodes.research_questions` /
// `nodes.research_answers` on a SURVIVING node (the sweep never
// touched those columns). Questions are LLM-generated from
// label+content and served daily; answers are user-typed and re-shown
// in NodeInspector — both are stored representations that can return
// the span verbatim. These tests assert the FIXED behavior: the span
// is excised in place on both surviving-node paths (linked survivor
// loop + unlinked sweep), quoting entries that excise to nothing are
// dropped, columns that empty out become NULL, and the rest of the
// row (including clean questions/answers) is intact. Each test is
// fail-before: on the round-5 tree the span assertions fail.
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

type ResearchRow = {
  research_questions: string | null;
  research_answers: string | null;
};

function researchRow(nodeId: number): ResearchRow {
  return handle.sqlite
    .prepare(`SELECT research_questions, research_answers FROM nodes WHERE id = ?`)
    .get(nodeId) as ResearchRow;
}

describe("Fix round 6 — research columns on a SURVIVING node", () => {
  it("a linked survivor's quoting research question/answer are excised in place; clean entries kept", async () => {
    const SPAN = "RESEARCHQSPAN2026!!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `research ${SPAN} capture` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;

    // Multi-origin node: CONTENT is clean (survives), but its
    // research question and answer quote the forgotten span.
    const survivor = nodes.create(
      { label: "research hub", type: "daily", content: "a clean paraphrase with no quoted words" },
      await embeddings.embed("rr6-survivor"),
    );
    nodes.updateResearch(
      survivor.id,
      [`what about ${SPAN}?`, "a clean question"],
      { q1: `my answer ${SPAN} here`, q2: "clean answer" },
    );
    repo.linkNodeToAllChunks(survivor.id, srcA.id);
    repo.linkNodeToAllChunks(survivor.id, srcB.id);

    const res = await forgetSource(srcA.id);

    expect(res.nodesSurvivedClean).toContain(survivor.id);
    expect(res.nodesTombstoned).not.toContain(survivor.id);
    expect(res.unresolved).toEqual([]);
    const row = researchRow(survivor.id);
    // The quoting question keeps its clean remainder ("what about?");
    // the clean question is untouched.
    expect(JSON.parse(row.research_questions as string)).toEqual(["what about?", "a clean question"]);
    // The quoting answer keeps its clean remainder; the clean answer
    // is untouched. Word repair keeps "my answer here" two words.
    expect(JSON.parse(row.research_answers as string)).toEqual({ q1: "my answer here", q2: "clean answer" });
    // Whole-row sweep: no representation of the node holds the span.
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(survivor.id));
    expect(blob).not.toContain(SPAN);
  });

  it("an unlinked node with clean content but quoting research columns is scrubbed, not tombstoned", async () => {
    const SPAN = "UNLINKEDRESEARCH2026!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `unlinked ${SPAN} capture` }).source;
    const bystander = nodes.create(
      { label: "bystander note", type: "daily", content: "nothing quoted in the body" },
      await embeddings.embed("rr6-bystander"),
    );
    nodes.updateResearch(
      bystander.id,
      [`why ${SPAN}?`],
      { q1: `because ${SPAN} happened` },
    );

    const res = await forgetSource(srcA.id);

    expect(res.nodesTombstoned).not.toContain(bystander.id);
    const row = handle.sqlite.prepare(`SELECT deleted_at FROM nodes WHERE id = ?`).get(bystander.id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeNull();
    const research = researchRow(bystander.id);
    expect(research.research_questions).not.toContain(SPAN);
    expect(research.research_answers).not.toContain(SPAN);
    expect(JSON.parse(research.research_questions as string)).toEqual(["why?"]);
    expect(JSON.parse(research.research_answers as string)).toEqual({ q1: "because happened" });
  });

  it("research columns that excise to nothing become NULL; the node survives", async () => {
    const SPAN = "ALLQUOTE2026RESEARCH!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `whole ${SPAN} capture` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "second origin capture" }).source;
    const survivor = nodes.create(
      { label: "all-quote research", type: "daily", content: "clean body, quoting research only" },
      await embeddings.embed("rr6-all-quote"),
    );
    nodes.updateResearch(survivor.id, [SPAN], { only: SPAN });
    repo.linkNodeToAllChunks(survivor.id, srcA.id);
    repo.linkNodeToAllChunks(survivor.id, srcB.id);

    const res = await forgetSource(srcA.id);

    expect(res.nodesSurvivedClean).toContain(survivor.id);
    const row = researchRow(survivor.id);
    expect(row.research_questions).toBeNull();
    expect(row.research_answers).toBeNull();
    const blob = JSON.stringify(handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(survivor.id));
    expect(blob).not.toContain(SPAN);
  });

  it("clean research columns on an untouched node are written back byte-identical", async () => {
    const SPAN = "CLEANKEPTSPAN2026!!!!!!!";
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `kept ${SPAN} capture` }).source;
    const clean = nodes.create(
      { label: "untouched research", type: "daily", content: "clean body" },
      await embeddings.embed("rr6-clean"),
    );
    nodes.updateResearch(clean.id, ["what is this?", "why does it matter?"], { a: "my own answer", b: "another one" });

    await forgetSource(srcA.id);

    const row = researchRow(clean.id);
    expect(row.research_questions).toBe(JSON.stringify(["what is this?", "why does it matter?"]));
    expect(row.research_answers).toBe(JSON.stringify({ a: "my own answer", b: "another one" }));
  });
});
