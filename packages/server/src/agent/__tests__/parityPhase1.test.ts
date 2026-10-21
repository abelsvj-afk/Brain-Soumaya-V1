import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { brainStatsTool } from "../tools/brainStats.js";
import { peopleLookupTool } from "../tools/peopleLookup.js";
import { entityLookupTool } from "../tools/entityLookup.js";
import { AGENT_TOOLS } from "../tools/registry.js";
import { agentLoop, getAgentTool } from "../loop.js";

/**
 * Telegram Parity Phase 1 — exact-answer read tools (findings §2/§3, Phase 1).
 *
 * FALSIFICATION BY CONSTRUCTION: every test here exercises brain_stats /
 * people_lookup / entity_lookup. On the pre-Phase-1 code those modules do
 * not exist and AGENT_TOOLS holds exactly 5 tools with no count/people/
 * entity path at all — this suite cannot even be collected there, and the
 * loop literally cannot answer these questions (that was the "39 memories"
 * and the invisible-father bug). Each test therefore fails pre-tool.
 *
 * Seeded brain (per test, in-memory): 226 live nodes + 12 tracked people,
 * one of whom is a BARE-NAME person node ("Marcus Vale" — the word "father"
 * appears ONLY in his content, never in his label), plus archived /
 * superseded / deleted rows that must NOT pollute the live counts, and a
 * second space that must never leak in.
 */

let handle: DbHandle;
let ctx: AppContext;
let tc: ToolContext;
const SPACE = "parity-space";
const OTHER = "parity-other-space";
const NOW = Date.now();

let fatherId = 0;
let goalAId = 0;

const PEOPLE = [
  "Marcus Vale", // the father — content-only role, bare-name label
  "Elena Brooks",
  "Tomas Reed",
  "Priya Nair",
  "Jonas Keller",
  "Marta Silva",
  "Owen Hart",
  "Lena Fischer",
  "David Okafor",
  "Ruth Adler",
  "Sam Whitaker",
  "Nina Petrova",
];

interface NodeOpts {
  label: string;
  type?: string;
  content?: string;
  kind?: string | null;
  status?: string;
  aliases?: string[];
  emotionalWeight?: number;
  createdAt?: string;
  deletedAt?: string;
  supersededAt?: string;
  spaceId?: string;
}

function insertNode(o: NodeOpts): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, kind, status, aliases, emotional_weight, created_at, deleted_at, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.spaceId ?? SPACE,
      o.label,
      o.type ?? "knowledge",
      o.content ?? `content of ${o.label}`,
      o.kind ?? null,
      o.status ?? "active",
      o.aliases ? JSON.stringify(o.aliases) : null,
      o.emotionalWeight ?? null,
      o.createdAt ?? "2026-10-01T00:00:00.000Z",
      o.deletedAt ?? null,
      o.supersededAt ?? null,
    );
  return Number(r.lastInsertRowid);
}

function insertEdge(source: number, target: number, relationship: string, spaceId = SPACE): void {
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, ?, 1)`)
    .run(spaceId, source, target, relationship);
}

function seedBrain(): void {
  // 205 memories. Memory #1 is the father's interaction memory.
  const dinnerId = insertNode({
    label: "Dinner with Marcus",
    type: "daily",
    kind: "memory",
    content: "Had dinner with Marcus; he told stories from his youth.",
    emotionalWeight: 0.6,
    createdAt: "2026-10-05T12:00:00.000Z",
  });
  const mem2Id = insertNode({ label: "Memory 002", kind: "memory", content: "seeded memory 2" });
  for (let i = 3; i <= 205; i++) {
    insertNode({ label: `Memory ${String(i).padStart(3, "0")}`, kind: "memory", content: `seeded memory ${i}` });
  }

  // 12 tracked people. The father is a bare name: "father" is ONLY in content.
  fatherId = insertNode({
    label: "Marcus Vale",
    type: "person",
    kind: "person_entity",
    content: "Marcus is the owner's father. He raised the owner and lives nearby.",
    aliases: ["Pops"],
  });
  for (const name of PEOPLE.slice(1)) {
    insertNode({ label: name, type: "person", kind: "person_entity", content: `A tracked person named ${name}.` });
  }

  // 4 goals, 3 actions, 2 ideas.
  goalAId = insertNode({ label: "Goal Alpha", type: "concept", kind: "goal", content: "the first goal" });
  insertNode({ label: "Goal Beta", type: "concept", kind: "goal" });
  insertNode({ label: "Goal Gamma", type: "concept", kind: "goal" });
  insertNode({ label: "Goal Delta", type: "concept", kind: "goal" });
  for (const t of ["Task A", "Task B", "Task C"]) insertNode({ label: t, type: "daily", kind: "action" });
  insertNode({ label: "Idea One", type: "concept", kind: "idea" });
  insertNode({ label: "Idea Two", type: "concept", kind: "idea" });
  // Live total: 205 + 12 + 4 + 3 + 2 = 226.

  // NOT live: 2 archived, 1 superseded, 1 deleted.
  insertNode({ label: "Archived One", kind: "memory", status: "archived" });
  insertNode({ label: "Archived Two", kind: "memory", status: "archived" });
  insertNode({ label: "Superseded Fact", kind: "memory", supersededAt: "2026-10-06T00:00:00.000Z" });
  insertNode({ label: "Deleted Fact", kind: "memory", deletedAt: "2026-10-06T00:00:00.000Z" });

  // Edges (4, all between live nodes): the father in BOTH directions + one more.
  insertEdge(dinnerId, fatherId, "supports"); // incoming to father (his interaction)
  insertEdge(mem2Id, fatherId, "builds_on"); // incoming to father
  insertEdge(fatherId, goalAId, "relates_to"); // outgoing from father
  insertEdge(goalAId, goalAId + 1, "relates_to"); // Goal Alpha -> Goal Beta

  // Episodes: 3 live + 1 forgotten (excluded).
  const ep = handle.sqlite.prepare(
    `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at, forgotten_at) VALUES (?, 'conversation', ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', ?)`,
  );
  ep.run(SPACE, "episode one", null);
  ep.run(SPACE, "episode two", null);
  ep.run(SPACE, "episode three", null);
  ep.run(SPACE, "forgotten episode", "2026-10-07T00:00:00.000Z");

  // Journeys: 2 total, 1 active.
  handle.sqlite.prepare(`INSERT INTO journeys (space_id, title, status) VALUES (?, 'Journey Active', 'active')`).run(SPACE);
  handle.sqlite.prepare(`INSERT INTO journeys (space_id, title, status) VALUES (?, 'Journey Done', 'done')`).run(SPACE);

  // Another space that must never leak: 50 memories + 3 people.
  for (let i = 1; i <= 50; i++) insertNode({ label: `Other Memory ${i}`, kind: "memory", spaceId: OTHER });
  for (const n of ["Other Ann", "Other Ben", "Other Cat"]) {
    insertNode({ label: n, type: "person", kind: "person_entity", content: `${n} is someone's father too.`, spaceId: OTHER });
  }
}

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: undefined as never,
  };
  tc = { ctx, spaceId: SPACE, now: NOW, notify: async () => {} };
  seedBrain();
});

afterEach(() => handle.sqlite.close());

// ---------------------------------------------------------------------------
// brain_stats — the exact total, labeled (the "39" fix)
// ---------------------------------------------------------------------------

describe("brain_stats", () => {
  it("returns the EXACT live total (226), not a tally of search results", async () => {
    const r = await brainStatsTool.run(tc, {});
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Total live nodes \(headline[^)]*\): 226/);
    // The memory-kind subset is labeled separately — never the headline.
    expect(r.message).toContain('kind "memory": 205');
    expect(r.message).toContain("Memories only (live nodes of kind \"memory\", incl. kind-unset plain memories): 205");
  });

  it("breaks down by kind and by type, and the parts sum to the headline", async () => {
    const r = await brainStatsTool.run(tc, {});
    expect(r.message).toContain('kind "person_entity": 12');
    expect(r.message).toContain('kind "goal": 4');
    expect(r.message).toContain('kind "action": 3');
    expect(r.message).toContain('kind "idea": 2');
    expect(r.message).toContain('type "knowledge": 204'); // 205 memories minus the dinner memory (type "daily")
    expect(r.message).toContain('type "person": 12');
    expect(r.message).toContain('type "concept": 6');
    expect(r.message).toContain('type "daily": 4'); // 3 actions + the dinner memory
  });

  it("reports people, edges, episodes, journeys, active tasks, archived — each labeled", async () => {
    const r = await brainStatsTool.run(tc, {});
    expect(r.message).toContain('People tracked (live nodes of kind "person_entity"');
    expect(r.message).toMatch(/People tracked.*: 12/);
    expect(r.message).toMatch(/Edges \(connections between live nodes.*: 4/);
    expect(r.message).toMatch(/Episodes \(lived-event narratives.*: 3/);
    expect(r.message).toContain("Journeys (total): 2 (of which active: 1)");
    expect(r.message).toContain('Active tasks (live nodes of kind "action"): 3');
    expect(r.message).toMatch(/Archived nodes.*: 2/);
  });

  it("excludes archived, superseded, deleted, and other-space nodes from the total", async () => {
    const r = await brainStatsTool.run(tc, {});
    // 226 live in SPACE; the other space's 53 nodes and the 4 non-live rows
    // would push any wrong count to 283 / 230 / 228 — the exact match above
    // already proves exclusion; assert the summary line agrees.
    expect(r.summary).toContain("226 live nodes");
    expect(r.summary).toContain("12 people");
  });

  it("is registered as a read tool the loop can call", () => {
    expect(getAgentTool("brain_stats")).toBe(brainStatsTool);
    expect(AGENT_TOOLS.find((e) => e.tool.name === "brain_stats")?.isWrite).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// people_lookup — the roster + the father fix
// ---------------------------------------------------------------------------

describe("people_lookup", () => {
  it("no query → the COMPLETE roster: all 12 seeded people (past the old top-8 visibility)", async () => {
    const r = await peopleLookupTool.run(tc, { limit: 50 });
    expect(r.ok).toBe(true);
    for (const name of PEOPLE) expect(r.message).toContain(name);
    expect(r.message).toContain("complete roster of the 12 people");
    expect(r.message).not.toContain("truncated");
    // Roster facts come along: father's interaction count + last interaction + tone.
    expect(r.message).toContain("Marcus Vale (1 interaction, last interaction 2026-10-05, tone: warm)");
  });

  it("no query with a small limit → truncation is stated honestly", async () => {
    const r = await peopleLookupTool.run(tc, { limit: 5 });
    expect(r.message).toContain("Showing 5 of 12 tracked people (truncated at limit 5");
    const listed = (r.message!.match(/^- #/gm) ?? []).length;
    expect(listed).toBe(5);
  });

  it("query 'father' finds the bare-name person via LITERAL CONTENT match (not vector search)", async () => {
    const r = await peopleLookupTool.run(tc, { query: "father" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Marcus Vale");
    expect(r.message).toContain("matched via description text");
    expect(r.targets).toEqual([fatherId]);
    // Nobody else in THIS space matches (other-space fathers must not leak).
    expect(r.message).not.toContain("Other Ann");
  });

  it("single match includes personProfile detail (the interactions)", async () => {
    const r = await peopleLookupTool.run(tc, { query: "father" });
    expect(r.message).toContain("Profile for Marcus Vale: 1 interaction(s), tone: warm");
    expect(r.message).toContain('"Dinner with Marcus"');
  });

  it("query by alias and by name also find him literally", async () => {
    const byAlias = await peopleLookupTool.run(tc, { query: "Pops" });
    expect(byAlias.targets).toEqual([fatherId]);
    expect(byAlias.message).toContain("matched via alias");
    const byName = await peopleLookupTool.run(tc, { query: "Marcus Vale" });
    expect(byName.targets).toEqual([fatherId]);
    const byNameInSentence = await peopleLookupTool.run(tc, { query: "tell me about Marcus Vale please" });
    expect(byNameInSentence.targets).toEqual([fatherId]);
  });

  it("no literal match → honest empty result, no guessing", async () => {
    const r = await peopleLookupTool.run(tc, { query: "grandmother" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("no tracked person literally matches");
    expect(r.targets ?? []).toEqual([]);
  });

  it("roster never leaks the other space's people", async () => {
    const r = await peopleLookupTool.run(tc, { limit: 200 });
    expect(r.message).not.toContain("Other Ann");
    expect(r.message).toContain("complete roster of the 12 people");
  });
});

// ---------------------------------------------------------------------------
// entity_lookup — one node, edges in BOTH directions
// ---------------------------------------------------------------------------

describe("entity_lookup", () => {
  it("by id: returns the node with connections in BOTH directions", async () => {
    const r = await entityLookupTool.run(tc, { id: fatherId });
    expect(r.ok).toBe(true);
    expect(r.message).toContain(`ENTITY #${fatherId}: Marcus Vale`);
    expect(r.message).toContain("father");
    // Outgoing: father -relates_to-> Goal Alpha.
    expect(r.message).toContain("Outgoing connections (this node → others):");
    expect(r.message).toContain(`relates_to → #${goalAId}`);
    expect(r.message).toContain("Goal Alpha");
    // Incoming: Dinner memory -supports-> father, Memory 002 -builds_on-> father.
    expect(r.message).toContain("Incoming connections (others → this node):");
    expect(r.message).toContain("Dinner with Marcus");
    expect(r.message).toContain("supports");
    expect(r.message).toContain("builds_on");
    expect(r.targets).toEqual([fatherId]);
  });

  it("by label: literal label match resolves the same node", async () => {
    const r = await entityLookupTool.run(tc, { label: "Marcus Vale" });
    expect(r.targets).toEqual([fatherId]);
    expect(r.message).toContain("Outgoing connections");
  });

  it("unknown label / other-space id → honest not-found, never a substitute", async () => {
    const byLabel = await entityLookupTool.run(tc, { label: "Nobody Here" });
    expect(byLabel.message).toContain("no live node is labeled");
    const otherId = handle.sqlite
      .prepare(`SELECT id FROM nodes WHERE space_id = ? LIMIT 1`)
      .get(OTHER) as { id: number };
    const byId = await entityLookupTool.run(tc, { id: otherId.id });
    expect(byId.message).toContain(`no node with id ${otherId.id} exists in this brain`);
  });

  it("ambiguous label → candidates are listed for disambiguation, none silently picked", async () => {
    insertNode({ label: "Twin Node", kind: "memory" });
    insertNode({ label: "Twin Node", kind: "memory" });
    const r = await entityLookupTool.run(tc, { label: "Twin Node" });
    expect(r.message).toContain("matches 2 different nodes");
    expect(r.targets).toHaveLength(2);
  });

  it("neither id nor label → rejected", async () => {
    const r = await entityLookupTool.run(tc, {});
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loop integration — a count question now has a real answer path
// ---------------------------------------------------------------------------

describe("agent loop with the Phase 1 tools", () => {
  function scriptedLlm(script: LlmToolResult[]): LlmProvider {
    const base = new HeuristicProvider();
    let i = 0;
    return {
      ...base,
      callWithTools: async (_input: LlmToolCallInput): Promise<LlmToolResult> => {
        if (i < script.length) {
          const next = script[i++];
          if (next) return next;
        }
        return { text: "done.", calls: [] };
      },
    } as LlmProvider;
  }

  it("the model can call brain_stats mid-conversation (pre-Phase-1 the loop had no count path)", async () => {
    ctx.llm = scriptedLlm([
      { text: null, calls: [{ id: "c1", name: "brain_stats", args: {} }] },
      { text: "You have 226 live nodes in your brain.", calls: [] },
    ]);
    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:parity",
      userMessage: "how many memories do I have?",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    expect(r.text).toContain("226");
    const logs = handle.sqlite
      .prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = 'tool:brain_stats'`)
      .get() as { c: number };
    expect(logs.c).toBe(1);
  });

  it("the model can resolve a person then look up the entity (resolve-then-inspect chain)", async () => {
    ctx.llm = scriptedLlm([
      { text: null, calls: [{ id: "c1", name: "people_lookup", args: { query: "father" } }] },
      { text: null, calls: [{ id: "c2", name: "entity_lookup", args: { id: fatherId } }] },
      { text: "Your father is Marcus Vale.", calls: [] },
    ]);
    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:parity",
      userMessage: "who is my father and how is he connected?",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    expect(r.text).toContain("Marcus Vale");
    for (const tool of ["people_lookup", "entity_lookup"]) {
      const logs = handle.sqlite
        .prepare(`SELECT COUNT(*) c FROM agent_logs WHERE action = ?`)
        .get(`tool:${tool}`) as { c: number };
      expect(logs.c).toBe(1);
    }
  });
});
